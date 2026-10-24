/**
 * Durable execution settlement.  Matching only persists executions; this service
 * performs the financial and inventory effects in one PostgreSQL transaction.
 *
 * Lock order for resources held simultaneously is: Execution, Order (id ASC),
 * Wallet (id ASC), WalletHold, UserTicketInventory (userId ASC).  The execution
 * row is the durable claim: another worker blocks before it can inspect or make
 * a non-idempotent mutation, then observes the committed TradeSettlement.
 */
import crypto from 'node:crypto';
import { prisma as defaultPrisma } from '../../db/prisma.js';
import { MAX_PAISE } from '../wallet/wallet-service.js';
import logger from '../../errorlogging/logger.js';

export const DEFAULT_MAX_AUTO_RETRIES = 5;
export const DEFAULT_BASE_BACKOFF_MS = 1000;
export const DEFAULT_MAX_BACKOFF_MS = 60000;

export class SettlementInvariantError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'SettlementInvariantError';
    this.code = 'SETTLEMENT_INVARIANT';
    this.details = details;
  }
}

/** Exact paise arithmetic shared by settlement and focused regression tests. */
export function calculateSettlementAmounts({ limitPricePaise, executionPricePaise, quantity }) {
  for (const [name, value] of Object.entries({ limitPricePaise, executionPricePaise, quantity })) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new SettlementInvariantError(`${name} must be a positive safe integer`);
    }
  }
  if (executionPricePaise > limitPricePaise) {
    throw new SettlementInvariantError('Execution price exceeds buyer limit');
  }
  const quantityBigInt = BigInt(quantity);
  const buyerReservedConsumed = BigInt(limitPricePaise) * quantityBigInt;
  const executionCost = BigInt(executionPricePaise) * quantityBigInt;
  if (buyerReservedConsumed > MAX_PAISE || executionCost > MAX_PAISE) {
    throw new SettlementInvariantError('Settlement amount exceeds supported monetary boundary');
  }
  return { executionCost, buyerReservedConsumed, priceImprovement: buyerReservedConsumed - executionCost };
}

/**
 * Calculates bounded exponential backoff delay with jitter.
 */
export function calculateBackoff({
  attempt,
  baseBackoffMs = DEFAULT_BASE_BACKOFF_MS,
  maxBackoffMs = DEFAULT_MAX_BACKOFF_MS,
  jitter = true,
  randomFn = Math.random,
} = {}) {
  const safeAttempt = Number.isSafeInteger(attempt) && attempt > 0 ? attempt : 1;
  const exponential = baseBackoffMs * (2 ** Math.min(safeAttempt - 1, 10));
  const bounded = Math.min(maxBackoffMs, exponential);
  if (!jitter) return Math.round(bounded);
  const jitterOffset = Math.round(bounded * 0.2 * (typeof randomFn === 'function' ? randomFn() : Math.random()));
  return bounded + jitterOffset;
}

/**
 * Checks whether an error indicates a transient serialization conflict or lock contention.
 */
export function isTransientSettlementConflict(error) {
  if (!error || typeof error !== 'object') return false;
  if (error instanceof SettlementInvariantError) return false;
  if (error.name === 'SettlementInvariantError') return false;

  // Prisma write conflict / serialization code
  if (error.code === 'P2034') return true;

  const msg = typeof error.message === 'string' ? error.message : '';
  // PostgreSQL SQLSTATE 40001 (serialization failure)
  if (msg.includes('40001') || msg.includes('could not serialize access')) return true;
  // PostgreSQL SQLSTATE 40P01 (deadlock detected)
  if (msg.includes('40P01') || msg.includes('deadlock detected')) return true;
  // Connection drops / pool timeouts
  if (
    msg.includes('connection') ||
    msg.includes('Connection') ||
    msg.includes('timed out') ||
    msg.includes('timeout') ||
    error.code === 'P1001' ||
    error.code === 'P1002' ||
    error.code === 'P1008'
  ) {
    return true;
  }

  return false;
}

/**
 * Classifies an error into transient vs permanent, producing a sanitized error code.
 * Never leaks passwords, SQL statements, credentials, or raw stack traces.
 */
