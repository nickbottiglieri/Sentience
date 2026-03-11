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
- **Storage:** SQLite via `better-sqlite3`
- **Deployment:** Railway with auto-deploy from GitHub

See [DEVLOG.md](DEVLOG.md) for detailed design decisions, security analysis, runtime complexity, and development history.
