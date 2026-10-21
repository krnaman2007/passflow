import { jest } from '@jest/globals';
import {
  PersistentMatchingService,
  OrderValidationError,
  AmbiguousCommitError,
  PostCommitMutationError,
  MarketStateDivergenceError,
  MarketNotSynchronizedError,
  IdempotencyPayloadMismatchError,
} from '../../src/services/matching/persistent-matching-service.js';
import { OrderRepository } from '../../src/services/matching/order-repository.js';
import { OrderBook } from '../../src/services/matching/order-book.js';
import { MatchingCoordinator } from '../../src/services/matching/matching-coordinator.js';
import {
  MarketExecutionQueue,
  MarketState,
  MarketStateManager,
  MarketNotReadyError,
  formatMarketKey,
} from '../../src/services/matching/market-execution-queue.js';

/**
 * Creates a deterministic deferred promise for barrier-based concurrency testing.
 */
function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * In-memory Mock Prisma Client for deterministic transaction testing and failure injection.
 */
class MockPrismaClient {
  constructor() {
    this.orders = new Map(); // id -> record
    this.executions = new Map(); // id -> record
    this.sequenceCounter = 1n;
    this.orderSequenceCounter = 1n;
    this.failNextTransaction = null; // Error to throw if set
    this.transactionDelayPromise = null;
  }

