jest.mock('../src/db', () => ({
  stmts: {
    insertMove: { run: jest.fn() },
    updateGame: { run: jest.fn() },
    saveState: { run: jest.fn() },
  },
}));

const { aiPlaceShips, aiTakeTurn } = require('../src/ai');
const { SHIPS, BOARD_SIZE, key, validatePlacement, buildShipMap, createShotMap } = require('../src/game');

describe('aiPlaceShips', () => {
  test('produces a valid placement', () => {
    for (let i = 0; i < 50; i++) {
      expect(validatePlacement(aiPlaceShips())).toBe(true);
    }
  });

  test('returns correct number of ships', () => {
    expect(aiPlaceShips()).toHaveLength(SHIPS.length);
  });

  test('all ships are within bounds', () => {
    const ships = aiPlaceShips();
    ships.forEach((ship, i) => {
      const size = SHIPS[i].size;
      for (let j = 0; j < size; j++) {
        const cx = ship.horizontal ? ship.x + j : ship.x;
        const cy = ship.horizontal ? ship.y : ship.y + j;
        expect(cx).toBeGreaterThanOrEqual(0);
        expect(cx).toBeLessThan(BOARD_SIZE);
        expect(cy).toBeGreaterThanOrEqual(0);
        expect(cy).toBeLessThan(BOARD_SIZE);
      }
    });
  });
});

describe('aiTakeTurn', () => {
  function makeGame() {
    const p1Ships = aiPlaceShips();
    const p2Ships = aiPlaceShips();
    return {
      id: 'test', mode: 'ai', phase: 'firing', turn: 'p2',
      ships: { p1: p1Ships, p2: p2Ships },
      boards: { p1: buildShipMap(p1Ships), p2: buildShipMap(p2Ships) },
      shots: { p1: createShotMap(), p2: createShotMap() },
      hits: { p1: {}, p2: {} }, turnCount: 0, winner: null,
      sockets: {}, ready: {}, aiState: null,
    };
  }

  test('never fires on the same cell twice', () => {
    const game = makeGame();
    const fired = new Set();
    for (let i = 0; i < BOARD_SIZE * BOARD_SIZE; i++) {
      if (game.winner) break;
      game.turn = 'p2';
      const { x, y } = aiTakeTurn(game);
      const k = key(x, y);
      expect(fired.has(k)).toBe(false);
      fired.add(k);
    }
  });

  test('all shots are within bounds', () => {
    const game = makeGame();
    for (let i = 0; i < 30; i++) {
      if (game.winner) break;
      game.turn = 'p2';
      const { x, y } = aiTakeTurn(game);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(BOARD_SIZE);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThan(BOARD_SIZE);
    }
  });

  test('eventually sinks all ships', () => {
    const game = makeGame();
    for (let i = 0; i < BOARD_SIZE * BOARD_SIZE; i++) {
      if (game.winner) break;
      game.turn = 'p2';
      aiTakeTurn(game);
    }
    expect(game.winner).toBe('p2');
  });

  test('survives aiState serialization round-trip', () => {
    const game = makeGame();
    // Take a few turns
    for (let i = 0; i < 5; i++) {
      game.turn = 'p2';
      aiTakeTurn(game);
    }
    // Simulate persistence round-trip (aiState gets JSON serialized/parsed)
    game.aiState = JSON.parse(JSON.stringify(game.aiState));
    // Should continue without error or duplicate shots
    game.turn = 'p2';
    const { x, y } = aiTakeTurn(game);
    expect(x).toBeGreaterThanOrEqual(0);
    expect(x).toBeLessThan(BOARD_SIZE);
  });
});
