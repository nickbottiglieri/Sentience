const {
  SHIPS, BOARD_SIZE, key, validatePlacement,
  buildShipMap, createShotMap, serializeGame, restoreGame, processShot,
} = require('../src/game');

// Mock db so SQLite doesn't open during tests
jest.mock('../src/db', () => ({
  stmts: {
    insertMove: { run: jest.fn() },
    updateGame: { run: jest.fn() },
    saveState: { run: jest.fn() },
  },
}));

// --- validatePlacement ---

describe('validatePlacement', () => {
  const validShips = [
    { x: 0, y: 0, horizontal: true },  // Carrier (5)
    { x: 0, y: 1, horizontal: true },  // Battleship (4)
    { x: 0, y: 2, horizontal: true },  // Cruiser (3)
    { x: 0, y: 3, horizontal: true },  // Submarine (3)
    { x: 0, y: 4, horizontal: true },  // Destroyer (2)
  ];

  test('accepts valid non-overlapping placement', () => {
    expect(validatePlacement(validShips)).toBe(true);
  });

  test('rejects wrong number of ships', () => {
    expect(validatePlacement(validShips.slice(0, 3))).toBe(false);
    expect(validatePlacement([])).toBe(false);
    expect(validatePlacement(null)).toBe(false);
  });

  test('rejects out-of-bounds horizontal', () => {
    const ships = validShips.map((s, i) => i === 0 ? { x: 7, y: 0, horizontal: true } : s); // Carrier size 5 at x=7 overflows
    expect(validatePlacement(ships)).toBe(false);
  });

  test('rejects out-of-bounds vertical', () => {
    const ships = validShips.map((s, i) => i === 0 ? { x: 0, y: 8, horizontal: false } : s); // Carrier size 5 at y=8 overflows
    expect(validatePlacement(ships)).toBe(false);
  });

  test('rejects overlapping ships', () => {
    const ships = validShips.map((s, i) => i === 1 ? { x: 0, y: 0, horizontal: true } : s); // Battleship overlaps Carrier at row 0
    expect(validatePlacement(ships)).toBe(false);
  });
});

// --- buildShipMap ---

describe('buildShipMap', () => {
  test('maps all ship cells to their index', () => {
    const ships = [
      { x: 0, y: 0, horizontal: true },  // Carrier (5)
      { x: 0, y: 1, horizontal: true },  // Battleship (4)
      { x: 0, y: 2, horizontal: true },  // Cruiser (3)
      { x: 0, y: 3, horizontal: true },  // Submarine (3)
      { x: 0, y: 4, horizontal: true },  // Destroyer (2)
    ];
    const map = buildShipMap(ships);
    // Carrier occupies (0,0)-(4,0)
    for (let x = 0; x < 5; x++) expect(map.get(key(x, 0))).toBe(0);
    // Destroyer occupies (0,4)-(1,4)
    expect(map.get(key(0, 4))).toBe(4);
    expect(map.get(key(1, 4))).toBe(4);
    // Empty cell
    expect(map.get(key(9, 9))).toBeUndefined();
    // Total cells = 5+4+3+3+2 = 17
    expect(map.size).toBe(17);
  });
});

// --- serializeGame / restoreGame round-trip ---

describe('serialize/restore round-trip', () => {
  function makeGame() {
    const ships = [
      { x: 0, y: 0, horizontal: true },
      { x: 0, y: 1, horizontal: true },
      { x: 0, y: 2, horizontal: true },
      { x: 0, y: 3, horizontal: true },
      { x: 0, y: 4, horizontal: true },
    ];
    return {
      id: 'test-id', mode: 'ai', phase: 'firing', turn: 'p1',
      ships: { p1: ships, p2: ships },
      boards: { p1: buildShipMap(ships), p2: buildShipMap(ships) },
      shots: { p1: createShotMap(), p2: createShotMap() },
      hits: { p1: {}, p2: {} }, turnCount: 0, winner: null,
      sockets: {}, ready: {}, aiState: null, tokens: { p1: 'tok1' },
    };
  }

  test('round-trips game state without loss', () => {
    const game = makeGame();
    game.shots.p1.set(key(0, 0), 'hit');
    game.shots.p1.set(key(5, 5), 'miss');
    game.hits.p1[0] = 1;
    game.turnCount = 2;

    const serialized = JSON.stringify(serializeGame(game));
    const restored = restoreGame({ id: 'test-id', mode: 'ai', state: serialized });

    expect(restored.phase).toBe('firing');
    expect(restored.turn).toBe('p1');
    expect(restored.shots.p1.get(key(0, 0))).toBe('hit');
    expect(restored.shots.p1.get(key(5, 5))).toBe('miss');
    expect(restored.boards.p1.get(key(0, 0))).toBe(0);
    expect(restored.hits.p1[0]).toBe(1);
    expect(restored.turnCount).toBe(2);
    expect(restored.tokens.p1).toBe('tok1');
  });

  test('round-trips ready state', () => {
    const game = makeGame();
    game.ready = { p1: true };
    const serialized = JSON.stringify(serializeGame(game));
    const restored = restoreGame({ id: 'test-id', mode: 'mp', state: serialized });
    expect(restored.ready.p1).toBe(true);
    expect(restored.ready.p2).toBeUndefined();
  });

  test('round-trips tokens for both players', () => {
    const game = makeGame();
    game.tokens = { p1: 'tok1', p2: 'tok2' };
    const serialized = JSON.stringify(serializeGame(game));
    const restored = restoreGame({ id: 'test-id', mode: 'mp', state: serialized });
    expect(restored.tokens.p1).toBe('tok1');
    expect(restored.tokens.p2).toBe('tok2');
  });

  test('handles null boards gracefully', () => {
    const game = makeGame();
    game.boards.p1 = null;
    game.ships.p1 = null;
    const serialized = JSON.stringify(serializeGame(game));
    const restored = restoreGame({ id: 'test-id', mode: 'ai', state: serialized });
    expect(restored.boards.p1).toBeNull();
  });
});

