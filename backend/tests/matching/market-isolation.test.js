import { OrderBook } from '../../src/services/matching/order-book.js';
import { MatchingCoordinator } from '../../src/services/matching/matching-coordinator.js';

describe('Market Isolation & Cross-Market Concurrency Component Audit', () => {
  let coordinator;

  beforeEach(() => {
    coordinator = new MatchingCoordinator();
  });

  describe('1. Event Market Isolation', () => {
    it('orders in different event markets never interact or execute against each other', () => {
      const bookColdplay = new OrderBook({
        eventId: 'event-coldplay',
        ticketCategoryId: 'cat-vip',
      });
      const bookOasis = new OrderBook({
        eventId: 'event-oasis',
        ticketCategoryId: 'cat-vip',
      });

      // Resting ASK in Coldplay market at 10000
      coordinator.submitLimitOrder(bookColdplay, {
        id: 'ask-coldplay-1',
        side: 'ASK',
        price: 10000,
        remainingQuantity: 5,
        eventId: 'event-coldplay',
        ticketCategoryId: 'cat-vip',
      });

      // Incoming BID in Oasis market at 10000 (same price, same category, different event)
      const oasisResult = coordinator.submitLimitOrder(bookOasis, {
        id: 'bid-oasis-1',
        side: 'BID',
        price: 10000,
        remainingQuantity: 5,
        eventId: 'event-oasis',
        ticketCategoryId: 'cat-vip',
      });

      // Oasis bid must NOT match Coldplay ask; it must rest in Oasis book
      expect(oasisResult.status).toBe('RESTING');
      expect(oasisResult.matchedQuantity).toBe(0);
      expect(oasisResult.executions).toHaveLength(0);
      expect(oasisResult.restedQuantity).toBe(5);

      // Verify Coldplay book remains completely untouched
      expect(bookColdplay.size()).toBe(1);
      expect(bookColdplay.getBestAsk()).toBe(10000);
      expect(bookColdplay.getOrder('ask-coldplay-1').order.remainingQuantity).toBe(5);
      expect(bookColdplay.getOrder('bid-oasis-1')).toBeNull();

      // Verify Oasis book holds only its own resting bid
      expect(bookOasis.size()).toBe(1);
      expect(bookOasis.getBestBid()).toBe(10000);
      expect(bookOasis.getOrder('bid-oasis-1').order.remainingQuantity).toBe(5);
      expect(bookOasis.getOrder('ask-coldplay-1')).toBeNull();
    });

    it('rejects order if order.eventId does not match the target book.eventId', () => {
      const bookColdplay = new OrderBook({
        eventId: 'event-coldplay',
        ticketCategoryId: 'cat-vip',
      });

      expect(() => {
        coordinator.submitLimitOrder(bookColdplay, {
          id: 'order-mismatch',
          side: 'BID',
          price: 10000,
          remainingQuantity: 1,
          eventId: 'event-taylor-swift',
          ticketCategoryId: 'cat-vip',
        });
      }).toThrow(RangeError);

      expect(bookColdplay.isEmpty()).toBe(true);
    });
  });

  describe('2. Ticket Category Isolation within Same Event', () => {
    it('orders in different ticket categories never interact, even for the same event', () => {
      const bookVIP = new OrderBook({
        eventId: 'event-coldplay',
        ticketCategoryId: 'cat-vip',
      });
      const bookGeneral = new OrderBook({
        eventId: 'event-coldplay',
        ticketCategoryId: 'cat-general',
      });

      // Resting ASK in VIP category at 15000
      coordinator.submitLimitOrder(bookVIP, {
        id: 'ask-vip-1',
        side: 'ASK',
        price: 15000,
        remainingQuantity: 2,
        eventId: 'event-coldplay',
        ticketCategoryId: 'cat-vip',
      });

      // Incoming BID in General category with a high limit (20000) willing to pay VIP price
      const generalResult = coordinator.submitLimitOrder(bookGeneral, {
        id: 'bid-gen-1',
        side: 'BID',
        price: 20000,
        remainingQuantity: 2,
        eventId: 'event-coldplay',
        ticketCategoryId: 'cat-general',
      });

      // General BID must NOT match VIP ASK; it rests in General book
      expect(generalResult.status).toBe('RESTING');
      expect(generalResult.matchedQuantity).toBe(0);
      expect(generalResult.executions).toHaveLength(0);
      expect(generalResult.restedQuantity).toBe(2);

      // Verify books are isolated
      expect(bookVIP.size()).toBe(1);
      expect(bookVIP.getBestAsk()).toBe(15000);
      expect(bookVIP.getBestBid()).toBeNull();
      expect(bookVIP.getOrder('bid-gen-1')).toBeNull();

      expect(bookGeneral.size()).toBe(1);
      expect(bookGeneral.getBestBid()).toBe(20000);
      expect(bookGeneral.getBestAsk()).toBeNull();
      expect(bookGeneral.getOrder('ask-vip-1')).toBeNull();
    });

    it('rejects order if order.ticketCategoryId does not match target book.ticketCategoryId', () => {
      const bookVIP = new OrderBook({
        eventId: 'event-coldplay',
        ticketCategoryId: 'cat-vip',
      });

      expect(() => {
        coordinator.submitLimitOrder(bookVIP, {
          id: 'order-wrong-cat',
          side: 'BID',
          price: 10000,
          remainingQuantity: 1,
          eventId: 'event-coldplay',
          ticketCategoryId: 'cat-standing',
        });
      }).toThrow(RangeError);

      expect(bookVIP.isEmpty()).toBe(true);
    });
  });

  describe('3. Order ID Re-use Across Separate OrderBooks', () => {
    it('reusing an order ID in separate OrderBook instances does not collide or cross-mutate', () => {
      const bookA = new OrderBook({ eventId: 'event-a', ticketCategoryId: 'cat-standard' });
      const bookB = new OrderBook({ eventId: 'event-b', ticketCategoryId: 'cat-standard' });

      // Add order with same ID 'ord-duplicate' to both books with different sides & prices
      bookA.addOrder('BID', { id: 'ord-duplicate', price: 5000, remainingQuantity: 10 });
      bookB.addOrder('ASK', { id: 'ord-duplicate', price: 8000, remainingQuantity: 4 });

      // Both books must successfully index the order within their respective instance
      expect(bookA.size()).toBe(1);
      expect(bookB.size()).toBe(1);

      const lookupA = bookA.getOrder('ord-duplicate');
      const lookupB = bookB.getOrder('ord-duplicate');

      expect(lookupA).not.toBeNull();
      expect(lookupA.side).toBe('BID');
      expect(lookupA.order.price).toBe(5000);
      expect(lookupA.order.remainingQuantity).toBe(10);

      expect(lookupB).not.toBeNull();
      expect(lookupB.side).toBe('ASK');
      expect(lookupB.order.price).toBe(8000);
      expect(lookupB.order.remainingQuantity).toBe(4);
    });
  });

  describe('4. Cancellation and Quantity Reduction Isolation', () => {
    it('cancellation in one book leaves identical order IDs in other books untouched', () => {
      const bookA = new OrderBook({ eventId: 'ev-1', ticketCategoryId: 'cat-1' });
      const bookB = new OrderBook({ eventId: 'ev-2', ticketCategoryId: 'cat-2' });

      bookA.addOrder('BID', { id: 'target-ord', price: 6000, remainingQuantity: 10 });
      bookB.addOrder('BID', { id: 'target-ord', price: 6000, remainingQuantity: 10 });

      // Cancel in Book A
      const cancelResultA = bookA.cancelOrder('target-ord');
      expect(cancelResultA).not.toBeNull();
      expect(bookA.getOrder('target-ord')).toBeNull();
      expect(bookA.isEmpty()).toBe(true);

      // Book B must remain completely unaffected
      expect(bookB.size()).toBe(1);
      expect(bookB.getOrder('target-ord')).not.toBeNull();
      expect(bookB.getOrder('target-ord').order.remainingQuantity).toBe(10);
      expect(bookB.getBestBid()).toBe(6000);
    });

    it('quantity reduction in one book affects only that specific book', () => {
      const bookA = new OrderBook({ eventId: 'ev-1', ticketCategoryId: 'cat-1' });
      const bookB = new OrderBook({ eventId: 'ev-2', ticketCategoryId: 'cat-2' });

      bookA.addOrder('ASK', { id: 'reduce-ord', price: 9000, remainingQuantity: 10 });
      bookB.addOrder('ASK', { id: 'reduce-ord', price: 9000, remainingQuantity: 10 });

      // Reduce in Book A by 4 units
      const fillA = bookA.reduceOrderQuantity('reduce-ord', 4);
      expect(fillA.fullyFilled).toBe(false);
      expect(fillA.remainingQuantity).toBe(6);
      expect(bookA.getOrder('reduce-ord').order.remainingQuantity).toBe(6);
      expect(bookA.totalQuantity()).toBe(6);

      // Book B must preserve full 10 units
      expect(bookB.getOrder('reduce-ord').order.remainingQuantity).toBe(10);
      expect(bookB.totalQuantity()).toBe(10);
    });
  });

  describe('5. Independent Market Depth, Spread, and Statistics', () => {
    it('each book independently maintains its own spread, depth, and side statistics', () => {
      const book1 = new OrderBook({ eventId: 'ev-rock', ticketCategoryId: 'pit' });
      const book2 = new OrderBook({ eventId: 'ev-jazz', ticketCategoryId: 'seated' });

      // Book 1 setup: Bid 5000 (qty 2), Ask 6000 (qty 3) -> spread 1000
      book1.addOrder('BID', { id: 'b1', price: 5000, remainingQuantity: 2 });
      book1.addOrder('ASK', { id: 'a1', price: 6000, remainingQuantity: 3 });

      // Book 2 setup: Bid 12000 (qty 10), Ask 12500 (qty 5) -> spread 500
      book2.addOrder('BID', { id: 'b2', price: 12000, remainingQuantity: 10 });
      book2.addOrder('ASK', { id: 'a2', price: 12500, remainingQuantity: 5 });

      expect(book1.getSpread()).toBe(1000);
      expect(book2.getSpread()).toBe(500);

      expect(book1.getDepth()).toEqual({
        bids: [{ price: 5000, totalQuantity: 2, orderCount: 1 }],
        asks: [{ price: 6000, totalQuantity: 3, orderCount: 1 }],
      });

      expect(book2.getDepth()).toEqual({
        bids: [{ price: 12000, totalQuantity: 10, orderCount: 1 }],
        asks: [{ price: 12500, totalQuantity: 5, orderCount: 1 }],
      });

      const stats1 = book1.getStats();
      const stats2 = book2.getStats();

      expect(stats1.orderCount).toBe(2);
      expect(stats1.totalQuantity).toBe(5);
      expect(stats2.orderCount).toBe(2);
      expect(stats2.totalQuantity).toBe(15);
    });
  });
});
