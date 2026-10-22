/**
 * Step 9.2 — Transactional Wallet Operations and Idempotency Integration Tests
 *
 * Real PostgreSQL integration tests verifying:
 * 1. Wallet creation and retrieval.
 * 2. Valid credits, debits, and compensating adjustments.
 * 3. Insufficient funds rejection.
 * 4. Input validation and integer precision boundaries.
 * 5. Fund reservations and full/partial releases.
 * 6. Idempotency replay with same payload vs rejection on payload mismatch.
 * 7. Concurrent duplicate requests with the same key.
 * 8. Concurrent spending from one wallet under pessimistic row locking.
 * 9. Transaction atomicity: zero partial updates on rollback.
 * 10. Ledger delta consistency against balance projections.
 */

import { jest } from '@jest/globals';
import { prisma as livePrisma } from '../../src/db/prisma.js';
import {
  WalletService,
  parseMonetaryAmount,
  MAX_PAISE,
} from '../../src/services/wallet/wallet-service.js';
import {
  WalletNotFoundError,
  InsufficientFundsError,
  WalletValidationError,
  IdempotencyConflictError,
  HoldInvariantError,
} from '../../src/services/wallet/wallet-errors.js';

describe('Step 9.2 — Transactional Wallet Operations (Live PostgreSQL)', () => {
  jest.setTimeout(60000);

  const suffix = Math.random().toString(36).substring(2, 8);
  const walletService = new WalletService({ prismaClient: livePrisma });

  let testUser1;
  let testUser2;
  let wallet1;
  let wallet2;

  beforeAll(async () => {
    // Create base users for wallet operations
    testUser1 = await livePrisma.user.create({
      data: {
        email: `wallet-svc-1-${suffix}@test.passflow.com`,
        passwordHash: 'dummy-hash',
        name: 'Wallet Svc User 1',
      },
    });

    testUser2 = await livePrisma.user.create({
      data: {
        email: `wallet-svc-2-${suffix}@test.passflow.com`,
        passwordHash: 'dummy-hash',
        name: 'Wallet Svc User 2',
      },
    });
  });

  afterAll(async () => {
    // Teardown test artifacts safely
    try {
      await livePrisma.$executeRawUnsafe(
        `ALTER TABLE "WalletLedgerEntry" DISABLE TRIGGER wallet_ledger_immutability_trigger;`
      );
      await livePrisma.walletLedgerEntry.deleteMany({
        where: {
          wallet: {
            userId: { in: [testUser1.id, testUser2.id] },
          },
        },
      });
      await livePrisma.walletHold.deleteMany({
        where: {
          wallet: {
            userId: { in: [testUser1.id, testUser2.id] },
          },
        },
      });
      await livePrisma.financialOperation.deleteMany({
        where: {
          idempotencyKey: { contains: suffix },
        },
      });
      await livePrisma.wallet.deleteMany({
        where: { userId: { in: [testUser1.id, testUser2.id] } },
      });
      await livePrisma.user.deleteMany({
        where: { id: { in: [testUser1.id, testUser2.id] } },
      });
      await livePrisma.$executeRawUnsafe(
        `ALTER TABLE "WalletLedgerEntry" ENABLE TRIGGER wallet_ledger_immutability_trigger;`
      );
    } catch (e) {
      console.warn('Test cleanup warning:', e.message);
    }
  });

  // =========================================================================
  // 1. Wallet Creation & Retrieval
  // =========================================================================
  describe('1. Wallet Creation and Retrieval', () => {
    test('creates new wallet with zero balances and version 0', async () => {
      wallet1 = await walletService.getOrCreateWallet({ userId: testUser1.id });

      expect(wallet1).toBeDefined();
      expect(wallet1.userId).toBe(testUser1.id);
      expect(wallet1.currency).toBe('INR');
      expect(wallet1.availableBalance).toBe('0');
      expect(wallet1.reservedBalance).toBe('0');
      expect(wallet1.totalBalance).toBe('0');
      expect(wallet1.version).toBe('0');
    });

    test('retrieves existing wallet idempotently on second call', async () => {
      const retrieved = await walletService.getOrCreateWallet({ userId: testUser1.id });
      expect(retrieved.id).toBe(wallet1.id);
      expect(retrieved.userId).toBe(testUser1.id);
    });

    test('retrieves wallet by walletId and by userId', async () => {
      const byWalletId = await walletService.getWalletBalance({ walletId: wallet1.id });
      const byUserId = await walletService.getWalletBalance({ userId: testUser1.id });

      expect(byWalletId.id).toBe(wallet1.id);
      expect(byUserId.id).toBe(wallet1.id);
      expect(byWalletId.availableBalance).toBe('0');
    });

    test('throws WalletNotFoundError for unknown wallet ID or user ID', async () => {
      await expect(
        walletService.getWalletBalance({ walletId: '00000000-0000-0000-0000-000000000000' })
      ).rejects.toThrow(WalletNotFoundError);

      await expect(
        walletService.getWalletBalance({ userId: '00000000-0000-0000-0000-000000000000' })
      ).rejects.toThrow(WalletNotFoundError);
    });

    test('rejects unsupported currency with WalletValidationError', async () => {
      await expect(
        walletService.getOrCreateWallet({ userId: testUser1.id, currency: 'USD' })
      ).rejects.toThrow(WalletValidationError);
    });

    test('enforces ownership check when both walletId and userId are passed', async () => {
      wallet2 = await walletService.getOrCreateWallet({ userId: testUser2.id });

      // wallet1 belongs to testUser1, not testUser2
      await expect(
        walletService.getWalletBalance({ walletId: wallet1.id, userId: testUser2.id })
      ).rejects.toThrow(WalletNotFoundError);

      // Mutating method _lockWallet also enforces this ownership check
      await expect(
        walletService.creditAvailable({
          walletId: wallet1.id,
          userId: testUser2.id,
          amount: 1000,
          idempotencyKey: `ownership-fail-${suffix}`,
        })
      ).rejects.toThrow(WalletNotFoundError);
    });
  });

  // =========================================================================
  // 2. Monetary Amount Parsing and Boundary Validation
  // =========================================================================
  describe('2. Monetary Input Validation & Boundaries', () => {
    test('accepts valid BigInt, safe integer number, and digit strings', () => {
      expect(parseMonetaryAmount(1000n)).toBe(1000n);
      expect(parseMonetaryAmount(5000)).toBe(5000n);
      expect(parseMonetaryAmount('15000')).toBe(15000n);
      expect(parseMonetaryAmount(MAX_PAISE)).toBe(MAX_PAISE);
    });

    test('rejects non-positive, zero, and negative values', () => {
      expect(() => parseMonetaryAmount(0)).toThrow(WalletValidationError);
      expect(() => parseMonetaryAmount(0n)).toThrow(WalletValidationError);
      expect(() => parseMonetaryAmount(-100)).toThrow(WalletValidationError);
      expect(() => parseMonetaryAmount('-50')).toThrow(WalletValidationError);
    });

    test('rejects floating-point decimals and non-integers', () => {
      expect(() => parseMonetaryAmount(10.5)).toThrow(WalletValidationError);
      expect(() => parseMonetaryAmount('10.50')).toThrow(WalletValidationError);
      expect(() => parseMonetaryAmount(NaN)).toThrow(WalletValidationError);
      expect(() => parseMonetaryAmount(Infinity)).toThrow(WalletValidationError);
    });

    test('rejects missing or non-numeric inputs', () => {
      expect(() => parseMonetaryAmount(null)).toThrow(WalletValidationError);
      expect(() => parseMonetaryAmount(undefined)).toThrow(WalletValidationError);
      expect(() => parseMonetaryAmount('abc')).toThrow(WalletValidationError);
      expect(() => parseMonetaryAmount({})).toThrow(WalletValidationError);
    });

    test('rejects amounts exceeding MAX_PAISE', () => {
      expect(() => parseMonetaryAmount(MAX_PAISE + 1n)).toThrow(WalletValidationError);
    });
  });

  // =========================================================================
  // 3. Valid Credits, Debits, and Compensating Adjustments
  // =========================================================================
  describe('3. Valid Credits, Debits, and Compensating Adjustments', () => {
    test('credits available balance and produces immutable ledger entry with snapshots', async () => {
      const creditKey = `credit-1-${suffix}`;
      const result = await walletService.creditAvailable({
        walletId: wallet1.id,
        amount: 50000, // 500.00 INR
        idempotencyKey: creditKey,
        description: 'Initial deposit',
      });

      expect(result.isIdempotentReplay).toBe(false);
      expect(result.wallet.availableBalance).toBe('50000');
      expect(result.wallet.reservedBalance).toBe('0');
      expect(result.wallet.totalBalance).toBe('50000');
      expect(result.wallet.version).toBe('1');

      // Verify ledger entry
      expect(result.ledgerEntry.amount).toBe('50000');
      expect(result.ledgerEntry.availableDelta).toBe('50000');
      expect(result.ledgerEntry.reservedDelta).toBe('0');
      expect(result.ledgerEntry.balanceAfterAvailable).toBe('50000');
      expect(result.ledgerEntry.balanceAfterReserved).toBe('0');
      expect(result.ledgerEntry.entryType).toBe('DEPOSIT');

      // Verify operation
      expect(result.operation.status).toBe('COMPLETED');
      expect(result.operation.operationType).toBe('DEPOSIT');
    });

    test('debits available balance and produces negative delta ledger entry', async () => {
      const debitKey = `debit-1-${suffix}`;
      const result = await walletService.debitAvailable({
        walletId: wallet1.id,
        amount: 15000, // 150.00 INR
        idempotencyKey: debitKey,
        entryType: 'FEE_DEBIT',
        description: 'Platform fee',
      });

      expect(result.isIdempotentReplay).toBe(false);
      expect(result.wallet.availableBalance).toBe('35000'); // 50000 - 15000
      expect(result.wallet.version).toBe('2');

      expect(result.ledgerEntry.amount).toBe('15000');
      expect(result.ledgerEntry.availableDelta).toBe('-15000');
      expect(result.ledgerEntry.reservedDelta).toBe('0');
      expect(result.ledgerEntry.balanceAfterAvailable).toBe('35000');
      expect(result.ledgerEntry.balanceAfterReserved).toBe('0');
    });

    test('allows compensating adjustment credit as a new append-only entry', async () => {
      const adjKey = `comp-adj-credit-${suffix}`;
      const result = await walletService.creditAvailable({
        walletId: wallet1.id,
        amount: 5000,
        idempotencyKey: adjKey,
        entryType: 'COMPENSATING_ADJUSTMENT',
        operationType: 'COMPENSATING_ADJUSTMENT',
        description: 'Customer service credit adjustment',
      });

      expect(result.wallet.availableBalance).toBe('40000');
      expect(result.wallet.version).toBe('3');
      expect(result.ledgerEntry.entryType).toBe('COMPENSATING_ADJUSTMENT');
    });
  });

  // =========================================================================
  // 4. Insufficient Funds Rejection
  // =========================================================================
  describe('4. Insufficient Funds Handling', () => {
    test('rejects debit exceeding available balance without modifying state', async () => {
      const failKey = `debit-fail-${suffix}`;
      const balanceBefore = await walletService.getWalletBalance({ walletId: wallet1.id });

      await expect(
        walletService.debitAvailable({
          walletId: wallet1.id,
          amount: 100000, // 1,000 INR > 400 INR available
          idempotencyKey: failKey,
        })
      ).rejects.toThrow(InsufficientFundsError);

      const balanceAfter = await walletService.getWalletBalance({ walletId: wallet1.id });
      expect(balanceAfter.availableBalance).toBe(balanceBefore.availableBalance);
      expect(balanceAfter.version).toBe(balanceBefore.version);

      // Verify no operation record or ledger entry was created
      const op = await livePrisma.financialOperation.findUnique({
        where: { idempotencyKey: failKey },
      });
      expect(op).toBeNull();
    });

    test('rejects fund reservation exceeding available balance', async () => {
      const failResKey = `reserve-fail-${suffix}`;
      await expect(
        walletService.reserveFunds({
          walletId: wallet1.id,
          amount: 80000, // 800 INR > 400 INR available
          idempotencyKey: failResKey,
          reason: 'ORDER_ESCROW',
        })
      ).rejects.toThrow(InsufficientFundsError);

      const op = await livePrisma.financialOperation.findUnique({
        where: { idempotencyKey: failResKey },
      });
      expect(op).toBeNull();
    });
  });

  // =========================================================================
  // 5. Reservations and Full / Partial Releases
  // =========================================================================
  describe('5. Fund Reservations and Hold State Management', () => {
    let holdId;

    test('reserves funds by moving available to reserved and creating active hold', async () => {
      const resKey = `reserve-1-${suffix}`;
      const result = await walletService.reserveFunds({
        walletId: wallet1.id,
        amount: 20000, // 200 INR
        idempotencyKey: resKey,
        reason: 'ORDER_ESCROW',
        description: 'Escrow for order submission',
      });

      expect(result.isIdempotentReplay).toBe(false);
      expect(result.wallet.availableBalance).toBe('20000'); // 40000 - 20000
      expect(result.wallet.reservedBalance).toBe('20000'); // 0 + 20000
      expect(result.wallet.totalBalance).toBe('40000'); // Conserved!
      expect(result.wallet.version).toBe('4');

      expect(result.hold.heldAmount).toBe('20000');
      expect(result.hold.remainingAmount).toBe('20000');
      expect(result.hold.status).toBe('ACTIVE');
      expect(result.hold.reason).toBe('ORDER_ESCROW');

      expect(result.ledgerEntry.amount).toBe('20000');
      expect(result.ledgerEntry.availableDelta).toBe('-20000');
      expect(result.ledgerEntry.reservedDelta).toBe('20000');

      holdId = result.hold.id;
    });

    test('partially releases a hold back to available balance and sets PARTIALLY_RELEASED', async () => {
      const partialKey = `release-partial-${suffix}`;
      const result = await walletService.releaseHold({
        holdId,
        amount: 8000, // Release 80 INR of 200 INR hold
        idempotencyKey: partialKey,
        description: 'Partial order cancellation refund',
      });

      expect(result.wallet.availableBalance).toBe('28000'); // 20000 + 8000
      expect(result.wallet.reservedBalance).toBe('12000'); // 20000 - 8000
      expect(result.wallet.totalBalance).toBe('40000');
      expect(result.wallet.version).toBe('5');

      expect(result.hold.remainingAmount).toBe('12000');
      expect(result.hold.status).toBe('PARTIALLY_RELEASED');

      expect(result.ledgerEntry.amount).toBe('8000');
      expect(result.ledgerEntry.availableDelta).toBe('8000');
      expect(result.ledgerEntry.reservedDelta).toBe('-8000');
    });

    test('rejects releasing more than remaining hold amount', async () => {
      const overKey = `release-over-${suffix}`;
      await expect(
        walletService.releaseHold({
          holdId,
          amount: 25000, // 250 INR > 120 INR remaining
          idempotencyKey: overKey,
        })
      ).rejects.toThrow(HoldInvariantError);
    });

    test('fully releases remaining hold amount and transitions status to RELEASED', async () => {
      const fullKey = `release-full-${suffix}`;
      const result = await walletService.releaseHold({
        holdId,
        // Omitting amount releases full remainingAmount (12000)
        idempotencyKey: fullKey,
        description: 'Remaining order cancellation',
      });

      expect(result.wallet.availableBalance).toBe('40000');
      expect(result.wallet.reservedBalance).toBe('0');
      expect(result.wallet.version).toBe('6');

      expect(result.hold.remainingAmount).toBe('0');
      expect(result.hold.status).toBe('RELEASED');
    });

    test('rejects subsequent release on an already closed hold', async () => {
      const closedKey = `release-closed-${suffix}`;
      await expect(
        walletService.releaseHold({
          holdId,
          idempotencyKey: closedKey,
        })
      ).rejects.toThrow(HoldInvariantError);
    });

    test('supports repeated partial releases on the same hold until fully exhausted', async () => {
      // Create new hold of 15000 paise (150 INR)
      const res = await walletService.reserveFunds({
        walletId: wallet1.id,
        amount: 15000,
        idempotencyKey: `multi-rel-res-${suffix}`,
      });
      const mHoldId = res.hold.id;

      // Partial release 1: 5000 paise
      const r1 = await walletService.releaseHold({
        holdId: mHoldId,
        amount: 5000,
        idempotencyKey: `multi-rel-1-${suffix}`,
      });
      expect(r1.hold.remainingAmount).toBe('10000');
      expect(r1.hold.status).toBe('PARTIALLY_RELEASED');

      // Partial release 2: 5000 paise
      const r2 = await walletService.releaseHold({
        holdId: mHoldId,
        amount: 5000,
        idempotencyKey: `multi-rel-2-${suffix}`,
      });
      expect(r2.hold.remainingAmount).toBe('5000');
      expect(r2.hold.status).toBe('PARTIALLY_RELEASED');

      // Exact-final release 3: 5000 paise
      const r3 = await walletService.releaseHold({
        holdId: mHoldId,
        amount: 5000,
        idempotencyKey: `multi-rel-3-${suffix}`,
      });
      expect(r3.hold.remainingAmount).toBe('0');
      expect(r3.hold.status).toBe('RELEASED');

      // Attempting release 4 fails
      await expect(
        walletService.releaseHold({
          holdId: mHoldId,
          amount: 1000,
          idempotencyKey: `multi-rel-4-${suffix}`,
        })
      ).rejects.toThrow(HoldInvariantError);
    });

    test('concurrent partial releases on the same hold serialize cleanly without overdraft', async () => {
      // Create hold of 30000 paise
      const res = await walletService.reserveFunds({
        walletId: wallet1.id,
        amount: 30000,
        idempotencyKey: `conc-hold-res-${suffix}`,
      });
      const cHoldId = res.hold.id;

      // Attempt 4 concurrent releases of 10000 each (Total 40000 > 30000 held)
      const tasks = Array.from({ length: 4 }, (_, i) => {
        return walletService
          .releaseHold({
            holdId: cHoldId,
            amount: 10000,
            idempotencyKey: `conc-hold-rel-${i}-${suffix}`,
          })
          .then((r) => ({ success: true, result: r }))
          .catch((e) => ({ success: false, error: e }));
      });

      const outcomes = await Promise.all(tasks);
      const succeeded = outcomes.filter((o) => o.success);
      const failed = outcomes.filter((o) => !o.success);

      expect(succeeded).toHaveLength(3); // Exactly 3 can succeed (3 * 10000 = 30000)
      expect(failed).toHaveLength(1);
      expect(failed[0].error).toBeInstanceOf(HoldInvariantError);

      const finalHold = await livePrisma.walletHold.findUnique({ where: { id: cHoldId } });
      expect(finalHold.remainingAmount).toBe(0n);
      expect(finalHold.status).toBe('RELEASED');
    });
  });

  // =========================================================================
  // 6. Idempotency Semantics
  // =========================================================================
  describe('6. Idempotency Semantics & Conflict Detection', () => {
    test('returns original outcome on repeated request with same key and same payload', async () => {
      const replayKey = `idemp-replay-${suffix}`;

      // First request
      const first = await walletService.creditAvailable({
        walletId: wallet1.id,
        amount: 10000,
        idempotencyKey: replayKey,
        description: 'First idempotent attempt',
      });
      expect(first.isIdempotentReplay).toBe(false);
      expect(first.wallet.availableBalance).toBe('50000');

      // Second identical request
      const second = await walletService.creditAvailable({
        walletId: wallet1.id,
        amount: 10000,
        idempotencyKey: replayKey,
        description: 'First idempotent attempt',
      });
      expect(second.isIdempotentReplay).toBe(true);
      expect(second.operation.id).toBe(first.operation.id);
      expect(second.ledgerEntry.id).toBe(first.ledgerEntry.id);
      // Balance was NOT credited a second time:
      expect(second.wallet.availableBalance).toBe('50000');
      expect(second.wallet.version).toBe(first.wallet.version);
    });

    test('rejects reused key with different business payload (different amount)', async () => {
      const conflictKey = `idemp-conflict-${suffix}`;

      await walletService.creditAvailable({
        walletId: wallet1.id,
        amount: 10000,
        idempotencyKey: conflictKey,
      });

      // Attempt to reuse key with 20000 amount
      await expect(
        walletService.creditAvailable({
          walletId: wallet1.id,
          amount: 20000,
          idempotencyKey: conflictKey,
        })
      ).rejects.toThrow(IdempotencyConflictError);
    });

    test('rejects reused key with different target wallet', async () => {
      wallet2 = await walletService.getOrCreateWallet({ userId: testUser2.id });
      const crossWalletKey = `cross-wallet-${suffix}`;

      await walletService.creditAvailable({
        walletId: wallet1.id,
        amount: 5000,
        idempotencyKey: crossWalletKey,
      });

      // Attempt to reuse key on wallet2
      await expect(
        walletService.creditAvailable({
          walletId: wallet2.id,
          amount: 5000,
          idempotencyKey: crossWalletKey,
        })
      ).rejects.toThrow(IdempotencyConflictError);
    });

    test('retry after transaction definitively rolled back executes cleanly and commits', async () => {
      const rollbackRetryKey = `rollback-retry-${suffix}`;

      // Simulate a failed transaction using this key
      try {
        await livePrisma.$transaction(async (tx) => {
          await walletService.creditAvailable(
            {
              walletId: wallet1.id,
              amount: 5000,
              idempotencyKey: rollbackRetryKey,
            },
            tx
          );
          throw new Error('SIMULATED_ABORT');
        });
      } catch (err) {
        expect(err.message).toBe('SIMULATED_ABORT');
      }

      // Verify that NO operation record was committed for this key
      const op = await livePrisma.financialOperation.findUnique({
        where: { idempotencyKey: rollbackRetryKey },
      });
      expect(op).toBeNull();

      // Now retry the operation with the SAME key outside the failing transaction
      const retried = await walletService.creditAvailable({
        walletId: wallet1.id,
        amount: 5000,
        idempotencyKey: rollbackRetryKey,
      });

      expect(retried.isIdempotentReplay).toBe(false);
      expect(retried.operation.idempotencyKey).toBe(rollbackRetryKey);

      // Verify it was committed
      const committedOp = await livePrisma.financialOperation.findUnique({
        where: { idempotencyKey: rollbackRetryKey },
      });
      expect(committedOp).not.toBeNull();
    });
  });

  // =========================================================================
  // 7. Concurrency & Contention Handling
  // =========================================================================
  describe('7. Concurrency and Race Condition Safety', () => {
    test('concurrent duplicate requests with same key produce exactly one posting', async () => {
      const concurrentKey = `concurrent-dup-${suffix}`;

      const promises = [
        walletService.creditAvailable({
          walletId: wallet1.id,
          amount: 10000,
          idempotencyKey: concurrentKey,
        }),
        walletService.creditAvailable({
          walletId: wallet1.id,
          amount: 10000,
          idempotencyKey: concurrentKey,
        }),
        walletService.creditAvailable({
          walletId: wallet1.id,
          amount: 10000,
          idempotencyKey: concurrentKey,
        }),
      ];

      const results = await Promise.all(promises);

      // All 3 succeed without throwing unhandled exceptions
      expect(results).toHaveLength(3);

      // Exactly one was the original poster, two were idempotent replays
      const originals = results.filter((r) => !r.isIdempotentReplay);
      const replays = results.filter((r) => r.isIdempotentReplay);

      expect(originals).toHaveLength(1);
      expect(replays).toHaveLength(2);

      // Exactly one ledger entry exists in DB for this key
      const entries = await livePrisma.walletLedgerEntry.findMany({
        where: { idempotencyKey: concurrentKey },
      });
      expect(entries).toHaveLength(1);
    });

    test('concurrent spending from one wallet serializes cleanly without overdraft', async () => {
      // Wallet balance before this test: 65000 paise (650 INR)
      const current = await walletService.getWalletBalance({ walletId: wallet1.id });
      const startingAvailable = BigInt(current.availableBalance);

      // Launch 5 concurrent debits of 20000 paise each (Total requested: 100,000 paise > available)
      const spendAmount = 20000n;
      const tasks = Array.from({ length: 5 }, (_, i) => {
        return walletService
          .debitAvailable({
            walletId: wallet1.id,
            amount: spendAmount,
            idempotencyKey: `concurrent-spend-${i}-${suffix}`,
          })
          .then((res) => ({ success: true, result: res }))
          .catch((err) => ({ success: false, error: err }));
      });

      const outcomes = await Promise.all(tasks);

      const succeeded = outcomes.filter((o) => o.success);
      const failed = outcomes.filter((o) => !o.success);

      // Calculate how many could legitimately succeed
      const expectedSuccessCount = Number(startingAvailable / spendAmount);
      expect(succeeded).toHaveLength(expectedSuccessCount);

      // All failures must be InsufficientFundsError
      failed.forEach((f) => {
        expect(f.error).toBeInstanceOf(InsufficientFundsError);
      });

      // Verify final balance matches startingAvailable - (succeeded * spendAmount)
      const final = await walletService.getWalletBalance({ walletId: wallet1.id });
      const expectedFinal = startingAvailable - BigInt(succeeded.length) * spendAmount;
      expect(final.availableBalance).toBe(expectedFinal.toString());
      expect(BigInt(final.availableBalance) >= 0n).toBe(true);
    });

    test('concurrent requests with same key but different amounts reject with IdempotencyConflictError', async () => {
      const conflictConcKey = `concurrent-conflict-${suffix}`;

      const tasks = [
        walletService
          .creditAvailable({
            walletId: wallet1.id,
            amount: 10000,
            idempotencyKey: conflictConcKey,
          })
          .then((r) => ({ success: true, result: r }))
          .catch((e) => ({ success: false, error: e })),
        walletService
          .creditAvailable({
            walletId: wallet1.id,
            amount: 20000,
            idempotencyKey: conflictConcKey,
          })
          .then((r) => ({ success: true, result: r }))
          .catch((e) => ({ success: false, error: e })),
      ];

      const outcomes = await Promise.all(tasks);
      const succeeded = outcomes.filter((o) => o.success);
      const failed = outcomes.filter((o) => !o.success);

      expect(succeeded).toHaveLength(1);
      expect(failed).toHaveLength(1);
      expect(failed[0].error).toBeInstanceOf(IdempotencyConflictError);
    });

    test('concurrent requests with same key across different wallets reject with IdempotencyConflictError', async () => {
      const crossConcKey = `concurrent-cross-wallet-${suffix}`;

      const tasks = [
        walletService
          .creditAvailable({
            walletId: wallet1.id,
            amount: 5000,
            idempotencyKey: crossConcKey,
          })
          .then((r) => ({ success: true, result: r }))
          .catch((e) => ({ success: false, error: e })),
        walletService
          .creditAvailable({
            walletId: wallet2.id,
            amount: 5000,
            idempotencyKey: crossConcKey,
          })
          .then((r) => ({ success: true, result: r }))
          .catch((e) => ({ success: false, error: e })),
      ];

      const outcomes = await Promise.all(tasks);
      const succeeded = outcomes.filter((o) => o.success);
      const failed = outcomes.filter((o) => !o.success);

      expect(succeeded).toHaveLength(1);
      expect(failed).toHaveLength(1);
      expect(failed[0].error).toBeInstanceOf(IdempotencyConflictError);
    });
  });

  // =========================================================================
  // 8. Transaction Atomicity and Invariant Auditing
  // =========================================================================
  describe('8. Invariant Auditing and Rollback Atomicity', () => {
    test('transaction failure causes zero partial projection or ledger changes', async () => {
      const rollbackKey = `rollback-test-${suffix}`;
      const stateBefore = await walletService.getWalletBalance({ walletId: wallet1.id });

      // Intentionally execute a transaction that crashes after updating balance
      await expect(
        livePrisma.$transaction(async (tx) => {
          await tx.wallet.update({
            where: { id: wallet1.id },
            data: { availableBalance: 99999999n },
          });

          // Simulate unhandled failure before commit
          throw new Error('SIMULATED_TRANSACTION_FAILURE');
        })
      ).rejects.toThrow('SIMULATED_TRANSACTION_FAILURE');

      const stateAfter = await walletService.getWalletBalance({ walletId: wallet1.id });
      expect(stateAfter.availableBalance).toBe(stateBefore.availableBalance);
      expect(stateAfter.version).toBe(stateBefore.version);
    });

    test('audit: wallet balance equals exact sum of all immutable ledger deltas', async () => {
      const wallet = await livePrisma.wallet.findUnique({
        where: { id: wallet1.id },
      });

      const entries = await livePrisma.walletLedgerEntry.findMany({
        where: { walletId: wallet1.id },
      });

      let sumAvailable = 0n;
      let sumReserved = 0n;

      for (const entry of entries) {
        sumAvailable += BigInt(entry.availableDelta);
        sumReserved += BigInt(entry.reservedDelta);
      }

      expect(wallet.availableBalance).toBe(sumAvailable);
      expect(wallet.reservedBalance).toBe(sumReserved);
    });

    test('audit: reserved balance equals exact sum of active holds remaining amount', async () => {
      const activeHolds = await livePrisma.walletHold.findMany({
        where: {
          walletId: wallet1.id,
          status: { in: ['ACTIVE', 'PARTIALLY_RELEASED', 'PARTIALLY_SETTLED'] },
        },
      });

      const sumHolds = activeHolds.reduce((acc, h) => acc + BigInt(h.remainingAmount), 0n);
      const wallet = await livePrisma.wallet.findUnique({ where: { id: wallet1.id } });

      expect(wallet.reservedBalance).toBe(sumHolds);
    });
  });
});
