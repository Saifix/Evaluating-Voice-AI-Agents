/**
 * server/index.js
 *
 * Express server — supports sessions.  Each "Start" click creates a new
 * numbered session (Output/sessions/session_N/) containing all its runs.
 * Sessions persist so you can always go back and re-evaluate any past session.
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

const PORT        = process.env.SERVER_PORT || 4000;
const ROOT        = path.join(__dirname, '..');
const OUTPUT_DIR  = path.join(ROOT, 'Output');
const SESSIONS_DIR = path.join(OUTPUT_DIR, 'sessions');
const CLIENT_DIST = path.join(ROOT, 'client', 'dist');

const app = express();
app.use(cors());
app.use(express.json());

// ── SSE client registry ───────────────────────────────────────────────────────
const sseClients = new Set();

function broadcast(event) {
  if (event.type === 'audio') return;
  const line = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of sseClients) {
    try { res.write(line); } catch { sseClients.delete(res); }
  }
}

// ── Session helpers ───────────────────────────────────────────────────────────
function _nextSessionId() {
  if (!fs.existsSync(SESSIONS_DIR)) return 1;
  const nums = fs.readdirSync(SESSIONS_DIR)
    .filter(d => /^session_\d+$/.test(d))
    .map(d => parseInt(d.replace('session_', ''), 10));
  return nums.length ? Math.max(...nums) + 1 : 1;
}

function _listSessions() {
  if (!fs.existsSync(SESSIONS_DIR)) return [];
  return fs.readdirSync(SESSIONS_DIR)
    .filter(d => /^session_\d+$/.test(d))
    .map(d => {
      const n   = parseInt(d.replace('session_', ''), 10);
      const dir = path.join(SESSIONS_DIR, d);
      let meta  = { id: n, createdAt: null, runCount: 0, label: `Session ${n}` };
      try { meta = { ...meta, ...JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')) }; }
      catch { /* no meta yet */ }
      const runsDir = path.join(dir, 'runs');
      const runCount = fs.existsSync(runsDir)
        ? fs.readdirSync(runsDir).filter(r => /^run_\d+$/.test(r)).length
        : 0;
      return { ...meta, runCount };
    })
    .sort((a, b) => b.id - a.id); // newest first
}

// ── Multi-sim state ───────────────────────────────────────────────────────────
let activeConvos  = [];
let currentSession = null;
let simState       = { running: false, total: 0, completed: 0, sessionId: null };

function makeEmit(sessionId, runNum) {
  return function emit(event) {
    const tagged = { ...event, sessionId };
    if (simState.total > 1) tagged.runNum = runNum;
    if (tagged.type === 'log')        console.log(event.text);
    else if (tagged.type === 'error') console.error(`[run${runNum}][ERROR]`, event.message);
    else console.log(`[run${runNum}][${event.type}]`, JSON.stringify(event).slice(0, 100));
    broadcast(tagged);
  };
}

// ── Routes ────────────────────────────────────────────────────────────────────

app.get('/api/status', (_req, res) => res.json({ ...simState }));

app.post('/api/start', async (req, res) => {
  if (simState.running) {
    return res.status(409).json({ error: 'Already running' });
  }

  const cfg       = config.getResolved();
  const reqCount  = parseInt(req.body?.count) || cfg.simCount || 1;
  const count     = Math.min(20, Math.max(1, reqCount));
  const sessionId = _nextSessionId();

  // Create session directory
  const sessionDir = path.join(SESSIONS_DIR, `session_${sessionId}`);
  const runsBase   = path.join(sessionDir, 'runs');
  fs.mkdirSync(runsBase, { recursive: true });
  fs.writeFileSync(path.join(sessionDir, 'meta.json'), JSON.stringify({
    id:        sessionId,
    createdAt: new Date().toISOString(),
    runCount:  count,
    label:     `Session ${sessionId}`,
  }), 'utf8');

  currentSession = sessionId;
  simState       = { running: true, total: count, completed: 0, sessionId };
  activeConvos   = [];

  res.json({ ok: true, count, sessionId });
  broadcast({ type: 'started', total: count, sessionId });

  const promises = Array.from({ length: count }, (_, i) => {
    const runNum = i + 1;
    const runDir = path.join(runsBase, `run_${runNum}`);
    fs.mkdirSync(runDir, { recursive: true });

    const runCfg = {
      ...cfg,
      novaPcPort: 3010 + i * 2,
      sagePcPort: 3011 + i * 2,
      outputDir:  runDir,
      runNum,
    };

    const convo = new Conversation();
    activeConvos.push(convo);

    return convo.start(makeEmit(sessionId, runNum), runCfg).finally(() => {
      simState.completed++;
      broadcast({ type: 'sim_progress', completed: simState.completed, total: count, runNum, sessionId });
    });
  });

  Promise.all(promises)
    .then(() => {
      simState.running = false;
      activeConvos = [];
      broadcast({ type: 'done', total: count, sessionId });
    })
    .catch(err => {
      simState.running = false;
      activeConvos = [];
      broadcast({ type: 'error', message: err.message, sessionId });
    });
});

