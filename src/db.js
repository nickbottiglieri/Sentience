const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, '..', 'battleship.db'));
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS games (
    id TEXT PRIMARY KEY,
    mode TEXT,
    state TEXT,
    winner TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    finished_at TEXT
  );
  CREATE TABLE IF NOT EXISTS moves (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id TEXT,
    player TEXT,
    x INTEGER,
    y INTEGER,
    result TEXT,
    turn_number INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(game_id) REFERENCES games(id)
  );
`);

const stmts = {
  createGame: db.prepare('INSERT INTO games (id, mode, state) VALUES (?, ?, ?)'),
  updateGame: db.prepare("UPDATE games SET state = ?, winner = ?, finished_at = datetime('now') WHERE id = ?"),
  saveState: db.prepare('UPDATE games SET state = ? WHERE id = ?'),
  getGame: db.prepare('SELECT * FROM games WHERE id = ?'),
  insertMove: db.prepare('INSERT INTO moves (game_id, player, x, y, result, turn_number) VALUES (?, ?, ?, ?, ?, ?)'),
  getHistory: db.prepare('SELECT g.id, g.mode, g.winner, g.created_at, g.finished_at, COUNT(m.id) as total_moves FROM games g LEFT JOIN moves m ON g.id = m.game_id WHERE g.winner IS NOT NULL GROUP BY g.id ORDER BY g.finished_at DESC LIMIT 50'),
  getGameMoves: db.prepare('SELECT player, x, y, result, turn_number, created_at FROM moves WHERE game_id = ? ORDER BY turn_number'),
};

module.exports = { db, stmts };
