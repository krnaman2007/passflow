import { jest } from '@jest/globals';
import {
  SettlementRecoveryWorker,
  DEFAULT_RECOVERY_INTERVAL_MS,
  DEFAULT_RECOVERY_BATCH_SIZE,
} from '../../src/services/settlement/settlement-recovery-worker.js';

describe('SettlementRecoveryWorker', () => {
  let mockSettlementService;
  let mockLogger;

  beforeEach(() => {
    mockSettlementService = {
      recoverUnsettled: jest.fn().mockResolvedValue([]),
    };
    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // --------------------------------------------------------------------------
  // 1. Worker starts and invokes recovery on schedule
  // --------------------------------------------------------------------------
  test('starts and invokes recovery on schedule with configured batch size', async () => {
    const worker = new SettlementRecoveryWorker({
      settlementService: mockSettlementService,
      intervalMs: 20,
      batchSize: 50,
      loggerInstance: mockLogger,
    });

    expect(worker.isRunning).toBe(false);
    expect(worker.batchSize).toBe(50);
    expect(worker.intervalMs).toBe(20);

    worker.start();
    expect(worker.isRunning).toBe(true);

    // Wait for the scheduled tick to fire
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(mockSettlementService.recoverUnsettled).toHaveBeenCalledWith({ batchSize: 50 });
    expect(mockLogger.info).toHaveBeenCalledWith('Settlement recovery worker started', {
      intervalMs: 20,
      batchSize: 50,
    });

    await worker.stop();
    expect(worker.isRunning).toBe(false);
  });

  // --------------------------------------------------------------------------
  // 2. Overlapping ticks are prevented
  // --------------------------------------------------------------------------
  test('prevents overlapping ticks while a tick is already in progress', async () => {
    let completeTick;
    const slowTickPromise = new Promise((resolve) => {
      completeTick = resolve;
    });

    mockSettlementService.recoverUnsettled.mockImplementationOnce(() => slowTickPromise);

    const worker = new SettlementRecoveryWorker({
      settlementService: mockSettlementService,
      intervalMs: 1000,
      loggerInstance: mockLogger,
    });

    worker.isRunning = true;

    // Start first tick
    const firstTickPromise = worker.tick();
    expect(worker.isTickInProgress).toBe(true);

    // Attempt second concurrent tick
    const secondTickResult = await worker.tick();
    expect(secondTickResult).toBeNull();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Settlement recovery tick skipped: previous tick is still in progress'
    );

    // Only one call made so far
    expect(mockSettlementService.recoverUnsettled).toHaveBeenCalledTimes(1);

    // Complete the first tick
    completeTick([{ executionId: 'exec-1', isIdempotentReplay: false }]);
    const firstTickResult = await firstTickPromise;

    expect(firstTickResult).toEqual([{ executionId: 'exec-1', isIdempotentReplay: false }]);
    expect(worker.isTickInProgress).toBe(false);

    await worker.stop();
  });

  // --------------------------------------------------------------------------
  // 3. Recovery failure is logged and does not stop future polling
  // --------------------------------------------------------------------------
  test('logs tick failures and continues future polling cycles', async () => {
    let callCount = 0;
    mockSettlementService.recoverUnsettled.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        throw new Error('Database pool connection timeout');
      }
      return [{ settlement: { id: 'settled-2' }, isIdempotentReplay: false }];
    });

    const worker = new SettlementRecoveryWorker({
      settlementService: mockSettlementService,
      intervalMs: 15,
      loggerInstance: mockLogger,
    });

    worker.start();

    // Wait enough time for at least 2 ticks to occur
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(callCount).toBeGreaterThanOrEqual(2);
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Settlement recovery tick failed unexpectedly',
      { error: 'Database pool connection timeout' }
    );
    expect(mockLogger.info).toHaveBeenCalledWith(
      'Settlement recovery processed executions',
      { count: 1 }
    );

    await worker.stop();
  });

  // --------------------------------------------------------------------------
  // 4. Worker stops cleanly and schedules no further ticks
  // --------------------------------------------------------------------------
  test('stops cleanly, clears timers, and halts further scheduling', async () => {
    const worker = new SettlementRecoveryWorker({
      settlementService: mockSettlementService,
      intervalMs: 20,
      loggerInstance: mockLogger,
    });

    worker.start();
    expect(worker.isRunning).toBe(true);

    await worker.stop();
    expect(worker.isRunning).toBe(false);
    expect(worker._timer).toBeNull();

    const callCountAfterStop = mockSettlementService.recoverUnsettled.mock.calls.length;

    // Wait an additional interval to verify no ticks fire
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mockSettlementService.recoverUnsettled.mock.calls.length).toBe(callCountAfterStop);
  });

  // --------------------------------------------------------------------------
  // 5. Shutdown handles an active in-flight tick safely
  // --------------------------------------------------------------------------
  test('waits for an in-flight tick to complete during stop()', async () => {
    let resolveInFlight;
    const inFlightPromise = new Promise((resolve) => {
      resolveInFlight = resolve;
    });

    mockSettlementService.recoverUnsettled.mockImplementationOnce(() => inFlightPromise);

    const worker = new SettlementRecoveryWorker({
      settlementService: mockSettlementService,
      intervalMs: 500,
      loggerInstance: mockLogger,
    });

    worker.isRunning = true;
    const tickPromise = worker.tick();
    expect(worker.isTickInProgress).toBe(true);

    let stopResolved = false;
    const stopPromise = worker.stop({ timeoutMs: 1000 }).then(() => {
      stopResolved = true;
    });

    // Verify stop is waiting for tick
    expect(stopResolved).toBe(false);

    // Resolve in-flight tick
    resolveInFlight([{ settlement: { id: 'settled-async' } }]);
    await tickPromise;
    await stopPromise;

    expect(stopResolved).toBe(true);
    expect(worker.isRunning).toBe(false);
    expect(worker.isTickInProgress).toBe(false);
  });

  // --------------------------------------------------------------------------
  // 6. Repeated recovery of same execution produces no duplicate financial effects
  // --------------------------------------------------------------------------
  test('repeated recovery returns idempotent replay without duplicate mutations', async () => {
    // First recovery pass produces settlement
    // Second recovery pass produces idempotent replay
    mockSettlementService.recoverUnsettled
      .mockResolvedValueOnce([
        { settlement: { id: 'settlement-100', executionId: 'exec-100' }, isIdempotentReplay: false },
      ])
      .mockResolvedValueOnce([
        { settlement: { id: 'settlement-100', executionId: 'exec-100' }, isIdempotentReplay: true },
      ]);

    const worker = new SettlementRecoveryWorker({
      settlementService: mockSettlementService,
      intervalMs: 10,
      loggerInstance: mockLogger,
    });

    worker.isRunning = true;

    // Run first recovery
    const pass1 = await worker.tick();
    expect(pass1[0].isIdempotentReplay).toBe(false);

    // Run second recovery on same execution
    const pass2 = await worker.tick();
    expect(pass2[0].isIdempotentReplay).toBe(true);
    expect(pass2[0].settlement.id).toBe('settlement-100');

    await worker.stop();
  });

  // --------------------------------------------------------------------------
  // 7. Batch continues when one execution fails
  // --------------------------------------------------------------------------
  test('batch with multiple executions continues processing when one execution fails', async () => {
    mockSettlementService.recoverUnsettled.mockResolvedValueOnce([
      { executionId: 'exec-fail', settled: false, error: new Error('Invariant violated') },
      { settlement: { id: 'settlement-success', executionId: 'exec-success' }, isIdempotentReplay: false },
    ]);

    const worker = new SettlementRecoveryWorker({
      settlementService: mockSettlementService,
      intervalMs: 1000,
      loggerInstance: mockLogger,
    });

    worker.isRunning = true;
    const results = await worker.tick();

    expect(results).toHaveLength(2);
    expect(results[0].settled).toBe(false);
    expect(results[1].settlement.id).toBe('settlement-success');

    // Structured logging of failures
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Settlement recovery found executions requiring intervention',
      {
        failedCount: 1,
        executionIds: ['exec-fail'],
      }
    );

    await worker.stop();
  });

  // --------------------------------------------------------------------------
  // 8. Bounded batch size configuration
  // --------------------------------------------------------------------------
  test('enforces bounds on batchSize and intervalMs', () => {
    const worker1 = new SettlementRecoveryWorker({
      batchSize: 9999,
      intervalMs: -50,
      loggerInstance: mockLogger,
    });
    expect(worker1.batchSize).toBe(500); // Capped at 500
    expect(worker1.intervalMs).toBe(DEFAULT_RECOVERY_INTERVAL_MS); // Non-positive falls back to default

    const worker2 = new SettlementRecoveryWorker({
      batchSize: 0,
      intervalMs: 0,
      loggerInstance: mockLogger,
    });
    expect(worker2.batchSize).toBe(1); // Min 1
    expect(worker2.intervalMs).toBe(DEFAULT_RECOVERY_INTERVAL_MS); // 0 falls back to default
  });
});
