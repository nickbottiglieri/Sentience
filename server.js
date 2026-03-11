const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { registerRoutes } = require('./src/routes');
const { registerSocketHandlers } = require('./src/socketHandlers');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

registerRoutes(app);
registerSocketHandlers(io);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Battleship running on http://localhost:${PORT}`));
