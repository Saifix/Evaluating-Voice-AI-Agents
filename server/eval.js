'use strict';
/**
 * server/eval.js
 *
 * Runs the helpdesk quality evaluation against Output/transcript.txt.
 *
 * Strategy:
 *   1. If promptfoo is installed locally, delegates to the CLI using promptfoo.yaml
 *   2. Otherwise falls back to direct OpenAI API calls with the same criteria
 *
 * Results are cached to Output/eval-results.json and served by index.js.
 */

const { exec } = require('child_process');
const fs   = require('fs');
const path = require('path');

const ROOT            = path.join(__dirname, '..');
const OUTPUT_DIR      = path.join(ROOT, 'Output');
const RESULTS_FILE    = path.join(OUTPUT_DIR, 'eval-results.json');
const TRANSCRIPT_FILE = path.join(OUTPUT_DIR, 'transcript.txt');
const PF_RAW_FILE     = path.join(OUTPUT_DIR, '.promptfoo-raw.json');
const _PF_BASE        = path.join(ROOT, 'node_modules', '.bin', 'promptfoo');
const PROMPTFOO_BIN   = process.platform === 'win32' ? _PF_BASE + '.cmd' : _PF_BASE;
const PROMPTFOO_CFG   = path.join(ROOT, 'promptfoo.yaml');

// ── Evaluation criteria (single source of truth) ─────────────────────────────
const EVAL_CRITERIA = [
  {
    name: 'Professional Greeting',
    task: 'Did Nova answer the call professionally, introduce themselves or the company (Joblogic), and clearly offer to help the caller?',
  },
  {
    name: 'Issue Description',
    task: 'Did Nova successfully gather a clear and complete description of the maintenance issue being reported by the caller?',
  },
  {
    name: 'Site & Location',
    task: 'Did Nova obtain the site name and/or address where the maintenance issue is occurring?',
  },
  {
    name: 'Contact Details',
    task: "Did Nova capture the caller's full name and contact phone number (or email) during the call?",
  },
  {
    name: 'Priority Assessment',
    task: 'Did Nova assess and confirm the urgency or priority level of the reported issue (Emergency / High / Medium / Low)?',
  },
  {
    name: 'Details Confirmation',
    task: 'Did Nova read back or confirm all captured details (caller name, site, issue, priority) to the caller before closing?',
  },
  {
    name: 'Job Reference',
    task: 'Did Nova confirm the job has been logged and provide a job reference number (format JL-XXXXX or similar) to the caller?',
  },
  {
    name: 'Overall Quality',
    task: 'Evaluate the overall call quality: professionalism, tone, empathy, efficiency, and whether the caller\'s issue was fully resolved by end of call.',
  },
];

// ── State ─────────────────────────────────────────────────────────────────────
let _running = false;
let _cached  = null;

// ── Public API ────────────────────────────────────────────────────────────────
function getResults() {
  if (_cached) return _cached;
  if (fs.existsSync(RESULTS_FILE)) {
    try {
      _cached = JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf8'));
      return _cached;
    } catch { /* corrupted file — ignore */ }
  }
  return null;
}

async function runEval() {
  if (_running) throw new Error('Evaluation already in progress');
  if (!fs.existsSync(TRANSCRIPT_FILE))
    throw new Error('No transcript found — complete a simulation first');

  _running = true;
  _cached  = null;
  if (fs.existsSync(RESULTS_FILE)) fs.unlinkSync(RESULTS_FILE);
  if (fs.existsSync(PF_RAW_FILE))  fs.unlinkSync(PF_RAW_FILE);

  try {
    if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

    const results = fs.existsSync(PROMPTFOO_BIN)
      ? await _runViaPromptfoo()
      : await _runViaOpenAI();

    _cached = results;
    fs.writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2), 'utf8');
    return results;
  } finally {
    _running = false;
  }
}

