/**
 * Represents an internal node within the doubly linked FIFOQueue.
 * Wraps the queued item to prevent mutating caller objects.
 *
 * @template T
 */
class QueueNode {
  /**
   * @param {T} value - The item stored in this node.
   */
  constructor(value) {
    this.value = value;
    this.next = null;
    this.prev = null;
  }
}

/**
 * A high-performance, doubly linked FIFO (First-In, First-Out) queue.
 *
 * Designed for the PassFlow matching engine to manage order queues at specific
 * price levels (PriceTimePriority). Avoids Array.prototype.shift() O(n) overhead
 * by maintaining head and tail node pointers, achieving O(1) enqueues and dequeues.
 *
 * Generic and independent of any database, framework, or order schema.
 *
 * @template T
 */
export class FIFOQueue {
  /**
   * Initializes an empty FIFO queue.
   */
  constructor() {
    /** @type {QueueNode<T>|null} Pointer to the oldest element (head). */
    this.head = null;
    /** @type {QueueNode<T>|null} Pointer to the newest element (tail). */
    this.tail = null;
    /** @type {number} Number of items currently resting in the queue. */
    this.count = 0;
  }

  /**
   * Appends an item to the end (tail) of the queue.
   *
   * @param {T} item - The item to enqueue. Must not be null or undefined.
   * @returns {number} The updated size of the queue.
   * @throws {TypeError} If item is null or undefined.
   */
  enqueue(item) {
    if (item === null || item === undefined) {
      throw new TypeError('Cannot enqueue null or undefined item');
    }

    const node = new QueueNode(item);

    if (this.tail === null) {
      this.head = node;
      this.tail = node;
    } else {
      this.tail.next = node;
      node.prev = this.tail;
      this.tail = node;
    }

    this.count++;
    return this.count;
  }

  /**
   * Returns the oldest item without removing it from the queue.
   *
   * @returns {T|null} The oldest item, or null if the queue is empty.
   */
  peek() {
    if (this.head === null) {
      return null;
    }
    return this.head.value;
  }

  /**
   * Removes and returns the oldest item (head) from the queue.
   *
   * @returns {T|null} The removed item, or null if the queue is empty.
   */
  dequeue() {
    if (this.head === null) {
      return null;
    }

    const node = this.head;
    const value = node.value;

    this.head = node.next;
    if (this.head !== null) {
      this.head.prev = null;
    } else {
      this.tail = null;
    }

    // Detach node pointers to facilitate garbage collection
    node.prev = null;
    node.next = null;
    this.count--;

    return value;
  }

  /**
   * Removes a specific item matching the predicate or reference equality.
   *
   * If a predicate function is supplied, the first item for which predicate(item)
   * returns true will be unlinked and returned. If a non-function value is passed,
   * the first item strictly equal (===) to the predicate will be unlinked.
   *
   * If no matching item is found or the queue is empty, returns null and
   * leaves the queue state untouched.
   *
   * @param {(item: T) => boolean | T} predicate - Matcher function or exact item reference.
   * @returns {T|null} The removed item, or null if no match was found.
   */
  remove(predicate) {
    if (this.head === null || predicate === undefined || predicate === null) {
      return null;
    }

    const isFunction = typeof predicate === 'function';
    let current = this.head;

    while (current !== null) {
      const match = isFunction ? Boolean(predicate(current.value)) : current.value === predicate;

      if (match) {
        // Unlink current from previous neighbor or update head
        if (current.prev !== null) {
          current.prev.next = current.next;
        } else {
          this.head = current.next;
        }

        // Unlink current from next neighbor or update tail
        if (current.next !== null) {
          current.next.prev = current.prev;
        } else {
          this.tail = current.prev;
        }

        const removedValue = current.value;

        // Clean up detached node
        current.prev = null;
        current.next = null;
        this.count--;

        return removedValue;
      }

      current = current.next;
    }

    return null;
  }

  /**
   * Returns the current number of items in the queue.
   *
   * @returns {number} Current item count.
   */
  size() {
    return this.count;
  }

  /**
   * Indicates whether the queue currently has no items.
   *
   * @returns {boolean} True if empty, false otherwise.
   */
  isEmpty() {
    return this.count === 0;
  }

  /**
   * Empties the queue, resetting pointers and size count.
   */
  clear() {
    this.head = null;
    this.tail = null;
    this.count = 0;
  }

  /**
   * Converts the queue to a native JavaScript Array in FIFO order.
   * Does not mutate or empty the queue.
   *
   * @returns {T[]} Array of queued items in FIFO order.
   */
  toArray() {
    const items = [];
    let current = this.head;
    while (current !== null) {
      items.push(current.value);
      current = current.next;
    }
    return items;
  }

  /**
   * Allows iterating over queue items in FIFO order without dequeueing.
   *
   * @generator
   * @yields {T}
   */
  *[Symbol.iterator]() {
    let current = this.head;
    while (current !== null) {
      yield current.value;
      current = current.next;
    }
  }
}

export default FIFOQueue;
