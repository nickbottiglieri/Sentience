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

### Step 10 — Sparse Data Structures for Scalable Board Size

Replaced dense O(n²) 2D arrays with sparse Maps for boards and shots. This makes the game scale to arbitrarily large boards without memory or performance degradation.

- Ship boards: `Map<"x,y", shipIndex>` instead of `Array[y][x]`
- Shot tracking: `Map<"x,y", "hit"|"miss">` instead of `Array[y][x]`
- AI hunt mode: pre-shuffled candidate pool with O(1) pop instead of O(n²) scan per turn
- AI placement: Set-based collision check instead of dense board allocation
- Serialization: only persists occupied/shot entries, not entire n² grid
- Client still receives dense arrays (converted server-side) — no frontend changes needed

### Step 11 — Disconnect Grace Period & Auto-Forfeit

Added a 45-second grace period for disconnected multiplayer players:

- On disconnect, opponent sees a warning that the player has 45s to reconnect
- If the player reconnects in time, the timer is cancelled and the opponent is notified
- If the timer expires, the disconnected player is auto-forfeited and the opponent wins
- Finished games are purged from memory every 5 minutes to prevent resource leaks
- AI games are excluded from grace period logic

### Spike — Redis Game State Layer

Added a Redis-backed game state store to decouple live game state from the single-process in-memory map, enabling horizontal scaling.

**`src/gameStore.js`** — New module providing a 3-tier game state lookup:
1. Redis (if `REDIS_URL` is set) — primary cache with 1-hour TTL
2. In-memory fallback — used when Redis is unavailable
3. SQLite — cold storage fallback for games not in cache

Ephemeral state (socket IDs, ready flags) is kept in a separate in-memory `socketMap` since it's per-process and shouldn't be serialized.

**`src/socketHandlers.js`** — Refactored all game state access through `gameStore` instead of a local `games` object:
- All handlers are now `async` to support Redis round-trips
- Finished games are evicted from the store via `gameStore.deleteGame()`
- Removed the 5-minute cleanup interval (Redis TTL handles expiry)
- Removed the exported `games` object (no longer needed)

**`server.js`** — Initializes the game store on startup and wires up `@socket.io/redis-adapter` for cross-process room broadcasts when Redis is available.

**Backward compatible:** Without `REDIS_URL`, the app falls back to in-memory storage and behaves identically to before.

### Step 12 — Unit Tests

Added Jest test suite (28 tests) covering the three core modules:

- **`game.js`** (15 tests) — placement validation, ship map construction, serialize/restore round-trip, processShot outcomes (hit/miss/sunk/win/duplicates/bounds), SQLite move recording
- **`gameStore.js`** (6 tests) — save/get round-trip, unknown game returns null, delete, ephemeral socket state persistence across calls, SQLite fallback, socket cleanup on delete
- **`ai.js`** (7 tests) — placement always valid and in-bounds, AI never fires same cell twice, stays in bounds, eventually sinks all ships, survives aiState serialization round-trip

Also fixed a bug in `restoreShotMap`/`restoreBoardMap` where the sparse Map format `[["0,0","hit"]]` was misidentified as a legacy dense 2D array, corrupting game state on restore. Removed the legacy dense format paths entirely — only sparse Maps are supported now.

## Bugs Found & Resolved

**1. Multiplayer refresh sends join instead of rejoin**
When player 2 refreshed a tab with a `?join=` URL param, the client re-emitted `join-game` instead of `rejoin`. The server rejected it as "Game is full" since both socket slots were still occupied. Fix: check sessionStorage for an existing session before checking URL params — rejoin takes priority over join.

**2. Stale dense data after sparse refactor**
After switching from dense 2D arrays to sparse Maps, old games stored in SQLite still had the dense format. Restoring them produced Maps with `null` keys, crashing `shotMapToArray`. Fix: added type guards in the conversion function and cleared the old database. Going forward, only sparse format is persisted.

**3. Forfeit race condition traps player in menu loop**
After forfeiting a game and clicking "Menu" on the win overlay, the return-to-game timer and button persisted, preventing new games from being created. Root cause: the server emitted `player-forfeited` to the room *before* the forfeiting socket left, so the client received its own forfeit event — which could fire after a new game was already created, showing a stale win overlay on top of it. Fix: server now calls `socket.leave()` before broadcasting the forfeit event, and the client ignores stale forfeit events. Also added a dedicated "Forfeit Game" button on the menu so players can abandon a game without starting a new one, and ensured the return timer and both menu buttons are properly cleaned up on forfeit/expiry.

**3. Back to menu doesn't release player slot**
When a player clicked "← Menu" mid-game, the client cleared sessionStorage but never notified the server. The server still held their stale socket in the game. If they later tried to rejoin, the server saw both slots as occupied and either rejected them or reset them to placement. Fix: client now emits `leave-game` before clearing local state, and the server releases the socket slot and removes them from the Socket.IO room.

## Customer Experience

