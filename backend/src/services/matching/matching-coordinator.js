import { PriceTimePriority } from './price-time-priority.js';
import { OrderBook } from './order-book.js';

/**
 * @typedef {'BID' | 'ASK'} Side
 */

/**
 * @typedef {'FILLED' | 'PARTIALLY_FILLED' | 'RESTING' | 'CANCELLED'} OrderLifecycleStatus
 */

/**
 * @typedef {Object} Order
 * @property {string} id - Unique identifier for the order.
 * @property {Side} side - 'BID' or 'ASK'.
 * @property {number} price - Positive safe integer price in ticks/minor units.
 * @property {number} remainingQuantity - Positive safe integer representing unfilled quantity.
 * @property {string} [userId] - Optional identifier of user submitting order.
 * @property {string} [eventId] - Optional event identifier.
 * @property {string} [ticketCategoryId] - Optional ticket category identifier.
 */

/**
 * @typedef {Object} ExecutionResult
 * @property {string} incomingOrderId - ID of the incoming aggressive order.
 * @property {string} restingOrderId - ID of the passive resting order in the book.
 * @property {number} price - Execution price (resting order's price).
 * @property {number} quantity - Quantity filled in this execution.
 * @property {number} restingOrderRemainingAfterExecution - Unfilled quantity left on resting order.
 * @property {string} [incomingUserId] - User ID of incoming order if provided.
 * @property {string} [restingUserId] - User ID of resting order if provided.
 */

/**
 * @typedef {Object} SubmissionResult
 * @property {string} incomingOrderId - The incoming order ID.
 * @property {Side} side - Side of the incoming order ('BID' or 'ASK').
 * @property {OrderLifecycleStatus} status - Final lifecycle status.
 * @property {ExecutionResult[]} executions - Sequence of applied executions.
 * @property {number} matchedQuantity - Total quantity executed against resting orders.
 * @property {number} remainingQuantity - Unfilled incoming quantity remaining after matching.
 * @property {number} restedQuantity - Quantity added to rest in the live order book.
 * @property {string} stoppedReason - Reason matching stopped.
 */

/**
 * Coordinates the in-memory matching lifecycle between an incoming limit order,
 * a pure matching strategy (`PriceTimePriority`), and a live `OrderBook`.
 *
 * Execution sequence:
 * 1. Validate inputs (book, order contract, market ID matching).
 * 2. Calculate matching plan using the injected or default strategy.
 * 3. Validate plan integrity against live book state before mutating anything.
 * 4. Apply executions sequentially using OrderBook public methods (`reduceOrderQuantity`).
 * 5. Handle incoming order lifecycle (rest unfilled remainder, handle STP cancellation).
 * 6. Return comprehensive, detached execution outcome.
 *
 * Invariant: Synchronous in-memory execution only. Zero DB, wallet, or settlement side-effects.
 */
