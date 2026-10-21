import { OrderBook } from './order-book.js';

/**
 * @typedef {'BID' | 'ASK'} Side
 */

/**
 * @typedef {Object} Order
 * @property {string} id - Unique identifier for the order.
 * @property {Side} [side] - 'BID' or 'ASK'.
 * @property {number} price - Positive safe integer price in ticks/minor units.
 * @property {number} remainingQuantity - Positive safe integer representing unfilled quantity.
 * @property {string} [userId] - Optional identifier of the user submitting the order.
 */

/**
 * @typedef {Object} ProposedExecution
 * @property {string} incomingOrderId - The ID of the incoming aggressive order.
 * @property {string} restingOrderId - The ID of the passive resting order in the book.
 * @property {number} price - Execution price (strictly equal to the resting order's price).
 * @property {number} quantity - Quantity proposed for execution.
 * @property {number} restingOrderRemainingAfterExecution - Simulated remaining quantity of the resting order.
 * @property {string} [incomingUserId] - The userId of the incoming order, if present.
 * @property {string} [restingUserId] - The userId of the resting order, if present.
 */

/**
 * @typedef {'FILLED' | 'LIMIT_PRICE_REACHED' | 'NO_MORE_LIQUIDITY' | 'SELF_TRADE_PREVENTION'} StoppedReason
 */

/**
 * @typedef {Object} MatchingPlan
 * @property {ProposedExecution[]} executions - Ordered sequence of proposed executions in price-time priority.
 * @property {number} matchedQuantity - Total quantity proposed for execution.
 * @property {number} remainingQuantity - Simulated unfilled quantity remaining on the incoming order.
 * @property {boolean} fullyFilled - True if the incoming order was completely filled (remainingQuantity === 0).
 * @property {boolean} wouldRest - True if the incoming limit order has unfilled quantity that would rest in the book.
 * @property {StoppedReason} stoppedReason - Reason why matching terminated.
 */

/**
 * Pure matching strategy implementing Price-Time Priority (FIFO execution at each price level).
 *
 * Computes a deterministic execution plan for an incoming limit order against an existing `OrderBook`.
 *
 * Guarantees:
 * 1. PURE CALCULATION: Does not mutate the incoming order, resting orders, or the live OrderBook.
 * 2. PRICE-TIME PRIORITY:
 *    - Incoming BID matches against lowest ASK prices first, in FIFO order at each price level.
 *    - Incoming ASK matches against highest BID prices first, in FIFO order at each price level.
 * 3. EXECUTION PRICE: Trades occur at the passive resting order's price tick.
 * 4. SELF-TRADE PREVENTION: If incoming order and an eligible resting order share the same non-empty
 *    userId, matching stops immediately without skipping ahead in the queue.
 * 5. LIMIT PROTECTION: Orders never execute outside the incoming order's limit price.
 */
export class PriceTimePriority {
  /**
   * Initializes the PriceTimePriority strategy.
   */
  constructor() {
    // Pure strategy without internal state
  }

  /**
   * Validates the input OrderBook instance.
   *
   * @private
   * @param {*} book - The order book to validate.
   * @throws {TypeError} If book is invalid.
   */
  _validateBook(book) {
    if (!book || typeof book !== 'object') {
      throw new TypeError('book must be a valid OrderBook instance');
    }
    if (
      typeof book.getOrders !== 'function' ||
      typeof book.getOrder !== 'function' ||
      typeof book.size !== 'function'
    ) {
      throw new TypeError('book must implement OrderBook interface methods');
    }
  }

  /**
   * Validates the incoming order against the matching engine order contract.
   *
   * @private
   * @param {*} order - The incoming order to validate.
   * @throws {TypeError|RangeError} If validation fails.
   */
  _validateIncomingOrder(order) {
    if (!order || typeof order !== 'object' || Array.isArray(order)) {
      throw new TypeError('Incoming order must be a non-null object');
    }

    // Validate id
    if (typeof order.id !== 'string') {
      throw new TypeError('Order id must be a string');
    }
    if (order.id.trim().length === 0) {
      throw new RangeError('Order id must be a non-empty string');
    }

    // Validate side
    if (typeof order.side !== 'string') {
      throw new TypeError('Order side must be a string');
    }
    if (order.side !== 'BID' && order.side !== 'ASK') {
      throw new RangeError('Order side must be either "BID" or "ASK"');
    }

    // Validate price
    if (typeof order.price !== 'number' || !Number.isInteger(order.price)) {
      throw new TypeError('Order price must be an integer');
    }
    if (!Number.isSafeInteger(order.price) || order.price <= 0) {
      throw new RangeError('Order price must be a positive safe integer');
    }

    // Validate remainingQuantity
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

    // Validate optional userId
    if (order.userId !== undefined && order.userId !== null) {
      if (typeof order.userId !== 'string') {
        throw new TypeError('userId must be a string');
      }
    }
  }

