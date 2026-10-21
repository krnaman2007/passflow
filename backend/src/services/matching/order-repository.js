/**
 * OrderRepository
 *
 * Encapsulates PostgreSQL database reads and writes for Orders and Executions via Prisma.
 * Implements atomic matching transactions with optimistic concurrency checks on resting orders
 * to guarantee that database state and in-memory matching plans never diverge silently.
 */

import { prisma as defaultPrisma } from '../../db/prisma.js';

/**
 * Error thrown when resting order state in the database does not match the expected in-memory state.
 */
export class MarketStateDivergenceError extends Error {
  /**
   * @param {string} message
   * @param {Object} [details]
   */
  constructor(message, details = {}) {
    super(message);
    this.name = 'MarketStateDivergenceError';
    this.code = 'MARKET_STATE_DIVERGENCE';
    this.details = details;
  }
}

export class OrderRepository {
  /**
   * @param {Object} [options]
   * @param {import('@prisma/client').PrismaClient} [options.prismaClient]
   */
  constructor({ prismaClient = defaultPrisma } = {}) {
    this.prisma = prismaClient;
  }

  /**
   * Finds an existing order by composite (userId, idempotencyKey).
   *
   * @param {string} userId
   * @param {string} idempotencyKey
   * @param {Object} [tx] - Optional transaction client.
   * @returns {Promise<Object|null>} The order with its incoming executions, or null.
   */
  async findByIdempotencyKey(userId, idempotencyKey, tx = this.prisma) {
    if (!userId || !idempotencyKey) {
      return null;
    }
    return tx.order.findUnique({
      where: {
        userId_idempotencyKey: {
          userId,
          idempotencyKey,
        },
      },
      include: {
        incomingExecutions: {
          orderBy: { sequenceNumber: 'asc' },
        },
      },
    });
  }

  /**
   * Finds an order by primary key ID.
   *
   * @param {string} orderId
   * @param {Object} [tx]
   * @returns {Promise<Object|null>}
   */
  async findById(orderId, tx = this.prisma) {
    if (!orderId) {
      return null;
    }
    return tx.order.findUnique({
      where: { id: orderId },
      include: {
        incomingExecutions: { orderBy: { sequenceNumber: 'asc' } },
        restingExecutions: { orderBy: { sequenceNumber: 'asc' } },
      },
    });
  }

  /**
   * Finds active resting orders for a specific market, ordered for deterministic book reconstruction.
   *
   * @param {string} eventId
   * @param {string} ticketCategoryId
   * @param {Object} [tx]
   * @returns {Promise<Object[]>}
   */
  async findActiveOrdersByMarket(eventId, ticketCategoryId, tx = this.prisma) {
    return tx.order.findMany({
      where: {
        eventId,
        ticketCategoryId,
        status: { in: ['OPEN', 'PARTIALLY_FILLED'] },
      },
      orderBy: [
        { price: 'asc' },
        { createdAt: 'asc' },
      ],
    });
  }

  /**
   * Executes the matching persistence in an atomic database transaction.
   *
   * Writes:
   * 1. Creates incoming Order record.
   * 2. Updates each matched resting Order with optimistic remaining quantity check.
   * 3. Creates Execution records linking the orders.
   *
   * If any resting order in the database does not have the expected remaining quantity,
   * rolls back the transaction and throws MarketStateDivergenceError.
   *
   * @param {Object} params
   * @param {Object} params.incomingOrderData
   * @param {Array<{ id: string, expectedRemaining: number, newRemaining: number, newStatus: string }>} params.restingUpdates
   * @param {Array<{ id?: string, incomingOrderId?: string, restingOrderId: string, price: number, quantity: number }>} params.executionsData
   * @returns {Promise<{ persistedOrder: Object, persistedExecutions: Object[] }>}
   */
  async persistMatchingTransaction({
    incomingOrderData,
    restingUpdates = [],
    executionsData = [],
  }) {
    return this.prisma.$transaction(async (tx) => {
      // 1. Create incoming order
      const persistedOrder = await tx.order.create({
        data: incomingOrderData,
      });

      // 2. Apply resting order quantity and status updates with optimistic concurrency check
      for (const update of restingUpdates) {
        const updateResult = await tx.order.updateMany({
          where: {
            id: update.id,
            remainingQuantity: update.expectedRemaining,
          },
          data: {
            remainingQuantity: update.newRemaining,
            status: update.newStatus,
          },
        });

        if (updateResult.count === 0) {
          throw new MarketStateDivergenceError(
            `Resting order "${update.id}" state in database diverges from expected remaining quantity (${update.expectedRemaining})`,
            {
              restingOrderId: update.id,
              expectedRemaining: update.expectedRemaining,
            }
          );
        }
      }

      // 3. Create execution records
      const persistedExecutions = [];
      for (const exec of executionsData) {
        const persistedExec = await tx.execution.create({
          data: {
            ...(exec.id ? { id: exec.id } : {}),
            incomingOrderId: persistedOrder.id,
            restingOrderId: exec.restingOrderId,
            price: exec.price,
            quantity: exec.quantity,
          },
        });
        persistedExecutions.push(persistedExec);
      }

      return { persistedOrder, persistedExecutions };
    });
  }
}
