/**
 * PersistentMatchingService
 *
 * Connects the in-memory MatchingCoordinator and OrderBook to PostgreSQL via Prisma.
 * Orchestrates the complete 10-step submission lifecycle under MarketExecutionQueue serialization
 * and post-commit state mutation guarantees.
 *
 * Strict Invariants:
 * 1. Mutual Exclusion: All operations for a market run sequentially via MarketExecutionQueue.
 * 2. Pre-Commit Immutability: In-memory OrderBook is never modified before confirmed DB commit.
 * 3. Idempotent Deduplication: Retries scoped by (userId, idempotencyKey) return the stored outcome.
 * 4. Optimistic Concurrency: Resting order updates verify expected remaining quantities.
 * 5. Failure Quarantine: Ambiguous commit outcomes or state divergences transition the market into RECONCILING.
 * 6. BigInt Safety: sequenceNumber fields are formatted as strings for JSON/API compatibility.
 */

import crypto from 'node:crypto';
import { MatchingCoordinator } from './matching-coordinator.js';
import {
  MarketExecutionQueue,
  MarketState,
  MarketStateManager,
  MarketNotReadyError,
  formatMarketKey,
} from './market-execution-queue.js';
import { OrderRepository, MarketStateDivergenceError } from './order-repository.js';

export { MarketStateDivergenceError };

/**
 * Error thrown when an incoming order fails input validation.
 */
export class OrderValidationError extends Error {
  /**
   * @param {string} message
   * @param {string} [field]
   */
  constructor(message, field) {
    super(message);
    this.name = 'OrderValidationError';
    this.code = 'ORDER_VALIDATION_ERROR';
    this.field = field;
  }
}

/**
 * Error thrown when a database transaction outcome cannot be definitively verified
 * (e.g., connection reset, network partition, or query engine timeout during commit).
 */
export class AmbiguousCommitError extends Error {
  /**
   * @param {string} message
   * @param {Object} [details]
   */
  constructor(message, { originalError, marketKey, orderId } = {}) {
    super(message);
    this.name = 'AmbiguousCommitError';
    this.code = 'AMBIGUOUS_COMMIT_OUTCOME';
    this.marketKey = marketKey;
    this.orderId = orderId;
    this.originalError = originalError;
  }
}

/**
 * Error thrown when a database transaction committed successfully, but the subsequent
 * post-commit in-memory OrderBook mutation failed.
 */
export class PostCommitMutationError extends Error {
  /**
   * @param {string} message
   * @param {Object} [details]
   */
  constructor(message, { originalError, marketKey, orderId } = {}) {
    super(message);
    this.name = 'PostCommitMutationError';
    this.code = 'POST_COMMIT_MUTATION_ERROR';
    this.marketKey = marketKey;
    this.orderId = orderId;
    this.originalError = originalError;
  }
}

/**
 * Helper to determine whether an error represents an ambiguous database commit outcome.
 *
 * @param {*} err
 * @returns {boolean}
 */
export function isAmbiguousCommitError(err) {
  if (err instanceof AmbiguousCommitError) {
    return true;
  }
  if (!err || typeof err !== 'object') {
    return false;
  }

  const msg = typeof err.message === 'string' ? err.message : '';
  const code = typeof err.code === 'string' ? err.code : '';

  // Prisma codes for connection pool timeout or expired transaction
  if (code === 'P2024' || code === 'P2028') {
    return true;
  }

  // Socket and network disruption messages
  if (
    msg.includes('Connection terminated unexpectedly') ||
    msg.includes('ECONNRESET') ||
    msg.includes('ETIMEDOUT') ||
    msg.includes('EPIPE') ||
    msg.includes('commit timeout') ||
    msg.includes('Transaction closed')
  ) {
    return true;
  }

  return false;
}

export class PersistentMatchingService {
  /**
   * @param {Object} [options]
   * @param {OrderRepository} [options.repository]
   * @param {MarketExecutionQueue} [options.queue]
   * @param {MatchingCoordinator} [options.coordinator]
   * @param {MarketStateManager} [options.stateManager]
   */
  constructor({
    repository = new OrderRepository(),
    queue = new MarketExecutionQueue(),
    coordinator = new MatchingCoordinator(),
    stateManager,
  } = {}) {
    this.repository = repository;
    this.queue = queue;
    this.coordinator = coordinator;
    this.stateManager = stateManager || queue.getStateManager();

    /**
     * Map of marketKey -> in-memory OrderBook instance.
     * @type {Map<string, import('./order-book.js').OrderBook>}
     */
    this._marketBooks = new Map();
  }

