import { FIFOQueue } from '../../src/services/matching/fifo-queue.js';

describe('FIFOQueue Matching Engine Data Structure', () => {
  let queue;

  beforeEach(() => {
    queue = new FIFOQueue();
  });

  describe('Initialization', () => {
    it('1. A new queue is empty', () => {
      expect(queue.isEmpty()).toBe(true);
      expect(queue.size()).toBe(0);
      expect(queue.peek()).toBeNull();
      expect(queue.dequeue()).toBeNull();
      expect(queue.toArray()).toEqual([]);
    });
  });

  describe('Enqueue & Peek', () => {
    it('2. Enqueuing one item and peeking returns that item', () => {
      const order = { id: 'ord-1', price: 100, quantity: 2 };
      const newSize = queue.enqueue(order);

      expect(newSize).toBe(1);
      expect(queue.size()).toBe(1);
      expect(queue.isEmpty()).toBe(false);
      expect(queue.peek()).toBe(order);
    });

    it('3. Peeking does not remove the item', () => {
      const order = { id: 'ord-1', price: 100, quantity: 2 };
      queue.enqueue(order);

      expect(queue.peek()).toBe(order);
      expect(queue.peek()).toBe(order);
      expect(queue.size()).toBe(1);
      expect(queue.isEmpty()).toBe(false);
    });

    it('throws a TypeError when enqueuing null or undefined', () => {
      expect(() => queue.enqueue(null)).toThrow(TypeError);
      expect(() => queue.enqueue(undefined)).toThrow(TypeError);
      expect(queue.size()).toBe(0);
    });
  });

  describe('Dequeue & FIFO Order', () => {
    it('4. Dequeue returns items in FIFO order', () => {
      const orderA = { id: 'ord-A', timestamp: 1000 };
      const orderB = { id: 'ord-B', timestamp: 1001 };
      const orderC = { id: 'ord-C', timestamp: 1002 };

      queue.enqueue(orderA);
      queue.enqueue(orderB);
      queue.enqueue(orderC);

      expect(queue.dequeue()).toBe(orderA);
      expect(queue.dequeue()).toBe(orderB);
      expect(queue.dequeue()).toBe(orderC);
      expect(queue.isEmpty()).toBe(true);
    });

    it('5. Dequeue on an empty queue follows the documented behavior (returns null)', () => {
      expect(queue.dequeue()).toBeNull();
      expect(queue.size()).toBe(0);
      expect(queue.isEmpty()).toBe(true);

      // Enqueue one, dequeue it, and dequeue again on empty
      queue.enqueue({ id: 'temp' });
      expect(queue.dequeue()).toEqual({ id: 'temp' });
      expect(queue.dequeue()).toBeNull();
      expect(queue.size()).toBe(0);
    });
  });

  describe('Item Removal', () => {
    it('6. Removing an item from the middle preserves the relative order of other items', () => {
      const order1 = { id: 'ord-1' };
      const order2 = { id: 'ord-2' };
      const order3 = { id: 'ord-3' };
      const order4 = { id: 'ord-4' };

      queue.enqueue(order1);
      queue.enqueue(order2);
      queue.enqueue(order3);
      queue.enqueue(order4);

      // Remove middle item order2 using predicate function
      const removed = queue.remove((item) => item.id === 'ord-2');
      expect(removed).toBe(order2);
      expect(queue.size()).toBe(3);

      // Verify FIFO ordering of remaining items
      expect(queue.dequeue()).toBe(order1);
      expect(queue.dequeue()).toBe(order3);
      expect(queue.dequeue()).toBe(order4);
      expect(queue.isEmpty()).toBe(true);
    });

    it('7. Removing a nonexistent item follows the documented behavior (returns null and preserves queue)', () => {
      const order1 = { id: 'ord-1' };
      const order2 = { id: 'ord-2' };

      queue.enqueue(order1);
      queue.enqueue(order2);

      const removed = queue.remove((item) => item.id === 'non-existent');
      expect(removed).toBeNull();
      expect(queue.size()).toBe(2);

      expect(queue.dequeue()).toBe(order1);
      expect(queue.dequeue()).toBe(order2);
    });

    it('handles removal when queue is empty', () => {
      expect(queue.remove((item) => item.id === 'ord-1')).toBeNull();
      expect(queue.remove(null)).toBeNull();
      expect(queue.remove(undefined)).toBeNull();
    });

    it('removes head element correctly', () => {
      const o1 = { id: '1' };
      const o2 = { id: '2' };
      queue.enqueue(o1);
      queue.enqueue(o2);

      const removed = queue.remove((item) => item.id === '1');
      expect(removed).toBe(o1);
      expect(queue.size()).toBe(1);
      expect(queue.peek()).toBe(o2);
      expect(queue.dequeue()).toBe(o2);
      expect(queue.isEmpty()).toBe(true);
    });

    it('removes tail element correctly', () => {
      const o1 = { id: '1' };
      const o2 = { id: '2' };
      queue.enqueue(o1);
      queue.enqueue(o2);

      const removed = queue.remove((item) => item.id === '2');
      expect(removed).toBe(o2);
      expect(queue.size()).toBe(1);
      expect(queue.peek()).toBe(o1);
      expect(queue.dequeue()).toBe(o1);
      expect(queue.isEmpty()).toBe(true);
    });

    it('removes the single remaining element correctly', () => {
      const o1 = { id: '1' };
      queue.enqueue(o1);

      const removed = queue.remove((item) => item.id === '1');
      expect(removed).toBe(o1);
      expect(queue.size()).toBe(0);
      expect(queue.isEmpty()).toBe(true);
      expect(queue.peek()).toBeNull();
      expect(queue.dequeue()).toBeNull();
    });

    it('supports removal by exact reference match', () => {
      const o1 = { id: '1' };
      const o2 = { id: '2' };
      queue.enqueue(o1);
      queue.enqueue(o2);

      const removed = queue.remove(o2);
      expect(removed).toBe(o2);
      expect(queue.size()).toBe(1);
      expect(queue.dequeue()).toBe(o1);
    });

    it('removes only the first occurrence when multiple items match predicate', () => {
      const o1 = { group: 'A', val: 1 };
      const o2 = { group: 'A', val: 2 };
      const o3 = { group: 'B', val: 3 };

      queue.enqueue(o1);
      queue.enqueue(o2);
      queue.enqueue(o3);

      const removed = queue.remove((item) => item.group === 'A');
      expect(removed).toBe(o1);
      expect(queue.size()).toBe(2);
      expect(queue.dequeue()).toBe(o2);
      expect(queue.dequeue()).toBe(o3);
    });
  });

  describe('Size Bookkeeping', () => {
    it('8. The reported size remains correct after enqueue, dequeue and removal', () => {
      expect(queue.size()).toBe(0);

      queue.enqueue({ id: '1' });
      expect(queue.size()).toBe(1);

      queue.enqueue({ id: '2' });
      expect(queue.size()).toBe(2);

      queue.enqueue({ id: '3' });
      expect(queue.size()).toBe(3);

      queue.dequeue();
      expect(queue.size()).toBe(2);

      queue.remove((item) => item.id === '3');
      expect(queue.size()).toBe(1);

      // Attempt invalid removal
      queue.remove((item) => item.id === 'unknown');
      expect(queue.size()).toBe(1);

      queue.dequeue();
      expect(queue.size()).toBe(0);

      queue.dequeue();
      expect(queue.size()).toBe(0);
    });
  });

  describe('Clear Operation', () => {
    it('9. Clear empties the queue', () => {
      queue.enqueue({ id: '1' });
      queue.enqueue({ id: '2' });
      queue.enqueue({ id: '3' });

      expect(queue.size()).toBe(3);
      expect(queue.isEmpty()).toBe(false);

      queue.clear();

      expect(queue.size()).toBe(0);
      expect(queue.isEmpty()).toBe(true);
      expect(queue.peek()).toBeNull();
      expect(queue.dequeue()).toBeNull();
      expect(queue.toArray()).toEqual([]);

      // Verify queue remains reusable after clear
      queue.enqueue({ id: 'new-1' });
      expect(queue.size()).toBe(1);
      expect(queue.peek()).toEqual({ id: 'new-1' });
    });
  });

  describe('Object Reference Integrity', () => {
    it('10. Multiple distinct object references can be enqueued and retrieved correctly without mutation', () => {
      const order1 = Object.freeze({ id: 'frozen-1', price: 50.0 });
      const order2 = { id: 'mutable-2', tags: ['vip', 'early-bird'] };
      const order3 = { id: 'mutable-3', nested: { eventId: 'ev-123' } };

      queue.enqueue(order1);
      queue.enqueue(order2);
      queue.enqueue(order3);

      const retrieved1 = queue.dequeue();
      const retrieved2 = queue.dequeue();
      const retrieved3 = queue.dequeue();

      expect(retrieved1).toBe(order1);
      expect(retrieved2).toBe(order2);
      expect(retrieved3).toBe(order3);

      // Ensure objects were not mutated with internal queue pointers
      expect(order1).not.toHaveProperty('next');
      expect(order1).not.toHaveProperty('prev');
      expect(order2).not.toHaveProperty('next');
      expect(order2).not.toHaveProperty('prev');
    });

    it('supports primitive items such as strings and numbers', () => {
      queue.enqueue('ticket-1');
      queue.enqueue('ticket-2');
      queue.enqueue(42);

      expect(queue.dequeue()).toBe('ticket-1');
      expect(queue.dequeue()).toBe('ticket-2');
      expect(queue.dequeue()).toBe(42);
    });
  });

  describe('Stress & Scale Testing', () => {
    it('11. A large sequence of enqueues and dequeues preserves ordering', () => {
      const total = 50000;

      for (let i = 0; i < total; i++) {
        queue.enqueue(i);
      }

      expect(queue.size()).toBe(total);

      for (let i = 0; i < total; i++) {
        expect(queue.dequeue()).toBe(i);
      }

      expect(queue.isEmpty()).toBe(true);
      expect(queue.size()).toBe(0);
    });

    it('interleaved enqueue, remove and dequeue under heavy volume preserves state consistency', () => {
      const activeIds = [];

      for (let i = 0; i < 1000; i++) {
        const item = { id: i, payload: `item-${i}` };
        queue.enqueue(item);
        activeIds.push(item);
      }

      // Remove 200 items spread throughout
      for (let i = 100; i < 300; i++) {
        const removed = queue.remove((item) => item.id === i);
        expect(removed).not.toBeNull();
        expect(removed.id).toBe(i);
      }

      expect(queue.size()).toBe(800);

      // Dequeue the remaining 800 items and verify order
      const remainingDequeued = [];
      while (!queue.isEmpty()) {
        remainingDequeued.push(queue.dequeue().id);
      }

      expect(remainingDequeued.length).toBe(800);

      const expectedIds = [
        ...Array.from({ length: 100 }, (_, i) => i),
        ...Array.from({ length: 700 }, (_, i) => i + 300),
      ];

      expect(remainingDequeued).toEqual(expectedIds);
    });
  });

  describe('Iteration and Array conversion', () => {
    it('converts correctly via toArray() without modifying queue', () => {
      queue.enqueue('A');
      queue.enqueue('B');
      queue.enqueue('C');

      const arr = queue.toArray();
      expect(arr).toEqual(['A', 'B', 'C']);
      expect(queue.size()).toBe(3);
    });

    it('supports for..of and spread iteration via [Symbol.iterator]()', () => {
      queue.enqueue(10);
      queue.enqueue(20);
      queue.enqueue(30);

      const collected = [];
      for (const val of queue) {
        collected.push(val);
      }

      expect(collected).toEqual([10, 20, 30]);
      expect([...queue]).toEqual([10, 20, 30]);
      expect(queue.size()).toBe(3);
    });
  });
});
