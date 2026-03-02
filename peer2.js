// peer2.js — Sage (Skeptical Philosopher)
// Architecture: Whisper-1 (STT)  →  GPT-4.1 (chat LLM)  →  TTS-1 (speech)
//
// HOW TO RUN:
//   1. Start this first:  node peer2.js
//   2. Then start:        node peer1.js
//
// Sage naturally ends the conversation after MAX_EXCHANGES turns.
// Final exports written to ./Output/ only when the conversation ends:
//   • sage_combined.wav  — all Sage turns merged into one WAV
//   • transcript.txt     — interleaved Nova + Sage lines

require('dotenv').config();
const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const OpenAI = require('openai');

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ── Config ─────────────────────────────────────────────────────────────────────
const MY_PORT       = 3001;
const OTHER_PORT    = 3000;
const SAMPLE_RATE   = 24000;   // PCM 24 kHz — matches Nova's Realtime API output
const MAX_EXCHANGES = 10;      // number of Sage replies before ending
const OUTPUT_DIR    = path.join(__dirname, 'Output');

if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// ── Prompting ──────────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `\
You are Sage, a thoughtful, slightly sceptical AI philosopher having a live voice \
conversation with Nova, an enthusiastic AI scientist.

Rules:
- Every reply must be 2–3 sentences MAX. Speak naturally, as if talking aloud.
- Gently challenge Nova's optimism; keep the dialogue intellectually alive.
- After ${MAX_EXCHANGES} exchanges (your ${MAX_EXCHANGES}th reply), bring the conversation \
to a warm, definitive close — acknowledge one insight from the talk and say goodbye.
- On your ${MAX_EXCHANGES}th reply ONLY, append exactly "<<END>>" at the very end.
- NEVER include "<<END>>" in any earlier reply.`;

// ── State ──────────────────────────────────────────────────────────────────────
let busy              = false;
let exchangeCount     = 0;
const convHistory     = [];   // GPT-4.1 message history
const transcriptLines = [];   // interleaved transcript (Nova + Sage)

// ── Helpers ────────────────────────────────────────────────────────────────────
function buildWav(pcm) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);                    h.writeUInt32LE(36 + pcm.length, 4);
  h.write('WAVE', 8);                    h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);              h.writeUInt16LE(1,  20);   // PCM
  h.writeUInt16LE(1,  22);              h.writeUInt32LE(SAMPLE_RATE,     24);
  h.writeUInt32LE(SAMPLE_RATE * 2, 28); h.writeUInt16LE(2,  32);
  h.writeUInt16LE(16, 34);              h.write('data', 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

function exportFinalOutputs() {
  // Combined transcript sorted by turn number
  if (transcriptLines.length) {
    transcriptLines.sort((a, b) => {
      const n = s => parseInt((s.match(/\[Turn (\d+)\]/) || [0, 0])[1], 10);
      return n(a) - n(b);
    });
    fs.writeFileSync(
      path.join(OUTPUT_DIR, 'transcript.txt'),
      transcriptLines.join('\n\n') + '\n',
      'utf8'
    );
    console.log(`[Sage] ✔ transcript.txt saved (${transcriptLines.length} turns)`);
  }
}

// ── Core turn processor ────────────────────────────────────────────────────────
async function processTurn(audioChunks, novaTranscript, novaTranscriptLine) {
  // ① STT — use Nova's Realtime transcript if provided; otherwise run Whisper
  let novaText = novaTranscript || '';
  if (!novaText) {
    console.log('[Sage] No transcript from Nova — running Whisper STT…');
    const pcmBuf = Buffer.concat(audioChunks.map(b => Buffer.from(b, 'base64')));
    const tmp    = path.join(OUTPUT_DIR, '_tmp_nova_input.wav');
    fs.writeFileSync(tmp, buildWav(pcmBuf));
    const tx = await client.audio.transcriptions.create({
      file:  fs.createReadStream(tmp),
      model: 'whisper-1',
    });
    novaText = tx.text;
    fs.unlinkSync(tmp);
  }

  console.log(`[Sage] Nova said: "${novaText}"`);
  if (novaTranscriptLine) transcriptLines.push(novaTranscriptLine);

  exchangeCount++;
  convHistory.push({ role: 'user', content: novaText });

  // ② LLM — GPT-4.1
  const completion = await client.chat.completions.create({
    model: 'gpt-4.1',
    messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...convHistory],
    max_tokens: 150,
    temperature: 0.85,
  });

  let sageText = completion.choices[0].message.content.trim();
  const isEnd  = sageText.includes('<<END>>') || exchangeCount >= MAX_EXCHANGES;
  sageText     = sageText.replace('<<END>>', '').trim();

  console.log(`[Sage] [exchange ${exchangeCount}/${MAX_EXCHANGES}] Sage says: "${sageText}"`);
  convHistory.push({ role: 'assistant', content: sageText });
  transcriptLines.push(`[Turn ${exchangeCount * 2}] Sage: ${sageText}`);

  // ③ TTS — tts-1 with pcm output (24 kHz 16-bit mono, matches Nova's format)
  const speech = await client.audio.speech.create({
    model:           'tts-1',
    voice:           'echo',
    input:           sageText,
    response_format: 'pcm',
  });
  const ttsPcm = Buffer.from(await speech.arrayBuffer());
  // Chunk into ~8 KB base64 pieces
  const CHUNK_SIZE = 8192;
  const outChunks  = [];
  for (let i = 0; i < ttsPcm.length; i += CHUNK_SIZE)
    outChunks.push(ttsPcm.subarray(i, i + CHUNK_SIZE).toString('base64'));

  console.log(`[Sage] TTS generated ${ttsPcm.length} bytes PCM → ${outChunks.length} chunks`);

  if (isEnd) exportFinalOutputs();
  await sendAudioToNova(outChunks, exchangeCount, isEnd);
  busy = false;
}

// ── HTTP relay: SEND to Nova ───────────────────────────────────────────────────
function sendAudioToNova(chunks, turn, isEnd = false, retries = 5) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ audio: chunks, turn, isEnd });
    const req  = http.request(
      {
        host: 'localhost', port: OTHER_PORT, path: '/audio',
        method: 'POST',
        headers: {
          'Content-Type':   'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      () => {
        console.log(`[Sage] Audio sent to Nova (exchange ${turn}${isEnd ? ' — END' : ''})`);
        if (isEnd) {
          console.log('\n[Sage] Conversation complete. Shutting down in 2 s…\n');
          setTimeout(() => process.exit(0), 2000);
        }
        resolve();
      }
    );
    req.on('error', (e) => {
      if (retries > 0) {
        console.log(`[Sage] Nova unreachable — retrying… (${retries} left)`);
        setTimeout(() => sendAudioToNova(chunks, turn, isEnd, retries - 1).then(resolve), 1000);
      } else {
        console.error('[Sage] Failed to reach Nova:', e.message);
        resolve();
      }
    });
    req.write(body);
    req.end();
  });
}

// ── HTTP relay: RECEIVE from Nova ─────────────────────────────────────────────
const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/audio') {
    let body = '';
    req.on('data', c => (body += c));
    req.on('end', () => {
      res.end('OK');

      if (busy) {
        console.log('[Sage] Still processing — ignoring incoming audio.');
        return;
      }

      let payload;
      try { payload = JSON.parse(body); }
      catch (e) { console.error('[Sage] Bad JSON payload:', e.message); return; }

      const { audio, turn, transcript, transcriptLine } = payload;
      console.log(`\n[Sage] Received audio from Nova (turn ${turn}, ${audio.length} chunks)`);
      busy = true;

      processTurn(audio, transcript, transcriptLine).catch(e => {
        console.error('[Sage] processTurn error:', e.message, e.stack);
        busy = false;
      });
    });
    return;
  }
  res.statusCode = 404;
  res.end();
});

server.listen(MY_PORT, () => {
  console.log(`[Sage] Relay server on port ${MY_PORT}`);
  console.log('[Sage] Stack: Whisper-1 (STT) + GPT-4.1 (LLM) + TTS-1 (speech)');
  console.log('[Sage] Waiting for Nova to start the conversation…\n');
});