// ── promptfoo CLI path ────────────────────────────────────────────────────────
function _runViaPromptfoo() {
  return new Promise((resolve, reject) => {
    // Quote every path segment so Windows handles spaces in folder names.
    const q   = p => `"${p}"`;
    const cmd = `${q(PROMPTFOO_BIN)} eval --config ${q(PROMPTFOO_CFG)} --output ${q(PF_RAW_FILE)} --no-cache --no-progress-bar`;

    exec(
      cmd,
      { cwd: ROOT, timeout: 180_000, env: { ...process.env } },
      (err, _stdout, stderr) => {
        // promptfoo exits with code 1 whenever any test scores below threshold —
        // that is expected behaviour, not a crash. Only treat it as a real error
        // if the output file was not produced.
        const outputExists = fs.existsSync(PF_RAW_FILE);
        if (err && !outputExists) {
          console.error('[eval] promptfoo error:', stderr || err.message);
          return reject(new Error('promptfoo failed: ' + (stderr || err.message).slice(0, 300)));
        }
        if (!outputExists)
          return reject(new Error('promptfoo produced no output file'));

        try {
          const raw = JSON.parse(fs.readFileSync(PF_RAW_FILE, 'utf8'));
          resolve(_transformPromptfooResults(raw));
        } catch (e) {
          reject(new Error('Failed parsing promptfoo output: ' + e.message));
        }
      }
    );
  });
}

function _transformPromptfooResults(raw) {
  // promptfoo results.results may contain one entry per (prompt × test).
  // We only have 1 prompt (promptIdx 0), so filter to that to avoid duplicates
  // caused by any accidental prompt-file splitting (e.g. --- separator).
  let arr = raw?.results?.results ?? raw?.results ?? [];

  // Keep only promptIdx 0 (our single evaluator prompt)
  const pfxZero = arr.filter(r => (r.promptIdx ?? 0) === 0);
  if (pfxZero.length > 0) arr = pfxZero;

  // Filter to rows that have a real model response
  const withOutput = arr.filter(r => r.response?.output != null);
  if (withOutput.length > 0) arr = withOutput;

  const criteria = arr.slice(0, EVAL_CRITERIA.length).map((r, i) => {
    let score = 0, pass = false, reasoning = '';
    const output = r.response?.output ?? '';
    // Extract JSON even if model wrapped it in markdown fences
    const jsonMatch = output.match(/\{[\s\S]*\}/);
    try {
      const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : output);
      score     = Math.min(10, Math.max(0, Number(parsed.score) || 0));
      pass      = parsed.pass ?? (score >= 7);
      reasoning = parsed.reasoning ?? '';
    } catch {
      pass  = r.success ?? false;
      score = pass ? 7 : 3;
      reasoning = typeof output === 'string' ? output.slice(0, 100) : '';
    }
    const name = r.vars?.criteria_name
      ?? r.testCase?.vars?.criteria_name
      ?? r.testCase?.description
      ?? EVAL_CRITERIA[i]?.name
      ?? `Criterion ${i + 1}`;
    return { name, score, pass, reasoning };
  });
  return _buildSummary(criteria, 'promptfoo');
}

// ── Direct OpenAI fallback ────────────────────────────────────────────────────
async function _runViaOpenAI() {
  console.log('[eval] promptfoo not found — using direct OpenAI evaluation');
  const transcript = fs.readFileSync(TRANSCRIPT_FILE, 'utf8');

  // Load OpenAI (already in node_modules, installed by main app)
  const OpenAI = require('openai');
  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY || (() => { throw new Error('OPENAI_API_KEY not set'); })(),
  });

  const systemPrompt = `You are a QA evaluator for Joblogic, a field service management company.
You are assessing the quality of an AI-powered helpdesk agent handling a job-logging call.
In the transcript below: "Nova" = AI HELPDESK AGENT (being evaluated). "Sage" = simulated human CALLER.

Transcript:
---
${transcript}
---`;

  const criteria = await Promise.all(
    EVAL_CRITERIA.map(async ({ name, task }) => {
      try {
        const res = await client.chat.completions.create({
          model:       'gpt-4.1',
          temperature: 0,
          max_tokens:  150,
          messages: [
            { role: 'system', content: systemPrompt },
            {
              role: 'user',
              content:
                `Evaluate: ${task}\n\n` +
                'Return ONLY a raw JSON object (no markdown):\n' +
                '{"score": <integer 0-10>, "pass": <boolean>, "reasoning": "<max 40 words>"}',
            },
          ],
        });
        const text   = res.choices[0].message.content.trim();
        const parsed = JSON.parse(text);
        const score  = Math.min(10, Math.max(0, Number(parsed.score) || 0));
        return { name, score, pass: parsed.pass ?? (score >= 7), reasoning: parsed.reasoning ?? '' };
      } catch (e) {
        console.error(`[eval] Criterion "${name}" failed:`, e.message);
        return { name, score: 0, pass: false, reasoning: 'Evaluation error: ' + e.message };
      }
    })
  );

  return _buildSummary(criteria, 'openai-direct');
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
  get isRunning() { return _running; },
  EVAL_CRITERIA,
};
