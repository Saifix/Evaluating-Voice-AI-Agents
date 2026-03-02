/**
 * conversation.js
 *
 * Orchestrates the Nova ↔ Sage conversation in-process.
 * No child processes — both agents run here and relay audio via localhost HTTP.
 *
 * Usage:
 *   const { Conversation } = require('./conversation');
 *   const convo = new Conversation();
 *   await convo.start((event) => { ... });  // event: { type, ... }
 *   convo.stop();                           // graceful abort
 *
 * Events emitted via the callback:
 *   { type: 'status',     speaker, text }          — "Nova is speaking…" etc.
 *   { type: 'transcript', speaker, turn, text }    — one completed turn
 *   { type: 'audio',      turn, buffer }           — raw PCM Buffer for that turn (for streaming)
 *   { type: 'done',       wavPath, transcriptPath }— conversation finished, files saved
 *   { type: 'error',      message }                — something went wrong
 *   { type: 'log',        text }                   — debug / info line
 */

'use strict';

// Config is injected at runtime — no dotenv here
const http      = require('http');
const fs        = require('fs');
const path      = require('path');
const vm        = require('vm');
const WebSocket = require('ws');
const OpenAI    = require('openai');

// ── Shared constants ───────────────────────────────────────────────────────────
const NOVA_PORT   = 3010;
const SAGE_PORT   = 3011;
const SAMPLE_RATE = 24000;
const OUTPUT_DIR  = path.join(__dirname, '..', 'Output');

