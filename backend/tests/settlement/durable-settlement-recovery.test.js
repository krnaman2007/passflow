/**
 * Step 9.13 — Durable Settlement Recovery and Retry Management Tests
 *
 * Verifies the 12 requirements:
 * 1. A failed settlement records a durable retry attempt.
 * 2. A transient failure schedules a retry at the correct eligible time.
 * 3. A not-yet-due execution is skipped.
 * 4. A permanent or unsafe failure moves to manual review without being falsely marked settled.
 * 5. Restarting the worker preserves retry count, scheduling, and manual-review state.
 * 6. A successful retry settles exactly once.
 * 7. A crash or transaction rollback cannot leave partial wallet, ledger, hold, inventory, or settlement effects.
 * 8. Concurrent recovery workers cannot double-settle an execution or corrupt retry state.
 * 9. A failed old execution does not starve when new executions continue arriving.
 * 10. Requeueing a reviewed execution preserves idempotency and auditability.
 * 11. Existing settlement, wallet-conservation, and lifecycle tests pass.
 * 12. Configuration values are validated and have safe defaults.
 */

import { describe, expect, beforeAll, afterAll, test, jest } from '@jest/globals';
import crypto from 'node:crypto';
import { prisma as livePrisma } from '../../src/db/prisma.js';
import {
  TradeSettlementService,
  SettlementInvariantError,
  calculateBackoff,
  classifySettlementError,
  DEFAULT_MAX_AUTO_RETRIES,
  DEFAULT_BASE_BACKOFF_MS,
  DEFAULT_MAX_BACKOFF_MS,
} from '../../src/services/settlement/trade-settlement-service.js';
import {
  SettlementRecoveryWorker,
  DEFAULT_RECOVERY_INTERVAL_MS,
  DEFAULT_RECOVERY_BATCH_SIZE,
} from '../../src/services/settlement/settlement-recovery-worker.js';

