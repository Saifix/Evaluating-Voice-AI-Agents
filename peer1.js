// peer1.js — Nova (Optimistic Scientist)
// Uses OpenAI Realtime API via WebSocket
//
// HOW TO RUN:
//   1. Start peer2 first:  node peer2.js
//   2. Then start peer1:   node peer1.js
//
// Output (WAV + transcript) is saved to ./Output/

require('dotenv').config();
const http = require('http');
const fs   = require('fs');
const path = require('path');
const WebSocket = require('ws');

// ── Config ─────────────────────────────────────────────────────────────────────
const MY_PORT    = 3000;   // Nova's HTTP audio-relay port
const OTHER_PORT = 3001;   // Sage's HTTP audio-relay port
const MODEL      = 'gpt-4o-realtime-preview';
const VOICE      = 'alloy';
const SAMPLE_RATE = 24000;
const MAX_TURNS  = 20;     // total turns across both bots (10 each)
const OUTPUT_DIR = path.join(__dirname, 'Output');

if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const INSTRUCTIONS =
  'You are Nova, an enthusiastic optimistic AI scientist. ' +
  'You are having a real-time voice conversation with Sage, a slightly sceptical AI philosopher. ' +
  'Keep every spoken reply very short — 2 to 3 sentences max — as if speaking aloud. ' +
  'End each reply with a thought-provoking question or challenge to keep the dialogue alive. ' +
  'The conversation will last about 10 exchanges. When Sage says goodbye, respond warmly and conclude.';

// ── State ──────────────────────────────────────────────────────────────────────
let myTurnCount    = 0;
let audioDeltaBufs = [];    // base64 PCM16 chunks from current response
let currentXcript  = '';    // transcript of current response
let busy           = false; // true while waiting for OpenAI response
let sessionReady   = false;
const conversationPcm = {};   // { globalTurnNum: Buffer } — both speakers, merged at end
const novaTransLines  = [];   // Nova's transcript lines (sent to Sage for combined transcript)

// ── WAV / export helpers ───────────────────────────────────────────────────────
function buildWav(pcm) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);                    h.writeUInt32LE(36 + pcm.length, 4);
  h.write('WAVE', 8);                    h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1,  20);              // PCM format
  h.writeUInt16LE(1,  22);              // mono
  h.writeUInt32LE(SAMPLE_RATE, 24);
  h.writeUInt32LE(SAMPLE_RATE * 2, 28); h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);              h.write('data', 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

function exportConversation() {
  const keys = Object.keys(conversationPcm).map(Number).sort((a, b) => a - b);
  if (!keys.length) return;
  const pcm = Buffer.concat(keys.map(k => conversationPcm[k]));
  fs.writeFileSync(path.join(OUTPUT_DIR, 'conversation.wav'), buildWav(pcm));
  console.log(`[Nova] ✔ conversation.wav saved — ${keys.length} turns, ${(pcm.length / 1024).toFixed(1)} KB PCM`);
  console.log(`[Nova] Turn order: ${keys.join(', ')}`);
}

// ── OpenAI Realtime WebSocket ──────────────────────────────────────────────────
const ws = new WebSocket(
  `wss://api.openai.com/v1/realtime?model=${MODEL}`,
  {
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'OpenAI-Beta': 'realtime=v1',
    },
  }
);

function send(obj) {
  ws.send(JSON.stringify(obj));
}

ws.on('open', () => {
  console.log('[Nova] Connected to OpenAI Realtime API');
  send({
    type: 'session.update',
    session: {
      modalities: ['text', 'audio'],
      instructions: INSTRUCTIONS,
      voice: VOICE,
      input_audio_format: 'pcm16',
      output_audio_format: 'pcm16',
      input_audio_transcription: { model: 'whisper-1' },
      turn_detection: null,   // manual — we control when to commit & respond
    },
  });
});

