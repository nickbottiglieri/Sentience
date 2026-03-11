const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { createAdapter } = require('@socket.io/redis-adapter');
const { registerRoutes } = require('./src/routes');
const { registerSocketHandlers } = require('./src/socketHandlers');
const gameStore = require('./src/gameStore');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

gameStore.init();

// Wire up Redis adapter for multi-process Socket.IO if Redis is available
const redisClient = gameStore.getRedisClient();
if (redisClient) {
  const pubClient = redisClient.duplicate();
  const subClient = redisClient.duplicate();
  io.adapter(createAdapter(pubClient, subClient));
  console.log('Socket.IO Redis adapter enabled');
}

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

registerRoutes(app);
registerSocketHandlers(io);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Battleship running on http://localhost:${PORT}`));
