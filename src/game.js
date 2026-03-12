const { stmts } = require('./db');

const SHIPS = [
  { name: 'Carrier', size: 5 },
  { name: 'Battleship', size: 4 },
  { name: 'Cruiser', size: 3 },
  { name: 'Submarine', size: 3 },
  { name: 'Destroyer', size: 2 },
];
const BOARD_SIZE = 10;

const key = (x, y) => `${x},${y}`;

function validatePlacement(ships) {
  if (!Array.isArray(ships) || ships.length !== SHIPS.length) return false;
  const occupied = new Set();
  for (let i = 0; i < ships.length; i++) {
    const { x, y, horizontal } = ships[i];
    const size = SHIPS[i].size;
    for (let j = 0; j < size; j++) {
      const cx = horizontal ? x + j : x;
      const cy = horizontal ? y : y + j;
      if (cx < 0 || cx >= BOARD_SIZE || cy < 0 || cy >= BOARD_SIZE) return false;
      const k = key(cx, cy);
      if (occupied.has(k)) return false;
      occupied.add(k);
    }
  }
  return true;
}

// Sparse board: Map of "x,y" -> shipIndex
function buildShipMap(ships) {
  const map = new Map();
  ships.forEach((ship, i) => {
    const size = SHIPS[i].size;
    for (let j = 0; j < size; j++) {
      const cx = ship.horizontal ? ship.x + j : ship.x;
      const cy = ship.horizontal ? ship.y : ship.y + j;
      map.set(key(cx, cy), i);
    }
  });
  return map;
}

// Sparse shots: Map of "x,y" -> "hit"|"miss"
function createShotMap() { return new Map(); }

function serializeGame(game) {
  return {
    phase: game.phase, turn: game.turn, ships: game.ships,
    boards: { p1: game.boards.p1 ? [...game.boards.p1] : null, p2: game.boards.p2 ? [...game.boards.p2] : null },
    shots: { p1: [...game.shots.p1], p2: [...game.shots.p2] },
    hits: game.hits, turnCount: game.turnCount, winner: game.winner,
    aiState: game.aiState || null, mode: game.mode, tokens: game.tokens || null,
    ready: game.ready || {},
  };
}

function restoreShotMap(data) {
  if (!data) return new Map();
  return new Map(data);
}

function restoreBoardMap(data) {
  if (!data) return null;
  return new Map(data);
}

function restoreGame(row) {
  const state = JSON.parse(row.state);
  return {
    id: row.id, mode: row.mode || state.mode,
    phase: state.phase, turn: state.turn, ships: state.ships,
    boards: { p1: restoreBoardMap(state.boards.p1), p2: restoreBoardMap(state.boards.p2) },
    shots: { p1: restoreShotMap(state.shots.p1), p2: restoreShotMap(state.shots.p2) },
    hits: state.hits, turnCount: state.turnCount || 0, winner: state.winner,
    aiState: state.aiState || null, sockets: {}, ready: state.ready || {},
    tokens: state.tokens || {},
  };
}

async function processShot(game, player, x, y) {
  const opponent = player === 'p1' ? 'p2' : 'p1';
  const opBoard = game.boards[opponent];
  const shotMap = game.shots[player];
  const k = key(x, y);

  if (x < 0 || x >= BOARD_SIZE || y < 0 || y >= BOARD_SIZE) return { error: 'Out of bounds' };
  if (shotMap.has(k)) return { error: 'Already fired there' };

  const cell = opBoard.get(k);
  let result, sunk = null;

  if (cell !== undefined) {
    shotMap.set(k, 'hit');
    result = 'hit';
    game.hits[player][cell] = (game.hits[player][cell] || 0) + 1;
    if (game.hits[player][cell] === SHIPS[cell].size) sunk = SHIPS[cell].name;
  } else {
    shotMap.set(k, 'miss');
    result = 'miss';
  }

  game.turnCount++;
  await stmts.insertMove.run(game.id, player, x, y, sunk ? `sunk:${sunk}` : result, game.turnCount);

  const allSunk = SHIPS.every((s, i) => game.hits[player][i] === s.size);
  if (allSunk) {
    game.winner = player;
    game.phase = 'finished';
    await stmts.updateGame.run(JSON.stringify(serializeGame(game)), player, game.id);
  } else {
    game.turn = opponent;
    await stmts.saveState.run(JSON.stringify(serializeGame(game)), game.id);
  }

  return { result, sunk, winner: game.winner || null };
}

module.exports = {
  SHIPS, BOARD_SIZE, key, validatePlacement,
  buildShipMap, createShotMap, serializeGame, restoreGame, processShot,
};
