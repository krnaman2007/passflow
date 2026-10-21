import { OrderBook } from '../../src/services/matching/order-book.js';

describe('OrderBook Matching Engine Component', () => {
  const CONFIG = {
    eventId: 'event-coldplay-2026',
    ticketCategoryId: 'vip-lounge',
  };

  let book;

  beforeEach(() => {
    book = new OrderBook(CONFIG);
  });

  describe('1, 2, 3: Construction & Market Identity', () => {
    it('1. Constructor initializes correctly with event and ticket category IDs', () => {
      expect(book.eventId).toBe('event-coldplay-2026');
      expect(book.ticketCategoryId).toBe('vip-lounge');
      expect(book.size()).toBe(0);
      expect(book.totalQuantity()).toBe(0);
      expect(book.isEmpty()).toBe(true);
      expect(book.isSideEmpty('BID')).toBe(true);
      expect(book.isSideEmpty('ASK')).toBe(true);
    });

    it('2. Rejects missing, empty, whitespace, and non-string market identifiers', () => {
      expect(() => new OrderBook(null)).toThrow(TypeError);
      expect(() => new OrderBook(undefined)).toThrow(TypeError);
      expect(() => new OrderBook([])).toThrow(TypeError);
      expect(() => new OrderBook('config')).toThrow(TypeError);

      // Invalid eventId
      expect(() => new OrderBook({ eventId: 123, ticketCategoryId: 'cat-1' })).toThrow(TypeError);
      expect(() => new OrderBook({ eventId: '', ticketCategoryId: 'cat-1' })).toThrow(RangeError);
      expect(() => new OrderBook({ eventId: '   ', ticketCategoryId: 'cat-1' })).toThrow(RangeError);

      // Invalid ticketCategoryId
      expect(() => new OrderBook({ eventId: 'ev-1', ticketCategoryId: 123 })).toThrow(TypeError);
      expect(() => new OrderBook({ eventId: 'ev-1', ticketCategoryId: '' })).toThrow(RangeError);
      expect(() => new OrderBook({ eventId: 'ev-1', ticketCategoryId: '   ' })).toThrow(RangeError);
    });

    it('3. Market identifiers are immutable after construction', () => {
      expect(() => {
        book.eventId = 'tampered-event';
      }).toThrow();
      expect(() => {
        book.ticketCategoryId = 'tampered-cat';
      }).toThrow();
      expect(book.eventId).toBe('event-coldplay-2026');
      expect(book.ticketCategoryId).toBe('vip-lounge');
    });
  });

  describe('4 & 5: Initialization & Empty Book Behavior', () => {
    it('4 & 5. Empty book returns predictable null/empty results across all queries', () => {
      expect(book.getBestBid()).toBeNull();
      expect(book.getBestAsk()).toBeNull();
      expect(book.getBestBidLevel()).toBeNull();
      expect(book.getBestAskLevel()).toBeNull();
      expect(book.getSpread()).toBeNull();

      expect(book.getDepth()).toEqual({ bids: [], asks: [] });
      expect(book.getOrders('BID')).toEqual([]);
      expect(book.getOrders('ASK')).toEqual([]);

      expect(book.getOrder('any-id')).toBeNull();
      expect(book.cancelOrder('any-id')).toBeNull();
      expect(book.reduceOrderQuantity('any-id', 10)).toBeNull();

      expect(book.size()).toBe(0);
      expect(book.totalQuantity()).toBe(0);
      expect(book.isEmpty()).toBe(true);
    });
  });

  describe('6, 7, 8, 9: Adding Orders & Price Priorities', () => {
    it('6 & 7. Adds BID and ASK orders updating counters and levels independently', () => {
      const bidOrder = { id: 'b1', price: 10000, remainingQuantity: 5 };
      const askOrder = { id: 'a1', price: 12000, remainingQuantity: 3 };

      expect(book.addOrder('BID', bidOrder)).toBe(1);
      expect(book.size()).toBe(1);
      expect(book.totalQuantity()).toBe(5);
      expect(book.isSideEmpty('BID')).toBe(false);
      expect(book.isSideEmpty('ASK')).toBe(true);

      expect(book.addOrder('ASK', askOrder)).toBe(2);
      expect(book.size()).toBe(2);
      expect(book.totalQuantity()).toBe(8);
      expect(book.isSideEmpty('ASK')).toBe(false);
      expect(book.isEmpty()).toBe(false);
    });

    it('8 & 9. Maintains independent price priorities (BID highest, ASK lowest)', () => {
      // Add bids: 9000, 10500, 9500 -> Best bid is 10500
      book.addOrder('BID', { id: 'b-low', price: 9000, remainingQuantity: 1 });
      book.addOrder('BID', { id: 'b-high', price: 10500, remainingQuantity: 2 });
      book.addOrder('BID', { id: 'b-mid', price: 9500, remainingQuantity: 3 });

      // Add asks: 12000, 11000, 13000 -> Best ask is 11000
      book.addOrder('ASK', { id: 'a-mid', price: 12000, remainingQuantity: 4 });
      book.addOrder('ASK', { id: 'a-low', price: 11000, remainingQuantity: 5 });
      book.addOrder('ASK', { id: 'a-high', price: 13000, remainingQuantity: 6 });

      expect(book.getBestBid()).toBe(10500);
      expect(book.getBestAsk()).toBe(11000);

      expect(book.getBestBidLevel().price).toBe(10500);
      expect(book.getBestAskLevel().price).toBe(11000);

      // Verify BID orders sorted descending by price
      const bidOrders = book.getOrders('BID');
      expect(bidOrders.map((o) => o.price)).toEqual([10500, 9500, 9000]);

      // Verify ASK orders sorted ascending by price
      const askOrders = book.getOrders('ASK');
      expect(askOrders.map((o) => o.price)).toEqual([11000, 12000, 13000]);
    });
  });

  describe('10, 11, 12, 13: Spread Calculations & Crossing Orders', () => {
    it('10 & 12. Allows crossing and locked orders without auto-execution', () => {
      // BID at 15000, ASK at 14000 (Crossed book)
      book.addOrder('BID', { id: 'bid-cross', price: 15000, remainingQuantity: 2 });
      book.addOrder('ASK', { id: 'ask-cross', price: 14000, remainingQuantity: 2 });

      expect(book.getBestBid()).toBe(15000);
      expect(book.getBestAsk()).toBe(14000);
      // Spread: bestAsk - bestBid = 14000 - 15000 = -1000
      expect(book.getSpread()).toBe(-1000);
      expect(book.size()).toBe(2);

      // Locked book: BID at 15000, ASK at 15000
      const lockedBook = new OrderBook(CONFIG);
      lockedBook.addOrder('BID', { id: 'b-lock', price: 15000, remainingQuantity: 1 });
      lockedBook.addOrder('ASK', { id: 'a-lock', price: 15000, remainingQuantity: 1 });
      expect(lockedBook.getSpread()).toBe(0);
    });

    it('11. Returns correct positive spread when both sides are populated normally', () => {
      book.addOrder('BID', { id: 'b1', price: 10000, remainingQuantity: 2 });
      book.addOrder('ASK', { id: 'a1', price: 10500, remainingQuantity: 2 });

      expect(book.getSpread()).toBe(500); // 10500 - 10000
    });

    it('13. Spread returns null when either side is empty', () => {
      expect(book.getSpread()).toBeNull();

      book.addOrder('BID', { id: 'b1', price: 10000, remainingQuantity: 2 });
      expect(book.getSpread()).toBeNull();

      book.cancelOrder('b1');
      book.addOrder('ASK', { id: 'a1', price: 11000, remainingQuantity: 2 });
      expect(book.getSpread()).toBeNull();
    });
  });

  describe('14, 15, 16, 17: Market Depth, Order Lookup & Stats', () => {
    it('14. Returns detached depth snapshots with correct sorting on both sides', () => {
      book.addOrder('BID', { id: 'b1', price: 10000, remainingQuantity: 5 });
      book.addOrder('BID', { id: 'b2', price: 10000, remainingQuantity: 10 });
      book.addOrder('BID', { id: 'b3', price: 11000, remainingQuantity: 20 });

      book.addOrder('ASK', { id: 'a1', price: 12000, remainingQuantity: 8 });
      book.addOrder('ASK', { id: 'a2', price: 13000, remainingQuantity: 12 });

      const depth = book.getDepth();
      expect(depth.bids).toEqual([
        { price: 11000, orderCount: 1, totalQuantity: 20 },
        { price: 10000, orderCount: 2, totalQuantity: 15 },
      ]);
      expect(depth.asks).toEqual([
        { price: 12000, orderCount: 1, totalQuantity: 8 },
        { price: 13000, orderCount: 1, totalQuantity: 12 },
      ]);

      // Snapshot immutability
      depth.bids[0].price = 99999;
      expect(book.getBestBid()).toBe(11000);
    });

    it('15. Looks up resting order with its side information in O(1)', () => {
      const bidOrder = { id: 'b-lookup', price: 10000, remainingQuantity: 5 };
      const askOrder = { id: 'a-lookup', price: 12000, remainingQuantity: 3 };

      book.addOrder('BID', bidOrder);
      book.addOrder('ASK', askOrder);

      const foundBid = book.getOrder('b-lookup');
      expect(foundBid).toEqual({
        order: bidOrder,
        side: 'BID',
      });

      const foundAsk = book.getOrder('a-lookup');
      expect(foundAsk).toEqual({
        order: askOrder,
        side: 'ASK',
      });

      expect(book.getOrder('nonexistent')).toBeNull();
      expect(() => book.getOrder(null)).toThrow(TypeError);
      expect(() => book.getOrder('')).toThrow(RangeError);
    });

    it('16. getOrders validates side and returns orders in price-time priority', () => {
      const o1 = { id: 'b1', price: 10000, remainingQuantity: 5 };
      const o2 = { id: 'b2', price: 10000, remainingQuantity: 10 };
      book.addOrder('BID', o1);
      book.addOrder('BID', o2);

      expect(book.getOrders('BID')).toEqual([o1, o2]);
      expect(() => book.getOrders('INVALID')).toThrow(RangeError);
    });

    it('17. Returns side stats and comprehensive book stats', () => {
      book.addOrder('BID', { id: 'b1', price: 10000, remainingQuantity: 5 });
      book.addOrder('ASK', { id: 'a1', price: 12000, remainingQuantity: 8 });

      const bidStats = book.getSideStats('BID');
      expect(bidStats).toEqual({
        side: 'BID',
        orderCount: 1,
        totalQuantity: 5,
        levelCount: 1,
      });

      const totalStats = book.getStats();
      expect(totalStats).toEqual({
        eventId: 'event-coldplay-2026',
        ticketCategoryId: 'vip-lounge',
        orderCount: 2,
        totalQuantity: 13,
        bids: {
          orderCount: 1,
          totalQuantity: 5,
          levelCount: 1,
          bestPrice: 10000,
        },
        asks: {
          orderCount: 1,
          totalQuantity: 8,
          levelCount: 1,
          bestPrice: 12000,
        },
        spread: 2000,
      });
    });
  });

  describe('18, 19, 20: Order Cancellation', () => {
    it('18 & 19. Cancels BID and ASK orders seamlessly, cleaning up ID indexes', () => {
      const b1 = { id: 'b1', price: 10000, remainingQuantity: 10 };
      const a1 = { id: 'a1', price: 12000, remainingQuantity: 20 };

      book.addOrder('BID', b1);
      book.addOrder('ASK', a1);

      const cancelBid = book.cancelOrder('b1');
      expect(cancelBid).toEqual({
        order: b1,
        side: 'BID',
      });
      expect(book.getOrder('b1')).toBeNull();
      expect(book.size()).toBe(1);
      expect(book.totalQuantity()).toBe(20);
      expect(book.isSideEmpty('BID')).toBe(true);

      const cancelAsk = book.cancelOrder('a1');
      expect(cancelAsk).toEqual({
        order: a1,
        side: 'ASK',
      });
      expect(book.getOrder('a1')).toBeNull();
      expect(book.isEmpty()).toBe(true);
    });

    it('20. Cancelling nonexistent order returns null and validates orderId', () => {
      expect(book.cancelOrder('nonexistent')).toBeNull();
      expect(() => book.cancelOrder(123)).toThrow(TypeError);
      expect(() => book.cancelOrder('')).toThrow(RangeError);
      expect(() => book.cancelOrder('   ')).toThrow(RangeError);
    });
  });

  describe('21 & 22: Quantity Reduction (Partial & Full Fills)', () => {
    it('21. Partially reduces order quantity without changing side or position', () => {
      const order = { id: 'bid-p', price: 10000, remainingQuantity: 50 };
      book.addOrder('BID', order);

      const res = book.reduceOrderQuantity('bid-p', 20);
      expect(res).toEqual({
        order,
        fullyFilled: false,
        remainingQuantity: 30,
        side: 'BID',
      });

      expect(order.remainingQuantity).toBe(30);
      expect(book.totalQuantity()).toBe(30);
      expect(book.size()).toBe(1);
      expect(book.getOrder('bid-p').order.remainingQuantity).toBe(30);
    });

    it('22. Completely fills order, evicting it from side and book index', () => {
      const o1 = { id: 'ask-f', price: 12000, remainingQuantity: 25 };
      book.addOrder('ASK', o1);

      const res = book.reduceOrderQuantity('ask-f', 25);
      expect(res).toEqual({
        order: o1,
        fullyFilled: true,
        remainingQuantity: 0,
        side: 'ASK',
      });

      expect(book.size()).toBe(0);
      expect(book.totalQuantity()).toBe(0);
      expect(book.getOrder('ask-f')).toBeNull();
    });

    it('reduceOrderQuantity validates arguments and returns null if not found', () => {
      expect(book.reduceOrderQuantity('unknown', 10)).toBeNull();
      expect(() => book.reduceOrderQuantity(null, 10)).toThrow(TypeError);
      expect(() => book.reduceOrderQuantity('', 10)).toThrow(RangeError);
      expect(() => book.reduceOrderQuantity('id', 0)).toThrow(RangeError);
      expect(() => book.reduceOrderQuantity('id', -5)).toThrow(RangeError);
      expect(() => book.reduceOrderQuantity('id', 1.5)).toThrow(TypeError);
    });
  });

  describe('23, 24, 25: Cross-Side Duplicate Prevention & Market Isolation', () => {
    it('23. Rejects duplicate order IDs across both sides of the same OrderBook', () => {
      book.addOrder('BID', { id: 'shared-id', price: 10000, remainingQuantity: 5 });

      // Attempting to add an ASK with the same ID must throw
      expect(() =>
        book.addOrder('ASK', { id: 'shared-id', price: 12000, remainingQuantity: 5 })
      ).toThrow(Error);

      expect(book.size()).toBe(1);
      expect(book.isSideEmpty('ASK')).toBe(true);
    });

    it('24. Re-enables order ID after cancellation or complete fill', () => {
      book.addOrder('BID', { id: 'reuse-id', price: 10000, remainingQuantity: 5 });
      book.cancelOrder('reuse-id');

      // Can now add reuse-id to ASK side
      expect(() =>
        book.addOrder('ASK', { id: 'reuse-id', price: 11000, remainingQuantity: 8 })
      ).not.toThrow();

      expect(book.size()).toBe(1);
      expect(book.getOrder('reuse-id').side).toBe('ASK');
    });

    it('25. Allows identical order IDs across separate OrderBook instances (market isolation)', () => {
      const book2 = new OrderBook({
        eventId: 'event-other',
        ticketCategoryId: 'general-admission',
      });

      book.addOrder('BID', { id: 'same-id', price: 10000, remainingQuantity: 5 });
      expect(() =>
        book2.addOrder('BID', { id: 'same-id', price: 5000, remainingQuantity: 10 })
      ).not.toThrow();

      expect(book.size()).toBe(1);
      expect(book2.size()).toBe(1);
      expect(book.getOrder('same-id').order.price).toBe(10000);
      expect(book2.getOrder('same-id').order.price).toBe(5000);
    });
  });

  describe('26, 27, 28: Input Validation, Overflow & Empty Lifecycle', () => {
    it('26. Rejects invalid sides and malformed orders without state corruption', () => {
      expect(() => book.addOrder('INVALID', { id: '1', price: 10000, remainingQuantity: 5 })).toThrow(RangeError);
      expect(() => book.addOrder(null, { id: '1', price: 10000, remainingQuantity: 5 })).toThrow(TypeError);
      expect(() => book.addOrder('BID', null)).toThrow(TypeError);
      expect(() => book.addOrder('BID', { id: '', price: 10000, remainingQuantity: 5 })).toThrow(RangeError);
      expect(() => book.addOrder('BID', { id: '1', price: -5, remainingQuantity: 5 })).toThrow(RangeError);

      expect(book.size()).toBe(0);
      expect(book.isEmpty()).toBe(true);
    });

    it('27. Rejects additions that cause aggregate quantity overflow', () => {
      book.addOrder('BID', {
        id: 'huge-1',
        price: 10000,
        remainingQuantity: Number.MAX_SAFE_INTEGER - 10,
      });

      expect(() =>
        book.addOrder('ASK', { id: 'huge-2', price: 12000, remainingQuantity: 20 })
      ).toThrow(RangeError);

      expect(book.size()).toBe(1);
      expect(book.totalQuantity()).toBe(Number.MAX_SAFE_INTEGER - 10);
    });

    it('28. Correctly returns to empty state and supports lifecycle re-population', () => {
      book.addOrder('BID', { id: 'b1', price: 10000, remainingQuantity: 10 });
      book.addOrder('ASK', { id: 'a1', price: 12000, remainingQuantity: 10 });

      book.cancelOrder('b1');
      book.cancelOrder('a1');

      expect(book.isEmpty()).toBe(true);
      expect(book.getSpread()).toBeNull();
      expect(book.getDepth()).toEqual({ bids: [], asks: [] });

      // Re-populate
      book.addOrder('BID', { id: 'b-new', price: 10500, remainingQuantity: 4 });
      expect(book.size()).toBe(1);
      expect(book.getBestBid()).toBe(10500);
    });
  });

  describe('29 & 30: Stress Testing and Invariant Integrity', () => {
    it('29 & 30. Deterministic stress test across both sides verifies all 11 invariants', () => {
      const N = 300;
      const prices = [1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000];

      // 1. Add N alternating BID and ASK orders
      for (let i = 0; i < N; i++) {
        const side = i % 2 === 0 ? 'BID' : 'ASK';
        const price = prices[i % prices.length];
        const qty = (i % 15) + 1;
        book.addOrder(side, {
          id: `stress-${i}`,
          price,
          remainingQuantity: qty,
        });
        expect(bookInvariant(book)).toBe(true);
      }

      expect(book.size()).toBe(N);

      // 2. Partially fill 60 orders
      for (let i = 0; i < 60; i++) {
        const orderId = `stress-${i * 3}`;
        const lookup = book.getOrder(orderId);
        if (lookup && lookup.order.remainingQuantity > 1) {
          book.reduceOrderQuantity(orderId, 1);
          expect(bookInvariant(book)).toBe(true);
        }
      }

      // 3. Cancel 60 orders
      for (let i = 60; i < 120; i++) {
        const orderId = `stress-${i}`;
        book.cancelOrder(orderId);
        expect(bookInvariant(book)).toBe(true);
      }

      // 4. Fully fill 60 orders
      for (let i = 120; i < 180; i++) {
        const orderId = `stress-${i}`;
        const lookup = book.getOrder(orderId);
        if (lookup) {
          book.reduceOrderQuantity(orderId, lookup.order.remainingQuantity);
          expect(bookInvariant(book)).toBe(true);
        }
      }

      // 5. Drain all remaining orders via cancellation
      const remainingBids = book.getOrders('BID');
      for (const ord of remainingBids) {
        book.cancelOrder(ord.id);
        expect(bookInvariant(book)).toBe(true);
      }

      const remainingAsks = book.getOrders('ASK');
      for (const ord of remainingAsks) {
        book.cancelOrder(ord.id);
        expect(bookInvariant(book)).toBe(true);
      }

      expect(book.size()).toBe(0);
      expect(book.totalQuantity()).toBe(0);
      expect(book.isEmpty()).toBe(true);
      expect(book.getSpread()).toBeNull();
    });
  });
});

