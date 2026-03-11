const { stmts } = require('./db');
const { SHIPS, BOARD_SIZE, createBoard, processShot, serializeGame } = require('./game');

function aiPlaceShips() {
  const ships = [];
  const board = createBoard();
  for (let i = 0; i < SHIPS.length; i++) {
    let placed = false;
    while (!placed) {
      const horizontal = Math.random() < 0.5;
      const x = Math.floor(Math.random() * (horizontal ? BOARD_SIZE - SHIPS[i].size + 1 : BOARD_SIZE));
      const y = Math.floor(Math.random() * (horizontal ? BOARD_SIZE : BOARD_SIZE - SHIPS[i].size + 1));
      let ok = true;
      for (let j = 0; j < SHIPS[i].size; j++) {
        const cx = horizontal ? x + j : x;
        const cy = horizontal ? y : y + j;
        if (board[cy][cx] !== null) { ok = false; break; }
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
  if (!game.aiState) game.aiState = { mode: 'hunt', targets: [], tried: new Set() };
  const state = game.aiState;

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
      if (!state.tried.has(`${t.x},${t.y}`)) { x = t.x; y = t.y; break; }
    }
    if (x === undefined) state.mode = 'hunt';
  }

  if (x === undefined) {
    const candidates = [];
    for (let cy = 0; cy < BOARD_SIZE; cy++)
      for (let cx = 0; cx < BOARD_SIZE; cx++)
        if ((cx + cy) % 2 === 0 && !state.tried.has(`${cx},${cy}`))
          candidates.push({ x: cx, y: cy });
    if (candidates.length === 0) {
      for (let cy = 0; cy < BOARD_SIZE; cy++)
        for (let cx = 0; cx < BOARD_SIZE; cx++)
          if (!state.tried.has(`${cx},${cy}`)) candidates.push({ x: cx, y: cy });
    }
    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    x = pick.x; y = pick.y;
  }

  state.tried.add(`${x},${y}`);
  const result = processShot(game, 'p2', x, y);

  if (result.result === 'hit' && !result.sunk) {
    state.mode = 'target';
    for (const [dx, dy] of [[0,-1],[0,1],[-1,0],[1,0]]) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && nx < BOARD_SIZE && ny >= 0 && ny < BOARD_SIZE && !state.tried.has(`${nx},${ny}`))
        state.targets.push({ x: nx, y: ny });
    }
  }
  if (result.sunk) {
    state.targets = [];
    const totalHits = Object.values(game.hits.p2).reduce((a, b) => a + b, 0);
    const totalSunkCells = SHIPS.reduce((a, s, i) => a + (game.hits.p2[i] === s.size ? s.size : 0), 0);
    state.mode = totalHits > totalSunkCells ? 'target' : 'hunt';
  }

  game.aiState = { mode: state.mode, targets: state.targets, tried: [...state.tried] };
  stmts.saveState.run(JSON.stringify(serializeGame(game)), game.id);

  return { x, y, ...result };
}

module.exports = { aiPlaceShips, aiTakeTurn };