ws.on('message', (raw) => {
  let event;
  try { event = JSON.parse(raw.toString()); }
  catch { return; }

  switch (event.type) {
    // ── session ready ──────────────────────────────────────────────────────────
    case 'session.updated':
      if (!sessionReady) {
        sessionReady = true;
        console.log('[Nova] Session configured. Starting conversation…\n');
        // Kick off with a text prompt — Nova speaks first
        busy = true;
        send({
          type: 'conversation.item.create',
          item: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'Start a fascinating philosophical or scientific conversation with Sage. Speak naturally — your voice will be heard.' }],
          },
        });
        send({ type: 'response.create' });
      }
      break;

    // ── audio chunks ──────────────────────────────────────────────────────────
    case 'response.audio.delta':
    case 'response.output_audio.delta':
      if (event.delta) audioDeltaBufs.push(event.delta);
      break;

    // ── transcript ────────────────────────────────────────────────────────────
    case 'response.audio_transcript.done':
    case 'response.output_audio_transcript.done':
      currentXcript = event.transcript || currentXcript;
      break;

    // ── response finished ─────────────────────────────────────────────────────
    case 'response.done':
      console.log(`[Nova] response.done — busy=${busy}, audioChunks=${audioDeltaBufs.length}`);
      if (!busy) break;
      if (audioDeltaBufs.length === 0) {
        console.log('[Nova] response.done with no audio — resetting and skipping turn.');
        busy = false;
        break;
      }

      busy = false;
      myTurnCount++;

      // Collect & reset state
      const chunks   = audioDeltaBufs.splice(0);
      const xcript   = currentXcript;
      currentXcript  = '';
      const turnNum  = myTurnCount;

      // Store Nova's PCM keyed by global turn for combined export
      const rawPcm = Buffer.concat(chunks.map(b => Buffer.from(b, 'base64')));
      const globalTurn    = turnNum * 2 - 1;
      conversationPcm[globalTurn] = rawPcm;
      const logLine       = `[Turn ${globalTurn}] Nova: ${xcript || '(no transcript)'}`;
      novaTransLines.push(logLine);
      console.log(`\n${logLine}\n`);

      // Relay audio + transcript to Sage
      setTimeout(() => sendAudioToSage(chunks, globalTurn, xcript, logLine), 300);
      break;

    // ── errors ────────────────────────────────────────────────────────────────
    case 'error':
      console.error('[Nova] API error:', JSON.stringify(event.error));
      busy = false;
      break;
  }
});

ws.on('error', err  => console.error('[Nova] WS error:', err.message));
ws.on('close', ()   => console.log('[Nova] WebSocket closed.'));

// ── HTTP relay: SEND audio to Sage ────────────────────────────────────────────
function sendAudioToSage(chunks, turn, transcript = '', transcriptLine = '', retries = 5) {
  const body = JSON.stringify({ audio: chunks, turn, transcript, transcriptLine });
  const req  = http.request(
    {
      host: 'localhost', port: OTHER_PORT, path: '/audio',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    },
    (res) => console.log(`[Nova] Audio relayed to Sage (turn ${turn}, ${chunks.length} chunks)`)
  );
  req.on('error', (e) => {
    if (retries > 0) {
      console.log(`[Nova] Sage not reachable, retrying... (${retries} left)`);
      setTimeout(() => sendAudioToSage(chunks, turn, transcript, transcriptLine, retries - 1), 1000);
    } else {
      console.error('[Nova] Failed to reach Sage:', e.message);
    }
  });
  req.write(body);
  req.end();
}

// ── HTTP relay: RECEIVE audio from Sage ───────────────────────────────────────
const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/audio') {
    let body = '';
    req.on('data', c => (body += c));
    req.on('end', () => {
      res.end('OK');

      let payload;
      try { payload = JSON.parse(body); }
      catch (e) { console.error('[Nova] Failed to parse audio payload:', e.message); return; }

      const { audio, turn, isEnd } = payload;

      // Always store Sage's PCM by turn so it ends up in the combined file
      const sagePcm = Buffer.concat(audio.map(b => Buffer.from(b, 'base64')));
      conversationPcm[turn] = sagePcm;

      // Sage signals end of conversation — export combined audio then exit
      if (isEnd) {
        console.log('\n[Nova] Sage signalled END. Exporting combined conversation audio…\n');
        exportConversation();
        // Feed Sage's closing audio into Realtime so Nova can give a natural farewell
        if (!busy && ws && ws.readyState === WebSocket.OPEN) {
          busy = true;
          try {
            for (const chunk of audio) send({ type: 'input_audio_buffer.append', audio: chunk });
            send({ type: 'input_audio_buffer.commit' });
            send({ type: 'response.create', response: { modalities: ['audio', 'text'] } });
          } catch (e) { /* ignore */ }
        }
        setTimeout(() => { ws.close(); process.exit(0); }, 8000);
        return;
      }

      if (busy) {
        console.log('[Nova] Got audio from Sage but still busy — ignoring.');
        return;
      }

      if (!ws || ws.readyState !== WebSocket.OPEN) {
        console.log('[Nova] WS not open, cannot process audio.');
        return;
      }

      console.log(`\n[Nova] Received audio from Sage (turn ${turn}, ${audio.length} chunks), generating reply…\n`);
      busy = true;

      try {
        for (const chunk of audio) send({ type: 'input_audio_buffer.append', audio: chunk });
        send({ type: 'input_audio_buffer.commit' });
        send({ type: 'response.create', response: { modalities: ['audio', 'text'] } });
      } catch (e) {
        console.error('[Nova] Error feeding audio to OpenAI:', e.message);
        busy = false;
      }
    });
    return;
  }
  res.statusCode = 404;
  res.end();
});

server.listen(MY_PORT, () => {
  console.log(`[Nova] HTTP relay server listening on port ${MY_PORT}`);
  console.log('[Nova] Connecting to OpenAI Realtime API…\n');
});
