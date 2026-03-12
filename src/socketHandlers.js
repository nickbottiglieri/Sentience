const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const { stmts } = require('./db');
const { BOARD_SIZE, createShotMap, validatePlacement, buildShipMap, serializeGame, processShot } = require('./game');
const { aiPlaceShips, aiTakeTurn } = require('./ai');
const gameStore = require('./gameStore');

function generateToken() { return crypto.randomBytes(24).toString('hex'); }

const disconnectTimers = {}; // gameId:playerId -> timeout handle

const RATE_LIMIT = { maxPerSec: 5 };
const DISCONNECT_GRACE_MS = 45000;

// Convert sparse shot Map to dense 2D array for client rendering
function shotMapToArray(map) {
  const arr = Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(null));
  if (!(map instanceof Map)) return arr;
  for (const [k, v] of map) {
    if (typeof k !== 'string') continue;
    const [x, y] = k.split(',').map(Number);
    arr[y][x] = v;
  }
  return arr;
}

function registerSocketHandlers(io) {
  io.on('connection', (socket) => {
    const rateBucket = { count: 0, resetAt: Date.now() + 1000 };
    socket.use((packet, next) => {
      const now = Date.now();
      if (now > rateBucket.resetAt) { rateBucket.count = 0; rateBucket.resetAt = now + 1000; }
      if (++rateBucket.count > RATE_LIMIT.maxPerSec) {
        socket.emit('error-msg', 'Rate limited');
        return socket.disconnect(true);
      }
      next();
    });

    socket.on('create-ai-game', async () => {
      const id = uuidv4();
      const token = generateToken();
      const aiShips = aiPlaceShips();
      const game = {
        id, mode: 'ai', phase: 'placement', turn: 'p1',
        ships: { p1: null, p2: aiShips }, boards: { p1: null, p2: buildShipMap(aiShips) },
        shots: { p1: createShotMap(), p2: createShotMap() }, hits: { p1: {}, p2: {} },
        turnCount: 0, winner: null, sockets: { p1: socket.id }, ready: {}, aiState: null,
        tokens: { p1: token },
      };
      stmts.createGame.run(id, 'ai', JSON.stringify(serializeGame(game)));
      await gameStore.saveGame(game);
      socket.join(id); socket.gameId = id; socket.playerId = 'p1';
      socket.emit('game-created', { gameId: id, playerId: 'p1', token });
    });

    socket.on('create-mp-game', async () => {
      const id = uuidv4();
      const token = generateToken();
      const game = {
        id, mode: 'mp', phase: 'placement', turn: 'p1',
        ships: { p1: null, p2: null }, boards: { p1: null, p2: null },
        shots: { p1: createShotMap(), p2: createShotMap() }, hits: { p1: {}, p2: {} },
        turnCount: 0, winner: null, sockets: { p1: socket.id }, ready: {},
        tokens: { p1: token },
      };
      stmts.createGame.run(id, 'mp', JSON.stringify(serializeGame(game)));
      await gameStore.saveGame(game);
      socket.join(id); socket.gameId = id; socket.playerId = 'p1';
      socket.emit('game-created', { gameId: id, playerId: 'p1', token });
    });

    socket.on('join-game', async ({ gameId }) => {
      const game = await gameStore.getGame(gameId);
      if (!game) return socket.emit('error-msg', 'Game not found');
      if (game.mode !== 'mp') return socket.emit('error-msg', 'Not a multiplayer game');
      if (game.sockets.p1 && game.sockets.p2 && game.sockets.p1 !== socket.id && game.sockets.p2 !== socket.id)
        return socket.emit('error-msg', 'Game is full');
      const playerId = game.tokens?.p1 ? 'p2' : 'p1';
      const token = generateToken();
      game.tokens = game.tokens || {};
      game.tokens[playerId] = token;
      game.sockets[playerId] = socket.id;
      await gameStore.saveGame(game);
      socket.join(gameId); socket.gameId = gameId; socket.playerId = playerId;
      socket.emit('game-joined', { gameId, playerId, token });
      io.to(gameId).emit('player-joined', { playerId });
    });

    socket.on('rejoin', async ({ gameId, playerId, token }) => {
      const game = await gameStore.getGame(gameId);
      if (!game) return socket.emit('error-msg', 'Game not found');
      if (!game.tokens || game.tokens[playerId] !== token)
        return socket.emit('error-msg', 'Invalid session');
      const timerKey = `${gameId}:${playerId}`;
      if (disconnectTimers[timerKey]) { clearTimeout(disconnectTimers[timerKey]); delete disconnectTimers[timerKey]; }
      game.sockets[playerId] = socket.id;
      await gameStore.saveGame(game);
      socket.join(gameId); socket.gameId = gameId; socket.playerId = playerId;
      io.to(gameId).emit('player-reconnected', { playerId });
      const opponent = playerId === 'p1' ? 'p2' : 'p1';
      socket.emit('rejoin-state', {
        phase: game.phase, turn: game.turn, myShips: game.ships[playerId],
        myShots: shotMapToArray(game.shots[playerId]), incomingShots: shotMapToArray(game.shots[opponent]),
        winner: game.winner, mode: game.mode,
        waitingForOpponent: game.mode === 'mp' && !game.sockets[opponent],
      });
    });

    socket.on('place-ships', async ({ ships }) => {
      const game = await gameStore.getGame(socket.gameId);
      if (!game || game.phase !== 'placement') return;
      const pid = socket.playerId;
      if (game.ships[pid]) return socket.emit('error-msg', 'Already placed');
      if (!validatePlacement(ships)) return socket.emit('error-msg', 'Invalid placement');
      game.ships[pid] = ships;
      game.boards[pid] = buildShipMap(ships);
      game.ready[pid] = true;
      socket.emit('ships-placed');
      const bothReady = game.mode === 'ai' ? game.ready.p1 : game.ready.p1 && game.ready.p2;
      if (bothReady) {
        game.phase = 'firing'; game.turn = 'p1';
        console.log(`[place-ships] Both ready, transitioning to firing`);
        io.to(game.id).emit('phase-change', { phase: 'firing', turn: 'p1' });
      }
      await gameStore.saveGame(game);
      stmts.saveState.run(JSON.stringify(serializeGame(game)), game.id);
    });

    socket.on('fire', async ({ x, y }) => {
      const game = await gameStore.getGame(socket.gameId);
      if (!game || game.phase !== 'firing') return;
      const pid = socket.playerId;
      if (game.turn !== pid) return socket.emit('error-msg', 'Not your turn');
      const result = processShot(game, pid, x, y);
      if (result.error) return socket.emit('error-msg', result.error);
      await gameStore.saveGame(game);
      io.to(game.id).emit('shot-result', { player: pid, x, y, result: result.result, sunk: result.sunk, winner: result.winner });
      if (result.winner) await gameStore.deleteGame(game.id);
      if (!result.winner && game.mode === 'ai' && game.turn === 'p2') {
        setTimeout(async () => {
          const g = await gameStore.getGame(game.id);
          if (!g) return;
          const aiResult = aiTakeTurn(g);
          await gameStore.saveGame(g);
          io.to(g.id).emit('shot-result', { player: 'p2', x: aiResult.x, y: aiResult.y, result: aiResult.result, sunk: aiResult.sunk, winner: aiResult.winner });
          if (aiResult.winner) await gameStore.deleteGame(g.id);
        }, 500);
      }
    });

    socket.on('forfeit', async ({ gameId, playerId }) => {
      const game = await gameStore.getGame(gameId);
      if (!game || game.phase === 'finished') return;
      const opponent = playerId === 'p1' ? 'p2' : 'p1';
      game.winner = opponent;
      game.phase = 'finished';
      stmts.updateGame.run(JSON.stringify(serializeGame(game)), opponent, game.id);
      await gameStore.deleteGame(gameId);
      if (game.sockets[playerId] === socket.id) game.sockets[playerId] = null;
      socket.leave(gameId);
      socket.gameId = null;
      socket.playerId = null;
      io.to(game.id).emit('player-forfeited', { winner: opponent, forfeiter: playerId });
    });

    socket.on('leave-game', async ({ gameId, playerId }) => {
      const game = await gameStore.getGame(gameId);
      if (!game) return;
      if (game.sockets[playerId] === socket.id) game.sockets[playerId] = null;
      await gameStore.saveGame(game);
      socket.leave(gameId);
      socket.gameId = null;
      socket.playerId = null;
    });

    socket.on('disconnect', () => {
      const gid = socket.gameId;
      const pid = socket.playerId;
      if (!gid || !pid) return;
      gameStore.getGame(gid).then((game) => {
        if (!game || game.phase === 'finished') return;
        if (game.mode === 'ai') return;
        io.to(gid).emit('player-disconnected', { playerId: pid });
        const timerKey = `${gid}:${pid}`;
        disconnectTimers[timerKey] = setTimeout(async () => {
          delete disconnectTimers[timerKey];
          const g = await gameStore.getGame(gid);
          if (!g || g.phase === 'finished') return;
          const opponent = pid === 'p1' ? 'p2' : 'p1';
          g.winner = opponent;
          g.phase = 'finished';
          stmts.updateGame.run(JSON.stringify(serializeGame(g)), opponent, g.id);
          await gameStore.deleteGame(gid);
          io.to(g.id).emit('player-forfeited', { winner: opponent, forfeiter: pid });
        }, DISCONNECT_GRACE_MS);
      });
    });
  });
}

module.exports = { registerSocketHandlers };
