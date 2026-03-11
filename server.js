const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const Database = require('better-sqlite3');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// --- Database ---
const db = new Database(path.join(__dirname, 'battleship.db'));
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS games (
    id TEXT PRIMARY KEY,
    mode TEXT,
    state TEXT,
    winner TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    finished_at TEXT
  );
  CREATE TABLE IF NOT EXISTS moves (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id TEXT,
    player TEXT,
    x INTEGER,
    y INTEGER,
    result TEXT,
    turn_number INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(game_id) REFERENCES games(id)
  );
`);

const stmts = {
  createGame: db.prepare(
    'INSERT INTO games (id, mode, state) VALUES (?, ?, ?)'
  ),
  updateGame: db.prepare(
    "UPDATE games SET state = ?, winner = ?, finished_at = datetime('now') WHERE id = ?"
  ),
  saveState: db.prepare('UPDATE games SET state = ? WHERE id = ?'),
  getGame: db.prepare('SELECT * FROM games WHERE id = ?'),
  insertMove: db.prepare(
    'INSERT INTO moves (game_id, player, x, y, result, turn_number) VALUES (?, ?, ?, ?, ?, ?)'
  ),
  getHistory: db.prepare(
    'SELECT g.id, g.mode, g.winner, g.created_at, g.finished_at, COUNT(m.id) as total_moves FROM games g LEFT JOIN moves m ON g.id = m.game_id WHERE g.winner IS NOT NULL GROUP BY g.id ORDER BY g.finished_at DESC LIMIT 50'
  ),
  getGameMoves: db.prepare(
    'SELECT player, x, y, result, turn_number, created_at FROM moves WHERE game_id = ? ORDER BY turn_number'
  ),
};

// --- Game State ---
const SHIPS = [
  { name: 'Carrier', size: 5 },
  { name: 'Battleship', size: 4 },
  { name: 'Cruiser', size: 3 },
  { name: 'Submarine', size: 3 },
  { name: 'Destroyer', size: 2 },
];
const BOARD_SIZE = 10;

// In-memory active games (keyed by game id)
const games = {};

function createBoard() {
  return Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(null));
}

function validatePlacement(ships) {
  if (!Array.isArray(ships) || ships.length !== SHIPS.length) return false;
  const board = createBoard();
  for (let i = 0; i < ships.length; i++) {
    const { x, y, horizontal } = ships[i];
    const size = SHIPS[i].size;
    for (let j = 0; j < size; j++) {
      const cx = horizontal ? x + j : x;
      const cy = horizontal ? y : y + j;
      if (cx < 0 || cx >= BOARD_SIZE || cy < 0 || cy >= BOARD_SIZE)
        return false;
      if (board[cy][cx] !== null) return false;
      board[cy][cx] = i;
    }
  }
  return true;
}

function buildShipBoard(ships) {
  const board = createBoard();
  ships.forEach((ship, i) => {
    const size = SHIPS[i].size;
    for (let j = 0; j < size; j++) {
      const cx = ship.horizontal ? ship.x + j : ship.x;
      const cy = ship.horizontal ? ship.y : ship.y + j;
      board[cy][cx] = i;
    }
  });
  return board;
}

function processShot(game, player, x, y) {
  const opponent = player === 'p1' ? 'p2' : 'p1';
  const opBoard = game.boards[opponent];
  const shotBoard = game.shots[player];

  if (x < 0 || x >= BOARD_SIZE || y < 0 || y >= BOARD_SIZE)
    return { error: 'Out of bounds' };
  if (shotBoard[y][x] !== null) return { error: 'Already fired there' };

  const cell = opBoard[y][x];
  let result,
    sunk = null;

  if (cell !== null) {
    shotBoard[y][x] = 'hit';
    result = 'hit';
    game.hits[player][cell] = (game.hits[player][cell] || 0) + 1;
    if (game.hits[player][cell] === SHIPS[cell].size) {
      sunk = SHIPS[cell].name;
    }
  } else {
    shotBoard[y][x] = 'miss';
    result = 'miss';
  }

  game.turnCount++;
  stmts.insertMove.run(
    game.id,
    player,
    x,
    y,
    sunk ? `sunk:${sunk}` : result,
    game.turnCount
  );

  const allSunk = SHIPS.every((s, i) => game.hits[player][i] === s.size);
  if (allSunk) {
    game.winner = player;
    game.phase = 'finished';
    stmts.updateGame.run(JSON.stringify(serializeGame(game)), player, game.id);
  } else {
    game.turn = opponent;
    stmts.saveState.run(JSON.stringify(serializeGame(game)), game.id);
  }

  return { result, sunk, winner: game.winner || null };
}

function serializeGame(game) {
  return {
    phase: game.phase,
    turn: game.turn,
    ships: game.ships,
    boards: game.boards,
    shots: game.shots,
    hits: game.hits,
    turnCount: game.turnCount,
    winner: game.winner,
    aiState: game.aiState || null,
    mode: game.mode,
  };
}

function restoreGame(row) {
  const state = JSON.parse(row.state);
  return {
    id: row.id,
    mode: row.mode || state.mode,
    phase: state.phase,
    turn: state.turn,
    ships: state.ships,
    boards: state.boards,
    shots: state.shots,
    hits: state.hits,
    turnCount: state.turnCount || 0,
    winner: state.winner,
    aiState: state.aiState || null,
    sockets: {},
    ready: {},
  };
}

// --- AI Logic (Hunt/Target) ---
function aiPlaceShips() {
  const ships = [];
  const board = createBoard();
  for (let i = 0; i < SHIPS.length; i++) {
    let placed = false;
    while (!placed) {
      const horizontal = Math.random() < 0.5;
      const x = Math.floor(
        Math.random() *
          (horizontal ? BOARD_SIZE - SHIPS[i].size + 1 : BOARD_SIZE)
      );
      const y = Math.floor(
        Math.random() *
          (horizontal ? BOARD_SIZE : BOARD_SIZE - SHIPS[i].size + 1)
      );
      let ok = true;
      for (let j = 0; j < SHIPS[i].size; j++) {
        const cx = horizontal ? x + j : x;
        const cy = horizontal ? y : y + j;
        if (board[cy][cx] !== null) {
          ok = false;
          break;
        }
      }
      if (ok) {
        for (let j = 0; j < SHIPS[i].size; j++) {
          const cx = horizontal ? x + j : x;
          const cy = horizontal ? y : y + j;
          board[cy][cx] = i;
        }
        ships.push({ x, y, horizontal });
        placed = true;
      }
    }
  }
  return ships;
}

function aiTakeTurn(game) {
  if (!game.aiState)
    game.aiState = { mode: 'hunt', targets: [], tried: new Set() };
  const state = game.aiState;
  // Rebuild tried set from shots board
  if (!(state.tried instanceof Set)) {
    state.tried = new Set();
    for (let y = 0; y < BOARD_SIZE; y++)
      for (let x = 0; x < BOARD_SIZE; x++)
        if (game.shots.p2[y][x] !== null) state.tried.add(`${x},${y}`);
  }

  let x, y;
  if (state.mode === 'target' && state.targets.length > 0) {
    while (state.targets.length > 0) {
      const t = state.targets.shift();
      if (!state.tried.has(`${t.x},${t.y}`)) {
        x = t.x;
        y = t.y;
        break;
      }
    }
    if (x === undefined) state.mode = 'hunt';
  }

  if (x === undefined) {
    // Hunt mode: checkerboard pattern for efficiency
    const candidates = [];
    for (let cy = 0; cy < BOARD_SIZE; cy++)
      for (let cx = 0; cx < BOARD_SIZE; cx++)
        if ((cx + cy) % 2 === 0 && !state.tried.has(`${cx},${cy}`))
          candidates.push({ x: cx, y: cy });
    if (candidates.length === 0) {
      for (let cy = 0; cy < BOARD_SIZE; cy++)
        for (let cx = 0; cx < BOARD_SIZE; cx++)
          if (!state.tried.has(`${cx},${cy}`))
            candidates.push({ x: cx, y: cy });
    }
    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    x = pick.x;
    y = pick.y;
  }

  state.tried.add(`${x},${y}`);
  const result = processShot(game, 'p2', x, y);

  if (result.result === 'hit' && !result.sunk) {
    state.mode = 'target';
    for (const [dx, dy] of [
      [0, -1],
      [0, 1],
      [-1, 0],
      [1, 0],
    ]) {
      const nx = x + dx,
        ny = y + dy;
      if (
        nx >= 0 &&
        nx < BOARD_SIZE &&
        ny >= 0 &&
        ny < BOARD_SIZE &&
        !state.tried.has(`${nx},${ny}`)
      )
        state.targets.push({ x: nx, y: ny });
    }
  }
  if (result.sunk) {
    state.targets = [];
    // Check if there are still outstanding hits without sinks
    const totalHits = Object.values(game.hits.p2).reduce((a, b) => a + b, 0);
    const totalSunkCells = SHIPS.reduce(
      (a, s, i) => a + (game.hits.p2[i] === s.size ? s.size : 0),
      0
    );
    if (totalHits > totalSunkCells) state.mode = 'target';
    else state.mode = 'hunt';
  }

  // Serialize tried set for persistence
  game.aiState = {
    mode: state.mode,
    targets: state.targets,
    tried: [...state.tried],
  };
  stmts.saveState.run(JSON.stringify(serializeGame(game)), game.id);

  return { x, y, ...result };
}

// --- Socket.IO ---
io.on('connection', (socket) => {
  // Create AI game
  socket.on('create-ai-game', () => {
    const id = uuidv4();
    const game = {
      id,
      mode: 'ai',
      phase: 'placement',
      turn: 'p1',
      ships: { p1: null, p2: null },
      boards: { p1: null, p2: null },
      shots: { p1: createBoard(), p2: createBoard() },
      hits: { p1: {}, p2: {} },
      turnCount: 0,
      winner: null,
      sockets: { p1: socket.id },
      ready: {},
      aiState: null,
    };
    // AI places ships immediately
    const aiShips = aiPlaceShips();
    game.ships.p2 = aiShips;
    game.boards.p2 = buildShipBoard(aiShips);

    games[id] = game;
    stmts.createGame.run(id, 'ai', JSON.stringify(serializeGame(game)));
    socket.join(id);
    socket.gameId = id;
    socket.playerId = 'p1';
    socket.emit('game-created', { gameId: id, playerId: 'p1' });
  });

  // Create multiplayer game
  socket.on('create-mp-game', () => {
    const id = uuidv4();
    const game = {
      id,
      mode: 'mp',
      phase: 'placement',
      turn: 'p1',
      ships: { p1: null, p2: null },
      boards: { p1: null, p2: null },
      shots: { p1: createBoard(), p2: createBoard() },
      hits: { p1: {}, p2: {} },
      turnCount: 0,
      winner: null,
      sockets: { p1: socket.id },
      ready: {},
    };
    games[id] = game;
    stmts.createGame.run(id, 'mp', JSON.stringify(serializeGame(game)));
    socket.join(id);
    socket.gameId = id;
    socket.playerId = 'p1';
    socket.emit('game-created', { gameId: id, playerId: 'p1' });
  });

  // Join multiplayer game
  socket.on('join-game', ({ gameId }) => {
    let game = games[gameId];
    if (!game) {
      const row = stmts.getGame.get(gameId);
      if (row && row.state) {
        game = restoreGame(row);
        games[gameId] = game;
      }
    }
    if (!game) return socket.emit('error-msg', 'Game not found');
    if (game.mode !== 'mp')
      return socket.emit('error-msg', 'Not a multiplayer game');
    if (
      game.sockets.p1 &&
      game.sockets.p2 &&
      game.sockets.p1 !== socket.id &&
      game.sockets.p2 !== socket.id
    )
      return socket.emit('error-msg', 'Game is full');

    const playerId = game.sockets.p1 ? 'p2' : 'p1';
    game.sockets[playerId] = socket.id;
    socket.join(gameId);
    socket.gameId = gameId;
    socket.playerId = playerId;
    socket.emit('game-joined', { gameId, playerId });
    io.to(gameId).emit('player-joined', { playerId });
  });

  // Rejoin (refresh support)
  socket.on('rejoin', ({ gameId, playerId }) => {
    let game = games[gameId];
    if (!game) {
      const row = stmts.getGame.get(gameId);
      if (row && row.state) {
        game = restoreGame(row);
        games[gameId] = game;
      }
    }
    if (!game) return socket.emit('error-msg', 'Game not found');
    game.sockets[playerId] = socket.id;
    socket.join(gameId);
    socket.gameId = gameId;
    socket.playerId = playerId;

    // Send full state back
    const myShots = game.shots[playerId];
    const myBoard = game.boards[playerId];
    // Build incoming hits on my board
    const opponent = playerId === 'p1' ? 'p2' : 'p1';
    const incomingShots = game.shots[opponent];
    socket.emit('rejoin-state', {
      phase: game.phase,
      turn: game.turn,
      myShips: game.ships[playerId],
      myShots,
      incomingShots,
      winner: game.winner,
      mode: game.mode,
    });
  });

  // Place ships
  socket.on('place-ships', ({ ships }) => {
    const game = games[socket.gameId];
    if (!game || game.phase !== 'placement') return;
    const pid = socket.playerId;
    if (game.ships[pid]) return socket.emit('error-msg', 'Already placed');
    if (!validatePlacement(ships))
      return socket.emit('error-msg', 'Invalid placement');

    game.ships[pid] = ships;
    game.boards[pid] = buildShipBoard(ships);
    game.ready[pid] = true;
    socket.emit('ships-placed');

    const bothReady =
      game.mode === 'ai' ? game.ready.p1 : game.ready.p1 && game.ready.p2;

    if (bothReady) {
      game.phase = 'firing';
      game.turn = 'p1';
      stmts.saveState.run(JSON.stringify(serializeGame(game)), game.id);
      io.to(game.id).emit('phase-change', { phase: 'firing', turn: 'p1' });
    } else {
      stmts.saveState.run(JSON.stringify(serializeGame(game)), game.id);
    }
  });

  // Fire
  socket.on('fire', ({ x, y }) => {
    const game = games[socket.gameId];
    if (!game || game.phase !== 'firing') return;
    const pid = socket.playerId;
    if (game.turn !== pid) return socket.emit('error-msg', 'Not your turn');

    const result = processShot(game, pid, x, y);
    if (result.error) return socket.emit('error-msg', result.error);

    io.to(game.id).emit('shot-result', {
      player: pid,
      x,
      y,
      result: result.result,
      sunk: result.sunk,
      winner: result.winner,
    });

    // AI turn
    if (!result.winner && game.mode === 'ai' && game.turn === 'p2') {
      setTimeout(() => {
        const aiResult = aiTakeTurn(game);
        io.to(game.id).emit('shot-result', {
          player: 'p2',
          x: aiResult.x,
          y: aiResult.y,
          result: aiResult.result,
          sunk: aiResult.sunk,
          winner: aiResult.winner,
        });
      }, 500);
    }
  });

  socket.on('disconnect', () => {});
});

// --- REST API for history ---
app.get('/api/history', (req, res) => {
  res.json(stmts.getHistory.all());
});
app.get('/api/history/:id', (req, res) => {
  const game = stmts.getGame.get(req.params.id);
  const moves = stmts.getGameMoves.all(req.params.id);
  if (!game) return res.status(404).json({ error: 'Not found' });
  res.json({ game, moves });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () =>
  console.log(`Battleship running on http://localhost:${PORT}`)
);