  /**
   * Registers an in-memory OrderBook for a specific market.
   *
   * @param {string|Object} marketKeyOrConfig
   * @param {import('./order-book.js').OrderBook} book
   * @returns {string} The canonical market key.
   * @throws {TypeError} If book is invalid.
   */
  registerMarketBook(marketKeyOrConfig, book) {
    if (!book || typeof book !== 'object' || typeof book.reduceOrderQuantity !== 'function') {
      throw new TypeError('book must be a valid OrderBook instance');
    }

    const marketKey = formatMarketKey(marketKeyOrConfig);
    this._marketBooks.set(marketKey, book);
    this.stateManager.registerMarket(marketKey, MarketState.INITIALIZING);
    return marketKey;
  }

  /**
   * Retrieves the in-memory OrderBook registered for a market.
   *
   * @param {string|Object} marketKeyOrConfig
   * @returns {import('./order-book.js').OrderBook|null}
   */
  getMarketBook(marketKeyOrConfig) {
    const marketKey = formatMarketKey(marketKeyOrConfig);
    return this._marketBooks.get(marketKey) || null;
  }

  /**
   * Validates input parameters for a limit order submission before entering the queue.
   *
   * @private
   * @param {*} input
   * @returns {Object} Normalized order parameters.
   * @throws {OrderValidationError|TypeError|RangeError}
   */
  _validateSubmissionInput(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new OrderValidationError('Order submission input must be a non-null object');
    }

    const {
      eventId,
      ticketCategoryId,
      userId,
      side,
      price,
      quantity,
      initialQuantity,
      idempotencyKey,
      id,
    } = input;

    if (typeof eventId !== 'string' || eventId.trim().length === 0) {
      throw new OrderValidationError('eventId must be a non-empty string', 'eventId');
    }
    if (typeof ticketCategoryId !== 'string' || ticketCategoryId.trim().length === 0) {
      throw new OrderValidationError('ticketCategoryId must be a non-empty string', 'ticketCategoryId');
    }
    if (typeof userId !== 'string' || userId.trim().length === 0) {
      throw new OrderValidationError('userId must be a non-empty string', 'userId');
    }
    if (typeof idempotencyKey !== 'string' || idempotencyKey.trim().length === 0) {
      throw new OrderValidationError('idempotencyKey must be a non-empty string', 'idempotencyKey');
    }
    if (side !== 'BID' && side !== 'ASK') {
      throw new OrderValidationError('side must be either "BID" or "ASK"', 'side');
    }

    if (typeof price !== 'number' || !Number.isInteger(price) || price <= 0 || !Number.isSafeInteger(price)) {
      throw new OrderValidationError('price must be a positive safe integer (ticks/cents)', 'price');
    }

    const effectiveQty = quantity !== undefined ? quantity : initialQuantity;
    if (
      typeof effectiveQty !== 'number' ||
      !Number.isInteger(effectiveQty) ||
      effectiveQty <= 0 ||
      !Number.isSafeInteger(effectiveQty)
    ) {
      throw new OrderValidationError('quantity must be a positive safe integer', 'quantity');
    }

    if (id !== undefined && (typeof id !== 'string' || id.trim().length === 0)) {
      throw new OrderValidationError('id must be a non-empty string if provided', 'id');
    }

