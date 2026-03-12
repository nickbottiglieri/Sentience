const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { createAdapter } = require('@socket.io/redis-adapter');
const { registerRoutes } = require('./src/routes');
const { registerSocketHandlers } = require('./src/socketHandlers');
const gameStore = require('./src/gameStore');
const db = require('./src/db');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

async function start() {
  await db.init();
  gameStore.init();

  // Wire up Redis adapter for multi-process Socket.IO if Redis is available
  const redisClient = gameStore.getRedisClient();
  if (redisClient) {
    const pubClient = redisClient.duplicate();
    const subClient = redisClient.duplicate();
    pubClient.on('error', (err) => console.error('Redis pub error:', err.message));
    subClient.on('error', (err) => console.error('Redis sub error:', err.message));
    io.adapter(createAdapter(pubClient, subClient));
    console.log('Socket.IO Redis adapter enabled');
  }

  app.use(express.static(path.join(__dirname, 'public')));
  app.use(express.json());

  registerRoutes(app);
  registerSocketHandlers(io);

  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => console.log(`Battleship running on http://localhost:${PORT}`));
}

start().catch(err => { console.error('Failed to start:', err); process.exit(1); });

// --- Graceful shutdown ---
const SHUTDOWN_TIMEOUT = 10000;

async function shutdown(signal) {
  console.log(`${signal} received — draining connections...`);
  // Stop accepting new connections
  server.close();
  // Disconnect all sockets (clients will attempt reconnect to another instance)
  io.close();
  // Close Redis
  const redis = gameStore.getRedisClient();
  if (redis) await redis.quit().catch(() => {});
  console.log('Shutdown complete');
  process.exit(0);
}

// Force exit if drain takes too long
function forceExit(signal) {
  shutdown(signal);
  setTimeout(() => {
    console.error('Forced shutdown — drain timeout exceeded');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT).unref();
}

process.on('SIGTERM', () => forceExit('SIGTERM'));
process.on('SIGINT', () => forceExit('SIGINT'));
