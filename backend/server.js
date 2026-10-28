// PassFlow Backend Server
import http from 'http';
import { Server } from 'socket.io';
import app from './src/app.js';
import config from './src/config/index.js';
import logger from './src/errorlogging/logger.js';
import { checkDatabaseConnections } from './src/db/index.js';
import { tradeSettlementService, settlementRecoveryWorker } from './src/services/settlement/index.js';
import { appLifecycleState } from './src/services/app-state.js';
import { orderService } from './src/services/order/index.js';
import { marketStreamService } from './src/services/market-stream/index.js';
import notificationService from './src/services/notification.service.js';
import monitoringService from './src/services/monitoring.service.js';
import corsOptions from './src/config/cors.js';
import prisma from './src/db/prisma.js';
import solvencyService from './src/services/solvency.service.js';

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
  cors: corsOptions,
});

// Attach MarketStreamService to Socket.IO and Services
marketStreamService.setServer(io);
orderService.setMarketStreamService(marketStreamService);
tradeSettlementService.setMarketStreamService(marketStreamService);
notificationService.setIo(io);
monitoringService.setRuntime({ io, orderService });

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
  let startedRecoveryWorker = false;
  try {
    console.log('\n==================================================');
    logger.info(`Starting PassFlow backend (${config.nodeEnv})...`);
    console.log('--------------------------------------------------');

    // 1. Establish database connectivity with active bounded query (with cold-start resilience)
    const dbTimeout = Number(process.env.DB_CONNECT_TIMEOUT_MS) || 25000;
    await checkDatabaseConnections({
      throwOnError: true,
      timeoutMs: dbTimeout,
      retries: process.env.NODE_ENV === 'test' ? 1 : 3,
      retryDelayMs: 2000,
    });

    // 2. Complete required startup settlement recovery before serving
    await recoverSettlements();

    // 3. Initialize or verify market coordinator readiness
    const coordinatorStatus = orderService?.matchingService?.checkReadiness
      ? orderService.matchingService.checkReadiness()
      : { ready: true };
    if (!coordinatorStatus.ready) {
      throw new Error(`Market coordinator not ready: ${coordinatorStatus.reason}`);
    }

    // 3b. Pre-warm and synchronize active published event orderbooks
    try {
      const activeCategories = await prisma.ticketCategory.findMany({
        where: { event: { status: 'PUBLISHED' } },
        select: { id: true, eventId: true },
      });
      for (const cat of activeCategories) {
        try {
          await orderService.matchingService.initializeAndSynchronizeMarket({
            eventId: cat.eventId,
            ticketCategoryId: cat.id,
          });
          if (typeof orderService.uncrossMarket === 'function') {
            await orderService.uncrossMarket(cat.eventId, cat.id);
          }
        } catch (mErr) {
          logger.warn(`Deferred market warmup for ${cat.eventId}:${cat.id}: ${mErr.message}`);
        }
      }
      if (activeCategories.length > 0) {
        logger.info(`Initialized and warmed ${activeCategories.length} active event orderbooks.`);
      }
    } catch (warmupErr) {
      logger.warn(`Market warmup notice: ${warmupErr.message}`);
    }

    // 3.5. Ensure authoritative cryptographic proof of solvency is initialized
    try {
      await solvencyService.verify();
    } catch (solvencyErr) {
      logger.warn(`Solvency initialization notice: ${solvencyErr.message}`);
    }

    // 4. Start settlement recovery worker only after prerequisites succeed
    if (!settlementRecoveryWorker.isRunning) {
      settlementRecoveryWorker.start();
      startedRecoveryWorker = true;
    }

    // 5. Mark application state initialized
    appLifecycleState.setInitialized(true);

    // 6. Begin listening for HTTP traffic only after all prerequisites succeed
    await new Promise((resolve, reject) => {
      const cleanupListeners = () => {
        server.off('error', onError);
        server.off('listening', onListening);
      };
      const onError = (err) => {
        cleanupListeners();
        reject(err);
      };
      const onListening = () => {
        cleanupListeners();
        logger.info(`🚀 Server running on http://localhost:${config.port} (${config.nodeEnv})`);
        logger.info(`🌐 Allowed Frontend Origin: ${config.frontendUrl}`);
        logger.info(`🔌 Socket.IO Server: Initialized & Listening`);
        console.log('==================================================\n');
        resolve();
      };

      server.once('error', onError);
      server.once('listening', onListening);
      try {
        server.listen(config.port);
      } catch (err) {
        onError(err);
      }
    });

    return server;
  } catch (err) {
    appLifecycleState.setInitialized(false);
    appLifecycleState.setStartupError(err);
    if (startedRecoveryWorker && settlementRecoveryWorker.isRunning) {
      try {
        await settlementRecoveryWorker.stop({ timeoutMs: 5000 });
      } catch (stopError) {
        logger.error('Error stopping settlement recovery worker after startup failure', stopError);
      }
    }
    if (err.code === 'EADDRINUSE') {
      logger.error(`Port ${config.port} is already in use. Stop the process using it or set PORT to an available port.`);
    }
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

export { app, server, io, settlementRecoveryWorker, marketStreamService };
export default server;