app.post('/api/stop', (req, res) => {
  if (!simState.running) {
    return res.status(409).json({ error: 'Not running' });
  }
  for (const convo of activeConvos) {
    try { convo.stop(); } catch { /* ignore */ }
  }
  simState.running = false;
  activeConvos = [];
  broadcast({ type: 'stopped' });
  res.json({ ok: true });
});

// SSE stream
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  res.write(`data: ${JSON.stringify({ type: 'connected', ...simState })}\n\n`);
  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
});

// List sessions
app.get('/api/sessions', (_req, res) => res.json({ sessions: _listSessions() }));

// List runs in a session (or legacy runs dir)
app.get('/api/runs', (req, res) => {
  const sessionId = parseInt(req.query.session) || null;
  const runsBase  = sessionId
    ? path.join(SESSIONS_DIR, `session_${sessionId}`, 'runs')
    : path.join(OUTPUT_DIR, 'runs');
  if (!fs.existsSync(runsBase)) return res.json({ runs: [] });
  const runs = fs.readdirSync(runsBase)
    .filter(d => /^run_\d+$/.test(d))
    .map(d => {
      const n   = parseInt(d.replace('run_', ''), 10);
      const dir = path.join(runsBase, d);
      return {
        num:        n,
        transcript: fs.existsSync(path.join(dir, 'transcript.txt')),
        audio:      fs.existsSync(path.join(dir, 'conversation.wav')),
      };
    })
    .sort((a, b) => a.num - b.num);
  res.json({ runs });
});

// GET /api/audio?session=N&run=M
app.get('/api/audio', (req, res) => {
  const sessionId = parseInt(req.query.session) || null;
  const runNum    = parseInt(req.query.run)     || null;
  const file = sessionId
    ? path.join(SESSIONS_DIR, `session_${sessionId}`, 'runs', `run_${runNum || 1}`, 'conversation.wav')
    : runNum
      ? path.join(OUTPUT_DIR, 'runs', `run_${runNum}`, 'conversation.wav')
      : path.join(OUTPUT_DIR, 'conversation.wav');
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'Audio not ready yet' });
  res.setHeader('Content-Type', 'audio/wav');
  res.setHeader('Content-Disposition', 'inline; filename="conversation.wav"');
  fs.createReadStream(file).pipe(res);
});

// GET /api/transcript?session=N&run=M
app.get('/api/transcript', (req, res) => {
  const sessionId = parseInt(req.query.session) || null;
  const runNum    = parseInt(req.query.run)     || null;
  const file = sessionId
    ? path.join(SESSIONS_DIR, `session_${sessionId}`, 'runs', `run_${runNum || 1}`, 'transcript.txt')
    : runNum
      ? path.join(OUTPUT_DIR, 'runs', `run_${runNum}`, 'transcript.txt')
      : path.join(OUTPUT_DIR, 'transcript.txt');
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'Transcript not ready yet' });
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  fs.createReadStream(file).pipe(res);
});

// GET /api/config
app.get('/api/config', (_req, res) => {
  const cfg = config.load();
  const masked = { ...cfg };
  if (masked.openaiApiKey) masked.openaiApiKey = masked.openaiApiKey.replace(/^(sk-[\w]{4}).*/, '$1............');
  res.json(masked);
});

// POST /api/config
app.post('/api/config', (req, res) => {
  config.save(req.body);
  res.json({ ok: true });
});

// GET /api/eval/results?session=N&run=M
app.get('/api/eval/results', (req, res) => {
  const sessionId = parseInt(req.query.session) || null;
  const runNum    = parseInt(req.query.run)     || null;
  const r = eval_.getResults(sessionId, runNum);
  if (!r) return res.status(404).json({ error: 'No evaluation results yet' });
  res.json(r);
});

// POST /api/eval/run?session=N&run=M
app.post('/api/eval/run', (req, res) => {
  const sessionId = parseInt(req.query.session) || null;
  const runNum    = parseInt(req.query.run)     || null;
  if (eval_.isRunningFor(sessionId, runNum))
    return res.status(409).json({ error: 'Evaluation already running for this run' });
  res.json({ ok: true, message: 'Evaluation started' });
  eval_.runEval(sessionId, runNum).catch(err => console.error('[eval]', err.message));
});

//  Serve React build (production) 
if (fs.existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST));
  app.get('/{*splat}', (_req, res) => res.sendFile(path.join(CLIENT_DIST, 'index.html')));
}

app.listen(PORT, () => {
  console.log(`\n  AI Conversation server running at http://localhost:${PORT}`);
  console.log(`   API: POST /api/start | POST /api/stop | GET /api/events\n`);
});
