/**
 * OrderService — Authoritative Order Lifecycle and Reservation Engine
 *
 * Coordinates validated order placement, buyer financial escrow holds, seller inventory reservations,
 * cancellation, and idempotent execution across WalletService, UserTicketInventory, and PersistentMatchingService.
 *
 * Core Guarantees:
 * 1. Pre-Matching Reservation:
 *    - BUY orders reserve 100% of maximum required funds (price * quantity paise) via WalletService.reserveFunds
 *      BEFORE entering matching eligibility. Available balance never becomes negative.
 *    - SELL orders acquire pessimistic row-level locks on UserTicketInventory (SELECT FOR UPDATE) and reserve
 *      inventory (availableQuantity -> reservedQuantity) BEFORE entering matching eligibility.
 * 2. Strict Serialization & Race Prevention:
 *    - All matching submissions and cancellations serialize through MarketExecutionQueue for (eventId, ticketCategoryId).
 *    - Matching cannot race with cancellation; a cancelled order is removed from the in-memory book and marked
 *      CANCELLED in PostgreSQL atomically before releasing reservations.
 * 3. Exact Reservation Conservation:
 *    - Total reserved funds = price * initialQuantity paise.
 *    - Upon partial fills, funds/inventory for executed trades remain held/reserved awaiting Step 9.4 settlement.
 *    - Upon cancellation, ONLY reservations belonging to the unfilled quantity (price * remainingQuantity) are released.
 * 4. Compensating Atomicity:
 *    - If matching engine submission or commit fails, a compensating transaction immediately releases the hold or
 *      restores the reserved inventory, preventing leaked or orphaned reservations.
 * 5. Idempotent Deduplication:
 *    - Retrying order placement with the same (userId, idempotencyKey) and identical payload returns the stored outcome.
 *    - Retrying with conflicting parameters throws an IdempotencyConflictError.
 *    - Retrying cancellation is idempotent and will never double-release funds or inventory.
 */

import crypto from 'node:crypto';
import { prisma as defaultPrisma } from '../../db/prisma.js';
import { WalletService, parseMonetaryAmount, MAX_PAISE } from '../wallet/index.js';
import {
  PersistentMatchingService,
  OrderValidationError,
  IdempotencyPayloadMismatchError,
  assertIdempotentPayloadMatches,
} from '../matching/persistent-matching-service.js';
import { OrderRepository } from '../matching/order-repository.js';
import { formatMarketKey } from '../matching/market-execution-queue.js';
import {
  InsufficientFundsError,
  IdempotencyConflictError,
} from '../wallet/wallet-errors.js';

/**
 * Error thrown when a seller does not possess sufficient available inventory to list an order.
 */
export class InsufficientInventoryError extends Error {
  /**
   * @param {string} message
   * @param {Object} [details]
   */
  constructor(message, details = {}) {
    super(message);
    this.name = 'InsufficientInventoryError';
    this.code = 'INSUFFICIENT_INVENTORY';
    this.details = details;
  }
}

export class OrderService {
  /**
   * @param {Object} [options]
   * @param {import('@prisma/client').PrismaClient} [options.prismaClient]
   * @param {WalletService} [options.walletService]
   * @param {PersistentMatchingService} [options.matchingService]
   * @param {OrderRepository} [options.orderRepository]
   */
  constructor({
    prismaClient = defaultPrisma,
    walletService = new WalletService({ prismaClient }),
    matchingService = new PersistentMatchingService({
      repository: new OrderRepository({ prismaClient }),
    }),
    orderRepository = new OrderRepository({ prismaClient }),
  } = {}) {
    this.prisma = prismaClient;
    this.walletService = walletService;
    this.matchingService = matchingService;
    this.orderRepository = orderRepository;
  }

  /**
   * Credits user ticket inventory from a trusted boundary (e.g. primary purchase or initial allocation).
   *
   * @param {Object} params
   * @param {string} params.userId
   * @param {string} params.ticketCategoryId
   * @param {number} params.quantity
   * @param {Object} [tx] - Optional transaction client
   * @returns {Promise<Object>}
   */
  async creditUserTicketInventory({ userId, ticketCategoryId, quantity }, tx = null) {
    if (!userId || typeof userId !== 'string' || !userId.trim()) {
      throw new OrderValidationError('userId must be a non-empty string', 'userId');
    }
    if (!ticketCategoryId || typeof ticketCategoryId !== 'string' || !ticketCategoryId.trim()) {
      throw new OrderValidationError('ticketCategoryId must be a non-empty string', 'ticketCategoryId');
    }
    if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity <= 0 || !Number.isSafeInteger(quantity)) {
      throw new OrderValidationError('quantity must be a positive safe integer', 'quantity');
    }

