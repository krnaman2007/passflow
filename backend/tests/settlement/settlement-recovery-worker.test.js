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

  // --------------------------------------------------------------------------
  // 9. Starvation prevention: advances cursor past failing executions across ticks
  // --------------------------------------------------------------------------
  test('advances sequence cursor past failing executions across ticks to examine newer executions', async () => {
    // Tick 1: returns failing execution with sequenceNumber 10n
    mockSettlementService.recoverUnsettled.mockResolvedValueOnce([
      { executionId: 'exec-fail-old', sequenceNumber: 10n, settled: false, error: new Error('Invariant error') },
    ]);

    // Tick 2: returns newer eligible execution with sequenceNumber 25n
    mockSettlementService.recoverUnsettled.mockResolvedValueOnce([
      {
        executionId: 'exec-success-new',
        sequenceNumber: 25n,
        settlement: { id: 'settle-25', executionId: 'exec-success-new' },
        isIdempotentReplay: false,
      },
    ]);

    // Tick 3: returns empty (tail reached)
    mockSettlementService.recoverUnsettled.mockResolvedValueOnce([]);

    const worker = new SettlementRecoveryWorker({
      settlementService: mockSettlementService,
      batchSize: 10,
      intervalMs: 1000,
      loggerInstance: mockLogger,
    });

    // Initial state: cursor is null
    expect(worker.lastSeenSequenceNumber).toBeNull();

    // Tick 1: processes exec-fail-old, advances cursor to 10n
    worker.isRunning = true;
    const tick1Results = await worker.tick();
    expect(tick1Results).toHaveLength(1);
    expect(tick1Results[0].settled).toBe(false);
    expect(worker.lastSeenSequenceNumber).toBe(10n);
    expect(mockSettlementService.recoverUnsettled).toHaveBeenNthCalledWith(1, { batchSize: 10 });

    // Tick 2: calls recoverUnsettled with afterSequenceNumber: 10n, bypassing exec-fail-old!
    const tick2Results = await worker.tick();
    expect(tick2Results).toHaveLength(1);
    expect(tick2Results[0].settlement.id).toBe('settle-25');
    expect(worker.lastSeenSequenceNumber).toBe(25n);
    expect(mockSettlementService.recoverUnsettled).toHaveBeenNthCalledWith(2, {
      batchSize: 10,
      afterSequenceNumber: 10n,
    });

    // Tick 3: calls recoverUnsettled with afterSequenceNumber: 25n, returns [], wraps around cursor to null
    const tick3Results = await worker.tick();
    expect(tick3Results).toHaveLength(0);
    expect(worker.lastSeenSequenceNumber).toBeNull(); // Reset to wrap around!
    expect(mockSettlementService.recoverUnsettled).toHaveBeenNthCalledWith(3, {
      batchSize: 10,
      afterSequenceNumber: 25n,
    });

    // Tick 4: calls recoverUnsettled without afterSequenceNumber (starting from beginning)
    mockSettlementService.recoverUnsettled.mockResolvedValueOnce([]);
    await worker.tick();
    expect(mockSettlementService.recoverUnsettled).toHaveBeenNthCalledWith(4, { batchSize: 10 });

    await worker.stop();
  });

  // --------------------------------------------------------------------------
  // 10. Failed execution is never represented as successfully settled
  // --------------------------------------------------------------------------
  test('failed execution is never represented as successfully settled', async () => {
    const errorInstance = new Error('Ledger check failure');
    mockSettlementService.recoverUnsettled.mockResolvedValueOnce([
      { executionId: 'exec-broken', sequenceNumber: 5n, settled: false, error: errorInstance },
    ]);

    const worker = new SettlementRecoveryWorker({
      settlementService: mockSettlementService,
      batchSize: 10,
      loggerInstance: mockLogger,
    });

    worker.isRunning = true;
    const results = await worker.tick();
    expect(results).toHaveLength(1);
    const failedItem = results[0];
    expect(failedItem.settled).toBe(false);
    expect(failedItem.settlement).toBeUndefined();
    expect(failedItem.error).toBe(errorInstance);
    expect(failedItem.executionId).toBe('exec-broken');

    await worker.stop();
  });

  // --------------------------------------------------------------------------
  // 11. Cursor can be manually reset via resetCursor()
  // --------------------------------------------------------------------------
  test('resetCursor resets the cursor to null', async () => {
    const worker = new SettlementRecoveryWorker({
      settlementService: mockSettlementService,
      loggerInstance: mockLogger,
    });

    worker.lastSeenSequenceNumber = 999n;
    expect(worker.lastSeenSequenceNumber).toBe(999n);

    worker.resetCursor();
    expect(worker.lastSeenSequenceNumber).toBeNull();
  });

  // --------------------------------------------------------------------------
  // 12. Several consecutive batches containing failures
  // --------------------------------------------------------------------------
  test('several consecutive batches containing failures advance cursor progressively without starvation', async () => {
    // Batch 1: failures at seq 1, 2, 3
    mockSettlementService.recoverUnsettled.mockResolvedValueOnce([
      { executionId: 'fail-1', sequenceNumber: 1n, settled: false, error: new Error('Inv 1') },
      { executionId: 'fail-2', sequenceNumber: 2n, settled: false, error: new Error('Inv 2') },
      { executionId: 'fail-3', sequenceNumber: 3n, settled: false, error: new Error('Inv 3') },
    ]);

    // Batch 2: failures at seq 4, 5, 6
    mockSettlementService.recoverUnsettled.mockResolvedValueOnce([
      { executionId: 'fail-4', sequenceNumber: 4n, settled: false, error: new Error('Inv 4') },
      { executionId: 'fail-5', sequenceNumber: 5n, settled: false, error: new Error('Inv 5') },
      { executionId: 'fail-6', sequenceNumber: 6n, settled: false, error: new Error('Inv 6') },
    ]);

    // Batch 3: success at seq 7
    mockSettlementService.recoverUnsettled.mockResolvedValueOnce([
      { executionId: 'succ-7', sequenceNumber: 7n, settlement: { id: 's7' }, isIdempotentReplay: false },
    ]);

    const worker = new SettlementRecoveryWorker({
      settlementService: mockSettlementService,
      batchSize: 3,
      loggerInstance: mockLogger,
    });

    worker.isRunning = true;

    // Tick 1
    await worker.tick();
    expect(worker.lastSeenSequenceNumber).toBe(3n);
    expect(mockSettlementService.recoverUnsettled).toHaveBeenNthCalledWith(1, { batchSize: 3 });

    // Tick 2
    await worker.tick();
    expect(worker.lastSeenSequenceNumber).toBe(6n);
    expect(mockSettlementService.recoverUnsettled).toHaveBeenNthCalledWith(2, {
      batchSize: 3,
      afterSequenceNumber: 3n,
    });

    // Tick 3
    const batch3 = await worker.tick();
    expect(worker.lastSeenSequenceNumber).toBe(7n);
    expect(batch3[0].settlement.id).toBe('s7');
    expect(mockSettlementService.recoverUnsettled).toHaveBeenNthCalledWith(3, {
      batchSize: 3,
      afterSequenceNumber: 6n,
    });

    await worker.stop();
  });

  // --------------------------------------------------------------------------
  // 13. New executions arriving while the cursor is progressing
  // --------------------------------------------------------------------------
  test('new executions arriving while the cursor is progressing are examined in subsequent batches', async () => {
    // Initial batch returns seq 10n
    mockSettlementService.recoverUnsettled.mockResolvedValueOnce([
      { executionId: 'e-10', sequenceNumber: 10n, settlement: { id: 's10' }, isIdempotentReplay: false },
    ]);

    // New executions 15n and 20n arrived
    mockSettlementService.recoverUnsettled.mockResolvedValueOnce([
      { executionId: 'e-15', sequenceNumber: 15n, settlement: { id: 's15' }, isIdempotentReplay: false },
      { executionId: 'e-20', sequenceNumber: 20n, settlement: { id: 's20' }, isIdempotentReplay: false },
    ]);

    const worker = new SettlementRecoveryWorker({
      settlementService: mockSettlementService,
      batchSize: 5,
      loggerInstance: mockLogger,
    });

    worker.isRunning = true;
    await worker.tick();
    expect(worker.lastSeenSequenceNumber).toBe(10n);

    const tick2 = await worker.tick();
    expect(tick2).toHaveLength(2);
    expect(worker.lastSeenSequenceNumber).toBe(20n);
    expect(mockSettlementService.recoverUnsettled).toHaveBeenNthCalledWith(2, {
      batchSize: 5,
      afterSequenceNumber: 10n,
    });

    await worker.stop();
  });

  // --------------------------------------------------------------------------
  // 14. Wrap-around and retry of previously failed executions
  // --------------------------------------------------------------------------
  test('wrap-around retries previously failed executions when stream tail is reached', async () => {
    // Tick 1: seq 10n fails
    mockSettlementService.recoverUnsettled.mockResolvedValueOnce([
      { executionId: 'fail-10', sequenceNumber: 10n, settled: false, error: new Error('Temporary locked') },
    ]);

    // Tick 2: seq 20n succeeds
    mockSettlementService.recoverUnsettled.mockResolvedValueOnce([
      { executionId: 'succ-20', sequenceNumber: 20n, settlement: { id: 's20' }, isIdempotentReplay: false },
    ]);

    // Tick 3: stream tail reached (empty)
    mockSettlementService.recoverUnsettled.mockResolvedValueOnce([]);

    // Tick 4: stream wraps around to beginning, retrying fail-10 which now succeeds
    mockSettlementService.recoverUnsettled.mockResolvedValueOnce([
      { executionId: 'fail-10', sequenceNumber: 10n, settlement: { id: 's10-recovered' }, isIdempotentReplay: false },
    ]);

    const worker = new SettlementRecoveryWorker({
      settlementService: mockSettlementService,
      batchSize: 10,
      loggerInstance: mockLogger,
    });

    worker.isRunning = true;

    // Tick 1
    await worker.tick();
    expect(worker.lastSeenSequenceNumber).toBe(10n);

    // Tick 2
    await worker.tick();
    expect(worker.lastSeenSequenceNumber).toBe(20n);

    // Tick 3 (tail)
    const tick3 = await worker.tick();
    expect(tick3).toHaveLength(0);
    expect(worker.lastSeenSequenceNumber).toBeNull(); // Wrapped around!

    // Tick 4 (retry from start)
    const tick4 = await worker.tick();
    expect(tick4[0].settlement.id).toBe('s10-recovered');
    expect(mockSettlementService.recoverUnsettled).toHaveBeenNthCalledWith(4, { batchSize: 10 });

    await worker.stop();
  });

  // --------------------------------------------------------------------------
  // 15. Worker stop and restart preserves or resets state cleanly
  // --------------------------------------------------------------------------
  test('worker stop and restart preserves or resets state cleanly without corrupting settlement', async () => {
    mockSettlementService.recoverUnsettled.mockResolvedValueOnce([
      { executionId: 'e-1', sequenceNumber: 1n, settlement: { id: 's1' }, isIdempotentReplay: false },
    ]);
    mockSettlementService.recoverUnsettled.mockResolvedValueOnce([
      { executionId: 'e-2', sequenceNumber: 2n, settlement: { id: 's2' }, isIdempotentReplay: false },
    ]);

    const worker = new SettlementRecoveryWorker({
      settlementService: mockSettlementService,
      loggerInstance: mockLogger,
    });

    worker.start();
    await worker.tick();
    expect(worker.lastSeenSequenceNumber).toBe(1n);

    await worker.stop();
    expect(worker.isRunning).toBe(false);

    // Resumed / restarted in same process
    worker.start();
    expect(worker.isRunning).toBe(true);

    await worker.tick();
    expect(worker.lastSeenSequenceNumber).toBe(2n);

    await worker.stop();
  });

  // --------------------------------------------------------------------------
  // 16. Database error preserves existing cursor and subsequent tick retries
  // --------------------------------------------------------------------------
  test('database error preserves existing cursor and subsequent tick retries from the same cursor', async () => {
    const dbError = new Error('Postgres connection pool exhausted');
    mockSettlementService.recoverUnsettled.mockRejectedValueOnce(dbError);
    mockSettlementService.recoverUnsettled.mockResolvedValueOnce([
      { executionId: 'e-51', sequenceNumber: 51n, settlement: { id: 's51' }, isIdempotentReplay: false },
    ]);

    const worker = new SettlementRecoveryWorker({
      settlementService: mockSettlementService,
      batchSize: 10,
      loggerInstance: mockLogger,
    });

    worker.lastSeenSequenceNumber = 50n;
    worker.isRunning = true;

    // Tick 1: DB throws
    const tick1 = await worker.tick();
    expect(tick1).toBeNull();
    // Cursor MUST be preserved at 50n, not corrupted or prematurely reset to null!
    expect(worker.lastSeenSequenceNumber).toBe(50n);
    expect(mockLogger.error).toHaveBeenCalledWith('Settlement recovery tick failed unexpectedly', {
      error: dbError.message,
    });

    // Tick 2: DB recovered, retries with same cursor
    const tick2 = await worker.tick();
    expect(tick2).toHaveLength(1);
    expect(worker.lastSeenSequenceNumber).toBe(51n);
    expect(mockSettlementService.recoverUnsettled).toHaveBeenNthCalledWith(2, {
      batchSize: 10,
      afterSequenceNumber: 50n,
    });

    await worker.stop();
  });

  // --------------------------------------------------------------------------
  // 17. Non-array response does not trigger wrap-around
  // --------------------------------------------------------------------------
  test('non-array response does not trigger wrap-around', async () => {
    mockSettlementService.recoverUnsettled.mockResolvedValueOnce(null);

    const worker = new SettlementRecoveryWorker({
      settlementService: mockSettlementService,
      loggerInstance: mockLogger,
    });

    worker.lastSeenSequenceNumber = 77n;
    worker.isRunning = true;

    await worker.tick();
    // Cursor must NOT be reset to null when return is null
    expect(worker.lastSeenSequenceNumber).toBe(77n);

    await worker.stop();
  });
});