// --- processShot ---

describe('processShot', () => {
  const { stmts } = require('../src/db');

  function makeGame() {
    const ships = [
      { x: 0, y: 0, horizontal: true },  // Carrier (5)
      { x: 0, y: 1, horizontal: true },  // Battleship (4)
      { x: 0, y: 2, horizontal: true },  // Cruiser (3)
      { x: 0, y: 3, horizontal: true },  // Submarine (3)
      { x: 0, y: 4, horizontal: true },  // Destroyer (2)
    ];
    return {
      id: 'test-id', mode: 'ai', phase: 'firing', turn: 'p1',
      ships: { p1: ships, p2: ships },
      boards: { p1: buildShipMap(ships), p2: buildShipMap(ships) },
      shots: { p1: createShotMap(), p2: createShotMap() },
      hits: { p1: {}, p2: {} }, turnCount: 0, winner: null,
      sockets: {}, ready: {},
    };
  }

  beforeEach(() => jest.clearAllMocks());

  test('registers a miss', () => {
    const game = makeGame();
    const result = processShot(game, 'p1', 9, 9);
    expect(result.result).toBe('miss');
    expect(result.sunk).toBeNull();
    expect(result.winner).toBeNull();
    expect(game.shots.p1.get(key(9, 9))).toBe('miss');
    expect(game.turn).toBe('p2');
  });

  test('registers a hit', () => {
    const game = makeGame();
    const result = processShot(game, 'p1', 0, 0); // hits Carrier
    expect(result.result).toBe('hit');
    expect(result.sunk).toBeNull();
    expect(game.hits.p1[0]).toBe(1);
  });

  test('sinks a ship', () => {
    const game = makeGame();
    // Sink the Destroyer (index 4, size 2) at (0,4) and (1,4)
    processShot(game, 'p1', 0, 4);
    game.turn = 'p1'; // force turn back
    const result = processShot(game, 'p1', 1, 4);
    expect(result.result).toBe('hit');
    expect(result.sunk).toBe('Destroyer');
  });

  test('detects winner when all ships sunk', () => {
    const game = makeGame();
    // Sink every p2 ship cell
    const allCells = [];
    game.boards.p2.forEach((_, k) => {
      const [x, y] = k.split(',').map(Number);
      allCells.push({ x, y });
    });
    for (const { x, y } of allCells) {
      game.turn = 'p1';
      processShot(game, 'p1', x, y);
    }
    expect(game.winner).toBe('p1');
    expect(game.phase).toBe('finished');
  });

  test('rejects duplicate shot', () => {
    const game = makeGame();
    processShot(game, 'p1', 5, 5);
    game.turn = 'p1';
    const result = processShot(game, 'p1', 5, 5);
    expect(result.error).toBe('Already fired there');
  });

  test('rejects out-of-bounds shot', () => {
    const game = makeGame();
    expect(processShot(game, 'p1', -1, 0).error).toBe('Out of bounds');
    expect(processShot(game, 'p1', 10, 0).error).toBe('Out of bounds');
    expect(processShot(game, 'p1', 0, -1).error).toBe('Out of bounds');
    expect(processShot(game, 'p1', 0, 10).error).toBe('Out of bounds');
  });

  test('records move to SQLite', () => {
    const game = makeGame();
    processShot(game, 'p1', 9, 9);
    expect(stmts.insertMove.run).toHaveBeenCalledWith('test-id', 'p1', 9, 9, 'miss', 1);
  });
});
