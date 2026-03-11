# Battleship

A real-time multiplayer Battleship game with AI opponent support.

## Quick Start

```bash
npm install
node server.js
```

Open `http://localhost:3000` in your browser.

## Architecture

- **Backend:** Node.js + Express + Socket.IO
- **Frontend:** Vanilla HTML/CSS/JS (no build step)
- **Storage:** SQLite via `better-sqlite3`

## Game Modes

- **vs AI** — Single player against a hunt/target AI
- **Multiplayer** — Share a link with a friend, play in real-time across browser windows

## Persistence

- Game state survives page refresh (sessionStorage + server-side SQLite)
- Completed game history stored in SQLite, queryable via REST API:
  - `GET /api/history` — list completed games
  - `GET /api/history/:id` — get moves for a specific game

### Why SQLite?

Zero-config, embedded, single-file database. Perfect for a hackathon — no external services to set up, survives server restarts, supports SQL queries for game history analysis. For production scale, swap to Postgres with minimal code changes.

## Anti-Cheat Design

1. **Server-authoritative:** All game logic runs server-side. The client never receives opponent ship positions.
2. **Shot validation:** Server rejects duplicate shots, out-of-turn firing, and out-of-bounds coordinates.
3. **Placement validation:** Server validates ship placement (no overlaps, within bounds) before accepting.
4. **No client trust:** Hit/miss results computed server-side from the authoritative board state.

Remaining vectors to consider:
- Rate limiting (rapid-fire requests)
- WebSocket message authentication (currently relies on socket session)
- For competitive play: add player accounts + auth tokens

## Scalability Considerations

The game is O(1) per shot (direct array lookup) and O(n) for placement validation where n = total ship cells. For a huge board:

- Board storage: O(n²) where n = board dimension — use sparse representation (hash map of occupied cells) instead of 2D array for very large boards
- AI hunt mode: O(n²) candidate list — use a pre-shuffled index array for O(1) random selection
- Shot tracking: Already O(1) with array indexing; sparse map for huge boards
- Multiplayer: Socket.IO rooms scale horizontally with Redis adapter

## Deployment

Set `PORT` env var and run `node server.js`. Works on any Node.js host (Railway, Render, Fly.io, EC2, etc).
