import { PriceLevel } from './price-level.js';

/**
 * @typedef {'BID' | 'ASK'} Side
 */

/**
 * @typedef {Object} Order
 * @property {string} id - Unique identifier for the order.
 * @property {number} price - Positive safe integer price in ticks/minor units.
 * @property {number} remainingQuantity - Positive safe integer representing unfilled quantity.
 */

/**
 * @typedef {Object} PriceLevelDepth
 * @property {number} price - Price tick of this level.
 * @property {number} orderCount - Number of resting orders at this level.
 * @property {number} totalQuantity - Aggregate remaining quantity resting at this level.
 */

/**
 * @typedef {Object} FillResult
 * @property {Order} order - The updated order reference.
 * @property {boolean} fullyFilled - True if the order was completely filled and removed.
 * @property {number} remainingQuantity - The order's new remaining unfilled quantity.
 */

/**
 * Manages one side of an order book (either BID or ASK) in the PassFlow matching engine.
 *
 * Enforces price-time priority across price levels:
 * - BID: higher prices have priority (descending price order).
 * - ASK: lower prices have priority (ascending price order).
 *
 * Each price level is represented by a `PriceLevel` instance maintaining a FIFO queue.
 *
 * Price Level Storage Strategy:
 * - Fast Map (`_levels`): maps price -> `PriceLevel` for O(1) level lookups.
 * - Sorted Array (`_prices`): maintained in priority order via binary search.
 *   - BID: sorted descending (index 0 is highest price).
 *   - ASK: sorted ascending (index 0 is lowest price).
 *   - Best price and best level are accessed in O(1) time at index 0.
 *   - New price level insertion and empty level removal are O(L) where L is the number of price levels.
 * - Order ID Index (`_orderLocations`): maps orderId -> { price, order } for O(1) order location.
 *
 * Invariants maintained:
 * 1. `totalQuantity === sum(order.remainingQuantity for all resting orders)`
 * 2. `size === total number of resting orders`
 * 3. `levelCount === number of non-empty price levels`
 * 4. Empty price levels are immediately evicted.
 * 5. Best price and depth strictly adhere to side priority.
 */
export class OrderBookSide {
  /**
   * Initializes an empty OrderBookSide.
   *
   * @param {Side} side - Side type: must be exactly 'BID' or 'ASK'.
   * @throws {TypeError} If side is not a string.
   * @throws {RangeError} If side is not 'BID' or 'ASK'.
   */
  constructor(side) {
    if (typeof side !== 'string') {
      throw new TypeError('Side must be a string');
    }
    if (side !== 'BID' && side !== 'ASK') {
      throw new RangeError('Side must be either "BID" or "ASK"');
    }

    // Immutable side property
    Object.defineProperty(this, 'side', {
      value: side,
      writable: false,
      enumerable: true,
      configurable: false,
    });

    /** @type {number} Aggregate remaining quantity across all levels */
    this._totalQuantity = 0;

    /** @type {number} Total number of resting orders across all levels */
    this._orderCount = 0;

    /** @type {Map<number, PriceLevel>} Map of price tick to PriceLevel */
    this._levels = new Map();

    /** @type {number[]} Prices sorted in priority order (BID: descending, ASK: ascending) */
    this._prices = [];

    /** @type {Map<string, { price: number, order: Order }>} Maps orderId to price and order */
    this._orderLocations = new Map();

    /**
     * Comparator for priority ordering:
     * BID: (a, b) => b - a (highest first)
     * ASK: (a, b) => a - b (lowest first)
     *
     * @private
     */
    this._comparator = side === 'BID' ? (a, b) => b - a : (a, b) => a - b;
  }

