/**
 * Step 9.1 — Wallet and Immutable Ledger Schema Integration Tests
 *
 * Validates the database schema, models, constraints, and invariants:
 * 1. Wallet creation with integer minor units (paise) and 1:1 User relationship.
 * 2. Uniqueness constraints on Wallet.userId, FinancialOperation.idempotencyKey,
 *    WalletHold.(walletId, idempotencyKey), and WalletLedgerEntry.(walletId, idempotencyKey).
 * 3. Monotonic auto-incrementing sequenceNumber on WalletLedgerEntry.
 * 4. Database-level uniqueness constraint on Order.sequenceNumber.
 * 5. Anti-cascade deletion protections (onDelete: Restrict) across User, Wallet, Order, Execution, and Ledger.
 * 6. Mathematical invariants for available vs. reserved funds and immutable ledger deltas.
 */

import { jest } from '@jest/globals';
import { prisma as livePrisma } from '../../src/db/prisma.js';

describe('Step 9.1 — Wallet and Immutable Ledger Schema (Live PostgreSQL)', () => {
  jest.setTimeout(60000);

  const suffix = Math.random().toString(36).substring(2, 8);
  let testUser;
  let secondUser;
  let testEvent;
  let testCategory;
  let testOrder;
  let testExecution;

  beforeAll(async () => {
    // Create base user and event entities for relationship testing
    testUser = await livePrisma.user.create({
      data: {
        email: `wallet-test-${suffix}@test.passflow.com`,
        passwordHash: 'dummy-hash',
        name: 'Wallet Test User',
      },
    });

    secondUser = await livePrisma.user.create({
      data: {
        email: `wallet-test-2-${suffix}@test.passflow.com`,
        passwordHash: 'dummy-hash',
        name: 'Wallet Test User 2',
      },
    });

    testEvent = await livePrisma.event.create({
      data: {
        name: `Wallet Event ${suffix}`,
        dateTime: new Date(Date.now() + 86400000 * 10),
        location: 'Mumbai Arena',
        organizer: {
          create: {
            organizationName: `Wallet Org ${suffix}`,
            user: {
              create: {
                email: `wallet-org-${suffix}@test.passflow.com`,
                passwordHash: 'dummy-hash',
              },
            },
          },
        },
      },
    });

    testCategory = await livePrisma.ticketCategory.create({
      data: {
        eventId: testEvent.id,
        name: 'General Admission',
        originalPrice: 100.0,
        totalQuantity: 50,
        availableQuantity: 50,
      },
    });

    testOrder = await livePrisma.order.create({
      data: {
        userId: testUser.id,
        eventId: testEvent.id,
        ticketCategoryId: testCategory.id,
        side: 'BID',
        status: 'OPEN',
        price: 10000, // 100.00 INR = 10000 paise
        initialQuantity: 2,
        remainingQuantity: 2,
        idempotencyKey: `order-idem-${suffix}`,
      },
    });

    const makerOrder = await livePrisma.order.create({
      data: {
        userId: secondUser.id,
        eventId: testEvent.id,
        ticketCategoryId: testCategory.id,
        side: 'ASK',
        status: 'FILLED',
        price: 10000,
        initialQuantity: 1,
        remainingQuantity: 0,
        idempotencyKey: `maker-idem-${suffix}`,
      },
    });

    testExecution = await livePrisma.execution.create({
      data: {
        incomingOrderId: testOrder.id,
        restingOrderId: makerOrder.id,
        price: 10000,
        quantity: 1,
      },
    });
  });

  afterAll(async () => {
    // Clean up created entities in reverse order of foreign keys
    try {
      await livePrisma.walletLedgerEntry.deleteMany({
        where: { wallet: { userId: { in: [testUser.id, secondUser.id] } } },
      });
      await livePrisma.walletHold.deleteMany({
        where: { wallet: { userId: { in: [testUser.id, secondUser.id] } } },
      });
      await livePrisma.financialOperation.deleteMany({
        where: { idempotencyKey: { contains: suffix } },
      });
      await livePrisma.wallet.deleteMany({
        where: { userId: { in: [testUser.id, secondUser.id] } },
      });
      await livePrisma.execution.deleteMany({
        where: { incomingOrder: { eventId: testEvent.id } },
      });
      await livePrisma.order.deleteMany({
        where: { eventId: testEvent.id },
      });
      await livePrisma.ticketCategory.deleteMany({
        where: { eventId: testEvent.id },
      });
      await livePrisma.event.deleteMany({
        where: { id: testEvent.id },
      });
      await livePrisma.organizer.deleteMany({
        where: { organizationName: `Wallet Org ${suffix}` },
      });
      await livePrisma.user.deleteMany({
        where: {
          email: {
            in: [
              `wallet-test-${suffix}@test.passflow.com`,
              `wallet-test-2-${suffix}@test.passflow.com`,
              `wallet-org-${suffix}@test.passflow.com`,
            ],
          },
        },
      });
    } catch (err) {
      console.warn('Cleanup error in wallet schema test:', err.message);
    }
    await livePrisma.$disconnect();
  });

  describe('1. Wallet Model & Invariants', () => {
    it('creates a wallet with 0 available and 0 reserved integer paise balance', async () => {
      const wallet = await livePrisma.wallet.create({
        data: {
          userId: testUser.id,
          currency: 'INR',
        },
      });

      expect(wallet.id).toBeDefined();
      expect(wallet.userId).toBe(testUser.id);
      expect(wallet.currency).toBe('INR');
      expect(wallet.availableBalance).toBe(0n);
      expect(wallet.reservedBalance).toBe(0n);
      expect(wallet.version).toBe(0n);
    });

    it('enforces 1:1 uniqueness constraint between User and Wallet', async () => {
      // Attempting to create a second wallet for testUser must fail with P2002
      await expect(
        livePrisma.wallet.create({
          data: {
            userId: testUser.id,
            currency: 'INR',
          },
        })
      ).rejects.toThrow();
    });
  });

  describe('2. FinancialOperation Idempotency', () => {
    it('creates a financial operation and enforces idempotencyKey uniqueness', async () => {
      const op = await livePrisma.financialOperation.create({
        data: {
          idempotencyKey: `op-funding-${suffix}`,
          operationType: 'DEPOSIT',
          status: 'COMPLETED',
          description: 'Initial wallet deposit of 1000 INR',
        },
      });

      expect(op.idempotencyKey).toBe(`op-funding-${suffix}`);
      expect(op.operationType).toBe('DEPOSIT');
      expect(op.status).toBe('COMPLETED');

      // Duplicate idempotencyKey must be rejected
      await expect(
        livePrisma.financialOperation.create({
          data: {
            idempotencyKey: `op-funding-${suffix}`,
            operationType: 'DEPOSIT',
            status: 'COMPLETED',
          },
        })
      ).rejects.toThrow();
    });
  });

  describe('3. WalletHold Lifecycle & Constraints', () => {
    it('creates a fund reservation (hold) linked to an order and enforces walletId_idempotencyKey uniqueness', async () => {
      const wallet = await livePrisma.wallet.findUnique({ where: { userId: testUser.id } });

      const hold = await livePrisma.walletHold.create({
        data: {
          walletId: wallet.id,
          orderId: testOrder.id,
          reason: 'ORDER_ESCROW',
          status: 'ACTIVE',
          heldAmount: 20000n, // 200.00 INR = 20000 paise
          remainingAmount: 20000n,
          idempotencyKey: `hold-order-${suffix}`,
        },
      });

      expect(hold.heldAmount).toBe(20000n);
      expect(hold.remainingAmount).toBe(20000n);
      expect(hold.status).toBe('ACTIVE');

      // Duplicate hold idempotencyKey on the same wallet must be rejected
      await expect(
        livePrisma.walletHold.create({
          data: {
            walletId: wallet.id,
            orderId: testOrder.id,
            heldAmount: 20000n,
            remainingAmount: 20000n,
            idempotencyKey: `hold-order-${suffix}`,
          },
        })
      ).rejects.toThrow();
    });
  });

  describe('4. WalletLedgerEntry Monotonicity & Balance Invariants', () => {
    it('creates immutable ledger entries with auto-incrementing monotonic sequenceNumber', async () => {
      const wallet = await livePrisma.wallet.findUnique({ where: { userId: testUser.id } });
      const op = await livePrisma.financialOperation.findUnique({
        where: { idempotencyKey: `op-funding-${suffix}` },
      });

      // Entry 1: Deposit of 500.00 INR (50000 paise)
      const entry1 = await livePrisma.walletLedgerEntry.create({
        data: {
          walletId: wallet.id,
          operationId: op.id,
          entryType: 'DEPOSIT',
          amount: 50000n,
          availableDelta: 50000n,
          reservedDelta: 0n,
          balanceAfterAvailable: 50000n,
          balanceAfterReserved: 0n,
          idempotencyKey: `ledger-dep-${suffix}`,
          description: 'Wallet deposit',
        },
      });

      // Entry 2: Order Hold of 200.00 INR (20000 paise)
      // Conservation invariant: availableDelta (-20000) + reservedDelta (+20000) === 0
      const entry2 = await livePrisma.walletLedgerEntry.create({
        data: {
          walletId: wallet.id,
          entryType: 'ORDER_HOLD',
          amount: 20000n,
          availableDelta: -20000n,
          reservedDelta: 20000n,
          balanceAfterAvailable: 30000n,
          balanceAfterReserved: 20000n,
          orderId: testOrder.id,
          idempotencyKey: `ledger-hold-${suffix}`,
          description: 'Reserve funds for order',
        },
      });

      // Entry 3: Settlement Debit of 100.00 INR (10000 paise)
      const entry3 = await livePrisma.walletLedgerEntry.create({
        data: {
          walletId: wallet.id,
          entryType: 'TRADE_SETTLEMENT_DEBIT',
          amount: 10000n,
          availableDelta: 0n,
          reservedDelta: -10000n,
          balanceAfterAvailable: 30000n,
          balanceAfterReserved: 10000n,
          orderId: testOrder.id,
          executionId: testExecution.id,
          idempotencyKey: `ledger-settle-${suffix}`,
          description: 'Debit trade settlement',
        },
      });

      // Verify strictly monotonic sequence allocation
      expect(entry1.sequenceNumber).toBeDefined();
      expect(entry2.sequenceNumber).toBeGreaterThan(entry1.sequenceNumber);
      expect(entry3.sequenceNumber).toBeGreaterThan(entry2.sequenceNumber);

      // Verify conservation invariant on reservation
      expect(entry2.availableDelta + entry2.reservedDelta).toBe(0n);

      // Verify mathematical balance projection invariant across entries
      const allEntries = await livePrisma.walletLedgerEntry.findMany({
        where: { walletId: wallet.id },
        orderBy: { sequenceNumber: 'asc' },
      });

      let calculatedAvailable = 0n;
      let calculatedReserved = 0n;
      for (const e of allEntries) {
        calculatedAvailable += e.availableDelta;
        calculatedReserved += e.reservedDelta;
      }

      expect(calculatedAvailable).toBe(30000n);
      expect(calculatedReserved).toBe(10000n);
      expect(calculatedAvailable + calculatedReserved).toBe(40000n); // Total balance: 50000 deposit - 10000 settlement debit = 40000
    });

    it('enforces walletId_idempotencyKey uniqueness on ledger entries', async () => {
      const wallet = await livePrisma.wallet.findUnique({ where: { userId: testUser.id } });

      // Attempt duplicate posting with same idempotencyKey must fail
      await expect(
        livePrisma.walletLedgerEntry.create({
          data: {
            walletId: wallet.id,
            entryType: 'DEPOSIT',
            amount: 50000n,
            availableDelta: 50000n,
            reservedDelta: 0n,
            balanceAfterAvailable: 50000n,
            balanceAfterReserved: 0n,
            idempotencyKey: `ledger-dep-${suffix}`,
          },
        })
      ).rejects.toThrow();
    });
  });

  describe('5. Referential Integrity & Anti-Cascade Deletion (onDelete: Restrict)', () => {
    it('prevents deletion of a User who owns a Wallet', async () => {
      // Attempting to delete testUser must be rejected by foreign key constraint
      await expect(
        livePrisma.user.delete({
          where: { id: testUser.id },
        })
      ).rejects.toThrow();
    });

    it('prevents deletion of a Wallet that contains WalletLedgerEntry records', async () => {
      const wallet = await livePrisma.wallet.findUnique({ where: { userId: testUser.id } });

      await expect(
        livePrisma.wallet.delete({
          where: { id: wallet.id },
        })
      ).rejects.toThrow();
    });

    it('prevents deletion of an Order that is referenced by a WalletHold or WalletLedgerEntry', async () => {
      await expect(
        livePrisma.order.delete({
          where: { id: testOrder.id },
        })
      ).rejects.toThrow();
    });

    it('prevents deletion of an Execution that is referenced by a WalletLedgerEntry', async () => {
      await expect(
        livePrisma.execution.delete({
          where: { id: testExecution.id },
        })
      ).rejects.toThrow();
    });

    it('prevents deletion of a FinancialOperation referenced by a WalletLedgerEntry', async () => {
      const op = await livePrisma.financialOperation.findUnique({
        where: { idempotencyKey: `op-funding-${suffix}` },
      });

      await expect(
        livePrisma.financialOperation.delete({
          where: { id: op.id },
        })
      ).rejects.toThrow();
    });
  });

  describe('6. Order.sequenceNumber Uniqueness Constraint', () => {
    it('enforces database-level uniqueness on Order.sequenceNumber', async () => {
      const existingOrder = await livePrisma.order.findUnique({
        where: { id: testOrder.id },
      });

      expect(existingOrder.sequenceNumber).toBeDefined();

      // Attempting to manually insert an Order with an identical sequenceNumber must fail
      await expect(
        livePrisma.order.create({
          data: {
            userId: secondUser.id,
            eventId: testEvent.id,
            ticketCategoryId: testCategory.id,
            side: 'BID',
            status: 'OPEN',
            price: 10000,
            initialQuantity: 1,
            remainingQuantity: 1,
            sequenceNumber: existingOrder.sequenceNumber,
            idempotencyKey: `seq-collision-test-${suffix}`,
          },
        })
      ).rejects.toThrow();
    });
  });
});
