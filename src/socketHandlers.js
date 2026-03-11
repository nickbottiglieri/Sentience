const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const { stmts } = require('./db');
const { createBoard, validatePlacement, buildShipBoard, serializeGame, restoreGame, processShot } = require('./game');
const { aiPlaceShips, aiTakeTurn } = require('./ai');

function generateToken() { return crypto.randomBytes(24).toString('hex'); }

const games = {};

function registerSocketHandlers(io) {
  io.on('connection', (socket) => {
    socket.on('create-ai-game', () => {
      const id = uuidv4();
      const token = generateToken();
      const aiShips = aiPlaceShips();
      const game = {
        id, mode: 'ai', phase: 'placement', turn: 'p1',
        ships: { p1: null, p2: aiShips }, boards: { p1: null, p2: buildShipBoard(aiShips) },
        shots: { p1: createBoard(), p2: createBoard() }, hits: { p1: {}, p2: {} },
        turnCount: 0, winner: null, sockets: { p1: socket.id }, ready: {}, aiState: null,
        tokens: { p1: token },
      };
      games[id] = game;
      stmts.createGame.run(id, 'ai', JSON.stringify(serializeGame(game)));
      socket.join(id); socket.gameId = id; socket.playerId = 'p1';
      socket.emit('game-created', { gameId: id, playerId: 'p1', token });
    });

    socket.on('create-mp-game', () => {
      const id = uuidv4();
      const token = generateToken();
      const game = {
        id, mode: 'mp', phase: 'placement', turn: 'p1',
        ships: { p1: null, p2: null }, boards: { p1: null, p2: null },
        shots: { p1: createBoard(), p2: createBoard() }, hits: { p1: {}, p2: {} },
        turnCount: 0, winner: null, sockets: { p1: socket.id }, ready: {},
        tokens: { p1: token },
      };
      games[id] = game;
      stmts.createGame.run(id, 'mp', JSON.stringify(serializeGame(game)));
      socket.join(id); socket.gameId = id; socket.playerId = 'p1';
      socket.emit('game-created', { gameId: id, playerId: 'p1', token });
    });

    socket.on('join-game', ({ gameId }) => {
      let game = games[gameId];
      if (!game) {
        const row = stmts.getGame.get(gameId);
        if (row && row.state) { game = restoreGame(row); games[gameId] = game; }
      }
      if (!game) return socket.emit('error-msg', 'Game not found');
      if (game.mode !== 'mp') return socket.emit('error-msg', 'Not a multiplayer game');
      if (game.sockets.p1 && game.sockets.p2 && game.sockets.p1 !== socket.id && game.sockets.p2 !== socket.id)
        return socket.emit('error-msg', 'Game is full');
      const playerId = game.sockets.p1 ? 'p2' : 'p1';
      const token = generateToken();
      game.tokens = game.tokens || {};
      game.tokens[playerId] = token;
      game.sockets[playerId] = socket.id;
      socket.join(gameId); socket.gameId = gameId; socket.playerId = playerId;
      socket.emit('game-joined', { gameId, playerId, token });
      io.to(gameId).emit('player-joined', { playerId });
    });

    socket.on('rejoin', ({ gameId, playerId, token }) => {
      let game = games[gameId];
      if (!game) {
        const row = stmts.getGame.get(gameId);
        if (row && row.state) { game = restoreGame(row); games[gameId] = game; }
      }
      if (!game) return socket.emit('error-msg', 'Game not found');
      if (!game.tokens || game.tokens[playerId] !== token)
        return socket.emit('error-msg', 'Invalid session');
      game.sockets[playerId] = socket.id;
      socket.join(gameId); socket.gameId = gameId; socket.playerId = playerId;
      const opponent = playerId === 'p1' ? 'p2' : 'p1';
      socket.emit('rejoin-state', {
        phase: game.phase, turn: game.turn, myShips: game.ships[playerId],
        myShots: game.shots[playerId], incomingShots: game.shots[opponent],
        winner: game.winner, mode: game.mode,
      });
    });

    socket.on('place-ships', ({ ships }) => {
      const game = games[socket.gameId];
      if (!game || game.phase !== 'placement') return;
      const pid = socket.playerId;
      if (game.ships[pid]) return socket.emit('error-msg', 'Already placed');
      if (!validatePlacement(ships)) return socket.emit('error-msg', 'Invalid placement');
      game.ships[pid] = ships;
      game.boards[pid] = buildShipBoard(ships);
      game.ready[pid] = true;
      socket.emit('ships-placed');
      const bothReady = game.mode === 'ai' ? game.ready.p1 : game.ready.p1 && game.ready.p2;
      if (bothReady) {
        game.phase = 'firing'; game.turn = 'p1';
        stmts.saveState.run(JSON.stringify(serializeGame(game)), game.id);
        io.to(game.id).emit('phase-change', { phase: 'firing', turn: 'p1' });
      } else {
        stmts.saveState.run(JSON.stringify(serializeGame(game)), game.id);
      }
    });

    socket.on('fire', ({ x, y }) => {
      const game = games[socket.gameId];
      if (!game || game.phase !== 'firing') return;
      const pid = socket.playerId;
      if (game.turn !== pid) return socket.emit('error-msg', 'Not your turn');
      const result = processShot(game, pid, x, y);
      if (result.error) return socket.emit('error-msg', result.error);
      io.to(game.id).emit('shot-result', { player: pid, x, y, result: result.result, sunk: result.sunk, winner: result.winner });
      if (!result.winner && game.mode === 'ai' && game.turn === 'p2') {
        setTimeout(() => {
          const aiResult = aiTakeTurn(game);
          io.to(game.id).emit('shot-result', { player: 'p2', x: aiResult.x, y: aiResult.y, result: aiResult.result, sunk: aiResult.sunk, winner: aiResult.winner });
        }, 500);
      }
    });

    socket.on('disconnect', () => {});
  });
}

module.exports = { registerSocketHandlers, games };
