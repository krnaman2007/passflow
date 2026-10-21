import { OrderBookSide } from './order-book-side.js';

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
 * @typedef {Object} OrderBookConfig
 * @property {string} eventId - Unique event identifier.
 * @property {string} ticketCategoryId - Unique ticket category identifier.
 */

/**
 * @typedef {Object} CancelResult
 * @property {Order} order - The cancelled order reference.
 * @property {Side} side - Side where the order was resting ('BID' or 'ASK').
 */

/**
 * @typedef {Object} FillResult
 * @property {Order} order - The updated order reference.
 * @property {boolean} fullyFilled - True if the order was completely filled and removed.
 * @property {number} remainingQuantity - The order's new remaining unfilled quantity.
 * @property {Side} side - Side where the order was resting ('BID' or 'ASK').
 */

/**
 * @typedef {Object} OrderLookupResult
 * @property {Order} order - The resting order reference.
 * @property {Side} side - Side where the order is resting ('BID' or 'ASK').
 */

/**
 * @typedef {Object} PriceLevelDepth
 * @property {number} price - Price tick of this level.
 * @property {number} orderCount - Number of resting orders at this level.
 * @property {number} totalQuantity - Aggregate remaining quantity resting at this level.
 */

/**
 * @typedef {Object} MarketDepth
 * @property {PriceLevelDepth[]} bids - BID price levels ordered descending.
 * @property {PriceLevelDepth[]} asks - ASK price levels ordered ascending.
 */

/**
 * Represents a complete order book for a single market (event + ticket category)
 * in the PassFlow matching engine.
 *
 * Encapsulates exactly two `OrderBookSide` instances:
 * - BID: buy orders (highest price priority)
 * - ASK: sell orders (lowest price priority)
 *
 * Enforces market isolation, cross-side order ID uniqueness, and exposes unified
 * market data inspection (spread, depth snapshots, order lookup, and statistics).
 *
 * Invariant:
 * 1. Total order count = bids.size() + asks.size()
 * 2. Total quantity = bids.totalQuantity() + asks.totalQuantity()
 * 3. Every order ID is globally unique across both sides of the book.
 * 4. Spread = bestAsk - bestBid (null if either side empty; <= 0 if locked/crossed).
 */
export class OrderBook {
  /**
   * Initializes a complete OrderBook for a specific event and ticket category.
   *
   * @param {OrderBookConfig} config - Market identity parameters.
   * @throws {TypeError} If config is not an object or identifiers are not strings.
   * @throws {RangeError} If identifiers are empty or whitespace.
   */
  constructor(config) {
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
      throw new TypeError('OrderBook config must be a non-null object');
    }

    const { eventId, ticketCategoryId } = config;

    if (typeof eventId !== 'string') {
      throw new TypeError('eventId must be a string');
    }
    if (eventId.trim().length === 0) {
      throw new RangeError('eventId must be a non-empty string');
    }

    if (typeof ticketCategoryId !== 'string') {
      throw new TypeError('ticketCategoryId must be a string');
    }
    if (ticketCategoryId.trim().length === 0) {
      throw new RangeError('ticketCategoryId must be a non-empty string');
    }

    // Immutable market identifiers
    Object.defineProperty(this, 'eventId', {
      value: eventId,
      writable: false,
      enumerable: true,
      configurable: false,
    });

    Object.defineProperty(this, 'ticketCategoryId', {
      value: ticketCategoryId,
      writable: false,
      enumerable: true,
      configurable: false,
    });

    /** @type {OrderBookSide} Encapsulated BID side */
    this._bids = new OrderBookSide('BID');

    /** @type {OrderBookSide} Encapsulated ASK side */
    this._asks = new OrderBookSide('ASK');

