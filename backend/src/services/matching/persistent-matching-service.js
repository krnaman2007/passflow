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
 * 4. Idempotency Payload Protection: Reusing an idempotency key with different parameters is rejected.
 * 5. Optimistic Concurrency: Resting order updates verify expected remaining quantities.
 * 6. Market Readiness & Sync Gate: Markets with unsynchronized books reject mutations until reconciled.
 * 7. Failure Quarantine: Ambiguous commit outcomes or state divergences transition the market into RECONCILING.
 * 8. BigInt Safety: sequenceNumber fields are formatted as strings for JSON/API compatibility.
 */

import crypto from 'node:crypto';
import { MatchingCoordinator } from './matching-coordinator.js';
import { OrderBook } from './order-book.js';
import {
  MarketExecutionQueue,
  MarketState,
  MarketStateManager,
  MarketNotReadyError,
  formatMarketKey,
  parseMarketKey,
} from './market-execution-queue.js';
import { OrderRepository, MarketStateDivergenceError } from './order-repository.js';
import {
  MarketLeaseManager,
  verifyFencingToken,
  MarketOwnershipError,
  FencingViolationError,
} from './market-lease-manager.js';

export { MarketStateDivergenceError, MarketOwnershipError, FencingViolationError };

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
 * Error thrown when an idempotency key is reused with mismatched order parameters.
 */
export class IdempotencyPayloadMismatchError extends Error {
  /**
   * @param {string} message
   * @param {Object} [details]
   */
  constructor(message, { idempotencyKey, expected, actual } = {}) {
    super(message);
    this.name = 'IdempotencyPayloadMismatchError';
    this.code = 'IDEMPOTENCY_PAYLOAD_MISMATCH';
    this.idempotencyKey = idempotencyKey;
    this.expected = expected;
    this.actual = actual;
  }
}

/**
 * Error thrown when an in-memory OrderBook is not verified as synchronized with PostgreSQL.
 */
