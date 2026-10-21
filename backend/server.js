import http from 'http';
import { Server } from 'socket.io';
import app from './src/app.js';
import config from './src/config/index.js';
import logger from './src/errorlogging/logger.js';
import { checkDatabaseConnections } from './src/db/index.js';

const server = http.createServer(app);

// Socket.IO Setup
const io = new Server(server, {
  cors: {
    origin: config.frontendUrl,
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

io.on('connection', (socket) => {
  logger.info(`⚡ Socket client connected: ${socket.id}`);

  socket.on('ping-server', (data) => {
    socket.emit('pong-client', {
      message: 'Socket connection healthy!',
      received: data,
      timestamp: new Date().toISOString(),
    });
  });

  socket.on('disconnect', () => {
    logger.info(` Socket client disconnected: ${socket.id}`);
  });
});

server.listen(config.port, async () => {
  console.log('\n==================================================');
  logger.info(`🚀 Server running on http://localhost:${config.port} (${config.nodeEnv})`);
  logger.info(`🌐 Allowed Frontend Origin: ${config.frontendUrl}`);
  logger.info(`🔌 Socket.IO Server: Initialized & Listening`);
  console.log('--------------------------------------------------');
  await checkDatabaseConnections();
  console.log('==================================================\n');
});

export { app, server, io };
