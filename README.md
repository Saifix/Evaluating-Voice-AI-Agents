# AI Voice Evaluation Platform

A two-agent helpdesk call simulation and quality evaluation system. **Nova** (GPT-4o Realtime API) acts as an AI helpdesk agent that logs service jobs, while **Sage** (GPT-4.1 + Whisper + TTS) plays the role of a simulated human caller. Calls are recorded, transcribed, and scored by an automated [promptfoo](https://promptfoo.dev) evaluation suite across 8 quality criteria.

---

## Architecture

```
+-----------------------------------------------------------------+
|  React UI  (Vite - port 5173 in dev / served by Express in prod)|
|  Dashboard  Simulation  Evaluation  Settings                    |
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
+---------------------------+   +--------------------------------+
```

Each conversation turn:
1. Sage converts its text reply to speech (TTS-1) and POSTs PCM audio to Nova
2. Nova processes the audio via the Realtime API and responds
3. Nova's audio is relayed back to Sage, which transcribes it (Whisper-1)
4. The cycle repeats for `maxExchanges` turns

At the end, the session is saved to `Output/conversation.wav` and `Output/transcript.txt`.

---

## Prerequisites

- **Node.js** v18 or later - https://nodejs.org
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

This installs the server dependencies (`express`, `openai`, `ws`, `dotenv`, `cors`) plus `promptfoo` as a dev dependency.

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

Alternatively, enter the API key in the **Settings** page of the UI. It is stored in `config.json` and takes precedence over the `.env` value.

---

## Running

### Development (two terminals)

**Terminal 1 - Express API server:**
```bash
npm run server
# Listening on http://localhost:4000
```

**Terminal 2 - Vite React dev server:**
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

## Using the Platform

### Dashboard
Overview of the last simulation (turn count), latest evaluation score, and criteria pass rate. Quick-action buttons jump to Simulation or Evaluation.

### Simulation
- Click **Start Simulation** to begin a live call between Nova and Sage
- Watch the live transcript in real time (chat-bubble layout, agent right / caller left)
- Click **Stop** at any time to end early
- When complete, a **Call Recording** player appears for immediate playback
- A **Run Evaluation** button appears in the page header

### Evaluation
- Click **Run Evaluation** to score the last transcript with promptfoo
- Results show a score ring (0-10), pass/fail chips per criterion, and per-criterion cards with GPT-4.1 reasoning
- Engine badge shows whether results came from the promptfoo CLI or the OpenAI fallback

### Settings
Configure all agent and model parameters. Changes take effect on the next simulation run.

| Setting | Default | Description |
|---|---|---|
| `openaiApiKey` | *(from .env)* | OpenAI API key |
| `maxExchanges` | `10` | Number of Sage turns before the call wraps up |
| `novaVoice` | `alloy` | Realtime API voice for Nova |
| `novaInstructions` | helpdesk protocol | System prompt for Nova |
| `novaTopic` | incoming call prompt | Initial context given to Nova |
| `sageInstructions` | Alex Thompson scenario | Character instructions for Sage |
| `sageModel` | `gpt-4.1` | Chat model for Sage |
| `sageVoice` | `echo` | TTS voice for Sage |
| `ttsModel` | `tts-1` | TTS model for Sage |
| `sttModel` | `whisper-1` | STT model for Sage |

---

## Evaluation Criteria

Scored 0-10 by GPT-4.1. Pass threshold: **7 or above**.

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

The evaluator prompt is in `server/eval-prompt.txt` and the test suite in `promptfoo.yaml`.

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
|   |-- conversation.js   # NovaAgent + SageAgent orchestration
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
|           |-- ControlBar.jsx         # Start/Stop simulation
|           |-- TranscriptPanel.jsx    # Live chat-bubble transcript
|           |-- AudioPlayer.jsx        # Call recording playback
|           |-- EvalReport.jsx         # Promptfoo evaluation results
|           +-- SettingsPanel.jsx      # Agent/model configuration form
|
|-- Output/
|   |-- conversation.wav       # Combined call recording
|   |-- transcript.txt         # Plain-text turn-by-turn transcript
|   +-- eval-results.json      # Latest evaluation scores
|
|-- promptfoo.yaml    # 8-criterion evaluation test suite
|-- peer1.js          # Standalone Nova CLI (legacy)
|-- peer2.js          # Standalone Sage CLI (legacy)
|-- .env              # OPENAI_API_KEY
+-- package.json
```

---

## API Reference

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/start` | Start a simulation |
| `POST` | `/api/stop` | Stop the running simulation |
| `GET` | `/api/events` | SSE stream (`connected` / `started` / `transcript` / `done` / `error`) |
| `GET` | `/api/status` | Current simulation state |
| `GET` | `/api/audio` | Stream `Output/conversation.wav` |
| `GET` | `/api/transcript` | Serve `Output/transcript.txt` |
| `GET` | `/api/config` | Read current configuration |
| `POST` | `/api/config` | Update configuration |
| `POST` | `/api/eval/run` | Trigger a promptfoo evaluation run |
| `GET` | `/api/eval/results` | Fetch latest evaluation results JSON |

---

## Light / Dark Mode

The UI defaults to the system colour scheme (`prefers-color-scheme`). A toggle at the bottom of the sidebar switches between light and dark; the preference is persisted in `localStorage`.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `[Nova] Error: 401 Unauthorized` | Check `OPENAI_API_KEY` in `.env` or the Settings page |
| `[eval] promptfoo not found` | Run `npm install` in the project root |
| Evaluation scores all zero | Ensure a simulation has completed and `Output/transcript.txt` exists |
| Port 4000 already in use | Change the port in `server/index.js` and update `client/vite.config.js` proxy target |
| Old prompts showing after update | Delete `config.json` in the project root to reset to defaults |
| Audio not playing after simulation | Browser autoplay policy - click the audio player controls manually |