- **Ship placement reset:** Reset button lets players clear all ships and start placement over without refreshing the page.
- **One-click invite sharing:** Copy button on the multiplayer link copies the URL to clipboard with visual "✅ Copied" feedback.
- **Ship placement preview:** Hovering over the board shows a ghost preview of where the ship will land, with red highlighting for invalid positions.
- **Keyboard shortcut:** Press R to rotate ships during placement — faster than clicking a button.
- **Auto-join from URL:** Opening a `?join=` link skips the menu and drops the player straight into the game.
- **Refresh resilience:** Players can reload the page mid-game without losing progress — sessionStorage + server-side state handles seamless reconnection.
- **Real-time feedback:** Hit/miss/sunk results appear instantly on both players' boards with emoji status messages (🔥 Hit, 🌊 Miss, 💥 Sunk).
- **Game history:** Players can review completed games with date, mode, winner, and move count.
- **Forfeit protection:** Starting a new game while one is active shows a confirmation warning. Players can forfeit or return to their existing game.
- **Return to game:** A persistent "↩ Return to Game" button appears on the menu when a game is in progress, making it easy to navigate back.
- **Opponent notification on forfeit:** When a player forfeits, their opponent immediately sees a win screen — no silent abandonment.
- **Disconnect handling:** Opponent is notified when a player disconnects, with a 45s grace period. If they don't return, auto-forfeit triggers and the remaining player wins.

## Runtime Complexity

Let `n` = board dimension, `s` = number of ships, `c` = total ship cells, `t` = shots taken so far.

| Operation | Before (dense) | After (sparse) |
|---|---|---|
| Board creation | O(n²) | O(c) |
| Shot lookup/write | O(1) | O(1) |
| Placement validation | O(c) | O(c) |
| processShot | O(s) for sunk check | O(s) for sunk check |
| AI hunt (per turn) | O(n²) scan | O(1) pop from pool |
| AI target mode | O(1) | O(1) |
| Serialization | O(n²) per board | O(c + t) |
| Memory per game | O(n²) | O(c + t) |

For a 10×10 board the difference is negligible. For a 10,000×10,000 board, dense representation would require ~400M array cells (~3.2GB) per game; sparse uses only the cells that matter.

## Security

### What's Protected

- **Server-authoritative logic:** All game state lives server-side. Clients never receive opponent ship positions.
- **Shot validation:** Server rejects duplicate shots, out-of-turn firing, and out-of-bounds coordinates.
- **Placement validation:** Server validates ship placement (no overlaps, within bounds) before accepting.
- **Session tokens:** Crypto-random tokens prevent socket impersonation and reconnect hijacking. A malicious client cannot rejoin as another player without their token.
- **Rate limiting:** Per-socket rate limiter (5 events/sec) using Socket.IO middleware. Exceeding the limit disconnects the socket. Prevents DoS via event flooding and DB/log pollution.
- **Disconnect grace period:** 45s reconnection window before auto-forfeit. Prevents players from silently abandoning games and stranding opponents.
- **Stale game cleanup:** Finished games are purged from memory every 5 minutes to prevent resource leaks.

### Remaining Vectors

- **Timing side-channel:** Hit vs miss processing has slightly different code paths, theoretically leaking info over many observations.
- **Player accounts:** For competitive play, add proper auth (accounts + JWT/session cookies) instead of ephemeral tokens.

### Why Ephemeral Tokens Over JWT/Accounts

The current crypto-random token is sufficient because the threat model is proving "I'm the same person who started this game" — not persistent identity across sessions. A 48-char hex token is cryptographically unguessable, and an attacker would need physical access or an XSS exploit to steal it from sessionStorage — JWT/cookies are equally vulnerable to both.

**When accounts would matter:**
- Leaderboards / ELO ratings (need to know *who* won across games)
- Friends list / matchmaking (persistent relationships)
- Abuse prevention (ban a player, not just a socket)
- Cross-device play (resume on a different browser)

**Tradeoff:** Accounts add complexity (password hashing, reset flows, registration UI, token expiry/refresh, user database to protect) without improving single-game security. The attack surface actually grows. Ephemeral tokens are the right fit for a casual play-and-forget model; proper auth becomes worthwhile only when features require persistent identity.

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

## Scaling

The game runs on a single Node.js process by default. Horizontal scaling (multiple server instances) is now supported via two mechanisms:

1. **Redis adapter for Socket.IO** — Bridges room broadcasts across instances via pub/sub, so a `io.to(gameId).emit()` on server A reaches sockets on server B. Enabled automatically when `REDIS_URL` is set.
2. **Redis game state store** — The `gameStore` module caches live game state in Redis with a 1-hour TTL, falling back to in-memory and then SQLite. Ephemeral per-process state (socket IDs, ready flags) is kept in a separate in-memory map.

Without `REDIS_URL`, the app falls back to in-memory storage and behaves as a single-process server. A single Railway instance will hit SQLite write throughput limits long before Socket.IO connection limits.

## Next Steps

- Graceful shutdown with connection draining
- Health check / readiness endpoints
- Structured logging
