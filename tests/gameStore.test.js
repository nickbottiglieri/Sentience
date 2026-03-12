jest.mock('../src/db', () => ({
  stmts: {
    getGame: { get: jest.fn().mockResolvedValue(null) },
    insertMove: { run: jest.fn().mockResolvedValue() },
    updateGame: { run: jest.fn().mockResolvedValue() },
    saveState: { run: jest.fn().mockResolvedValue() },
  },
}));

jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => ({
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    on: jest.fn(),
    duplicate: jest.fn(),
  }));
});

const { stmts } = require('../src/db');
const { buildShipMap, createShotMap, serializeGame, key } = require('../src/game');

// Fresh gameStore per test
let gameStore;
beforeEach(() => {
  jest.resetModules();
  jest.mock('../src/db', () => ({
    stmts: {
      getGame: { get: jest.fn().mockResolvedValue(null) },
      insertMove: { run: jest.fn().mockResolvedValue() },
      updateGame: { run: jest.fn().mockResolvedValue() },
      saveState: { run: jest.fn().mockResolvedValue() },
    },
  }));
  gameStore = require('../src/gameStore');
});

function makeGame(id = 'test-id') {
  const ships = [
    { x: 0, y: 0, horizontal: true },
    { x: 0, y: 1, horizontal: true },
    { x: 0, y: 2, horizontal: true },
    { x: 0, y: 3, horizontal: true },
    { x: 0, y: 4, horizontal: true },
  ];
  return {
    id, mode: 'ai', phase: 'firing', turn: 'p1',
    ships: { p1: ships, p2: ships },
    boards: { p1: buildShipMap(ships), p2: buildShipMap(ships) },
    shots: { p1: createShotMap(), p2: createShotMap() },
    hits: { p1: {}, p2: {} }, turnCount: 0, winner: null,
    sockets: { p1: 'sock1' }, ready: { p1: true },
    aiState: null, tokens: { p1: 'tok1' },
  };
}

describe('gameStore (in-memory fallback)', () => {
  test('save and retrieve a game', async () => {
    const game = makeGame();
    await gameStore.saveGame(game);
    const retrieved = await gameStore.getGame('test-id');
    expect(retrieved).not.toBeNull();
    expect(retrieved.phase).toBe('firing');
    expect(retrieved.turn).toBe('p1');
  });

  test('returns null for unknown game', async () => {
    const result = await gameStore.getGame('nonexistent');
    expect(result).toBeNull();
  });

  test('deleteGame removes game', async () => {
    const game = makeGame();
    await gameStore.saveGame(game);
    await gameStore.deleteGame('test-id');
    const result = await gameStore.getGame('test-id');
    expect(result).toBeNull();
  });

  test('preserves ephemeral socket state across get calls', async () => {
    const game = makeGame();
    game.sockets = { p1: 'socket-abc' };
    game.ready = { p1: true };
    await gameStore.saveGame(game);
    const retrieved = await gameStore.getGame('test-id');
    expect(retrieved.sockets.p1).toBe('socket-abc');
    expect(retrieved.ready.p1).toBe(true);
  });

  test('falls back to SQLite when not in memory', async () => {
    const { stmts } = require('../src/db');
    const game = makeGame();
    const serialized = JSON.stringify(serializeGame(game));
    stmts.getGame.get.mockResolvedValue({ id: 'test-id', mode: 'ai', state: serialized });
    const retrieved = await gameStore.getGame('test-id');
    expect(retrieved).not.toBeNull();
    expect(retrieved.phase).toBe('firing');
    expect(stmts.getGame.get).toHaveBeenCalledWith('test-id');
  });

  test('preserves ready state across save/get cycle', async () => {
    const game = makeGame();
    game.ready = { p1: true };
    await gameStore.saveGame(game);
    const retrieved = await gameStore.getGame('test-id');
    expect(retrieved.ready.p1).toBe(true);
    expect(retrieved.ready.p2).toBeUndefined();
  });

  test('deleteGame clears socket state', async () => {
    const game = makeGame();
    game.sockets = { p1: 'sock1' };
    await gameStore.saveGame(game);
    await gameStore.deleteGame('test-id');
    // New game with same ID should have clean socket state
    const game2 = makeGame();
    game2.sockets = {};
    await gameStore.saveGame(game2);
    const retrieved = await gameStore.getGame('test-id');
    expect(retrieved.sockets.p1).toBeUndefined();
  });

  test('withLock executes callback and returns result (no-op without Redis)', async () => {
    const result = await gameStore.withLock('test-id', async () => {
      return 'done';
    });
    expect(result).toBe('done');
  });

  test('withLock propagates errors from callback', async () => {
    await expect(
      gameStore.withLock('test-id', async () => { throw new Error('boom'); })
    ).rejects.toThrow('boom');
  });
});