  get order() {
    return {
      findUnique: async ({ where }) => {
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
        let results = Array.from(this.orders.values());
        if (where) {
          if (where.eventId) results = results.filter((o) => o.eventId === where.eventId);
          if (where.ticketCategoryId) results = results.filter((o) => o.ticketCategoryId === where.ticketCategoryId);
          if (where.status?.in) results = results.filter((o) => where.status.in.includes(o.status));
        }
        if (orderBy && Array.isArray(orderBy)) {
          results.sort((a, b) => {
            for (const clause of orderBy) {
              const key = Object.keys(clause)[0];
              const dir = clause[key] === 'desc' ? -1 : 1;
              let va = a[key];
              let vb = b[key];
              if (typeof va === 'bigint' || typeof vb === 'bigint') {
                va = BigInt(va || 0);
                vb = BigInt(vb || 0);
                if (va < vb) return -1 * dir;
                if (va > vb) return 1 * dir;
              } else {
                if (va < vb) return -1 * dir;
                if (va > vb) return 1 * dir;
              }
            }
            return 0;
          });
        }
        return results;
      },
      create: async ({ data }) => {
        // Enforce unique (userId, idempotencyKey)
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
          sequenceNumber: data.sequenceNumber !== undefined ? BigInt(data.sequenceNumber) : this.orderSequenceCounter++,
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
          return { count: 0 }; // Optimistic concurrency check failed
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
    if (this.transactionDelayPromise) {
      await this.transactionDelayPromise;
    }
    if (this.failNextTransaction) {
      const err = this.failNextTransaction;
      this.failNextTransaction = null;
      throw err;
    }

    // Snapshot state for atomic rollback simulation
    const snapshotOrders = new Map(Array.from(this.orders.entries()).map(([k, v]) => [k, { ...v }]));
    const snapshotExecutions = new Map(Array.from(this.executions.entries()).map(([k, v]) => [k, { ...v }]));
    const snapshotSeq = this.sequenceCounter;

    try {
      const result = await fn(this);
      return result;
    } catch (err) {
      // Revert snapshot on failure
      this.orders = snapshotOrders;
      this.executions = snapshotExecutions;
      this.sequenceCounter = snapshotSeq;
      throw err;
    }
  }
}

describe('PersistentMatchingService and Atomic Transaction Bridge (Step 8.3)', () => {
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
  let book;

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

    book = new OrderBook(MARKET_CONFIG);
    service.registerMarketBook(MARKET_CONFIG, book);
    stateManager.transition(MARKET_KEY, MarketState.READY);
  });

  afterEach(() => {
    queue.reset();
  });

  describe('1. Input Validation', () => {
    it('rejects invalid inputs before queuing or touching the database', async () => {
      // Missing idempotency key
      await expect(
        service.submitLimitOrder({
          eventId: 'event-1',
          ticketCategoryId: 'cat-1',
          userId: 'user-1',
          side: 'BID',
          price: 1000,
          quantity: 2,
        })
      ).rejects.toThrow(OrderValidationError);

      // Non-positive price
      await expect(
        service.submitLimitOrder({
          eventId: 'event-1',
          ticketCategoryId: 'cat-1',
          userId: 'user-1',
          side: 'BID',
          price: 0,
          quantity: 2,
          idempotencyKey: 'idemp-1',
        })
      ).rejects.toThrow(OrderValidationError);

      // Non-positive quantity
      await expect(
        service.submitLimitOrder({
          eventId: 'event-1',
          ticketCategoryId: 'cat-1',
          userId: 'user-1',
          side: 'BID',
          price: 1000,
          quantity: -5,
          idempotencyKey: 'idemp-1',
        })
      ).rejects.toThrow(OrderValidationError);

      // Non-integer price
      await expect(
        service.submitLimitOrder({
          eventId: 'event-1',
          ticketCategoryId: 'cat-1',
          userId: 'user-1',
          side: 'BID',
          price: 10.5,
          quantity: 2,
          idempotencyKey: 'idemp-1',
        })
      ).rejects.toThrow(OrderValidationError);

      // Invalid side
      await expect(
        service.submitLimitOrder({
          eventId: 'event-1',
          ticketCategoryId: 'cat-1',
          userId: 'user-1',
          side: 'BUY',
          price: 1000,
          quantity: 2,
          idempotencyKey: 'idemp-1',
        })
      ).rejects.toThrow(OrderValidationError);

      // Database and book remain completely untouched
      expect(mockPrisma.orders.size).toBe(0);
      expect(book.isEmpty()).toBe(true);
    });
  });

  describe('2. Successful Submission with No Fills (Resting in Book)', () => {
    it('persists incoming limit order as OPEN and rests in book when opposing side is empty', async () => {
      const orderInput = {
        ...MARKET_CONFIG,
        userId: 'user-alice',
        side: 'BID',
        price: 15000,
        quantity: 3,
        idempotencyKey: 'alice-bid-1',
      };

      const result = await service.submitLimitOrder(orderInput);

      expect(result.status).toBe('OPEN');
      expect(result.matchedQuantity).toBe(0);
      expect(result.restedQuantity).toBe(3);
      expect(result.remainingQuantity).toBe(3);
      expect(result.executions).toHaveLength(0);
      expect(result.isDuplicate).toBe(false);

      // Check database state
      expect(mockPrisma.orders.size).toBe(1);
      const dbOrder = mockPrisma.orders.get(result.orderId);
      expect(dbOrder.status).toBe('OPEN');
      expect(dbOrder.remainingQuantity).toBe(3);
      expect(dbOrder.price).toBe(15000);

      // Check in-memory book state
      expect(book.size()).toBe(1);
      expect(book.getBestBid()).toBe(15000);
      expect(book.getOrder(result.orderId).order.remainingQuantity).toBe(3);

      // BigInt sequenceNumber serialization safety check
      expect(() => JSON.stringify(result)).not.toThrow();
    });

    it('rejects submission when registered market book is empty but PostgreSQL has active resting orders', async () => {
      // Seed resting order in mock DB for this market
      await mockPrisma.order.create({
        data: {
          id: 'pre-existing-db-ask',
          eventId: MARKET_CONFIG.eventId,
          ticketCategoryId: MARKET_CONFIG.ticketCategoryId,
          userId: 'seller-pre-existing',
          side: 'ASK',
          price: 10000,
          initialQuantity: 5,
          remainingQuantity: 5,
          status: 'OPEN',
          idempotencyKey: 'pre-existing-key',
        },
      });

      const freshState = new MarketStateManager();
      const freshQueue = new MarketExecutionQueue({ stateManager: freshState });
      const freshService = new PersistentMatchingService({
        repository,
        queue: freshQueue,
        stateManager: freshState,
      });
      const emptyBook = new OrderBook(MARKET_CONFIG);
      freshService.registerMarketBook(MARKET_CONFIG, emptyBook);
      freshState.transition(MARKET_KEY, MarketState.READY);

      // Attempting to submit must reject with MarketNotSynchronizedError!
      await expect(
        freshService.submitLimitOrder({
          ...MARKET_CONFIG,
          userId: 'buyer-fresh',
          side: 'BID',
          price: 10000,
          quantity: 2,
          idempotencyKey: 'buyer-fresh-key',
        })
      ).rejects.toThrow(MarketNotSynchronizedError);

      expect(emptyBook.isEmpty()).toBe(true);
    });
  });

  describe('3. Full Fill and Multiple Executions', () => {
    it('matches incoming BID against multiple resting ASKs, updates database records, and applies fills post-commit', async () => {
      // Pre-seed resting ASKs in database and book
      const ask1Input = {
        ...MARKET_CONFIG,
        userId: 'user-bob',
        side: 'ASK',
        price: 10000,
        quantity: 2,
        idempotencyKey: 'bob-ask-1',
      };
      const ask2Input = {
        ...MARKET_CONFIG,
        userId: 'user-charlie',
        side: 'ASK',
        price: 11000,
        quantity: 3,
        idempotencyKey: 'charlie-ask-1',
      };

      const rAsk1 = await service.submitLimitOrder(ask1Input);
      const rAsk2 = await service.submitLimitOrder(ask2Input);
      expect(book.size()).toBe(2);

      // Incoming aggressive BID for 5 units at 12000 (consumes both asks completely)
      const bidInput = {
        ...MARKET_CONFIG,
        userId: 'user-david',
        side: 'BID',
        price: 12000,
        quantity: 5,
        idempotencyKey: 'david-bid-1',
      };

      const result = await service.submitLimitOrder(bidInput);

      expect(result.status).toBe('FILLED');
      expect(result.matchedQuantity).toBe(5);
      expect(result.remainingQuantity).toBe(0);
      expect(result.restedQuantity).toBe(0);
      expect(result.executions).toHaveLength(2);

      // Verify passive resting order prices were used
      expect(result.executions[0].restingOrderId).toBe(rAsk1.orderId);
      expect(result.executions[0].price).toBe(10000);
      expect(result.executions[0].quantity).toBe(2);
      expect(typeof result.executions[0].sequenceNumber).toBe('string');

      expect(result.executions[1].restingOrderId).toBe(rAsk2.orderId);
      expect(result.executions[1].price).toBe(11000);
      expect(result.executions[1].quantity).toBe(3);
      expect(typeof result.executions[1].sequenceNumber).toBe('string');

      // Verify database state
      const dbAsk1 = mockPrisma.orders.get(rAsk1.orderId);
      const dbAsk2 = mockPrisma.orders.get(rAsk2.orderId);
      const dbBid = mockPrisma.orders.get(result.orderId);

      expect(dbAsk1.status).toBe('FILLED');
      expect(dbAsk1.remainingQuantity).toBe(0);
      expect(dbAsk2.status).toBe('FILLED');
      expect(dbAsk2.remainingQuantity).toBe(0);
      expect(dbBid.status).toBe('FILLED');
      expect(dbBid.remainingQuantity).toBe(0);

      // Verify in-memory book state: both asks consumed, bid does not rest
      expect(book.size()).toBe(0);
      expect(book.isEmpty()).toBe(true);

      expect(() => JSON.stringify(result)).not.toThrow();
    });
  });

  describe('4. Partial Fill and Resting Remainder', () => {
    it('partially fills against a smaller resting order and rests the remainder in the book', async () => {
      // Resting ASK of 2 units at 10000
      await service.submitLimitOrder({
        ...MARKET_CONFIG,
        userId: 'user-seller',
        side: 'ASK',
        price: 10000,
        quantity: 2,
        idempotencyKey: 'seller-ask-1',
      });

      // Incoming BID for 5 units at 10000
      const bidResult = await service.submitLimitOrder({
        ...MARKET_CONFIG,
        userId: 'user-buyer',
        side: 'BID',
        price: 10000,
        quantity: 5,
        idempotencyKey: 'buyer-bid-1',
      });

      expect(bidResult.status).toBe('PARTIALLY_FILLED');
      expect(bidResult.matchedQuantity).toBe(2);
      expect(bidResult.remainingQuantity).toBe(3);
      expect(bidResult.restedQuantity).toBe(3);
      expect(bidResult.executions).toHaveLength(1);

      // Database verification
      const dbBid = mockPrisma.orders.get(bidResult.orderId);
      expect(dbBid.status).toBe('PARTIALLY_FILLED');
      expect(dbBid.remainingQuantity).toBe(3);

      // Book verification: resting remainder of 3 units on BID side
      expect(book.size()).toBe(1);
      expect(book.getBestBid()).toBe(10000);
      expect(book.getOrder(bidResult.orderId).order.remainingQuantity).toBe(3);
    });
  });

  describe('5. Self-Trade Prevention (STP)', () => {
    it('halts matching on self-trade, cancels remainder, and records stoppedReason in database', async () => {
      // User Alice places resting ASK of 5 units at 10000
      await service.submitLimitOrder({
        ...MARKET_CONFIG,
        userId: 'user-alice',
        side: 'ASK',
        price: 10000,
        quantity: 5,
        idempotencyKey: 'alice-ask-stp',
      });

      // User Alice places incoming BID for 5 units at 10000
      const stpResult = await service.submitLimitOrder({
        ...MARKET_CONFIG,
        userId: 'user-alice',
        side: 'BID',
        price: 10000,
        quantity: 5,
        idempotencyKey: 'alice-bid-stp',
      });

      expect(stpResult.status).toBe('CANCELLED');
      expect(stpResult.stoppedReason).toBe('SELF_TRADE_PREVENTION');
      expect(stpResult.matchedQuantity).toBe(0);
      expect(stpResult.restedQuantity).toBe(0);
      expect(stpResult.executions).toHaveLength(0);

      // Database verification
      const dbBid = mockPrisma.orders.get(stpResult.orderId);
      expect(dbBid.status).toBe('CANCELLED');
      expect(dbBid.stoppedReason).toBe('SELF_TRADE_PREVENTION');

      // Live book should still contain the resting ASK of 5 units untouched
      expect(book.size()).toBe(1);
      expect(book.getBestAsk()).toBe(10000);
    });
  });

  describe('6. Idempotent Retry and Outcome Recovery', () => {
    it('returns exact original execution outcome on retry without executing again', async () => {
      // Pre-seed resting ASK
      await service.submitLimitOrder({
        ...MARKET_CONFIG,
        userId: 'seller-1',
        side: 'ASK',
        price: 10000,
        quantity: 2,
        idempotencyKey: 'seller-ask-idem',
      });

      const orderInput = {
        ...MARKET_CONFIG,
        userId: 'buyer-1',
        side: 'BID',
        price: 10000,
        quantity: 2,
        idempotencyKey: 'buyer-idemp-key',
      };

      // First submission: generates match
      const firstResult = await service.submitLimitOrder(orderInput);
      expect(firstResult.status).toBe('FILLED');
      expect(firstResult.matchedQuantity).toBe(2);
      expect(firstResult.executions).toHaveLength(1);
      expect(firstResult.isDuplicate).toBe(false);

      const dbOrderCountBeforeRetry = mockPrisma.orders.size;
      const dbExecCountBeforeRetry = mockPrisma.executions.size;

      // Second submission: exact same (userId, idempotencyKey)
      const retryResult = await service.submitLimitOrder(orderInput);

      expect(retryResult.isDuplicate).toBe(true);
      expect(retryResult.orderId).toBe(firstResult.orderId);
      expect(retryResult.status).toBe(firstResult.status);
      expect(retryResult.matchedQuantity).toBe(firstResult.matchedQuantity);
      expect(retryResult.remainingQuantity).toBe(firstResult.remainingQuantity);
      expect(retryResult.executions).toHaveLength(1);
      expect(retryResult.executions[0].restingOrderId).toBe(firstResult.executions[0].restingOrderId);
      expect(retryResult.executions[0].price).toBe(firstResult.executions[0].price);

      // Zero new database records created
      expect(mockPrisma.orders.size).toBe(dbOrderCountBeforeRetry);
      expect(mockPrisma.executions.size).toBe(dbExecCountBeforeRetry);
    });

    it('handles concurrent duplicate submissions safely without double-execution', async () => {
      const orderInput = {
        ...MARKET_CONFIG,
        userId: 'concurrent-user',
        side: 'BID',
        price: 9000,
        quantity: 1,
        idempotencyKey: 'concurrent-key-1',
      };

      // Fire two submissions simultaneously
      const [res1, res2] = await Promise.all([
        service.submitLimitOrder(orderInput),
        service.submitLimitOrder(orderInput),
      ]);

      // One must be primary and one must be duplicate, or both return the same order ID
      expect(res1.orderId).toBe(res2.orderId);
      const duplicates = [res1.isDuplicate, res2.isDuplicate];
      expect(duplicates).toContain(true);
      expect(duplicates).toContain(false);
      expect(mockPrisma.orders.size).toBe(1);
      expect(book.size()).toBe(1);
    });

    it('rejects duplicate idempotency key when submitted with mismatched parameters', async () => {
      const originalInput = {
        ...MARKET_CONFIG,
        userId: 'alice-mismatch',
        side: 'BID',
        price: 10000,
        quantity: 2,
        idempotencyKey: 'mismatch-key-1',
      };

      await service.submitLimitOrder(originalInput);

      // Same user, same key, but different price (12000 vs 10000)
      await expect(
        service.submitLimitOrder({
          ...originalInput,
          price: 12000,
        })
      ).rejects.toThrow(IdempotencyPayloadMismatchError);

      // Same user, same key, but different quantity (5 vs 2)
      await expect(
        service.submitLimitOrder({
          ...originalInput,
          quantity: 5,
        })
      ).rejects.toThrow(IdempotencyPayloadMismatchError);

      // Same user, same key, but different side ('ASK' vs 'BID')
      await expect(
        service.submitLimitOrder({
          ...originalInput,
          side: 'ASK',
        })
      ).rejects.toThrow(IdempotencyPayloadMismatchError);

      // Register and set secondary market to READY so queue gating admits the cross-market collision attempt
      const diffConfig = { eventId: 'different-event-id', ticketCategoryId: originalInput.ticketCategoryId };
      service.registerMarketBook(diffConfig, new OrderBook(diffConfig), { synchronized: true });
      stateManager.transition(formatMarketKey(diffConfig), MarketState.READY);

      // Same user, same key, but different event
      await expect(
        service.submitLimitOrder({
          ...originalInput,
          eventId: 'different-event-id',
        })
      ).rejects.toThrow(IdempotencyPayloadMismatchError);
    });

    it('rethrows P2002 error if the constraint violation is unrelated to userId_idempotencyKey', async () => {
      // Simulate an unrelated P2002 error (e.g. primary key collision on Order.id)
      const unrelatedP2002 = new Error('Unique constraint failed on the fields: (`id`)');
      unrelatedP2002.code = 'P2002';
      unrelatedP2002.meta = { target: ['id'] };
      mockPrisma.failNextTransaction = unrelatedP2002;

      await expect(
        service.submitLimitOrder({
          ...MARKET_CONFIG,
          userId: 'user-unrelated-p2002',
          side: 'BID',
          price: 10000,
          quantity: 1,
          idempotencyKey: 'unrelated-key-1',
        })
      ).rejects.toThrow('Unique constraint failed on the fields: (`id`)');
    });
  });

  describe('7. Transaction Rollback & Immutability Guarantees', () => {
    it('leaves in-memory book completely untouched if database transaction fails before commit', async () => {
      // Simulate database failure (e.g. database disk full or constraint failure)
      mockPrisma.failNextTransaction = new Error('PostgreSQL connection dropped before commit');

      const orderInput = {
        ...MARKET_CONFIG,
        userId: 'user-fail',
        side: 'BID',
        price: 15000,
        quantity: 5,
        idempotencyKey: 'fail-bid-1',
      };

      await expect(service.submitLimitOrder(orderInput)).rejects.toThrow(
        'PostgreSQL connection dropped before commit'
      );

      // Live book must remain 100% empty
      expect(book.isEmpty()).toBe(true);
      expect(book.size()).toBe(0);
      expect(mockPrisma.orders.size).toBe(0);
    });

    it('post-commit book mutation occurs only after transaction commits successfully', async () => {
      const barrier = createDeferred();
      mockPrisma.transactionDelayPromise = barrier.promise;

      let bookSizeDuringTx = -1;

      const pSubmit = service.submitLimitOrder({
        ...MARKET_CONFIG,
        userId: 'user-delayed',
        side: 'BID',
        price: 15000,
        quantity: 2,
        idempotencyKey: 'delayed-bid-1',
      });

      // Allow event loop to enter the transaction
      await Promise.resolve();
      await Promise.resolve();

      // Check book while transaction is delayed/in-flight
      bookSizeDuringTx = book.size();
      expect(bookSizeDuringTx).toBe(0);

      // Release database transaction
      mockPrisma.transactionDelayPromise = null;
      barrier.resolve();

      const result = await pSubmit;
      expect(result.status).toBe('OPEN');

      // Now book is mutated post-commit
      expect(book.size()).toBe(1);
    });

    it('quarantines market into RECONCILING, marks book corrupted, and preserves committed DB order if applyPlan throws post-commit', async () => {
      // Spy on coordinator.applyPlan to simulate post-commit failure
      const applyPlanSpy = jest.spyOn(coordinator, 'applyPlan').mockImplementation(() => {
        throw new Error('Simulated memory corruption / heap error in applyPlan');
      });

      const orderInput = {
        ...MARKET_CONFIG,
        userId: 'user-post-fail',
        side: 'BID',
        price: 15000,
        quantity: 2,
        idempotencyKey: 'post-commit-fail-key',
      };

      await expect(service.submitLimitOrder(orderInput)).rejects.toThrow(PostCommitMutationError);

      // 1. Transaction was NOT rolled back: order exists in DB
      expect(mockPrisma.orders.size).toBe(1);
      const committedOrder = Array.from(mockPrisma.orders.values())[0];
      expect(committedOrder.userId).toBe('user-post-fail');
      expect(committedOrder.status).toBe('OPEN');

      // 2. Market must be quarantined into RECONCILING
      expect(stateManager.getState(MARKET_KEY)).toBe(MarketState.RECONCILING);
      expect(service.isMarketSynchronized(MARKET_KEY)).toBe(false);

      // 3. Subsequent submissions must be rejected immediately
      await expect(
        service.submitLimitOrder({
          ...MARKET_CONFIG,
          userId: 'user-2',
          side: 'BID',
          price: 15000,
          quantity: 1,
          idempotencyKey: 'user-2-key',
        })
      ).rejects.toThrow(MarketNotReadyError);

      applyPlanSpy.mockRestore();
    });
  });

  describe('8. Ambiguous Commit Outcomes and Market Quarantine', () => {
    it('transitions market into RECONCILING and throws AmbiguousCommitError on connection reset during commit', async () => {
      const netErr = new Error('Connection terminated unexpectedly (ECONNRESET)');
      mockPrisma.failNextTransaction = netErr;

      const orderInput = {
        ...MARKET_CONFIG,
        userId: 'user-ambig',
        side: 'BID',
        price: 15000,
        quantity: 2,
        idempotencyKey: 'ambig-bid-1',
      };

      await expect(service.submitLimitOrder(orderInput)).rejects.toThrow(AmbiguousCommitError);

      // In-memory book must not be mutated
      expect(book.isEmpty()).toBe(true);

      // Market state must be quarantined in RECONCILING
      expect(stateManager.getState(MARKET_KEY)).toBe(MarketState.RECONCILING);
      expect(stateManager.isReady(MARKET_KEY)).toBe(false);

      // Subsequent orders on this market must be rejected immediately
      await expect(
        service.submitLimitOrder({
          ...MARKET_CONFIG,
          userId: 'user-after-recon',
          side: 'BID',
          price: 15000,
          quantity: 1,
          idempotencyKey: 'after-recon-1',
        })
      ).rejects.toThrow(MarketNotReadyError);
    });
  });

  describe('9. Resting Order Divergence Detection', () => {
    it('quarantines market into RECONCILING if resting order in database diverged from in-memory book', async () => {
      // Pre-seed resting ASK in book and DB
      await service.submitLimitOrder({
        ...MARKET_CONFIG,
        userId: 'seller-diverge',
        side: 'ASK',
        price: 10000,
        quantity: 5,
        idempotencyKey: 'seller-diverge-1',
      });

      // Corrupt database record externally (simulate out-of-band change or desync)
      for (const order of mockPrisma.orders.values()) {
        order.remainingQuantity = 2; // Diverges from in-memory book (which has 5)
      }

      // Incoming BID attempts to match against 5
      const incomingBid = {
        ...MARKET_CONFIG,
        userId: 'buyer-diverge',
        side: 'BID',
        price: 10000,
        quantity: 5,
        idempotencyKey: 'buyer-diverge-1',
      };

      await expect(service.submitLimitOrder(incomingBid)).rejects.toThrow(MarketStateDivergenceError);

      // In-memory book remains untouched
      expect(book.getOrder('order-diverge') === null);

      // Market must be quarantined into RECONCILING
      expect(stateManager.getState(MARKET_KEY)).toBe(MarketState.RECONCILING);
    });
  });

  describe('10. Multi-Market Concurrency & Pause Coordination', () => {
    it('different markets execute independently without blocking each other', async () => {
      const OTHER_MARKET = {
        eventId: 'event-coldplay-2026',
        ticketCategoryId: 'cat-standing',
      };
      const OTHER_KEY = formatMarketKey(OTHER_MARKET);

      const otherBook = new OrderBook(OTHER_MARKET);
      service.registerMarketBook(OTHER_MARKET, otherBook);
      stateManager.transition(OTHER_KEY, MarketState.READY);

      const [r1, r2] = await Promise.all([
        service.submitLimitOrder({
          ...MARKET_CONFIG,
          userId: 'user-m1',
          side: 'BID',
          price: 10000,
          quantity: 1,
          idempotencyKey: 'm1-order',
        }),
        service.submitLimitOrder({
          ...OTHER_MARKET,
          userId: 'user-m2',
          side: 'BID',
          price: 12000,
          quantity: 2,
          idempotencyKey: 'm2-order',
        }),
      ]);

      expect(r1.status).toBe('OPEN');
      expect(r2.status).toBe('OPEN');
      expect(book.size()).toBe(1);
      expect(otherBook.size()).toBe(1);
    });

    it('pause does not abort active committing transaction but blocks queued submissions', async () => {
      const barrier = createDeferred();
      mockPrisma.transactionDelayPromise = barrier.promise;

      // In-flight task
      const pActive = service.submitLimitOrder({
        ...MARKET_CONFIG,
        userId: 'user-active',
        side: 'BID',
        price: 10000,
        quantity: 1,
        idempotencyKey: 'active-tx-1',
      });

      // Let event loop enter transaction
      await Promise.resolve();

      // Pause market while pActive is committing
      queue.transitionMarket(MARKET_KEY, MarketState.PAUSED);

      // Attempt to submit second order while paused
      const pBlocked = service.submitLimitOrder({
        ...MARKET_CONFIG,
        userId: 'user-blocked',
        side: 'BID',
        price: 10000,
        quantity: 1,
        idempotencyKey: 'blocked-tx-1',
      });

      // Release committing transaction
      mockPrisma.transactionDelayPromise = null;
      barrier.resolve();

      // Active task completes successfully
      const rActive = await pActive;
      expect(rActive.status).toBe('OPEN');

      // Blocked task is rejected due to PAUSED state
      await expect(pBlocked).rejects.toThrow(MarketNotReadyError);
    });
  });

  describe('11. Matching Result Contract & Stop Reason Audit', () => {
    it('Case A: Resting order on empty book produces status OPEN and stoppedReason NO_MORE_LIQUIDITY consistently across retries', async () => {
      const input = {
        ...MARKET_CONFIG,
        userId: 'contract-user-a',
        side: 'BID',
        price: 10000,
        quantity: 5,
        idempotencyKey: 'contract-idem-a',
      };

      const res = await service.submitLimitOrder(input);
      expect(res.status).toBe('OPEN');
      expect(res.stoppedReason).toBe('NO_MORE_LIQUIDITY');
      expect(res.remainingQuantity).toBe(5);
      expect(res.restedQuantity).toBe(5);
      expect(res.matchedQuantity).toBe(0);

      const retry = await service.submitLimitOrder(input);
      expect(retry.status).toBe('OPEN');
      expect(retry.stoppedReason).toBe('NO_MORE_LIQUIDITY');
      expect(retry.remainingQuantity).toBe(5);
      expect(retry.restedQuantity).toBe(5);
      expect(retry.matchedQuantity).toBe(0);
      expect(retry.isDuplicate).toBe(true);
    });

    it('Case B: Resting order with no price overlap produces status OPEN and stoppedReason LIMIT_PRICE_REACHED consistently', async () => {
      // Seed resting ASK at 20000
      await service.submitLimitOrder({
        ...MARKET_CONFIG,
        userId: 'seller-high',
        side: 'ASK',
        price: 20000,
        quantity: 2,
        idempotencyKey: 'seller-high-key',
      });

      // Submit BID at 15000 (below 20000, so cannot match)
      const input = {
        ...MARKET_CONFIG,
        userId: 'contract-user-b',
        side: 'BID',
        price: 15000,
        quantity: 1,
        idempotencyKey: 'contract-idem-b',
      };

      const res = await service.submitLimitOrder(input);
      expect(res.status).toBe('OPEN');
      expect(res.stoppedReason).toBe('LIMIT_PRICE_REACHED');
      expect(res.remainingQuantity).toBe(1);
      expect(res.matchedQuantity).toBe(0);

      const retry = await service.submitLimitOrder(input);
      expect(retry.status).toBe('OPEN');
      expect(retry.stoppedReason).toBe('LIMIT_PRICE_REACHED');
      expect(retry.isDuplicate).toBe(true);
    });

    it('Case C: Fully filled order produces status FILLED and stoppedReason FILLED consistently', async () => {
      // Seed resting ASK at 10000 of 3 units
      await service.submitLimitOrder({
        ...MARKET_CONFIG,
        userId: 'seller-c',
        side: 'ASK',
        price: 10000,
        quantity: 3,
        idempotencyKey: 'seller-c-key',
      });

      // Submit BID at 10000 of 3 units (exact fill)
      const input = {
        ...MARKET_CONFIG,
        userId: 'buyer-c',
        side: 'BID',
        price: 10000,
        quantity: 3,
        idempotencyKey: 'buyer-c-key',
      };

      const res = await service.submitLimitOrder(input);
      expect(res.status).toBe('FILLED');
      expect(res.stoppedReason).toBe('FILLED');
      expect(res.matchedQuantity).toBe(3);
      expect(res.remainingQuantity).toBe(0);
      expect(res.restedQuantity).toBe(0);

      const retry = await service.submitLimitOrder(input);
      expect(retry.status).toBe('FILLED');
      expect(retry.stoppedReason).toBe('FILLED');
      expect(retry.matchedQuantity).toBe(3);
      expect(retry.remainingQuantity).toBe(0);
      expect(retry.isDuplicate).toBe(true);
    });

    it('Case D: Partially filled order produces status PARTIALLY_FILLED with strategy stoppedReason consistently', async () => {
      // Seed resting ASK at 10000 of 2 units
      await service.submitLimitOrder({
        ...MARKET_CONFIG,
        userId: 'seller-d',
        side: 'ASK',
        price: 10000,
        quantity: 2,
        idempotencyKey: 'seller-d-key',
      });

      // Submit BID at 10000 of 5 units (partial fill 2, remaining 3 rests)
      const input = {
        ...MARKET_CONFIG,
        userId: 'buyer-d',
        side: 'BID',
        price: 10000,
        quantity: 5,
        idempotencyKey: 'buyer-d-key',
      };

      const res = await service.submitLimitOrder(input);
      expect(res.status).toBe('PARTIALLY_FILLED');
      expect(res.stoppedReason).toBe('NO_MORE_LIQUIDITY');
      expect(res.matchedQuantity).toBe(2);
      expect(res.remainingQuantity).toBe(3);
      expect(res.restedQuantity).toBe(3);

      const retry = await service.submitLimitOrder(input);
      expect(retry.status).toBe('PARTIALLY_FILLED');
      expect(retry.stoppedReason).toBe('NO_MORE_LIQUIDITY');
      expect(retry.matchedQuantity).toBe(2);
      expect(retry.remainingQuantity).toBe(3);
      expect(retry.restedQuantity).toBe(3);
      expect(retry.isDuplicate).toBe(true);
    });

    it('Case E: Self-trade prevented order produces status CANCELLED and stoppedReason SELF_TRADE_PREVENTION consistently', async () => {
      // Alice places resting ASK of 2 units at 10000
      await service.submitLimitOrder({
        ...MARKET_CONFIG,
        userId: 'alice-stp-audit',
        side: 'ASK',
        price: 10000,
        quantity: 2,
        idempotencyKey: 'alice-stp-ask-key',
      });

      // Alice places matching BID of 2 units at 10000
      const input = {
        ...MARKET_CONFIG,
        userId: 'alice-stp-audit',
        side: 'BID',
        price: 10000,
        quantity: 2,
        idempotencyKey: 'alice-stp-bid-key',
      };

      const res = await service.submitLimitOrder(input);
      expect(res.status).toBe('CANCELLED');
      expect(res.stoppedReason).toBe('SELF_TRADE_PREVENTION');
      expect(res.matchedQuantity).toBe(0);
      expect(res.remainingQuantity).toBe(2);
      expect(res.restedQuantity).toBe(0);

      const retry = await service.submitLimitOrder(input);
      expect(retry.status).toBe('CANCELLED');
      expect(retry.stoppedReason).toBe('SELF_TRADE_PREVENTION');
      expect(retry.matchedQuantity).toBe(0);
      expect(retry.remainingQuantity).toBe(2);
      expect(retry.restedQuantity).toBe(0);
      expect(retry.isDuplicate).toBe(true);
    });
  });

  describe('12. Live PostgreSQL Database Integration (Neon)', () => {
    let livePrisma;
    let liveRepository;
    let liveQueue;
    let liveService;
    let liveMarketKey;
    let testUser;
    let testEvent;
    let testCategory;
    let liveBook;

    beforeAll(async () => {
      const dbModule = await import('../../src/db/prisma.js');
      livePrisma = dbModule.prisma;

      // Seed parent records for valid foreign keys in live database
      const uniqueSuffix = Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
      testUser = await livePrisma.user.create({
        data: {
          email: `trader-${uniqueSuffix}@passflow-test.io`,
          passwordHash: 'argon2-test-hash',
        },
      });

      const organizer = await livePrisma.organizer.create({
        data: {
          userId: testUser.id,
          organizationName: `Org-${uniqueSuffix}`,
        },
      });

      testEvent = await livePrisma.event.create({
        data: {
          name: `Live Test Concert ${uniqueSuffix}`,
          dateTime: new Date(Date.now() + 86400000),
          location: 'Live Test Arena',
          organizerId: organizer.id,
        },
      });

      testCategory = await livePrisma.ticketCategory.create({
        data: {
          eventId: testEvent.id,
          name: 'VIP Front Row',
          originalPrice: 15000,
          totalQuantity: 100,
          availableQuantity: 100,
        },
      });

      const liveConfig = {
        eventId: testEvent.id,
        ticketCategoryId: testCategory.id,
      };
      liveMarketKey = formatMarketKey(liveConfig);

      liveRepository = new OrderRepository({ prismaClient: livePrisma });
      const liveStateManager = new MarketStateManager();
      liveQueue = new MarketExecutionQueue({ stateManager: liveStateManager });
      liveService = new PersistentMatchingService({
        repository: liveRepository,
        queue: liveQueue,
        stateManager: liveStateManager,
      });

      liveBook = new OrderBook(liveConfig);
      liveService.registerMarketBook(liveConfig, liveBook);
      liveStateManager.transition(liveMarketKey, MarketState.READY);
    }, 20000);

    afterAll(async () => {
      if (testUser && livePrisma) {
        // Cascade delete will cleanly remove organizer, event, category, orders, executions
        await livePrisma.user.delete({ where: { id: testUser.id } }).catch(() => {});
        await livePrisma.$disconnect().catch(() => {});
      }
    }, 20000);

    it('executes resting order persistence, trade matching, and idempotent recovery on live PostgreSQL', async () => {
      const sellerIdemp = `seller-${Date.now()}`;
      const buyerIdemp = `buyer-${Date.now()}`;

      // 1. Submit resting ASK to live database
      const askResult = await liveService.submitLimitOrder({
        eventId: testEvent.id,
        ticketCategoryId: testCategory.id,
        userId: testUser.id,
        side: 'ASK',
        price: 15000,
        quantity: 2,
        idempotencyKey: sellerIdemp,
      });

      expect(askResult.status).toBe('OPEN');
      expect(askResult.remainingQuantity).toBe(2);
      expect(liveBook.size()).toBe(1);

      // Verify in live PostgreSQL
      const dbAsk = await livePrisma.order.findUnique({ where: { id: askResult.orderId } });
      expect(dbAsk).not.toBeNull();
      expect(dbAsk.status).toBe('OPEN');
      expect(dbAsk.price).toBe(15000);

      // 2. Create second user for matching (prevent STP)
      const buyerUser = await livePrisma.user.create({
        data: {
          email: `buyer-${Date.now()}@passflow-test.io`,
          passwordHash: 'hash',
        },
      });

      // Submit matching BID to live database
      const bidResult = await liveService.submitLimitOrder({
        eventId: testEvent.id,
        ticketCategoryId: testCategory.id,
        userId: buyerUser.id,
        side: 'BID',
        price: 15000,
        quantity: 2,
        idempotencyKey: buyerIdemp,
      });

      expect(bidResult.status).toBe('FILLED');
      expect(bidResult.matchedQuantity).toBe(2);
      expect(bidResult.executions).toHaveLength(1);
      expect(typeof bidResult.executions[0].sequenceNumber).toBe('string');
      expect(BigInt(bidResult.executions[0].sequenceNumber) > 0n).toBe(true);
      expect(liveBook.size()).toBe(0);

      // Verify trade in live PostgreSQL
      const dbExec = await livePrisma.execution.findUnique({
        where: { id: bidResult.executions[0].id },
      });
      expect(dbExec).not.toBeNull();
      expect(dbExec.price).toBe(15000);
      expect(dbExec.quantity).toBe(2);

      // 3. Idempotent retry on live database
      const retryResult = await liveService.submitLimitOrder({
        eventId: testEvent.id,
        ticketCategoryId: testCategory.id,
        userId: buyerUser.id,
        side: 'BID',
        price: 15000,
        quantity: 2,
        idempotencyKey: buyerIdemp,
      });

      expect(retryResult.isDuplicate).toBe(true);
      expect(retryResult.orderId).toBe(bidResult.orderId);
      expect(retryResult.executions).toHaveLength(1);
      expect(retryResult.executions[0].sequenceNumber).toBe(bidResult.executions[0].sequenceNumber);

      // Clean up second user
      await livePrisma.user.delete({ where: { id: buyerUser.id } }).catch(() => {});
    }, 25000);
  });
});

