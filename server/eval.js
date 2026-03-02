'use strict';
/**
 * server/eval.js
 *
 * Runs the quality evaluation against a transcript file.
 *
 * Criteria are loaded from config.js (user-editable), falling back to
 * built-in defaults.  The promptfoo YAML is generated dynamically from
 * the active criteria so adding / removing / editing a criterion is
 * immediately reflected in the next eval run.
 *
 * Strategy:
 *   1. If promptfoo is installed locally, delegates to the CLI
 *   2. Otherwise falls back to direct parallel OpenAI API calls
 *
 * Results are keyed by run number (0 = no specific run / legacy path).
 */

const { exec } = require('child_process');
const fs   = require('fs');
const path = require('path');

const ROOT          = path.join(__dirname, '..');
const OUTPUT_DIR    = path.join(ROOT, 'Output');
const _PF_BASE      = path.join(ROOT, 'node_modules', '.bin', 'promptfoo');
const PROMPTFOO_BIN = process.platform === 'win32' ? _PF_BASE + '.cmd' : _PF_BASE;

// ── Default criteria (fallback when config has none) ──────────────────────────
const DEFAULT_CRITERIA = [
  { id: 'greeting',  name: 'Professional Greeting',  passMark: 7, description: 'Did Nova answer the call professionally, introduce themselves or the company (Joblogic), and clearly offer to help the caller?' },
  { id: 'issue',     name: 'Issue Description',       passMark: 7, description: 'Did Nova successfully gather a clear and complete description of the maintenance issue being reported by the caller?' },
  { id: 'site',      name: 'Site & Location',         passMark: 7, description: 'Did Nova obtain the site name and/or address where the maintenance issue is occurring?' },
  { id: 'contact',   name: 'Contact Details',         passMark: 7, description: "Did Nova capture the caller's full name and contact phone number (or email) during the call?" },
  { id: 'priority',  name: 'Priority Assessment',     passMark: 7, description: 'Did Nova assess and confirm the urgency or priority level of the reported issue (Emergency / High / Medium / Low)?' },
  { id: 'confirm',   name: 'Details Confirmation',    passMark: 7, description: 'Did Nova read back or confirm all captured details (caller name, site, issue, priority) to the caller before closing?' },
  { id: 'reference', name: 'Job Reference',           passMark: 7, description: 'Did Nova confirm the job has been logged and provide a job reference number (format JL-XXXXX or similar) to the caller?' },
  { id: 'quality',   name: 'Overall Quality',         passMark: 7, description: "Evaluate the overall call quality: professionalism, tone, empathy, efficiency, and whether the caller's issue was fully resolved by end of call." },
];

function _getCriteria() {
  try {
    const cfg = require('./config').load();
    if (Array.isArray(cfg.criteria) && cfg.criteria.length > 0) return cfg.criteria;
  } catch { /* ignore */ }
  return DEFAULT_CRITERIA;
}

function _getEvalModel() {
  try { return require('./config').load().evalModel || 'gpt-4.1'; }
  catch { return 'gpt-4.1'; }
}

// ── File path helpers ─────────────────────────────────────────────────────────
function _sessionDir(sessionId) {
  return path.join(OUTPUT_DIR, 'sessions', `session_${sessionId}`);
}

function _resultsFile(sessionId, runNum) {
  if (sessionId) {
    const sd = _sessionDir(sessionId);
    return runNum
      ? path.join(sd, `eval-results-run_${runNum}.json`)
      : path.join(sd, 'eval-results.json');
  }
  // Legacy fallback (no session)
  return runNum
    ? path.join(OUTPUT_DIR, `eval-results-run_${runNum}.json`)
    : path.join(OUTPUT_DIR, 'eval-results.json');
}

function _transcriptFile(sessionId, runNum) {
  if (sessionId) {
    return runNum
      ? path.join(_sessionDir(sessionId), 'runs', `run_${runNum}`, 'transcript.txt')
      : path.join(_sessionDir(sessionId), 'runs', 'run_1', 'transcript.txt');
  }
  // Legacy fallback
  return runNum
    ? path.join(OUTPUT_DIR, 'runs', `run_${runNum}`, 'transcript.txt')
    : path.join(OUTPUT_DIR, 'transcript.txt');
}

// ── State ─────────────────────────────────────────────────────────────────────
const _runningSet = new Set(); // set of cache keys currently being evaluated
let _cached  = {};             // keyed by "sessionId:runNum"

function _key(sessionId, runNum) { return `${sessionId || 0}:${runNum || 0}`; }