export function classifySettlementError(error) {
  if (!error) {
    return { type: 'UNKNOWN', code: 'UNKNOWN_ERROR', isTransient: false };
  }
  if (error instanceof SettlementInvariantError || error.name === 'SettlementInvariantError') {
    return {
      type: 'PERMANENT',
      code: error.code || 'SETTLEMENT_INVARIANT',
      isTransient: false,
    };
  }

  // Database integrity constraint violations are permanent business invariant violations
  if (
    error.code === 'P2002' ||
    error.code === 'P2003' ||
    error.code === '23505' ||
    error.code === '23503' ||
    error.code === '23514' ||
    (typeof error.message === 'string' && (
      error.message.includes('check constraint') ||
      error.message.includes('violates check constraint') ||
      error.message.includes('foreign key constraint') ||
      error.message.includes('violates foreign key')
    ))
  ) {
    return {
      type: 'PERMANENT',
      code: 'DATABASE_CONSTRAINT_VIOLATION',
      isTransient: false,
    };
  }

  if (error.code === 'P2034') {
    return { type: 'TRANSIENT', code: 'PRISMA_WRITE_CONFLICT', isTransient: true };
  }

  const msg = typeof error.message === 'string' ? error.message : '';
  if (msg.includes('40001') || msg.includes('could not serialize access')) {
    return { type: 'TRANSIENT', code: 'SERIALIZATION_FAILURE', isTransient: true };
  }
  if (msg.includes('40P01') || msg.includes('deadlock detected')) {
    return { type: 'TRANSIENT', code: 'DEADLOCK_DETECTED', isTransient: true };
  }
  if (
    msg.includes('connection') ||
    msg.includes('Connection') ||
    msg.includes('timed out') ||
    msg.includes('timeout') ||
    error.code === 'P1001' ||
    error.code === 'P1002' ||
    error.code === 'P1008'
  ) {
    return { type: 'TRANSIENT', code: 'DATABASE_CONNECTIVITY', isTransient: true };
  }

  // Programming errors (TypeError, ReferenceError, RangeError) are classified with clean code
  if (error instanceof TypeError || error instanceof ReferenceError || error instanceof RangeError) {
    return { type: 'TRANSIENT', code: 'PROGRAMMING_ERROR', isTransient: true };
  }

  // Conservative policy: unknown errors are treated as transient up to maxAutoRetries
  return { type: 'TRANSIENT', code: 'UNKNOWN_TRANSIENT_ERROR', isTransient: true };
}

export class TradeSettlementService {
  constructor({
    prismaClient = defaultPrisma,
    maxAutoRetries = Number(process.env.SETTLEMENT_MAX_AUTO_RETRIES) || DEFAULT_MAX_AUTO_RETRIES,
    baseBackoffMs = Number(process.env.SETTLEMENT_BASE_BACKOFF_MS) || DEFAULT_BASE_BACKOFF_MS,
    maxBackoffMs = Number(process.env.SETTLEMENT_MAX_BACKOFF_MS) || DEFAULT_MAX_BACKOFF_MS,
    jitter = true,
    loggerInstance = logger,
  } = {}) {
    this.prisma = prismaClient;
    this.maxAutoRetries =
      Number.isSafeInteger(maxAutoRetries) && maxAutoRetries > 0 ? maxAutoRetries : DEFAULT_MAX_AUTO_RETRIES;
    this.baseBackoffMs =
      Number.isSafeInteger(baseBackoffMs) && baseBackoffMs > 0 ? baseBackoffMs : DEFAULT_BASE_BACKOFF_MS;
    const rawMaxBackoff =
      Number.isSafeInteger(maxBackoffMs) && maxBackoffMs > 0 ? maxBackoffMs : DEFAULT_MAX_BACKOFF_MS;
    this.maxBackoffMs = Math.max(this.baseBackoffMs, rawMaxBackoff);
    this.jitter = Boolean(jitter);
    this.logger = loggerInstance;
    this.marketStreamService = null;
  }

  setMarketStreamService(service) {
    this.marketStreamService = service;
  }

