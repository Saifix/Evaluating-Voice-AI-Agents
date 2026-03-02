# AI Voice Evaluation Platform

A two-agent helpdesk call simulation and quality evaluation system. **Nova** (GPT-4o Realtime API) acts as an AI helpdesk agent, while **Sage** (GPT-4.1 + Whisper + TTS) plays the role of a simulated human caller. Calls are recorded, transcribed, and scored by an automated evaluation suite across configurable quality criteria.

---

## Features

### Dashboard
- Summary stats: last simulation turn count, latest evaluation score (0–10), and criteria pass rate
- Agent status cards showing Nova and Sage model configuration at a glance
- Evaluation criteria overview grid (name, description, pass mark)
- Quick-action buttons to jump directly to Simulation or Evaluation

### Simulation
- Start a fully automated voice call between Nova and Sage with one click
- Live real-time transcript rendered as a chat-bubble layout (agent right / caller left)
- Stop the call at any time
- **Multi-simulation**: run N calls back-to-back (configurable count); progress indicator shows current/total
- **Session grouping**: each batch of runs is grouped into a numbered session (`session_N/run_M/`) so results are never overwritten
- Audio recording of each run saved to the session folder
- In-page call recording player appears immediately when a run completes
- "Run Evaluation" shortcut button appears in the header once a simulation finishes

### Evaluation
- Score any run against the configured quality criteria using GPT-4.1 as the judge
- **Session / run selector**: browse all past sessions and individual runs; "Latest" shortcut always shows the most recent
- **Evaluate All**: score every run in the current session simultaneously
- Score ring (0–10), pass/fail chips per criterion, per-criterion score bar, and GPT reasoning text
- Engine badge indicates whether results came from the **promptfoo CLI** or the **OpenAI Direct** fallback
- Results are persisted to `eval-results.json` inside each run folder

### API Tester
- Save and manage a list of named HTTP endpoints (persisted to `localStorage`)
- Choose method (GET / POST / PUT / PATCH / DELETE) and provide a JSON body
- Execute requests and inspect status code, latency, response size, and top-level response keys
- Colour-coded status chips (2xx green / 4xx amber / 5xx red)
- Response body rendered in a scrollable monospace panel

### Nova Tools
- Register function-calling tools that Nova can invoke during live calls via `session.update`
- **Three execution modes per tool:**
  - **Static** — return a fixed JSON value instantly (no computation, no network call); ideal for reference data like business hours or priority definitions
  - **HTTP** — call an external API endpoint with the tool arguments as the JSON request body and forward the result back to Nova
  - **Code** — run a small JavaScript function sandboxed on the server (Node.js `vm` module); supports `Math`, `Date`, `JSON`, `Number`, `String`, `Object`, `Array`, `parseInt`, `parseFloat`, `isNaN`, `isFinite`; no `require`, no network, no file system
- Per-tool validation: name format, JSON schema, URL presence, code syntax check
- Valid / error count chips in the toolbar; per-card error indicators
- **"How to use" modal** with three sample tools (one per mode), copy-to-clipboard, and "Add as tool" to pre-fill a new card from the sample
- Changes saved to `config.json` and applied on the next simulation start

### Settings
- Full configuration form with auto-save for criteria; manual Save for all other fields
- All changes take effect on the next simulation run

| Setting | Default | Description |
|---|---|---|
| `openaiApiKey` | *(from .env)* | OpenAI API key (overrides `.env`) |
| `maxExchanges` | `10` | Sage turns before the call ends |
| `novaModel` | `gpt-4o-realtime-preview` | Realtime model for Nova |
| `novaVoice` | `alloy` | Realtime API voice for Nova (11 options) |
| `novaInstructions` | helpdesk protocol | System prompt for Nova |
| `novaTopic` | incoming call prompt | Initial context given to Nova |
| `sageModel` | `gpt-4.1` | Chat model for Sage |
| `sageInstructions` | Alex Thompson scenario | Character instructions for Sage |
| `sageVoice` | `echo` | TTS voice for Sage (11 options) |
| `ttsModel` | `tts-1` | TTS model for Sage (`tts-1`, `tts-1-hd`, `gpt-4o-mini-tts`) |
| `sttModel` | `whisper-1` | STT model for Sage |
| `evalModel` | `gpt-4.1` | Model used to grade evaluation criteria |
| `criteria` | 8 helpdesk criteria | Fully editable list — name, description, pass mark (default 7/10) |
| `novaTools` | `[]` | Function-calling tools for Nova (managed in the Nova Tools tab) |

