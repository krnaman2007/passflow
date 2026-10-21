import { OrderBookSide } from '../../src/services/matching/order-book-side.js';

describe('OrderBookSide Matching Engine Component', () => {
  describe('1 & 2: Constructor & Side Validation', () => {
    it('1. Initializes valid BID and ASK instances with immutable side', () => {
      const bidSide = new OrderBookSide('BID');
      expect(bidSide.side).toBe('BID');
      expect(bidSide.size()).toBe(0);
      expect(bidSide.levelCount()).toBe(0);
      expect(bidSide.totalQuantity()).toBe(0);
      expect(bidSide.isEmpty()).toBe(true);

      const askSide = new OrderBookSide('ASK');
      expect(askSide.side).toBe('ASK');
      expect(askSide.size()).toBe(0);
      expect(askSide.levelCount()).toBe(0);
      expect(askSide.totalQuantity()).toBe(0);
      expect(askSide.isEmpty()).toBe(true);

      // Immutability
      expect(() => {
        bidSide.side = 'ASK';
      }).toThrow();
      expect(bidSide.side).toBe('BID');
    });

    it('2. Rejects invalid constructor arguments with clear errors', () => {
      expect(() => new OrderBookSide(null)).toThrow(TypeError);
      expect(() => new OrderBookSide(undefined)).toThrow(TypeError);
      expect(() => new OrderBookSide(123)).toThrow(TypeError);
      expect(() => new OrderBookSide('bid')).toThrow(RangeError);
      expect(() => new OrderBookSide('ask')).toThrow(RangeError);
      expect(() => new OrderBookSide('BUY')).toThrow(RangeError);
      expect(() => new OrderBookSide('SELL')).toThrow(RangeError);
      expect(() => new OrderBookSide('')).toThrow(RangeError);
    });
  });

  describe('3: Empty Side Behavior', () => {
    it('3. Returns predictable results on an empty side for all methods', () => {
      const side = new OrderBookSide('BID');

      expect(side.getBestPrice()).toBeNull();
      expect(side.getBestLevel()).toBeNull();
      expect(side.getLevel(5000)).toBeNull();
      expect(side.removeBestOrder()).toBeNull();
      expect(side.cancelOrder('ord-1')).toBeNull();
      expect(side.reduceOrderQuantity('ord-1', 10)).toBeNull();
      expect(side.totalQuantity()).toBe(0);
      expect(side.size()).toBe(0);
      expect(side.levelCount()).toBe(0);
      expect(side.isEmpty()).toBe(true);
      expect(side.getDepth()).toEqual([]);
      expect(side.getOrders()).toEqual([]);
      expect([...side]).toEqual([]);
    });
  });

  describe('4, 5, 6: Adding Orders & Price Levels', () => {
    it('4. Adding orders creates a new PriceLevel and updates counters', () => {
      const side = new OrderBookSide('BID');
      const order = { id: 'ord-1', price: 10000, remainingQuantity: 5 };

      const count = side.addOrder(order);
      expect(count).toBe(1);
      expect(side.size()).toBe(1);
      expect(side.levelCount()).toBe(1);
      expect(side.totalQuantity()).toBe(5);
      expect(side.isEmpty()).toBe(false);

      const level = side.getLevel(10000);
      expect(level).not.toBeNull();
      expect(level.price).toBe(10000);
      expect(level.size()).toBe(1);
    });

    it('5. Adding multiple orders at the same price groups them in the same PriceLevel', () => {
      const side = new OrderBookSide('BID');
      const o1 = { id: 'ord-1', price: 10000, remainingQuantity: 5 };
      const o2 = { id: 'ord-2', price: 10000, remainingQuantity: 10 };

      side.addOrder(o1);
      side.addOrder(o2);

      expect(side.size()).toBe(2);
      expect(side.levelCount()).toBe(1);
      expect(side.totalQuantity()).toBe(15);

      const level = side.getLevel(10000);
      expect(level.size()).toBe(2);
      expect(level.totalQuantity()).toBe(15);
    });

    it('6. Adding orders at different prices creates separate PriceLevels', () => {
      const side = new OrderBookSide('BID');
      side.addOrder({ id: '1', price: 10000, remainingQuantity: 5 });
      side.addOrder({ id: '2', price: 10500, remainingQuantity: 10 });
      side.addOrder({ id: '3', price: 9500, remainingQuantity: 15 });

      expect(side.size()).toBe(3);
      expect(side.levelCount()).toBe(3);
      expect(side.totalQuantity()).toBe(30);
    });
  });

  describe('7, 8: Price Priority (BID vs ASK)', () => {
    it('7. BID prioritizes higher prices first (descending)', () => {
      const bid = new OrderBookSide('BID');
      bid.addOrder({ id: 'mid', price: 10000, remainingQuantity: 2 });
      bid.addOrder({ id: 'high', price: 12000, remainingQuantity: 3 });
      bid.addOrder({ id: 'low', price: 8000, remainingQuantity: 4 });

      expect(bid.getBestPrice()).toBe(12000);
      expect(bid.getBestLevel().price).toBe(12000);

      const depth = bid.getDepth();
      expect(depth.map((d) => d.price)).toEqual([12000, 10000, 8000]);
    });

    it('8. ASK prioritizes lower prices first (ascending)', () => {
      const ask = new OrderBookSide('ASK');
      ask.addOrder({ id: 'mid', price: 10000, remainingQuantity: 2 });
      ask.addOrder({ id: 'high', price: 12000, remainingQuantity: 3 });
      ask.addOrder({ id: 'low', price: 8000, remainingQuantity: 4 });

      expect(ask.getBestPrice()).toBe(8000);
      expect(ask.getBestLevel().price).toBe(8000);

      const depth = ask.getDepth();
      expect(depth.map((d) => d.price)).toEqual([8000, 10000, 12000]);
    });
  });

  describe('9, 10: Time Priority (FIFO) & Dynamic Best Price', () => {
    it('9. Preserves FIFO priority within each price level', () => {
      const bid = new OrderBookSide('BID');
      const o1 = { id: 'first', price: 10000, remainingQuantity: 5 };
      const o2 = { id: 'second', price: 10000, remainingQuantity: 10 };

      bid.addOrder(o1);
      bid.addOrder(o2);

      const orders = bid.getOrders();
      expect(orders).toEqual([o1, o2]);
    });

    it('10. Dynamically updates best price after each addition', () => {
      const bid = new OrderBookSide('BID');
      expect(bid.getBestPrice()).toBeNull();

      bid.addOrder({ id: '1', price: 10000, remainingQuantity: 1 });
      expect(bid.getBestPrice()).toBe(10000);

      // Better bid arrives
      bid.addOrder({ id: '2', price: 10500, remainingQuantity: 1 });
      expect(bid.getBestPrice()).toBe(10500);

      // Worse bid arrives (does not displace best)
      bid.addOrder({ id: '3', price: 9500, remainingQuantity: 1 });
      expect(bid.getBestPrice()).toBe(10500);

      // Same price arrives (does not displace best)
      bid.addOrder({ id: '4', price: 10500, remainingQuantity: 1 });
      expect(bid.getBestPrice()).toBe(10500);
    });
  });

  describe('11: getBestLevel() and getLevel()', () => {
    it('11. Returns correct PriceLevel instances and validates input', () => {
      const ask = new OrderBookSide('ASK');
      const o1 = { id: '1', price: 5000, remainingQuantity: 10 };
      ask.addOrder(o1);

      expect(ask.getBestLevel().price).toBe(5000);
      expect(ask.getLevel(5000).price).toBe(5000);
      expect(ask.getLevel(6000)).toBeNull();

      // Price validation for getLevel
      expect(() => ask.getLevel('5000')).toThrow(TypeError);
      expect(() => ask.getLevel(0)).toThrow(RangeError);
      expect(() => ask.getLevel(-5000)).toThrow(RangeError);
      expect(() => ask.getLevel(1.5)).toThrow(TypeError);
    });

    it('provides getOrder and hasOrder lookups by orderId', () => {
      const bid = new OrderBookSide('BID');
      const order = { id: 'ord-find', price: 10000, remainingQuantity: 5 };
      bid.addOrder(order);

      expect(bid.hasOrder('ord-find')).toBe(true);
      expect(bid.getOrder('ord-find')).toBe(order);
      expect(bid.hasOrder('unknown')).toBe(false);
      expect(bid.getOrder('unknown')).toBeNull();
      expect(bid.getOrder(null)).toBeNull();
      expect(bid.hasOrder('')).toBe(false);
    });
  });

  describe('12, 13: Order Cancellation', () => {
    it('12. Cancels orders at best, middle, and worst prices, evicting empty levels', () => {
      const bid = new OrderBookSide('BID');
      bid.addOrder({ id: 'b1', price: 12000, remainingQuantity: 10 }); // Best
      bid.addOrder({ id: 'm1', price: 10000, remainingQuantity: 20 }); // Mid
      bid.addOrder({ id: 'm2', price: 10000, remainingQuantity: 5 }); // Mid 2
      bid.addOrder({ id: 'w1', price: 8000, remainingQuantity: 30 }); // Worst

      expect(bid.size()).toBe(4);
      expect(bid.levelCount()).toBe(3);
      expect(bid.totalQuantity()).toBe(65);

      // Cancel middle order m1 (level 10000 remains with m2)
      const cMid = bid.cancelOrder('m1');
      expect(cMid.id).toBe('m1');
      expect(bid.size()).toBe(3);
      expect(bid.levelCount()).toBe(3);
      expect(bid.totalQuantity()).toBe(45);
      expect(bid.getLevel(10000).size()).toBe(1);

      // Cancel best order b1 (evicts level 12000, best becomes 10000)
      const cBest = bid.cancelOrder('b1');
      expect(cBest.id).toBe('b1');
      expect(bid.size()).toBe(2);
      expect(bid.levelCount()).toBe(2);
      expect(bid.totalQuantity()).toBe(35);
      expect(bid.getBestPrice()).toBe(10000);
      expect(bid.getLevel(12000)).toBeNull();

      // Cancel worst order w1 (evicts level 8000)
      const cWorst = bid.cancelOrder('w1');
      expect(cWorst.id).toBe('w1');
      expect(bid.size()).toBe(1);
      expect(bid.levelCount()).toBe(1);
      expect(bid.totalQuantity()).toBe(5);
      expect(bid.getBestPrice()).toBe(10000);

      // Cancel final order m2 (evicts level 10000, side is now empty)
      const cFinal = bid.cancelOrder('m2');
      expect(cFinal.id).toBe('m2');
      expect(bid.isEmpty()).toBe(true);
      expect(bid.levelCount()).toBe(0);
      expect(bid.totalQuantity()).toBe(0);
      expect(bid.getBestPrice()).toBeNull();
    });

    it('13. Cancelling a nonexistent order returns null and validates orderId', () => {
      const ask = new OrderBookSide('ASK');
      ask.addOrder({ id: '1', price: 5000, remainingQuantity: 10 });

      expect(ask.cancelOrder('unknown')).toBeNull();
      expect(ask.size()).toBe(1);
      expect(ask.totalQuantity()).toBe(10);

      expect(() => ask.cancelOrder(123)).toThrow(TypeError);
      expect(() => ask.cancelOrder('')).toThrow(RangeError);
      expect(() => ask.cancelOrder('   ')).toThrow(RangeError);
    });
  });

  describe('14, 15: Quantity Reduction (Partial & Full Fills)', () => {
    it('14. Partial fill updates both side and level aggregate quantities and preserves position', () => {
      const bid = new OrderBookSide('BID');
      const o1 = { id: 'ord-1', price: 10000, remainingQuantity: 20 };
      const o2 = { id: 'ord-2', price: 10000, remainingQuantity: 30 };
      bid.addOrder(o1);
      bid.addOrder(o2);

      const fillResult = bid.reduceOrderQuantity('ord-1', 8);
      expect(fillResult).toEqual({
        order: o1,
        fullyFilled: false,
        remainingQuantity: 12,
      });

      expect(sideInvariant(bid)).toBe(true);
      expect(bid.totalQuantity()).toBe(42);
      expect(bid.size()).toBe(2);
      expect(bid.getLevel(10000).totalQuantity()).toBe(42);

      // Verify FIFO position preserved
      expect(bid.getOrders()[0]).toBe(o1);
    });

    it('15. Full fill removes the order, cleans index, and removes level if empty', () => {
      const ask = new OrderBookSide('ASK');
      const o1 = { id: 'ord-1', price: 5000, remainingQuantity: 10 };
      const o2 = { id: 'ord-2', price: 6000, remainingQuantity: 20 };
      ask.addOrder(o1);
      ask.addOrder(o2);

      const fillResult = ask.reduceOrderQuantity('ord-1', 10);
      expect(fillResult).toEqual({
        order: o1,
        fullyFilled: true,
        remainingQuantity: 0,
      });

      expect(ask.size()).toBe(1);
      expect(ask.levelCount()).toBe(1);
      expect(ask.totalQuantity()).toBe(20);
      expect(ask.getBestPrice()).toBe(6000);
      expect(ask.getLevel(5000)).toBeNull();

      // ord-1 ID can now be re-added as a new order without duplicate error
      expect(() =>
        ask.addOrder({ id: 'ord-1', price: 6000, remainingQuantity: 15 })
      ).not.toThrow();
    });

    it('reduceOrderQuantity validates arguments and returns null if not found', () => {
      const bid = new OrderBookSide('BID');
      bid.addOrder({ id: '1', price: 10000, remainingQuantity: 10 });

      expect(bid.reduceOrderQuantity('nonexistent', 5)).toBeNull();
      expect(() => bid.reduceOrderQuantity(null, 5)).toThrow(TypeError);
      expect(() => bid.reduceOrderQuantity('', 5)).toThrow(RangeError);
      expect(() => bid.reduceOrderQuantity('1', '5')).toThrow(TypeError);
      expect(() => bid.reduceOrderQuantity('1', 0)).toThrow(RangeError);
      expect(() => bid.reduceOrderQuantity('1', -2)).toThrow(RangeError);
      expect(() => bid.reduceOrderQuantity('1', 20)).toThrow(RangeError); // Over-reduction
    });
  });

  describe('16, 17, 18: removeBestOrder & Dynamic Eviction', () => {
    it('16. removeBestOrder removes the oldest order at the best price', () => {
      const bid = new OrderBookSide('BID');
      const o1 = { id: 'b1-first', price: 10000, remainingQuantity: 10 };
      const o2 = { id: 'b1-second', price: 10000, remainingQuantity: 20 };
      const o3 = { id: 'b2', price: 9000, remainingQuantity: 30 };

      bid.addOrder(o1);
      bid.addOrder(o2);
      bid.addOrder(o3);

      const removed = bid.removeBestOrder();
      expect(removed).toBe(o1);
      expect(bid.size()).toBe(2);
      expect(bid.totalQuantity()).toBe(50);
      expect(bid.getBestPrice()).toBe(10000);
      expect(bid.getBestLevel().peek()).toBe(o2);
    });

    it('17 & 18. removeBestOrder evicts level when last order removed and shifts best price', () => {
      const ask = new OrderBookSide('ASK');
      const o1 = { id: 'a1', price: 5000, remainingQuantity: 10 };
      const o2 = { id: 'a2', price: 6000, remainingQuantity: 20 };

      ask.addOrder(o1);
      ask.addOrder(o2);

      expect(ask.getBestPrice()).toBe(5000);
      expect(ask.levelCount()).toBe(2);

      // Removing best order o1 empties level 5000
      const removed = ask.removeBestOrder();
      expect(removed).toBe(o1);
      expect(ask.size()).toBe(1);
      expect(ask.levelCount()).toBe(1);
      expect(ask.getBestPrice()).toBe(6000);
      expect(ask.getLevel(5000)).toBeNull();

      // Removing o2 empties the entire side
      const removedFinal = ask.removeBestOrder();
      expect(removedFinal).toBe(o2);
      expect(ask.isEmpty()).toBe(true);
      expect(ask.levelCount()).toBe(0);
      expect(ask.getBestPrice()).toBeNull();
      expect(ask.removeBestOrder()).toBeNull();
    });
  });

  describe('19, 20, 21: Validation, Duplicate IDs & Overflow', () => {
    it('19. Rejects duplicate order IDs even across different price levels', () => {
      const bid = new OrderBookSide('BID');
      bid.addOrder({ id: 'dup-id', price: 10000, remainingQuantity: 5 });

      expect(() =>
        bid.addOrder({ id: 'dup-id', price: 11000, remainingQuantity: 10 })
      ).toThrow(Error);

      expect(bid.size()).toBe(1);
      expect(bid.levelCount()).toBe(1);
      expect(bid.totalQuantity()).toBe(5);
    });

    it('20. Rejects invalid order contracts without corrupting state', () => {
      const bid = new OrderBookSide('BID');
      bid.addOrder({ id: 'valid-1', price: 10000, remainingQuantity: 10 });

      expect(() => bid.addOrder(null)).toThrow(TypeError);
      expect(() => bid.addOrder({ id: '', price: 10000, remainingQuantity: 5 })).toThrow(RangeError);
      expect(() => bid.addOrder({ id: '2', price: -100, remainingQuantity: 5 })).toThrow(RangeError);
      expect(() => bid.addOrder({ id: '2', price: 10000, remainingQuantity: 0 })).toThrow(RangeError);
      expect(() => bid.addOrder({ id: '2', price: 10000, quantity: 5 })).toThrow(TypeError); // missing remainingQuantity

      expect(bid.size()).toBe(1);
      expect(bid.totalQuantity()).toBe(10);
    });

    it('21. Rejects additions that would cause aggregate quantity overflow', () => {
      const ask = new OrderBookSide('ASK');
      ask.addOrder({
        id: 'huge-1',
        price: 5000,
        remainingQuantity: Number.MAX_SAFE_INTEGER - 10,
      });

      expect(() =>
        ask.addOrder({ id: 'huge-2', price: 5000, remainingQuantity: 20 })
      ).toThrow(RangeError);

      expect(() =>
        ask.addOrder({ id: 'huge-3', price: 6000, remainingQuantity: 20 })
      ).toThrow(RangeError);

      expect(ask.size()).toBe(1);
      expect(ask.totalQuantity()).toBe(Number.MAX_SAFE_INTEGER - 10);
    });
  });

  describe('22, 23, 24: getDepth, getOrders, and Iteration', () => {
    it('22. getDepth produces correct ordered snapshots of levels', () => {
      const bid = new OrderBookSide('BID');
      bid.addOrder({ id: '1', price: 10000, remainingQuantity: 5 });
      bid.addOrder({ id: '2', price: 10000, remainingQuantity: 15 });
      bid.addOrder({ id: '3', price: 12000, remainingQuantity: 20 });
      bid.addOrder({ id: '4', price: 9000, remainingQuantity: 10 });

      const depth = bid.getDepth();
      expect(depth).toEqual([
        { price: 12000, orderCount: 1, totalQuantity: 20 },
        { price: 10000, orderCount: 2, totalQuantity: 20 },
        { price: 9000, orderCount: 1, totalQuantity: 10 },
      ]);

      // Snapshot integrity: mutating snapshot object does not affect internal state
      depth[0].totalQuantity = 999999;
      expect(bid.getLevel(12000).totalQuantity()).toBe(20);
    });

    it('23. getOrders and iterator yield orders in strict price-time priority', () => {
      const ask = new OrderBookSide('ASK');
      const o1 = { id: 'low-1', price: 5000, remainingQuantity: 5 };
      const o2 = { id: 'low-2', price: 5000, remainingQuantity: 10 };
      const o3 = { id: 'mid-1', price: 6000, remainingQuantity: 20 };
      const o4 = { id: 'high-1', price: 7000, remainingQuantity: 30 };

      // Add out of order
      ask.addOrder(o3);
      ask.addOrder(o1);
      ask.addOrder(o4);
      ask.addOrder(o2);

      const expectedSequence = [o1, o2, o3, o4];
      expect(ask.getOrders()).toEqual(expectedSequence);
      expect([...ask]).toEqual(expectedSequence);
    });

    it('24. Handles re-addition and lifecycle after side becomes empty', () => {
      const bid = new OrderBookSide('BID');
      bid.addOrder({ id: '1', price: 10000, remainingQuantity: 5 });
      bid.cancelOrder('1');

      expect(bid.isEmpty()).toBe(true);
      expect(bid.getDepth()).toEqual([]);
      expect(bid.getOrders()).toEqual([]);

      // Re-add new order
      bid.addOrder({ id: '2', price: 11000, remainingQuantity: 8 });
      expect(bid.size()).toBe(1);
      expect(bid.totalQuantity()).toBe(8);
      expect(bid.getBestPrice()).toBe(11000);
    });
  });

  describe('25 & 26: Stress Testing and Invariant Verification', () => {
    it('25 & 26. Deterministic stress test across multiple price levels verifies all invariants', () => {
      const bid = new OrderBookSide('BID');
      const ask = new OrderBookSide('ASK');

      const runStress = (side, isBid) => {
        const prices = [1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000];
        let orderSeq = 0;

        // 1. Add 500 orders across the 8 price levels
        for (let i = 0; i < 500; i++) {
          const price = prices[i % prices.length];
          const qty = (i % 20) + 1;
          side.addOrder({
            id: `ord-${orderSeq++}`,
            price,
            remainingQuantity: qty,
          });
          expect(sideInvariant(side)).toBe(true);
        }

        expect(side.size()).toBe(500);
        expect(side.levelCount()).toBe(8);

        // 2. Partially fill 100 orders
        for (let i = 0; i < 100; i++) {
          const orderId = `ord-${i * 2}`;
          const order = side.getOrders().find((o) => o.id === orderId);
          if (order && order.remainingQuantity > 1) {
            side.reduceOrderQuantity(orderId, 1);
            expect(sideInvariant(side)).toBe(true);
          }
        }

        // 3. Cancel 100 orders
        for (let i = 100; i < 200; i++) {
          const orderId = `ord-${i}`;
          side.cancelOrder(orderId);
          expect(sideInvariant(side)).toBe(true);
        }

        // 4. Remove best order 50 times
        for (let i = 0; i < 50; i++) {
          side.removeBestOrder();
          expect(sideInvariant(side)).toBe(true);
        }

        // 5. Completely drain the side via removeBestOrder
        while (!side.isEmpty()) {
          side.removeBestOrder();
          expect(sideInvariant(side)).toBe(true);
        }

        expect(side.size()).toBe(0);
        expect(side.levelCount()).toBe(0);
        expect(side.totalQuantity()).toBe(0);
        expect(side.getBestPrice()).toBeNull();
      };

      runStress(bid, true);
      runStress(ask, false);
    });
  });
});

/**
 * Helper to assert all invariants defined in Section 6.
 *
 * @param {OrderBookSide} side
 * @returns {boolean}
 */
function sideInvariant(side) {
  const orders = side.getOrders();
  const depth = side.getDepth();

  // 1. totalQuantity equals sum of all orders' remainingQuantity
  const actualQty = orders.reduce((sum, o) => sum + o.remainingQuantity, 0);
  if (side.totalQuantity() !== actualQty) return false;

  // 2. size equals total number of resting orders
  if (side.size() !== orders.length) return false;

  // 3. levelCount equals number of non-empty levels
  if (side.levelCount() !== depth.length) return false;

  // 4. Check depth prices ordering
  for (let i = 1; i < depth.length; i++) {
    if (side.side === 'BID') {
      if (depth[i - 1].price <= depth[i].price) return false; // descending
    } else {
      if (depth[i - 1].price >= depth[i].price) return false; // ascending
    }
  }

  // 5. No empty levels in depth
  for (const d of depth) {
    if (d.orderCount <= 0 || d.totalQuantity <= 0) return false;
  }

  // 6. Every order ID maps correctly
  for (const o of orders) {
    const level = side.getLevel(o.price);
    if (!level) return false;
  }

  return true;
}