// ── Public API ────────────────────────────────────────────────────────────────
function getResults(sessionId, runNum) {
  const key = _key(sessionId, runNum);
  if (_cached[key]) return _cached[key];
  const f = _resultsFile(sessionId, runNum);
  if (fs.existsSync(f)) {
    try { _cached[key] = JSON.parse(fs.readFileSync(f, 'utf8')); return _cached[key]; }
    catch { /* corrupted file */ }
  }
  return null;
}

async function runEval(sessionId, runNum) {
  const key = _key(sessionId, runNum);
  if (_runningSet.has(key)) throw new Error('Evaluation already in progress for this run');

  const transcriptFile = _transcriptFile(sessionId, runNum);
  if (!fs.existsSync(transcriptFile))
    throw new Error('No transcript found — complete a simulation first');

  const criteria    = _getCriteria();
  const resultsFile = _resultsFile(sessionId, runNum);
  const workDir     = sessionId ? _sessionDir(sessionId) : OUTPUT_DIR;
  const suffix      = `s${sessionId || 0}r${runNum || 0}`;
  const pfRawFile   = path.join(workDir, `.promptfoo-raw-${suffix}.json`);
  const pfCfgFile   = path.join(workDir, `.promptfoo-cfg-${suffix}.yaml`);

  _runningSet.add(key);
  delete _cached[key];
  if (fs.existsSync(resultsFile)) fs.unlinkSync(resultsFile);
  if (fs.existsSync(pfRawFile))   fs.unlinkSync(pfRawFile);
  if (!fs.existsSync(workDir)) fs.mkdirSync(workDir, { recursive: true });

  try {
    const evalModel = _getEvalModel();
    // Generate YAML from the live criteria list then run
    fs.writeFileSync(pfCfgFile, _generatePromptfooYaml(criteria, transcriptFile, evalModel), 'utf8');

    const results = fs.existsSync(PROMPTFOO_BIN)
      ? await _runViaPromptfoo(pfCfgFile, pfRawFile, criteria)
      : await _runViaOpenAI(transcriptFile, criteria, evalModel);

    _cached[key] = results;
    fs.writeFileSync(resultsFile, JSON.stringify(results, null, 2), 'utf8');
    return results;
  } finally {
    _runningSet.delete(key);
  }
}

