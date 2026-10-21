import { FIFOQueue } from './fifo-queue.js';

/**
 * @typedef {Object} Order
 * @property {string} id - Unique identifier for the order within the PriceLevel.
 * @property {number} price - Positive safe integer price in ticks/minor units.
 * @property {number} remainingQuantity - Positive safe integer representing unfilled quantity.
 */

/**
 * @typedef {Object} FillResult
 * @property {Order} order - The updated order reference.
 * @property {boolean} fullyFilled - True if the order was completely filled and removed.
 * @property {number} remainingQuantity - The order's new remaining unfilled quantity.
 */

/**
 * Represents a discrete price level in the PassFlow matching engine order book.
 *
 * A PriceLevel manages all resting limit orders at an identical price tick,
 * preserving strict time priority (FIFO) using `FIFOQueue`. It also tracks
 * the aggregate remaining quantity resting at this level in O(1) time.
 *
 * Invariant:
 *   `totalQuantity === sum(order.remainingQuantity for all resting orders)`
 *
 * NOTE on Object References:
 *   Orders are stored by reference so that fill updates made by the matching
 *   engine are directly reflected on caller order instances. Callers MUST NOT
 *   directly mutate `remainingQuantity` on an order while it rests in a PriceLevel;
 *   any adjustments must be made via `reduceOrderQuantity()`.
 */
export class PriceLevel {
  /**
   * Initializes a PriceLevel at a fixed, immutable price tick.
   *
   * @param {number} price - Positive safe integer price for this level.
   * @throws {TypeError} If price is not an integer number.
   * @throws {RangeError} If price is not a positive safe integer (> 0).
   */
  constructor(price) {
    if (typeof price !== 'number' || !Number.isInteger(price)) {
      throw new TypeError('Price must be an integer');
    }
    if (!Number.isSafeInteger(price) || price <= 0) {
      throw new RangeError('Price must be a positive safe integer');
    }

    // Immutable price property
    Object.defineProperty(this, 'price', {
      value: price,
      writable: false,
      enumerable: true,
      configurable: false,
    });

    /** @type {FIFOQueue<Order>} Underlying queue maintaining FIFO order */
    this._queue = new FIFOQueue();

    /** @type {number} Aggregate remaining quantity across all resting orders */
    this._totalQuantity = 0;

    /** @type {Map<string, Order>} Fast index for ID lookups and duplicate checks */
    this._ordersById = new Map();
  }

  /**
   * Validates an order against the PriceLevel order contract.
   *
   * @private
   * @param {*} order - The order object to validate.
   * @throws {TypeError} If structure or types violate the contract.
   * @throws {RangeError} If values are non-positive or outside safe limits.
   */
  _validateOrder(order) {
    if (!order || typeof order !== 'object' || Array.isArray(order)) {
      throw new TypeError('Order must be a non-null object');
    }

    // Validate id
    if (typeof order.id !== 'string') {
      throw new TypeError('Order id must be a string');
    }
    if (order.id.trim().length === 0) {
      throw new RangeError('Order id must be a non-empty string');
    }

    // Validate price
    if (typeof order.price !== 'number' || !Number.isInteger(order.price)) {
      throw new TypeError('Order price must be an integer');
    }
    if (!Number.isSafeInteger(order.price) || order.price <= 0) {
      throw new RangeError('Order price must be a positive safe integer');
    }
    if (order.price !== this.price) {
      throw new RangeError(
        `Order price (${order.price}) does not match price level (${this.price})`
      );
    }

    // Validate remainingQuantity (do not substitute with 'quantity')
    if (
      typeof order.remainingQuantity !== 'number' ||
      !Number.isInteger(order.remainingQuantity)
    ) {
      throw new TypeError('Order remainingQuantity must be an integer');
    }
    if (
      !Number.isSafeInteger(order.remainingQuantity) ||
      order.remainingQuantity <= 0
    ) {
      throw new RangeError('Order remainingQuantity must be a positive safe integer');
    }
  }

  /**
   * Appends an order to the end of the queue if valid and unique.
   *
   * @param {Order} order - The order to add.
   * @returns {number} The updated number of resting orders in this price level.
   * @throws {TypeError|RangeError} If the order contract is violated.
   * @throws {Error} If an order with the same ID already exists in this level.
   * @throws {RangeError} If adding this order would cause aggregate quantity overflow.
   */
  addOrder(order) {
    this._validateOrder(order);

    if (this._ordersById.has(order.id)) {
      throw new Error(`Order with ID "${order.id}" already exists in this PriceLevel`);
    }

    if (this._totalQuantity + order.remainingQuantity > Number.MAX_SAFE_INTEGER) {
      throw new RangeError('Adding order exceeds maximum safe total quantity');
    }

    this._queue.enqueue(order);
    this._ordersById.set(order.id, order);
    this._totalQuantity += order.remainingQuantity;

    return this._queue.size();
  }

