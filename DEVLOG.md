# Development Log

**Live Demo:** https://sentiencebattleship-production.up.railway.app

## Tooling

This project is being built with the assistance of Claude Sonnet (Anthropic) via MCP (Model Context Protocol) servers. MCP enables the AI to interact directly with the local development environment — reading/writing files, running shell commands, and managing git — acting as a pair programming partner throughout the build.

## Progress

### Step 1 — Initial Scaffold

Set up the base project: Node.js + Express + Socket.IO backend serving a vanilla HTML/CSS/JS frontend. No build step, no framework overhead. SQLite via `better-sqlite3` for persistence.

### Step 2 — Core Game Logic (Server-Authoritative)

Implemented all game logic server-side to prevent cheating:

- Ship placement validation (bounds, overlaps)
- Shot processing with hit/miss/sunk detection
- Turn enforcement — server rejects out-of-turn shots
- Duplicate shot rejection
- Client never receives opponent ship positions

### Step 3 — AI Opponent

Added single-player mode with a hunt/target AI strategy:

- Hunt mode: randomly selects from unshot cells
- Target mode: after a hit, probes adjacent cells to finish sinking the ship
- Falls back to hunt mode when target queue is exhausted

### Step 4 — Real-Time Multiplayer

Implemented multiplayer via Socket.IO rooms:

- Shareable game links for inviting opponents
- Real-time shot updates across browser windows
- Room-based isolation so multiple games run concurrently

### Step 5 — Persistence & History

- Game state saved to SQLite — survives page refresh and server restart
- Session-based reconnection so players can reload without losing progress
- REST API (`GET /api/history`, `GET /api/history/:id`) for querying completed games

### Step 6 — Polish & Anti-Cheat Hardening

- Tightened input validation across all WebSocket events
- Added `.prettierrc` for consistent formatting
- Updated README with architecture docs, scalability notes, and anti-cheat design

### Step 7 — Modularization

Refactored monolithic `server.js` into separate modules:

- `src/db.js` — database init + prepared statements
- `src/game.js` — board/ship logic, shot processing, serialization
- `src/ai.js` — AI placement + hunt/target strategy
- `src/routes.js` — REST API endpoints
- `src/socketHandlers.js` — Socket.IO event handlers

Server.js is now a thin bootstrap (~18 lines) that wires everything together.

### Step 8 — Session Token Security

Added crypto-random session tokens to prevent socket impersonation:

- Token generated on game create and join, sent to client
- Client stores token in `sessionStorage`, sends it back on rejoin
- Server validates token before allowing reconnection
- Tokens persisted to SQLite so they survive server restarts

### Step 9 — Multiplayer Rejoin Bugfix

Fixed a bug where refreshing a multiplayer tab with a `?join=` URL param would re-emit `join-game` instead of `rejoin`, causing the server to reject with "Game is full". Session rejoin now takes priority over URL params.

## Security

### What's Protected

- **Server-authoritative logic:** All game state lives server-side. Clients never receive opponent ship positions.
- **Shot validation:** Server rejects duplicate shots, out-of-turn firing, and out-of-bounds coordinates.
- **Placement validation:** Server validates ship placement (no overlaps, within bounds) before accepting.
- **Session tokens:** Crypto-random tokens prevent socket impersonation and reconnect hijacking. A malicious client cannot rejoin as another player without their token.

### Remaining Vectors

- **Rate limiting:** No throttle on WebSocket events — rapid-fire requests are possible.
- **Timing side-channel:** Hit vs miss processing has slightly different code paths, theoretically leaking info over many observations.
- **Player accounts:** For competitive play, add proper auth (accounts + JWT/session cookies) instead of ephemeral tokens.

## Deployment

Deployed on **Railway** with auto-deploy from GitHub on push.

### Why Railway?

- Zero-config for Node.js — detects `package.json` and runs automatically
- Supports persistent volumes, which is critical for SQLite (the DB is a file on disk)
- Free tier is sufficient for a demo
- Deploy-on-push means every `git push` updates the live site with no manual steps

### Alternatives Considered

- **Render** — Free tier works for Node.js but has an ephemeral filesystem. SQLite data would be lost on every redeploy, which defeats the persistence feature.
- **Fly.io** — Supports persistent volumes and edge deployment, but requires more setup (Dockerfile or `fly.toml` config). Overkill for a demo.
- **Vercel** — Serverless-first, not a natural fit for a long-lived WebSocket server. Would require architectural changes.
- **EC2 / self-hosted** — Full control but unnecessary ops overhead for a hackathon project.

## Next Steps

- Redis adapter for Socket.IO (horizontal scaling)
- Graceful shutdown with connection draining
- Rate limiting on WebSocket events
- Player reconnection with grace period
- Health check / readiness endpoints
- Structured logging