    const client = tx || this.prisma;
    return client.userTicketInventory.upsert({
      where: {
        userId_ticketCategoryId: {
          userId: userId.trim(),
          ticketCategoryId: ticketCategoryId.trim(),
        },
      },
      update: {
        totalQuantity: { increment: quantity },
        availableQuantity: { increment: quantity },
      },
      create: {
        userId: userId.trim(),
        ticketCategoryId: ticketCategoryId.trim(),
        totalQuantity: quantity,
        availableQuantity: quantity,
        reservedQuantity: 0,
      },
    });
  }

  /**
   * Retrieves a user's ticket inventory balance for a specific ticket category.
   *
   * @param {Object} params
   * @param {string} params.userId
   * @param {string} params.ticketCategoryId
   * @param {Object} [tx]
   * @returns {Promise<Object|null>}
   */
  async getUserTicketInventory({ userId, ticketCategoryId }, tx = null) {
    if (!userId || !ticketCategoryId) {
      throw new OrderValidationError('Both userId and ticketCategoryId must be provided');
    }
    const client = tx || this.prisma;
    return client.userTicketInventory.findUnique({
      where: {
        userId_ticketCategoryId: {
          userId: userId.trim(),
          ticketCategoryId: ticketCategoryId.trim(),
        },
      },
    });
  }

  /**
   * Places a limit order with authoritative buy-fund or sell-inventory reservations.
   *
   * @param {Object} input
   * @param {string} input.userId - Authenticated user ID (trusted boundary)
   * @param {string} input.eventId - Target event ID
   * @param {string} input.ticketCategoryId - Target ticket category ID
   * @param {'BID'|'ASK'} input.side - Order side
   * @param {number} input.price - Limit price in integer minor currency units / ticks (paise)
   * @param {number} input.quantity - Order quantity (positive safe integer)
   * @param {string} input.idempotencyKey - Client deduplication key
   * @returns {Promise<Object>} Formatted order placement outcome
   */
  async placeLimitOrder(input) {
    // 1. Validate business parameters
    const validated = await this._validatePlacementInput(input);
    const { userId, eventId, ticketCategoryId, side, price, quantity, idempotencyKey } = validated;

    // 2. Check for existing order by (userId, idempotencyKey)
    const existingOrder = await this.orderRepository.findByIdempotencyKey(userId, idempotencyKey);
    if (existingOrder) {
      assertIdempotentPayloadMatches(existingOrder, {
        eventId,
        ticketCategoryId,
        side,
        price,
        initialQuantity: quantity,
        idempotencyKey,
      });
      return this.matchingService._formatSubmissionResultFromRecord(existingOrder);
    }

    // Pre-generate order ID
    const orderId = crypto.randomUUID();
    let holdRecord = null;
    let inventoryReserved = false;

    try {
      // 3. Pre-matching Reservation
      if (side === 'BID') {
        // Reserve Buyer Funds: price * quantity paise
        const requiredPaise = BigInt(price) * BigInt(quantity);
        const holdKey = `order-escrow:${idempotencyKey}`;

        const reserveResult = await this.walletService.reserveFunds({
          userId,
          amount: requiredPaise,
          idempotencyKey: holdKey,
          reason: 'ORDER_ESCROW',
          orderId: null,
          referenceType: 'ORDER',
          referenceId: orderId,
          description: `Buy order escrow for ${quantity} tickets @ ${price} paise`,
        });

        holdRecord = reserveResult.hold;
      } else {
        // Reserve Seller Inventory from UserTicketInventory under pessimistic lock
        await this.prisma.$transaction(async (tx) => {
          const rows = await tx.$queryRaw`
            SELECT * FROM "UserTicketInventory"
            WHERE "userId" = ${userId} AND "ticketCategoryId" = ${ticketCategoryId}
            FOR UPDATE
          `;

          if (!rows || rows.length === 0) {
            throw new InsufficientInventoryError(
              `Seller has no ticket inventory for category ${ticketCategoryId}`,
              { userId, ticketCategoryId, requestedQuantity: quantity, availableQuantity: 0 }
            );
          }

          const inventory = rows[0];
          if (inventory.availableQuantity < quantity) {
            throw new InsufficientInventoryError(
              `Insufficient ticket inventory: requested ${quantity}, available ${inventory.availableQuantity}`,
              {
                userId,
                ticketCategoryId,
                requestedQuantity: quantity,
                availableQuantity: inventory.availableQuantity,
              }
            );
          }

          // Decrement available and increment reserved
          await tx.userTicketInventory.update({
            where: {
              userId_ticketCategoryId: {
                userId,
                ticketCategoryId,
              },
            },
            data: {
              availableQuantity: { decrement: quantity },
              reservedQuantity: { increment: quantity },
            },
          });
        });

        inventoryReserved = true;
      }

      // 4. Submit to Persistent Matching Engine under MarketExecutionQueue
      const submissionResult = await this.matchingService.submitLimitOrder({
        id: orderId,
        userId,
        eventId,
        ticketCategoryId,
        side,
        price,
        quantity,
        idempotencyKey,
      });

      // 5. If BUY order, update hold record with persisted order ID if needed
      if (side === 'BID' && holdRecord) {
        await this.prisma.walletHold.updateMany({
          where: {
            idempotencyKey: `order-escrow:${idempotencyKey}`,
          },
          data: {
            orderId: submissionResult.orderId,
          },
        });
      }

      return {
        ...submissionResult,
        holdId: holdRecord ? holdRecord.id : null,
      };
    } catch (err) {
      // 6. Compensating Rollback upon failure
      if (side === 'BID' && holdRecord) {
        try {
          await this.walletService.releaseHold({
            holdId: holdRecord.id,
            idempotencyKey: `comp-release:${holdRecord.id}`,
            description: 'Compensating release for failed order submission',
          });
        } catch (compensationErr) {
          // Log compensation error for audit
          console.error(
            `Failed to execute compensating release for hold ${holdRecord.id}:`,
            compensationErr
          );
        }
      } else if (side === 'ASK' && inventoryReserved) {
        try {
          await this.prisma.userTicketInventory.update({
            where: {
              userId_ticketCategoryId: {
                userId,
                ticketCategoryId,
              },
            },
            data: {
              availableQuantity: { increment: quantity },
              reservedQuantity: { decrement: quantity },
            },
          });
        } catch (compensationErr) {
          console.error(
            `Failed to execute compensating inventory restore for user ${userId}:`,
            compensationErr
          );
        }
      }

      throw err;
    }
  }

  /**
   * Cancels an open or partially filled limit order and releases remaining reservations exactly once.
   *
   * @param {Object} input
   * @param {string} input.userId - Authenticated user ID (trusted boundary)
   * @param {string} input.orderId - Order ID to cancel
   * @param {string} input.idempotencyKey - Required idempotency token for cancellation
   * @returns {Promise<Object>} Cancellation outcome detailing released reservations
   */
  async cancelLimitOrder({ userId, orderId, idempotencyKey }) {
    if (!userId || typeof userId !== 'string' || !userId.trim()) {
      throw new OrderValidationError('userId must be a non-empty string', 'userId');
    }
    if (!orderId || typeof orderId !== 'string' || !orderId.trim()) {
      throw new OrderValidationError('orderId must be a non-empty string', 'orderId');
    }
    if (!idempotencyKey || typeof idempotencyKey !== 'string' || !idempotencyKey.trim()) {
      throw new OrderValidationError('idempotencyKey must be a non-empty string', 'idempotencyKey');
    }

    // 1. Fetch order to verify existence and user ownership
    const order = await this.orderRepository.findById(orderId);
    if (!order) {
      throw new OrderValidationError(`Order not found: ${orderId}`, 'orderId');
    }
    if (order.userId !== userId) {
      throw new OrderValidationError('Unauthorized: order does not belong to user', 'userId');
    }

    // Idempotent replay for already cancelled order
    if (order.status === 'CANCELLED') {
      return {
        orderId: order.id,
        status: 'CANCELLED',
        cancelledQuantity: 0,
        remainingQuantity: 0,
        releasedReservation: 0,
        isDuplicate: true,
      };
    }
    if (order.status === 'FILLED') {
      throw new OrderValidationError('Cannot cancel fully filled order', 'status');
    }
    if (order.status === 'REJECTED') {
      throw new OrderValidationError('Cannot cancel rejected order', 'status');
    }

    // 2. Execute cancellation under MarketExecutionQueue
    const cancelResult = await this.matchingService.cancelLimitOrder({
      eventId: order.eventId,
      ticketCategoryId: order.ticketCategoryId,
      orderId,
      userId,
    });

    const { cancelledQuantity } = cancelResult;

    // 3. Release Unfilled Reservations
    let releasedReservation = 0;

    if (cancelledQuantity > 0) {
      if (order.side === 'BID') {
        // Release remaining unexecuted funds: price * cancelledQuantity paise
        const releaseAmountPaise = BigInt(order.price) * BigInt(cancelledQuantity);

        // Find active hold linked to this order
        const hold = await this.prisma.walletHold.findFirst({
          where: {
            orderId: order.id,
            status: { in: ['ACTIVE', 'PARTIALLY_RELEASED'] },
          },
        });

        if (hold) {
          await this.walletService.releaseHold({
            holdId: hold.id,
            amount: releaseAmountPaise,
            idempotencyKey: `cancel-release:${idempotencyKey}`,
            referenceType: 'ORDER',
            referenceId: order.id,
            description: `Cancellation refund for ${cancelledQuantity} unfilled tickets`,
          });
          releasedReservation = Number(releaseAmountPaise);
        }
      } else {
        // Release remaining unexecuted inventory back to availableQuantity
        await this.prisma.userTicketInventory.update({
          where: {
            userId_ticketCategoryId: {
              userId,
              ticketCategoryId: order.ticketCategoryId,
            },
          },
          data: {
            availableQuantity: { increment: cancelledQuantity },
            reservedQuantity: { decrement: cancelledQuantity },
          },
        });
        releasedReservation = cancelledQuantity;
      }
    }

    return {
      orderId: order.id,
      status: 'CANCELLED',
      cancelledQuantity,
      remainingQuantity: 0,
      releasedReservation,
      isDuplicate: cancelResult.isDuplicate,
    };
  }

  /**
   * Validates order placement parameters and verifies event/category eligibility.
   *
   * @private
   * @param {*} input
   * @returns {Promise<Object>}
   */
  async _validatePlacementInput(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new OrderValidationError('Order placement input must be a non-null object');
    }

    const { userId, eventId, ticketCategoryId, side, price, quantity, idempotencyKey } = input;

    if (!userId || typeof userId !== 'string' || !userId.trim()) {
      throw new OrderValidationError('userId must be a non-empty string', 'userId');
    }
    if (!eventId || typeof eventId !== 'string' || !eventId.trim()) {
      throw new OrderValidationError('eventId must be a non-empty string', 'eventId');
    }
    if (!ticketCategoryId || typeof ticketCategoryId !== 'string' || !ticketCategoryId.trim()) {
      throw new OrderValidationError('ticketCategoryId must be a non-empty string', 'ticketCategoryId');
    }
    if (side !== 'BID' && side !== 'ASK') {
      throw new OrderValidationError('side must be either "BID" or "ASK"', 'side');
    }

    if (typeof price !== 'number' || !Number.isInteger(price) || price <= 0 || !Number.isSafeInteger(price)) {
      throw new OrderValidationError('price must be a positive safe integer ticks/paise', 'price');
    }
    if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity <= 0 || !Number.isSafeInteger(quantity)) {
      throw new OrderValidationError('quantity must be a positive safe integer', 'quantity');
    }
    if (!idempotencyKey || typeof idempotencyKey !== 'string' || !idempotencyKey.trim()) {
      throw new OrderValidationError('idempotencyKey must be a non-empty string', 'idempotencyKey');
    }

    // Arithmetic overflow protection
    const totalValueBigInt = BigInt(price) * BigInt(quantity);
    if (totalValueBigInt > MAX_PAISE || !Number.isSafeInteger(price * quantity)) {
      throw new OrderValidationError(
        `Total order value (${totalValueBigInt.toString()} paise) exceeds supported monetary boundaries`,
        'price'
      );
    }

    // Verify Event eligibility
    const event = await this.prisma.event.findUnique({
      where: { id: eventId.trim() },
    });
    if (!event) {
      throw new OrderValidationError(`Event not found: ${eventId}`, 'eventId');
    }
    if (event.status === 'CANCELLED' || event.status === 'COMPLETED') {
      throw new OrderValidationError(
        `Event is not eligible for secondary trading (status: ${event.status})`,
        'eventId'
      );
    }

    // Verify TicketCategory
    const category = await this.prisma.ticketCategory.findUnique({
      where: { id: ticketCategoryId.trim() },
    });
    if (!category) {
      throw new OrderValidationError(`Ticket category not found: ${ticketCategoryId}`, 'ticketCategoryId');
    }
    if (category.eventId !== event.id) {
      throw new OrderValidationError(
        `Category ${ticketCategoryId} does not belong to event ${eventId}`,
        'ticketCategoryId'
      );
    }
    if (category.status === 'CLOSED') {
      throw new OrderValidationError('Ticket category is closed for trading', 'ticketCategoryId');
    }

    return {
      userId: userId.trim(),
      eventId: eventId.trim(),
      ticketCategoryId: ticketCategoryId.trim(),
      side,
      price,
      quantity,
      idempotencyKey: idempotencyKey.trim(),
    };
  }
}
