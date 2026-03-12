const { SHIPS, BOARD_SIZE, key, processShot, serializeGame } = require('./game');

// Fisher-Yates shuffle
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function buildHuntPool() {
  const cells = [];
  for (let y = 0; y < BOARD_SIZE; y++)
    for (let x = 0; x < BOARD_SIZE; x++)
      if ((x + y) % 2 === 0) cells.push({ x, y });
  // Odd cells as fallback at the front (popped last)
  for (let y = 0; y < BOARD_SIZE; y++)
    for (let x = 0; x < BOARD_SIZE; x++)
      if ((x + y) % 2 !== 0) cells.push({ x, y });
  // Shuffle each half independently, then concat: checkerboard first, odds as backup
  const half = cells.filter((_, i) => i < BOARD_SIZE * BOARD_SIZE / 2);
  const rest = cells.filter((_, i) => i >= BOARD_SIZE * BOARD_SIZE / 2);
  return [...shuffle(rest), ...shuffle(half)]; // pop from end = checkerboard first
}

function aiPlaceShips() {
  const ships = [];
  const occupied = new Set();
  for (let i = 0; i < SHIPS.length; i++) {
    let placed = false;
    while (!placed) {
      const horizontal = Math.random() < 0.5;
      const x = Math.floor(Math.random() * (horizontal ? BOARD_SIZE - SHIPS[i].size + 1 : BOARD_SIZE));
      const y = Math.floor(Math.random() * (horizontal ? BOARD_SIZE : BOARD_SIZE - SHIPS[i].size + 1));
      const cells = [];
      let ok = true;
      for (let j = 0; j < SHIPS[i].size; j++) {
        const cx = horizontal ? x + j : x;
        const cy = horizontal ? y : y + j;
        const k = key(cx, cy);
        if (occupied.has(k)) { ok = false; break; }
        cells.push(k);
      }
      if (ok) {
        cells.forEach(k => occupied.add(k));
        ships.push({ x, y, horizontal });
        placed = true;
      }
    }
  }
  return ships;
}

function initAiState() {
  return { mode: 'hunt', targets: [], tried: new Set(), huntPool: buildHuntPool() };
}

async function aiTakeTurn(game) {
  if (!game.aiState) game.aiState = initAiState();
  const state = game.aiState;

  // Restore from serialized form
  if (!(state.tried instanceof Set)) {
    state.tried = new Set(state.tried || []);
    if (!state.huntPool) {
      // Rebuild pool excluding already-tried cells
      state.huntPool = buildHuntPool().filter(c => !state.tried.has(key(c.x, c.y)));
    }
  }

  let x, y;
  if (state.mode === 'target' && state.targets.length > 0) {
    while (state.targets.length > 0) {
      const t = state.targets.shift();
      if (!state.tried.has(key(t.x, t.y))) { x = t.x; y = t.y; break; }
    }
    if (x === undefined) state.mode = 'hunt';
  }

  if (x === undefined) {
    // O(1) pop from pre-shuffled pool
    while (state.huntPool.length > 0) {
      const pick = state.huntPool.pop();
      if (!state.tried.has(key(pick.x, pick.y))) { x = pick.x; y = pick.y; break; }
    }
  }

  state.tried.add(key(x, y));
  const result = await processShot(game, 'p2', x, y);

  if (result.result === 'hit' && !result.sunk) {
    state.mode = 'target';
    for (const [dx, dy] of [[0,-1],[0,1],[-1,0],[1,0]]) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && nx < BOARD_SIZE && ny >= 0 && ny < BOARD_SIZE && !state.tried.has(key(nx, ny)))
        state.targets.push({ x: nx, y: ny });
    }
  }
  if (result.sunk) {
    state.targets = [];
    const totalHits = Object.values(game.hits.p2).reduce((a, b) => a + b, 0);
    const totalSunkCells = SHIPS.reduce((a, s, i) => a + (game.hits.p2[i] === s.size ? s.size : 0), 0);
    state.mode = totalHits > totalSunkCells ? 'target' : 'hunt';
  }

  // Serialize for persistence
  game.aiState = { mode: state.mode, targets: state.targets, tried: [...state.tried], huntPool: state.huntPool };

  return { x, y, ...result };
}

module.exports = { aiPlaceShips, aiTakeTurn };
