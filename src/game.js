const { stmts } = require('./db');

const SHIPS = [
  { name: 'Carrier', size: 5 },
  { name: 'Battleship', size: 4 },
  { name: 'Cruiser', size: 3 },
  { name: 'Submarine', size: 3 },
  { name: 'Destroyer', size: 2 },
];
const BOARD_SIZE = 10;

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
      if (cx < 0 || cx >= BOARD_SIZE || cy < 0 || cy >= BOARD_SIZE) return false;
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

function serializeGame(game) {
  return {
    phase: game.phase, turn: game.turn, ships: game.ships,
    boards: game.boards, shots: game.shots, hits: game.hits,
    turnCount: game.turnCount, winner: game.winner,
    aiState: game.aiState || null, mode: game.mode,
    tokens: game.tokens || null,
  };
}

function restoreGame(row) {
  const state = JSON.parse(row.state);
  return {
    id: row.id, mode: row.mode || state.mode,
    phase: state.phase, turn: state.turn, ships: state.ships,
    boards: state.boards, shots: state.shots, hits: state.hits,
    turnCount: state.turnCount || 0, winner: state.winner,
    aiState: state.aiState || null, sockets: {}, ready: {},
    tokens: state.tokens || {},
  };
}

function processShot(game, player, x, y) {
  const opponent = player === 'p1' ? 'p2' : 'p1';
  const opBoard = game.boards[opponent];
  const shotBoard = game.shots[player];

  if (x < 0 || x >= BOARD_SIZE || y < 0 || y >= BOARD_SIZE) return { error: 'Out of bounds' };
  if (shotBoard[y][x] !== null) return { error: 'Already fired there' };

  const cell = opBoard[y][x];
  let result, sunk = null;

  if (cell !== null) {
    shotBoard[y][x] = 'hit';
    result = 'hit';
    game.hits[player][cell] = (game.hits[player][cell] || 0) + 1;
    if (game.hits[player][cell] === SHIPS[cell].size) sunk = SHIPS[cell].name;
  } else {
    shotBoard[y][x] = 'miss';
    result = 'miss';
  }

  game.turnCount++;
  stmts.insertMove.run(game.id, player, x, y, sunk ? `sunk:${sunk}` : result, game.turnCount);

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

module.exports = {
  SHIPS, BOARD_SIZE, createBoard, validatePlacement,
  buildShipBoard, serializeGame, restoreGame, processShot,
};
