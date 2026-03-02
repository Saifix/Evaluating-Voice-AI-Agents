# WebRTC Counter — Two Peers Incrementing a Number

Two Node.js processes connect directly via WebRTC and take turns incrementing a number, sending it back and forth over a data channel.

---

## Prerequisites

- **Node.js** v16 or later — https://nodejs.org
- **npm** (bundled with Node.js)
- Internet access for the STUN server (used during connection setup only)

Verify your install:

```bash
node --version
npm --version
```

---

## Setup

### 1. Clone / download the project

Place all files in the same folder, e.g. `Eval WebRTC/`.

### 2. Install dependencies

```bash
cd "Eval WebRTC"
npm install
```

This installs [`werift`](https://github.com/shinyoshiaki/werift-webrtc) — a pure TypeScript WebRTC implementation (no native compilation required).

---

## Running

Open **two separate terminals** in the project folder.

### Terminal 1 — start peer1 first

```bash
node peer1.js
```

Expected output:
```
[Peer1] Signaling server listening on http://localhost:3000
[Peer1] Waiting for peer2 to connect…
```

### Terminal 2 — start peer2 after peer1 is ready

```bash
node peer2.js
```

Expected output:
```
[Peer2] Fetching offer from peer1…
[Peer2] Answer sent — waiting for data channel…
[Peer2] Data channel received.
[Peer2] Data channel open!
[Peer2] Received: 1  →  sending: 2
[Peer2] Received: 3  →  sending: 4
...
```

Back in Terminal 1:
```
[Peer1] Answer received — connection establishing…
[Peer1] Data channel open! Sending: 1
[Peer1] Received: 2  →  sending: 3
[Peer1] Received: 4  →  sending: 5
...
```

Press `Ctrl+C` in either terminal to stop.

---

## How it works

```
peer1                           peer2
  |                               |
  |-- HTTP GET /offer ----------->|   peer2 fetches peer1's SDP offer
  |                               |
  |<-- HTTP POST /answer ---------|   peer2 sends its SDP answer back
  |                               |
  |====== WebRTC data channel ====|   direct P2P connection established
  |                               |
  |-- "1" -----------------------►|
  |◄---------------------- "2" ---|
  |-- "3" -----------------------►|
  ...
```

- **peer1** acts as both the WebRTC offerer and a minimal HTTP signaling server (port 3000).
- **peer2** uses plain `http` (no extra deps) to exchange SDP with peer1.
- Once connected, all traffic is direct peer-to-peer — the HTTP server is no longer used.
- A STUN server (`stun.l.google.com`) helps each peer discover its public IP during setup.

---

## Project structure

```
Eval WebRTC/
├── peer1.js        # Offerer + HTTP signaling server
├── peer2.js        # Answerer
├── package.json    # Dependencies
└── README.md
```

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `peer2` keeps printing "Peer1 not ready yet" | Make sure `peer1.js` is running first and shows the "listening" message |
| Port 3000 already in use | Change `SIGNALING_PORT` in `peer1.js` and `PEER1_PORT` in `peer2.js` to the same free port |
| Connection never opens | Check firewall / antivirus isn't blocking UDP; try on the same machine first |
| `Cannot find module 'werift'` | Run `npm install` again in the project folder |
