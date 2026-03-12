const Redis = require('ioredis');
const { serializeGame, restoreGame } = require('./game');
const { stmts } = require('./db');

const REDIS_URL = process.env.REDIS_URL;
const GAME_TTL = 3600; // 1 hour

let redis = null;

function init() {
  if (!REDIS_URL) { console.log('No REDIS_URL — using in-memory game store'); return; }
  redis = new Redis(REDIS_URL);
  redis.on('error', (err) => console.error('Redis error:', err));
  console.log('Using Redis game store');
}

// In-memory fallback (also used for socket mappings with Redis)
const localGames = {};
// Socket state is ephemeral — always in-memory
const socketMap = {}; // gameId -> { sockets: {} }

function getSocketState(id) {
  if (!socketMap[id]) socketMap[id] = { sockets: {} };
  return socketMap[id];
}

async function getGame(id) {
  let game;
  if (redis) {
    const data = await redis.get(`game:${id}`);
    if (data) game = restoreGame({ id, state: data, mode: JSON.parse(data).mode });
  } else {
    game = localGames[id] || null;
  }
  // Fall back to SQLite
  if (!game) {
    const row = await stmts.getGame.get(id);
    if (row && row.state) game = restoreGame(row);
  }
  if (!game) return null;
  // Attach ephemeral socket state
  const ss = getSocketState(id);
  game.sockets = ss.sockets;
  return game;
}

async function saveGame(game) {
  const serialized = JSON.stringify(serializeGame(game));
  if (redis) await redis.set(`game:${game.id}`, serialized, 'EX', GAME_TTL);
  else localGames[game.id] = game;
  // Persist ephemeral state
  socketMap[game.id] = { sockets: game.sockets };
  return serialized;
}

async function deleteGame(id) {
  if (redis) await redis.del(`game:${id}`);
  else delete localGames[id];
  delete socketMap[id];
}

const LOCK_TTL = 5000; // 5s auto-expire to prevent deadlocks
const LOCK_RETRY_DELAY = 50;
const LOCK_MAX_RETRIES = 20;

async function acquireLock(gameId) {
  if (!redis) return true; // no-op in single-process mode
  const lockKey = `lock:${gameId}`;
  for (let i = 0; i < LOCK_MAX_RETRIES; i++) {
    const acquired = await redis.set(lockKey, '1', 'PX', LOCK_TTL, 'NX');
    if (acquired) return true;
    await new Promise(r => setTimeout(r, LOCK_RETRY_DELAY));
  }
  console.error(`Failed to acquire lock for game ${gameId}`);
  return false;
}

async function releaseLock(gameId) {
  if (!redis) return;
  await redis.del(`lock:${gameId}`);
}

async function withLock(gameId, fn) {
  if (!await acquireLock(gameId)) throw new Error('Lock timeout');
  try { return await fn(); }
  finally { await releaseLock(gameId); }
}

function getRedisClient() { return redis; }

module.exports = { init, getGame, saveGame, deleteGame, getRedisClient, withLock };
