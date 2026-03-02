/**
 * server/index.js
 *
 * Express server — single entry point for the React frontend.
 *
 * REST endpoints:
 *   POST /api/start        — begin a conversation (idempotent if already running)
 *   POST /api/stop         — abort a running conversation
 *   GET  /api/events       — SSE stream of conversation events
 *   GET  /api/audio        — stream the finished conversation.wav
 *   GET  /api/transcript   — return transcript.txt as plain text
 *   GET  /api/status       — { running: bool }
 *
 * In production the built React app is served from ../client/dist.
 * In development the Vite dev server (port 5173) proxies /api here.
 */

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const express  = require('express');
const cors     = require('cors');
const fs       = require('fs');
const path     = require('path');
const { Conversation } = require('./conversation');
const config   = require('./config');
const eval_    = require('./eval');

const PORT       = process.env.SERVER_PORT || 4000;
const OUTPUT_DIR = path.join(__dirname, '..', 'Output');
const CLIENT_DIST = path.join(__dirname, '..', 'client', 'dist');

const app = express();
app.use(cors());
app.use(express.json());

// ── SSE client registry ────────────────────────────────────────────────────────
// Each  connected browser tab gets its own response stream.
const sseClients = new Set();

function broadcast(event) {
  // Never send raw Buffers over SSE — they corrupt the stream
  if (event.type === 'audio') return;
  const line = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of sseClients) {
    try { res.write(line); } catch { sseClients.delete(res); }
  }
}

// ── Conversation singleton ─────────────────────────────────────────────────────
let convo = null;

function emit(event) {
  // Log everything to the server console for debugging
  if (event.type === 'log')        console.log(event.text);
  else if (event.type === 'error') console.error('[ERROR]', event.message);
  else                             console.log(`[${event.type}]`, JSON.stringify(event).slice(0, 120));

  broadcast(event);
}

// ── Routes ─────────────────────────────────────────────────────────────────────

// GET /api/status
app.get('/api/status', (_req, res) => {
  res.json({ running: convo ? convo.isRunning : false });
});

// POST /api/start
app.post('/api/start', async (req, res) => {
  if (convo && convo.isRunning) {
    return res.status(409).json({ error: 'Already running' });
  }

  // Clean up Output dir for fresh run
  if (fs.existsSync(OUTPUT_DIR)) {
    for (const f of fs.readdirSync(OUTPUT_DIR))
      fs.unlinkSync(path.join(OUTPUT_DIR, f));
  } else {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  res.json({ ok: true });

  // Run conversation asynchronously — events stream via SSE
  convo = new Conversation();
  broadcast({ type: 'started' });

  const cfg = config.getResolved();
  convo.start(emit, cfg).catch(err => {
    emit({ type: 'error', message: err.message });
  });
});

// POST /api/stop
app.post('/api/stop', (req, res) => {
  if (!convo || !convo.isRunning) {
    return res.status(409).json({ error: 'Not running' });
  }
  convo.stop();
  broadcast({ type: 'stopped' });
  res.json({ ok: true });
});

// GET /api/events  — Server-Sent Events
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering if proxied
  res.flushHeaders();

  // Send current status immediately on connect
  res.write(`data: ${JSON.stringify({
    type: 'connected',
    running: convo ? convo.isRunning : false,
  })}\n\n`);

  sseClients.add(res);

  req.on('close', () => sseClients.delete(res));
});

// GET /api/audio  — serve conversation.wav
app.get('/api/audio', (req, res) => {
  const file = path.join(OUTPUT_DIR, 'conversation.wav');
  if (!fs.existsSync(file)) {
    return res.status(404).json({ error: 'Audio not ready yet' });
  }
  res.setHeader('Content-Type', 'audio/wav');
  res.setHeader('Content-Disposition', 'inline; filename="conversation.wav"');
  fs.createReadStream(file).pipe(res);
});

// GET /api/transcript  — serve transcript.txt
app.get('/api/transcript', (req, res) => {
  const file = path.join(OUTPUT_DIR, 'transcript.txt');
  if (!fs.existsSync(file)) {
    return res.status(404).json({ error: 'Transcript not ready yet' });
  }
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  fs.createReadStream(file).pipe(res);
});

// GET /api/config
app.get('/api/config', (_req, res) => {
  const cfg = config.load();
  const masked = { ...cfg };
  if (masked.openaiApiKey) masked.openaiApiKey = masked.openaiApiKey.replace(/^(sk-[\w]{4}).*/, '$1••••••••••••••••');
  res.json(masked);
});

// POST /api/config
app.post('/api/config', (req, res) => {
  config.save(req.body);
  res.json({ ok: true });
});

// GET /api/eval/results
app.get('/api/eval/results', (_req, res) => {
  const r = eval_.getResults();
  if (!r) return res.status(404).json({ error: 'No evaluation results yet' });
  res.json(r);
});

// POST /api/eval/run
app.post('/api/eval/run', (req, res) => {
  if (eval_.isRunning) return res.status(409).json({ error: 'Evaluation already running' });
  res.json({ ok: true, message: 'Evaluation started' });
  // Run async — results polled via GET /api/eval/results
  eval_.runEval().catch(err => {
    console.error('[eval]', err.message);
  });
});

// ── Serve React build (production) ────────────────────────────────────────────
if (fs.existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST));
  app.get('/{*splat}', (_req, res) => res.sendFile(path.join(CLIENT_DIST, 'index.html')));
}

// ── Start ──────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🎙  AI Conversation server running at http://localhost:${PORT}`);
  console.log(`   API: POST /api/start | POST /api/stop | GET /api/events\n`);
});