### UI & Accessibility
- Light / dark mode toggle (defaults to system `prefers-color-scheme`; preference persisted in `localStorage`)
- Sidebar navigation with active-state highlighting
- Real-time status updates via Server-Sent Events (SSE)

---

## Architecture

```
+-----------------------------------------------------------------+
|  React UI  (Vite - port 5173 dev / served by Express in prod)  |
|  Dashboard  Simulation  Evaluation  API Tester  Nova Tools  Settings |
+------------------------+----------------------------------------+
                         | REST + SSE (/api/*)
+-----------------------v-----------------------------------------+
|  Express Server  (port 4000)                                    |
|  server/index.js  config.js  conversation.js  eval.js          |
+--------+----------------------------------+---------------------+
         |                                  |
+--------v------------------+   +----------v---------------------+
|  Nova  (port 3010)        |   |  Sage  (port 3011)             |
|  GPT-4o Realtime WS       |<->|  GPT-4.1 chat                  |
|  Voice: alloy             |   |  Whisper-1 STT  /  TTS-1 TTS   |
|  Helpdesk agent           |   |  Simulated caller              |
|  Function-calling tools   |   |                                |
+---------------------------+   +--------------------------------+
```

Each conversation turn:
1. Sage converts its text reply to speech (TTS-1) and POSTs PCM audio to Nova
2. Nova processes the audio via the Realtime API and responds (invoking tools as needed)
3. Nova's audio is relayed back to Sage, which transcribes it (Whisper-1)
4. The cycle repeats for `maxExchanges` turns

Each run produces a WAV recording and a transcript saved under `Output/sessions/session_N/runs/run_M/`.

---

## Prerequisites

- **Node.js** v18 or later — https://nodejs.org
- **npm** v9 or later (bundled with Node.js)
- An **OpenAI API key** with access to:
  - `gpt-4o-realtime-preview` (Realtime API)
  - `gpt-4.1` (chat completions)
  - `whisper-1` (speech-to-text)
  - `tts-1` (text-to-speech)

---

## Setup

### 1. Install root dependencies

```bash
cd "Eval WebRTC"
npm install
```

### 2. Install client dependencies

```bash
cd client
npm install
cd ..
```

### 3. Configure environment

Create a `.env` file in the project root:

```env
OPENAI_API_KEY=sk-...
```

Alternatively, enter the key in **Settings** — it is stored in `config.json` and takes precedence over `.env`.

---

## Running

### Development (two terminals)

**Terminal 1 — Express API server:**
```bash
npm run server
# Listening on http://localhost:4000
```

**Terminal 2 — Vite React dev server:**
```bash
cd client
npm run dev
# UI at http://localhost:5173  (proxies /api/* to localhost:4000)
```

### Production (single process)

```bash
cd client && npm run build && cd ..
npm run server
# Serves built UI + API on http://localhost:4000
```

---

## Evaluation Criteria

Scored 0–10 by the configured `evalModel`. Pass threshold: **7 or above** (configurable per criterion).

The default 8 criteria cover a complete helpdesk call quality checklist:

| # | Criterion | What is assessed |
|---|---|---|
| 1 | Professional Greeting | Answered professionally, introduced the service, offered to help |
| 2 | Issue Description | Gathered a clear, complete description of the maintenance issue |
| 3 | Site & Location | Obtained the site name and/or address |
| 4 | Contact Details | Captured caller's full name and contact number or email |
| 5 | Priority Assessment | Confirmed urgency level (Emergency / High / Medium / Low) |
| 6 | Details Confirmation | Read back all captured details before closing |
| 7 | Job Reference | Provided a reference number to the caller |
| 8 | Overall Quality | Overall professionalism, empathy, efficiency, and resolution |

