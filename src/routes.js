const { stmts } = require('./db');

function registerRoutes(app) {
  app.get('/api/history', (req, res) => {
    res.json(stmts.getHistory.all());
  });
  app.get('/api/history/:id', (req, res) => {
    const game = stmts.getGame.get(req.params.id);
    const moves = stmts.getGameMoves.all(req.params.id);
    if (!game) return res.status(404).json({ error: 'Not found' });
    res.json({ game, moves });
  });
}

module.exports = { registerRoutes };
