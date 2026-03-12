const { stmts } = require('./db');
const gameStore = require('./gameStore');

const startTime = Date.now();

function registerRoutes(app) {
  app.get('/api/health', async (req, res) => {
    const redis = gameStore.getRedisClient();
    let redisOk = false;
    if (redis) {
      try { await redis.ping(); redisOk = true; } catch {}
    }
    res.json({
      status: 'ok',
      uptime: Math.floor((Date.now() - startTime) / 1000),
      redis: redis ? (redisOk ? 'connected' : 'error') : 'disabled',
    });
  });

  app.get('/api/history', async (req, res) => {
    res.json(await stmts.getHistory.all());
  });
  app.get('/api/history/:id', async (req, res) => {
    const game = await stmts.getGame.get(req.params.id);
    const moves = await stmts.getGameMoves.all(req.params.id);
    if (!game) return res.status(404).json({ error: 'Not found' });
    res.json({ game, moves });
  });
}

module.exports = { registerRoutes };