// ── Dynamic YAML generation ───────────────────────────────────────────────────
function _generatePromptfooYaml(criteria, transcriptFile, evalModel = 'gpt-4.1') {
  // Always use absolute paths for both the transcript and the prompt file.
  // promptfoo resolves `file://` paths relative to the YAML file's directory,
  // not cwd — so a root-relative path would resolve to the wrong location when
  // the YAML lives inside a session subdirectory (Output/sessions/session_N/).
  const absTranscript  = path.resolve(transcriptFile).replace(/\\/g, '/');
  const absPromptFile  = path.join(ROOT, 'server', 'eval-prompt.txt').replace(/\\/g, '/');

  const tests = criteria.map(c => {
    const name = (c.name        || '').replace(/"/g, "'");
    const desc = (c.description || '').replace(/\n/g, ' ').replace(/"/g, "'");
    const pm   = c.passMark ?? 7;
    return [
      `  - description: "${name}"`,
      `    vars:`,
      `      criteria_name: "${name}"`,
      `      task: >`,
      `        ${desc}`,
      `    assert:`,
      `      - type: is-json`,
      `      - type: javascript`,
      `        value: |`,
      `          const r = JSON.parse(output);`,
      `          return r.score >= ${pm} ? true : \`Score \${r.score}/10 \${r.reasoning}\`;`,
      '',
    ].join('\n');
  }).join('\n');

  return [
    `description: "AI Voice Evaluation Suite"`,
    ``,
    `providers:`,
    `  - id: openai:${evalModel}`,
    `    config:`,
    `      temperature: 0`,
    ``,
    `prompts:`,
    `  - "file://${absPromptFile}"`,
    ``,
    `defaultTest:`,
    `  vars:`,
    `    transcript: "file://${absTranscript}"`,
    `  options:`,
    `    provider: openai:${evalModel}`,
    ``,
    `tests:`,
    tests,
  ].join('\n');
}

// ── promptfoo CLI ─────────────────────────────────────────────────────────────
function _runViaPromptfoo(cfgFile, rawFile, criteria) {
  return new Promise((resolve, reject) => {
    const q   = p => `"${p}"`;
    const cmd = `${q(PROMPTFOO_BIN)} eval --config ${q(cfgFile)} --output ${q(rawFile)} --no-cache --no-progress-bar`;

    exec(cmd, { cwd: ROOT, timeout: 180_000, env: { ...process.env } }, (err, _stdout, stderr) => {
      const outputExists = fs.existsSync(rawFile);
      if (err && !outputExists) {
        console.error('[eval] promptfoo error:', stderr || err.message);
        return reject(new Error('promptfoo failed: ' + (stderr || err.message).slice(0, 300)));
      }
      if (!outputExists) return reject(new Error('promptfoo produced no output file'));
      try {
        const raw = JSON.parse(fs.readFileSync(rawFile, 'utf8'));
        resolve(_transformPromptfooResults(raw, criteria));
      } catch (e) {
        reject(new Error('Failed parsing promptfoo output: ' + e.message));
      }
    });
  });
}

function _transformPromptfooResults(raw, criteria) {
  let arr = raw?.results?.results ?? raw?.results ?? [];

  const pfxZero = arr.filter(r => (r.promptIdx ?? 0) === 0);
  if (pfxZero.length > 0) arr = pfxZero;

  const withOutput = arr.filter(r => r.response?.output != null);
  if (withOutput.length > 0) arr = withOutput;

  const results = arr.slice(0, criteria.length).map((r, i) => {
    let score = 0, pass = false, reasoning = '';
    const output = r.response?.output ?? '';
    const jsonMatch = output.match(/\{[\s\S]*\}/);
    try {
      const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : output);
      score     = Math.min(10, Math.max(0, Number(parsed.score) || 0));
      pass      = parsed.pass ?? (score >= (criteria[i]?.passMark ?? 7));
      reasoning = parsed.reasoning ?? '';
    } catch {
      pass      = r.success ?? false;
      score     = pass ? 7 : 3;
      reasoning = typeof output === 'string' ? output.slice(0, 100) : '';
    }
    const name = r.vars?.criteria_name
      ?? r.testCase?.vars?.criteria_name
      ?? criteria[i]?.name
      ?? `Criterion ${i + 1}`;
    return { name, score, pass, reasoning };
  });
  return _buildSummary(results, 'promptfoo');
}

// ── Direct OpenAI fallback ────────────────────────────────────────────────────
async function _runViaOpenAI(transcriptFile, criteria, evalModel = 'gpt-4.1') {
  console.log('[eval] promptfoo not found -- using direct OpenAI evaluation');
  const transcript = fs.readFileSync(transcriptFile, 'utf8');

  const OpenAI = require('openai');
  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY || (() => { throw new Error('OPENAI_API_KEY not set'); })(),
  });

  const systemPrompt = `You are a QA evaluator for an AI-powered helpdesk agent handling a job-logging call.\nIn the transcript: "Nova" = AI HELPDESK AGENT (being evaluated). "Sage" = simulated human CALLER.\n\nTranscript:\n---\n${transcript}\n---`;

  const results = await Promise.all(
    criteria.map(async ({ name, description, passMark = 7 }) => {
      try {
        const res = await client.chat.completions.create({
          model: evalModel, temperature: 0, max_tokens: 150,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `Evaluate: ${description}\n\nReturn ONLY a raw JSON object (no markdown):\n{"score": <integer 0-10>, "pass": <boolean>, "reasoning": "<max 40 words>"}` },
          ],
        });
        const text   = res.choices[0].message.content.trim();
        const parsed = JSON.parse(text);
        const score  = Math.min(10, Math.max(0, Number(parsed.score) || 0));
        return { name, score, pass: parsed.pass ?? (score >= passMark), reasoning: parsed.reasoning ?? '' };
      } catch (e) {
        console.error(`[eval] Criterion "${name}" failed:`, e.message);
        return { name, score: 0, pass: false, reasoning: 'Evaluation error: ' + e.message };
      }
    })
  );
  return _buildSummary(results, 'openai-direct');
}

// ── Shared helpers ────────────────────────────────────────────────────────────
function _buildSummary(criteria, engine) {
  const overallScore = criteria.length
    ? Math.round(criteria.reduce((s, c) => s + c.score, 0) / criteria.length * 10) / 10
    : 0;
  return {
    criteria,
    overallScore,
    passCount:  criteria.filter(c => c.pass).length,
    totalCount: criteria.length,
    engine,
    timestamp: new Date().toISOString(),
  };
}

module.exports = {
  runEval,
  getResults,
  get isRunning() { return _runningSet.size > 0; },
  isRunningFor(sessionId, runNum) { return _runningSet.has(_key(sessionId, runNum)); },
  DEFAULT_CRITERIA,
};