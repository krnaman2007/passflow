/**
 * Market Reconstruction and Reconciliation Test Suite (Step 8.4)
 *
 * Verifies startup order-book reconstruction, post-commit failure recovery,
 * ambiguous commit reconciliation, and market synchronization certification.
 *
 * 16 Deterministic Test Scenarios:
 * 1. Empty market reconstruction.
 * 2. Multiple prices and FIFO ordering within each price level.
 * 3. Partially filled resting orders.
 * 4. Cancelled, filled, and STP-cancelled orders excluded from active book.
 * 5. Invalid persisted active order causes quarantine rather than silent skipping.
 * 6. Database query failure leaves the market unavailable.
 * 7. Repeated reconstruction produces equivalent book state.
 * 8. Recovery after ambiguous commit where incoming order committed.
 * 9. Recovery after authoritative confirmation that incoming order did not commit.
 * 10. Recovery when PostgreSQL is unavailable.
 * 11. Post-commit applyPlan() failure followed by reconstruction.
 * 12. A paused market remains PAUSED after reconstruction.
 * 13. Submissions cannot interleave with reconstruction.
 * 14. A concurrent pause prevents reconciliation from re-enabling the market.
 * 15. Existing idempotency retries return original outcome after recovery.
 * 16. Cross-market isolation remains intact.
 *
 * Plus Section 17: Live PostgreSQL Database Integration (Neon).
 */

import { jest } from '@jest/globals';
import { OrderBook } from '../../src/services/matching/order-book.js';
import { MatchingCoordinator } from '../../src/services/matching/matching-coordinator.js';
import {
  MarketExecutionQueue,
  MarketState,
  MarketStateManager,
  MarketNotReadyError,
  formatMarketKey,
} from '../../src/services/matching/market-execution-queue.js';
import { OrderRepository } from '../../src/services/matching/order-repository.js';
import {
  PersistentMatchingService,
  MarketReconstructionError,
  MarketReconciliationError,
  MarketNotSynchronizedError,
  PostCommitMutationError,
} from '../../src/services/matching/persistent-matching-service.js';
import { prisma as livePrisma } from '../../src/db/prisma.js';

/**
 * Mock Prisma Client supporting in-memory transactional semantics,
 * deterministic ordering, filter evaluation, and failure injection.
 */
class MockPrismaClient {
  constructor() {
    this.orders = new Map();
    this.executions = new Map();
    this.sequenceCounter = 1n;
    this.failNextTransaction = null;
    this.failNextFindMany = null;
    this.failNextFindUnique = null;
    this.delayPromise = null;
  }

  get order() {
    return {
      findUnique: async ({ where }) => {
        if (this.failNextFindUnique) {
          const err = this.failNextFindUnique;
          this.failNextFindUnique = null;
          throw err;
        }
        if (where.id) {
          return this.orders.get(where.id) || null;
        }
        if (where.userId_idempotencyKey) {
          const { userId, idempotencyKey } = where.userId_idempotencyKey;
          for (const order of this.orders.values()) {
            if (order.userId === userId && order.idempotencyKey === idempotencyKey) {
              const incomingExecs = Array.from(this.executions.values()).filter(
                (e) => e.incomingOrderId === order.id
              );
              return { ...order, incomingExecutions: incomingExecs };
            }
          }
          return null;
        }
        return null;
      },
      findMany: async ({ where, orderBy } = {}) => {
        if (this.failNextFindMany) {
          const err = this.failNextFindMany;
          this.failNextFindMany = null;
          throw err;
        }
        let results = Array.from(this.orders.values());
        if (where) {
          if (where.eventId) results = results.filter((o) => o.eventId === where.eventId);
          if (where.ticketCategoryId) results = results.filter((o) => o.ticketCategoryId === where.ticketCategoryId);
          if (where.status?.in) results = results.filter((o) => where.status.in.includes(o.status));
          if (where.remainingQuantity?.gt !== undefined) {
            results = results.filter((o) => o.remainingQuantity > where.remainingQuantity.gt);
          }
        }
        if (orderBy && Array.isArray(orderBy)) {
          results.sort((a, b) => {
            for (const clause of orderBy) {
              const key = Object.keys(clause)[0];
              const dir = clause[key] === 'desc' ? -1 : 1;
              if (a[key] < b[key]) return -1 * dir;
              if (a[key] > b[key]) return 1 * dir;
            }
            return 0;
          });
        }
        return results;
      },
      count: async ({ where } = {}) => {
        const items = await this.order.findMany({ where });
        return items.length;
      },
      create: async ({ data }) => {
        if (data.userId && data.idempotencyKey) {
          for (const existing of this.orders.values()) {
            if (existing.userId === data.userId && existing.idempotencyKey === data.idempotencyKey) {
              const err = new Error('Unique constraint failed on the fields: (`userId`,`idempotencyKey`)');
              err.code = 'P2002';
              err.meta = { target: ['userId', 'idempotencyKey'] };
              throw err;
            }
          }
        }
        const record = {
          ...data,
          id: data.id || `order-${Math.random().toString(36).substring(2, 9)}`,
          createdAt: data.createdAt || new Date(),
          updatedAt: new Date(),
        };
        this.orders.set(record.id, record);
        return record;
      },
      updateMany: async ({ where, data }) => {
        const existing = this.orders.get(where.id);
        if (!existing) {
          return { count: 0 };
        }
        if (where.remainingQuantity !== undefined && existing.remainingQuantity !== where.remainingQuantity) {
          return { count: 0 };
        }
        Object.assign(existing, data, { updatedAt: new Date() });
        return { count: 1 };
      },
    };
  }

