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
      memory: process.memoryUsage(),
    });
  });

  app.get('/api/diagnostics', async (req, res) => {
    const timings = {};
    const redis = gameStore.getRedisClient();

    // Redis ping
    if (redis) {
      const t0 = performance.now();
      await redis.ping();
      timings.redisPingMs = +(performance.now() - t0).toFixed(2);

      // Redis set/get/del cycle
      const t1 = performance.now();
      await redis.set('diag:test', 'x', 'EX', 5);
      await redis.get('diag:test');
      await redis.del('diag:test');
      timings.redisSetGetDelMs = +(performance.now() - t1).toFixed(2);
    }

    // Postgres round-trip
    const { pool } = require('./db');
    if (pool) {
      const t2 = performance.now();
      await pool.query('SELECT 1');
      timings.pgPingMs = +(performance.now() - t2).toFixed(2);
    }

    // Event loop lag
    const t3 = performance.now();
    await new Promise(r => setImmediate(r));
    timings.eventLoopLagMs = +(performance.now() - t3).toFixed(2);

    timings.memory = process.memoryUsage();
    timings.activeConnections = require('socket.io').Server ? undefined : null;

    res.json(timings);
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
