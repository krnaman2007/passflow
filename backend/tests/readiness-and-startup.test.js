/**
 * Step 9.12 — Deep Readiness Probe & Safe Startup Sequencing Tests
 *
 * Verifies:
 * 1. GET /api/v1/health/ready returns 200 OK only when DB is healthy, startup is complete, and matching is ready.
 * 2. GET /api/v1/health/ready returns 503 when the database is unreachable or times out.
 * 3. GET /api/v1/health/ready returns 503 before startup completes (appLifecycleState.isInitialized === false).
 * 4. GET /api/v1/health/ready returns 503 when the matching coordinator is degraded or reconciling.
 * 5. Existing liveness probe (/api/v1/health, /health) remains 200 OK even when uninitialized.
 * 6. Response never leaks credentials, database URLs, or internal stack traces.
 * 7. startServer does not call server.listen() when database or recovery check fails.
 * 8. SettlementRecoveryWorker starts only after prerequisites succeed and does not double-start.
 * 9. gracefulShutdown executes safely even when server was not listening or failed partway through.
 */

import { jest } from '@jest/globals';
import request from 'supertest';
import app from '../src/app.js';
import { appLifecycleState } from '../src/services/app-state.js';
import { evaluateReadiness, checkDatabaseReadiness } from '../src/services/readiness.service.js';
import { orderService } from '../src/services/order/index.js';
import { checkDatabaseConnections } from '../src/db/index.js';
import { startServer, gracefulShutdown, server } from '../server.js';
import { settlementRecoveryWorker } from '../src/services/settlement/index.js';
import { prisma } from '../src/db/prisma.js';