  get execution() {
    return {
      create: async ({ data }) => {
        const id = data.id || `exec-${Math.random().toString(36).substring(2, 9)}`;
        const record = {
          ...data,
          id,
          sequenceNumber: this.sequenceCounter++,
          executedAt: new Date(),
        };
        this.executions.set(id, record);
        return record;
      },
    };
  }

  async $transaction(fn) {
    if (this.delayPromise) {
      await this.delayPromise;
    }
    if (this.failNextTransaction) {
      const err = this.failNextTransaction;
      this.failNextTransaction = null;
      throw err;
    }

    const snapshotOrders = new Map(Array.from(this.orders.entries()).map(([k, v]) => [k, { ...v }]));
    const snapshotExecutions = new Map(Array.from(this.executions.entries()).map(([k, v]) => [k, { ...v }]));
    const snapshotSeq = this.sequenceCounter;

    try {
      const result = await fn(this);
      return result;
    } catch (err) {
      this.orders = snapshotOrders;
      this.executions = snapshotExecutions;
      this.sequenceCounter = snapshotSeq;
      throw err;
    }
  }
}

describe('Step 8.4 — Startup Order-Book Reconstruction and Reconciliation', () => {
  const MARKET_CONFIG = {
    eventId: 'event-oasis-2026',
    ticketCategoryId: 'cat-vip-standing',
  };
  const MARKET_KEY = formatMarketKey(MARKET_CONFIG);

  let mockPrisma;
  let repository;
  let queue;
  let stateManager;
  let coordinator;
  let service;

  beforeEach(() => {
    mockPrisma = new MockPrismaClient();
    repository = new OrderRepository({ prismaClient: mockPrisma });
    stateManager = new MarketStateManager();
    queue = new MarketExecutionQueue({ stateManager });
    coordinator = new MatchingCoordinator();
    service = new PersistentMatchingService({
      repository,
      queue,
      coordinator,
      stateManager,
    });
  });

  describe('1. Empty Market Reconstruction', () => {
    it('reconstructs an empty market cleanly and transitions to READY', async () => {
      // Market has 0 database orders
      const result = await service.initializeAndSynchronizeMarket(MARKET_CONFIG);

      expect(result.activeOrdersCount).toBe(0);
      expect(result.totalRemainingQuantity).toBe(0);
      expect(result.marketState).toBe(MarketState.READY);
      expect(service.isMarketSynchronized(MARKET_KEY)).toBe(true);

      const book = service.getMarketBook(MARKET_KEY);
      expect(book).toBeDefined();
      expect(book.isEmpty()).toBe(true);
    });
  });

  describe('2. Multiple Prices & FIFO Priority within Price Levels', () => {
    it('reconstructs multiple price levels and strictly preserves FIFO queue order within each price level', async () => {
      const now = Date.now();

      // Seed 3 ASKs: two at price 10000 (arrival order A then B) and one at 11000
      await mockPrisma.order.create({
        data: {
          id: 'ask-10000-first',
          userId: 'seller-1',
          eventId: MARKET_CONFIG.eventId,
          ticketCategoryId: MARKET_CONFIG.ticketCategoryId,
          side: 'ASK',
          status: 'OPEN',
          price: 10000,
          initialQuantity: 2,
          remainingQuantity: 2,
          createdAt: new Date(now),
        },
      });

      await mockPrisma.order.create({
        data: {
          id: 'ask-10000-second',
          userId: 'seller-2',
          eventId: MARKET_CONFIG.eventId,
          ticketCategoryId: MARKET_CONFIG.ticketCategoryId,
          side: 'ASK',
          status: 'OPEN',
          price: 10000,
          initialQuantity: 3,
          remainingQuantity: 3,
          createdAt: new Date(now + 10),
        },
      });

      await mockPrisma.order.create({
        data: {
          id: 'ask-11000',
          userId: 'seller-3',
          eventId: MARKET_CONFIG.eventId,
          ticketCategoryId: MARKET_CONFIG.ticketCategoryId,
          side: 'ASK',
          status: 'OPEN',
          price: 11000,
          initialQuantity: 5,
          remainingQuantity: 5,
          createdAt: new Date(now + 20),
        },
      });

      // Seed 2 BIDs: at price 9000 and 8500
      await mockPrisma.order.create({
        data: {
          id: 'bid-9000',
          userId: 'buyer-1',
          eventId: MARKET_CONFIG.eventId,
          ticketCategoryId: MARKET_CONFIG.ticketCategoryId,
          side: 'BID',
          status: 'OPEN',
          price: 9000,
          initialQuantity: 1,
          remainingQuantity: 1,
          createdAt: new Date(now + 30),
        },
      });

      // Reconstruct
      const result = await service.initializeAndSynchronizeMarket(MARKET_CONFIG);
      expect(result.activeOrdersCount).toBe(4);
      expect(result.totalRemainingQuantity).toBe(11);
      expect(result.marketState).toBe(MarketState.READY);

      const book = service.getMarketBook(MARKET_KEY);
      expect(book.getBestAsk()).toBe(10000);
      expect(book.getBestBid()).toBe(9000);

      // Submit an incoming BID for 3 units at 10000 ticks.
      // Must execute 2 units against ask-10000-first (emptying it) and 1 unit against ask-10000-second!
      const takerSubmission = await service.submitLimitOrder({
        ...MARKET_CONFIG,
        userId: 'taker-buyer',
        side: 'BID',
        price: 10000,
        quantity: 3,
        idempotencyKey: 'taker-fifo-test-1',
      });

      expect(takerSubmission.matchedQuantity).toBe(3);
      expect(takerSubmission.executions.length).toBe(2);
      expect(takerSubmission.executions[0].restingOrderId).toBe('ask-10000-first');
      expect(takerSubmission.executions[0].quantity).toBe(2);
      expect(takerSubmission.executions[1].restingOrderId).toBe('ask-10000-second');
      expect(takerSubmission.executions[1].quantity).toBe(1);

      // Remaining on ask-10000-second should be 2
      const updatedSecond = await repository.findById('ask-10000-second');
      expect(updatedSecond.remainingQuantity).toBe(2);
    });
  });

  describe('3. Partially Filled Resting Orders', () => {
    it('reconstructs partially filled orders with their exact remaining quantity, not initial quantity', async () => {
      await mockPrisma.order.create({
        data: {
          id: 'partial-order-1',
          userId: 'seller-partial',
          eventId: MARKET_CONFIG.eventId,
          ticketCategoryId: MARKET_CONFIG.ticketCategoryId,
          side: 'ASK',
          status: 'PARTIALLY_FILLED',
          price: 10500,
          initialQuantity: 10,
          remainingQuantity: 3, // only 3 units remaining
          createdAt: new Date(),
        },
      });

      const result = await service.initializeAndSynchronizeMarket(MARKET_CONFIG);
      expect(result.activeOrdersCount).toBe(1);
      expect(result.totalRemainingQuantity).toBe(3);

      const book = service.getMarketBook(MARKET_KEY);
      expect(book.getOrder('partial-order-1').order.remainingQuantity).toBe(3);
    });
  });

  describe('4. Terminal Status Orders Excluded from Active Book', () => {
    it('excludes FILLED, CANCELLED, and REJECTED orders from the reconstructed book', async () => {
      const now = new Date();

      // Active order
      await mockPrisma.order.create({
        data: {
          id: 'active-order',
          userId: 'user-active',
          eventId: MARKET_CONFIG.eventId,
          ticketCategoryId: MARKET_CONFIG.ticketCategoryId,
          side: 'BID',
          status: 'OPEN',
          price: 8000,
          initialQuantity: 4,
          remainingQuantity: 4,
          createdAt: now,
        },
      });

      // Terminal orders
      await mockPrisma.order.create({
        data: {
          id: 'filled-order',
          userId: 'user-filled',
          eventId: MARKET_CONFIG.eventId,
          ticketCategoryId: MARKET_CONFIG.ticketCategoryId,
          side: 'BID',
          status: 'FILLED',
          price: 8500,
          initialQuantity: 5,
          remainingQuantity: 0,
          createdAt: now,
        },
      });

      await mockPrisma.order.create({
        data: {
          id: 'cancelled-order',
          userId: 'user-cancelled',
          eventId: MARKET_CONFIG.eventId,
          ticketCategoryId: MARKET_CONFIG.ticketCategoryId,
          side: 'BID',
          status: 'CANCELLED',
          price: 8200,
          initialQuantity: 2,
          remainingQuantity: 0,
          stoppedReason: 'SELF_TRADE_PREVENTION',
          createdAt: now,
        },
      });

      await mockPrisma.order.create({
        data: {
          id: 'rejected-order',
          userId: 'user-rejected',
          eventId: MARKET_CONFIG.eventId,
          ticketCategoryId: MARKET_CONFIG.ticketCategoryId,
          side: 'ASK',
          status: 'REJECTED',
          price: 12000,
          initialQuantity: 1,
          remainingQuantity: 0,
          createdAt: now,
        },
      });

      const result = await service.initializeAndSynchronizeMarket(MARKET_CONFIG);
      expect(result.activeOrdersCount).toBe(1);
      expect(result.totalRemainingQuantity).toBe(4);

      const book = service.getMarketBook(MARKET_KEY);
      expect(book.size()).toBe(1);
      expect(book.getOrder('active-order')).toBeDefined();
      expect(book.getOrder('filled-order')).toBeNull();
      expect(book.getOrder('cancelled-order')).toBeNull();
      expect(book.getOrder('rejected-order')).toBeNull();
    });
  });

  describe('5. Invalid Persisted Active Order Quarantine', () => {
    it('quarantines the market into RECONCILING and throws MarketReconstructionError on corrupted order data', async () => {
      // Seed an order with corrupted negative remainingQuantity
      await mockPrisma.order.create({
        data: {
          id: 'corrupted-order-1',
          userId: 'user-bad',
          eventId: MARKET_CONFIG.eventId,
          ticketCategoryId: MARKET_CONFIG.ticketCategoryId,
          side: 'ASK',
          status: 'OPEN',
          price: 10000,
          initialQuantity: 5,
          remainingQuantity: -1, // CORRUPTED
          createdAt: new Date(),
        },
      });

      await expect(service.initializeAndSynchronizeMarket(MARKET_CONFIG)).rejects.toThrow(
        MarketReconstructionError
      );

      // Verify market is quarantined
      expect(stateManager.getState(MARKET_KEY)).toBe(MarketState.RECONCILING);
      expect(service.isMarketSynchronized(MARKET_KEY)).toBe(false);

      // Subsequent submissions must be rejected at the queue gate
      await expect(
        service.submitLimitOrder({
          ...MARKET_CONFIG,
          userId: 'new-user',
          side: 'BID',
          price: 10000,
          quantity: 1,
          idempotencyKey: 'post-quarantine-key',
        })
      ).rejects.toThrow(MarketNotReadyError);
    });
  });

  describe('6. Database Query Failure Leaves Market Unavailable', () => {
    it('keeps market in INITIALIZING / unavailable when database query fails during reconstruction', async () => {
      mockPrisma.failNextFindMany = new Error('PostgreSQL connection timeout (5000ms)');

      await expect(service.initializeAndSynchronizeMarket(MARKET_CONFIG)).rejects.toThrow(
        MarketReconstructionError
      );

      expect(service.isMarketSynchronized(MARKET_KEY)).toBe(false);
      expect(stateManager.getState(MARKET_KEY)).toBe(MarketState.INITIALIZING);
    });
  });

  describe('7. Repeatable and Idempotent Reconstruction', () => {
    it('produces identical book depth, order priority, and state across multiple reconstruction calls', async () => {
      const now = Date.now();
      await mockPrisma.order.create({
        data: {
          id: 'order-rep-1',
          userId: 'user-1',
          eventId: MARKET_CONFIG.eventId,
          ticketCategoryId: MARKET_CONFIG.ticketCategoryId,
          side: 'ASK',
          status: 'OPEN',
          price: 10000,
          initialQuantity: 5,
          remainingQuantity: 5,
          createdAt: new Date(now),
        },
      });
      await mockPrisma.order.create({
        data: {
          id: 'order-rep-2',
          userId: 'user-2',
          eventId: MARKET_CONFIG.eventId,
          ticketCategoryId: MARKET_CONFIG.ticketCategoryId,
          side: 'ASK',
          status: 'OPEN',
          price: 10000,
          initialQuantity: 3,
          remainingQuantity: 3,
          createdAt: new Date(now + 10),
        },
      });

      // First reconstruction
      const res1 = await service.initializeAndSynchronizeMarket(MARKET_CONFIG);
      const book1 = service.getMarketBook(MARKET_KEY);
      const depth1 = book1.getDepth();

      // Second reconstruction
      const res2 = await service.reconstructMarket(MARKET_CONFIG);
      const book2 = service.getMarketBook(MARKET_KEY);
      const depth2 = book2.getDepth();

      expect(res1.activeOrdersCount).toBe(res2.activeOrdersCount);
      expect(res1.totalRemainingQuantity).toBe(res2.totalRemainingQuantity);
      expect(depth1).toEqual(depth2);
      expect(book1.getOrder('order-rep-1').id).toBe(book2.getOrder('order-rep-1').id);
      expect(book1.getOrder('order-rep-2').id).toBe(book2.getOrder('order-rep-2').id);
    });
  });

  describe('8. Recovery After Ambiguous Commit (Order Committed)', () => {
    it('authoritatively confirms the committed order, returns original result, and recovers market to READY', async () => {
      // 1. Initialize market
      await service.initializeAndSynchronizeMarket(MARKET_CONFIG);

      // 2. Submit an order that commits, but simulate ambiguous network drop during commit response
      const orderData = {
        ...MARKET_CONFIG,
        userId: 'alice-ambiguous',
        side: 'BID',
        price: 9500,
        quantity: 2,
        idempotencyKey: 'ambig-key-committed',
      };

      // Manually commit order to database as if server committed right before network cut
      await mockPrisma.order.create({
        data: {
          id: 'order-ambig-committed',
          userId: orderData.userId,
          eventId: orderData.eventId,
          ticketCategoryId: orderData.ticketCategoryId,
          side: orderData.side,
          status: 'OPEN',
          price: orderData.price,
          initialQuantity: orderData.quantity,
          remainingQuantity: orderData.quantity,
          idempotencyKey: orderData.idempotencyKey,
          stoppedReason: 'NO_MORE_LIQUIDITY',
          createdAt: new Date(),
        },
      });

      // Market transitions to RECONCILING due to ambiguous outcome
      stateManager.transition(MARKET_KEY, MarketState.RECONCILING);

      // 3. Reconcile with ambiguous submission
      const reconResult = await service.reconcileMarket(MARKET_KEY, {
        ambiguousSubmission: {
          userId: orderData.userId,
          idempotencyKey: orderData.idempotencyKey,
        },
      });

      expect(reconResult.ambiguousOutcome).toBeDefined();
      expect(reconResult.ambiguousOutcome.committed).toBe(true);
      expect(reconResult.ambiguousOutcome.result.orderId).toBe('order-ambig-committed');
      expect(reconResult.marketState).toBe(MarketState.READY);

      // Book contains the committed resting order
      const book = service.getMarketBook(MARKET_KEY);
      expect(book.getOrder('order-ambig-committed')).toBeDefined();
    });
  });

  describe('9. Recovery After Authoritative Non-Commit', () => {
    it('authoritatively confirms order was absent, reconstructs book, and restores market to READY', async () => {
      await service.initializeAndSynchronizeMarket(MARKET_CONFIG);

      // Put market into RECONCILING
      stateManager.transition(MARKET_KEY, MarketState.RECONCILING);

      const reconResult = await service.reconcileMarket(MARKET_KEY, {
        ambiguousSubmission: {
          userId: 'user-not-committed',
          idempotencyKey: 'key-rolled-back-before-commit',
        },
      });

      expect(reconResult.ambiguousOutcome).toBeDefined();
      expect(reconResult.ambiguousOutcome.committed).toBe(false);
      expect(reconResult.ambiguousOutcome.result).toBeNull();
      expect(reconResult.marketState).toBe(MarketState.READY);
    });
  });

  describe('10. Recovery When PostgreSQL is Unavailable', () => {
    it('keeps market in RECONCILING and throws MarketReconciliationError when DB fails during reconciliation', async () => {
      await service.initializeAndSynchronizeMarket(MARKET_CONFIG);
      stateManager.transition(MARKET_KEY, MarketState.RECONCILING);

      mockPrisma.failNextFindUnique = new Error('Connection refused: 5432');

      await expect(
        service.reconcileMarket(MARKET_KEY, {
          ambiguousSubmission: { userId: 'u1', idempotencyKey: 'k1' },
        })
      ).rejects.toThrow(MarketReconciliationError);

      expect(stateManager.getState(MARKET_KEY)).toBe(MarketState.RECONCILING);
    });
  });

  describe('11. Post-Commit applyPlan() Failure Followed by Reconstruction', () => {
    it('recovers completely from post-commit mutation failure via reconcileMarket', async () => {
      await service.initializeAndSynchronizeMarket(MARKET_CONFIG);

      // Spy on applyPlan to simulate post-commit failure
      const originalApplyPlan = coordinator.applyPlan.bind(coordinator);
      jest.spyOn(coordinator, 'applyPlan').mockImplementationOnce(() => {
        throw new Error('Simulated in-memory mutation crash after DB commit');
      });

      await expect(
        service.submitLimitOrder({
          ...MARKET_CONFIG,
          userId: 'crashed-user',
          side: 'ASK',
          price: 15000,
          quantity: 2,
          idempotencyKey: 'crash-key-1',
        })
      ).rejects.toThrow(PostCommitMutationError);

      // Market is now quarantined
      expect(stateManager.getState(MARKET_KEY)).toBe(MarketState.RECONCILING);
      expect(service.isMarketSynchronized(MARKET_KEY)).toBe(false);

      // Restore coordinator method
      coordinator.applyPlan = originalApplyPlan;

      // Reconcile market
      const reconResult = await service.reconcileMarket(MARKET_KEY);
      expect(reconResult.marketState).toBe(MarketState.READY);
      expect(service.isMarketSynchronized(MARKET_KEY)).toBe(true);

      // The committed order rests in the reconstructed book!
      const book = service.getMarketBook(MARKET_KEY);
      expect(book.getBestAsk()).toBe(15000);

      // New orders can now match against it
      const matchSub = await service.submitLimitOrder({
        ...MARKET_CONFIG,
        userId: 'buyer-after-recon',
        side: 'BID',
        price: 15000,
        quantity: 2,
        idempotencyKey: 'buyer-after-recon-key',
      });

      expect(matchSub.matchedQuantity).toBe(2);
      expect(matchSub.status).toBe('FILLED');
    });
  });

  describe('12. Administratively Paused Market Recovery Behavior', () => {
    it('reconstructs book but preserves PAUSED state when market was administratively paused', async () => {
      await service.initializeAndSynchronizeMarket(MARKET_CONFIG);

      // Admin pauses market
      stateManager.transition(MARKET_KEY, MarketState.PAUSED);

      // Reconstruct
      const result = await service.reconstructMarket(MARKET_CONFIG);
      expect(result.marketState).toBe(MarketState.PAUSED);
      expect(stateManager.getState(MARKET_KEY)).toBe(MarketState.PAUSED);
      expect(service.isMarketSynchronized(MARKET_KEY)).toBe(true);

      // Queue continues to reject mutations
      await expect(
        service.submitLimitOrder({
          ...MARKET_CONFIG,
          userId: 'user-p',
          side: 'BID',
          price: 10000,
          quantity: 1,
          idempotencyKey: 'paused-sub-key',
        })
      ).rejects.toThrow(MarketNotReadyError);
    });
  });

  describe('13. Submissions Cannot Interleave with Reconstruction', () => {
    it('serializes reconstruction ahead of subsequent order submissions without race conditions', async () => {
      // Market is initialized to READY
      await service.initializeAndSynchronizeMarket(MARKET_CONFIG);

      // Launch reconstruction
      const reconPromise = service.reconstructMarket(MARKET_CONFIG);

      // Launch order submission concurrently
      const orderPromise = service.submitLimitOrder({
        ...MARKET_CONFIG,
        userId: 'alice-queued',
        side: 'BID',
        price: 5000,
        quantity: 1,
        idempotencyKey: 'queued-order-key',
      });

      const [reconResult, orderResult] = await Promise.all([reconPromise, orderPromise]);

      expect(reconResult.marketState).toBe(MarketState.READY);
      expect(orderResult.status).toBe('OPEN');
      expect(orderResult.restedQuantity).toBe(1);
    });
  });

  describe('14. Concurrent Pause Prevents Re-Enabling Market', () => {
    it('prevents reconciliation from transitioning market to READY if market is paused', async () => {
      await service.initializeAndSynchronizeMarket(MARKET_CONFIG);
      stateManager.transition(MARKET_KEY, MarketState.PAUSED);

      const result = await service.reconcileMarket(MARKET_KEY);
      expect(result.marketState).toBe(MarketState.PAUSED);
      expect(stateManager.getState(MARKET_KEY)).toBe(MarketState.PAUSED);
    });
  });

  describe('15. Idempotency Retries Return Original Outcome After Recovery', () => {
    it('returns exact original execution details for retried order after crash and reconstruction', async () => {
      await service.initializeAndSynchronizeMarket(MARKET_CONFIG);

      const sub1 = await service.submitLimitOrder({
        ...MARKET_CONFIG,
        userId: 'user-idem-rec',
        side: 'ASK',
        price: 12000,
        quantity: 4,
        idempotencyKey: 'idem-rec-key-1',
      });
      expect(sub1.isDuplicate).toBe(false);

      // Simulate restart: reconstruct fresh service instance
      const restartedService = new PersistentMatchingService({
        repository,
        queue: new MarketExecutionQueue({ stateManager: new MarketStateManager() }),
        coordinator: new MatchingCoordinator(),
      });

      await restartedService.initializeAndSynchronizeMarket(MARKET_CONFIG);

      // Retry submission with exact same parameters
      const retryResult = await restartedService.submitLimitOrder({
        ...MARKET_CONFIG,
        userId: 'user-idem-rec',
        side: 'ASK',
        price: 12000,
        quantity: 4,
        idempotencyKey: 'idem-rec-key-1',
      });

      expect(retryResult.isDuplicate).toBe(true);
      expect(retryResult.orderId).toBe(sub1.orderId);
      expect(retryResult.price).toBe(12000);
      expect(retryResult.remainingQuantity).toBe(4);
    });
  });

  describe('16. Cross-Market Isolation', () => {
    it('reconstructing Market A does not alter or block Market B state or book', async () => {
      const MARKET_B = {
        eventId: 'event-coldplay-2026',
        ticketCategoryId: 'cat-general-admission',
      };
      const KEY_B = formatMarketKey(MARKET_B);

      // Initialize both markets
      await service.initializeAndSynchronizeMarket(MARKET_CONFIG);
      await service.initializeAndSynchronizeMarket(MARKET_B);

      // Submit order to Market B
      await service.submitLimitOrder({
        ...MARKET_B,
        userId: 'user-market-b',
        side: 'BID',
        price: 7500,
        quantity: 2,
        idempotencyKey: 'key-market-b',
      });

      // Quarantine and reconstruct Market A
      stateManager.transition(MARKET_KEY, MarketState.RECONCILING);
      await service.reconcileMarket(MARKET_KEY);

      // Market B book and state remain completely untouched
      const bookB = service.getMarketBook(KEY_B);
      expect(bookB.size()).toBe(1);
      expect(bookB.getBestBid()).toBe(7500);
      expect(stateManager.getState(KEY_B)).toBe(MarketState.READY);
    });
  });

  describe('17. Live PostgreSQL Database Integration (Neon)', () => {
    it('performs live startup reconstruction, matching, and reconciliation on real Neon database', async () => {
      if (!process.env.DATABASE_URL) {
        console.warn('DATABASE_URL not set; skipping live Neon integration test');
        return;
      }

      // Check live database connection
      try {
        await livePrisma.$queryRaw`SELECT 1`;
      } catch (err) {
        console.warn('Live Neon database unreachable; skipping live test:', err.message);
        return;
      }

      const suffix = Math.random().toString(36).substring(2, 8);
      const testUser = await livePrisma.user.create({
        data: {
          email: `live-recon-${suffix}@test.passflow.com`,
          passwordHash: 'argon2-dummy-hash',
          name: 'Live Recon Tester',
        },
      });

      const testEvent = await livePrisma.event.create({
        data: {
          name: `Live Recon Event ${suffix}`,
          dateTime: new Date(Date.now() + 86400000 * 30),
          location: 'Wembley Stadium, London',
          organizer: {
            create: {
              organizationName: `Live Recon Org ${suffix}`,
              user: {
                create: {
                  email: `live-recon-org-${suffix}@test.passflow.com`,
                  passwordHash: 'org-hash',
                },
              },
            },
          },
        },
      });

      const testCategory = await livePrisma.ticketCategory.create({
        data: {
          eventId: testEvent.id,
          name: 'VIP Standing Recon',
          originalPrice: 150.0,
          totalQuantity: 100,
          availableQuantity: 100,
        },
      });

      const liveConfig = {
        eventId: testEvent.id,
        ticketCategoryId: testCategory.id,
      };
      const liveKey = formatMarketKey(liveConfig);

      const liveRepo = new OrderRepository({ prismaClient: livePrisma });
      const liveQueue = new MarketExecutionQueue();
      const liveService = new PersistentMatchingService({
        repository: liveRepo,
        queue: liveQueue,
      });

      try {
        // 1. Initial reconstruction on fresh market (0 active orders)
        const initResult = await liveService.initializeAndSynchronizeMarket(liveConfig);
        expect(initResult.activeOrdersCount).toBe(0);
        expect(initResult.marketState).toBe(MarketState.READY);

        // 2. Submit a resting ASK
        const askSub = await liveService.submitLimitOrder({
          ...liveConfig,
          userId: testUser.id,
          side: 'ASK',
          price: 15000,
          quantity: 3,
          idempotencyKey: `live-ask-${suffix}`,
        });
        expect(askSub.status).toBe('OPEN');
        expect(askSub.restedQuantity).toBe(3);

        // 3. Simulate process crash / restart: construct completely fresh PersistentMatchingService
        const restartedService = new PersistentMatchingService({
          repository: liveRepo,
          queue: new MarketExecutionQueue(),
        });

        // Reconstruct from PostgreSQL
        const reconResult = await restartedService.initializeAndSynchronizeMarket(liveConfig);
        expect(reconResult.activeOrdersCount).toBe(1);
        expect(reconResult.totalRemainingQuantity).toBe(3);
        expect(reconResult.marketState).toBe(MarketState.READY);

        const reconstructedBook = restartedService.getMarketBook(liveKey);
        expect(reconstructedBook.getBestAsk()).toBe(15000);
        expect(reconstructedBook.getOrder(askSub.orderId).order.remainingQuantity).toBe(3);

        // 4. Submit matching BID against reconstructed book
        const takerUser = await livePrisma.user.create({
          data: {
            email: `live-taker-${suffix}@test.passflow.com`,
            passwordHash: 'dummy',
          },
        });

        const bidSub = await restartedService.submitLimitOrder({
          ...liveConfig,
          userId: takerUser.id,
          side: 'BID',
          price: 15000,
          quantity: 2,
          idempotencyKey: `live-bid-${suffix}`,
        });

        expect(bidSub.matchedQuantity).toBe(2);
        expect(bidSub.status).toBe('FILLED');

        // Check maker order in live DB: remaining quantity should now be 1
        const updatedMaker = await liveRepo.findById(askSub.orderId);
        expect(updatedMaker.remainingQuantity).toBe(1);
        expect(updatedMaker.status).toBe('PARTIALLY_FILLED');
      } finally {
        // Clean up database entities
        await livePrisma.execution.deleteMany({
          where: {
            incomingOrder: { eventId: testEvent.id },
          },
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
          where: { organizationName: `Live Recon Org ${suffix}` },
        });
        await livePrisma.user.deleteMany({
          where: {
            email: {
              in: [
                `live-recon-${suffix}@test.passflow.com`,
                `live-recon-org-${suffix}@test.passflow.com`,
                `live-taker-${suffix}@test.passflow.com`,
              ],
            },
          },
        });
      }
    }, 60000);
  });
});
