# ⚓ Battleship

A real-time multiplayer Battleship game with AI opponent support.

**Live Demo:** https://sentiencebattleship-production.up.railway.app

## Quick Start

```bash
npm install
node server.js
```

Open `http://localhost:3000` in your browser.

## Game Modes

- **vs AI** — Single player against a hunt/target AI
- **Multiplayer** — Share a link with a friend, play in real-time across browser windows

## Architecture

- **Backend:** Node.js + Express + Socket.IO
- **Frontend:** Vanilla HTML/CSS/JS (no build step)
- **Storage:** Postgres for game history, Redis for live state
- **Deployment:** Railway with auto-deploy from GitHub

**Resource limits (Railway):** Postgres — 2 vCPU, 1 GB memory. Redis — 2 vCPU, 1 GB memory.

## Scaling Spike

Explored horizontal scaling for real-time Socket.IO across multiple Node.js instances coordinated through Redis.

- Postgres in the hot path was the bottleneck — batching writes to end-of-game gave a **5× capacity improvement** (200 → 1,000 concurrent games per instance)
- Verified with load tests: 2 instances handle **1,500 concurrent games** at p50=355ms with zero errors
- Redis handles distributed locking, live game state, and cross-process Socket.IO rooms
- Architecture scales horizontally — add instances with no code changes

See [SPIKE.md](SPIKE.md) for the full analysis: distributed locking, bottleneck diagnostics, load test data, and capacity planning.

---

See [DEVLOG.md](DEVLOG.md) for detailed design decisions, security analysis, runtime complexity, and development history.