// ── WAV helper ─────────────────────────────────────────────────────────────────
function buildWav(pcm) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);                     h.writeUInt32LE(36 + pcm.length, 4);
  h.write('WAVE', 8);                     h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);               h.writeUInt16LE(1,  20); // PCM
  h.writeUInt16LE(1,  22);               h.writeUInt32LE(SAMPLE_RATE,     24);
  h.writeUInt32LE(SAMPLE_RATE * 2, 28);  h.writeUInt16LE(2,  32);
  h.writeUInt16LE(16, 34);               h.write('data', 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

// ══════════════════════════════════════════════════════════════════════════════
// SageAgent — GPT-4.1 + Whisper-1 + TTS-1
// ══════════════════════════════════════════════════════════════════════════════
class SageAgent {
  constructor(emit, cfg) {
    this.emit          = emit;
    this.cfg           = cfg;
    this.outputDir     = cfg.outputDir || OUTPUT_DIR;
    this.busy          = false;
    this.exchangeCount = 0;
    this.convHistory   = [];
    this.transcriptLines = [];
    this.server        = null;
    this.stopped       = false;
    this.client        = new OpenAI({ apiKey: cfg.openaiApiKey });
    this.onDone        = null;

    const n = cfg.maxExchanges;
    // Replace the MAX_EXCHANGES placeholder in the instructions template
    this.systemPrompt  = cfg.sageInstructions
      .replace(/MAX_EXCHANGES/g, n)
      .replace(/your \d+th reply/g, `your ${n}th reply`);
  }

  // Start HTTP server listening for Nova's audio
  listen() {
    return new Promise((resolve) => {
      this.server = http.createServer((req, res) => this._handleRequest(req, res));
      this.server.listen(this.cfg.sagePcPort || SAGE_PORT, () => {
        this.emit({ type: 'log', text: '[Sage] Relay server ready' });
        resolve();
      });
    });
  }

  stop() {
    this.stopped = true;
    if (this.server) {
      if (typeof this.server.closeAllConnections === 'function')
        this.server.closeAllConnections();
      this.server.close();
      this.server = null;
    }
  }

  _handleRequest(req, res) {
    if (req.method !== 'POST' || req.url !== '/audio') {
      res.statusCode = 404; res.end(); return;
    }
    let body = '';
    req.on('data', c => (body += c));
    req.on('end', () => {
      res.end('OK');
      if (this.stopped) return;
      if (this.busy) {
        this.emit({ type: 'log', text: '[Sage] Still processing — dropping incoming.' });
        return;
      }
      let payload;
      try { payload = JSON.parse(body); }
      catch (e) { this.emit({ type: 'error', message: '[Sage] Bad JSON: ' + e.message }); return; }

      const { audio, turn, transcript, transcriptLine } = payload;
      this.emit({ type: 'log', text: `[Sage] Received ${audio.length} chunks from Nova (turn ${turn})` });
      this.busy = true;
      this._processTurn(audio, transcript, transcriptLine)
        .catch(e => {
          this.emit({ type: 'error', message: '[Sage] processTurn error: ' + e.message });
          this.busy = false;
        });
    });
  }

  async _processTurn(audioChunks, novaTranscript, novaTranscriptLine) {
    const cfg = this.cfg;
    // ① STT
    let novaText = novaTranscript || '';
    if (!novaText) {
      this.emit({ type: 'status', speaker: 'sage', text: 'Transcribing Nova…' });
      const pcmBuf = Buffer.concat(audioChunks.map(b => Buffer.from(b, 'base64')));
      const tmp    = path.join(this.outputDir, `_tmp_nova_${Date.now()}.wav`);
      fs.writeFileSync(tmp, buildWav(pcmBuf));
      const tx = await this.client.audio.transcriptions.create({
        file: fs.createReadStream(tmp), model: cfg.sttModel,
      });
      novaText = tx.text;
      fs.unlinkSync(tmp);
    }

    if (novaTranscriptLine) this.transcriptLines.push(novaTranscriptLine);

    this.exchangeCount++;
    this.convHistory.push({ role: 'user', content: novaText });
    this.emit({ type: 'status', speaker: 'sage', text: 'Sage is thinking…' });

    // ② LLM
    const isLastTurn = this.exchangeCount >= cfg.maxExchanges;
    const completion = await this.client.chat.completions.create({
      model: cfg.sageModel,
      messages: [{ role: 'system', content: this.systemPrompt }, ...this.convHistory],
      max_tokens: 150,
      temperature: 0.85,
    });

    let sageText = completion.choices[0].message.content.trim();
    const isEnd  = sageText.includes('<<END>>') || isLastTurn;
    sageText     = sageText.replace('<<END>>', '').trim();

    this.convHistory.push({ role: 'assistant', content: sageText });
    const sageTurn = this.exchangeCount * 2;
    this.transcriptLines.push(`[Turn ${sageTurn}] Sage: ${sageText}`);
    this.emit({ type: 'transcript', speaker: 'sage', turn: sageTurn, text: sageText });
    this.emit({ type: 'status', speaker: 'sage', text: 'Sage is speaking…' });

    // ③ TTS
    const speech = await this.client.audio.speech.create({
      model: cfg.ttsModel, voice: cfg.sageVoice, input: sageText, response_format: 'pcm',
    });
    const ttsPcm = Buffer.from(await speech.arrayBuffer());

    // Chunk for relay to Nova
    const CHUNK = 8192;
    const chunks = [];
    for (let i = 0; i < ttsPcm.length; i += CHUNK)
      chunks.push(ttsPcm.subarray(i, i + CHUNK).toString('base64'));

    this.emit({ type: 'log', text: `[Sage] TTS ${ttsPcm.length} B → ${chunks.length} chunks` });

    if (isEnd) {
      this._saveTranscript();
      if (this.onDone) this.onDone(this.transcriptLines);
    }

    await this._sendToNova(chunks, sageTurn, isEnd);
    // Stop accepting further turns so Nova's farewell doesn't trigger another Sage reply
    if (isEnd) this.stopped = true;
    this.busy = false;
  }

  _saveTranscript() {
    const sorted = [...this.transcriptLines].sort((a, b) => {
      const n = s => parseInt((s.match(/\[Turn (\d+)\]/) || [0, 0])[1], 10);
      return n(a) - n(b);
    });
    if (!fs.existsSync(this.outputDir)) fs.mkdirSync(this.outputDir, { recursive: true });
    fs.writeFileSync(
      path.join(this.outputDir, 'transcript.txt'),
      sorted.join('\n\n') + '\n',
      'utf8'
    );
    this.emit({ type: 'log', text: `[Sage] ✔ transcript.txt saved (${sorted.length} turns)` });
  }

  _sendToNova(chunks, turn, isEnd, retries = 5) {
    return new Promise((resolve) => {
      const body = JSON.stringify({ audio: chunks, turn, isEnd });
      const req  = http.request(
        { host: 'localhost', port: this.cfg.novaPcPort || NOVA_PORT, path: '/audio', method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
        () => {
          this.emit({ type: 'log', text: `[Sage] Sent to Nova (exchange ${turn}${isEnd ? ' — END' : ''})` });
          resolve();
        }
      );
      req.on('error', (e) => {
        if (retries > 0) {
          setTimeout(() => this._sendToNova(chunks, turn, isEnd, retries - 1).then(resolve), 1000);
        } else {
          this.emit({ type: 'error', message: '[Sage] Cannot reach Nova: ' + e.message });
          resolve();
        }
      });
      req.write(body); req.end();
    });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// NovaAgent — GPT-4o Realtime API via WebSocket
// ══════════════════════════════════════════════════════════════════════════════
class NovaAgent {
  constructor(emit, cfg) {
    this.emit            = emit;
    this.cfg             = cfg;
    this.outputDir       = cfg.outputDir || OUTPUT_DIR;
    this.ws              = null;
    this.server          = null;
    this.busy            = false;
    this.sessionReady    = false;
    this.myTurnCount     = 0;
    this.audioDeltaBufs  = [];
    this.currentXcript   = '';
    this.stopped         = false;
    this.conversationPcm = {};
    this.novaTransLines  = [];
    this.resolveConversation = null;
  }

  // Start HTTP server + connect to OpenAI Realtime
  start() {
    return new Promise((resolve, reject) => {
      if (!fs.existsSync(this.outputDir)) fs.mkdirSync(this.outputDir, { recursive: true });

      // HTTP server first (Sage will try to contact us)
      this.server = http.createServer((req, res) => this._handleRequest(req, res));
      this.server.listen(this.cfg.novaPcPort || NOVA_PORT, () => {
        this.emit({ type: 'log', text: '[Nova] Relay server ready, connecting to OpenAI…' });
        this._connectRealtime(resolve, reject);
      });
    });
  }

  stop() {
    this.stopped = true;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.close();
    if (this.server) {
      if (typeof this.server.closeAllConnections === 'function')
        this.server.closeAllConnections();
      this.server.close();
      this.server = null;
    }
  }

  _connectRealtime(resolve, reject) {
    this.resolveConversation = resolve;
    const realtimeModel = this.cfg.novaModel || 'gpt-4o-realtime-preview';
    this.ws = new WebSocket(
      `wss://api.openai.com/v1/realtime?model=${realtimeModel}`,
      {
        headers: {
          Authorization: `Bearer ${this.cfg.openaiApiKey}`,
          'OpenAI-Beta': 'realtime=v1',
        },
      }
    );

    this.ws.on('open', () => {
      this.emit({ type: 'log', text: '[Nova] Connected to OpenAI Realtime' });
      const sessionCfg = {
        modalities: ['text', 'audio'],
        instructions: this.cfg.novaInstructions,
        voice: this.cfg.novaVoice,
        input_audio_format: 'pcm16',
        output_audio_format: 'pcm16',
        input_audio_transcription: { model: 'whisper-1' },
        turn_detection: null,
      };
      const tools = (this.cfg.novaTools || []).filter(t => t.name && t.description);
      if (tools.length > 0) {
        sessionCfg.tools = tools.map(t => ({
          type: 'function',
          name: t.name,
          description: t.description,
          parameters: (() => {
            try { return JSON.parse(t.parameters || '{}'); }
            catch { return { type: 'object', properties: {} }; }
          })(),
        }));
        sessionCfg.tool_choice = 'auto';
        this.emit({ type: 'log', text: `[Nova] Registering ${tools.length} tool(s): ${tools.map(t => t.name).join(', ')}` });
      }
      this._send({ type: 'session.update', session: sessionCfg });
    });

    this.ws.on('message', (raw) => this._onMessage(raw));
    this.ws.on('error',   (err) => {
      this.emit({ type: 'error', message: '[Nova] WS error: ' + err.message });
      reject(err);
    });
    this.ws.on('close',   () => this.emit({ type: 'log', text: '[Nova] WS closed' }));
  }

  _send(obj) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN)
      this.ws.send(JSON.stringify(obj));
  }

  _onMessage(raw) {
    let event;
    try { event = JSON.parse(raw.toString()); } catch { return; }

    switch (event.type) {
      case 'session.updated':
        if (!this.sessionReady) {
          this.sessionReady = true;
          this.emit({ type: 'status', speaker: 'nova', text: 'Nova is starting the conversation…' });
          this.busy = true;
          this._send({
            type: 'conversation.item.create',
            item: {
              type: 'message', role: 'user',
              content: [{ type: 'input_text', text: this.cfg.novaTopic }],
            },
          });
          this._send({ type: 'response.create' });
        }
        break;

      case 'response.audio.delta':
      case 'response.output_audio.delta':
        if (event.delta) this.audioDeltaBufs.push(event.delta);
        break;

      case 'response.audio_transcript.done':
      case 'response.output_audio_transcript.done':
        this.currentXcript = event.transcript || this.currentXcript;
        break;

      case 'response.done':
        this._onResponseDone(event);
        break;

      case 'error':
        this.emit({ type: 'error', message: '[Nova] API error: ' + JSON.stringify(event.error) });
        this.busy = false;
        break;
    }
  }

  _onResponseDone(event) {
    if (!this.busy) return;

    // ── Function call? Execute tool and feed result back before speech turn ──
    const output = (event && event.response && event.response.output) || [];
    const funcCall = output.find(o => o.type === 'function_call');
    if (funcCall) {
      this._handleFunctionCall(funcCall).catch(e =>
        this.emit({ type: 'error', message: '[Nova] Tool execution error: ' + e.message })
      );
      return;
    }

    if (this.audioDeltaBufs.length === 0) {
      this.emit({ type: 'log', text: '[Nova] response.done with no audio — skipping turn' });
      this.busy = false;
      return;
    }

    this.busy = false;
    this.myTurnCount++;

    const chunks      = this.audioDeltaBufs.splice(0);
    const xcript      = this.currentXcript;
    this.currentXcript = '';
    const turnNum     = this.myTurnCount;
    const globalTurn  = turnNum * 2 - 1;

    // Store PCM for combined WAV
    const rawPcm = Buffer.concat(chunks.map(b => Buffer.from(b, 'base64')));
    this.conversationPcm[globalTurn] = rawPcm;
    // (no SSE audio emit — raw Buffers break JSON serialisation)

    const logLine = `[Turn ${globalTurn}] Nova: ${xcript || '(no transcript)'}`;
    this.novaTransLines.push(logLine);
    this.emit({ type: 'transcript', speaker: 'nova', turn: globalTurn, text: xcript || '' });
    this.emit({ type: 'status', speaker: 'nova', text: 'Nova spoke, waiting for Sage…' });

    setTimeout(() => this._sendToSage(chunks, globalTurn, xcript, logLine), 300);
  }

  async _handleFunctionCall(funcCall) {
    const { name, arguments: argsStr, call_id } = funcCall;
    this.emit({ type: 'log', text: `[Nova] Tool call → ${name}(${argsStr})` });
    let result;
    try {
      const args = JSON.parse(argsStr || '{}');
      result = await this._executeTool(name, args);
    } catch (e) {
      result = { error: e.message };
    }
    this.emit({ type: 'log', text: `[Nova] Tool result ← ${JSON.stringify(result).slice(0, 120)}` });
    this._send({
      type: 'conversation.item.create',
      item: { type: 'function_call_output', call_id, output: JSON.stringify(result) },
    });
    this._send({ type: 'response.create' });
  }

  async _executeTool(name, args) {
    const tools = this.cfg.novaTools || [];
    const tool  = tools.find(t => t.name === name);
    if (!tool) return { error: `Unknown tool: ${name}` };

    if (tool.execution === 'static') {
      try { return JSON.parse(tool.staticResponse || 'null'); }
      catch { return { result: tool.staticResponse }; }
    }

    if (tool.execution === 'code') {
      // Run user code in a sandboxed vm context with safe globals only.
      // The function body has access to `args` and common built-ins.
      const sandbox = {
        args,
        Math, Date, JSON, Number, String, Boolean, Object, Array,
        parseInt, parseFloat, isNaN, isFinite,
      };
      const ctx    = vm.createContext(sandbox);
      const script = new vm.Script(`(function(args){ ${tool.codeBody || 'return {};'} })(args)`);
      const result = script.runInContext(ctx, { timeout: 3000 });
      return result ?? { done: true };
    }

    // HTTP execution
    const method = (tool.httpMethod || 'POST').toUpperCase();
    let headers = { 'Content-Type': 'application/json' };
    try { Object.assign(headers, JSON.parse(tool.httpHeaders || '{}')); } catch {}
    const opts = { method, headers };
    if (method !== 'GET' && method !== 'HEAD') opts.body = JSON.stringify(args);
    const resp = await fetch(tool.httpUrl, opts);
    const text = await resp.text();
    try { return JSON.parse(text); } catch { return { result: text }; }
  }

  _sendToSage(chunks, turn, transcript = '', transcriptLine = '', retries = 5) {
    const body = JSON.stringify({ audio: chunks, turn, transcript, transcriptLine });
    const req  = http.request(
      { host: 'localhost', port: this.cfg.sagePcPort || SAGE_PORT, path: '/audio', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
      () => this.emit({ type: 'log', text: `[Nova] Relayed to Sage (turn ${turn})` })
    );
    req.on('error', (e) => {
      if (retries > 0) {
        setTimeout(() => this._sendToSage(chunks, turn, transcript, transcriptLine, retries - 1), 1000);
      } else {
        this.emit({ type: 'error', message: '[Nova] Cannot reach Sage: ' + e.message });
      }
    });
    req.write(body); req.end();
  }

  _handleRequest(req, res) {
    if (req.method !== 'POST' || req.url !== '/audio') {
      res.statusCode = 404; res.end(); return;
    }
    let body = '';
    req.on('data', c => (body += c));
    req.on('end', () => {
      res.end('OK');
      if (this.stopped) return;

      let payload;
      try { payload = JSON.parse(body); }
      catch (e) { this.emit({ type: 'error', message: '[Nova] Bad JSON: ' + e.message }); return; }

      const { audio, turn, isEnd } = payload;

      // Store Sage's PCM turn
      const sagePcm = Buffer.concat(audio.map(b => Buffer.from(b, 'base64')));
      this.conversationPcm[turn] = sagePcm;
      // (no SSE audio emit — raw Buffers break JSON serialisation)

      if (isEnd) {
        this.emit({ type: 'log', text: '[Nova] Sage signalled END — waiting for Nova farewell…' });
        // Do NOT export yet — Nova's farewell turn is still being generated.
        // Feed Sage's final audio so Nova can give a natural farewell, then resolve
        if (!this.busy && this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.busy = true;
          for (const chunk of audio) this._send({ type: 'input_audio_buffer.append', audio: chunk });
          this._send({ type: 'input_audio_buffer.commit' });
          this._send({ type: 'response.create', response: { modalities: ['audio', 'text'] } });
          // Give Nova ~6 s to respond, then resolve regardless
          setTimeout(() => this._finishConversation(), 8000);
        } else {
          this._finishConversation();
        }
        return;
      }

      if (this.busy) {
        this.emit({ type: 'log', text: '[Nova] Still busy — dropping Sage audio.' });
        return;
      }
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        this.emit({ type: 'error', message: '[Nova] WS not open when Sage audio arrived.' });
        return;
      }

      this.emit({ type: 'status', speaker: 'nova', text: 'Nova is listening to Sage…' });
      this.busy = true;
      for (const chunk of audio) this._send({ type: 'input_audio_buffer.append', audio: chunk });
      this._send({ type: 'input_audio_buffer.commit' });
      this._send({ type: 'response.create', response: { modalities: ['audio', 'text'] } });
      this.emit({ type: 'status', speaker: 'nova', text: 'Nova is speaking…' });
    });
  }

  _exportConversation() {
    const keys = Object.keys(this.conversationPcm).map(Number).sort((a, b) => a - b);
    if (!keys.length) return null;
    const pcm  = Buffer.concat(keys.map(k => this.conversationPcm[k]));
    const file = path.join(this.outputDir, 'conversation.wav');
    fs.writeFileSync(file, buildWav(pcm));
    this.emit({ type: 'log', text: `[Nova] ✔ conversation.wav — ${keys.length} turns, ${(pcm.length / 1024).toFixed(1)} KB` });
    return file;
  }

  _finishConversation() {
    const wavPath        = path.join(this.outputDir, 'conversation.wav');
    const transcriptPath = path.join(this.outputDir, 'transcript.txt');
    // Always re-export now — Nova's farewell PCM will have been stored by _onResponseDone
    this._exportConversation();
    this.emit({ type: 'done', wavPath, transcriptPath });

    // Close WS immediately
    this.stopped = true;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.close();

    // Close HTTP server and wait for the port to actually be released
    // before resolving — prevents EADDRINUSE on the next simulation run.
    const resolve = this.resolveConversation;
    if (this.server) {
      const srv = this.server;
      this.server = null;
      if (typeof srv.closeAllConnections === 'function') srv.closeAllConnections();
      srv.close(() => { if (resolve) resolve(); });
    } else {
      if (resolve) resolve();
    }
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// Conversation — public API
// ══════════════════════════════════════════════════════════════════════════════
class Conversation {
  constructor() {
    this._nova = null;
    this._sage = null;
    this._running = false;
  }

  get isRunning() { return this._running; }

  /**
   * Start the conversation.
   * @param {(event:object)=>void} emit  Called for every event.
   * @param {object}               cfg   Resolved config from config.js.
   * @returns {Promise<void>}            Resolves when conversation ends.
   */
  async start(emit, cfg) {
    if (this._running) throw new Error('Already running');
    this._running = true;

    if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

    this._sage = new SageAgent(emit, cfg);
    this._nova = new NovaAgent(emit, cfg);
    this._sage.onDone = () => {}; // transcript already built inside SageAgent

    emit({ type: 'status', speaker: null, text: 'Starting…' });
    await this._sage.listen();
    try {
      await this._nova.start();
    } finally {
      // Always stop Sage's HTTP server so its port is freed before the next run.
      this._sage.stop();
      this._running = false;
    }
  }

  /** Gracefully abort a running conversation. */
  stop() {
    if (!this._running) return;
    if (this._nova) this._nova.stop();
    if (this._sage) this._sage.stop();
    this._running = false;
  }
}

module.exports = { Conversation };