    /** @type {Map<string, Side>} Index mapping order ID to side for O(1) side routing */
    this._orderSides = new Map();
  }

  /**
   * Helper to validate and retrieve the target OrderBookSide.
   *
   * @private
   * @param {Side} side - 'BID' or 'ASK'.
   * @returns {OrderBookSide} The corresponding side instance.
   * @throws {TypeError} If side is not a string.
   * @throws {RangeError} If side is not 'BID' or 'ASK'.
   */
  _getSide(side) {
    if (typeof side !== 'string') {
      throw new TypeError('Side must be a string');
    }
    if (side === 'BID') {
      return this._bids;
    }
    if (side === 'ASK') {
      return this._asks;
    }
    throw new RangeError('Side must be either "BID" or "ASK"');
  }

  /**
   * Adds an order to the specified side of the order book.
   *
   * Validates cross-side uniqueness and aggregate safe-integer limits.
   * Does NOT execute crossing orders (trade execution is reserved for Step 5).
   *
   * @param {Side} side - 'BID' or 'ASK'.
   * @param {Order} order - The order to add.
   * @returns {number} The updated total order count across the entire book.
   * @throws {TypeError|RangeError} If arguments or order contract are invalid.
   * @throws {Error} If order ID already exists anywhere in this OrderBook.
   */
  addOrder(side, order) {
    const targetSide = this._getSide(side);

    if (!order || typeof order !== 'object' || Array.isArray(order)) {
      throw new TypeError('Order must be a non-null object');
    }
    if (typeof order.id !== 'string') {
      throw new TypeError('Order id must be a string');
    }
    if (order.id.trim().length === 0) {
      throw new RangeError('Order id must be a non-empty string');
    }

    if (this._orderSides.has(order.id)) {
      throw new Error(`Order with ID "${order.id}" already exists in this OrderBook`);
    }

    if (this.totalQuantity() + order.remainingQuantity > Number.MAX_SAFE_INTEGER) {
      throw new RangeError('Adding order exceeds maximum safe total quantity');
    }

    // Delegate order contract validation & insertion to OrderBookSide
    targetSide.addOrder(order);

    this._orderSides.set(order.id, side);
    return this.size();
  }

  /**
   * Cancels and removes an order by ID regardless of which side it rests on.
   *
   * @param {string} orderId - Non-empty string order ID.
   * @returns {CancelResult|null} The cancelled order and its side, or null if not found.
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

    const side = this._orderSides.get(orderId);
    if (!side) {
      return null;
    }

    const cancelledOrder = this._getSide(side).cancelOrder(orderId);
    this._orderSides.delete(orderId);

    return {
      order: cancelledOrder,
      side,
    };
  }

  /**
   * Reduces an order's remaining quantity (partial or full fill).
   *
   * @param {string} orderId - Non-empty string order ID.
   * @param {number} quantity - Positive safe integer reduction quantity.
   * @returns {FillResult|null} Result with updated order and side, or null if not found.
   * @throws {TypeError|RangeError} If arguments are invalid or quantity exceeds remainingQuantity.
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

    const side = this._orderSides.get(orderId);
    if (!side) {
      return null;
    }

    const result = this._getSide(side).reduceOrderQuantity(orderId, quantity);

    if (result.fullyFilled) {
      this._orderSides.delete(orderId);
    }

    return {
      order: result.order,
      fullyFilled: result.fullyFilled,
      remainingQuantity: result.remainingQuantity,
      side,
    };
  }

  /**
   * Returns the highest bid price, or null if BID side is empty.
   *
   * @returns {number|null} Best bid price.
   */
  getBestBid() {
    return this._bids.getBestPrice();
  }

  /**
   * Returns the lowest ask price, or null if ASK side is empty.
   *
   * @returns {number|null} Best ask price.
   */
  getBestAsk() {
    return this._asks.getBestPrice();
  }

  /**
   * Returns the PriceLevel at the highest bid price, or null if BID side is empty.
   *
   * @returns {import('./price-level.js').PriceLevel|null}
   */
  getBestBidLevel() {
    return this._bids.getBestLevel();
  }

  /**
   * Returns the PriceLevel at the lowest ask price, or null if ASK side is empty.
   *
   * @returns {import('./price-level.js').PriceLevel|null}
   */
  getBestAskLevel() {
    return this._asks.getBestLevel();
  }

  /**
   * Calculates the current bid-ask spread: bestAsk - bestBid.
   *
   * Returns null if either side is empty.
   * Note: The spread may be zero (locked book) or negative (crossed book)
   * at this stage because trade matching is deferred to Step 5.
   *
   * @returns {number|null} Spread in minor units / ticks, or null if empty.
   */
  getSpread() {
    const bestBid = this._bids.getBestPrice();
    const bestAsk = this._asks.getBestPrice();

    if (bestBid === null || bestAsk === null) {
      return null;
    }

    return bestAsk - bestBid;
  }

  /**
   * Returns a snapshot of market depth on both sides of the book.
   *
   * - Bids: ordered descending (highest to lowest).
   * - Asks: ordered ascending (lowest to highest).
   *
   * @returns {MarketDepth} Detached market depth snapshot.
   */
  getDepth() {
    return {
      bids: this._bids.getDepth(),
      asks: this._asks.getDepth(),
    };
  }

  /**
   * Looks up a resting order by ID across both sides of the book.
   *
   * @param {string} orderId - Non-empty string order ID.
   * @returns {OrderLookupResult|null} Order and its side, or null if not found.
   * @throws {TypeError} If orderId is not a string.
   * @throws {RangeError} If orderId is empty or whitespace.
   */
  getOrder(orderId) {
    if (typeof orderId !== 'string') {
      throw new TypeError('Order ID must be a string');
    }
    if (orderId.trim().length === 0) {
      throw new RangeError('Order ID must be a non-empty string');
    }

    const side = this._orderSides.get(orderId);
    if (!side) {
      return null;
    }

    const order = this._getSide(side).getOrder(orderId);
    if (!order) {
      return null;
    }

    return {
      order,
      side,
    };
  }

  /**
   * Returns all resting orders for the specified side in price-time priority.
   *
   * @param {Side} side - 'BID' or 'ASK'.
   * @returns {Order[]} Array of orders.
   * @throws {TypeError|RangeError} If side is invalid.
   */
  getOrders(side) {
    return this._getSide(side).getOrders();
  }

  /**
   * Returns statistics for a specific side of the order book.
   *
   * @param {Side} side - 'BID' or 'ASK'.
   * @returns {{ side: Side, orderCount: number, totalQuantity: number, levelCount: number }}
   * @throws {TypeError|RangeError} If side is invalid.
   */
  getSideStats(side) {
    const target = this._getSide(side);
    return {
      side,
      orderCount: target.size(),
      totalQuantity: target.totalQuantity(),
      levelCount: target.levelCount(),
    };
  }

  /**
   * Returns comprehensive market statistics across both sides of the book.
   *
   * @returns {Object} Comprehensive market statistics snapshot.
   */
  getStats() {
    return {
      eventId: this.eventId,
      ticketCategoryId: this.ticketCategoryId,
      orderCount: this.size(),
      totalQuantity: this.totalQuantity(),
      bids: {
        orderCount: this._bids.size(),
        totalQuantity: this._bids.totalQuantity(),
        levelCount: this._bids.levelCount(),
        bestPrice: this._bids.getBestPrice(),
      },
      asks: {
        orderCount: this._asks.size(),
        totalQuantity: this._asks.totalQuantity(),
        levelCount: this._asks.levelCount(),
        bestPrice: this._asks.getBestPrice(),
      },
      spread: this.getSpread(),
    };
  }

  /**
   * Returns the total number of resting orders across both sides.
   *
   * @returns {number} Total order count (O(1)).
   */
  size() {
    return this._bids.size() + this._asks.size();
  }

  /**
   * Returns the aggregate remaining quantity across both sides.
   *
   * @returns {number} Total remaining quantity (O(1)).
   */
  totalQuantity() {
    return this._bids.totalQuantity() + this._asks.totalQuantity();
  }

  /**
   * Indicates whether a specific side has no resting orders.
   *
   * @param {Side} side - 'BID' or 'ASK'.
   * @returns {boolean} True if the side is empty, false otherwise.
   * @throws {TypeError|RangeError} If side is invalid.
   */
  isSideEmpty(side) {
    return this._getSide(side).isEmpty();
  }

  /**
   * Indicates whether the entire order book has zero orders on both sides.
   *
   * @returns {boolean} True if both BID and ASK sides are empty, false otherwise.
   */
  isEmpty() {
    return this._bids.isEmpty() && this._asks.isEmpty();
  }
}

export default OrderBook;