export class MarketNotSynchronizedError extends Error {
  /**
   * @param {string} message
   * @param {Object} [details]
   */
  constructor(message, { marketKey, activeOrdersCount } = {}) {
    super(message);
    this.name = 'MarketNotSynchronizedError';
    this.code = 'MARKET_NOT_SYNCHRONIZED';
    this.marketKey = marketKey;
    this.activeOrdersCount = activeOrdersCount;
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
  constructor(message, { originalError, marketKey, orderId, persistedOrder, persistedExecutions } = {}) {
    super(message);
    this.name = 'PostCommitMutationError';
    this.code = 'POST_COMMIT_MUTATION_ERROR';
    this.marketKey = marketKey;
    this.orderId = orderId;
    this.originalError = originalError;
    this.persistedOrder = persistedOrder;
    this.persistedExecutions = persistedExecutions;
  }
}

/**
 * Error thrown when startup order-book reconstruction fails (e.g. invalid persisted data,
 * corrupted remaining quantities, or snapshot verification divergence).
 */
export class MarketReconstructionError extends Error {
  /**
   * @param {string} message
   * @param {Object} [details]
   */
  constructor(message, { marketKey, orderId, reason, originalError } = {}) {
    super(message);
    this.name = 'MarketReconstructionError';
    this.code = 'MARKET_RECONSTRUCTION_ERROR';
    this.marketKey = marketKey;
    this.orderId = orderId;
    this.reason = reason;
    this.originalError = originalError;
  }
}

/**
 * Error thrown when market reconciliation fails (e.g. PostgreSQL is unavailable).
 */
export class MarketReconciliationError extends Error {
  /**
   * @param {string} message
   * @param {Object} [details]
   */
  constructor(message, { marketKey, originalError, details } = {}) {
    super(message);
    this.name = 'MarketReconciliationError';
    this.code = 'MARKET_RECONCILIATION_ERROR';
    this.marketKey = marketKey;
    this.originalError = originalError;
    this.details = details;
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

/**
 * Inspects a Prisma P2002 error to verify whether it specifically targets the (userId, idempotencyKey) constraint.
 *
 * @param {*} err
 * @returns {boolean}
 */
export function isIdempotencyKeyConstraintViolation(err) {
  if (!err || err.code !== 'P2002') {
    return false;
  }
  const target = err.meta?.target;
  if (Array.isArray(target)) {
    return target.includes('idempotencyKey') || (target.includes('userId') && target.includes('idempotencyKey'));
  }
  if (typeof target === 'string') {
    return target.includes('idempotencyKey') || target.includes('userId_idempotencyKey');
  }
  return false;
}

/**
 * Asserts that an existing order matching an idempotency key matches the incoming order's parameters.
 *
 * @param {Object} existingOrder
 * @param {Object} incomingOrder
 * @throws {IdempotencyPayloadMismatchError}
 */
export function assertIdempotentPayloadMatches(existingOrder, incomingOrder) {
  const mismatches = [];
  if (existingOrder.eventId !== incomingOrder.eventId) {
    mismatches.push(`eventId: expected "${existingOrder.eventId}", got "${incomingOrder.eventId}"`);
  }
  if (existingOrder.ticketCategoryId !== incomingOrder.ticketCategoryId) {
    mismatches.push(`ticketCategoryId: expected "${existingOrder.ticketCategoryId}", got "${incomingOrder.ticketCategoryId}"`);
  }
  if (existingOrder.side !== incomingOrder.side) {
    mismatches.push(`side: expected "${existingOrder.side}", got "${incomingOrder.side}"`);
  }
  if (existingOrder.price !== incomingOrder.price) {
    mismatches.push(`price: expected ${existingOrder.price}, got ${incomingOrder.price}`);
  }
  if (existingOrder.initialQuantity !== incomingOrder.initialQuantity) {
    mismatches.push(`quantity: expected ${existingOrder.initialQuantity}, got ${incomingOrder.initialQuantity}`);
  }

  if (mismatches.length > 0) {
    throw new IdempotencyPayloadMismatchError(
      `Idempotency key "${incomingOrder.idempotencyKey}" was previously used with different order parameters: ${mismatches.join('; ')}`,
      {
        idempotencyKey: incomingOrder.idempotencyKey,
        expected: {
          eventId: existingOrder.eventId,
          ticketCategoryId: existingOrder.ticketCategoryId,
          side: existingOrder.side,
          price: existingOrder.price,
          initialQuantity: existingOrder.initialQuantity,
        },
        actual: {
          eventId: incomingOrder.eventId,
          ticketCategoryId: incomingOrder.ticketCategoryId,
          side: incomingOrder.side,
          price: incomingOrder.price,
          initialQuantity: incomingOrder.initialQuantity,
        },
      }
    );
  }
}

export class PersistentMatchingService {
  /**
   * @param {Object} [options]
   * @param {OrderRepository} [options.repository]
   * @param {MarketExecutionQueue} [options.queue]
   * @param {MatchingCoordinator} [options.coordinator]
   * @param {MarketStateManager} [options.stateManager]
   * @param {MarketLeaseManager} [options.leaseManager]
   * @param {boolean} [options.requireMarketLease]
   * @param {number} [options.leaseDurationMs]
   */
  constructor({
    repository = new OrderRepository(),
    queue = new MarketExecutionQueue(),
    coordinator = new MatchingCoordinator(),
    stateManager,
    leaseManager,
    requireMarketLease,
    leaseDurationMs,
  } = {}) {
    this.repository = repository;
    this.queue = queue;
    this.coordinator = coordinator;
    this.stateManager = stateManager || queue.getStateManager();

    // Initialize distributed lease manager if database supports raw queries
    if (leaseManager) {
      this.leaseManager = leaseManager;
    } else if (this.repository && this.repository.prisma && typeof this.repository.prisma.$queryRaw === 'function') {
      this.leaseManager = new MarketLeaseManager({
        prismaClient: this.repository.prisma,
        defaultLeaseDurationMs: leaseDurationMs,
      });
    } else {
      this.leaseManager = null;
    }

    this.requireMarketLease = requireMarketLease !== undefined
      ? Boolean(requireMarketLease)
      : (process.env.ENABLE_DISTRIBUTED_MARKET_LEASES === 'true' || process.env.REQUIRE_MARKET_LEASE === 'true');

    /**
     * Map of marketKey -> in-memory OrderBook instance.
     * @type {Map<string, import('./order-book.js').OrderBook>}
     */
    this._marketBooks = new Map();

    /**
     * Map of marketKey -> cached lease details { marketKey, eventId, ticketCategoryId, ownerId, fencingToken, expiresAt, leaseDurationMs }.
     * @type {Map<string, Object>}
     */
    this._marketLeases = new Map();

    /**
     * Set of market keys verified as synchronized with PostgreSQL.
     * @type {Set<string>}
     */
    this._synchronizedMarkets = new Set();

    /**
     * Set of market keys marked corrupted (e.g., post-commit mutation failed).
     * @type {Set<string>}
     */
    this._corruptedMarkets = new Set();
  }

  /**
   * Resolves a canonical market key from a formatted key string, config object, or separate IDs.
   *
   * @param {string|Object} marketKeyOrConfig
   * @param {string} [maybeTicketCategoryId]
   * @returns {string}
   */
  _resolveKey(marketKeyOrConfig, maybeTicketCategoryId) {
    if (typeof marketKeyOrConfig === 'string' && maybeTicketCategoryId === undefined) {
      try {
        parseMarketKey(marketKeyOrConfig);
        return marketKeyOrConfig;
      } catch {
        // Fall through to formatMarketKey
      }
    }
    return formatMarketKey(marketKeyOrConfig, maybeTicketCategoryId);
  }

  /**
   * Registers an in-memory OrderBook for a specific market.
   * By default, a newly registered market is NOT considered synchronized until verified against PostgreSQL.
   *
   * @param {string|Object} marketKeyOrConfig
   * @param {import('./order-book.js').OrderBook} book
   * @param {Object} [options]
   * @param {boolean} [options.synchronized=false]
   * @returns {string} The canonical market key.
   * @throws {TypeError} If book is invalid.
   */
  registerMarketBook(marketKeyOrConfig, book, { synchronized = false } = {}) {
    if (!book || typeof book !== 'object' || typeof book.reduceOrderQuantity !== 'function') {
      throw new TypeError('book must be a valid OrderBook instance');
    }

    const marketKey = this._resolveKey(marketKeyOrConfig);
    this._marketBooks.set(marketKey, book);
    this._corruptedMarkets.delete(marketKey);

    if (synchronized) {
      this._synchronizedMarkets.add(marketKey);
    } else {
      this._synchronizedMarkets.delete(marketKey);
    }

    this.stateManager.registerMarket(marketKey, MarketState.INITIALIZING);
    return marketKey;
  }

  /**
   * Helper to quarantine a corrupted market.
   *
   * @private
   * @param {string} marketKey
   */
  _quarantineCorruptedMarket(marketKey) {
    this._corruptedMarkets.add(marketKey);
    this._synchronizedMarkets.delete(marketKey);
    const currentState = this.stateManager.getState(marketKey);
    if (currentState === MarketState.READY || currentState === MarketState.PAUSED) {
      try {
        this.stateManager.transition(marketKey, MarketState.RECONCILING);
      } catch {
        // Ignore if transition disallowed
      }
    } else if (currentState === MarketState.INITIALIZING) {
      try {
        this.stateManager.transition(marketKey, MarketState.PAUSED);
      } catch {
        // Ignore if transition disallowed
      }
    }
  }

  /**
   * Internal routine that loads active orders from PostgreSQL, validates them,
   * constructs a fresh OrderBook, verifies it against the snapshot, and replaces the in-memory book.
   *
   * Must be called within the market's serialized queue execution.
   *
   * @private
   * @param {string} marketKey
   * @param {string} eventId
   * @param {string} ticketCategoryId
   * @returns {Promise<{ newBook: OrderBook, activeOrders: Object[], totalQuantity: number }>}
   */
  async _reconstructBookUnderQueue(marketKey, eventId, ticketCategoryId) {
    let activeOrders;
    try {
      activeOrders = await this.repository.findActiveOrdersByMarket(eventId, ticketCategoryId);
    } catch (err) {
      this._synchronizedMarkets.delete(marketKey);
      throw new MarketReconstructionError(
        `Failed to load active orders from PostgreSQL for market "${marketKey}": ${err.message}`,
        { marketKey, originalError: err }
      );
    }

    const newBook = new OrderBook({ eventId, ticketCategoryId });
    let totalQty = 0;

    for (const order of activeOrders) {
      if (!order.id || typeof order.id !== 'string' || order.id.trim().length === 0) {
        this._quarantineCorruptedMarket(marketKey);
        throw new MarketReconstructionError(
          `Invalid active order in database: missing or invalid id for market "${marketKey}"`,
          { marketKey, orderId: order.id, reason: 'INVALID_ID' }
        );
      }
      if (!order.userId || typeof order.userId !== 'string' || order.userId.trim().length === 0) {
        this._quarantineCorruptedMarket(marketKey);
        throw new MarketReconstructionError(
          `Invalid active order "${order.id}": missing or invalid userId`,
          { marketKey, orderId: order.id, reason: 'INVALID_USER_ID' }
        );
      }
      if (order.eventId !== eventId || order.ticketCategoryId !== ticketCategoryId) {
        this._quarantineCorruptedMarket(marketKey);
        throw new MarketReconstructionError(
          `Market mismatch on persisted order "${order.id}": expected (${eventId}, ${ticketCategoryId}), found (${order.eventId}, ${order.ticketCategoryId})`,
          { marketKey, orderId: order.id, reason: 'MARKET_MISMATCH' }
        );
      }
      if (order.side !== 'BID' && order.side !== 'ASK') {
        this._quarantineCorruptedMarket(marketKey);
        throw new MarketReconstructionError(
          `Invalid side "${order.side}" on persisted order "${order.id}"`,
          { marketKey, orderId: order.id, reason: 'INVALID_SIDE' }
        );
      }
      if (
        typeof order.price !== 'number' ||
        !Number.isInteger(order.price) ||
        order.price <= 0 ||
        !Number.isSafeInteger(order.price)
      ) {
        this._quarantineCorruptedMarket(marketKey);
        throw new MarketReconstructionError(
          `Invalid price ${order.price} on persisted order "${order.id}": must be positive safe integer`,
          { marketKey, orderId: order.id, reason: 'INVALID_PRICE' }
        );
      }
      if (
        typeof order.remainingQuantity !== 'number' ||
        !Number.isInteger(order.remainingQuantity) ||
        order.remainingQuantity <= 0 ||
        !Number.isSafeInteger(order.remainingQuantity)
      ) {
        this._quarantineCorruptedMarket(marketKey);
        throw new MarketReconstructionError(
          `Invalid remainingQuantity ${order.remainingQuantity} on persisted order "${order.id}": must be positive safe integer`,
          { marketKey, orderId: order.id, reason: 'INVALID_REMAINING_QUANTITY' }
        );
      }
      if (order.remainingQuantity > order.initialQuantity) {
        this._quarantineCorruptedMarket(marketKey);
        throw new MarketReconstructionError(
          `Persisted order "${order.id}" remainingQuantity (${order.remainingQuantity}) exceeds initialQuantity (${order.initialQuantity})`,
          { marketKey, orderId: order.id, reason: 'QUANTITY_EXCEEDS_INITIAL' }
        );
      }
      if (order.status !== 'OPEN' && order.status !== 'PARTIALLY_FILLED') {
        this._quarantineCorruptedMarket(marketKey);
        throw new MarketReconstructionError(
          `Invalid status "${order.status}" on persisted resting order "${order.id}": only OPEN or PARTIALLY_FILLED orders may rest in book`,
          { marketKey, orderId: order.id, reason: 'INVALID_STATUS' }
        );
      }

      newBook.addOrder(order.side, {
        id: order.id,
        userId: order.userId,
        eventId: order.eventId,
        ticketCategoryId: order.ticketCategoryId,
        side: order.side,
        price: order.price,
        initialQuantity: order.initialQuantity,
        remainingQuantity: order.remainingQuantity,
      });
      totalQty += order.remainingQuantity;
    }

    // Verify snapshot invariants deeply
    try {
      this._verifyBookMatchesDatabaseSnapshot(newBook, activeOrders, {
        eventId,
        ticketCategoryId,
        marketKey,
      });
    } catch (err) {
      this._quarantineCorruptedMarket(marketKey);
      throw err;
    }

    // Atomically store the verified book
    this._marketBooks.set(marketKey, newBook);
    this._corruptedMarkets.delete(marketKey);
    this._synchronizedMarkets.add(marketKey);

    return { newBook, activeOrders, totalQuantity: totalQty };
  }

  /**
   * Deeply verifies that an in-memory OrderBook matches an authoritative PostgreSQL snapshot.
   * Compares:
   * 1. Exact total order count and total remaining quantity.
   * 2. Market identifiers (eventId, ticketCategoryId).
   * 3. Exact order IDs, user IDs, sides, prices, and remaining quantities.
   * 4. FIFO ordering for orders at the same price and side.
   * 5. Zero phantom orders in book.
   *
   * @param {import('./order-book.js').OrderBook} book
   * @param {Object[]} activeOrders
   * @param {Object} context
   * @param {string} context.eventId
   * @param {string} context.ticketCategoryId
   * @param {string} context.marketKey
   * @throws {MarketReconstructionError} If any mismatch is found.
   */
  _verifyBookMatchesDatabaseSnapshot(book, activeOrders, { eventId, ticketCategoryId, marketKey }) {
    if (!book || typeof book !== 'object') {
      throw new MarketReconstructionError(
        `Invalid or missing OrderBook instance for market "${marketKey}"`,
        { marketKey, reason: 'INVALID_BOOK_INSTANCE' }
      );
    }

    if (book.eventId !== eventId || book.ticketCategoryId !== ticketCategoryId) {
      throw new MarketReconstructionError(
        `Market identifier mismatch on book: expected (${eventId}, ${ticketCategoryId}), found (${book.eventId}, ${book.ticketCategoryId})`,
        { marketKey, reason: 'MARKET_IDENTIFIER_MISMATCH' }
      );
    }

    let expectedTotalQty = 0;
    for (const o of activeOrders) {
      expectedTotalQty += o.remainingQuantity;
    }

    if (book.size() !== activeOrders.length) {
      throw new MarketReconstructionError(
        `Reconstructed book size (${book.size()}) does not match active orders count (${activeOrders.length}) for "${marketKey}"`,
        { marketKey, reason: 'SNAPSHOT_SIZE_MISMATCH' }
      );
    }

    if (book.totalQuantity() !== expectedTotalQty) {
      throw new MarketReconstructionError(
        `Reconstructed book total quantity (${book.totalQuantity()}) does not match expected total (${expectedTotalQty}) for "${marketKey}"`,
        { marketKey, reason: 'SNAPSHOT_QUANTITY_MISMATCH' }
      );
    }

    // Verify every active order individually
    for (const dbOrder of activeOrders) {
      const lookup = book.getOrder(dbOrder.id);
      if (!lookup) {
        throw new MarketReconstructionError(
          `Order "${dbOrder.id}" exists in database snapshot but is missing from book`,
          { marketKey, orderId: dbOrder.id, reason: 'ORDER_MISSING_FROM_BOOK' }
        );
      }
      if (lookup.side !== dbOrder.side) {
        throw new MarketReconstructionError(
          `Order "${dbOrder.id}" side mismatch: expected ${dbOrder.side}, found ${lookup.side}`,
          { marketKey, orderId: dbOrder.id, reason: 'ORDER_SIDE_MISMATCH' }
        );
      }
      const bookOrder = lookup.order;
      if (bookOrder.price !== dbOrder.price) {
        throw new MarketReconstructionError(
          `Order "${dbOrder.id}" price mismatch: expected ${dbOrder.price}, found ${bookOrder.price}`,
          { marketKey, orderId: dbOrder.id, reason: 'ORDER_PRICE_MISMATCH' }
        );
      }
      if (bookOrder.remainingQuantity !== dbOrder.remainingQuantity) {
        throw new MarketReconstructionError(
          `Order "${dbOrder.id}" remainingQuantity mismatch: expected ${dbOrder.remainingQuantity}, found ${bookOrder.remainingQuantity}`,
          { marketKey, orderId: dbOrder.id, reason: 'ORDER_QUANTITY_MISMATCH' }
        );
      }
      if (dbOrder.userId && bookOrder.userId !== dbOrder.userId) {
        throw new MarketReconstructionError(
          `Order "${dbOrder.id}" userId mismatch: expected ${dbOrder.userId}, found ${bookOrder.userId}`,
          { marketKey, orderId: dbOrder.id, reason: 'ORDER_USER_MISMATCH' }
        );
      }
      if (bookOrder.eventId !== eventId || bookOrder.ticketCategoryId !== ticketCategoryId) {
        throw new MarketReconstructionError(
          `Order "${dbOrder.id}" market mismatch: expected (${eventId}, ${ticketCategoryId}), found (${bookOrder.eventId}, ${bookOrder.ticketCategoryId})`,
          { marketKey, orderId: dbOrder.id, reason: 'ORDER_MARKET_MISMATCH' }
        );
      }
    }

    // Verify FIFO ordering within each (side, price) level
    const dbGroups = new Map();
    for (const o of activeOrders) {
      const key = `${o.side}:${o.price}`;
      if (!dbGroups.has(key)) {
        dbGroups.set(key, []);
      }
      dbGroups.get(key).push(o.id);
    }

    for (const [groupKey, expectedOrderIds] of dbGroups.entries()) {
      const [side, priceStr] = groupKey.split(':');
      const price = parseInt(priceStr, 10);
      const bookOrders = book.getOrders(side).filter((o) => o.price === price);
      const actualOrderIds = bookOrders.map((o) => o.id);

      if (actualOrderIds.length !== expectedOrderIds.length) {
        throw new MarketReconstructionError(
          `FIFO queue count mismatch on ${side} at price ${price}: expected ${expectedOrderIds.length}, found ${actualOrderIds.length}`,
          { marketKey, reason: 'FIFO_COUNT_MISMATCH' }
        );
      }

      for (let i = 0; i < expectedOrderIds.length; i++) {
        if (actualOrderIds[i] !== expectedOrderIds[i]) {
          throw new MarketReconstructionError(
            `FIFO queue ordering mismatch on ${side} at price ${price} at position ${i}: expected order "${expectedOrderIds[i]}", found "${actualOrderIds[i]}"`,
            { marketKey, reason: 'FIFO_ORDERING_MISMATCH' }
          );
        }
      }
    }

    // Check for phantom orders in the book
    const activeIds = new Set(activeOrders.map((o) => o.id));
    const allBookOrders = [...book.getOrders('BID'), ...book.getOrders('ASK')];
    for (const o of allBookOrders) {
      if (!activeIds.has(o.id)) {
        throw new MarketReconstructionError(
          `Phantom order "${o.id}" found in book that is not in database snapshot`,
          { marketKey, orderId: o.id, reason: 'PHANTOM_ORDER_IN_BOOK' }
        );
      }
    }
  }

  /**
   * Deterministically reconstructs a market's in-memory OrderBook from active orders in PostgreSQL.
   * Serialized via MarketExecutionQueue to prevent interleaving with submissions.
   *
   * @param {string|Object} marketKeyOrConfig
   * @param {Object} [options]
   * @param {string} [options.targetState=MarketState.READY]
   * @returns {Promise<Object>}
   */
  async reconstructMarket(marketKeyOrConfig, { targetState = MarketState.READY } = {}) {
    const marketKey = this._resolveKey(marketKeyOrConfig);
    const { eventId, ticketCategoryId } = parseMarketKey(marketKey);

    if (!this.stateManager.hasMarket(marketKey)) {
      this.stateManager.registerMarket(marketKey, MarketState.INITIALIZING);
    }

    return this.queue.execute(
      marketKey,
      async () => {
        const { activeOrders, totalQuantity } = await this._reconstructBookUnderQueue(
          marketKey,
          eventId,
          ticketCategoryId
        );

        const currentState = this.stateManager.getState(marketKey);
        // If administratively paused, preserve PAUSED state
        if (currentState === MarketState.PAUSED) {
          return {
            marketKey,
            eventId,
            ticketCategoryId,
            activeOrdersCount: activeOrders.length,
            totalRemainingQuantity: totalQuantity,
            marketState: MarketState.PAUSED,
          };
        }

        // If targetState is READY and current state allows transition to READY
        if (
          targetState === MarketState.READY &&
          (currentState === MarketState.INITIALIZING || currentState === MarketState.RECONCILING)
        ) {
          this.stateManager.transition(marketKey, MarketState.READY);
        }

        return {
          marketKey,
          eventId,
          ticketCategoryId,
          activeOrdersCount: activeOrders.length,
          totalRemainingQuantity: totalQuantity,
          marketState: this.stateManager.getState(marketKey),
        };
      },
      { checkState: false }
    );
  }

  /**
   * Reconciles a quarantined or recovering market:
   * 1. If an ambiguous submission is specified ({ userId, idempotencyKey }), queries PostgreSQL
   *    authoritatively to establish whether it committed, returning the stored outcome.
   * 2. Reconstructs the in-memory OrderBook from PostgreSQL.
   * 3. Verifies book invariants.
   * 4. Transitions the market to READY (unless administratively PAUSED).
   *
   * @param {string|Object} marketKeyOrConfig
   * @param {Object} [options]
   * @param {Object} [options.ambiguousSubmission] - { userId, idempotencyKey }
   * @returns {Promise<Object>}
   */
  async reconcileMarket(marketKeyOrConfig, { ambiguousSubmission = null } = {}) {
    const marketKey = this._resolveKey(marketKeyOrConfig);
    const { eventId, ticketCategoryId } = parseMarketKey(marketKey);

    return this.queue.execute(
      marketKey,
      async () => {
        let ambiguousOutcome = null;

        if (ambiguousSubmission && ambiguousSubmission.userId && ambiguousSubmission.idempotencyKey) {
          try {
            const committedOrder = await this.repository.findByIdempotencyKey(
              ambiguousSubmission.userId,
              ambiguousSubmission.idempotencyKey
            );
            if (committedOrder) {
              ambiguousOutcome = {
                committed: true,
                result: this._formatSubmissionResultFromRecord(committedOrder),
              };
            } else {
              ambiguousOutcome = {
                committed: false,
                result: null,
              };
            }
          } catch (err) {
            throw new MarketReconciliationError(
              `Failed to query PostgreSQL during reconciliation of ambiguous submission for market "${marketKey}": ${err.message}`,
              { marketKey, originalError: err }
            );
          }
        }

        let reconstructResult;
        try {
          reconstructResult = await this._reconstructBookUnderQueue(
            marketKey,
            eventId,
            ticketCategoryId
          );
        } catch (err) {
          throw new MarketReconciliationError(
            `Failed to reconstruct order book during reconciliation for market "${marketKey}": ${err.message}`,
            { marketKey, originalError: err }
          );
        }

        const { activeOrders, totalQuantity } = reconstructResult;
        const currentState = this.stateManager.getState(marketKey);

        if (currentState === MarketState.PAUSED) {
          return {
            marketKey,
            eventId,
            ticketCategoryId,
            activeOrdersCount: activeOrders.length,
            totalRemainingQuantity: totalQuantity,
            marketState: MarketState.PAUSED,
            ambiguousOutcome,
          };
        }

        if (currentState === MarketState.RECONCILING || currentState === MarketState.INITIALIZING) {
          this.stateManager.transition(marketKey, MarketState.READY);
        }

        return {
          marketKey,
          eventId,
          ticketCategoryId,
          activeOrdersCount: activeOrders.length,
          totalRemainingQuantity: totalQuantity,
          marketState: this.stateManager.getState(marketKey),
          ambiguousOutcome,
        };
      },
      { checkState: false }
    );
  }

  /**
   * Initializes a market from cold start, reconstructing from PostgreSQL and transitioning to READY.
   * If requireMarketLease is enabled, acquires distributed lease before reconstruction.
   *
   * @param {string|Object} marketKeyOrConfig
   * @param {Object} [options]
   * @param {boolean} [options.acquireLease=true]
   * @param {number} [options.leaseDurationMs]
   * @returns {Promise<Object>}
   */
  async initializeAndSynchronizeMarket(marketKeyOrConfig, { acquireLease = this.requireMarketLease, leaseDurationMs } = {}) {
    const marketKey = this._resolveKey(marketKeyOrConfig);
    const { eventId, ticketCategoryId } = parseMarketKey(marketKey);

    if (acquireLease && this.leaseManager) {
      return this.acquireMarketOwnership(marketKey, { leaseDurationMs, reconstruct: true });
    }

    if (!this._marketBooks.has(marketKey)) {
      this.registerMarketBook(marketKey, new OrderBook({ eventId, ticketCategoryId }), { synchronized: false });
    }

    return this.reconstructMarket(marketKey, { targetState: MarketState.READY });
  }

  /**
   * Acquires exclusive distributed ownership for a market, starts autonomous renewal,
   * and optionally reconstructs the order book from PostgreSQL.
   *
   * @param {string|Object} marketKeyOrConfig
   * @param {Object} [options]
   * @param {number} [options.leaseDurationMs]
   * @param {boolean} [options.reconstruct=true]
   * @returns {Promise<Object>}
   */
  async acquireMarketOwnership(marketKeyOrConfig, { leaseDurationMs, reconstruct = true } = {}) {
    const marketKey = this._resolveKey(marketKeyOrConfig);
    const { eventId, ticketCategoryId } = parseMarketKey(marketKey);

    if (!this.leaseManager) {
      throw new MarketOwnershipError(
        `Cannot acquire market lease for "${marketKey}": no MarketLeaseManager configured`,
        { code: 'NO_LEASE_MANAGER', marketKey }
      );
    }

    const result = await this.leaseManager.acquireLease({
      eventId,
      ticketCategoryId,
      leaseDurationMs,
    });

    if (!result.acquired) {
      throw new MarketOwnershipError(
        `Market lease unavailable for "${marketKey}": owned by instance "${result.ownerId}"`,
        {
          code: 'MARKET_LEASE_UNAVAILABLE',
          marketKey,
          eventId,
          ticketCategoryId,
          ownerId: result.ownerId,
          fencingToken: result.fencingToken,
          expiresAt: result.expiresAt,
          reason: result.reason,
        }
      );
    }

    const leaseInfo = {
      marketKey,
      eventId,
      ticketCategoryId,
      ownerId: result.ownerId,
      fencingToken: result.fencingToken,
      expiresAt: result.expiresAt,
      leaseDurationMs: leaseDurationMs || this.leaseManager.defaultLeaseDurationMs,
    };
    this._marketLeases.set(marketKey, leaseInfo);

    // Start autonomous periodic renewal
    this.leaseManager.startAutoRenewal(marketKey, {
      onRenewalFailure: (err) => {
        this._marketLeases.delete(marketKey);
        try {
          this.stateManager.transition(marketKey, MarketState.RECONCILING);
        } catch {
          // Ignore if already transitioning
        }
      },
    });

    if (!this._marketBooks.has(marketKey)) {
      this.registerMarketBook(marketKey, new OrderBook({ eventId, ticketCategoryId }), { synchronized: false });
    }

    let reconResult = null;
    if (reconstruct) {
      reconResult = await this.reconstructMarket(marketKey, { targetState: MarketState.READY });
    }

    return {
      marketKey,
      eventId,
      ticketCategoryId,
      ownerId: result.ownerId,
      fencingToken: result.fencingToken,
      expiresAt: result.expiresAt,
      takeover: Boolean(result.takeover),
      renewed: Boolean(result.renewed),
      ...(reconResult || {}),
      reconstruction: reconResult,
    };
  }

  /**
   * Releases exclusive distributed ownership of a market and stops renewal.
   *
   * @param {string|Object} marketKeyOrConfig
   * @returns {Promise<Object>}
   */
  async releaseMarketOwnership(marketKeyOrConfig) {
    const marketKey = this._resolveKey(marketKeyOrConfig);
    const { eventId, ticketCategoryId } = parseMarketKey(marketKey);

    const lease = this._marketLeases.get(marketKey);
    this._marketLeases.delete(marketKey);

    let releaseResult = { released: false };
    if (this.leaseManager) {
      this.leaseManager.stopAutoRenewal(marketKey);
      if (lease) {
        releaseResult = await this.leaseManager.releaseLease({
          eventId,
          ticketCategoryId,
          expectedFencingToken: lease.fencingToken,
        });
      }
    }

    try {
      this.stateManager.transition(marketKey, MarketState.RECONCILING);
    } catch {
      // Ignore transition error
    }

    return releaseResult;
  }

  /**
   * Retrieves active lease information for a market.
   *
   * @param {string|Object} marketKeyOrConfig
   * @returns {Object|null}
   */
  getMarketLease(marketKeyOrConfig) {
    const marketKey = this._resolveKey(marketKeyOrConfig);
    const lease = this._marketLeases.get(marketKey);
    if (!lease) return null;
    return { ...lease };
  }

  /**
   * Releases all actively owned market leases on graceful shutdown.
   *
   * @returns {Promise<Array<Object>>}
   */
  async releaseAllLeases() {
    this._marketLeases.clear();
    if (!this.leaseManager) return [];
    return this.leaseManager.releaseAll();
  }

  /**
   * Certifies a market's book as synchronized after verifying against PostgreSQL active orders.
   *
   * @param {string|Object} marketKeyOrConfig
   * @throws {MarketNotSynchronizedError} If verification fails.
   */
  async markMarketSynchronized(marketKeyOrConfig) {
    const marketKey = this._resolveKey(marketKeyOrConfig);
    const { eventId, ticketCategoryId } = parseMarketKey(marketKey);
    const book = this._marketBooks.get(marketKey);
    if (!book) {
      throw new MarketNotSynchronizedError(
        `Cannot mark market "${marketKey}" synchronized: no OrderBook registered.`,
        { marketKey }
      );
    }

    const activeOrders = await this.repository.findActiveOrdersByMarket(eventId, ticketCategoryId);
    try {
      this._verifyBookMatchesDatabaseSnapshot(book, activeOrders, { eventId, ticketCategoryId, marketKey });
    } catch (err) {
      this._quarantineCorruptedMarket(marketKey);
      throw new MarketNotSynchronizedError(
        `Cannot mark market "${marketKey}" synchronized: snapshot verification failed: ${err.message}`,
        { marketKey, originalError: err }
      );
    }

    this._corruptedMarkets.delete(marketKey);
    this._synchronizedMarkets.add(marketKey);
  }

  /**
   * Checks whether a market is marked synchronized.
   *
   * @param {string|Object} marketKeyOrConfig
   * @returns {boolean}
   */
  isMarketSynchronized(marketKeyOrConfig) {
    const marketKey = this._resolveKey(marketKeyOrConfig);
    return this._synchronizedMarkets.has(marketKey) && !this._corruptedMarkets.has(marketKey);
  }

  /**
   * Evaluates the operational readiness and integrity of the matching coordinator:
   * - Must have state manager and execution queue initialized.
   * - Must not have any markets flagged as corrupted in `_corruptedMarkets`.
   * - None of the registered markets may be actively in RECONCILING state.
   *
   * @returns {{ ready: boolean, reason?: string, details?: Object }}
   */
  checkReadiness() {
    if (!this.stateManager || !this.queue) {
      return { ready: false, reason: 'Matching coordinator sub-services not initialized' };
    }
    if (this._corruptedMarkets && this._corruptedMarkets.size > 0) {
      return {
        ready: false,
        reason: 'One or more markets are flagged as corrupted or require reconciliation',
        corruptedCount: this._corruptedMarkets.size,
      };
    }
    if (this.stateManager && typeof this.stateManager.getRegisteredMarkets === 'function') {
      const registered = this.stateManager.getRegisteredMarkets();
      for (const key of registered) {
        const state = this.stateManager.getState(key);
        if (state === MarketState.RECONCILING) {
          return {
            ready: false,
            reason: `Market "${key}" is currently reconciling`,
            marketKey: key,
          };
        }
      }
    }
    if (this.requireMarketLease && this._marketLeases) {
      for (const [key, lease] of this._marketLeases.entries()) {
        const state = this.stateManager ? this.stateManager.getState(key) : null;
        if (state === MarketState.READY) {
          if (this.leaseManager && !this.leaseManager.isLeaseActive(key)) {
            return {
              ready: false,
              reason: `Market "${key}" lease is expired or lost`,
            };
          }
        }
      }
    }
    return { ready: true };
  }

  /**
   * Retrieves the in-memory OrderBook registered for a market.
   *
   * @param {string|Object} marketKeyOrConfig
   * @returns {import('./order-book.js').OrderBook|null}
   */
  getMarketBook(marketKeyOrConfig) {
    const marketKey = this._resolveKey(marketKeyOrConfig);
    return this._marketBooks.get(marketKey) || null;
  }

  /**
   * Asserts that a market is synchronized with PostgreSQL before matching.
   * Rejects if active resting orders exist in PostgreSQL that are missing from memory.
   *
   * @private
   * @param {string} marketKey
   * @param {string} eventId
   * @param {string} ticketCategoryId
   * @param {import('./order-book.js').OrderBook} book
   * @throws {MarketNotSynchronizedError|MarketStateDivergenceError}
   */
  async _assertMarketSynchronized(marketKey, eventId, ticketCategoryId, book) {
    if (this._corruptedMarkets.has(marketKey)) {
      throw new MarketStateDivergenceError(
        `Market "${marketKey}" in-memory book is corrupted due to prior post-commit mutation failure`,
        { marketKey }
      );
    }

    if (this._synchronizedMarkets.has(marketKey)) {
      return;
    }

    // Check database state to verify synchronization
    const activeOrders = await this.repository.findActiveOrdersByMarket(eventId, ticketCategoryId);

    if (activeOrders.length === 0) {
      if (book.isEmpty()) {
        // Clean new market with 0 persisted orders and empty book: verified synchronized
        this._synchronizedMarkets.add(marketKey);
        return;
      }
      throw new MarketNotSynchronizedError(
        `Market "${marketKey}" is not synchronized: in-memory book contains ${book.size()} orders but PostgreSQL has 0 active orders.`,
        { marketKey, activeOrdersCount: 0 }
      );
    }

    // PostgreSQL has active resting orders! If the in-memory book is empty, it is missing state.
    if (book.isEmpty()) {
      throw new MarketNotSynchronizedError(
        `Market "${marketKey}" is not synchronized with database: ${activeOrders.length} active resting orders exist in PostgreSQL but are missing from in-memory OrderBook.`,
        { marketKey, activeOrdersCount: activeOrders.length }
      );
    }

    // For non-empty books without explicit sync flag, reject until Step 8.4 reconstruction establishes sync
    throw new MarketNotSynchronizedError(
      `Market "${marketKey}" synchronization has not been verified against persisted orders.`,
      { marketKey, activeOrdersCount: activeOrders.length }
    );
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
      orderType = 'LIMIT',
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
    if (orderType !== 'LIMIT' && orderType !== 'MARKET') {
      throw new OrderValidationError('orderType must be LIMIT or MARKET', 'orderType');
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
      orderType,
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

      // Verify active market lease if distributed coordination is enabled
      let leaseContext = null;
      const hasCachedLease = this._marketLeases.has(marketKey);
      if (this.requireMarketLease || hasCachedLease) {
        const lease = this._marketLeases.get(marketKey);
        if (!lease) {
          throw new MarketOwnershipError(
            `Cannot submit order for market "${marketKey}": this instance does not hold an active market lease`,
            { code: 'NO_MARKET_LEASE', marketKey }
          );
        }
        if (this.leaseManager && !this.leaseManager.isLeaseActive(marketKey)) {
          throw new MarketOwnershipError(
            `Cannot submit order for market "${marketKey}": market lease has expired`,
            { code: 'LEASE_EXPIRED', marketKey }
          );
        }
        leaseContext = {
          ownerId: lease.ownerId,
          fencingToken: lease.fencingToken,
          eventId: validatedOrder.eventId,
          ticketCategoryId: validatedOrder.ticketCategoryId,
        };
      }

      // Verify in-memory OrderBook is registered
      const book = this._marketBooks.get(marketKey);
      if (!book) {
        throw new MarketStateDivergenceError(
          `No in-memory OrderBook registered for market "${marketKey}"`,
          { marketKey }
        );
      }

      // Assert market book is synchronized with PostgreSQL
      await this._assertMarketSynchronized(
        marketKey,
        validatedOrder.eventId,
        validatedOrder.ticketCategoryId,
        book
      );

      // 4. Look up existing submission by (userId, idempotencyKey)
      const existing = await this.repository.findByIdempotencyKey(
        validatedOrder.userId,
        validatedOrder.idempotencyKey
      );

      if (existing) {
        assertIdempotentPayloadMatches(existing, validatedOrder);
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
        orderType: validatedOrder.orderType,
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
          leaseContext,
        });
      } catch (err) {
        // Handle fencing violation: former owner rejected by database boundary
        if (err instanceof FencingViolationError || err.name === 'FencingViolationError') {
          this._marketLeases.delete(marketKey);
          if (this.leaseManager) {
            this.leaseManager.stopAutoRenewal(marketKey);
          }
          try {
            this.stateManager.transition(marketKey, MarketState.RECONCILING);
          } catch {}
          throw err;
        }
        // Handle database uniqueness collision (concurrent idempotency retry race)
        if (err.code === 'P2002') {
          if (!isIdempotencyKeyConstraintViolation(err)) {
            // Unrelated unique constraint violation (e.g. order ID collision)
            throw err;
          }
          const rechecked = await this.repository.findByIdempotencyKey(
            validatedOrder.userId,
            validatedOrder.idempotencyKey
          );
          if (rechecked) {
            assertIdempotentPayloadMatches(rechecked, validatedOrder);
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
        // Catastrophic divergence: DB committed but in-memory book mutation failed
        this._synchronizedMarkets.delete(marketKey);
        this._corruptedMarkets.add(marketKey);
        this.stateManager.transition(marketKey, MarketState.RECONCILING);
        throw new PostCommitMutationError(
          `Database committed order "${validatedOrder.id}", but in-memory book mutation failed. Market quarantined into RECONCILING.`,
          {
            originalError: mutationErr,
            marketKey,
            orderId: validatedOrder.id,
            persistedOrder: persisted.persistedOrder,
            persistedExecutions: persisted.persistedExecutions,
          }
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

  /**
   * Cancels an open or partially filled limit order under MarketExecutionQueue serialization.
   * Updates PostgreSQL status to CANCELLED and removes unfilled resting quantity from the in-memory OrderBook.
   *
   * @param {Object} params
   * @param {string} params.eventId
   * @param {string} params.ticketCategoryId
   * @param {string} params.orderId
   * @param {string} params.userId
   * @returns {Promise<Object>} Cancellation result.
   */
  async cancelLimitOrder({ eventId, ticketCategoryId, orderId, userId }) {
    if (!eventId || typeof eventId !== 'string' || !eventId.trim()) {
      throw new OrderValidationError('eventId must be a non-empty string', 'eventId');
    }
    if (!ticketCategoryId || typeof ticketCategoryId !== 'string' || !ticketCategoryId.trim()) {
      throw new OrderValidationError('ticketCategoryId must be a non-empty string', 'ticketCategoryId');
    }
    if (!orderId || typeof orderId !== 'string' || !orderId.trim()) {
      throw new OrderValidationError('orderId must be a non-empty string', 'orderId');
    }
    if (!userId || typeof userId !== 'string' || !userId.trim()) {
      throw new OrderValidationError('userId must be a non-empty string', 'userId');
    }

    const marketKey = formatMarketKey(eventId.trim(), ticketCategoryId.trim());

    return this.queue.execute(marketKey, async () => {
      // 1. Verify market readiness
      this.stateManager.assertReady(marketKey);

      // Verify active market lease if distributed coordination is enabled
      let leaseContext = null;
      const hasCachedLease = this._marketLeases.has(marketKey);
      if (this.requireMarketLease || hasCachedLease) {
        const lease = this._marketLeases.get(marketKey);
        if (!lease) {
          throw new MarketOwnershipError(
            `Cannot cancel order for market "${marketKey}": this instance does not hold an active market lease`,
            { code: 'NO_MARKET_LEASE', marketKey }
          );
        }
        if (this.leaseManager && !this.leaseManager.isLeaseActive(marketKey)) {
          throw new MarketOwnershipError(
            `Cannot cancel order for market "${marketKey}": market lease has expired`,
            { code: 'LEASE_EXPIRED', marketKey }
          );
        }
        leaseContext = {
          ownerId: lease.ownerId,
          fencingToken: lease.fencingToken,
          eventId: eventId.trim(),
          ticketCategoryId: ticketCategoryId.trim(),
        };
      }

      const book = this._marketBooks.get(marketKey);
      if (!book) {
        throw new MarketStateDivergenceError(
          `No in-memory OrderBook registered for market "${marketKey}"`,
          { marketKey }
        );
      }

      // 2. Execute cancellation inside an atomic transaction
      try {
        return await this.repository.prisma.$transaction(async (tx) => {
          if (leaseContext) {
            await verifyFencingToken(tx, leaseContext);
          }

          const order = await tx.order.findUnique({
            where: { id: orderId },
          });

        if (!order) {
          throw new OrderValidationError(`Order not found: ${orderId}`, 'orderId');
        }
        if (order.userId !== userId) {
          throw new OrderValidationError('Unauthorized: order does not belong to user', 'userId');
        }
        if (order.eventId !== eventId || order.ticketCategoryId !== ticketCategoryId) {
          throw new OrderValidationError(
            `Market mismatch: order belongs to ${order.eventId}:${order.ticketCategoryId}, requested ${eventId}:${ticketCategoryId}`,
            'marketKey'
          );
        }

        // Idempotent replay for already cancelled order
        if (order.status === 'CANCELLED') {
          return {
            orderId: order.id,
            status: 'CANCELLED',
            cancelledQuantity: 0,
            remainingQuantity: 0,
            isDuplicate: true,
            side: order.side,
            price: order.price,
            eventId: order.eventId,
            ticketCategoryId: order.ticketCategoryId,
            userId: order.userId,
          };
        }

        if (order.status === 'FILLED') {
          throw new OrderValidationError('Cannot cancel fully filled order', 'status');
        }
        if (order.status === 'REJECTED') {
          throw new OrderValidationError('Cannot cancel rejected order', 'status');
        }

        const cancelledQuantity = order.remainingQuantity;

        // Update database record
        const updatedOrder = await tx.order.update({
          where: { id: orderId },
          data: {
            status: 'CANCELLED',
            remainingQuantity: 0,
          },
        });

        // Mutate in-memory OrderBook
        book.cancelOrder(orderId);

        return {
          orderId: updatedOrder.id,
          status: 'CANCELLED',
          cancelledQuantity,
          remainingQuantity: 0,
          isDuplicate: false,
          side: updatedOrder.side,
          price: updatedOrder.price,
          eventId: updatedOrder.eventId,
          ticketCategoryId: updatedOrder.ticketCategoryId,
          userId: updatedOrder.userId,
        };
      });
      } catch (err) {
        if (err instanceof FencingViolationError || err.name === 'FencingViolationError') {
          this._marketLeases.delete(marketKey);
          if (this.leaseManager) {
            this.leaseManager.stopAutoRenewal(marketKey);
          }
          try {
            this.stateManager.transition(marketKey, MarketState.RECONCILING);
          } catch {}
        }
        throw err;
      }
    });
  }
}