  /**
   * Returns the oldest resting order without removing it.
   *
   * @returns {Order|null} The oldest order, or null if the level is empty.
   */
  peek() {
    return this._queue.peek();
  }

  /**
   * Removes and returns the oldest resting order (FIFO head).
   * Decreases the aggregate remaining quantity accordingly.
   *
   * @returns {Order|null} The removed oldest order, or null if empty.
   */
  removeOldest() {
    if (this._queue.isEmpty()) {
      return null;
    }

    const order = this._queue.dequeue();
    this._ordersById.delete(order.id);
    this._totalQuantity -= order.remainingQuantity;

    if (this._totalQuantity < 0) {
      this._totalQuantity = 0;
    }

    return order;
  }

  /**
   * Cancels and removes an order by its unique ID.
   *
   * Preserves the relative FIFO ordering of all remaining orders.
   *
   * @param {string} orderId - The non-empty string ID of the order to cancel.
   * @returns {Order|null} The cancelled order, or null if not found.
   * @throws {TypeError} If orderId is not a string.
   * @throws {RangeError} If orderId is an empty or whitespace string.
   */
  cancelOrder(orderId) {
    if (typeof orderId !== 'string') {
      throw new TypeError('Order ID must be a string');
    }
    if (orderId.trim().length === 0) {
      throw new RangeError('Order ID must be a non-empty string');
    }

    const order = this._ordersById.get(orderId);
    if (!order) {
      return null;
    }

    this._ordersById.delete(orderId);
    this._queue.remove(order);
    this._totalQuantity -= order.remainingQuantity;

    if (this._totalQuantity < 0) {
      this._totalQuantity = 0;
    }

    return order;
  }

  /**
   * Reduces an order's remaining quantity (modeling a fill).
   *
   * If the reduction equals the order's remaining quantity, the order is
   * completely filled, unlinked from the queue, and removed from the index.
   * Otherwise, the order remains resting at its original FIFO position with
   * its reduced remainingQuantity.
   *
   * @param {string} orderId - The non-empty string ID of the order.
   * @param {number} quantity - Positive safe integer reduction quantity.
   * @returns {FillResult|null} Fill result object, or null if order not found.
   * @throws {TypeError} If arguments have invalid types.
   * @throws {RangeError} If quantity is non-positive or exceeds remainingQuantity.
   */
  reduceOrderQuantity(orderId, quantity) {
    if (typeof orderId !== 'string') {
      throw new TypeError('Order ID must be a string');
    }
    if (orderId.trim().length === 0) {
      throw new RangeError('Order ID must be a non-empty string');
    }

    if (typeof quantity !== 'number' || !Number.isInteger(quantity)) {
      throw new TypeError('Quantity must be an integer');
    }
    if (!Number.isSafeInteger(quantity) || quantity <= 0) {
      throw new RangeError('Quantity must be a positive safe integer');
    }

    const order = this._ordersById.get(orderId);
    if (!order) {
      return null;
    }

    if (quantity > order.remainingQuantity) {
      throw new RangeError(
        `Reduction quantity (${quantity}) exceeds order remaining quantity (${order.remainingQuantity})`
      );
    }

    order.remainingQuantity -= quantity;
    this._totalQuantity -= quantity;

    if (this._totalQuantity < 0) {
      this._totalQuantity = 0;
    }

    if (order.remainingQuantity === 0) {
      this._ordersById.delete(orderId);
      this._queue.remove(order);
      return {
        order,
        fullyFilled: true,
        remainingQuantity: 0,
      };
    }

    return {
      order,
      fullyFilled: false,
      remainingQuantity: order.remainingQuantity,
    };
  }

  /**
   * Returns the aggregate remaining quantity across all resting orders.
   *
   * @returns {number} Aggregate remaining quantity (O(1)).
   */
  totalQuantity() {
    return this._totalQuantity;
  }

  /**
   * Returns the number of resting orders in this price level.
   *
   * @returns {number} Order count (O(1)).
   */
  size() {
    return this._queue.size();
  }

  /**
   * Indicates whether this price level contains zero orders.
   *
   * @returns {boolean} True if empty, false otherwise (O(1)).
   */
  isEmpty() {
    return this._queue.isEmpty();
  }

  /**
   * Returns an array of resting orders in FIFO sequence.
   * Does not mutate or empty the level.
   *
   * @returns {Order[]} Array of orders.
   */
  toArray() {
    return this._queue.toArray();
  }

  /**
   * Allows iterating over resting orders in FIFO order without mutating.
   *
   * @generator
   * @yields {Order}
   */
  *[Symbol.iterator]() {
    yield* this._queue;
  }
}

export default PriceLevel;
