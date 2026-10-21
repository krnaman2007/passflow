import { MatchingCoordinator } from '../../src/services/matching/matching-coordinator.js';
import { OrderBook } from '../../src/services/matching/order-book.js';
import { PriceTimePriority } from '../../src/services/matching/price-time-priority.js';

describe('MatchingCoordinator Integration Component', () => {
  const CONFIG = {
    eventId: 'ev-coldplay',
    ticketCategoryId: 'cat-vip',
  };

  let coordinator;
  let book;

  beforeEach(() => {
    coordinator = new MatchingCoordinator();
    book = new OrderBook(CONFIG);
  });

  describe('1 & 2: Constructor & Validation', () => {
    it('1. Constructor initializes with default PriceTimePriority strategy and validates custom strategies', () => {
      expect(coordinator.strategy).toBeInstanceOf(PriceTimePriority);

      // Custom strategy
      const mockStrategy = { calculate: () => {} };
      const customCoordinator = new MatchingCoordinator({ strategy: mockStrategy });
      expect(customCoordinator.strategy).toBe(mockStrategy);

      // Invalid strategies
      expect(() => new MatchingCoordinator({ strategy: null })).toThrow(TypeError);
      expect(() => new MatchingCoordinator({ strategy: {} })).toThrow(TypeError);
      expect(() => new MatchingCoordinator({ strategy: 'invalid' })).toThrow(TypeError);
    });

    it('2. Rejects invalid book and incoming order inputs with proper error types', () => {
      const validOrder = { id: 'ord-1', side: 'BID', price: 1000, remainingQuantity: 5 };

      // Invalid book
      expect(() => coordinator.submitLimitOrder(null, validOrder)).toThrow(TypeError);
      expect(() => coordinator.submitLimitOrder({}, validOrder)).toThrow(TypeError);

      // Invalid order structure
      expect(() => coordinator.submitLimitOrder(book, null)).toThrow(TypeError);
      expect(() => coordinator.submitLimitOrder(book, [])).toThrow(TypeError);

      // Invalid order id
      expect(() => coordinator.submitLimitOrder(book, { ...validOrder, id: 123 })).toThrow(TypeError);
      expect(() => coordinator.submitLimitOrder(book, { ...validOrder, id: '' })).toThrow(RangeError);
      expect(() => coordinator.submitLimitOrder(book, { ...validOrder, id: '   ' })).toThrow(RangeError);

      // Invalid side
      expect(() => coordinator.submitLimitOrder(book, { ...validOrder, side: 'BUY' })).toThrow(RangeError);

      // Invalid price & quantity
      expect(() => coordinator.submitLimitOrder(book, { ...validOrder, price: 0 })).toThrow(RangeError);
      expect(() => coordinator.submitLimitOrder(book, { ...validOrder, price: -100 })).toThrow(RangeError);
      expect(() => coordinator.submitLimitOrder(book, { ...validOrder, remainingQuantity: 0 })).toThrow(RangeError);
      expect(() => coordinator.submitLimitOrder(book, { ...validOrder, remainingQuantity: -5 })).toThrow(RangeError);

      // Market identifier mismatch against book
      expect(() =>
        coordinator.submitLimitOrder(book, { ...validOrder, eventId: 'wrong-event' })
      ).toThrow(RangeError);
      expect(() =>
        coordinator.submitLimitOrder(book, { ...validOrder, ticketCategoryId: 'wrong-cat' })
      ).toThrow(RangeError);
    });

    it('18. Rejects duplicate incoming order ID if already present in the book', () => {
      book.addOrder('BID', { id: 'existing-id', price: 1000, remainingQuantity: 5 });

      expect(() =>
        coordinator.submitLimitOrder(book, {
          id: 'existing-id',
          side: 'BID',
          price: 1000,
          remainingQuantity: 5,
        })
      ).toThrow(Error);
    });
  });

  describe('3, 4, 11: Matching & Price Improvement', () => {
    it('3 & 11. Incoming BID matches resting ASK at the passive resting price (price improvement)', () => {
      // Resting ask at 9000
      book.addOrder('ASK', { id: 'ask-1', price: 9000, remainingQuantity: 5 });

      // Incoming BID at 10000 (willing to pay up to 10000)
      const incomingBid = { id: 'bid-1', side: 'BID', price: 10000, remainingQuantity: 5 };
      const result = coordinator.submitLimitOrder(book, incomingBid);

      expect(result.status).toBe('FILLED');
      expect(result.matchedQuantity).toBe(5);
      expect(result.remainingQuantity).toBe(0);
      expect(result.restedQuantity).toBe(0);
      expect(result.executions).toHaveLength(1);

      // Execution price must be resting price 9000, NOT incoming price 10000
      expect(result.executions[0]).toEqual({
        incomingOrderId: 'bid-1',
        restingOrderId: 'ask-1',
        price: 9000,
        quantity: 5,
        restingOrderRemainingAfterExecution: 0,
      });

      // Book must now be empty
      expect(book.isEmpty()).toBe(true);
      expect(book.size()).toBe(0);
    });

    it('4. Incoming ASK matches resting BID at the passive resting price', () => {
      // Resting bid at 10000
      book.addOrder('BID', { id: 'bid-1', price: 10000, remainingQuantity: 4 });

      // Incoming ASK at 9500
      const incomingAsk = { id: 'ask-1', side: 'ASK', price: 9500, remainingQuantity: 4 };
      const result = coordinator.submitLimitOrder(book, incomingAsk);

      expect(result.status).toBe('FILLED');
      expect(result.matchedQuantity).toBe(4);
      expect(result.remainingQuantity).toBe(0);
      expect(result.executions[0].price).toBe(10000);
      expect(book.isEmpty()).toBe(true);
    });
  });

  describe('5 & 6: Resting Orders (No Fills)', () => {
    it('5. Submitting to an empty book causes the order to rest (status RESTING)', () => {
      const order = { id: 'bid-rest', side: 'BID', price: 10000, remainingQuantity: 10 };
      const result = coordinator.submitLimitOrder(book, order);

      expect(result.status).toBe('RESTING');
      expect(result.matchedQuantity).toBe(0);
      expect(result.remainingQuantity).toBe(10);
      expect(result.restedQuantity).toBe(10);
      expect(result.executions).toEqual([]);

      // Verifies order is now resting in the book
      expect(book.size()).toBe(1);
      expect(book.totalQuantity()).toBe(10);
      expect(book.getBestBid()).toBe(10000);
      expect(book.getOrder('bid-rest')).toEqual({
        order: expect.objectContaining({ id: 'bid-rest', remainingQuantity: 10 }),
        side: 'BID',
      });
    });

    it('6. Submitting order with no price overlap rests the full order in the book', () => {
      // Resting ask at 12000
      book.addOrder('ASK', { id: 'ask-high', price: 12000, remainingQuantity: 5 });

      // Incoming bid at 10000 (below best ask)
      const bid = { id: 'bid-low', side: 'BID', price: 10000, remainingQuantity: 8 };
      const result = coordinator.submitLimitOrder(book, bid);

      expect(result.status).toBe('RESTING');
      expect(result.matchedQuantity).toBe(0);
      expect(result.remainingQuantity).toBe(8);
      expect(result.restedQuantity).toBe(8);
      expect(result.executions).toEqual([]);

      // Book now contains 2 orders (1 on each side)
      expect(book.size()).toBe(2);
      expect(book.totalQuantity()).toBe(13);
      expect(book.getBestBid()).toBe(10000);
      expect(book.getBestAsk()).toBe(12000);
      expect(book.getSpread()).toBe(2000);
    });
  });

  describe('7, 8, 14, 29: Order Lifecycle & Remainder Insertion', () => {
    it('7 & 29. Exact full fill: status FILLED and incoming order is NEVER inserted into the book', () => {
      book.addOrder('ASK', { id: 'a1', price: 10000, remainingQuantity: 10 });

      const incomingBid = { id: 'b1', side: 'BID', price: 10000, remainingQuantity: 10 };
      const result = coordinator.submitLimitOrder(book, incomingBid);

      expect(result.status).toBe('FILLED');
      expect(result.remainingQuantity).toBe(0);
      expect(result.restedQuantity).toBe(0);

      // Verify incoming order b1 is NOT in book
      expect(book.getOrder('b1')).toBeNull();
      expect(book.isEmpty()).toBe(true);
    });

    it('8 & 14. Partial fill: status PARTIALLY_FILLED, remainder added exactly once', () => {
      book.addOrder('ASK', { id: 'a1', price: 10000, remainingQuantity: 6 });

      const incomingBid = { id: 'b1', side: 'BID', price: 10000, remainingQuantity: 10 };
      const result = coordinator.submitLimitOrder(book, incomingBid);

      expect(result.status).toBe('PARTIALLY_FILLED');
      expect(result.matchedQuantity).toBe(6);
      expect(result.remainingQuantity).toBe(4);
      expect(result.restedQuantity).toBe(4);

      // Resting order a1 was fully consumed and removed
      expect(book.getOrder('a1')).toBeNull();

      // Incoming remainder of 4 is now resting on the BID side
      const restingRemainder = book.getOrder('b1');
      expect(restingRemainder).not.toBeNull();
      expect(restingRemainder.side).toBe('BID');
      expect(restingRemainder.order.remainingQuantity).toBe(4);
      expect(restingRemainder.order.price).toBe(10000);

      // Book state check
      expect(book.size()).toBe(1);
      expect(book.totalQuantity()).toBe(4);
      expect(book.getBestBid()).toBe(10000);
    });
  });

  describe('9, 10, 12, 13: Multi-Order Sweeps & Resting Updates', () => {
    it('9, 10, 12, 13. Multiple executions across multiple price levels; updates and removes resting orders', () => {
      book.addOrder('ASK', { id: 'ask-1', price: 10000, remainingQuantity: 5 });
      book.addOrder('ASK', { id: 'ask-2', price: 10000, remainingQuantity: 5 });
      book.addOrder('ASK', { id: 'ask-3', price: 11000, remainingQuantity: 10 });

      // Incoming BID for 14 units at 11000
      const incomingBid = { id: 'bid-sweep', side: 'BID', price: 11000, remainingQuantity: 14 };
      const result = coordinator.submitLimitOrder(book, incomingBid);

      expect(result.status).toBe('FILLED');
      expect(result.matchedQuantity).toBe(14);
      expect(result.executions).toHaveLength(3);

      // ask-1: fully consumed (5)
      expect(result.executions[0].restingOrderId).toBe('ask-1');
      expect(result.executions[0].quantity).toBe(5);
      expect(book.getOrder('ask-1')).toBeNull();

      // ask-2: fully consumed (5)
      expect(result.executions[1].restingOrderId).toBe('ask-2');
      expect(result.executions[1].quantity).toBe(5);
      expect(book.getOrder('ask-2')).toBeNull();

      // ask-3: partially consumed (4 of 10) -> 6 left in book
      expect(result.executions[2].restingOrderId).toBe('ask-3');
      expect(result.executions[2].quantity).toBe(4);
      expect(result.executions[2].restingOrderRemainingAfterExecution).toBe(6);

      const restingAsk3 = book.getOrder('ask-3');
      expect(restingAsk3).not.toBeNull();
      expect(restingAsk3.order.remainingQuantity).toBe(6);

      expect(book.size()).toBe(1);
      expect(book.totalQuantity()).toBe(6);
      expect(book.getBestAsk()).toBe(11000);
    });
  });

  describe('15, 16, 17, 30: Self-Trade Prevention (STP)', () => {
    it('15 & 30. Self-trade prevention with no prior fills: status CANCELLED and remainder NEVER rests', () => {
      book.addOrder('ASK', { id: 'a1', price: 10000, remainingQuantity: 5, userId: 'user-alice' });

      const incomingBid = {
        id: 'b1',
        side: 'BID',
        price: 10000,
        remainingQuantity: 5,
        userId: 'user-alice',
      };

      const result = coordinator.submitLimitOrder(book, incomingBid);

      expect(result.status).toBe('CANCELLED');
      expect(result.matchedQuantity).toBe(0);
      expect(result.remainingQuantity).toBe(5);
      expect(result.restedQuantity).toBe(0);
      expect(result.stoppedReason).toBe('SELF_TRADE_PREVENTION');
      expect(result.executions).toEqual([]);

      // Incoming order b1 must NOT rest in the book
      expect(book.getOrder('b1')).toBeNull();
      // Resting order a1 must remain untouched
      expect(book.getOrder('a1').order.remainingQuantity).toBe(5);
      expect(book.size()).toBe(1);
    });

    it('16 & 17. Self-trade prevention after valid executions preserves fills and cancels remainder without queue skipping', () => {
      // Bob's order is first, Alice's order is second, Charlie's order is third
      book.addOrder('ASK', { id: 'a-bob', price: 10000, remainingQuantity: 4, userId: 'user-bob' });
      book.addOrder('ASK', { id: 'a-alice', price: 10000, remainingQuantity: 6, userId: 'user-alice' });
      book.addOrder('ASK', { id: 'a-charlie', price: 10000, remainingQuantity: 8, userId: 'user-charlie' });

      // Alice submits BID for 10 units
      const incomingAlice = {
        id: 'b-alice',
        side: 'BID',
        price: 10000,
        remainingQuantity: 10,
        userId: 'user-alice',
      };

      const result = coordinator.submitLimitOrder(book, incomingAlice);

      // Fills Bob's 4 units, then hits Alice and stops
      expect(result.status).toBe('CANCELLED');
      expect(result.matchedQuantity).toBe(4);
      expect(result.remainingQuantity).toBe(6);
      expect(result.restedQuantity).toBe(0);
      expect(result.stoppedReason).toBe('SELF_TRADE_PREVENTION');
      expect(result.executions).toHaveLength(1);
      expect(result.executions[0].restingOrderId).toBe('a-bob');

      // Book checks:
      // a-bob is gone
      expect(book.getOrder('a-bob')).toBeNull();
      // a-alice remains untouched with 6 units
      expect(book.getOrder('a-alice').order.remainingQuantity).toBe(6);
      // a-charlie remains untouched with 8 units (was NOT skipped to)
      expect(book.getOrder('a-charlie').order.remainingQuantity).toBe(8);
      // b-alice remainder (6) was NOT added to the book
      expect(book.getOrder('b-alice')).toBeNull();

      expect(book.size()).toBe(2);
      expect(book.totalQuantity()).toBe(14);
    });
  });

  describe('24, 25, 26, 27: Plan Validation & Injected Strategy Safety', () => {
    it('27. Strategy is called with the expected book and incoming order', () => {
      let capturedArgs = null;
      const mockStrategy = {
        calculate: (b, o) => {
          capturedArgs = { book: b, order: o };
          return {
            executions: [],
            matchedQuantity: 0,
            remainingQuantity: 5,
            fullyFilled: false,
            wouldRest: true,
            stoppedReason: 'NO_MORE_LIQUIDITY',
          };
        },
      };

      const customCoordinator = new MatchingCoordinator({ strategy: mockStrategy });
      const order = { id: 'b1', side: 'BID', price: 10000, remainingQuantity: 5 };

      customCoordinator.submitLimitOrder(book, order);
      expect(capturedArgs).not.toBeNull();
      expect(capturedArgs.book).toBe(book);
      expect(capturedArgs.order).toBe(order);
    });

    it('24 & 26. Rejects malformed or inconsistent matching plan before any book mutation', () => {
      book.addOrder('ASK', { id: 'a1', price: 10000, remainingQuantity: 10 });
      const statsBefore = book.getStats();

      // Inconsistent quantities: matchedQuantity (5) + remaining (0) !== incoming (10)
      const badStrategy = {
        calculate: () => ({
          executions: [{ restingOrderId: 'a1', price: 10000, quantity: 5 }],
          matchedQuantity: 5,
          remainingQuantity: 0, // Should be 5
          fullyFilled: false,
          wouldRest: false,
          stoppedReason: 'NO_MORE_LIQUIDITY',
        }),
      };

      const faultyCoordinator = new MatchingCoordinator({ strategy: badStrategy });
      const incoming = { id: 'b1', side: 'BID', price: 10000, remainingQuantity: 10 };

      expect(() => faultyCoordinator.submitLimitOrder(book, incoming)).toThrow(
        /Plan validation failed/
      );

      // Book state must be 100% untouched
      expect(book.getStats()).toEqual(statsBefore);
      expect(book.getOrder('a1').order.remainingQuantity).toBe(10);
    });

    it('25. Rejects plan referencing nonexistent resting order before any book mutation', () => {
      book.addOrder('ASK', { id: 'a1', price: 10000, remainingQuantity: 10 });
      const statsBefore = book.getStats();

      const ghostStrategy = {
        calculate: () => ({
          executions: [{ restingOrderId: 'ghost-order', price: 10000, quantity: 5 }],
          matchedQuantity: 5,
          remainingQuantity: 5,
          fullyFilled: false,
          wouldRest: true,
          stoppedReason: 'NO_MORE_LIQUIDITY',
        }),
      };

      const faultyCoordinator = new MatchingCoordinator({ strategy: ghostStrategy });
      const incoming = { id: 'b1', side: 'BID', price: 10000, remainingQuantity: 10 };

      expect(() => faultyCoordinator.submitLimitOrder(book, incoming)).toThrow(
        /resting order "ghost-order" does not exist/
      );

      // Book state must be 100% untouched
      expect(book.getStats()).toEqual(statsBefore);
    });

    it('rejects plan with price exceeding incoming limit before any book mutation', () => {
      book.addOrder('ASK', { id: 'a1', price: 12000, remainingQuantity: 5 });
      const statsBefore = book.getStats();

      const limitViolatingStrategy = {
        calculate: () => ({
          executions: [{ restingOrderId: 'a1', price: 12000, quantity: 5 }],
          matchedQuantity: 5,
          remainingQuantity: 0,
          fullyFilled: true,
          wouldRest: false,
          stoppedReason: 'FILLED',
        }),
      };

      const faultyCoordinator = new MatchingCoordinator({ strategy: limitViolatingStrategy });
      // Incoming limit is 10000, execution proposed at 12000
      const incoming = { id: 'b1', side: 'BID', price: 10000, remainingQuantity: 5 };

      expect(() => faultyCoordinator.submitLimitOrder(book, incoming)).toThrow(
        /execution price exceeds incoming BID limit/
      );

      // Book state must be 100% untouched
      expect(book.getStats()).toEqual(statsBefore);
    });

    it('rejects plan when cumulative executions exceed resting order available quantity (Audit 1)', () => {
      // Resting order has 10 units
      book.addOrder('ASK', { id: 'a1', price: 10000, remainingQuantity: 10 });
      const statsBefore = book.getStats();

      // Proposed plan has two executions against a1: 6 and 5 units (total 11 > 10)
      const cumulativeExceedingStrategy = {
        calculate: () => ({
          executions: [
            { restingOrderId: 'a1', price: 10000, quantity: 6 },
            { restingOrderId: 'a1', price: 10000, quantity: 5 },
          ],
          matchedQuantity: 11,
          remainingQuantity: 0,
          fullyFilled: true,
          wouldRest: false,
          stoppedReason: 'FILLED',
        }),
      };

      const faultyCoordinator = new MatchingCoordinator({ strategy: cumulativeExceedingStrategy });
      const incoming = { id: 'b1', side: 'BID', price: 10000, remainingQuantity: 11 };

      expect(() => faultyCoordinator.submitLimitOrder(book, incoming)).toThrow(
        /execution quantity 5 exceeds available resting quantity 4/
      );

      // Book state must be 100% untouched
      expect(book.getStats()).toEqual(statsBefore);
      expect(book.getOrder('a1').order.remainingQuantity).toBe(10);
      expect(book.getBestAsk()).toBe(10000);
      expect(book.size()).toBe(1);
    });

    it('rejects plan with invalid, missing, or contradictory plan fields before mutation (Audit 1)', () => {
      book.addOrder('ASK', { id: 'a1', price: 10000, remainingQuantity: 10 });
      const statsBefore = book.getStats();

      // Missing stoppedReason
      const missingStoppedReason = {
        calculate: () => ({
          executions: [],
          matchedQuantity: 0,
          remainingQuantity: 5,
        }),
      };
      const c1 = new MatchingCoordinator({ strategy: missingStoppedReason });
      expect(() =>
        c1.submitLimitOrder(book, { id: 'b1', side: 'BID', price: 10000, remainingQuantity: 5 })
      ).toThrow(/stoppedReason must be a non-empty string/);
      expect(book.getStats()).toEqual(statsBefore);

      // Contradictory: FILLED but remainingQuantity > 0
      const contradictoryFilled = {
        calculate: () => ({
          executions: [{ restingOrderId: 'a1', price: 10000, quantity: 5 }],
          matchedQuantity: 5,
          remainingQuantity: 5,
          stoppedReason: 'FILLED',
        }),
      };
      const c2 = new MatchingCoordinator({ strategy: contradictoryFilled });
      expect(() =>
        c2.submitLimitOrder(book, { id: 'b2', side: 'BID', price: 10000, remainingQuantity: 10 })
      ).toThrow(/stoppedReason is FILLED but remainingQuantity is non-zero/);
      expect(book.getStats()).toEqual(statsBefore);

      // Contradictory: execution incomingOrderId mismatch
      const incomingIdMismatch = {
        calculate: () => ({
          executions: [
            { restingOrderId: 'a1', price: 10000, quantity: 5, incomingOrderId: 'different-id' },
          ],
          matchedQuantity: 5,
          remainingQuantity: 5,
          stoppedReason: 'NO_MORE_LIQUIDITY',
        }),
      };
      const c3 = new MatchingCoordinator({ strategy: incomingIdMismatch });
      expect(() =>
        c3.submitLimitOrder(book, { id: 'b3', side: 'BID', price: 10000, remainingQuantity: 10 })
      ).toThrow(/execution incomingOrderId "different-id" does not match/);
      expect(book.getStats()).toEqual(statsBefore);

      // Wrong side: execution references an order on the same side
      book.addOrder('BID', { id: 'b-resting', price: 9000, remainingQuantity: 5 });
      const statsWithBid = book.getStats();
      const sameSideStrategy = {
        calculate: () => ({
          executions: [{ restingOrderId: 'b-resting', price: 9000, quantity: 5 }],
          matchedQuantity: 5,
          remainingQuantity: 0,
          stoppedReason: 'FILLED',
        }),
      };
      const c4 = new MatchingCoordinator({ strategy: sameSideStrategy });
      expect(() =>
        c4.submitLimitOrder(book, { id: 'b4', side: 'BID', price: 10000, remainingQuantity: 5 })
      ).toThrow(/is on wrong side/);
      expect(book.getStats()).toEqual(statsWithBid);

      // Price mismatch: execution price does not equal resting order's price
      const priceMismatchStrategy = {
        calculate: () => ({
          executions: [{ restingOrderId: 'a1', price: 9999, quantity: 5 }],
          matchedQuantity: 5,
          remainingQuantity: 0,
          stoppedReason: 'FILLED',
        }),
      };
      const c5 = new MatchingCoordinator({ strategy: priceMismatchStrategy });
      expect(() =>
        c5.submitLimitOrder(book, { id: 'b5', side: 'BID', price: 10000, remainingQuantity: 5 })
      ).toThrow(/execution price 9999 does not match resting order price 10000/);
      expect(book.getStats()).toEqual(statsWithBid);
    });
  });

  describe('20, 21, 22, 23, 28: Book Invariants & Repeated Submissions', () => {
    it('28. Returned execution results do not expose mutable internal order objects (Audit 4)', () => {
      book.addOrder('ASK', { id: 'a1', price: 10000, remainingQuantity: 10 });
      const incoming = { id: 'b1', side: 'BID', price: 10000, remainingQuantity: 4 };

      const result = coordinator.submitLimitOrder(book, incoming);
      expect(result.executions).toHaveLength(1);

      // Mutate returned execution result
      result.executions[0].quantity = 99999;
      result.executions[0].price = 1;
      result.executions[0].restingOrderRemainingAfterExecution = 0;

      // Resting order in book must be completely unaffected
      const resting = book.getOrder('a1');
      expect(resting.order.remainingQuantity).toBe(6);
      expect(resting.order.price).toBe(10000);
    });

    it('20 & 21. Sequential submissions preserve price-time priority and update book statistics accurately', () => {
      // 1. Submit resting ASK
      coordinator.submitLimitOrder(book, { id: 'a1', side: 'ASK', price: 10000, remainingQuantity: 10 });
      // 2. Submit resting ASK at better price
      coordinator.submitLimitOrder(book, { id: 'a2', side: 'ASK', price: 9500, remainingQuantity: 5 });

      expect(book.getBestAsk()).toBe(9500);

      // 3. Submit incoming BID that matches a2 completely and a1 partially
      const res = coordinator.submitLimitOrder(book, {
        id: 'b1',
        side: 'BID',
        price: 10000,
        remainingQuantity: 7,
      });

      expect(res.status).toBe('FILLED');
      expect(res.matchedQuantity).toBe(7);
      expect(res.executions[0].restingOrderId).toBe('a2');
      expect(res.executions[0].quantity).toBe(5);
      expect(res.executions[1].restingOrderId).toBe('a1');
      expect(res.executions[1].quantity).toBe(2);

      // Remaining book state: only a1 with 8 units left at 10000
      expect(book.size()).toBe(1);
      expect(book.totalQuantity()).toBe(8);
      expect(book.getBestAsk()).toBe(10000);
      expect(book.getOrder('a2')).toBeNull();
      expect(book.getOrder('a1').order.remainingQuantity).toBe(8);
    });

    it('22 & 23. Conserves execution quantities across all outcomes', () => {
      book.addOrder('ASK', { id: 'a1', price: 10000, remainingQuantity: 20 });

      const incoming = { id: 'b1', side: 'BID', price: 10000, remainingQuantity: 25 };
      const res = coordinator.submitLimitOrder(book, incoming);

      expect(res.status).toBe('PARTIALLY_FILLED');
      expect(res.matchedQuantity + res.remainingQuantity).toBe(incoming.remainingQuantity);
      expect(res.restedQuantity).toBe(res.remainingQuantity);
    });
  });
});