describe('Step 9.13 — Durable Settlement Recovery and Retry Management', () => {
  jest.setTimeout(60000);

  const testRunId = Math.random().toString(36).substring(2, 9);
  let settlementService;
  let testEvent;
  let testCategory;

  beforeAll(async () => {
    // 1. Verify isolated local PostgreSQL database
    const [dbInfo] = await livePrisma.$queryRaw`
      SELECT current_database(), current_user, inet_server_port()
    `;
    expect(['passflow_test', 'passflow_isolated_validation', 'passflow_fresh_migration_test']).toContain(dbInfo.current_database);
    expect([5432, 55432]).toContain(Number(dbInfo.inet_server_port));
    expect(process.env.DATABASE_URL).not.toMatch(/neon\.tech/);

    settlementService = new TradeSettlementService({
      prismaClient: livePrisma,
      baseBackoffMs: 200,
      maxBackoffMs: 2000,
      jitter: false,
    });

    // Create base organizer and event
    const organizerUser = await livePrisma.user.create({
      data: {
        email: `org-${testRunId}@test.passflow.com`,
        passwordHash: 'dummy-hash',
        name: 'Durable Recovery Org',
      },
    });

    const organizer = await livePrisma.organizer.create({
      data: {
        userId: organizerUser.id,
        organizationName: `Durable Org ${testRunId}`,
      },
    });

    testEvent = await livePrisma.event.create({
      data: {
        organizerId: organizer.id,
        name: `Durable Recovery Event ${testRunId}`,
        dateTime: new Date(Date.now() + 86400000 * 7),
        location: 'Bengaluru Tech Park',
      },
    });

    testCategory = await livePrisma.ticketCategory.create({
      data: {
        eventId: testEvent.id,
        name: 'Standard Pass',
        originalPrice: 100.0,
        totalQuantity: 1000,
        availableQuantity: 1000,
      },
    });
  });

  afterAll(async () => {
    await livePrisma.$disconnect();
  });

  async function createUserWithWallet(tag, availablePaise = 0n, reservedPaise = 0n) {
    const id = crypto.randomUUID();
    const user = await livePrisma.user.create({
      data: {
        id,
        email: `${tag}-${id.substring(0, 8)}@test.passflow.com`,
        passwordHash: 'dummy-hash',
        name: `${tag} User`,
      },
    });

    const wallet = await livePrisma.wallet.create({
      data: {
        userId: user.id,
        availableBalance: availablePaise,
        reservedBalance: reservedPaise,
        version: 0n,
      },
    });

    return { user, wallet };
  }

  async function seedMatchedTrade({
    buyer,
    seller,
    category = testCategory,
    event = testEvent,
    buyerLimitPrice = 200,
    sellerAskPrice = 180,
    executionPrice = 180,
    quantity = 1,
    sellerReservedInventory = quantity,
  }) {
    const buyerHoldPaise = BigInt(buyerLimitPrice) * BigInt(quantity);

    const buyOrder = await livePrisma.order.create({
      data: {
        userId: buyer.user.id,
        eventId: event.id,
        ticketCategoryId: category.id,
        side: 'BID',
        price: buyerLimitPrice,
        initialQuantity: quantity,
        remainingQuantity: 0,
        status: 'FILLED',
        idempotencyKey: `buy-${crypto.randomUUID()}`,
      },
    });

    const sellOrder = await livePrisma.order.create({
      data: {
        userId: seller.user.id,
        eventId: event.id,
        ticketCategoryId: category.id,
        side: 'ASK',
        price: sellerAskPrice,
        initialQuantity: quantity,
        remainingQuantity: 0,
        status: 'FILLED',
        idempotencyKey: `sell-${crypto.randomUUID()}`,
      },
    });

    const buyerHold = await livePrisma.walletHold.create({
      data: {
        walletId: buyer.wallet.id,
        orderId: buyOrder.id,
        reason: 'ORDER_ESCROW',
        status: 'ACTIVE',
        heldAmount: buyerHoldPaise,
        remainingAmount: buyerHoldPaise,
        idempotencyKey: `hold-${crypto.randomUUID()}`,
      },
    });

    await livePrisma.userTicketInventory.upsert({
      where: {
        userId_ticketCategoryId: {
          userId: seller.user.id,
          ticketCategoryId: category.id,
        },
      },
      update: {
        totalQuantity: sellerReservedInventory,
        reservedQuantity: sellerReservedInventory,
        availableQuantity: 0,
      },
      create: {
        userId: seller.user.id,
        ticketCategoryId: category.id,
        totalQuantity: sellerReservedInventory,
        reservedQuantity: sellerReservedInventory,
        availableQuantity: 0,
      },
    });

    for (let i = 0; i < quantity; i++) {
      const ticket = await livePrisma.ticket.create({
        data: {
          eventId: event.id,
          categoryId: category.id,
          ownerId: seller.user.id,
          status: 'LISTED',
          orderId: sellOrder.id,
          faceValue: 100,
          currentPrice: executionPrice,
        },
      });
      await livePrisma.ticketOwnership.create({
        data: {
          ticketId: ticket.id,
          ownerId: seller.user.id,
          source: 'PRIMARY',
        },
      });
    }

    const execution = await livePrisma.execution.create({
      data: {
        incomingOrderId: buyOrder.id,
        restingOrderId: sellOrder.id,
        price: executionPrice,
        quantity,
      },
    });

    return { buyOrder, sellOrder, buyerHold, execution };
  }

  // --------------------------------------------------------------------------
  // Requirement 1 & 2: Durable Retry Attempt Recording & Transient Backoff
  // --------------------------------------------------------------------------
  test('1 & 2. A failed settlement records a durable retry attempt and schedules backoff', async () => {
    const buyer = await createUserWithWallet('dur-1-b', 5000n, 200n);
    const seller = await createUserWithWallet('dur-1-s', 1000n, 0n);
    const { execution } = await seedMatchedTrade({ buyer, seller });

    const now = new Date('2026-10-22T10:00:00Z');
    const transientError = new Error('could not serialize access due to concurrent update (40001)');

    const updated = await settlementService.recordSettlementFailure({
      executionId: execution.id,
      error: transientError,
      now,
    });

    expect(updated).not.toBeNull();
    expect(updated.settlementStatus).toBe('PENDING');
    expect(updated.retryCount).toBe(1);
    expect(updated.lastErrorCode).toBe('SERIALIZATION_FAILURE');
    expect(updated.lastFailedAt).toEqual(now);
    expect(updated.lastAttemptedAt).toEqual(now);

    // Verify nextRetryAt is scheduled with baseBackoffMs (200ms * 2^0 = 200ms)
    const expectedNextRetry = new Date(now.getTime() + 200);
    expect(updated.nextRetryAt).toEqual(expectedNextRetry);

    // Direct database read verification
    const dbRecord = await livePrisma.execution.findUnique({
      where: { id: execution.id },
    });
    expect(dbRecord.settlementStatus).toBe('PENDING');
    expect(dbRecord.retryCount).toBe(1);
    expect(dbRecord.nextRetryAt).toEqual(expectedNextRetry);
  });

  // --------------------------------------------------------------------------
  // Requirement 3: Not-yet-due executions are skipped
  // --------------------------------------------------------------------------
  test('3. A not-yet-due execution is skipped during recovery sweeps', async () => {
    const buyer = await createUserWithWallet('dur-3-b', 5000n, 200n);
    const seller = await createUserWithWallet('dur-3-s', 1000n, 0n);
    const { execution } = await seedMatchedTrade({ buyer, seller });

    // Set nextRetryAt 1 hour into the future
    const futureTime = new Date(Date.now() + 3600 * 1000);
    await livePrisma.execution.update({
      where: { id: execution.id },
      data: {
        settlementStatus: 'PENDING',
        nextRetryAt: futureTime,
        retryCount: 1,
      },
    });

    // Run recoverUnsettled with current time (now < futureTime)
    const results = await settlementService.recoverUnsettled({ batchSize: 100, now: new Date() });
    const found = results.find((r) => r.executionId === execution.id);
    expect(found).toBeUndefined();

    // Verify the execution was untouched and still pending
    const dbRecord = await livePrisma.execution.findUnique({ where: { id: execution.id } });
    expect(dbRecord.settlementStatus).toBe('PENDING');
    expect(dbRecord.retryCount).toBe(1);
  });

  // --------------------------------------------------------------------------
  // Requirement 4: Permanent / Unsafe failures move to MANUAL_REVIEW
  // --------------------------------------------------------------------------
  test('4. A permanent or unsafe failure moves to manual review without being falsely marked settled', async () => {
    const buyer = await createUserWithWallet('dur-4-b', 5000n, 200n);
    const seller = await createUserWithWallet('dur-4-s', 1000n, 0n);
    // Seed trade with seller having 0 inventory (triggers SettlementInvariantError)
    const { execution } = await seedMatchedTrade({
      buyer,
      seller,
      sellerReservedInventory: 0,
    });

    // Attempt settlement - should throw SettlementInvariantError and record MANUAL_REVIEW
    await expect(
      settlementService.settleExecution({ executionId: execution.id })
    ).rejects.toThrow(SettlementInvariantError);

    // Verify durable state in PostgreSQL
    const dbRecord = await livePrisma.execution.findUnique({ where: { id: execution.id } });
    expect(dbRecord.settlementStatus).toBe('MANUAL_REVIEW');
    expect(dbRecord.lastErrorCode).toBe('SETTLEMENT_INVARIANT');
    expect(dbRecord.nextRetryAt).toBeNull();
    expect(dbRecord.retryCount).toBe(1);

    // Verify execution is NOT marked settled and has no TradeSettlement
    const settlement = await livePrisma.tradeSettlement.findUnique({
      where: { executionId: execution.id },
    });
    expect(settlement).toBeNull();

    // Verify recoverUnsettled skips MANUAL_REVIEW executions
    const sweepResults = await settlementService.recoverUnsettled({ batchSize: 100 });
    const inSweep = sweepResults.find((r) => r.executionId === execution.id);
    expect(inSweep).toBeUndefined();
  });

  // --------------------------------------------------------------------------
  // Requirement 5: Worker restart preserves state from PostgreSQL
  // --------------------------------------------------------------------------
  test('5. Restarting the worker preserves retry count, scheduling, and manual-review state', async () => {
    const buyer = await createUserWithWallet('dur-5-b', 5000n, 200n);
    const seller = await createUserWithWallet('dur-5-s', 1000n, 0n);
    const { execution } = await seedMatchedTrade({ buyer, seller });

    const scheduledTime = new Date(Date.now() + 60000);
    await livePrisma.execution.update({
      where: { id: execution.id },
      data: {
        settlementStatus: 'MANUAL_REVIEW',
        retryCount: 4,
        nextRetryAt: scheduledTime,
        lastErrorCode: 'SETTLEMENT_INVARIANT',
      },
    });

    // Simulate worker 1 running then stopping
    const worker1 = new SettlementRecoveryWorker({ settlementService });
    worker1.start();
    await worker1.stop();

    // Start worker 2 (new process/instance)
    const worker2 = new SettlementRecoveryWorker({ settlementService });
    const status = worker2.getStatus();
    expect(status.isRunning).toBe(false);

    // Verify DB state remained strictly intact
    const dbRecord = await livePrisma.execution.findUnique({ where: { id: execution.id } });
    expect(dbRecord.settlementStatus).toBe('MANUAL_REVIEW');
    expect(dbRecord.retryCount).toBe(4);
    expect(dbRecord.lastErrorCode).toBe('SETTLEMENT_INVARIANT');
  });

  // --------------------------------------------------------------------------
  // Requirement 6: Successful retry settles exactly once
  // --------------------------------------------------------------------------
  test('6. A successful retry settles exactly once and marks status SETTLED', async () => {
    const buyer = await createUserWithWallet('dur-6-b', 5000n, 200n);
    const seller = await createUserWithWallet('dur-6-s', 1000n, 0n);
    const { execution } = await seedMatchedTrade({ buyer, seller });

    // Mark as previously failed attempt
    await livePrisma.execution.update({
      where: { id: execution.id },
      data: {
        settlementStatus: 'PENDING',
        retryCount: 2,
        nextRetryAt: new Date(Date.now() - 1000), // Due now
        lastErrorCode: 'SERIALIZATION_FAILURE',
      },
    });

    // Run recovery
    const results = await settlementService.recoverUnsettled({ batchSize: 100 });
    const recoveryResult = results.find((r) => r.executionId === execution.id);
    expect(recoveryResult).toBeDefined();
    expect(recoveryResult.settled).toBe(true);

    // Check database
    const dbRecord = await livePrisma.execution.findUnique({ where: { id: execution.id } });
    expect(dbRecord.settlementStatus).toBe('SETTLED');
    expect(dbRecord.nextRetryAt).toBeNull();
    expect(dbRecord.lastErrorCode).toBeNull();

    // Idempotent retry produces zero duplicate settlements
    const replay = await settlementService.settleExecution({ executionId: execution.id });
    expect(replay.isIdempotentReplay).toBe(true);

    const settlementCount = await livePrisma.tradeSettlement.count({
      where: { executionId: execution.id },
    });
    expect(settlementCount).toBe(1);
  });

  // --------------------------------------------------------------------------
  // Requirement 7: Rollback leaves zero partial effects
  // --------------------------------------------------------------------------
  test('7. A transaction rollback cannot leave partial wallet, ledger, hold, inventory, or settlement effects', async () => {
    const buyer = await createUserWithWallet('dur-7-b', 5000n, 200n);
    const seller = await createUserWithWallet('dur-7-s', 1000n, 0n);
    const { execution, buyerHold } = await seedMatchedTrade({
      buyer,
      seller,
      sellerReservedInventory: 0, // Invariant failure triggers rollback
    });

    const buyerWalletBefore = await livePrisma.wallet.findUnique({ where: { id: buyer.wallet.id } });
    const sellerWalletBefore = await livePrisma.wallet.findUnique({ where: { id: seller.wallet.id } });

    await expect(
      settlementService.settleExecution({ executionId: execution.id })
    ).rejects.toThrow(SettlementInvariantError);

    // Verify ZERO mutations to balances
    const buyerWalletAfter = await livePrisma.wallet.findUnique({ where: { id: buyer.wallet.id } });
    const sellerWalletAfter = await livePrisma.wallet.findUnique({ where: { id: seller.wallet.id } });
    expect(buyerWalletAfter.availableBalance).toBe(buyerWalletBefore.availableBalance);
    expect(buyerWalletAfter.reservedBalance).toBe(buyerWalletBefore.reservedBalance);
    expect(sellerWalletAfter.availableBalance).toBe(sellerWalletBefore.availableBalance);

    // Verify ZERO ledger entries
    const ledgerEntries = await livePrisma.walletLedgerEntry.findMany({
      where: { executionId: execution.id },
    });
    expect(ledgerEntries).toHaveLength(0);

    // Verify hold remained ACTIVE
    const holdAfter = await livePrisma.walletHold.findUnique({ where: { id: buyerHold.id } });
    expect(holdAfter.status).toBe('ACTIVE');

    // Verify TradeSettlement was NOT created
    const settlement = await livePrisma.tradeSettlement.findUnique({
      where: { executionId: execution.id },
    });
    expect(settlement).toBeNull();
  });

  // --------------------------------------------------------------------------
  // Requirement 8: Concurrent recovery workers cannot double-settle or corrupt state
  // --------------------------------------------------------------------------
  test('8. Concurrent recovery workers cannot double-settle an execution or corrupt retry state', async () => {
    const buyer = await createUserWithWallet('dur-8-b', 10000n, 200n);
    const seller = await createUserWithWallet('dur-8-s', 5000n, 0n);
    const { execution } = await seedMatchedTrade({ buyer, seller });

    const workerA = new TradeSettlementService({ prismaClient: livePrisma });
    const workerB = new TradeSettlementService({ prismaClient: livePrisma });

    // Both workers attempt settlement simultaneously
    const [resultA, resultB] = await Promise.all([
      workerA.settleExecution({ executionId: execution.id }),
      workerB.settleExecution({ executionId: execution.id }),
    ]);

    // Exactly one is the live creator and one is an idempotent replay
    const replays = [resultA.isIdempotentReplay, resultB.isIdempotentReplay];
    expect(replays).toContain(false);
    expect(replays).toContain(true);

    // Database verification: exactly 1 settlement and 2 ledger rows (1 debit, 1 credit)
    const settlements = await livePrisma.tradeSettlement.findMany({
      where: { executionId: execution.id },
    });
    expect(settlements).toHaveLength(1);

    const ledgerEntries = await livePrisma.walletLedgerEntry.findMany({
      where: { executionId: execution.id },
    });
    expect(ledgerEntries).toHaveLength(2);

    const dbRecord = await livePrisma.execution.findUnique({ where: { id: execution.id } });
    expect(dbRecord.settlementStatus).toBe('SETTLED');
  });

  // --------------------------------------------------------------------------
  // Requirement 9: Starvation prevention
  // --------------------------------------------------------------------------
  test('9. A failed old execution does not starve when new executions continue arriving', async () => {
    const buyer = await createUserWithWallet('dur-9-b', 20000n, 1000n);
    const seller = await createUserWithWallet('dur-9-s', 10000n, 0n);

    // Old execution 1
    const { execution: oldExec } = await seedMatchedTrade({ buyer, seller });
    // New execution 2
    const { execution: newExec } = await seedMatchedTrade({ buyer, seller });

    expect(BigInt(oldExec.sequenceNumber)).toBeLessThan(BigInt(newExec.sequenceNumber));

    // Simulate oldExec having failed and its backoff time now past (due)
    await livePrisma.execution.update({
      where: { id: oldExec.id },
      data: {
        settlementStatus: 'PENDING',
        retryCount: 1,
        nextRetryAt: new Date(Date.now() - 5000), // Due in the past
      },
    });

    // Run recovery with batch size 1: oldExec must be selected first because of sequenceNumber ASC!
    const batch1 = await settlementService.recoverUnsettled({ batchSize: 1 });
    expect(batch1).toHaveLength(1);
    expect(batch1[0].executionId).toBe(oldExec.id);

    // Next batch selects newExec
    const batch2 = await settlementService.recoverUnsettled({ batchSize: 1 });
    expect(batch2).toHaveLength(1);
    expect(batch2[0].executionId).toBe(newExec.id);
  });

  // --------------------------------------------------------------------------
  // Requirement 10: Requeueing reviewed executions preserves idempotency & auditability
  // --------------------------------------------------------------------------
  test('10. Requeueing a reviewed execution preserves idempotency and auditability', async () => {
    const buyer = await createUserWithWallet('dur-10-b', 5000n, 200n);
    const seller = await createUserWithWallet('dur-10-s', 1000n, 0n);
    const { execution } = await seedMatchedTrade({ buyer, seller });

    // Move to MANUAL_REVIEW
    await livePrisma.execution.update({
      where: { id: execution.id },
      data: {
        settlementStatus: 'MANUAL_REVIEW',
        retryCount: 5,
        lastErrorCode: 'MAX_RETRIES_EXCEEDED',
        nextRetryAt: null,
      },
    });

    // Operator requeues execution
    const requeueResult = await settlementService.requeueExecution({
      executionId: execution.id,
      resetRetryCount: false,
    });

    expect(requeueResult.requeued).toBe(true);
    expect(requeueResult.status).toBe('PENDING');
    expect(requeueResult.retryCount).toBe(5); // Preserved for auditability

    const dbRecord = await livePrisma.execution.findUnique({ where: { id: execution.id } });
    expect(dbRecord.settlementStatus).toBe('PENDING');
    expect(dbRecord.nextRetryAt).not.toBeNull();
    expect(dbRecord.retryCount).toBe(5);

    // Second requeue call is idempotent
    const secondRequeue = await settlementService.requeueExecution({
      executionId: execution.id,
    });
    expect(secondRequeue.requeued).toBe(false);
    expect(secondRequeue.status).toBe('PENDING');
  });

  // --------------------------------------------------------------------------
  // Requirement 12: Configuration validation and safe defaults
  // --------------------------------------------------------------------------
  describe('12. Configuration validation and defaults', () => {
    test('calculateBackoff respects base, max, and exponential progression', () => {
      const delay1 = calculateBackoff({ attempt: 1, baseBackoffMs: 1000, maxBackoffMs: 10000, jitter: false });
      expect(delay1).toBe(1000);

      const delay2 = calculateBackoff({ attempt: 2, baseBackoffMs: 1000, maxBackoffMs: 10000, jitter: false });
      expect(delay2).toBe(2000);

      const delay3 = calculateBackoff({ attempt: 3, baseBackoffMs: 1000, maxBackoffMs: 10000, jitter: false });
      expect(delay3).toBe(4000);

      const delayMax = calculateBackoff({ attempt: 10, baseBackoffMs: 1000, maxBackoffMs: 5000, jitter: false });
      expect(delayMax).toBe(5000); // Capped at maxBackoffMs
    });

    test('classifySettlementError classifies correctly and sanitizes codes', () => {
      const invariant = new SettlementInvariantError('Missing hold');
      expect(classifySettlementError(invariant)).toEqual({
        type: 'PERMANENT',
        code: 'SETTLEMENT_INVARIANT',
        isTransient: false,
      });

      const dbConstraint = new Error('new row for relation "Wallet" violates check constraint "wallet_available_balance_non_negative"');
      expect(classifySettlementError(dbConstraint)).toEqual({
        type: 'PERMANENT',
        code: 'DATABASE_CONSTRAINT_VIOLATION',
        isTransient: false,
      });

      const programmingError = new TypeError('Cannot read properties of undefined (reading "id")');
      expect(classifySettlementError(programmingError)).toEqual({
        type: 'TRANSIENT',
        code: 'PROGRAMMING_ERROR',
        isTransient: true,
      });

      const serialization = new Error('Raw query failed: could not serialize access (40001)');
      expect(classifySettlementError(serialization)).toEqual({
        type: 'TRANSIENT',
        code: 'SERIALIZATION_FAILURE',
        isTransient: true,
      });

      const deadlock = new Error('deadlock detected (40P01)');
      expect(classifySettlementError(deadlock)).toEqual({
        type: 'TRANSIENT',
        code: 'DEADLOCK_DETECTED',
        isTransient: true,
      });

      const prismaConflict = { code: 'P2034', message: 'Write conflict' };
      expect(classifySettlementError(prismaConflict)).toEqual({
        type: 'TRANSIENT',
        code: 'PRISMA_WRITE_CONFLICT',
        isTransient: true,
      });

      const unknown = new Error('SELECT * FROM "secret_table" failed: password=supersecret');
      const classifiedUnknown = classifySettlementError(unknown);
      expect(classifiedUnknown.type).toBe('TRANSIENT');
      expect(classifiedUnknown.code).toBe('UNKNOWN_TRANSIENT_ERROR');
      // Verify no sensitive SQL strings leaked in code
      expect(classifiedUnknown.code).not.toContain('password');
      expect(classifiedUnknown.code).not.toContain('supersecret');
    });

    test('TradeSettlementService constructor validates configuration with safe defaults', () => {
      const service = new TradeSettlementService({
        maxAutoRetries: -5,
        baseBackoffMs: 'invalid',
        maxBackoffMs: 100, // less than default base
      });

      expect(service.maxAutoRetries).toBe(DEFAULT_MAX_AUTO_RETRIES);
      expect(service.baseBackoffMs).toBe(DEFAULT_BASE_BACKOFF_MS);
      expect(service.maxBackoffMs).toBe(DEFAULT_BASE_BACKOFF_MS); // Clamped to at least baseBackoffMs
    });
  });

  // --------------------------------------------------------------------------
  // Step 9.13A Audit: Deterministic Eligibility Boundaries & Concurrency Hardening
  // --------------------------------------------------------------------------
  describe('Step 9.13A — Correctness Audit Tests', () => {
    test('Audit 1: Deterministic eligibility boundary (just before, exactly at, and just after nextRetryAt)', async () => {
      const buyer = await createUserWithWallet('aud-bound-b', 10000n, 1000n);
      const seller = await createUserWithWallet('aud-bound-s', 5000n, 0n);
      const { execution } = await seedMatchedTrade({ buyer, seller });

      // Target eligibility time T
      const T = new Date('2026-10-22T15:00:00.000Z');

      await livePrisma.execution.update({
        where: { id: execution.id },
        data: {
          settlementStatus: 'PENDING',
          retryCount: 1, // Failed at least once
          nextRetryAt: T,
        },
      });

      // 1. Just before eligibility time T (-100ms): MUST be skipped
      const beforeTime = new Date(T.getTime() - 100);
      const resultsBefore = await settlementService.recoverUnsettled({
        batchSize: 500,
        now: beforeTime,
      });
      const foundBefore = resultsBefore.find((r) => r.executionId === execution.id);
      expect(foundBefore).toBeUndefined();

      // 2. Exactly at eligibility time T (now == T): MUST be selected
      const resultsAt = await settlementService.recoverUnsettled({
        batchSize: 500,
        now: T,
      });
      const foundAt = resultsAt.find((r) => r.executionId === execution.id);
      expect(foundAt).toBeDefined();
      expect(foundAt.settled).toBe(true);

      // Verify execution is now settled in DB
      const dbAfter = await livePrisma.execution.findUnique({ where: { id: execution.id } });
      expect(dbAfter.settlementStatus).toBe('SETTLED');

      // 3. Just after eligibility time on a fresh execution (+100ms): MUST be selected
      const { execution: execution2 } = await seedMatchedTrade({ buyer, seller });
      const T2 = new Date('2026-10-22T16:00:00.000Z');
      await livePrisma.execution.update({
        where: { id: execution2.id },
        data: {
          settlementStatus: 'PENDING',
          retryCount: 2,
          nextRetryAt: T2,
        },
      });

      const afterTime = new Date(T2.getTime() + 100);
      const resultsAfter = await settlementService.recoverUnsettled({
        batchSize: 500,
        now: afterTime,
      });
      const foundAfter = resultsAfter.find((r) => r.executionId === execution2.id);
      expect(foundAfter).toBeDefined();
      expect(foundAfter.settled).toBe(true);
    });

    test('Audit 2: First-attempt executions (retryCount: 0) are immediately eligible for settlement', async () => {
      const buyer = await createUserWithWallet('aud-first-b', 5000n, 200n);
      const seller = await createUserWithWallet('aud-first-s', 1000n, 0n);
      const { execution } = await seedMatchedTrade({ buyer, seller });

      // Brand new execution has retryCount: 0
      const dbRecord = await livePrisma.execution.findUnique({ where: { id: execution.id } });
      expect(dbRecord.retryCount).toBe(0);

      // Query with exact creation time
      const results = await settlementService.recoverUnsettled({
        batchSize: 500,
        now: dbRecord.executedAt,
      });
      const found = results.find((r) => r.executionId === execution.id);
      expect(found).toBeDefined();
      expect(found.settled).toBe(true);
    });

    test('Audit 3: Settlement success racing with delayed failure recording does not corrupt SETTLED state', async () => {
      const buyer = await createUserWithWallet('aud-race-b', 10000n, 500n);
      const seller = await createUserWithWallet('aud-race-s', 5000n, 0n);
      const { execution } = await seedMatchedTrade({ buyer, seller });

      // Worker 1 successfully settles execution
      const settleResult = await settlementService.settleExecution({ executionId: execution.id });
      expect(settleResult.isIdempotentReplay).toBe(false);

      const dbSettled = await livePrisma.execution.findUnique({ where: { id: execution.id } });
      expect(dbSettled.settlementStatus).toBe('SETTLED');

      // Worker 2 finishes a delayed, failed attempt and calls recordSettlementFailure
      const failureResult = await settlementService.recordSettlementFailure({
        executionId: execution.id,
        error: new Error('could not serialize access due to concurrent update (40001)'),
        now: new Date(),
      });

      // Must NOT overwrite SETTLED status
      expect(failureResult.settlementStatus).toBe('SETTLED');

      const dbFinal = await livePrisma.execution.findUnique({ where: { id: execution.id } });
      expect(dbFinal.settlementStatus).toBe('SETTLED');
      expect(dbFinal.nextRetryAt).toBeNull();

      // Exactly 1 TradeSettlement exists
      const settlements = await livePrisma.tradeSettlement.findMany({
        where: { executionId: execution.id },
      });
      expect(settlements).toHaveLength(1);
    });

    test('Audit 4: Delayed failure handler does not revert MANUAL_REVIEW back to PENDING', async () => {
      const buyer = await createUserWithWallet('aud-mr-b', 5000n, 200n);
      const seller = await createUserWithWallet('aud-mr-s', 1000n, 0n);
      const { execution } = await seedMatchedTrade({ buyer, seller });

      // Execution is placed in MANUAL_REVIEW
      await livePrisma.execution.update({
        where: { id: execution.id },
        data: {
          settlementStatus: 'MANUAL_REVIEW',
          retryCount: 5,
          lastErrorCode: 'MAX_RETRIES_EXCEEDED',
          nextRetryAt: null,
        },
      });

      // A concurrent stale worker encounters a transient error and calls recordSettlementFailure
      const failureResult = await settlementService.recordSettlementFailure({
        executionId: execution.id,
        error: new Error('deadlock detected (40P01)'),
        now: new Date(),
      });

      // Must remain in MANUAL_REVIEW without resurrecting to PENDING
      expect(failureResult.settlementStatus).toBe('MANUAL_REVIEW');

      const dbRecord = await livePrisma.execution.findUnique({ where: { id: execution.id } });
      expect(dbRecord.settlementStatus).toBe('MANUAL_REVIEW');
      expect(dbRecord.nextRetryAt).toBeNull();
    });

    test('Audit 5: Stale worker with past timestamp cannot overwrite newer retry metadata', async () => {
      const buyer = await createUserWithWallet('aud-stale-b', 5000n, 200n);
      const seller = await createUserWithWallet('aud-stale-s', 1000n, 0n);
      const { execution } = await seedMatchedTrade({ buyer, seller });

      const T2 = new Date('2026-10-22T12:00:10.000Z');
      const newerRetryAt = new Date('2026-10-22T12:00:20.000Z');

      // Worker 2 updated execution at T2
      await livePrisma.execution.update({
        where: { id: execution.id },
        data: {
          settlementStatus: 'PENDING',
          retryCount: 2,
          lastAttemptedAt: T2,
          lastFailedAt: T2,
          nextRetryAt: newerRetryAt,
          lastErrorCode: 'SERIALIZATION_FAILURE',
        },
      });

      // Stale Worker 1 whose attempt started earlier at T1 (12:00:05) finishes late
      const T1 = new Date('2026-10-22T12:00:05.000Z');
      const staleResult = await settlementService.recordSettlementFailure({
        executionId: execution.id,
        error: new Error('deadlock detected (40P01)'),
        now: T1,
      });

      // Stale worker call must NOT overwrite newer attempt
      expect(staleResult.retryCount).toBe(2);
      expect(staleResult.nextRetryAt).toEqual(newerRetryAt);

      const dbRecord = await livePrisma.execution.findUnique({ where: { id: execution.id } });
      expect(dbRecord.retryCount).toBe(2);
      expect(dbRecord.nextRetryAt).toEqual(newerRetryAt);
    });

    test('Audit 6: Requeueing cannot requeue an already settled execution', async () => {
      const buyer = await createUserWithWallet('aud-req-b', 5000n, 200n);
      const seller = await createUserWithWallet('aud-req-s', 1000n, 0n);
      const { execution } = await seedMatchedTrade({ buyer, seller });

      // Settle the execution
      await settlementService.settleExecution({ executionId: execution.id });

      // Attempt to requeue settled execution
      const requeueRes = await settlementService.requeueExecution({ executionId: execution.id });
      expect(requeueRes.requeued).toBe(false);
      expect(requeueRes.status).toBe('SETTLED');

      const dbRecord = await livePrisma.execution.findUnique({ where: { id: execution.id } });
      expect(dbRecord.settlementStatus).toBe('SETTLED');
    });

    test('Audit 7: Retry exhaustion progression transitions cleanly to MANUAL_REVIEW after maxAutoRetries', async () => {
      const buyer = await createUserWithWallet('aud-exh-b', 5000n, 200n);
      const seller = await createUserWithWallet('aud-exh-s', 1000n, 0n);
      const { execution } = await seedMatchedTrade({ buyer, seller });

      const customService = new TradeSettlementService({
        prismaClient: livePrisma,
        maxAutoRetries: 3,
        baseBackoffMs: 100,
        maxBackoffMs: 1000,
        jitter: false,
      });

      const err = new Error('deadlock detected (40P01)');

      // Attempt 1
      const res1 = await customService.recordSettlementFailure({ executionId: execution.id, error: err, now: new Date() });
      expect(res1.retryCount).toBe(1);
      expect(res1.settlementStatus).toBe('PENDING');

      // Attempt 2
      const res2 = await customService.recordSettlementFailure({ executionId: execution.id, error: err, now: new Date() });
      expect(res2.retryCount).toBe(2);
      expect(res2.settlementStatus).toBe('PENDING');

      // Attempt 3 (reaches maxAutoRetries = 3) -> MANUAL_REVIEW
      const res3 = await customService.recordSettlementFailure({ executionId: execution.id, error: err, now: new Date() });
      expect(res3.retryCount).toBe(3);
      expect(res3.settlementStatus).toBe('MANUAL_REVIEW');
      expect(res3.lastErrorCode).toBe('MAX_RETRIES_EXCEEDED');
      expect(res3.nextRetryAt).toBeNull();
    });
  });
});