export class MatchingCoordinator {
  /**
   * Initializes the MatchingCoordinator with an optional matching strategy.
   *
   * @param {Object} [options] - Configuration options.
   * @param {Object} [options.strategy] - Strategy implementing `calculate(book, incomingOrder)`. Defaults to PriceTimePriority.
   * @throws {TypeError} If provided strategy is invalid.
   */
  constructor({ strategy = new PriceTimePriority() } = {}) {
    if (!strategy || typeof strategy !== 'object' || typeof strategy.calculate !== 'function') {
      throw new TypeError('strategy must be an object with a calculate method');
    }

    /** @type {Object} The matching strategy */
    this.strategy = strategy;
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
      typeof book.getOrder !== 'function' ||
      typeof book.reduceOrderQuantity !== 'function' ||
      typeof book.addOrder !== 'function' ||
      typeof book.size !== 'function'
    ) {
      throw new TypeError('book must implement OrderBook interface methods');
    }
  }

  /**
   * Validates the incoming limit order contract.
   *
   * @private
   * @param {OrderBook} book - The target OrderBook.
   * @param {*} order - The incoming order.
   * @throws {TypeError|RangeError|Error} If validation fails.
   */
  _validateIncomingOrder(book, order) {
    if (!order || typeof order !== 'object' || Array.isArray(order)) {
      throw new TypeError('Incoming order must be a non-null object');
    }

    // Validate ID
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

    // Validate optional market identifiers against book
    if (order.eventId !== undefined && order.eventId !== book.eventId) {
      throw new RangeError(
        `Order eventId "${order.eventId}" does not match book eventId "${book.eventId}"`
      );
    }
    if (
      order.ticketCategoryId !== undefined &&
      order.ticketCategoryId !== book.ticketCategoryId
    ) {
      throw new RangeError(
        `Order ticketCategoryId "${order.ticketCategoryId}" does not match book ticketCategoryId "${book.ticketCategoryId}"`
      );
    }

    // Duplicate ID check in the live book
    if (book.getOrder(order.id) !== null) {
      throw new Error(`Order with ID "${order.id}" already exists in the OrderBook`);
    }
  }

  /**
   * Validates a proposed matching plan against the live book before making mutations.
   *
   * @private
   * @param {OrderBook} book - The live order book.
   * @param {Order} incomingOrder - The incoming order.
   * @param {*} plan - The matching plan returned by the strategy.
   * @throws {Error} If any invariant or consistency check fails.
   */
  _validatePlan(book, incomingOrder, plan) {
    if (!plan || typeof plan !== 'object') {
      throw new Error('Plan validation failed: plan must be an object');
    }
    if (!Array.isArray(plan.executions)) {
      throw new Error('Plan validation failed: plan.executions must be an array');
    }
    if (!Number.isSafeInteger(plan.matchedQuantity) || plan.matchedQuantity < 0) {
      throw new Error('Plan validation failed: invalid matchedQuantity');
    }
    if (!Number.isSafeInteger(plan.remainingQuantity) || plan.remainingQuantity < 0) {
      throw new Error('Plan validation failed: invalid remainingQuantity');
    }

    // Validate stoppedReason
    if (typeof plan.stoppedReason !== 'string' || plan.stoppedReason.trim().length === 0) {
      throw new Error('Plan validation failed: stoppedReason must be a non-empty string');
    }
    if (
      plan.stoppedReason !== 'FILLED' &&
      plan.stoppedReason !== 'LIMIT_PRICE_REACHED' &&
      plan.stoppedReason !== 'NO_MORE_LIQUIDITY' &&
      plan.stoppedReason !== 'SELF_TRADE_PREVENTION'
    ) {
      throw new Error(`Plan validation failed: unrecognized stoppedReason "${plan.stoppedReason}"`);
    }
    if (plan.stoppedReason === 'FILLED' && plan.remainingQuantity !== 0) {
      throw new Error('Plan validation failed: stoppedReason is FILLED but remainingQuantity is non-zero');
    }
    if (plan.stoppedReason === 'SELF_TRADE_PREVENTION' && plan.remainingQuantity === 0) {
      throw new Error('Plan validation failed: stoppedReason is SELF_TRADE_PREVENTION but remainingQuantity is zero');
    }

    // Validate optional consistency flags
    if (plan.fullyFilled !== undefined && plan.fullyFilled !== (plan.remainingQuantity === 0)) {
      throw new Error('Plan validation failed: fullyFilled contradicts remainingQuantity');
    }
    if (
      plan.wouldRest !== undefined &&
      plan.wouldRest !== (plan.remainingQuantity > 0 && plan.stoppedReason !== 'SELF_TRADE_PREVENTION')
    ) {
      throw new Error('Plan validation failed: wouldRest contradicts remainingQuantity or stoppedReason');
    }

    // Conservation check: matchedQuantity + remainingQuantity === incomingOrder.remainingQuantity
    if (plan.matchedQuantity + plan.remainingQuantity !== incomingOrder.remainingQuantity) {
      throw new Error(
        'Plan validation failed: matchedQuantity + remainingQuantity does not equal incoming order quantity'
      );
    }

    // Sum of execution quantities must equal matchedQuantity
    let sumExecQty = 0;
    const expectedOppositeSide = incomingOrder.side === 'BID' ? 'ASK' : 'BID';
    const simulatedRestingQty = new Map();

    for (let i = 0; i < plan.executions.length; i++) {
      const exec = plan.executions[i];

      if (!exec || typeof exec !== 'object') {
        throw new Error(`Plan validation failed: execution at index ${i} is not an object`);
      }
      if (typeof exec.restingOrderId !== 'string' || exec.restingOrderId.trim().length === 0) {
        throw new Error(`Plan validation failed: execution at index ${i} has invalid restingOrderId`);
      }
      if (exec.incomingOrderId !== undefined && exec.incomingOrderId !== incomingOrder.id) {
        throw new Error(
          `Plan validation failed: execution incomingOrderId "${exec.incomingOrderId}" does not match incoming order "${incomingOrder.id}"`
        );
      }
      if (!Number.isSafeInteger(exec.quantity) || exec.quantity <= 0) {
        throw new Error(`Plan validation failed: execution at index ${i} has non-positive quantity`);
      }
      if (!Number.isSafeInteger(exec.price) || exec.price <= 0) {
        throw new Error(`Plan validation failed: execution at index ${i} has invalid price`);
      }

      // Check limit price boundary
      if (incomingOrder.side === 'BID' && exec.price > incomingOrder.price) {
        throw new Error(`Plan validation failed: execution price exceeds incoming BID limit`);
      }
      if (incomingOrder.side === 'ASK' && exec.price < incomingOrder.price) {
        throw new Error(`Plan validation failed: execution price is below incoming ASK limit`);
      }

      // Verify resting order exists in live book
      const restingLookup = book.getOrder(exec.restingOrderId);
      if (!restingLookup) {
        throw new Error(
          `Plan validation failed: resting order "${exec.restingOrderId}" does not exist in live book`
        );
      }
      if (restingLookup.side !== expectedOppositeSide) {
        throw new Error(
          `Plan validation failed: resting order "${exec.restingOrderId}" is on wrong side (${restingLookup.side})`
        );
      }
      if (restingLookup.order.price !== exec.price) {
        throw new Error(
          `Plan validation failed: execution price ${exec.price} does not match resting order price ${restingLookup.order.price}`
        );
      }

      // Verify available quantity on resting order
      const currentAvailable = simulatedRestingQty.has(exec.restingOrderId)
        ? simulatedRestingQty.get(exec.restingOrderId)
        : restingLookup.order.remainingQuantity;

      if (exec.quantity > currentAvailable) {
        throw new Error(
          `Plan validation failed: execution quantity ${exec.quantity} exceeds available resting quantity ${currentAvailable}`
        );
      }

      if (
        exec.restingOrderRemainingAfterExecution !== undefined &&
        exec.restingOrderRemainingAfterExecution !== (currentAvailable - exec.quantity)
      ) {
        throw new Error(
          `Plan validation failed: execution restingOrderRemainingAfterExecution (${exec.restingOrderRemainingAfterExecution}) does not match simulated remaining (${currentAvailable - exec.quantity})`
        );
      }

      simulatedRestingQty.set(exec.restingOrderId, currentAvailable - exec.quantity);
      sumExecQty += exec.quantity;
    }

    if (sumExecQty !== plan.matchedQuantity) {
      throw new Error(
        `Plan validation failed: sum of execution quantities (${sumExecQty}) does not match matchedQuantity (${plan.matchedQuantity})`
      );
    }
  }

  /**
   * Submits an incoming limit order to the OrderBook.
   *
   * Calculates plan, validates against live book, executes matches sequentially,
   * handles remainder lifecycle (resting vs cancelled on STP), and returns a detached result.
   *
   * @param {OrderBook} book - Target OrderBook.
   * @param {Order} incomingOrder - Incoming limit order to execute and/or rest.
   * @returns {SubmissionResult} Detached result describing execution and lifecycle status.
   * @throws {TypeError|RangeError|Error} If inputs or plan validation fail.
  /**
   * Calculates and validates a matching plan for an incoming limit order
   * without mutating the live OrderBook.
   *
   * @param {OrderBook} book - Target OrderBook.
   * @param {Order} incomingOrder - Incoming limit order to plan matching for.
   * @returns {Object} Validated matching plan.
   * @throws {TypeError|RangeError|Error} If inputs or plan validation fail.
   */
  calculatePlan(book, incomingOrder) {
    this._validateBook(book);
    this._validateIncomingOrder(book, incomingOrder);

    // 1. Calculate pure matching plan
    const plan = this.strategy.calculate(book, incomingOrder);

    // 2. Validate plan integrity before mutating book state
    this._validatePlan(book, incomingOrder, plan);

    return plan;
  }

  /**
   * Applies a pre-calculated, validated matching plan to the live OrderBook.
   *
   * @param {OrderBook} book - Target OrderBook.
   * @param {Order} incomingOrder - The incoming order.
   * @param {Object} plan - Pre-calculated matching plan.
   * @returns {SubmissionResult} Detached result describing execution and lifecycle status.
   * @throws {TypeError|RangeError|Error} If inputs or plan application fail.
   */
  applyPlan(book, incomingOrder, plan) {
    this._validateBook(book);
    this._validateIncomingOrder(book, incomingOrder);
    this._validatePlan(book, incomingOrder, plan);

    /** @type {ExecutionResult[]} */
    const appliedExecutions = [];

    for (let i = 0; i < plan.executions.length; i++) {
      const exec = plan.executions[i];
      const fillResult = book.reduceOrderQuantity(exec.restingOrderId, exec.quantity);

      if (!fillResult) {
        throw new Error(
          `Execution application failed for resting order "${exec.restingOrderId}"`
        );
      }

      appliedExecutions.push({
        incomingOrderId: incomingOrder.id,
        restingOrderId: exec.restingOrderId,
        price: exec.price,
        quantity: exec.quantity,
        restingOrderRemainingAfterExecution: fillResult.remainingQuantity,
        ...(incomingOrder.userId ? { incomingUserId: incomingOrder.userId } : {}),
        ...(exec.restingUserId ? { restingUserId: exec.restingUserId } : {}),
      });
    }

    /** @type {OrderLifecycleStatus} */
    let status;
    let restedQuantity = 0;

    if (plan.stoppedReason === 'SELF_TRADE_PREVENTION') {
      // STP stops matching: valid prior executions are preserved, remainder is CANCELLED (does NOT rest)
      status = 'CANCELLED';
      restedQuantity = 0;
    } else if (plan.remainingQuantity === 0) {
      // Completely filled: does NOT rest
      status = 'FILLED';
      restedQuantity = 0;
    } else if (plan.matchedQuantity > 0) {
      // Partially filled: add unfilled remainder to the book
      status = 'PARTIALLY_FILLED';
      restedQuantity = plan.remainingQuantity;

      const remainderOrder = {
        id: incomingOrder.id,
        price: incomingOrder.price,
        remainingQuantity: plan.remainingQuantity,
        ...(incomingOrder.userId ? { userId: incomingOrder.userId } : {}),
      };
      book.addOrder(incomingOrder.side, remainderOrder);
    } else {
      // No fills (empty opposing book or no price overlap): full order rests in the book
      status = 'RESTING';
      restedQuantity = incomingOrder.remainingQuantity;

      const fullRestingOrder = {
        id: incomingOrder.id,
        price: incomingOrder.price,
        remainingQuantity: incomingOrder.remainingQuantity,
        ...(incomingOrder.userId ? { userId: incomingOrder.userId } : {}),
      };
      book.addOrder(incomingOrder.side, fullRestingOrder);
    }

    return {
      incomingOrderId: incomingOrder.id,
      side: incomingOrder.side,
      status,
      executions: appliedExecutions,
      matchedQuantity: plan.matchedQuantity,
      remainingQuantity: plan.remainingQuantity,
      restedQuantity,
      stoppedReason: plan.stoppedReason,
    };
  }

  /**
   * Submits an incoming limit order to the OrderBook.
   *
   * Calculates plan, validates against live book, executes matches sequentially,
   * handles remainder lifecycle (resting vs cancelled on STP), and returns a detached result.
   *
   * @param {OrderBook} book - Target OrderBook.
   * @param {Order} incomingOrder - Incoming limit order to execute and/or rest.
   * @returns {SubmissionResult} Detached result describing execution and lifecycle status.
   * @throws {TypeError|RangeError|Error} If inputs or plan validation fail.
   */
  submitLimitOrder(book, incomingOrder) {
    const plan = this.calculatePlan(book, incomingOrder);
    return this.applyPlan(book, incomingOrder, plan);
  }
}

export default MatchingCoordinator;