  /**
   * Computes a deterministic execution plan for an incoming limit order.
   *
   * Does NOT mutate the live OrderBook, resting orders, or incoming order.
   *
   * @param {OrderBook} book - The active OrderBook for the market.
   * @param {Order} incomingOrder - The incoming limit order to simulate.
   * @returns {MatchingPlan} The computed matching execution plan.
   * @throws {TypeError|RangeError} If inputs violate contracts.
   * @throws {Error} If incoming order ID already exists in the OrderBook.
   */
  calculate(book, incomingOrder) {
    this._validateBook(book);
    this._validateIncomingOrder(incomingOrder);

    // Reject duplicate order ID already resting in the book
    if (book.getOrder(incomingOrder.id) !== null) {
      throw new Error(
        `Order with ID "${incomingOrder.id}" already exists in the OrderBook`
      );
    }

    const isBid = incomingOrder.side === 'BID';
    const oppositeSide = isBid ? 'ASK' : 'BID';

    // getOrders() returns resting orders in strict price-time priority:
    // ASK: lowest price first, FIFO within each level
    // BID: highest price first, FIFO within each level
    const restingOrders = book.getOrders(oppositeSide);

    /** @type {ProposedExecution[]} */
    const executions = [];
    let matchedQuantity = 0;
    let simulatedRemaining = incomingOrder.remainingQuantity;
    /** @type {StoppedReason} */
    let stoppedReason = 'NO_MORE_LIQUIDITY';

    const incomingUserId =
      typeof incomingOrder.userId === 'string' && incomingOrder.userId.trim().length > 0
        ? incomingOrder.userId.trim()
        : null;

    for (let i = 0; i < restingOrders.length; i++) {
      const restingOrder = restingOrders[i];

      // Limit price check:
      // If incoming is BID, resting ask price must be <= incoming bid price
      // If incoming is ASK, resting bid price must be >= incoming ask price
      if (isBid) {
        if (restingOrder.price > incomingOrder.price) {
          stoppedReason = 'LIMIT_PRICE_REACHED';
          break;
        }
      } else {
        if (restingOrder.price < incomingOrder.price) {
          stoppedReason = 'LIMIT_PRICE_REACHED';
          break;
        }
      }

      // Self-Trade Prevention:
      // If both incoming and resting orders have matching non-empty user IDs,
      // stop immediately. Do not skip ahead in the queue.
      const restingUserId =
        typeof restingOrder.userId === 'string' && restingOrder.userId.trim().length > 0
          ? restingOrder.userId.trim()
          : null;

      if (incomingUserId && restingUserId && incomingUserId === restingUserId) {
        stoppedReason = 'SELF_TRADE_PREVENTION';
        break;
      }

      // Propose execution
      const executionQty = Math.min(simulatedRemaining, restingOrder.remainingQuantity);

      if (executionQty <= 0) {
        break;
      }

      const restingRemaining = restingOrder.remainingQuantity - executionQty;

      executions.push({
        incomingOrderId: incomingOrder.id,
        restingOrderId: restingOrder.id,
        price: restingOrder.price,
        quantity: executionQty,
        restingOrderRemainingAfterExecution: restingRemaining,
        ...(incomingOrder.userId ? { incomingUserId: incomingOrder.userId } : {}),
        ...(restingOrder.userId ? { restingUserId: restingOrder.userId } : {}),
      });

      matchedQuantity += executionQty;
      simulatedRemaining -= executionQty;

      if (simulatedRemaining === 0) {
        stoppedReason = 'FILLED';
        break;
      }
    }

    const fullyFilled = simulatedRemaining === 0;
    // An order would rest if it has an unfilled remainder AND matching was not aborted by self-trade
    const wouldRest = simulatedRemaining > 0 && stoppedReason !== 'SELF_TRADE_PREVENTION';

    return {
      executions,
      matchedQuantity,
      remainingQuantity: simulatedRemaining,
      fullyFilled,
      wouldRest,
      stoppedReason,
    };
  }

  /**
   * Static convenience method to compute a matching plan without instantiation.
   *
   * @param {OrderBook} book - The active OrderBook.
   * @param {Order} incomingOrder - The incoming order.
   * @returns {MatchingPlan} The matching execution plan.
   */
  static calculate(book, incomingOrder) {
    return new PriceTimePriority().calculate(book, incomingOrder);
  }
}

export default PriceTimePriority;
