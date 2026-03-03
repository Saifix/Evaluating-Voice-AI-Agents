/**
 * server/config.js
 * Manages the persistent configuration stored in config.json.
 * Falls back to sensible defaults if the file doesn't exist.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(__dirname, '..', 'config.json');

const DEFAULTS = {
  // ── OpenAI credentials ────────────────────────────────────────────
  openaiApiKey: '',

  // ── Simulation runs ───────────────────────────────────────────────
  // How many parallel simulations to launch per Start click (1 – 5).
  simCount: 1,

  // ── Conversation length ───────────────────────────────────────────
  // Number of Sage replies before the conversation wraps up.
  // Nova always gets one extra farewell turn after Sage says goodbye.
  maxExchanges: 10,

  // ── Nova (GPT-4o Realtime) ────────────────────────────────────────
  novaModel: 'gpt-4o-realtime-preview',
  novaVoice: 'alloy',

  // ── Nova Tools (Realtime function calling) ────────────────────────
  // Each tool: { id, name, description, parameters (JSON schema string),
  //              execution: 'static'|'http',
  //              staticResponse (JSON string),
  //              httpMethod, httpUrl, httpHeaders (JSON string) }
  novaTools: [],

  // ── Scenarios ─────────────────────────────────────────────────────
  // Each scenario overrides Sage's instructions for one simulation run.
  // Shape: { id, name, sageInstructions }
  // Assign scenarios per-run on the Simulation page; blank = base config.
  scenarios: [],

  novaInstructions:
    'You are Nova, an AI-powered helpdesk agent for Joblogic Field Service Management. ' +
    'You handle inbound calls from clients and engineers reporting maintenance issues ' +
    'that need to be logged as service jobs in the system.\n\n' +
    'For every call, follow these steps in order:\n' +
    '1. Answer: "Joblogic helpdesk, this is Nova. How can I help you today?"\n' +
    '2. Listen to the initial issue description\n' +
    '3. Collect the caller\'s full name and contact number\n' +
    '4. Collect the site name and full address\n' +
    '5. Clarify the issue description if needed\n' +
    '6. Ask for priority: Emergency, High, Medium, or Low\n' +
    '7. Confirm all captured details back to the caller\n' +
    '8. Provide a job reference number (format: JL-XXXXX, e.g. JL-48291)\n' +
    '9. Close: "I have logged that for you. An engineer will be in touch. Thank you for calling Joblogic."\n\n' +
    'Rules:\n' +
    '- Ask ONE question at a time\n' +
    '- Keep responses to 1–3 short sentences — you are on a phone call\n' +
    '- Be professional, calm, and empathetic\n' +
    '- Do not move on until each piece of information is captured\n' +
    '- The call lasts around 10 exchanges; wrap up once all info is gathered',

  novaTopic:
    'A call is coming in from a customer. Answer the phone professionally as the Joblogic helpdesk agent and begin the job logging process.',

  // ── Sage — Simulated Human Caller (GPT-4.1 + Whisper-1 + TTS-1) ──────────
  sageVoice:  'echo',
  sageModel:  'gpt-4.1',
  ttsModel:   'tts-1',
  sttModel:   'whisper-1',

  // ── Evaluation model (used by both promptfoo provider and OpenAI fallback) ─
  evalModel: 'gpt-4.1',

  sageInstructions:
    'You are simulating a realistic human customer calling a helpdesk to report a ' +
    'maintenance issue. Do NOT break character or reveal you are an AI.\n\n' +
    'Your identity:\n' +
    '- Name: Alex Thompson\n' +
    '- Role: Facilities Manager\n' +
    '- Site: Meridian House, Unit 12, Trafford Park, Manchester, M17 1BE\n' +
    '- Contact: 07700 900 123\n\n' +
    'Issue to report: The main gas boiler has completely failed since 6am this morning. ' +
    'No heating or hot water. 40 staff affected. Cold winter day. Very urgent.\n\n' +
    'Behaviour:\n' +
    '- Act like a real, slightly stressed caller who needs this resolved quickly\n' +
    '- Do NOT volunteer all details upfront — give information when asked\n' +
    '- Respond in 1–3 short sentences as if speaking on the phone\n' +
    '- Show mild impatience if the agent is slow or repeats questions\n' +
    '- Once the agent gives a job reference number, thank them and end the call\n' +
    '- On your final reply ONLY (after hearing the reference), append exactly "<<END>>" at the end\n' +
    '- NEVER use "<<END>>" in any earlier reply\n' +
    '- After MAX_EXCHANGES exchanges force-end the conversation with <<END>>',

  // ── Evaluation criteria ───────────────────────────────────────────
  // Each criterion: { id, name, description, passMark (0-10) }
  criteria: [
    { id: 'greeting',  name: 'Professional Greeting',  passMark: 7, description: 'Did Nova answer the call professionally, introduce themselves or the company (Joblogic), and clearly offer to help the caller?' },
    { id: 'issue',     name: 'Issue Description',       passMark: 7, description: 'Did Nova successfully gather a clear and complete description of the maintenance issue being reported by the caller?' },
    { id: 'site',      name: 'Site & Location',         passMark: 7, description: 'Did Nova obtain the site name and/or address where the maintenance issue is occurring?' },
    { id: 'contact',   name: 'Contact Details',         passMark: 7, description: "Did Nova capture the caller's full name and contact phone number (or email) during the call?" },
    { id: 'priority',  name: 'Priority Assessment',     passMark: 7, description: 'Did Nova assess and confirm the urgency or priority level of the reported issue (Emergency / High / Medium / Low)?' },
    { id: 'confirm',   name: 'Details Confirmation',    passMark: 7, description: 'Did Nova read back or confirm all captured details (caller name, site, issue, priority) to the caller before closing?' },
    { id: 'reference', name: 'Job Reference',           passMark: 7, description: 'Did Nova confirm the job has been logged and provide a job reference number (format JL-XXXXX or similar) to the caller?' },
    { id: 'quality',   name: 'Overall Quality',         passMark: 7, description: "Evaluate the overall call quality: professionalism, tone, empathy, efficiency, and whether the caller's issue was fully resolved by end of call." },
  ],
};

function load() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      // Merge with defaults so new keys added later are always present
      return { ...DEFAULTS, ...raw };
    }
  } catch (e) {
    console.warn('[config] Could not read config.json:', e.message);
  }
  return { ...DEFAULTS };
}

function save(data) {
  // Never persist the API key to disk if it came from .env
  const toWrite = { ...data };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(toWrite, null, 2), 'utf8');
}

/** Return config, injecting the .env API key if the stored one is blank. */
function getResolved() {
  const cfg = load();
  if (!cfg.openaiApiKey) cfg.openaiApiKey = process.env.OPENAI_API_KEY || '';
  return cfg;
}

module.exports = { load, save, getResolved, DEFAULTS };