Criteria are fully editable in **Settings** — add, remove, rename, reword, or change pass marks without touching any code. The evaluator prompt template is in `server/eval-prompt.txt` and the promptfoo test suite in `promptfoo.yaml`.

Run the evaluation suite directly from the CLI:
```bash
npx promptfoo eval --config promptfoo.yaml
npx promptfoo view   # open results in browser
```

---

## Project Structure

```
Eval WebRTC/
|-- server/
|   |-- index.js          # Express server, SSE, REST API (:4000)
|   |-- conversation.js   # NovaAgent + SageAgent orchestration + tool execution
|   |-- config.js         # Persistent settings (config.json)
|   |-- eval.js           # Promptfoo + OpenAI evaluation engine
|   +-- eval-prompt.txt   # LLM evaluator prompt template
|
|-- client/
|   +-- src/
|       |-- App.jsx                    # Shell, routing, SSE, theme toggle
|       +-- components/
|           |-- Icon.jsx               # Inline SVG icon library
|           |-- Dashboard.jsx          # Overview stats + quick actions
|           |-- ControlBar.jsx         # Start/Stop simulation + multi-sim count
|           |-- TranscriptPanel.jsx    # Live chat-bubble transcript
|           |-- AudioPlayer.jsx        # Call recording playback
|           |-- EvalReport.jsx         # Session/run selector + evaluation results
|           |-- ApiTester.jsx          # HTTP endpoint tester
|           |-- NovaTools.jsx          # Nova function-calling tool editor
|           +-- SettingsPanel.jsx      # Agent/model/criteria configuration form
|
|-- Output/
|   +-- sessions/
|       +-- session_N/
|           +-- runs/
|               +-- run_M/
|                   |-- conversation.wav   # Per-run call recording
|                   |-- transcript.txt     # Per-run transcript
|                   +-- eval-results.json  # Per-run evaluation scores
|
|-- promptfoo.yaml    # Evaluation test suite
|-- .env              # OPENAI_API_KEY
+-- package.json
```

---

## API Reference

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/start` | Start a simulation (body: `{ count }` for multi-sim) |
| `POST` | `/api/stop` | Stop the running simulation |
| `GET` | `/api/events` | SSE stream (`connected` / `started` / `transcript` / `done` / `error`) |
| `GET` | `/api/status` | Current simulation state |
| `GET` | `/api/audio` | Stream the call recording WAV for a run |
| `GET` | `/api/transcript` | Serve the transcript for a run |
| `GET` | `/api/sessions` | List all sessions and their run counts |
| `GET` | `/api/sessions/:session/runs` | List runs within a session |
| `GET` | `/api/config` | Read current configuration |
| `POST` | `/api/config` | Update configuration (including `novaTools`) |
| `POST` | `/api/eval/run` | Trigger an evaluation run |
| `GET` | `/api/eval/results` | Fetch evaluation results JSON for a run |

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `[Nova] Error: 401 Unauthorized` | Check `OPENAI_API_KEY` in `.env` or the Settings page |
| `[eval] promptfoo not found` | Run `npm install` in the project root |
| Evaluation scores all zero | Ensure a simulation has completed and a transcript exists in the run folder |
| Port 4000 already in use | Change the port in `server/index.js` and update `client/vite.config.js` proxy target |
| Old prompts showing after update | Delete `config.json` in the project root to reset to defaults |
| Audio not playing after simulation | Browser autoplay policy — click the audio player controls manually |
| Nova tool not being called | Ensure the tool name matches `snake_case` and the description clearly explains when to call it |
| Code tool sandbox error | The `vm` sandbox has no `require`, `fetch`, or file system — use HTTP mode for network calls |