  /**
   * Finds the insertion index for a price in `_prices` using binary search.
   *
   * @private
   * @param {number} targetPrice - Price to insert.
   * @returns {number} The insertion index.
   */
  _findInsertIndex(targetPrice) {
    let low = 0;
    let high = this._prices.length - 1;

    while (low <= high) {
      const mid = (low + high) >>> 1;
      const cmp = this._comparator(this._prices[mid], targetPrice);

      if (cmp === 0) {
        return mid;
      } else if (cmp < 0) {
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    return low;
  }

  /**
   * Finds the exact index of an existing price in `_prices` using binary search.
   *
   * @private
   * @param {number} targetPrice - Price to find.
   * @returns {number} The index if found, or -1 if absent.
   */
  _findExactIndex(targetPrice) {
    let low = 0;
    let high = this._prices.length - 1;

    while (low <= high) {
      const mid = (low + high) >>> 1;
      const cmp = this._comparator(this._prices[mid], targetPrice);

      if (cmp === 0) {
        return mid;
      } else if (cmp < 0) {
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    return -1;
  }

  /**
   * Adds a newly created PriceLevel into the sorted price array and level map.
   *
   * @private
   * @param {number} price - Level price.
   * @param {PriceLevel} level - PriceLevel instance.
   */
  _addLevel(price, level) {
    this._levels.set(price, level);
    const index = this._findInsertIndex(price);
    this._prices.splice(index, 0, price);
  }

  /**
   * Evicts an empty PriceLevel from the level map and sorted price array.
   *
   * @private
   * @param {number} price - Level price to evict.
   */
  _removeLevel(price) {
    this._levels.delete(price);
    const index = this._findExactIndex(price);
    if (index !== -1) {
      this._prices.splice(index, 1);
    }
  }

  /**
   * Validates an order against the order contract.
   *
   * @private
   * @param {*} order - The order to validate.
   * @throws {TypeError|RangeError} If validation fails.
   */
  _validateOrder(order) {
    if (!order || typeof order !== 'object' || Array.isArray(order)) {
      throw new TypeError('Order must be a non-null object');
    }

    if (typeof order.id !== 'string') {
      throw new TypeError('Order id must be a string');
    }
    if (order.id.trim().length === 0) {
      throw new RangeError('Order id must be a non-empty string');
    }

    if (typeof order.price !== 'number' || !Number.isInteger(order.price)) {
      throw new TypeError('Order price must be an integer');
    }
    if (!Number.isSafeInteger(order.price) || order.price <= 0) {
      throw new RangeError('Order price must be a positive safe integer');
    }

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
   * Adds an order to this order book side.
   *
   * Finds the matching PriceLevel or creates one if none exists.
   * Updates aggregate quantity, order count, and ID index.
   *
   * @param {Order} order - The order to add.
   * @returns {number} The updated total order count on this side.
   * @throws {TypeError|RangeError} If order contract is violated.
   * @throws {Error} If an order with the same ID already exists on this side.
   * @throws {RangeError} If adding this order would exceed Number.MAX_SAFE_INTEGER total quantity.
   */
  addOrder(order) {
    this._validateOrder(order);

    if (this._orderLocations.has(order.id)) {
      throw new Error(`Order with ID "${order.id}" already exists on this side`);
    }

    if (this._totalQuantity + order.remainingQuantity > Number.MAX_SAFE_INTEGER) {
      throw new RangeError('Adding order exceeds maximum safe total quantity');
    }

    let level = this._levels.get(order.price);
    let isNewLevel = false;

    if (!level) {
      level = new PriceLevel(order.price);
      isNewLevel = true;
    }

    // addOrder on PriceLevel enforces remainingQuantity invariants
    level.addOrder(order);

    if (isNewLevel) {
      this._addLevel(order.price, level);
    }

    this._orderLocations.set(order.id, { price: order.price, order });
    this._orderCount++;
    this._totalQuantity += order.remainingQuantity;

    return this._orderCount;
  }

  /**
   * Returns the best available price on this side (highest for BID, lowest for ASK).
   *
   * @returns {number|null} The best price, or null if the side is empty.
   */
  getBestPrice() {
    if (this._prices.length === 0) {
      return null;
    }
    return this._prices[0];
  }

  /**
   * Returns the PriceLevel at the best available price.
   *
   * @returns {PriceLevel|null} The best PriceLevel, or null if empty.
   */
  getBestLevel() {
    if (this._prices.length === 0) {
      return null;
    }
    return this._levels.get(this._prices[0]) || null;
  }

  /**
   * Returns the PriceLevel for a specific price tick.
   *
   * @param {number} price - Positive safe integer price.
   * @returns {PriceLevel|null} The PriceLevel if present, or null.
   * @throws {TypeError} If price is not an integer number.
   * @throws {RangeError} If price is not a positive safe integer.
   */
  getLevel(price) {
    if (typeof price !== 'number' || !Number.isInteger(price)) {
      throw new TypeError('Price must be an integer');
    }
    if (!Number.isSafeInteger(price) || price <= 0) {
      throw new RangeError('Price must be a positive safe integer');
    }

    return this._levels.get(price) || null;
  }

  /**
   * Cancels and removes an order by its ID, regardless of its price level.
   *
   * If the cancellation leaves the price level empty, the level is removed.
   *
   * @param {string} orderId - Non-empty string order ID.
   * @returns {Order|null} The cancelled order, or null if not found.
   * @throws {TypeError} If orderId is not a string.
   * @throws {RangeError} If orderId is empty or whitespace.
   */
  cancelOrder(orderId) {
    if (typeof orderId !== 'string') {
      throw new TypeError('Order ID must be a string');
    }
    if (orderId.trim().length === 0) {
      throw new RangeError('Order ID must be a non-empty string');
    }

    const loc = this._orderLocations.get(orderId);
    if (!loc) {
      return null;
    }

    const level = this._levels.get(loc.price);
    const cancelledOrder = level.cancelOrder(orderId);

    this._orderLocations.delete(orderId);
    this._orderCount--;
    this._totalQuantity -= cancelledOrder.remainingQuantity;

    if (this._totalQuantity < 0) {
      this._totalQuantity = 0;
    }

    if (level.isEmpty()) {
      this._removeLevel(loc.price);
    }

    return cancelledOrder;
  }

  /**
   * Reduces an order's remaining quantity (partial or full fill).
   *
   * Delegates fill execution to the underlying PriceLevel.
   * If the order becomes fully filled, it is evicted from the side indexes,
   * and its PriceLevel is removed if empty.
   *
   * @param {string} orderId - Non-empty string order ID.
   * @param {number} quantity - Positive safe integer reduction quantity.
   * @returns {FillResult|null} Fill result object, or null if order not found.
   * @throws {TypeError|RangeError} If arguments are invalid.
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

    const loc = this._orderLocations.get(orderId);
    if (!loc) {
      return null;
    }

    const level = this._levels.get(loc.price);
    const result = level.reduceOrderQuantity(orderId, quantity);

    this._totalQuantity -= quantity;
    if (this._totalQuantity < 0) {
      this._totalQuantity = 0;
    }

    if (result.fullyFilled) {
      this._orderCount--;
      this._orderLocations.delete(orderId);

      if (level.isEmpty()) {
        this._removeLevel(loc.price);
      }
    }

    return result;
  }

  /**
   * Removes and returns the oldest resting order at the best price level.
   *
   * If the best level becomes empty, it is evicted.
   *
   * @returns {Order|null} Oldest order at best price level, or null if empty.
   */
  removeBestOrder() {
    if (this._prices.length === 0) {
      return null;
    }

    const bestPrice = this._prices[0];
    const level = this._levels.get(bestPrice);
    const order = level.removeOldest();

    if (!order) {
      return null;
    }

    this._orderCount--;
    this._totalQuantity -= order.remainingQuantity;
    if (this._totalQuantity < 0) {
      this._totalQuantity = 0;
    }

    this._orderLocations.delete(order.id);

    if (level.isEmpty()) {
      this._removeLevel(bestPrice);
    }

    return order;
  }

  /**
   * Returns total remaining quantity across all resting orders on this side.
   *
   * @returns {number} Total remaining quantity (O(1)).
   */
  totalQuantity() {
    return this._totalQuantity;
  }

  /**
   * Returns total number of resting orders on this side.
   *
   * @returns {number} Total resting order count (O(1)).
   */
  size() {
    return this._orderCount;
  }

  /**
   * Returns the number of active, non-empty price levels.
   *
   * @returns {number} Active level count (O(1)).
   */
  levelCount() {
    return this._prices.length;
  }

  /**
   * Indicates whether this side has no resting orders.
   *
   * @returns {boolean} True if empty, false otherwise (O(1)).
   */
  isEmpty() {
    return this._orderCount === 0;
  }

  /**
   * Returns an ordered snapshot of price levels in priority order.
   *
   * BID: descending prices (highest to lowest).
   * ASK: ascending prices (lowest to highest).
   *
   * Each entry contains { price, orderCount, totalQuantity }.
   * Note: The returned array and its objects are a detached snapshot.
   *
   * @returns {PriceLevelDepth[]} Ordered array of price level depth entries.
   */
  getDepth() {
    const depth = [];
    for (let i = 0; i < this._prices.length; i++) {
      const price = this._prices[i];
      const level = this._levels.get(price);
      if (level && !level.isEmpty()) {
        depth.push({
          price: level.price,
          orderCount: level.size(),
          totalQuantity: level.totalQuantity(),
        });
      }
    }
    return depth;
  }

  /**
   * Returns all resting orders ordered by price priority and FIFO within each level.
   *
   * BID: highest-price orders first, FIFO within each price.
   * ASK: lowest-price orders first, FIFO within each price.
   *
   * @returns {Order[]} Array of all resting orders in price-time priority.
   */
  getOrders() {
    const orders = [];
    for (let i = 0; i < this._prices.length; i++) {
      const price = this._prices[i];
      const level = this._levels.get(price);
      if (level) {
        for (const order of level) {
          orders.push(order);
        }
      }
    }
    return orders;
  }

  /**
   * Returns a resting order by its unique ID.
   *
   * @param {string} orderId - Non-empty string order ID.
   * @returns {Order|null} The order if resting on this side, or null.
   */
  getOrder(orderId) {
    if (typeof orderId !== 'string' || orderId.trim().length === 0) {
      return null;
    }
    const loc = this._orderLocations.get(orderId);
    return loc ? loc.order : null;
  }

  /**
   * Indicates whether an order ID exists on this side.
   *
   * @param {string} orderId - Non-empty string order ID.
   * @returns {boolean} True if order is present, false otherwise.
   */
  hasOrder(orderId) {
    if (typeof orderId !== 'string' || orderId.trim().length === 0) {
      return false;
    }
    return this._orderLocations.has(orderId);
  }

  /**
   * Iterates through all resting orders in price-time priority sequence.
   *
   * @generator
   * @yields {Order}
   */
  *[Symbol.iterator]() {
    for (let i = 0; i < this._prices.length; i++) {
      const price = this._prices[i];
      const level = this._levels.get(price);
      if (level) {
        yield* level;
      }
    }
  }
}

export default OrderBookSide;
