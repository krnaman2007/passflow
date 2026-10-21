import { PriceTimePriority } from '../../src/services/matching/price-time-priority.js';
import { OrderBook } from '../../src/services/matching/order-book.js';

describe('PriceTimePriority Matching Strategy', () => {
  const CONFIG = {
    eventId: 'ev-coldplay',
    ticketCategoryId: 'cat-vip',
  };

  let strategy;
  let book;

  beforeEach(() => {
    strategy = new PriceTimePriority();
    book = new OrderBook(CONFIG);
  });

  describe('1, 2, 3: Initialization & Validation', () => {
    it('1. Initializes cleanly and exposes calculate method', () => {
      expect(strategy).toBeInstanceOf(PriceTimePriority);
      expect(typeof strategy.calculate).toBe('function');
      expect(typeof PriceTimePriority.calculate).toBe('function');
    });

    it('2. Rejects invalid book and incoming order inputs with appropriate errors', () => {
      const validOrder = { id: 'ord-1', side: 'BID', price: 1000, remainingQuantity: 5 };

      // Invalid book
      expect(() => strategy.calculate(null, validOrder)).toThrow(TypeError);
      expect(() => strategy.calculate({}, validOrder)).toThrow(TypeError);

      // Invalid incoming order
      expect(() => strategy.calculate(book, null)).toThrow(TypeError);
      expect(() => strategy.calculate(book, [])).toThrow(TypeError);
      expect(() => strategy.calculate(book, 'order')).toThrow(TypeError);

      // Invalid order id
      expect(() => strategy.calculate(book, { ...validOrder, id: 123 })).toThrow(TypeError);
      expect(() => strategy.calculate(book, { ...validOrder, id: '' })).toThrow(RangeError);
      expect(() => strategy.calculate(book, { ...validOrder, id: '   ' })).toThrow(RangeError);

      // Invalid side
      expect(() => strategy.calculate(book, { ...validOrder, side: 'BUY' })).toThrow(RangeError);
      expect(() => strategy.calculate(book, { ...validOrder, side: 123 })).toThrow(TypeError);

      // Invalid price & remainingQuantity
      expect(() => strategy.calculate(book, { ...validOrder, price: 0 })).toThrow(RangeError);
      expect(() => strategy.calculate(book, { ...validOrder, price: -100 })).toThrow(RangeError);
      expect(() => strategy.calculate(book, { ...validOrder, price: 50.5 })).toThrow(TypeError);
      expect(() => strategy.calculate(book, { ...validOrder, remainingQuantity: 0 })).toThrow(RangeError);
      expect(() => strategy.calculate(book, { ...validOrder, remainingQuantity: -5 })).toThrow(RangeError);
      expect(() => strategy.calculate(book, { ...validOrder, remainingQuantity: 2.5 })).toThrow(TypeError);

      // Invalid userId
      expect(() => strategy.calculate(book, { ...validOrder, userId: 12345 })).toThrow(TypeError);
    });

    it('3. Handles empty book returning zero executions and wouldRest true', () => {
      const incomingBid = { id: 'bid-1', side: 'BID', price: 10000, remainingQuantity: 5 };
      const plan = strategy.calculate(book, incomingBid);

      expect(plan.executions).toEqual([]);
      expect(plan.matchedQuantity).toBe(0);
      expect(plan.remainingQuantity).toBe(5);
      expect(plan.fullyFilled).toBe(false);
      expect(plan.wouldRest).toBe(true);
      expect(plan.stoppedReason).toBe('NO_MORE_LIQUIDITY');
    });
  });

  describe('4 & 5: Basic BID and ASK Matching', () => {
    it('4. Incoming BID matches against resting ASK order', () => {
      book.addOrder('ASK', { id: 'ask-1', price: 10000, remainingQuantity: 5 });

      const incomingBid = { id: 'bid-1', side: 'BID', price: 10000, remainingQuantity: 5 };
      const plan = strategy.calculate(book, incomingBid);

      expect(plan.fullyFilled).toBe(true);
      expect(plan.matchedQuantity).toBe(5);
      expect(plan.remainingQuantity).toBe(0);
      expect(plan.wouldRest).toBe(false);
      expect(plan.stoppedReason).toBe('FILLED');

      expect(plan.executions).toHaveLength(1);
      expect(plan.executions[0]).toEqual({
        incomingOrderId: 'bid-1',
        restingOrderId: 'ask-1',
        price: 10000,
        quantity: 5,
        restingOrderRemainingAfterExecution: 0,
      });
    });

    it('5. Incoming ASK matches against resting BID order', () => {
      book.addOrder('BID', { id: 'bid-1', price: 10000, remainingQuantity: 3 });

      const incomingAsk = { id: 'ask-1', side: 'ASK', price: 10000, remainingQuantity: 3 };
      const plan = strategy.calculate(book, incomingAsk);

      expect(plan.fullyFilled).toBe(true);
      expect(plan.matchedQuantity).toBe(3);
      expect(plan.remainingQuantity).toBe(0);
      expect(plan.wouldRest).toBe(false);
      expect(plan.stoppedReason).toBe('FILLED');

      expect(plan.executions).toHaveLength(1);
      expect(plan.executions[0]).toEqual({
        incomingOrderId: 'ask-1',
        restingOrderId: 'bid-1',
        price: 10000,
        quantity: 3,
        restingOrderRemainingAfterExecution: 0,
      });
    });
  });

  describe('6, 7, 8: Price-Time Priority & Multi-Level Matching', () => {
    it('6 & 8. Selects best price first across multiple price levels', () => {
      // Resting asks at 12000, 10000, 11000
      book.addOrder('ASK', { id: 'ask-high', price: 12000, remainingQuantity: 10 });
      book.addOrder('ASK', { id: 'ask-low', price: 10000, remainingQuantity: 10 });
      book.addOrder('ASK', { id: 'ask-mid', price: 11000, remainingQuantity: 10 });

      // Incoming BID willing to pay up to 11500 for 15 units
      const incomingBid = { id: 'bid-sweep', side: 'BID', price: 11500, remainingQuantity: 15 };
      const plan = strategy.calculate(book, incomingBid);

      expect(plan.executions).toHaveLength(2);
      // Execution 1: matches lowest ask (10000) for all 10 units
      expect(plan.executions[0].restingOrderId).toBe('ask-low');
      expect(plan.executions[0].price).toBe(10000);
      expect(plan.executions[0].quantity).toBe(10);
      expect(plan.executions[0].restingOrderRemainingAfterExecution).toBe(0);

      // Execution 2: matches next lowest ask (11000) for remaining 5 units
      expect(plan.executions[1].restingOrderId).toBe('ask-mid');
      expect(plan.executions[1].price).toBe(11000);
      expect(plan.executions[1].quantity).toBe(5);
      expect(plan.executions[1].restingOrderRemainingAfterExecution).toBe(5);

      expect(plan.matchedQuantity).toBe(15);
      expect(plan.remainingQuantity).toBe(0);
      expect(plan.fullyFilled).toBe(true);
      expect(plan.stoppedReason).toBe('FILLED');
    });

    it('7. Preserves strict FIFO priority within the same price level', () => {
      book.addOrder('ASK', { id: 'ask-first', price: 10000, remainingQuantity: 4 });
      book.addOrder('ASK', { id: 'ask-second', price: 10000, remainingQuantity: 6 });

      // Incoming BID for 5 units
      const incomingBid = { id: 'bid-1', side: 'BID', price: 10000, remainingQuantity: 5 };
      const plan = strategy.calculate(book, incomingBid);

      expect(plan.executions).toHaveLength(2);
      expect(plan.executions[0].restingOrderId).toBe('ask-first');
      expect(plan.executions[0].quantity).toBe(4);
      expect(plan.executions[1].restingOrderId).toBe('ask-second');
      expect(plan.executions[1].quantity).toBe(1);
    });
  });

  describe('9, 10, 11, 12: Partial Fills and Multi-Order Executions', () => {
    it('9. Exact full fill', () => {
      book.addOrder('ASK', { id: 'a1', price: 5000, remainingQuantity: 10 });
      const plan = strategy.calculate(book, { id: 'b1', side: 'BID', price: 5000, remainingQuantity: 10 });

      expect(plan.fullyFilled).toBe(true);
      expect(plan.remainingQuantity).toBe(0);
      expect(plan.matchedQuantity).toBe(10);
      expect(plan.wouldRest).toBe(false);
      expect(plan.stoppedReason).toBe('FILLED');
    });

    it('10. Partial incoming fill leaves remainder and sets wouldRest true', () => {
      book.addOrder('ASK', { id: 'a1', price: 5000, remainingQuantity: 6 });
      const plan = strategy.calculate(book, { id: 'b1', side: 'BID', price: 5000, remainingQuantity: 10 });

      expect(plan.fullyFilled).toBe(false);
      expect(plan.matchedQuantity).toBe(6);
      expect(plan.remainingQuantity).toBe(4);
      expect(plan.wouldRest).toBe(true);
      expect(plan.stoppedReason).toBe('NO_MORE_LIQUIDITY');
    });

    it('11. Partial resting order fill leaves restingOrderRemainingAfterExecution', () => {
      book.addOrder('ASK', { id: 'a1', price: 5000, remainingQuantity: 20 });
      const plan = strategy.calculate(book, { id: 'b1', side: 'BID', price: 5000, remainingQuantity: 7 });

      expect(plan.fullyFilled).toBe(true);
      expect(plan.matchedQuantity).toBe(7);
      expect(plan.remainingQuantity).toBe(0);
      expect(plan.executions[0].restingOrderRemainingAfterExecution).toBe(13);
    });

    it('12. Multiple executions from one incoming order sweeping book', () => {
      book.addOrder('BID', { id: 'b1', price: 10000, remainingQuantity: 2 });
      book.addOrder('BID', { id: 'b2', price: 9500, remainingQuantity: 3 });
      book.addOrder('BID', { id: 'b3', price: 9000, remainingQuantity: 4 });

      const incomingAsk = { id: 'a-sweep', side: 'ASK', price: 9000, remainingQuantity: 7 };
      const plan = strategy.calculate(book, incomingAsk);

      expect(plan.executions).toHaveLength(3);
      expect(plan.executions.map((e) => e.quantity)).toEqual([2, 3, 2]);
      expect(plan.matchedQuantity).toBe(7);
      expect(plan.fullyFilled).toBe(true);
      expect(plan.executions[2].restingOrderRemainingAfterExecution).toBe(2);
    });
  });

  describe('13, 14, 15: Limit Price Boundaries & Execution Price', () => {
    it('13. Incoming BID stops above its limit price with LIMIT_PRICE_REACHED', () => {
      book.addOrder('ASK', { id: 'a1', price: 10000, remainingQuantity: 5 });
      book.addOrder('ASK', { id: 'a2', price: 11000, remainingQuantity: 5 });

      // Incoming BID at 10500 for 8 units
      const plan = strategy.calculate(book, { id: 'bid-lim', side: 'BID', price: 10500, remainingQuantity: 8 });

      expect(plan.executions).toHaveLength(1);
      expect(plan.executions[0].price).toBe(10000);
      expect(plan.matchedQuantity).toBe(5);
      expect(plan.remainingQuantity).toBe(3);
      expect(plan.fullyFilled).toBe(false);
      expect(plan.wouldRest).toBe(true);
      expect(plan.stoppedReason).toBe('LIMIT_PRICE_REACHED');
    });

    it('14. Incoming ASK stops below its limit price with LIMIT_PRICE_REACHED', () => {
      book.addOrder('BID', { id: 'b1', price: 10000, remainingQuantity: 5 });
      book.addOrder('BID', { id: 'b2', price: 9000, remainingQuantity: 5 });

      // Incoming ASK at 9500 for 8 units
      const plan = strategy.calculate(book, { id: 'ask-lim', side: 'ASK', price: 9500, remainingQuantity: 8 });

      expect(plan.executions).toHaveLength(1);
      expect(plan.executions[0].price).toBe(10000);
      expect(plan.matchedQuantity).toBe(5);
      expect(plan.remainingQuantity).toBe(3);
      expect(plan.fullyFilled).toBe(false);
      expect(plan.wouldRest).toBe(true);
      expect(plan.stoppedReason).toBe('LIMIT_PRICE_REACHED');
    });

    it('15. Execution price strictly equals the passive resting order price (price improvement)', () => {
      // Resting ask at 9000, incoming buyer willing to pay 10000
      book.addOrder('ASK', { id: 'a1', price: 9000, remainingQuantity: 5 });

      const plan = strategy.calculate(book, { id: 'b1', side: 'BID', price: 10000, remainingQuantity: 5 });
      expect(plan.executions[0].price).toBe(9000); // 9000, NOT 10000
    });
  });

  describe('16: Crossed Book Behavior', () => {
    it('16. In a pre-existing crossed book, matches starting at the best price', () => {
      // In Step 4, crossed orders can rest: BID at 10500, ASK at 10000
      book.addOrder('BID', { id: 'b-cross', price: 10500, remainingQuantity: 5 });
      book.addOrder('ASK', { id: 'a-cross', price: 10000, remainingQuantity: 5 });

      // A new incoming BID at 11000 matches the best ask (10000)
      const planBid = strategy.calculate(book, { id: 'b-new', side: 'BID', price: 11000, remainingQuantity: 5 });
      expect(planBid.executions[0].restingOrderId).toBe('a-cross');
      expect(planBid.executions[0].price).toBe(10000);

      // A new incoming ASK at 9000 matches the best bid (10500)
      const planAsk = strategy.calculate(book, { id: 'a-new', side: 'ASK', price: 9000, remainingQuantity: 5 });
      expect(planAsk.executions[0].restingOrderId).toBe('b-cross');
      expect(planAsk.executions[0].price).toBe(10500);
    });
  });

  describe('17, 18, 19: Self-Trade Prevention (STP)', () => {
    it('17. Stops matching when incoming and resting order share same non-empty userId', () => {
      book.addOrder('ASK', { id: 'a1', price: 10000, remainingQuantity: 5, userId: 'user-alice' });

      const incomingBid = {
        id: 'b1',
        side: 'BID',
        price: 10000,
        remainingQuantity: 5,
        userId: 'user-alice',
      };

      const plan = strategy.calculate(book, incomingBid);

      expect(plan.executions).toEqual([]);
      expect(plan.matchedQuantity).toBe(0);
      expect(plan.remainingQuantity).toBe(5);
      expect(plan.fullyFilled).toBe(false);
      expect(plan.wouldRest).toBe(false); // STP prevents resting against own order
      expect(plan.stoppedReason).toBe('SELF_TRADE_PREVENTION');
    });

    it('18. Allows matching when userId is missing, undefined, or empty on either order', () => {
      book.addOrder('ASK', { id: 'a1', price: 10000, remainingQuantity: 5 }); // no userId
      const plan1 = strategy.calculate(book, {
        id: 'b1',
        side: 'BID',
        price: 10000,
        remainingQuantity: 5,
        userId: 'user-alice',
      });
      expect(plan1.fullyFilled).toBe(true);

      const book2 = new OrderBook(CONFIG);
      book2.addOrder('ASK', { id: 'a2', price: 10000, remainingQuantity: 5, userId: 'user-alice' });
      const plan2 = strategy.calculate(book2, {
        id: 'b2',
        side: 'BID',
        price: 10000,
        remainingQuantity: 5,
        // no userId
      });
      expect(plan2.fullyFilled).toBe(true);
    });

    it('19. Self-trade prevention does NOT skip ahead in the queue (stops immediately)', () => {
      // Alice placed first order, Bob placed second order at same price
      book.addOrder('ASK', { id: 'a-alice', price: 10000, remainingQuantity: 5, userId: 'user-alice' });
      book.addOrder('ASK', { id: 'a-bob', price: 10000, remainingQuantity: 5, userId: 'user-bob' });

      // Alice sends aggressive BID
      const incomingAlice = {
        id: 'b-alice',
        side: 'BID',
        price: 10000,
        remainingQuantity: 10,
        userId: 'user-alice',
      };

      const plan = strategy.calculate(book, incomingAlice);

      // Must NOT skip Alice's resting order to match with Bob's order!
      expect(plan.executions).toEqual([]);
      expect(plan.stoppedReason).toBe('SELF_TRADE_PREVENTION');
      expect(plan.matchedQuantity).toBe(0);
    });

    it('matches earlier eligible orders before stopping on same-user order', () => {
      // Bob's order is first, Alice's order is second
      book.addOrder('ASK', { id: 'a-bob', price: 10000, remainingQuantity: 5, userId: 'user-bob' });
      book.addOrder('ASK', { id: 'a-alice', price: 10000, remainingQuantity: 5, userId: 'user-alice' });

      // Alice sends aggressive BID for 8 units
      const plan = strategy.calculate(book, {
        id: 'b-alice',
        side: 'BID',
        price: 10000,
        remainingQuantity: 8,
        userId: 'user-alice',
      });

      // Matches Bob for 5 units, then hits Alice and stops
      expect(plan.executions).toHaveLength(1);
      expect(plan.executions[0].restingOrderId).toBe('a-bob');
      expect(plan.executions[0].quantity).toBe(5);
      expect(plan.matchedQuantity).toBe(5);
      expect(plan.remainingQuantity).toBe(3);
      expect(plan.stoppedReason).toBe('SELF_TRADE_PREVENTION');
    });
  });

  describe('20, 21: Duplicate ID Rejection & Input Sanitization', () => {
    it('20. Rejects duplicate incoming order ID if already present in the OrderBook', () => {
      book.addOrder('BID', { id: 'existing-id', price: 10000, remainingQuantity: 5 });

      expect(() =>
        strategy.calculate(book, {
          id: 'existing-id',
          side: 'ASK',
          price: 10000,
          remainingQuantity: 5,
        })
      ).toThrow(Error);
    });

    it('21. Validates quantities and prices strictly as positive safe integers', () => {
      expect(() =>
        strategy.calculate(book, {
          id: '1',
          side: 'BID',
          price: Number.MAX_SAFE_INTEGER + 1,
          remainingQuantity: 10,
        })
      ).toThrow(RangeError);

      expect(() =>
        strategy.calculate(book, {
          id: '1',
          side: 'BID',
          price: 10000,
          remainingQuantity: Number.MAX_SAFE_INTEGER + 1,
        })
      ).toThrow(RangeError);
    });
  });

  describe('22, 23, 24, 25: Mathematical & Execution Invariants', () => {
    it('22, 23, 24, 25. Verifies conservation of quantities, non-zero executions, and limit enforcement', () => {
      book.addOrder('ASK', { id: 'a1', price: 10000, remainingQuantity: 7 });
      book.addOrder('ASK', { id: 'a2', price: 10500, remainingQuantity: 8 });

      const incomingBid = { id: 'b1', side: 'BID', price: 10500, remainingQuantity: 12 };
      const plan = strategy.calculate(book, incomingBid);

      // Invariant 22: matchedQuantity === sum(executions.quantity)
      const sumQty = plan.executions.reduce((sum, e) => sum + e.quantity, 0);
      expect(plan.matchedQuantity).toBe(sumQty);

      // Invariant 23: incomingRemaining + matchedQuantity === originalQuantity
      expect(plan.remainingQuantity + plan.matchedQuantity).toBe(incomingBid.remainingQuantity);

      // Invariant 24: No zero-quantity executions
      for (const exec of plan.executions) {
        expect(exec.quantity).toBeGreaterThan(0);
      }

      // Invariant 25: No execution outside limit
      for (const exec of plan.executions) {
        expect(exec.price).toBeLessThanOrEqual(incomingBid.price);
      }
    });
  });

  describe('26, 27, 28: Pure Calculation & Non-Mutation Guarantees', () => {
    it('26 & 27. Calculation does NOT mutate incoming order, resting orders, or OrderBook', () => {
      const restingAsk = { id: 'a1', price: 10000, remainingQuantity: 10 };
      book.addOrder('ASK', restingAsk);

      const incomingBid = { id: 'b1', side: 'BID', price: 10000, remainingQuantity: 6 };

      const snapshotBefore = book.getStats();

      const plan = strategy.calculate(book, incomingBid);
      expect(plan.matchedQuantity).toBe(6);

      // Verify incoming order object was not mutated
      expect(incomingBid.remainingQuantity).toBe(6);

      // Verify resting order object in book was not mutated
      expect(restingAsk.remainingQuantity).toBe(10);

      // Verify OrderBook state was not mutated
      expect(book.getStats()).toEqual(snapshotBefore);
      expect(book.size()).toBe(1);
      expect(book.totalQuantity()).toBe(10);
    });

    it('28. Repeated calculation is completely deterministic and idempotent', () => {
      book.addOrder('ASK', { id: 'a1', price: 10000, remainingQuantity: 10 });
      const incomingBid = { id: 'b1', side: 'BID', price: 10000, remainingQuantity: 5 };

      const plan1 = strategy.calculate(book, incomingBid);
      const plan2 = strategy.calculate(book, incomingBid);

      expect(plan1).toEqual(plan2);
    });
  });

  describe('29 & 30: Stress Testing and Invariant Verification', () => {
    it('29 & 30. Deterministic multi-tier stress simulation verifies all invariants', () => {
      // Build a multi-tier ASK side
      const askPrices = [10000, 10500, 11000, 11500, 12000];
      for (let i = 0; i < 50; i++) {
        book.addOrder('ASK', {
          id: `ask-stress-${i}`,
          price: askPrices[i % askPrices.length],
          remainingQuantity: (i % 10) + 1,
        });
      }

      // Execute aggressive sweep bids of various quantities and limits
      const testBids = [
        { id: 'sweep-1', side: 'BID', price: 10000, remainingQuantity: 25 },
        { id: 'sweep-2', side: 'BID', price: 11000, remainingQuantity: 100 },
        { id: 'sweep-3', side: 'BID', price: 13000, remainingQuantity: 1000 },
      ];

      for (const bid of testBids) {
        const plan = strategy.calculate(book, bid);

        // Invariant: sum of execution quantities equals matchedQuantity
        const totalExec = plan.executions.reduce((acc, e) => acc + e.quantity, 0);
        expect(plan.matchedQuantity).toBe(totalExec);
        expect(plan.remainingQuantity + plan.matchedQuantity).toBe(bid.remainingQuantity);

        // Invariant: all executions must be <= bid.price
        for (const exec of plan.executions) {
          expect(exec.price).toBeLessThanOrEqual(bid.price);
        }

        // Invariant: executions must strictly be non-decreasing in price (lowest ask first)
        for (let j = 1; j < plan.executions.length; j++) {
          expect(plan.executions[j].price).toBeGreaterThanOrEqual(plan.executions[j - 1].price);
        }
      }
    });
  });
});