  async settleExecution({ executionId, maxAttempts = 5 } = {}) {
    if (!executionId || typeof executionId !== 'string' || !executionId.trim()) {
      throw new SettlementInvariantError('executionId must be a non-empty string');
    }
    const cleanId = executionId.trim();
    const attemptsLimit = Number.isSafeInteger(maxAttempts) && maxAttempts > 0 ? maxAttempts : 5;

    let attempt = 0;
    while (attempt < attemptsLimit) {
      attempt++;
      try {
        const result = await this.prisma.$transaction((tx) => this._settle(tx, cleanId), {
          isolationLevel: 'Serializable',
          maxWait: 5000,
          timeout: 15000,
        });
        if (this.logger?.info) {
          this.logger.info('Settlement succeeded', {
            executionId: cleanId,
            isIdempotentReplay: result.isIdempotentReplay,
          });
        }
        if (result && !result.isIdempotentReplay && this.marketStreamService) {
          try {
            if (result.buyerUserId && result.buyerWallet) {
              this.marketStreamService.publishWalletUpdate({ userId: result.buyerUserId, wallet: result.buyerWallet });
            }
            if (result.sellerUserId && result.sellerWallet) {
              this.marketStreamService.publishWalletUpdate({ userId: result.sellerUserId, wallet: result.sellerWallet });
            }
          } catch {
            // Non-blocking WebSocket delivery
          }
        }
        return result;
      } catch (error) {
        if (!isTransientSettlementConflict(error) || attempt >= attemptsLimit) {
          if (typeof this.prisma?.execution?.update === 'function') {
            await this.recordSettlementFailure({ executionId: cleanId, error });
          }
          throw error;
        }
        // Bounded exponential backoff with jitter: 20ms * 2^(attempt - 1), capped at 200ms
        const baseDelay = Math.min(200, 20 * (2 ** (attempt - 1)));
        const jitter = Math.floor(Math.random() * 15);
        await new Promise((resolve) => setTimeout(resolve, baseDelay + jitter));
      }
    }
  }

