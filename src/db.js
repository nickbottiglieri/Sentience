const { Pool } = require('pg');

const hasDB = !!process.env.DATABASE_URL;

const pool = hasDB ? new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('railway') ? { rejectUnauthorized: false } : undefined,
}) : null;

async function init() {
  if (!pool) { console.log('No DATABASE_URL — game history disabled'); return; }
  await pool.query(`
    CREATE TABLE IF NOT EXISTS games (
      id TEXT PRIMARY KEY,
      mode TEXT,
      state TEXT,
      winner TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      finished_at TIMESTAMPTZ
    );
    CREATE TABLE IF NOT EXISTS moves (
      id SERIAL PRIMARY KEY,
      game_id TEXT REFERENCES games(id),
      player TEXT,
      x INTEGER,
      y INTEGER,
      result TEXT,
      turn_number INTEGER,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
}

const noop = async () => {};
const noopGet = async () => null;
const noopAll = async () => [];

const stmts = pool ? {
  createGame: {
    run: (id, mode, state) => pool.query('INSERT INTO games (id, mode, state) VALUES ($1, $2, $3)', [id, mode, state]),
  },
  updateGame: {
    run: (state, winner, id) => pool.query('UPDATE games SET state = $1, winner = $2, finished_at = NOW() WHERE id = $3', [state, winner, id]),
  },
  saveState: {
    run: (state, id) => pool.query('UPDATE games SET state = $1 WHERE id = $2', [state, id]),
  },
  getGame: {
    get: async (id) => { const r = await pool.query('SELECT * FROM games WHERE id = $1', [id]); return r.rows[0] || null; },
  },
  insertMove: {
    run: (gameId, player, x, y, result, turnNumber) =>
      pool.query('INSERT INTO moves (game_id, player, x, y, result, turn_number) VALUES ($1, $2, $3, $4, $5, $6)', [gameId, player, x, y, result, turnNumber]),
  },
  getHistory: {
    all: async () => {
      const r = await pool.query(
        `SELECT g.id, g.mode, g.winner, g.created_at::text, g.finished_at::text, COUNT(m.id)::int as total_moves
         FROM games g LEFT JOIN moves m ON g.id = m.game_id
         WHERE g.winner IS NOT NULL GROUP BY g.id ORDER BY g.finished_at DESC LIMIT 50`
      );
      return r.rows;
    },
  },
  getGameMoves: {
    all: async (gameId) => {
      const r = await pool.query('SELECT player, x, y, result, turn_number, created_at FROM moves WHERE game_id = $1 ORDER BY turn_number', [gameId]);
      return r.rows;
    },
  },
} : {
  createGame: { run: noop },
  updateGame: { run: noop },
  saveState: { run: noop },
  getGame: { get: noopGet },
  insertMove: { run: noop },
  getHistory: { all: noopAll },
  getGameMoves: { all: noopAll },
};

module.exports = { pool, stmts, init };
