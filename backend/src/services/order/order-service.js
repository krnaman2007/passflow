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
 *    - Price improvement (limit price minus execution price) remains locked in the hold until Step 9.4 settlement.
 * 4. Non-Blind Compensation & Ambiguity Protocol:
 *    - Never releases reservations on a matching engine failure without reconciling PostgreSQL first.
 *    - If an order committed (or PostCommitMutationError occurred), reservations remain secured.
 *    - If database outcome cannot be verified, throws AmbiguousOrderOutcomeError without releasing funds or inventory.
 *    - Only definitively rolled-back transactions trigger compensating releases.
 * 5. Idempotent Deduplication & Primary Purchase Integration:
 *    - creditUserTicketInventory enforces caller transaction clients when required and uses UserInventoryCredit
 *      to ensure duplicate purchase processing never credits inventory twice.
 *    - Retrying cancellation on an already cancelled order recovers any previously interrupted hold releases.
 */

import crypto from 'node:crypto';
import { prisma as defaultPrisma } from '../../db/prisma.js';
import { WalletService, parseMonetaryAmount, MAX_PAISE } from '../wallet/index.js';
import {
  PersistentMatchingService,
  OrderValidationError,
  IdempotencyPayloadMismatchError,
  assertIdempotentPayloadMatches,
  PostCommitMutationError,
  AmbiguousCommitError,
  isAmbiguousCommitError,
} from '../matching/persistent-matching-service.js';
import { OrderRepository } from '../matching/order-repository.js';
import { formatMarketKey } from '../matching/market-execution-queue.js';
import { TradeSettlementService } from '../settlement/index.js';
import {
  InsufficientFundsError,
  IdempotencyConflictError,
} from '../wallet/wallet-errors.js';
import defaultHistoryService, { HistoryService } from '../history.service.js';
import defaultRulesService from '../rules.service.js';

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

/**
 * Error thrown when an order submission outcome is ambiguous (e.g. database timeout/disconnect)
 * and the order's committed vs rolled-back status cannot be verified with certainty.
 * Crucially, pre-matching reservations are NOT released so funds and inventory remain protected.
 */
export class AmbiguousOrderOutcomeError extends Error {
  /**
   * @param {string} message
   * @param {Object} [details]
   */
  constructor(message, details = {}) {
    super(message);
    this.name = 'AmbiguousOrderOutcomeError';
    this.code = 'AMBIGUOUS_ORDER_OUTCOME';
    this.details = details;
  }
}

/**
 * Error thrown when an order's required reservation does not match its hold or inventory.
 */