  /**
   * Durably records a settlement failure, updates retry counts and timestamps,
   * schedules backoff for transient failures, or moves to MANUAL_REVIEW if permanent/exhausted.
   */
  async recordSettlementFailure({ executionId, error, now = new Date() } = {}) {
    if (!executionId || typeof executionId !== 'string') return null;
    if (typeof this.prisma?.execution?.update !== 'function') return null;
    const cleanId = executionId.trim();

    try {
      return await this.prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw`
          SELECT id, "settlementStatus", "retryCount", "lastAttemptedAt", "nextRetryAt", "lastErrorCode", "lastFailedAt"
          FROM "Execution"
          WHERE id = ${cleanId}
          FOR UPDATE
        `;
        if (!rows || rows.length === 0) return null;
        const execution = rows[0];

        // If already settled, do not corrupt settlement status or overwrite retry state
        if (execution.settlementStatus === 'SETTLED') {
          return execution;
        }

        // Verify if a TradeSettlement exists
        const settlement = await tx.tradeSettlement.findUnique({
          where: { executionId: cleanId },
        });
        if (settlement) {
          await tx.execution.update({
            where: { id: cleanId },
            data: {
              settlementStatus: 'SETTLED',
              nextRetryAt: null,
              lastErrorCode: null,
            },
          });
          return execution;
        }

        // If already under MANUAL_REVIEW, do not let a failure handler revert to PENDING or overwrite
        if (execution.settlementStatus === 'MANUAL_REVIEW') {
          return execution;
        }

        // Stale worker protection: if another worker has already recorded an attempt after `now`, do not overwrite newer metadata
        if (execution.lastAttemptedAt && new Date(execution.lastAttemptedAt) > now) {
          return execution;
        }

        const classification = classifySettlementError(error);
        const newRetryCount = execution.retryCount + 1;
        const isExceededRetries = newRetryCount >= this.maxAutoRetries;

        let newStatus = 'PENDING';
        let nextRetryAt = null;
        let finalErrorCode = classification.code;

        if (classification.type === 'PERMANENT') {
          newStatus = 'MANUAL_REVIEW';
          nextRetryAt = null;
        } else if (isExceededRetries) {
          newStatus = 'MANUAL_REVIEW';
          nextRetryAt = null;
          finalErrorCode = 'MAX_RETRIES_EXCEEDED';
        } else {
          newStatus = 'PENDING';
          const delayMs = calculateBackoff({
            attempt: newRetryCount,
            baseBackoffMs: this.baseBackoffMs,
            maxBackoffMs: this.maxBackoffMs,
            jitter: this.jitter,
          });
          nextRetryAt = new Date(now.getTime() + delayMs);
        }

        const updated = await tx.execution.update({
          where: { id: cleanId },
          data: {
            settlementStatus: newStatus,
            retryCount: newRetryCount,
            lastAttemptedAt: now,
            lastFailedAt: now,
            nextRetryAt,
            lastErrorCode: finalErrorCode,
          },
        });

        // Observability logging
        if (newStatus === 'MANUAL_REVIEW') {
          if (this.logger?.error) {
            this.logger.error('Settlement execution moved to manual review', {
              executionId: cleanId,
              retryCount: newRetryCount,
              errorCode: finalErrorCode,
              reason: classification.type === 'PERMANENT' ? 'PERMANENT_INVARIANT_VIOLATION' : 'MAX_RETRIES_EXCEEDED',
            });
          }
        } else {
          if (this.logger?.warn) {
            this.logger.warn('Settlement retry scheduled', {
              executionId: cleanId,
              retryCount: newRetryCount,
              errorCode: finalErrorCode,
              nextRetryAt: nextRetryAt?.toISOString(),
            });
          }
        }

        return updated;
      }, {
        isolationLevel: 'ReadCommitted',
        timeout: 10000,
      });
    } catch (recErr) {
      if (this.logger?.warn) {
        this.logger.warn('Failed to record settlement failure for execution', {
          executionId: cleanId,
          error: recErr.message,
        });
      }
      return null;
    }
  }

  /**
   * Internal service interface to requeue an execution under MANUAL_REVIEW back to PENDING.
   * Preserves retryCount for auditability by default unless resetRetryCount is true.
   */
  async requeueExecution({ executionId, resetRetryCount = false } = {}) {
    if (!executionId || typeof executionId !== 'string' || !executionId.trim()) {
      throw new SettlementInvariantError('executionId must be a non-empty string');
    }
    const cleanId = executionId.trim();

    return await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw`
        SELECT id, "settlementStatus", "retryCount"
        FROM "Execution"
        WHERE id = ${cleanId}
        FOR UPDATE
      `;
      if (!rows || rows.length === 0) {
        throw new SettlementInvariantError('Execution not found', { executionId: cleanId });
      }
      const execution = rows[0];

      if (execution.settlementStatus === 'SETTLED') {
        return {
          executionId: cleanId,
          status: 'SETTLED',
          requeued: false,
          message: 'Execution is already settled',
        };
      }

      // Check if TradeSettlement exists
      const settlement = await tx.tradeSettlement.findUnique({
        where: { executionId: cleanId },
      });
      if (settlement) {
        await tx.execution.update({
          where: { id: cleanId },
          data: {
            settlementStatus: 'SETTLED',
            nextRetryAt: null,
            lastErrorCode: null,
          },
        });
        return {
          executionId: cleanId,
          status: 'SETTLED',
          requeued: false,
          message: 'Execution is already settled',
        };
      }

      if (execution.settlementStatus === 'PENDING') {
        return {
          executionId: cleanId,
          status: 'PENDING',
          requeued: false,
          message: 'Execution is already pending',
        };
      }

      const updated = await tx.execution.update({
        where: { id: cleanId },
        data: {
          settlementStatus: 'PENDING',
          nextRetryAt: new Date(),
          retryCount: resetRetryCount ? 0 : execution.retryCount,
          lastErrorCode: null,
        },
      });

      if (this.logger?.info) {
        this.logger.info('Execution requeued for settlement recovery', {
          executionId: cleanId,
          retryCount: updated.retryCount,
          settlementStatus: updated.settlementStatus,
        });
      }

      return {
        executionId: cleanId,
        status: updated.settlementStatus,
        requeued: true,
        retryCount: updated.retryCount,
      };
    });
  }

  /**
   * Safe internal inspection helper for execution recovery state.
   */
  async getExecutionRecoveryState({ executionId } = {}) {
    if (!executionId || typeof executionId !== 'string') return null;
    return this.prisma.execution.findUnique({
      where: { id: executionId.trim() },
      select: {
        id: true,
        sequenceNumber: true,
        settlementStatus: true,
        retryCount: true,
        lastAttemptedAt: true,
        lastFailedAt: true,
        nextRetryAt: true,
        lastErrorCode: true,
        executedAt: true,
      },
    });
  }

  async recoverUnsettled({ batchSize = 100, afterSequenceNumber = null, now = new Date(), onlyDue } = {}) {
    if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 500) {
      throw new SettlementInvariantError('batchSize must be an integer from 1 to 500');
    }
    let cursor = null;
    if (afterSequenceNumber !== undefined && afterSequenceNumber !== null) {
      if (typeof afterSequenceNumber === 'bigint') {
        if (afterSequenceNumber < 0n) {
          throw new SettlementInvariantError('afterSequenceNumber must be a non-negative integer');
        }
        cursor = afterSequenceNumber;
      } else if (typeof afterSequenceNumber === 'number' && Number.isSafeInteger(afterSequenceNumber) && afterSequenceNumber >= 0) {
        cursor = BigInt(afterSequenceNumber);
      } else if (typeof afterSequenceNumber === 'string' && /^\d+$/.test(afterSequenceNumber)) {
        cursor = BigInt(afterSequenceNumber);
      } else {
        throw new SettlementInvariantError('afterSequenceNumber must be a non-negative integer or bigint');
      }
    }

    const shouldFilterDue = onlyDue !== undefined ? Boolean(onlyDue) : cursor === null;

    const where = {
      settlement: null,
      ...(cursor !== null ? { sequenceNumber: { gt: cursor } } : {}),
      ...(shouldFilterDue
        ? {
            settlementStatus: 'PENDING',
            OR: [
              { nextRetryAt: null },
              { retryCount: 0 },
              { nextRetryAt: { lte: now } },
            ],
          }
        : {}),
    };

    const select = shouldFilterDue
      ? { id: true, sequenceNumber: true, retryCount: true }
      : { id: true, sequenceNumber: true };

    const executions = await this.prisma.execution.findMany({
      where,
      select,
      orderBy: { sequenceNumber: 'asc' },
      take: batchSize,
    });
    const results = [];
    for (const execution of executions) {
      if (this.logger?.info) {
        this.logger.info('Settlement recovery attempt started', {
          executionId: execution.id,
          sequenceNumber: execution.sequenceNumber?.toString(),
          retryCount: execution.retryCount,
        });
      }
      try {
        const settlementOutcome = await this.settleExecution({ executionId: execution.id });
        if (this.logger?.info) {
          this.logger.info('Settlement recovery succeeded', {
            executionId: execution.id,
            sequenceNumber: execution.sequenceNumber?.toString(),
            isIdempotentReplay: settlementOutcome.isIdempotentReplay,
          });
        }
        results.push({
          ...settlementOutcome,
          executionId: execution.id,
          sequenceNumber: execution.sequenceNumber,
          settled: true,
        });
      } catch (error) {
        // A later recovery pass retries transient failures. Permanent errors
        // and exceeded retries have been recorded durably as MANUAL_REVIEW.
        results.push({
          executionId: execution.id,
          sequenceNumber: execution.sequenceNumber,
          settled: false,
          error,
        });
      }
    }
    return results;
  }

  async _settle(tx, executionId) {
    const executionRows = await tx.$queryRaw`
      SELECT * FROM "Execution" WHERE id = ${executionId} FOR UPDATE
    `;
    if (!executionRows?.length) throw new SettlementInvariantError('Execution not found', { executionId });
    const executionRow = executionRows[0];

    // If an execution was placed in MANUAL_REVIEW, it cannot be automatically settled
    // unless an operator requeues it (which transitions status back to PENDING).
    if (executionRow.settlementStatus === 'MANUAL_REVIEW') {
      throw new SettlementInvariantError('Execution is in MANUAL_REVIEW status and requires operator requeue', { executionId });
    }

    const execution = await tx.execution.findUnique({
      where: { id: executionId },
      include: { incomingOrder: true, restingOrder: true },
    });
    const orders = [execution.incomingOrder, execution.restingOrder];
    if (orders[0].side === orders[1].side) {
      throw new SettlementInvariantError('Execution does not join one BID and one ASK order', { executionId });
    }
    const buyerOrder = orders.find((order) => order.side === 'BID');
    const sellerOrder = orders.find((order) => order.side === 'ASK');
    if (buyerOrder.eventId !== sellerOrder.eventId || buyerOrder.ticketCategoryId !== sellerOrder.ticketCategoryId) {
      throw new SettlementInvariantError('Execution orders belong to different markets', { executionId });
    }
    if (execution.price > buyerOrder.price || execution.quantity <= 0 || execution.price <= 0) {
      throw new SettlementInvariantError('Execution violates buyer limit or has invalid value', { executionId });
    }
    const amounts = calculateSettlementAmounts({
      limitPricePaise: buyerOrder.price,
      executionPricePaise: execution.price,
      quantity: execution.quantity,
    });
    const existing = await tx.tradeSettlement.findUnique({ where: { executionId } });
    if (existing) {
      await this._assertExistingSettlement(tx, { existing, execution, buyerOrder, sellerOrder, amounts });
      if (executionRow.settlementStatus !== 'SETTLED') {
        await tx.execution.update({
          where: { id: executionId },
          data: {
            settlementStatus: 'SETTLED',
            nextRetryAt: null,
            lastErrorCode: null,
          },
        });
      }
      return { settlement: existing, isIdempotentReplay: true };
    }

    for (const order of [...orders].sort((a, b) => a.id.localeCompare(b.id))) {
      await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${order.id} FOR UPDATE`;
    }

    const buyerWallet = await tx.wallet.findUnique({ where: { userId: buyerOrder.userId } });
    const sellerWallet = await tx.wallet.findUnique({ where: { userId: sellerOrder.userId } });
    if (!buyerWallet || !sellerWallet || buyerWallet.id === sellerWallet.id || buyerOrder.userId === sellerOrder.userId) {
      throw new SettlementInvariantError('Distinct buyer and seller wallets are required', { executionId });
    }
    const wallets = [buyerWallet, sellerWallet].sort((a, b) => a.id.localeCompare(b.id));
    const lockedWallets = new Map();
    for (const wallet of wallets) {
      const rows = await tx.$queryRaw`SELECT * FROM "Wallet" WHERE id = ${wallet.id} FOR UPDATE`;
      lockedWallets.set(wallet.id, rows[0]);
    }
    const lockedBuyerWallet = lockedWallets.get(buyerWallet.id);
    const lockedSellerWallet = lockedWallets.get(sellerWallet.id);

    const holdRows = await tx.$queryRaw`
      SELECT * FROM "WalletHold"
      WHERE "orderId" = ${buyerOrder.id} AND reason = 'ORDER_ESCROW'
      FOR UPDATE
    `;
    if (holdRows.length !== 1) {
      throw new SettlementInvariantError('Buy order must have exactly one linked escrow hold', { executionId, buyerOrderId: buyerOrder.id });
    }
    const hold = holdRows[0];
    if (hold.walletId !== buyerWallet.id || !['ACTIVE', 'PARTIALLY_RELEASED', 'PARTIALLY_SETTLED'].includes(hold.status)) {
      throw new SettlementInvariantError('Buy escrow hold is not active for this wallet', { executionId, holdId: hold.id });
    }

    const { executionCost: cost, buyerReservedConsumed: consumed, priceImprovement: improvement } = amounts;
    if (improvement < 0n || BigInt(hold.remainingAmount) < consumed || BigInt(lockedBuyerWallet.reservedBalance) < consumed) {
      throw new SettlementInvariantError('Insufficient buyer reservation for execution', { executionId });
    }

    const inventoryRows = new Map();
    const inventoryUsers = [buyerOrder.userId, sellerOrder.userId].sort();
    for (const userId of inventoryUsers) {
      if (userId === buyerOrder.userId) {
        await tx.$executeRaw`
          INSERT INTO "UserTicketInventory" ("id", "userId", "ticketCategoryId", "totalQuantity", "availableQuantity", "reservedQuantity", "createdAt", "updatedAt")
          VALUES (${crypto.randomUUID()}, ${userId}, ${buyerOrder.ticketCategoryId}, 0, 0, 0, NOW(), NOW())
          ON CONFLICT ("userId", "ticketCategoryId") DO NOTHING
        `;
      }
      const rows = await tx.$queryRaw`
        SELECT * FROM "UserTicketInventory"
        WHERE "userId" = ${userId} AND "ticketCategoryId" = ${buyerOrder.ticketCategoryId} FOR UPDATE
      `;
      inventoryRows.set(userId, rows[0]);
    }
    const sellerInventory = inventoryRows.get(sellerOrder.userId);
    if (!sellerInventory || sellerInventory.reservedQuantity < execution.quantity || sellerInventory.totalQuantity < execution.quantity) {
      throw new SettlementInvariantError('Seller has insufficient reserved inventory', { executionId });
    }

    // Select and lock the seller's reserved tickets associated with sellerOrder
    const reservedTickets = await tx.$queryRaw`
      SELECT id, "ownerId", "categoryId", "eventId", "status", "orderId"
      FROM "Ticket"
      WHERE "orderId" = ${sellerOrder.id}
        AND "ownerId" = ${sellerOrder.userId}
        AND "categoryId" = ${buyerOrder.ticketCategoryId}
        AND "status" = 'LISTED'
      ORDER BY "createdAt" ASC, "id" ASC
      LIMIT ${execution.quantity}
      FOR UPDATE
    `;

    if (!reservedTickets || reservedTickets.length !== execution.quantity) {
      throw new SettlementInvariantError(
        `Seller does not have enough reserved tickets for order ${sellerOrder.id}. Expected ${execution.quantity}, found ${reservedTickets?.length || 0}`,
        { executionId, sellerOrderId: sellerOrder.id, expected: execution.quantity, found: reservedTickets?.length || 0 }
      );
    }

    const ticketIds = reservedTickets.map((t) => t.id);
    const now = new Date();

    // Transfer ticket ownership to buyer and clear order reservation
    await tx.ticket.updateMany({
      where: { id: { in: ticketIds } },
      data: {
        ownerId: buyerOrder.userId,
        status: 'OWNED',
        orderId: null,
      },
    });

    // Record append-only TicketOwnership history with source: RESALE
    for (const ticketId of ticketIds) {
      await tx.ticketOwnership.create({
        data: {
          ticketId,
          ownerId: buyerOrder.userId,
          acquiredAt: now,
          source: 'RESALE',
        },
      });
    }

    // Record completed TicketTransfer records
    for (const ticketId of ticketIds) {
      await tx.ticketTransfer.create({
        data: {
          ticketId,
          fromUserId: sellerOrder.userId,
          toUserId: buyerOrder.userId,
          status: 'COMPLETED',
          createdAt: now,
        },
      });
    }

    const buyerAvailable = BigInt(lockedBuyerWallet.availableBalance) + improvement;
    const buyerReserved = BigInt(lockedBuyerWallet.reservedBalance) - consumed;
    const sellerAvailable = BigInt(lockedSellerWallet.availableBalance) + cost;
    const buyerHoldRemaining = BigInt(hold.remainingAmount) - consumed;
    const holdStatus = buyerHoldRemaining === 0n ? 'SETTLED' : 'PARTIALLY_SETTLED';
    const prefix = `settlement:${executionId}`;

    const debitOp = await tx.financialOperation.create({ data: { idempotencyKey: `${prefix}:debit`, operationType: 'TRADE_SETTLEMENT', status: 'COMPLETED', referenceType: 'EXECUTION', referenceId: executionId } });
    await tx.walletLedgerEntry.create({ data: { walletId: buyerWallet.id, operationId: debitOp.id, holdId: hold.id, orderId: buyerOrder.id, executionId, entryType: 'TRADE_SETTLEMENT_DEBIT', amount: cost, availableDelta: improvement, reservedDelta: -consumed, balanceAfterAvailable: buyerAvailable, balanceAfterReserved: buyerReserved, idempotencyKey: `${prefix}:debit`, description: 'Execution settlement debit and price improvement release' } });
    const creditOp = await tx.financialOperation.create({ data: { idempotencyKey: `${prefix}:credit`, operationType: 'TRADE_SETTLEMENT', status: 'COMPLETED', referenceType: 'EXECUTION', referenceId: executionId } });
    await tx.walletLedgerEntry.create({ data: { walletId: sellerWallet.id, operationId: creditOp.id, orderId: sellerOrder.id, executionId, entryType: 'TRADE_SETTLEMENT_CREDIT', amount: cost, availableDelta: cost, reservedDelta: 0n, balanceAfterAvailable: sellerAvailable, balanceAfterReserved: BigInt(lockedSellerWallet.reservedBalance), idempotencyKey: `${prefix}:credit`, description: 'Execution settlement seller credit' } });
    await tx.wallet.update({ where: { id: buyerWallet.id }, data: { availableBalance: buyerAvailable, reservedBalance: buyerReserved, version: BigInt(lockedBuyerWallet.version) + 1n } });
    await tx.wallet.update({ where: { id: sellerWallet.id }, data: { availableBalance: sellerAvailable, version: BigInt(lockedSellerWallet.version) + 1n } });
    await tx.walletHold.update({ where: { id: hold.id }, data: { remainingAmount: buyerHoldRemaining, status: holdStatus } });
    await tx.userTicketInventory.update({ where: { userId_ticketCategoryId: { userId: sellerOrder.userId, ticketCategoryId: buyerOrder.ticketCategoryId } }, data: { totalQuantity: { decrement: execution.quantity }, reservedQuantity: { decrement: execution.quantity } } });
    await tx.userTicketInventory.update({ where: { userId_ticketCategoryId: { userId: buyerOrder.userId, ticketCategoryId: buyerOrder.ticketCategoryId } }, data: { totalQuantity: { increment: execution.quantity }, availableQuantity: { increment: execution.quantity } } });
    const settlement = await tx.tradeSettlement.create({ data: { executionId, buyerOrderId: buyerOrder.id, sellerOrderId: sellerOrder.id, buyerHoldId: hold.id, quantity: execution.quantity, executionPricePaise: execution.price, executionCostPaise: cost, buyerReservedConsumed: consumed, priceImprovementPaise: improvement } });

    await tx.execution.update({
      where: { id: executionId },
      data: {
        settlementStatus: 'SETTLED',
        lastAttemptedAt: new Date(),
        nextRetryAt: null,
        lastErrorCode: null,
      },
    });

    return {
      settlement,
      isIdempotentReplay: false,
      buyerUserId: buyerOrder.userId,
      sellerUserId: sellerOrder.userId,
      buyerWallet: { ...buyerWallet, availableBalance: buyerAvailable, reservedBalance: buyerReserved },
      sellerWallet: { ...sellerWallet, availableBalance: sellerAvailable, reservedBalance: BigInt(lockedSellerWallet.reservedBalance) },
    };
  }

  async _assertExistingSettlement(tx, { existing, execution, buyerOrder, sellerOrder, amounts }) {
    const valid =
      existing.buyerOrderId === buyerOrder.id &&
      existing.sellerOrderId === sellerOrder.id &&
      existing.quantity === execution.quantity &&
      existing.executionPricePaise === execution.price &&
      BigInt(existing.executionCostPaise) === amounts.executionCost &&
      BigInt(existing.buyerReservedConsumed) === amounts.buyerReservedConsumed &&
      BigInt(existing.priceImprovementPaise) === amounts.priceImprovement;
    const hold = valid
      ? await tx.walletHold.findUnique({ where: { id: existing.buyerHoldId } })
      : null;
    if (!valid || !hold || hold.orderId !== buyerOrder.id) {
      throw new SettlementInvariantError('Existing settlement is inconsistent with its execution', {
        executionId: execution.id,
        settlementId: existing.id,
      });
    }
  }
}

export const tradeSettlementService = new TradeSettlementService();
export default tradeSettlementService;