    return {
      id: id || crypto.randomUUID(),
      eventId: eventId.trim(),
      ticketCategoryId: ticketCategoryId.trim(),
      userId: userId.trim(),
      side,
      price,
      initialQuantity: effectiveQty,
      remainingQuantity: effectiveQty,
      idempotencyKey: idempotencyKey.trim(),
    };
  }

  /**
   * Formats a stored database order record and its executions into the standard SubmissionResult.
   *
   * @private
   * @param {Object} orderRecord
   * @returns {Object} Detached, JSON-serializable submission result.
   */
  _formatSubmissionResultFromRecord(orderRecord) {
    const executions = Array.isArray(orderRecord.incomingExecutions)
      ? orderRecord.incomingExecutions
      : [];

    let totalMatched = 0;
    const formattedExecutions = executions.map((e) => {
      totalMatched += e.quantity;
      return {
        id: e.id,
        incomingOrderId: e.incomingOrderId,
        restingOrderId: e.restingOrderId,
        price: e.price,
        quantity: e.quantity,
        sequenceNumber: e.sequenceNumber != null ? e.sequenceNumber.toString() : '0',
        executedAt: e.executedAt,
      };
    });

    const isResting = orderRecord.status === 'OPEN' || orderRecord.status === 'PARTIALLY_FILLED';

    return {
      orderId: orderRecord.id,
      incomingOrderId: orderRecord.id,
      userId: orderRecord.userId,
      eventId: orderRecord.eventId,
      ticketCategoryId: orderRecord.ticketCategoryId,
      side: orderRecord.side,
      status: orderRecord.status,
      price: orderRecord.price,
      initialQuantity: orderRecord.initialQuantity,
      remainingQuantity: orderRecord.remainingQuantity,
      matchedQuantity: totalMatched,
      restedQuantity: isResting ? orderRecord.remainingQuantity : 0,
      stoppedReason: orderRecord.stoppedReason,
      executions: formattedExecutions,
      isDuplicate: true,
    };
  }

  /**
   * Submits a limit order through the full 10-step persistence and matching lifecycle.
   *
   * @param {Object} input - Limit order submission parameters.
   * @returns {Promise<Object>} Detached, JSON-serializable submission result.
   */
  async submitLimitOrder(input) {
    // 1. Validate input contract before queuing
    const validatedOrder = this._validateSubmissionInput(input);
    const marketKey = formatMarketKey(validatedOrder.eventId, validatedOrder.ticketCategoryId);

    // 2. Enter MarketExecutionQueue for strict per-market serialization
    return this.queue.execute(marketKey, async () => {
      // 3. Verify market readiness inside serialized boundary
      this.stateManager.assertReady(marketKey);

      // Verify in-memory OrderBook is registered and synchronized
      const book = this._marketBooks.get(marketKey);
      if (!book) {
        throw new MarketStateDivergenceError(
          `No in-memory OrderBook registered for market "${marketKey}"`,
          { marketKey }
        );
      }

      // 4. Look up existing submission by (userId, idempotencyKey)
      const existing = await this.repository.findByIdempotencyKey(
        validatedOrder.userId,
        validatedOrder.idempotencyKey
      );

      if (existing) {
        return this._formatSubmissionResultFromRecord(existing);
      }

      // 5 & 6. Calculate pure matching plan without mutating live book
      const plan = this.coordinator.calculatePlan(book, validatedOrder);

      // Determine database status from matching plan
      let dbStatus;
      if (plan.stoppedReason === 'SELF_TRADE_PREVENTION') {
        dbStatus = 'CANCELLED';
      } else if (plan.remainingQuantity === 0) {
        dbStatus = 'FILLED';
      } else if (plan.matchedQuantity > 0) {
        dbStatus = 'PARTIALLY_FILLED';
      } else {
        dbStatus = 'OPEN';
      }

      // Prepare resting order updates with optimistic concurrency checks
      const restingUpdatesMap = new Map();
      for (const exec of plan.executions) {
        const restingLookup = book.getOrder(exec.restingOrderId);
        if (!restingLookup) {
          throw new MarketStateDivergenceError(
            `Resting order "${exec.restingOrderId}" missing in live book during plan preparation`,
            { restingOrderId: exec.restingOrderId }
          );
        }

        const expectedRemaining = restingLookup.order.remainingQuantity;
        const currentAccumulated = restingUpdatesMap.has(exec.restingOrderId)
          ? restingUpdatesMap.get(exec.restingOrderId)
          : {
              id: exec.restingOrderId,
              expectedRemaining,
              simulatedRemaining: expectedRemaining,
            };

        currentAccumulated.simulatedRemaining -= exec.quantity;
        restingUpdatesMap.set(exec.restingOrderId, currentAccumulated);
      }

      const restingUpdates = Array.from(restingUpdatesMap.values()).map((u) => ({
        id: u.id,
        expectedRemaining: u.expectedRemaining,
        newRemaining: u.simulatedRemaining,
        newStatus: u.simulatedRemaining === 0 ? 'FILLED' : 'PARTIALLY_FILLED',
      }));

      // Prepare executions data
      const executionsData = plan.executions.map((e) => ({
        id: crypto.randomUUID(),
        restingOrderId: e.restingOrderId,
        price: e.price,
        quantity: e.quantity,
      }));

      const incomingOrderData = {
        id: validatedOrder.id,
        userId: validatedOrder.userId,
        eventId: validatedOrder.eventId,
        ticketCategoryId: validatedOrder.ticketCategoryId,
        side: validatedOrder.side,
        status: dbStatus,
        price: validatedOrder.price,
        initialQuantity: validatedOrder.initialQuantity,
        remainingQuantity: plan.remainingQuantity,
        idempotencyKey: validatedOrder.idempotencyKey,
        stoppedReason: plan.stoppedReason,
      };

      // 7. Atomic PostgreSQL transaction
      let persisted;
      try {
        persisted = await this.repository.persistMatchingTransaction({
          incomingOrderData,
          restingUpdates,
          executionsData,
        });
      } catch (err) {
        // Handle database uniqueness collision (concurrent idempotency retry race)
        if (err.code === 'P2002') {
          const rechecked = await this.repository.findByIdempotencyKey(
            validatedOrder.userId,
            validatedOrder.idempotencyKey
          );
          if (rechecked) {
            return this._formatSubmissionResultFromRecord(rechecked);
          }
        }

        // Handle resting order state divergence
        if (err instanceof MarketStateDivergenceError) {
          this.stateManager.transition(marketKey, MarketState.RECONCILING);
          throw err;
        }

        // Handle ambiguous commit timeouts or connection drop
        if (isAmbiguousCommitError(err)) {
          this.stateManager.transition(marketKey, MarketState.RECONCILING);
          throw new AmbiguousCommitError(
            `Ambiguous database commit outcome for order "${validatedOrder.id}". Market quarantined into RECONCILING.`,
            { originalError: err, marketKey, orderId: validatedOrder.id }
          );
        }

        // Definitive rollback: in-memory book was not touched, rethrow error
        throw err;
      }

      // 8. Post-Commit In-Memory OrderBook Mutation
      try {
        this.coordinator.applyPlan(book, validatedOrder, plan);
      } catch (mutationErr) {
        // Catastrophic divergence: DB committed but in-memory book failed
        this.stateManager.transition(marketKey, MarketState.RECONCILING);
        throw new PostCommitMutationError(
          `Database committed order "${validatedOrder.id}", but in-memory book mutation failed. Market quarantined into RECONCILING.`,
          { originalError: mutationErr, marketKey, orderId: validatedOrder.id }
        );
      }

      // 9 & 10. Format and return detached result consistent with database records
      const { persistedOrder, persistedExecutions } = persisted;
      const formattedExecutions = (persistedExecutions || []).map((e) => ({
        id: e.id,
        incomingOrderId: e.incomingOrderId,
        restingOrderId: e.restingOrderId,
        price: e.price,
        quantity: e.quantity,
        sequenceNumber: e.sequenceNumber != null ? e.sequenceNumber.toString() : '0',
        executedAt: e.executedAt,
      }));

      const isResting =
        persistedOrder.status === 'OPEN' || persistedOrder.status === 'PARTIALLY_FILLED';

      return {
        orderId: persistedOrder.id,
        incomingOrderId: persistedOrder.id,
        userId: persistedOrder.userId,
        eventId: persistedOrder.eventId,
        ticketCategoryId: persistedOrder.ticketCategoryId,
        side: persistedOrder.side,
        status: persistedOrder.status,
        price: persistedOrder.price,
        initialQuantity: persistedOrder.initialQuantity,
        remainingQuantity: persistedOrder.remainingQuantity,
        matchedQuantity: plan.matchedQuantity,
        restedQuantity: isResting ? persistedOrder.remainingQuantity : 0,
        stoppedReason: persistedOrder.stoppedReason,
        executions: formattedExecutions,
        isDuplicate: false,
      };
    });
  }
}
