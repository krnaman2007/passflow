/**
 * Deep Readiness Evaluation Service
 *
 * Verifies that:
 * 1. Database is reachable and responsive via a bounded lightweight query (`SELECT 1`).
 * 2. Application startup initialization has completed and shutdown has not commenced.
 * 3. Market matching coordinator is initialized, has no corrupted markets, and is not actively reconciling.
 *
 * Returns clean, safe status without exposing database connection strings, credentials, or SQL details.
 */
import { prisma as defaultPrisma } from '../db/prisma.js';
import { appLifecycleState as defaultAppState } from './app-state.js';
import { orderService as defaultOrderService } from './order/index.js';

export const DEFAULT_DB_TIMEOUT_MS = 3000;

/**
 * Executes a lightweight bounded query against PostgreSQL.
 *
 * @param {Object} [options]
 * @param {number} [options.timeoutMs=3000]
 * @param {import('@prisma/client').PrismaClient} [options.prismaClient]
 * @returns {Promise<{ healthy: boolean, error?: string }>}
 */
export async function checkDatabaseReadiness({
  timeoutMs = DEFAULT_DB_TIMEOUT_MS,
  prismaClient = defaultPrisma,
} = {}) {
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('Database connectivity check timed out')), timeoutMs);
    if (timer.unref) timer.unref();
  });

  try {
    await Promise.race([
      prismaClient.$queryRaw`SELECT 1`,
      timeoutPromise,
    ]);
    return { healthy: true };
  } catch (err) {
    return { healthy: false, error: err.message || 'Database query error' };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Evaluates full backend readiness across database, startup state, and matching coordinator.
 *
 * @param {Object} [options]
 * @param {number} [options.timeoutMs=3000]
 * @param {import('@prisma/client').PrismaClient} [options.prismaClient]
 * @param {import('./app-state.js').AppLifecycleState} [options.appState]
 * @param {import('./order/order-service.js').OrderService} [options.orderServiceInstance]
 * @returns {Promise<{ ready: boolean, statusCode: number, body: Object }>}
 */
export async function evaluateReadiness({
  timeoutMs = DEFAULT_DB_TIMEOUT_MS,
  prismaClient = defaultPrisma,
  appState = defaultAppState,
  orderServiceInstance = defaultOrderService,
} = {}) {
  const timestamp = new Date().toISOString();

  // 1. Check application lifecycle state
  let startupStatus = 'completed';
  let startupOk = true;

  if (appState.isShuttingDown && appState.isShuttingDown()) {
    startupStatus = 'shutting_down';
    startupOk = false;
  } else if (!appState.isInitialized || !appState.isInitialized()) {
    startupStatus = 'in_progress';
    startupOk = false;
  }

  // 2. Perform bounded database health query
  const dbResult = await checkDatabaseReadiness({ timeoutMs, prismaClient });
  const databaseStatus = dbResult.healthy ? 'healthy' : 'unhealthy';

  // 3. Verify matching coordinator readiness signals
  let matchingStatus = 'ready';
  let matchingOk = true;
  if (orderServiceInstance && typeof orderServiceInstance.checkReadiness === 'function') {
    const coordinatorResult = orderServiceInstance.checkReadiness();
    if (!coordinatorResult.ready) {
      matchingStatus = 'degraded';
      matchingOk = false;
    }
  }

  const isReady = startupOk && dbResult.healthy && matchingOk;
  const statusCode = isReady ? 200 : 503;

  return {
    ready: isReady,
    statusCode,
    body: {
      status: isReady ? 'ready' : 'not_ready',
      timestamp,
      checks: {
        database: databaseStatus,
        startup: startupStatus,
        matching: matchingStatus,
      },
    },
  };
}

export default {
  checkDatabaseReadiness,
  evaluateReadiness,
};
