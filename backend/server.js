import http from 'http';
import { Server } from 'socket.io';
import app from './src/app.js';
import config from './src/config/index.js';
import logger from './src/errorlogging/logger.js';
import { checkDatabaseConnections } from './src/db/index.js';
import { tradeSettlementService, settlementRecoveryWorker } from './src/services/settlement/index.js';
import { appLifecycleState } from './src/services/app-state.js';
import { orderService } from './src/services/order/index.js';

const server = http.createServer(app);

export const recoverSettlements = async () => {
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
    return recovery;
  } catch (error) {
    logger.error('Settlement recovery could not query durable execution state', error);
    throw error;
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

/**
 * Executes safe startup sequencing:
 * 1. Establish and verify database connectivity with bounded query.
 * 2. Complete startup settlement recovery.
 * 3. Verify market coordinator readiness.
 * 4. Start periodic settlement recovery worker.
 * 5. Set appLifecycleState to initialized.
 * 6. Begin listening for HTTP traffic only after all prerequisites succeed.
 */
export const startServer = async () => {
  try {
    console.log('\n==================================================');
    logger.info(`Starting PassFlow backend (${config.nodeEnv})...`);
    console.log('--------------------------------------------------');

    // 1. Establish database connectivity with active bounded query
    await checkDatabaseConnections({ throwOnError: true, timeoutMs: 5000 });

    // 2. Complete required startup settlement recovery before serving
    await recoverSettlements();

    // 3. Initialize or verify market coordinator readiness
    const coordinatorStatus = orderService?.matchingService?.checkReadiness
      ? orderService.matchingService.checkReadiness()
      : { ready: true };
    if (!coordinatorStatus.ready) {
      throw new Error(`Market coordinator not ready: ${coordinatorStatus.reason}`);
    }

    // 4. Start settlement recovery worker only after prerequisites succeed
    if (!settlementRecoveryWorker.isRunning) {
      settlementRecoveryWorker.start();
    }

    // 5. Mark application state initialized
    appLifecycleState.setInitialized(true);

    // 6. Begin listening for HTTP traffic only after all prerequisites succeed
    await new Promise((resolve, reject) => {
      server.listen(config.port, (err) => {
        if (err) return reject(err);
        logger.info(`🚀 Server running on http://localhost:${config.port} (${config.nodeEnv})`);
        logger.info(`🌐 Allowed Frontend Origin: ${config.frontendUrl}`);
        logger.info(`🔌 Socket.IO Server: Initialized & Listening`);
        console.log('==================================================\n');
        resolve();
      });
    });

    return server;
  } catch (err) {
    appLifecycleState.setStartupError(err);
    logger.error('❌ Critical startup failure: backend unable to start safely', err);
    if (process.env.NODE_ENV !== 'test') {
      process.exit(1);
    }
    throw err;
  }
};

let isShuttingDown = false;
export const gracefulShutdown = async (signal) => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  appLifecycleState.setShuttingDown(true);
  logger.info(`Received ${signal}. Shutting down gracefully...`);

  try {
    if (settlementRecoveryWorker && settlementRecoveryWorker.isRunning) {
      await settlementRecoveryWorker.stop({ timeoutMs: 5000 });
    }
  } catch (err) {
    logger.error('Error stopping settlement recovery worker during shutdown', err);
  }

  try {
    if (orderService?.matchingService?.releaseAllLeases) {
      await orderService.matchingService.releaseAllLeases();
    }
  } catch (err) {
    logger.error('Error releasing market leases during shutdown', err);
  }

  if (server && server.listening) {
    await new Promise((resolve) => {
      server.close(() => {
        logger.info('HTTP server closed');
        resolve();
      });
    });
  } else {
    logger.info('HTTP server was not listening; shutdown complete');
  }

  if (process.env.NODE_ENV !== 'test') {
    process.exit(0);
  }
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Auto-start when executed directly as script in non-test mode
const isDirectExecution =
  process.argv[1] &&
  (process.argv[1].endsWith('server.js') || process.argv[1].endsWith('server'));

if (isDirectExecution && process.env.NODE_ENV !== 'test') {
  startServer().catch(() => {});
}

export { app, server, io, settlementRecoveryWorker };
export default server;
