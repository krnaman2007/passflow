import { PriceLevel } from '../../src/services/matching/price-level.js';

describe('PriceLevel Matching Engine Component', () => {
  const LEVEL_PRICE = 5000; // e.g. $50.00 represented as 5000 minor units
  let level;

  beforeEach(() => {
    level = new PriceLevel(LEVEL_PRICE);
  });

  describe('1 & 2: Constructor & Price Validation', () => {
    it('1. Constructor initializes correctly with a valid positive integer price', () => {
      expect(level.price).toBe(LEVEL_PRICE);
      expect(level.size()).toBe(0);
      expect(level.isEmpty()).toBe(true);
      expect(level.totalQuantity()).toBe(0);
      expect(level.peek()).toBeNull();
      expect(level.toArray()).toEqual([]);
    });

    it('prevents callers from mutating the level price after construction', () => {
      expect(() => {
        level.price = 9999;
      }).toThrow();
      expect(level.price).toBe(LEVEL_PRICE);
    });

    it('2. Rejects invalid prices: zero, negative, decimals, strings, NaN, infinities, and unsafe integers', () => {
      // Non-integers / wrong types -> TypeError
      expect(() => new PriceLevel('5000')).toThrow(TypeError);
      expect(() => new PriceLevel(null)).toThrow(TypeError);
      expect(() => new PriceLevel(undefined)).toThrow(TypeError);
      expect(() => new PriceLevel(NaN)).toThrow(TypeError);
      expect(() => new PriceLevel(50.5)).toThrow(TypeError);

      // Non-positive or unsafe integers -> RangeError
      expect(() => new PriceLevel(0)).toThrow(RangeError);
      expect(() => new PriceLevel(-100)).toThrow(RangeError);
      expect(() => new PriceLevel(Infinity)).toThrow(TypeError);
      expect(() => new PriceLevel(-Infinity)).toThrow(TypeError);
      expect(() => new PriceLevel(Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError);
    });
  });

  describe('3: Empty Level Behavior', () => {
    it('3. Returns predictable results on an empty level for all inspection methods', () => {
      expect(level.peek()).toBeNull();
      expect(level.removeOldest()).toBeNull();
      expect(level.size()).toBe(0);
      expect(level.isEmpty()).toBe(true);
      expect(level.totalQuantity()).toBe(0);
      expect(level.toArray()).toEqual([]);
      expect([...level]).toEqual([]);
    });
  });

  describe('4, 5, 6: Adding Orders & FIFO Invariant', () => {
    it('4. Adding one order and several orders updates size correctly', () => {
      const o1 = { id: 'ord-1', price: LEVEL_PRICE, remainingQuantity: 10 };
      const size1 = level.addOrder(o1);
      expect(size1).toBe(1);
      expect(level.size()).toBe(1);
      expect(level.isEmpty()).toBe(false);

      const o2 = { id: 'ord-2', price: LEVEL_PRICE, remainingQuantity: 5 };
      const size2 = level.addOrder(o2);
      expect(size2).toBe(2);
      expect(level.size()).toBe(2);
    });

    it('5. FIFO ordering is strictly preserved across multiple orders', () => {
      const o1 = { id: 'ord-1', price: LEVEL_PRICE, remainingQuantity: 10 };
      const o2 = { id: 'ord-2', price: LEVEL_PRICE, remainingQuantity: 20 };
      const o3 = { id: 'ord-3', price: LEVEL_PRICE, remainingQuantity: 30 };

      level.addOrder(o1);
      level.addOrder(o2);
      level.addOrder(o3);

      expect(level.peek()).toBe(o1);
      expect(level.toArray()).toEqual([o1, o2, o3]);
      expect([...level]).toEqual([o1, o2, o3]);

      expect(level.removeOldest()).toBe(o1);
      expect(level.removeOldest()).toBe(o2);
      expect(level.removeOldest()).toBe(o3);
      expect(level.isEmpty()).toBe(true);
    });

    it('6. Aggregate quantity equals sum of all remainingQuantities after additions', () => {
      expect(level.totalQuantity()).toBe(0);

      level.addOrder({ id: '1', price: LEVEL_PRICE, remainingQuantity: 15 });
      expect(level.totalQuantity()).toBe(15);

      level.addOrder({ id: '2', price: LEVEL_PRICE, remainingQuantity: 25 });
      expect(level.totalQuantity()).toBe(40);

      level.addOrder({ id: '3', price: LEVEL_PRICE, remainingQuantity: 10 });
      expect(level.totalQuantity()).toBe(50);
    });
  });

  describe('7, 8, 9, 10: Order Contract Validation & Rejections', () => {
    it('7. Rejects null, undefined, arrays, and malformed non-object orders', () => {
      expect(() => level.addOrder(null)).toThrow(TypeError);
      expect(() => level.addOrder(undefined)).toThrow(TypeError);
      expect(() => level.addOrder([])).toThrow(TypeError);
      expect(() => level.addOrder('order-string')).toThrow(TypeError);
      expect(() => level.addOrder(123)).toThrow(TypeError);
    });

    it('8. Rejects invalid IDs (non-string, empty, whitespace-only)', () => {
      expect(() =>
        level.addOrder({ id: 123, price: LEVEL_PRICE, remainingQuantity: 5 })
      ).toThrow(TypeError);
      expect(() =>
        level.addOrder({ id: '', price: LEVEL_PRICE, remainingQuantity: 5 })
      ).toThrow(RangeError);
      expect(() =>
        level.addOrder({ id: '   ', price: LEVEL_PRICE, remainingQuantity: 5 })
      ).toThrow(RangeError);
    });

    it('8b. Rejects invalid quantities (non-number, decimals, zero, negative, unsafe integers)', () => {
      expect(() =>
        level.addOrder({ id: '1', price: LEVEL_PRICE, remainingQuantity: '10' })
      ).toThrow(TypeError);
      expect(() =>
        level.addOrder({ id: '1', price: LEVEL_PRICE, remainingQuantity: 10.5 })
      ).toThrow(TypeError);
      expect(() =>
        level.addOrder({ id: '1', price: LEVEL_PRICE, remainingQuantity: 0 })
      ).toThrow(RangeError);
      expect(() =>
        level.addOrder({ id: '1', price: LEVEL_PRICE, remainingQuantity: -5 })
      ).toThrow(RangeError);
      expect(() =>
        level.addOrder({
          id: '1',
          price: LEVEL_PRICE,
          remainingQuantity: Number.MAX_SAFE_INTEGER + 1,
        })
      ).toThrow(RangeError);
    });

    it('8c. Does not substitute "quantity" for "remainingQuantity"', () => {
      // Order with 'quantity' instead of 'remainingQuantity' must be rejected
      const malformedOrder = { id: 'ord-bad', price: LEVEL_PRICE, quantity: 10 };
      expect(() => level.addOrder(malformedOrder)).toThrow(TypeError);
    });

    it('9. Rejects orders with mismatched prices', () => {
      const higherPriceOrder = {
        id: 'ord-high',
        price: LEVEL_PRICE + 100,
        remainingQuantity: 5,
      };
      const lowerPriceOrder = {
        id: 'ord-low',
        price: LEVEL_PRICE - 100,
        remainingQuantity: 5,
      };

      expect(() => level.addOrder(higherPriceOrder)).toThrow(RangeError);
      expect(() => level.addOrder(lowerPriceOrder)).toThrow(RangeError);
      expect(level.size()).toBe(0);
      expect(level.totalQuantity()).toBe(0);
    });

    it('10. Rejects duplicate order IDs within the same PriceLevel', () => {
      const o1 = { id: 'dup-1', price: LEVEL_PRICE, remainingQuantity: 10 };
      const o1Dup = { id: 'dup-1', price: LEVEL_PRICE, remainingQuantity: 20 };

      level.addOrder(o1);
      expect(() => level.addOrder(o1Dup)).toThrow(Error);
      expect(level.size()).toBe(1);
      expect(level.totalQuantity()).toBe(10);
    });
  });

  describe('11, 12, 13: Partial and Complete Fills (reduceOrderQuantity)', () => {
    it('11. Partial fill updates both order remainingQuantity and aggregate totalQuantity', () => {
      const order = { id: 'ord-1', price: LEVEL_PRICE, remainingQuantity: 10 };
      level.addOrder(order);

      const result = level.reduceOrderQuantity('ord-1', 4);
      expect(result).toEqual({
        order,
        fullyFilled: false,
        remainingQuantity: 6,
      });

      expect(order.remainingQuantity).toBe(6);
      expect(level.totalQuantity()).toBe(6);
      expect(level.size()).toBe(1);
      expect(level.peek()).toBe(order);
    });

    it('12. Complete fill removes the order from queue, ID index and totalQuantity', () => {
      const o1 = { id: 'ord-1', price: LEVEL_PRICE, remainingQuantity: 10 };
      const o2 = { id: 'ord-2', price: LEVEL_PRICE, remainingQuantity: 20 };

      level.addOrder(o1);
      level.addOrder(o2);

      const fillResult = level.reduceOrderQuantity('ord-1', 10);
      expect(fillResult).toEqual({
        order: o1,
        fullyFilled: true,
        remainingQuantity: 0,
      });

      expect(o1.remainingQuantity).toBe(0);
      expect(level.size()).toBe(1);
      expect(level.totalQuantity()).toBe(20);
      expect(level.peek()).toBe(o2);

      // Verify o1 cannot be filled or cancelled again
      expect(level.reduceOrderQuantity('ord-1', 1)).toBeNull();
      expect(level.cancelOrder('ord-1')).toBeNull();

      // Verify o1 ID can now be re-added as a new order if needed
      expect(() =>
        level.addOrder({ id: 'ord-1', price: LEVEL_PRICE, remainingQuantity: 15 })
      ).not.toThrow();
      expect(level.size()).toBe(2);
      expect(level.totalQuantity()).toBe(35);
    });

    it('13. Partial fill preserves the order original FIFO position relative to other orders', () => {
      const o1 = { id: '1', price: LEVEL_PRICE, remainingQuantity: 10 };
      const o2 = { id: '2', price: LEVEL_PRICE, remainingQuantity: 20 };
      const o3 = { id: '3', price: LEVEL_PRICE, remainingQuantity: 30 };

      level.addOrder(o1);
      level.addOrder(o2);
      level.addOrder(o3);

      // Partially fill middle order o2
      level.reduceOrderQuantity('2', 5);
      expect(o2.remainingQuantity).toBe(15);

      // FIFO order must remain [o1, o2, o3]
      expect(level.toArray()).toEqual([o1, o2, o3]);
      expect(level.removeOldest()).toBe(o1);
      expect(level.removeOldest()).toBe(o2);
      expect(level.removeOldest()).toBe(o3);
    });

    it('reduceOrderQuantity validates orderId and quantity', () => {
      level.addOrder({ id: '1', price: LEVEL_PRICE, remainingQuantity: 10 });

      expect(() => level.reduceOrderQuantity(null, 5)).toThrow(TypeError);
      expect(() => level.reduceOrderQuantity('', 5)).toThrow(RangeError);
      expect(() => level.reduceOrderQuantity('1', '5')).toThrow(TypeError);
      expect(() => level.reduceOrderQuantity('1', 0)).toThrow(RangeError);
      expect(() => level.reduceOrderQuantity('1', -2)).toThrow(RangeError);
      expect(() => level.reduceOrderQuantity('1', 1.5)).toThrow(TypeError);

      // Reduction exceeding order remaining quantity
      expect(() => level.reduceOrderQuantity('1', 11)).toThrow(RangeError);

      // Order not found returns null
      expect(level.reduceOrderQuantity('unknown-id', 5)).toBeNull();
    });
  });

  describe('14, 15, 16: Order Cancellation', () => {
    it('14. Cancels oldest, middle, and newest orders preserving FIFO ordering of remainder', () => {
      const o1 = { id: '1', price: LEVEL_PRICE, remainingQuantity: 10 };
      const o2 = { id: '2', price: LEVEL_PRICE, remainingQuantity: 20 };
      const o3 = { id: '3', price: LEVEL_PRICE, remainingQuantity: 30 };
      const o4 = { id: '4', price: LEVEL_PRICE, remainingQuantity: 40 };

      level.addOrder(o1);
      level.addOrder(o2);
      level.addOrder(o3);
      level.addOrder(o4);

      // Cancel middle order o2
      const c2 = level.cancelOrder('2');
      expect(c2).toBe(o2);
      expect(level.size()).toBe(3);
      expect(level.totalQuantity()).toBe(80);
      expect(level.toArray()).toEqual([o1, o3, o4]);

      // Cancel oldest order o1
      const c1 = level.cancelOrder('1');
      expect(c1).toBe(o1);
      expect(level.size()).toBe(2);
      expect(level.totalQuantity()).toBe(70);
      expect(level.peek()).toBe(o3);
      expect(level.toArray()).toEqual([o3, o4]);

      // Cancel newest order o4
      const c4 = level.cancelOrder('4');
      expect(c4).toBe(o4);
      expect(level.size()).toBe(1);
      expect(level.totalQuantity()).toBe(30);
      expect(level.toArray()).toEqual([o3]);

      // Cancel final order o3
      const c3 = level.cancelOrder('3');
      expect(c3).toBe(o3);
      expect(level.isEmpty()).toBe(true);
      expect(level.totalQuantity()).toBe(0);
    });

    it('15. Cancelling a nonexistent order returns null and leaves state intact', () => {
      level.addOrder({ id: '1', price: LEVEL_PRICE, remainingQuantity: 10 });

      expect(level.cancelOrder('nonexistent')).toBeNull();
      expect(level.size()).toBe(1);
      expect(level.totalQuantity()).toBe(10);
    });

    it('cancelOrder validates orderId argument', () => {
      expect(() => level.cancelOrder(123)).toThrow(TypeError);
      expect(() => level.cancelOrder('')).toThrow(RangeError);
      expect(() => level.cancelOrder('   ')).toThrow(RangeError);
    });

    it('16. Cancellation after partial fill subtracts current remainingQuantity, not original', () => {
      const order = { id: 'ord-p', price: LEVEL_PRICE, remainingQuantity: 100 };
      level.addOrder(order);

      // Partially fill 40 units -> 60 remaining
      level.reduceOrderQuantity('ord-p', 40);
      expect(order.remainingQuantity).toBe(60);
      expect(level.totalQuantity()).toBe(60);

      // Cancel the partially filled order
      const cancelled = level.cancelOrder('ord-p');
      expect(cancelled).toBe(order);
      expect(cancelled.remainingQuantity).toBe(60);
      expect(level.size()).toBe(0);
      expect(level.totalQuantity()).toBe(0);
      expect(level.isEmpty()).toBe(true);
    });
  });

  describe('17, 18, 19: Removal to Empty & Invariant Protection', () => {
    it('17. Removing orders with removeOldest until empty leaves totalQuantity at 0', () => {
      level.addOrder({ id: '1', price: LEVEL_PRICE, remainingQuantity: 10 });
      level.addOrder({ id: '2', price: LEVEL_PRICE, remainingQuantity: 20 });

      expect(level.removeOldest().id).toBe('1');
      expect(level.totalQuantity()).toBe(20);

      expect(level.removeOldest().id).toBe('2');
      expect(level.totalQuantity()).toBe(0);
      expect(level.isEmpty()).toBe(true);

      // Further removeOldest returns null without going below 0
      expect(level.removeOldest()).toBeNull();
      expect(level.totalQuantity()).toBe(0);
    });

    it('18. Prevents aggregate quantity overflow exceeding Number.MAX_SAFE_INTEGER', () => {
      level.addOrder({
        id: 'huge-1',
        price: LEVEL_PRICE,
        remainingQuantity: Number.MAX_SAFE_INTEGER - 10,
      });

      const overflowOrder = {
        id: 'huge-2',
        price: LEVEL_PRICE,
        remainingQuantity: 20,
      };

      expect(() => level.addOrder(overflowOrder)).toThrow(RangeError);
      expect(level.size()).toBe(1);
      expect(level.totalQuantity()).toBe(Number.MAX_SAFE_INTEGER - 10);
    });

    it('19. Ensures rejected operations do not corrupt state or invariants', () => {
      const o1 = { id: '1', price: LEVEL_PRICE, remainingQuantity: 50 };
      level.addOrder(o1);

      // Rejections:
      expect(() => level.addOrder(null)).toThrow();
      expect(() => level.addOrder({ id: '1', price: LEVEL_PRICE, remainingQuantity: 10 })).toThrow(); // dup
      expect(() => level.addOrder({ id: '2', price: 9999, remainingQuantity: 10 })).toThrow(); // price mismatch
      expect(() => level.reduceOrderQuantity('1', 60)).toThrow(); // over reduction
      expect(() => level.reduceOrderQuantity('1', -5)).toThrow(); // invalid qty
      expect(() => level.cancelOrder('')).toThrow();

      // Verify state was completely unaffected by all rejections
      expect(level.size()).toBe(1);
      expect(level.totalQuantity()).toBe(50);
      expect(level.peek()).toBe(o1);
    });
  });

  describe('20: Stress Testing and Invariant Integrity', () => {
    it('20. Stress-testing many additions, partial fills, cancellations, and removals preserves aggregate invariant', () => {
      const N = 1000;
      let expectedSum = 0;

      // 1. Enqueue N orders
      for (let i = 0; i < N; i++) {
        const qty = (i % 50) + 1;
        level.addOrder({
          id: `stress-${i}`,
          price: LEVEL_PRICE,
          remainingQuantity: qty,
        });
        expectedSum += qty;
      }

      expect(level.size()).toBe(N);
      expect(level.totalQuantity()).toBe(expectedSum);

      // Invariant helper:
      const checkInvariant = () => {
        const actualSum = level
          .toArray()
          .reduce((acc, ord) => acc + ord.remainingQuantity, 0);
        expect(level.totalQuantity()).toBe(actualSum);
        expect(level.totalQuantity()).toBe(expectedSum);
        expect(level.size()).toBe(level.toArray().length);
      };

      checkInvariant();

      // 2. Partially fill 200 orders
      for (let i = 0; i < 200; i++) {
        const orderId = `stress-${i * 3}`;
        const order = level.toArray().find((o) => o.id === orderId);
        if (order && order.remainingQuantity > 1) {
          level.reduceOrderQuantity(orderId, 1);
          expectedSum -= 1;
        }
      }

      checkInvariant();

      // 3. Cancel 200 orders from various positions
      for (let i = 200; i < 400; i++) {
        const orderId = `stress-${i}`;
        const cancelled = level.cancelOrder(orderId);
        if (cancelled) {
          expectedSum -= cancelled.remainingQuantity;
        }
      }

      checkInvariant();

      // 4. Fully fill 100 orders using reduceOrderQuantity
      for (let i = 400; i < 500; i++) {
        const orderId = `stress-${i}`;
        const order = level.toArray().find((o) => o.id === orderId);
        if (order) {
          const fillQty = order.remainingQuantity;
          const res = level.reduceOrderQuantity(orderId, fillQty);
          expect(res.fullyFilled).toBe(true);
          expectedSum -= fillQty;
        }
      }

      checkInvariant();

      // 5. Remove oldest until empty
      while (!level.isEmpty()) {
        const oldest = level.removeOldest();
        expectedSum -= oldest.remainingQuantity;
      }

      expect(level.size()).toBe(0);
      expect(level.totalQuantity()).toBe(0);
      expect(expectedSum).toBe(0);
    });
  });
});