export class OrderHoldMismatchError extends Error {
  /**
   * @param {string} message
   * @param {Object} [details]
   */
  constructor(message, details = {}) {
    super(message);
    this.name = 'OrderHoldMismatchError';
    this.code = 'ORDER_HOLD_MISMATCH';
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
    settlementService = new TradeSettlementService({ prismaClient }),
    marketStreamService = null,
    historyService = null,
    rulesService = defaultRulesService,
  } = {}) {
    this.prisma = prismaClient;
    this.walletService = walletService;
    this.matchingService = matchingService;
    this.orderRepository = orderRepository;
    this.settlementService = settlementService;
    this.marketStreamService = marketStreamService;
    this.historyService = historyService || new HistoryService({ prismaClient });
    this.rulesService = rulesService;
  }

  /**
   * Sets or replaces the real-time MarketStreamService instance.
   * @param {Object} service
   */
  setMarketStreamService(service) {
    this.marketStreamService = service;
  }

  /**
   * Credits user ticket inventory from a trusted boundary (e.g. primary purchase or initial allocation).
   *
   * Invariants:
   * 1. Uses caller's interactive transaction client (tx) when provided.
   * 2. When requireTransaction is true, throws an error if tx is null, preventing uncoordinated commits.
   * 3. Idempotently tracks purchase credits via UserInventoryCredit; duplicate calls return without double-incrementing.
   * 4. Failed/rolled-back caller transactions automatically roll back both inventory and credit records.
   *
   * @param {Object} params
   * @param {string} params.userId
   * @param {string} params.ticketCategoryId
   * @param {number} params.quantity
   * @param {string} [params.idempotencyKey] - Optional deduplication key (e.g. `primary-purchase:${purchaseId}`)
   * @param {string} [params.purchaseId] - Optional primary purchase identifier for audit
   * @param {boolean} [params.requireTransaction=false] - Enforce caller transaction presence
   * @param {Object} [tx] - Optional transaction client
   * @returns {Promise<Object>}
   */
  async creditUserTicketInventory(params, tx = null) {
    const {
      userId,
      ticketCategoryId,
      quantity,
      idempotencyKey = null,
      purchaseId = null,
      requireTransaction = false,
      skipTicketCreation = false,
    } = params;

    // 1. Validate inputs
    if (!userId || typeof userId !== 'string' || !userId.trim()) {
      throw new OrderValidationError('userId must be a non-empty string', 'userId');
    }
    if (!ticketCategoryId || typeof ticketCategoryId !== 'string' || !ticketCategoryId.trim()) {
      throw new OrderValidationError('ticketCategoryId must be a non-empty string', 'ticketCategoryId');
    }
    if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity <= 0 || !Number.isSafeInteger(quantity)) {
      throw new OrderValidationError('quantity must be a positive safe integer', 'quantity');
    }
    if (requireTransaction && !tx) {
      throw new OrderValidationError(
        'Transaction client (tx) is required when atomic primary-purchase integration is specified',
        'tx'
      );
    }

    const client = tx || this.prisma;
    const cleanUserId = userId.trim();
    const cleanCategoryId = ticketCategoryId.trim();

    // 2. Idempotency handling
    if (idempotencyKey && typeof idempotencyKey === 'string' && idempotencyKey.trim()) {
      const cleanKey = idempotencyKey.trim();

      // Check for existing credit record
      const existingCredit = await client.userInventoryCredit.findUnique({
        where: { idempotencyKey: cleanKey },
      });

      if (existingCredit) {
        if (
          existingCredit.userId !== cleanUserId ||
          existingCredit.ticketCategoryId !== cleanCategoryId ||
          existingCredit.quantity !== quantity
        ) {
          throw new IdempotencyConflictError(
            `Idempotency key "${cleanKey}" was already used with different parameters: expected userId=${existingCredit.userId}, category=${existingCredit.ticketCategoryId}, qty=${existingCredit.quantity}; got userId=${cleanUserId}, category=${cleanCategoryId}, qty=${quantity}`,
            { idempotencyKey: cleanKey }
          );
        }

        // Return current inventory state with isDuplicate: true without double-incrementing
        const currentInventory = await client.userTicketInventory.findUnique({
          where: {
            userId_ticketCategoryId: {
              userId: cleanUserId,
              ticketCategoryId: cleanCategoryId,
            },
          },
        });

        return {
          ...currentInventory,
          creditId: existingCredit.id,
          isDuplicate: true,
        };
      }

      // Record credit inside the same transaction
      try {
        await client.userInventoryCredit.create({
          data: {
            userId: cleanUserId,
            ticketCategoryId: cleanCategoryId,
            quantity,
            idempotencyKey: cleanKey,
            purchaseId: purchaseId ? String(purchaseId).trim() : null,
          },
        });
      } catch (err) {
        if (err.code === 'P2002') {
          // Race condition on duplicate key: re-check
          const rechecked = await client.userInventoryCredit.findUnique({
            where: { idempotencyKey: cleanKey },
          });
          if (rechecked) {
            if (
              rechecked.userId !== cleanUserId ||
              rechecked.ticketCategoryId !== cleanCategoryId ||
              rechecked.quantity !== quantity
            ) {
              throw new IdempotencyConflictError(
                `Idempotency key "${cleanKey}" collision with conflicting parameters`,
                { idempotencyKey: cleanKey }
              );
            }
            const currentInventory = await client.userTicketInventory.findUnique({
              where: {
                userId_ticketCategoryId: {
                  userId: cleanUserId,
                  ticketCategoryId: cleanCategoryId,
                },
              },
            });
            return {
              ...currentInventory,
              creditId: rechecked.id,
              isDuplicate: true,
            };
          }
        }
        throw err;
      }
    }

    // 3. Create individual tickets if not explicitly skipped (e.g. from primary purchase)
    if (!skipTicketCreation) {
      const category = await client.ticketCategory.findUnique({
        where: { id: cleanCategoryId },
      });
      if (category) {
        const now = new Date();
        for (let i = 0; i < quantity; i++) {
          const ticket = await client.ticket.create({
            data: {
              eventId: category.eventId,
              categoryId: cleanCategoryId,
              ownerId: cleanUserId,
              faceValue: category.originalPrice,
              currentPrice: category.originalPrice,
              status: 'OWNED',
              createdAt: now,
            },
          });
          await client.ticketOwnership.create({
            data: {
              ticketId: ticket.id,
              ownerId: cleanUserId,
              acquiredAt: now,
              source: 'PRIMARY',
            },
          });
        }
      }
    }

    // 4. Upsert user ticket inventory
    const updatedInventory = await client.userTicketInventory.upsert({
      where: {
        userId_ticketCategoryId: {
          userId: cleanUserId,
          ticketCategoryId: cleanCategoryId,
        },
      },
      update: {
        totalQuantity: { increment: quantity },
        availableQuantity: { increment: quantity },
      },
      create: {
        userId: cleanUserId,
        ticketCategoryId: cleanCategoryId,
        totalQuantity: quantity,
        availableQuantity: quantity,
        reservedQuantity: 0,
      },
    });

    return {
      ...updatedInventory,
      isDuplicate: false,
    };
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
    const { userId, eventId, ticketCategoryId, side, price, quantity, idempotencyKey, orderType } = validated;

    // These checks are deliberately before any hold, ticket reservation, or
    // matching mutation.  A rejected order must leave no financial residue.
    await this.rulesService.validatePrice({ eventId, categoryId: ticketCategoryId, side, price });
    await this.rulesService.check(userId, 'ORDER_RATE_LIMIT');

    // 2. Check for existing order by (userId, idempotencyKey)
    const existingOrder = await this.orderRepository.findByIdempotencyKey(userId, idempotencyKey);
    if (existingOrder) {
      assertIdempotentPayloadMatches(existingOrder, {
        eventId,
        ticketCategoryId,
        side,
        orderType,
        price,
        initialQuantity: quantity,
        idempotencyKey,
      });

      // Ensure hold is linked to existing order if it was unlinked during a previous crash
      if (side === 'BID') {
        try {
          await this.prisma.walletHold.updateMany({
            where: {
              OR: [
                { idempotencyKey: `order-escrow:${idempotencyKey}` },
                { operation: { referenceId: existingOrder.id } },
              ],
              orderId: null,
            },
            data: {
              orderId: existingOrder.id,
            },
          });
        } catch (linkErr) {
          console.error('Failed to link hold during idempotent replay:', linkErr);
        }
      }

      const replay = this.matchingService._formatSubmissionResultFromRecord(existingOrder);
      await this._settleExecutions(replay.executions);
      return replay;
    }

    // Pre-generate order ID
    const orderId = crypto.randomUUID();
    let holdRecord = null;
    let inventoryReserved = false;

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
      // Reserve Seller Inventory and individual Tickets under pessimistic lock
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

        // Select and lock eligible individual tickets owned by seller
        const eligibleTickets = await tx.$queryRaw`
          SELECT id FROM "Ticket"
          WHERE "ownerId" = ${userId}
            AND "categoryId" = ${ticketCategoryId}
            AND "eventId" = ${eventId}
            AND "status" = 'OWNED'
            AND "orderId" IS NULL
          ORDER BY "createdAt" ASC, "id" ASC
          LIMIT ${quantity}
          FOR UPDATE
        `;

        if (!eligibleTickets || eligibleTickets.length < quantity) {
          throw new InsufficientInventoryError(
            `Insufficient owned tickets available for resale: requested ${quantity}, found ${eligibleTickets?.length || 0}`,
            {
              userId,
              ticketCategoryId,
              requestedQuantity: quantity,
              availableQuantity: eligibleTickets?.length || 0,
            }
          );
        }

        // Associate tickets with this order and mark as LISTED
        const ticketIds = eligibleTickets.map((t) => t.id);
        await tx.ticket.updateMany({
          where: { id: { in: ticketIds } },
          data: {
            status: 'LISTED',
            orderId,
          },
        });

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
    let submissionResult;
    try {
      submissionResult = await this.matchingService.submitLimitOrder({
        id: orderId,
        userId,
        eventId,
        ticketCategoryId,
        side,
        orderType,
        price,
        quantity,
        idempotencyKey,
      });
    } catch (err) {
      // 5. Handle matching engine outcome — NEVER blindly compensate!

      // Case A: Post-Commit Mutation Error
      // The transaction DEFINITELY committed to PostgreSQL, but in-memory book mutation failed.
      if (err instanceof PostCommitMutationError || err.name === 'PostCommitMutationError') {
        if (side === 'BID' && holdRecord) {
          try {
            await this.prisma.walletHold.updateMany({
              where: {
                idempotencyKey: `order-escrow:${idempotencyKey}`,
              },
              data: {
                orderId: err.orderId || orderId,
              },
            });
          } catch (linkErr) {
            console.error('Failed to link hold after post-commit error:', linkErr);
          }
        }
        // Do NOT release reservations! Rethrow post-commit error for market reconciliation.
        throw err;
      }

      // Case B: Check PostgreSQL to verify whether the order committed or rolled back
      let persistedOrder = null;
      try {
        persistedOrder =
          (await this.orderRepository.findById(orderId)) ||
          (await this.orderRepository.findByIdempotencyKey(userId, idempotencyKey));
      } catch (lookupErr) {
        // Cannot reach PostgreSQL to verify state! Outcome is completely ambiguous.
        // DO NOT release reservation!
        throw new AmbiguousOrderOutcomeError(
          `Ambiguous outcome for order "${orderId}": submission failed (${err.message}) and database verification failed (${lookupErr.message}). Reservation remains secured.`,
          {
            orderId,
            idempotencyKey,
            holdId: holdRecord?.id,
            originalError: err,
            lookupError: lookupErr,
          }
        );
      }

      if (persistedOrder) {
        // The order committed to PostgreSQL despite the error!
        // DO NOT release reservations!
        if (side === 'BID' && holdRecord) {
          try {
            await this.prisma.walletHold.updateMany({
              where: {
                idempotencyKey: `order-escrow:${idempotencyKey}`,
              },
              data: {
                orderId: persistedOrder.id,
              },
            });
          } catch (linkErr) {
            console.error('Failed to link hold to committed order:', linkErr);
          }
        }

        // Return the stored outcome if payload matches
        assertIdempotentPayloadMatches(persistedOrder, {
          eventId,
          ticketCategoryId,
          side,
          price,
          initialQuantity: quantity,
          idempotencyKey,
        });

        return {
          ...this.matchingService._formatSubmissionResultFromRecord(persistedOrder),
          holdId: holdRecord ? holdRecord.id : null,
          isAmbiguousCommitResolved: true,
        };
      }

      // Case C: Definitive Rollback / No Record in PostgreSQL
      // Verified that no order exists in PostgreSQL with orderId or (userId, idempotencyKey).
      // NOW it is safe to release the pre-matching reservation!
      if (side === 'BID' && holdRecord) {
        try {
          await this.walletService.releaseHold({
            holdId: holdRecord.id,
            idempotencyKey: `comp-release:${holdRecord.id}`,
            description: 'Compensating release for definitively rolled-back order submission',
          });
        } catch (compensationErr) {
          console.error(
            `Failed to execute compensating release for hold ${holdRecord.id}:`,
            compensationErr
          );
        }
      } else if (side === 'ASK' && inventoryReserved) {
        try {
          await this.prisma.$transaction(async (tx) => {
            await tx.ticket.updateMany({
              where: {
                orderId,
                status: 'LISTED',
              },
              data: {
                status: 'OWNED',
                orderId: null,
              },
            });
            await tx.userTicketInventory.update({
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

    // 6. If BUY order, update hold record with persisted order ID if needed
    if (side === 'BID' && holdRecord) {
      try {
        await this.prisma.walletHold.updateMany({
          where: {
            idempotencyKey: `order-escrow:${idempotencyKey}`,
          },
          data: {
            orderId: submissionResult.orderId,
          },
        });
      } catch (linkErr) {
        console.error(
          `Warning: Order ${submissionResult.orderId} committed but hold linkage failed:`,
          linkErr
        );
      }
    }

    await this._settleExecutions(submissionResult.executions);

    // Step 9.16: Real-time WebSocket streaming (post-commit broadcast)
    if (
      this.marketStreamService &&
      !submissionResult.isDuplicate &&
      !submissionResult.isAmbiguousCommitResolved
    ) {
      await this._publishPlacementEvents(submissionResult, { eventId, ticketCategoryId });
    }

    return {
      ...submissionResult,
      holdId: holdRecord ? holdRecord.id : null,
    };
  }

  /**
   * A market order receives a bounded, immediately executable limit derived
   * from the authoritative opposing book, then any unfilled remainder is
   * cancelled before it can rest. Prices remain integer paise internally.
   */
  async placeMarketOrder(input) {
    const side = input.side;
    const oppositeSide = side === 'BID' ? 'ASK' : 'BID';
    const opposite = await this.prisma.order.findMany({
      where: {
        eventId: input.eventId,
        ticketCategoryId: input.ticketCategoryId,
        side: oppositeSide,
        status: { in: ['OPEN', 'PARTIALLY_FILLED'] },
        remainingQuantity: { gt: 0 },
      },
      orderBy: side === 'BID' ? [{ price: 'asc' }, { sequenceNumber: 'asc' }] : [{ price: 'desc' }, { sequenceNumber: 'asc' }],
      select: { price: true },
      take: Math.max(1, input.quantity),
    });
    if (opposite.length === 0) {
      throw new OrderValidationError('No executable liquidity is available for this market order', 'type');
    }
    const price = side === 'BID'
      ? Math.max(...opposite.map((order) => order.price))
      : Math.min(...opposite.map((order) => order.price));
    const result = await this.placeLimitOrder({ ...input, price, orderType: 'MARKET' });
    if (result.remainingQuantity > 0) {
      await this.cancelLimitOrder({
        userId: input.userId,
        orderId: result.orderId,
        idempotencyKey: `market-remainder:${input.idempotencyKey}`,
      });
      result.remainingQuantity = 0;
      result.marketRemainderCancelled = true;
    }
    return result;
  }

  /**
   * Cancels an open or partially filled limit order and releases remaining reservations exactly once.
   *
   * Invariants:
   * 1. Cancellation and matching are strictly serialized via MarketExecutionQueue.
   * 2. Only the unfilled portion (price * cancelledQuantity) is released.
   * 3. Executed quantities and their corresponding reserved funds/inventory remain locked awaiting Step 9.4 settlement.
   * 4. Retrying on an already CANCELLED order checks for any previously interrupted hold releases and completes them.
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

    if (order.status === 'FILLED') {
      throw new OrderValidationError('Cannot cancel fully filled order', 'status');
    }
    if (order.status === 'REJECTED') {
      throw new OrderValidationError('Cannot cancel rejected order', 'status');
    }

    // 2. Check if already cancelled — verify hold release completeness
    if (order.status === 'CANCELLED') {
      let releasedReservation = 0;
      if (order.side === 'BID') {
        const orFilters = [{ orderId: order.id }, { operation: { referenceId: order.id } }];
        if (order.idempotencyKey) {
          orFilters.push({ idempotencyKey: `order-escrow:${order.idempotencyKey}` });
        }
        const hold = await this.prisma.walletHold.findFirst({
          where: {
            OR: orFilters,
            status: { in: ['ACTIVE', 'PARTIALLY_RELEASED', 'PARTIALLY_SETTLED'] },
          },
        });

        if (hold) {
          // Calculate executed quantity from executions
          const executions = await this.prisma.execution.findMany({
            where: {
              OR: [{ incomingOrderId: order.id }, { restingOrderId: order.id }],
            },
          });
          const executedQuantity = executions.reduce((sum, e) => sum + e.quantity, 0);
          const requiredHoldPaise = BigInt(executedQuantity) * BigInt(order.price);

          if (BigInt(hold.remainingAmount) > requiredHoldPaise) {
            const unreleasedPaise = BigInt(hold.remainingAmount) - requiredHoldPaise;
            await this.walletService.releaseHold({
              holdId: hold.id,
              amount: unreleasedPaise,
              idempotencyKey: `cancel-release:${idempotencyKey}`,
              referenceType: 'ORDER',
              referenceId: order.id,
              description: `Recovery release for unreleased funds on cancelled order ${order.id}`,
            });
            releasedReservation = Number(unreleasedPaise);
          }
        }
      }

      return {
        orderId: order.id,
        status: 'CANCELLED',
        cancelledQuantity: 0,
        remainingQuantity: 0,
        releasedReservation,
        isDuplicate: true,
      };
    }

    // 3. Execute cancellation under MarketExecutionQueue
    const cancelResult = await this.matchingService.cancelLimitOrder({
      eventId: order.eventId,
      ticketCategoryId: order.ticketCategoryId,
      orderId,
      userId,
    });

    const { cancelledQuantity } = cancelResult;

    // 4. Release Unfilled Reservations
    let releasedReservation = 0;

    if (cancelledQuantity > 0) {
      if (order.side === 'BID') {
        // Release remaining unexecuted funds: price * cancelledQuantity paise
        const releaseAmountPaise = BigInt(order.price) * BigInt(cancelledQuantity);

        const orFilters = [{ orderId: order.id }, { operation: { referenceId: order.id } }];
        if (order.idempotencyKey) {
          orFilters.push({ idempotencyKey: `order-escrow:${order.idempotencyKey}` });
        }
        const hold = await this.prisma.walletHold.findFirst({
          where: {
            OR: orFilters,
            status: { in: ['ACTIVE', 'PARTIALLY_RELEASED', 'PARTIALLY_SETTLED'] },
          },
        });

        if (hold) {
          if (hold.orderId === null) {
            await this.prisma.walletHold.update({
              where: { id: hold.id },
              data: { orderId: order.id },
            });
          }

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
        // Release remaining unexecuted inventory and tickets
        await this.prisma.$transaction(async (tx) => {
          const reservedTickets = await tx.$queryRaw`
            SELECT id FROM "Ticket"
            WHERE "orderId" = ${order.id}
              AND "ownerId" = ${userId}
              AND "status" = 'LISTED'
            ORDER BY "createdAt" ASC, "id" ASC
            LIMIT ${cancelledQuantity}
            FOR UPDATE
          `;

          if (reservedTickets.length > 0) {
            const ticketIds = reservedTickets.map((t) => t.id);
            await tx.ticket.updateMany({
              where: { id: { in: ticketIds } },
              data: {
                status: 'OWNED',
                orderId: null,
              },
            });
          }

          await tx.userTicketInventory.update({
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
        });
        releasedReservation = cancelledQuantity;
      }
    }

    // Step 9.16: Real-time WebSocket streaming (post-commit cancellation broadcast)
    if (this.marketStreamService && !cancelResult.isDuplicate && cancelledQuantity > 0) {
      try {
        this.marketStreamService.publishOrderFill({
          userId: order.userId,
          fill: {
            orderId: order.id,
            eventId: order.eventId,
            ticketCategoryId: order.ticketCategoryId,
            side: order.side,
            status: 'CANCELLED',
            fillPrice: null,
            fillQuantity: 0,
            remainingQuantity: 0,
            sequenceNumber: '0',
            tradeId: null,
            timestamp: new Date().toISOString(),
          },
        });

        await this._publishOrderBookUpdate(order.eventId, order.ticketCategoryId, 'ORDER_CANCEL');
      } catch (broadcastErr) {
        console.error('Failed to broadcast market stream events after order cancellation:', broadcastErr);
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
   * Reconciles order reservations against wallet holds and ticket inventory.
   *
   * Audits:
   * 1. Unlinked holds: Active holds where referenceId matches an order, but orderId is null. Links them.
   * 2. Orphaned holds: Active holds whose referenceId/orderId does not exist in the Order table.
   *    If dryRun is false, releases the orphaned hold.
   * 3. Underfunded buy orders: Active buy orders whose hold remainingAmount is less than required.
   * 4. Orphaned sell inventory: UserTicketInventory reservedQuantity exceeding active resting + unsettled executions.
   *    This is reported only; an unlocked snapshot must not release inventory that a concurrent execution needs.
   *
   * @param {Object} [options]
   * @param {Object} [options]
   * @param {string} [options.eventId]
   * @param {string} [options.ticketCategoryId]
   * @param {boolean} [options.dryRun=false]
   * @param {boolean} [options.forceReleaseOrphaned=false]
   * @returns {Promise<Object>} Reconciliation summary
   */
  async reconcileOrderReservations(options = {}) {
    const { eventId, ticketCategoryId, dryRun = false, forceReleaseOrphaned = false } = options;
    const summary = {
      unlinkedHoldsFixed: 0,
      orphanedHoldsDetected: 0,
      orphanedHoldsReleased: 0,
      underfundedOrders: [],
      orphanedInventoryDetected: 0,
      orphanedInventoryRestored: 0,
      orphanedTicketReservationsDetected: 0,
      orphanedTicketReservationsRestored: 0,
      isConsistent: true,
    };

    // 1. Audit active BUY holds
    const activeHolds = await this.prisma.walletHold.findMany({
      where: {
        reason: 'ORDER_ESCROW',
        status: { in: ['ACTIVE', 'PARTIALLY_RELEASED', 'PARTIALLY_SETTLED'] },
      },
      include: {
        operation: true,
      },
    });

    for (const hold of activeHolds) {
      const targetOrderId = hold.orderId || hold.operation?.referenceId;
      if (!targetOrderId) continue;

      let order = null;
      try {
        order = await this.orderRepository.findById(targetOrderId);
      } catch (lookupErr) {
        console.error(`Hold order lookup failed during reconciliation for order ${targetOrderId}:`, lookupErr.message);
        summary.isConsistent = false;
        continue;
      }

      if (order) {
        // Link hold if unlinked
        if (hold.orderId === null) {
          if (!dryRun) {
            await this.prisma.walletHold.update({
              where: { id: hold.id },
              data: { orderId: order.id },
            });
          }
          summary.unlinkedHoldsFixed++;
        }

        // Check hold sufficiency for active orders
        if (order.status === 'OPEN' || order.status === 'PARTIALLY_FILLED') {
          const requiredPaise = BigInt(order.remainingQuantity) * BigInt(order.price);
          if (BigInt(hold.remainingAmount) < requiredPaise) {
            summary.underfundedOrders.push({
              orderId: order.id,
              requiredPaise: requiredPaise.toString(),
              actualPaise: hold.remainingAmount.toString(),
            });
            summary.isConsistent = false;
          }
        }
      } else {
        // An absent order may be an ambiguous pre-matching commit outcome.  It is
        // never safe for reconciliation to infer rollback and release its money.
        summary.orphanedHoldsDetected++;
        summary.isConsistent = false;

        // Leave recovery/compensation to a path that can prove the original
        // matching transaction rolled back.  This report remains actionable.
      }
    }

    // 2. Audit SELL inventory
    const userInventories = await this.prisma.userTicketInventory.findMany({
      where: ticketCategoryId ? { ticketCategoryId } : {},
    });

    for (const inv of userInventories) {
      // Find active ASK orders for this user and category
      const activeAsks = await this.prisma.order.findMany({
        where: {
          userId: inv.userId,
          ticketCategoryId: inv.ticketCategoryId,
          side: 'ASK',
          status: { in: ['OPEN', 'PARTIALLY_FILLED'] },
        },
      });

      const activeReserved = activeAsks.reduce((sum, o) => sum + o.remainingQuantity, 0);

      // Find unsettled executions for this seller
      const sellerExecutions = await this.prisma.execution.findMany({
        where: {
          settlement: null,
          OR: [
            { incomingOrder: { userId: inv.userId, ticketCategoryId: inv.ticketCategoryId, side: 'ASK' } },
            { restingOrder: { userId: inv.userId, ticketCategoryId: inv.ticketCategoryId, side: 'ASK' } },
          ],
        },
      });

      const unsettledExecQty = sellerExecutions.reduce((sum, e) => sum + e.quantity, 0);
      const expectedReserved = activeReserved + unsettledExecQty;

      if (inv.reservedQuantity > expectedReserved) {
        const excess = inv.reservedQuantity - expectedReserved;
        summary.orphanedInventoryDetected += excess;
        summary.isConsistent = false;

        // A snapshot reconciliation cannot prove an execution will not settle
        // immediately afterwards.  Auto-releasing this inventory would race
        // settlement and could make a durable execution impossible to settle.
        // Keep reconciliation observational until an operator performs a
        // separately serialized repair with execution history in scope.
      }
    }

    // 3. Audit individual Ticket reservations for missing or stale orders (Crash-Window Audit)
    const ticketWhere = {
      status: 'LISTED',
      orderId: { not: null },
    };
    if (ticketCategoryId) {
      ticketWhere.categoryId = ticketCategoryId;
    }
    if (eventId) {
      ticketWhere.eventId = eventId;
    }

    const listedTickets = await this.prisma.ticket.findMany({
      where: ticketWhere,
      select: {
        id: true,
        orderId: true,
        ownerId: true,
        categoryId: true,
        eventId: true,
        createdAt: true,
      },
    });

    // Group listed tickets by orderId
    const ticketsByOrderId = new Map();
    for (const t of listedTickets) {
      if (!ticketsByOrderId.has(t.orderId)) {
        ticketsByOrderId.set(t.orderId, []);
      }
      ticketsByOrderId.get(t.orderId).push(t);
    }

    const STALE_THRESHOLD_MS = 60_000; // 60 seconds
    const now = Date.now();

    for (const [targetOrderId, groupTickets] of ticketsByOrderId.entries()) {
      let order = null;
      try {
        order = await this.orderRepository.findById(targetOrderId);
      } catch (lookupErr) {
        // Never release a reservation solely because an order lookup temporarily fails!
        console.error(`Order lookup failed during reservation audit for order ${targetOrderId}:`, lookupErr.message);
        summary.isConsistent = false;
        continue;
      }

      if (!order) {
        // The order definitively does NOT exist in the Order table.
        const oldestCreatedAt = Math.min(...groupTickets.map((t) => new Date(t.createdAt).getTime()));
        const isStale = (now - oldestCreatedAt) > STALE_THRESHOLD_MS;

        if (forceReleaseOrphaned || isStale) {
          summary.orphanedTicketReservationsDetected += groupTickets.length;
          summary.isConsistent = false;

          if (!dryRun) {
            try {
              await this.prisma.$transaction(async (tx) => {
                const doubleCheck = await tx.order.findUnique({
                  where: { id: targetOrderId },
                });
                if (doubleCheck) return;

                const ticketIds = groupTickets.map((t) => t.id);
                const ownerId = groupTickets[0].ownerId;
                const catId = groupTickets[0].categoryId;

                // Revert tickets to OWNED and unlink orderId
                await tx.ticket.updateMany({
                  where: {
                    id: { in: ticketIds },
                    status: 'LISTED',
                    orderId: targetOrderId,
                  },
                  data: {
                    status: 'OWNED',
                    orderId: null,
                  },
                });

                // Restore aggregate inventory
                await tx.userTicketInventory.update({
                  where: {
                    userId_ticketCategoryId: {
                      userId: ownerId,
                      ticketCategoryId: catId,
                    },
                  },
                  data: {
                    availableQuantity: { increment: groupTickets.length },
                    reservedQuantity: { decrement: groupTickets.length },
                  },
                });
              });
              summary.orphanedTicketReservationsRestored += groupTickets.length;
            } catch (repairErr) {
              console.error(`Failed to repair orphaned ticket reservation for order ${targetOrderId}:`, repairErr);
            }
          }
        } else {
          // Absent order detected, but reservation was created recently (within safety window)
          summary.orphanedTicketReservationsDetected += groupTickets.length;
          summary.isConsistent = false;
        }
      }
    }

    return summary;
  }

  /**
   * Dispatches only already-persisted executions after matching has committed.
   * A dispatch failure is intentionally surfaced: the execution remains durable
   * and is retried by an idempotent request or bounded startup recovery; no
   * financial compensation is attempted here.
   *
   * @private
   */
  async _settleExecutions(executions) {
    if (!Array.isArray(executions)) return;
    for (const execution of executions) {
      if (!execution?.id) {
        throw new OrderValidationError('Persisted execution is missing an id');
      }
      await this.settlementService.settleExecution({ executionId: execution.id });
    }
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

    const { userId, eventId, ticketCategoryId, side, price, quantity, idempotencyKey, orderType = 'LIMIT' } = input;

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
    if (orderType !== 'LIMIT' && orderType !== 'MARKET') {
      throw new OrderValidationError('orderType must be LIMIT or MARKET', 'orderType');
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
      orderType,
    };
  }

  /**
   * Evaluates the operational readiness of the order service and underlying matching coordinator.
   * @returns {{ ready: boolean, reason?: string }}
   */
  checkReadiness() {
    if (!this.matchingService || typeof this.matchingService.checkReadiness !== 'function') {
      return { ready: false, reason: 'Matching service uninitialized' };
    }
    return this.matchingService.checkReadiness();
  }

  /**
   * Broadcasts public trades, private fills, and updated order book after an order commits.
   *
   * Invariants:
   * 1. Executed ONLY after database transactions successfully commit.
   * 2. Counterparty user IDs are resolved from authoritative database records.
   * 3. Broadcast failures are caught and logged; they never roll back committed transactions.
   *
   * @private
   * @param {Object} submissionResult
   * @param {Object} marketInfo
   * @param {string} marketInfo.eventId
   * @param {string} marketInfo.ticketCategoryId
   */
  async _publishPlacementEvents(submissionResult, { eventId, ticketCategoryId }) {
    if (!this.marketStreamService) return;

    try {
      const executions = submissionResult.executions || [];

      if (executions.length > 0) {
        // Query resting orders to resolve counterparty user IDs
        const restingOrderIds = executions.map((e) => e.restingOrderId);
        const restingOrders = await this.prisma.order.findMany({
          where: { id: { in: restingOrderIds } },
          select: { id: true, userId: true, side: true, status: true, remainingQuantity: true },
        });
        const restingOrderMap = new Map(restingOrders.map((o) => [o.id, o]));

        for (const exec of executions) {
          // Public trade execution broadcast (zero private data)
          this.marketStreamService.publishMarketTrade({
            eventId,
            ticketCategoryId,
            tradeId: exec.id,
            price: exec.price,
            quantity: exec.quantity,
            sequenceNumber: exec.sequenceNumber,
            executedAt: exec.executedAt,
          });

          // Private fill notification to incoming order owner
          this.marketStreamService.publishOrderFill({
            userId: submissionResult.userId,
            fill: {
              orderId: submissionResult.orderId,
              eventId,
              ticketCategoryId,
              side: submissionResult.side,
              status: submissionResult.status,
              fillPrice: exec.price,
              fillQuantity: exec.quantity,
              remainingQuantity: submissionResult.remainingQuantity,
              sequenceNumber: exec.sequenceNumber,
              tradeId: exec.id,
              timestamp: exec.executedAt ? new Date(exec.executedAt).toISOString() : new Date().toISOString(),
            },
          });

          // Private fill notification to counterparty resting order owner
          const resting = restingOrderMap.get(exec.restingOrderId);
          if (resting && resting.userId) {
            this.marketStreamService.publishOrderFill({
              userId: resting.userId,
              fill: {
                orderId: resting.id,
                eventId,
                ticketCategoryId,
                side: resting.side,
                status: resting.remainingQuantity === 0 ? 'FILLED' : 'PARTIALLY_FILLED',
                fillPrice: exec.price,
                fillQuantity: exec.quantity,
                remainingQuantity: resting.remainingQuantity,
                sequenceNumber: exec.sequenceNumber,
                tradeId: exec.id,
                timestamp: exec.executedAt ? new Date(exec.executedAt).toISOString() : new Date().toISOString(),
              },
            });
          }
        }
      }

      // Broadcast updated orderbook depth to public room
      await this._publishOrderBookUpdate(
        eventId,
        ticketCategoryId,
        executions.length > 0 ? 'TRADE_MATCH' : 'LEVEL_UPDATE',
        executions.length > 0 ? executions[executions.length - 1].sequenceNumber : null
      );
    } catch (broadcastErr) {
      console.error('Failed to broadcast market stream events after order placement:', broadcastErr);
    }
  }

  /**
   * Broadcasts the current authoritative order book depth to the public market room.
   *
   * @private
   * @param {string} eventId
   * @param {string} ticketCategoryId
   * @param {string} [action='LEVEL_UPDATE']
   * @param {string|number|BigInt} [sequenceNumber=null]
   */
  async _publishOrderBookUpdate(eventId, ticketCategoryId, action = 'LEVEL_UPDATE', sequenceNumber = null) {
    if (!this.marketStreamService) return;

    try {
      const snapshot = await this.marketStreamService.getAuthoritativeSnapshot(eventId, ticketCategoryId);
      this.marketStreamService.publishOrderBookUpdate({
        eventId,
        ticketCategoryId,
        sequenceNumber: sequenceNumber != null ? sequenceNumber.toString() : snapshot.sequenceNumber,
        action,
        bids: snapshot.bids,
        asks: snapshot.asks,
      });
    } catch (err) {
      console.error('Failed to publish orderbook update:', err);
    }
  }

  /**
   * Reconciles individual Ticket records against aggregate UserTicketInventory for an account and category.
   *
   * @param {Object} params
   * @param {string} params.userId
   * @param {string} params.ticketCategoryId
   * @param {boolean} [params.repair=false]
   * @returns {Promise<Object>}
   */
  async reconcileTicketOwnershipAndInventory({ userId, ticketCategoryId, repair = false }) {
    if (!userId || !ticketCategoryId) {
      throw new OrderValidationError('Both userId and ticketCategoryId must be provided');
    }
    const cleanUserId = userId.trim();
    const cleanCategoryId = ticketCategoryId.trim();

    const [tickets, inventory] = await Promise.all([
      this.prisma.ticket.findMany({
        where: {
          ownerId: cleanUserId,
          categoryId: cleanCategoryId,
        },
      }),
      this.prisma.userTicketInventory.findUnique({
        where: {
          userId_ticketCategoryId: {
            userId: cleanUserId,
            ticketCategoryId: cleanCategoryId,
          },
        },
      }),
    ]);

    const ownedTickets = tickets.filter((t) => t.status === 'OWNED' && !t.orderId);
    const listedTickets = tickets.filter((t) => t.status === 'LISTED' && t.orderId);
    const discrepancies = [];

    // Audit listed tickets for missing order references
    const orphanedTickets = [];
    for (const ticket of listedTickets) {
      try {
        const order = await this.orderRepository.findById(ticket.orderId);
        if (!order) {
          discrepancies.push(`Ticket ${ticket.id} references non-existent order ${ticket.orderId}`);
          orphanedTickets.push(ticket);
        }
      } catch (lookupErr) {
        // Never release a reservation solely because an order lookup temporarily fails!
        discrepancies.push(`Lookup error verifying order ${ticket.orderId} for ticket ${ticket.id}: ${lookupErr.message}`);
      }
    }

    if (repair && orphanedTickets.length > 0) {
      const orphanedIds = orphanedTickets.map((t) => t.id);
      await this.prisma.$transaction(async (tx) => {
        await tx.ticket.updateMany({
          where: { id: { in: orphanedIds }, status: 'LISTED' },
          data: { status: 'OWNED', orderId: null },
        });
        await tx.userTicketInventory.update({
          where: {
            userId_ticketCategoryId: {
              userId: cleanUserId,
              ticketCategoryId: cleanCategoryId,
            },
          },
          data: {
            availableQuantity: { increment: orphanedTickets.length },
            reservedQuantity: { decrement: orphanedTickets.length },
          },
        });
      });
      return this.reconcileTicketOwnershipAndInventory({ userId: cleanUserId, ticketCategoryId: cleanCategoryId, repair: false });
    }

    const totalActiveTickets = ownedTickets.length + listedTickets.length;

    const totalQuantity = inventory ? inventory.totalQuantity : 0;
    const availableQuantity = inventory ? inventory.availableQuantity : 0;
    const reservedQuantity = inventory ? inventory.reservedQuantity : 0;

    if (totalQuantity !== totalActiveTickets) {
      discrepancies.push(
        `Total quantity mismatch: aggregate has ${totalQuantity}, but user owns ${totalActiveTickets} active tickets`
      );
    }
    if (availableQuantity !== ownedTickets.length) {
      discrepancies.push(
        `Available quantity mismatch: aggregate has ${availableQuantity}, but user has ${ownedTickets.length} available tickets`
      );
    }
    if (reservedQuantity !== listedTickets.length) {
      discrepancies.push(
        `Reserved quantity mismatch: aggregate has ${reservedQuantity}, but user has ${listedTickets.length} listed tickets`
      );
    }

    return {
      userId: cleanUserId,
      ticketCategoryId: cleanCategoryId,
      isConsistent: discrepancies.length === 0,
      discrepancies,
      aggregate: { totalQuantity, availableQuantity, reservedQuantity },
      tickets: {
        total: totalActiveTickets,
        available: ownedTickets.length,
        reserved: listedTickets.length,
      },
    };
  }

  /**
   * Retrieves paginated orders for a user with filtering.
   * Delegates to historyService.getOrders to avoid duplicating query logic.
   *
   * @param {Object} params
   * @param {string} params.userId
   * @returns {Promise<Object>}
   */
  async getUserOrders({ userId, ...filters }) {
    if (!userId) {
      const err = new Error('userId is required');
      err.code = 'UNAUTHORIZED';
      throw err;
    }
    return this.historyService.getOrders(userId, filters);
  }

  /**
   * Retrieves order details and execution fills for a specific order.
   * Enforces strict user ownership: throws FORBIDDEN (403) if order does not belong to userId.
   * If order does not exist, throws ORDER_NOT_FOUND (404).
   *
   * Deduping Invariant:
   * Inspects incomingExecutions and restingExecutions relations.
   * Each Execution appears exactly once in the execution/fill list even if query paths overlap.
   *
   * @param {Object} params
   * @param {string} params.orderId
   * @param {string} params.userId
   * @returns {Promise<Object>} Order details with deduplicated executions and fills
   */
  async getOrderDetails({ orderId, userId }) {
    if (!orderId) {
      const err = new Error('orderId is required');
      err.code = 'ORDER_VALIDATION_ERROR';
      throw err;
    }
    if (!userId) {
      const err = new Error('userId is required');
      err.code = 'UNAUTHORIZED';
      throw err;
    }

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        incomingExecutions: {
          orderBy: { sequenceNumber: 'asc' },
        },
        restingExecutions: {
          orderBy: { sequenceNumber: 'asc' },
        },
        event: {
          select: { id: true, name: true, location: true, dateTime: true },
        },
        ticketCategory: {
          select: { id: true, name: true, originalPrice: true },
        },
      },
    });

    if (!order) {
      const err = new Error(`Order not found: ${orderId}`);
      err.code = 'ORDER_NOT_FOUND';
      throw err;
    }

    if (order.userId !== userId) {
      const err = new Error('You are not authorized to view this order');
      err.code = 'FORBIDDEN';
      throw err;
    }

    // Deduplicate executions across incoming and resting relations using Map
    const executionsMap = new Map();

    for (const exec of order.incomingExecutions || []) {
      executionsMap.set(exec.id, {
        id: exec.id,
        orderId: order.id,
        price: exec.price,
        quantity: exec.quantity,
        sequenceNumber: exec.sequenceNumber != null ? String(exec.sequenceNumber) : null,
        settlementStatus: exec.settlementStatus,
        role: 'TAKER',
        side: order.side,
        executedAt: exec.executedAt instanceof Date ? exec.executedAt.toISOString() : exec.executedAt,
      });
    }

    for (const exec of order.restingExecutions || []) {
      if (!executionsMap.has(exec.id)) {
        executionsMap.set(exec.id, {
          id: exec.id,
          orderId: order.id,
          price: exec.price,
          quantity: exec.quantity,
          sequenceNumber: exec.sequenceNumber != null ? String(exec.sequenceNumber) : null,
          settlementStatus: exec.settlementStatus,
          role: 'MAKER',
          side: order.side,
          executedAt: exec.executedAt instanceof Date ? exec.executedAt.toISOString() : exec.executedAt,
        });
      }
    }

    const executions = Array.from(executionsMap.values()).sort((a, b) => {
      if (a.sequenceNumber && b.sequenceNumber) {
        return BigInt(a.sequenceNumber) < BigInt(b.sequenceNumber) ? -1 : 1;
      }
      return new Date(a.executedAt).getTime() - new Date(b.executedAt).getTime();
    });

    const initialQuantity = order.initialQuantity;
    const remainingQuantity = order.remainingQuantity;
    const filledQuantity = initialQuantity - remainingQuantity;

    return {
      id: order.id,
      orderId: order.id,
      userId: order.userId,
      eventId: order.eventId,
      eventName: order.event?.name,
      event: order.event,
      ticketCategoryId: order.ticketCategoryId,
      categoryName: order.ticketCategory?.name,
      ticketCategory: order.ticketCategory,
      side: order.side,
      status: order.status,
      price: order.price,
      initialQuantity,
      originalQuantity: initialQuantity,
      remainingQuantity,
      filledQuantity,
      stoppedReason: order.stoppedReason || null,
      sequenceNumber: order.sequenceNumber != null ? String(order.sequenceNumber) : null,
      createdAt: order.createdAt instanceof Date ? order.createdAt.toISOString() : order.createdAt,
      updatedAt: order.updatedAt instanceof Date ? order.updatedAt.toISOString() : order.updatedAt,
      executions,
      fills: executions,
    };
  }

  /**
   * Retrieves trades/executions associated with a specific order.
   * Enforces strict user ownership via getOrderDetails.
   *
   * @param {Object} params
   * @param {string} params.orderId
   * @param {string} params.userId
   * @returns {Promise<Object>} { orderId, trades, executions, total }
   */
  async getOrderTrades({ orderId, userId }) {
    const orderDetails = await this.getOrderDetails({ orderId, userId });
    return {
      orderId: orderDetails.id,
      trades: orderDetails.executions,
      executions: orderDetails.executions,
      total: orderDetails.executions.length,
    };
  }
}