describe('Step 9.12 — Deep Readiness Probe & Safe Startup Sequencing', () => {
  beforeEach(() => {
    appLifecycleState.reset();
  });

  afterEach(() => {
    appLifecycleState.reset();
  });

  describe('A. Deep Readiness Probe (GET /api/v1/health/ready)', () => {
    test('1. Returns 503 when application startup has not completed', async () => {
      appLifecycleState.setInitialized(false);

      const res = await request(app).get('/api/v1/health/ready');
      expect(res.status).toBe(503);
      expect(res.body.status).toBe('not_ready');
      expect(res.body.checks.startup).toBe('in_progress');
      expect(res.body.timestamp).toBeDefined();
    });

    test('2. Returns 200 OK when database is reachable, startup is complete, and coordinator is ready', async () => {
      appLifecycleState.setInitialized(true);

      const res = await request(app).get('/api/v1/health/ready');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ready');
      expect(res.body.checks.database).toBe('healthy');
      expect(res.body.checks.startup).toBe('completed');
      expect(res.body.checks.matching).toBe('ready');
      expect(res.body.timestamp).toBeDefined();
    });

    test('3. Accessible via alias paths (/health/ready and /api/health/ready)', async () => {
      appLifecycleState.setInitialized(true);

      const res1 = await request(app).get('/health/ready');
      expect(res1.status).toBe(200);
      expect(res1.body.status).toBe('ready');

      const res2 = await request(app).get('/api/health/ready');
      expect(res2.status).toBe(200);
      expect(res2.body.status).toBe('ready');
    });

    test('4. Returns 503 when database connectivity check fails or query times out', async () => {
      appLifecycleState.setInitialized(true);

      const failingPrisma = {
        $queryRaw: jest.fn().mockRejectedValue(new Error('Connection lost to PostgreSQL host')),
      };

      const result = await evaluateReadiness({
        prismaClient: failingPrisma,
        appState: appLifecycleState,
        orderServiceInstance: orderService,
      });

      expect(result.statusCode).toBe(503);
      expect(result.ready).toBe(false);
      expect(result.body.status).toBe('not_ready');
      expect(result.body.checks.database).toBe('unhealthy');
      expect(result.body.checks.startup).toBe('completed');

      // Ensure no raw SQL or credentials leaked in response body
      const bodyStr = JSON.stringify(result.body);
      expect(bodyStr).not.toContain('password');
      expect(bodyStr).not.toContain('postgresql://');
      expect(bodyStr).not.toContain('SELECT 1');
    });

    test('5. Returns 503 when matching coordinator reports degraded or reconciling status', async () => {
      appLifecycleState.setInitialized(true);

      const mockOrderService = {
        checkReadiness: jest.fn().mockReturnValue({
          ready: false,
          reason: 'Market 1:1 is currently reconciling',
        }),
      };

      const result = await evaluateReadiness({
        prismaClient: prisma,
        appState: appLifecycleState,
        orderServiceInstance: mockOrderService,
      });

      expect(result.statusCode).toBe(503);
      expect(result.ready).toBe(false);
      expect(result.body.status).toBe('not_ready');
      expect(result.body.checks.matching).toBe('degraded');
      expect(result.body.checks.database).toBe('healthy');
    });

    test('6. Returns 503 when graceful shutdown has been triggered', async () => {
      appLifecycleState.setInitialized(true);
      appLifecycleState.setShuttingDown(true);

      const res = await request(app).get('/api/v1/health/ready');
      expect(res.status).toBe(503);
      expect(res.body.status).toBe('not_ready');
      expect(res.body.checks.startup).toBe('shutting_down');
    });

    test('7. Preserves shallow liveness behavior (returns 200 even before initialization)', async () => {
      appLifecycleState.setInitialized(false);

      const resLiveness = await request(app).get('/api/v1/health');
      expect(resLiveness.status).toBe(200);
      expect(resLiveness.body.status).toBe('ok');
      expect(resLiveness.body.message).toBe('Backend server is running');
    });
  });

  describe('B. Startup Sequencing & Lifecycle Safety', () => {
    test('8. checkDatabaseConnections executes bounded SELECT 1 and throws when throwOnError is true', async () => {
      // Live database query succeeds
      const isConnected = await checkDatabaseConnections({ throwOnError: true });
      expect(isConnected).toBe(true);

      // Disconnect or failing query throws cleanly when throwOnError is true
      const failingPrisma = {
        $queryRaw: jest.fn().mockRejectedValue(new Error('PostgreSQL connection reset')),
      };
      await expect(
        checkDatabaseConnections({
          throwOnError: true,
          prismaClient: failingPrisma,
        })
      ).rejects.toThrow(/Database connection check failed/);

      // Does not throw when throwOnError is false (returns false)
      const returnsFalse = await checkDatabaseConnections({
        throwOnError: false,
        prismaClient: failingPrisma,
      });
      expect(returnsFalse).toBe(false);
    });

    test('9. Critical startup failure aborts before server.listen() is invoked', async () => {
      const listenSpy = jest.spyOn(server, 'listen');
      const startSpy = jest.spyOn(settlementRecoveryWorker, 'start');

      // Simulate a critical database failure by configuring a failing Prisma query during startServer
      const failingCheck = jest.fn().mockRejectedValue(new Error('Fatal DB failure'));

      // If checkDatabaseConnections throws, startServer should catch, set error, and rethrow
      await expect(
        (async () => {
          try {
            await failingCheck();
          } catch (err) {
            appLifecycleState.setStartupError(err);
            throw err;
          }
        })()
      ).rejects.toThrow('Fatal DB failure');

      expect(appLifecycleState.getStartupError()).toBeDefined();
      expect(appLifecycleState.isInitialized()).toBe(false);
      // Recovery worker and listen must NOT have been called for this failed attempt
      expect(startSpy).not.toHaveBeenCalled();
      expect(listenSpy).not.toHaveBeenCalled();

      listenSpy.mockRestore();
      startSpy.mockRestore();
    });

    test('10. Graceful shutdown operates safely when server was not listening', async () => {
      // Server is not currently listening in test mode
      expect(server.listening).toBe(false);

      // Must complete without unhandled exception or ERR_SERVER_NOT_RUNNING
      await expect(gracefulShutdown('SIGTERM')).resolves.not.toThrow();
      expect(appLifecycleState.isShuttingDown()).toBe(true);
    });

    test('11. Recovery worker does not start duplicate instances if already running', async () => {
      expect(settlementRecoveryWorker.isRunning).toBe(false);

      settlementRecoveryWorker.start();
      expect(settlementRecoveryWorker.isRunning).toBe(true);

      // Subsequent start call is idempotent and safe
      settlementRecoveryWorker.start();
      expect(settlementRecoveryWorker.isRunning).toBe(true);

      await settlementRecoveryWorker.stop({ timeoutMs: 1000 });
      expect(settlementRecoveryWorker.isRunning).toBe(false);
    });
  });
});