/**
 * Helper verifying all 11 aggregate invariants from Section 8.
 *
 * @param {OrderBook} book
 * @returns {boolean}
 */
function bookInvariant(book) {
  const bidOrders = book.getOrders('BID');
  const askOrders = book.getOrders('ASK');
  const depth = book.getDepth();
  const stats = book.getStats();

  // 1 & 2. Statistics equal sum of orders on each side
  const bidSum = bidOrders.reduce((sum, o) => sum + o.remainingQuantity, 0);
  const askSum = askOrders.reduce((sum, o) => sum + o.remainingQuantity, 0);
  if (stats.bids.totalQuantity !== bidSum) return false;
  if (stats.asks.totalQuantity !== askSum) return false;

  // 3 & 4. Total count and total quantity
  if (book.size() !== bidOrders.length + askOrders.length) return false;
  if (book.totalQuantity() !== bidSum + askSum) return false;

  // 5. Each order ID exists in getOrder and has correct side
  for (const o of bidOrders) {
    const found = book.getOrder(o.id);
    if (!found || found.side !== 'BID') return false;
  }
  for (const o of askOrders) {
    const found = book.getOrder(o.id);
    if (!found || found.side !== 'ASK') return false;
  }

  // 6. No empty levels in depth
  for (const d of depth.bids) {
    if (d.orderCount <= 0 || d.totalQuantity <= 0) return false;
  }
  for (const d of depth.asks) {
    if (d.orderCount <= 0 || d.totalQuantity <= 0) return false;
  }

  // 7 & 8. Spread calculation
  const bestBid = book.getBestBid();
  const bestAsk = book.getBestAsk();
  if (bestBid !== null && bestAsk !== null) {
    if (book.getSpread() !== bestAsk - bestBid) return false;
  } else {
    if (book.getSpread() !== null) return false;
  }

  // 9. Empty state agreements
  if (book.isEmpty() !== (book.size() === 0)) return false;
  if (book.isSideEmpty('BID') !== (bidOrders.length === 0)) return false;
  if (book.isSideEmpty('ASK') !== (askOrders.length === 0)) return false;

  return true;
}
