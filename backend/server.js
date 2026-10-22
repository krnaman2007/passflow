import http from 'http';
import { Server } from 'socket.io';
import app from './src/app.js';
import config from './src/config/index.js';
import logger from './src/errorlogging/logger.js';
import { checkDatabaseConnections } from './src/db/index.js';
import { tradeSettlementService, settlementRecoveryWorker } from './src/services/settlement/index.js';

const server = http.createServer(app);

const recoverSettlements = async () => {
  try {
    const recovery = await tradeSettlementService.recoverUnsettled({ batchSize: 100 });
    const failures = recovery.filter((result) => result.settled === false);
    if (failures.length > 0) {
      logger.error('Settlement recovery found executions requiring intervention', {
        executionIds: failures.map((result) => result.executionId),
      });
    } else if (recovery.length > 0) {
      logger.info('Recovered unsettled executions', { count: recovery.length });
    }
  } catch (error) {
    // Startup remains available; a subsequent bounded pass can retry.
    logger.error('Settlement recovery could not query durable execution state', error);
  }
};

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
  // Bounded at-least-once recovery on startup. Multiple instances are safe because each
  // attempt claims its Execution row inside the settlement transaction.
  await recoverSettlements();
  // Start the recurring recovery worker for post-match executions interrupted while running
  settlementRecoveryWorker.start();
  console.log('==================================================\n');
});

let isShuttingDown = false;
const gracefulShutdown = async (signal) => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  logger.info(`Received ${signal}. Shutting down gracefully...`);
  try {
    await settlementRecoveryWorker.stop({ timeoutMs: 5000 });
  } catch (err) {
    logger.error('Error stopping settlement recovery worker during shutdown', err);
  }
  server.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

export { app, server, io, settlementRecoveryWorker };
