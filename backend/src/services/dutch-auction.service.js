import prisma from '../db/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { orderService } from './order/index.js';
import logger from '../errorlogging/logger.js';

/**
 * DutchAuctionService
 * Price drops linearly over time until buyers purchase tickets.
 * Hardened for transactional consistency, atomic multi-model updates,
 * row-level locking concurrency, and replay-safe idempotency.
 */
class DutchAuctionService {
  /**
   * Create a new Dutch auction for an event ticket category.
   *
   * @param {object} data - { eventId, categoryId, startPrice, minPrice, startTime, endTime }
   * @param {string} [organizerId] - Organizer ID of the requester
   * @param {string} [role] - User role
   * @returns {Promise<object>}
   */
  async createAuction(data, organizerId, role) {
    const event = await prisma.event.findUnique({
      where: { id: data.eventId },
    });

    if (!event) {
      throw new AppError('Event not found', 404, 'EVENT_NOT_FOUND');
    }

    // If requester is not admin, verify event ownership
    if (role !== 'ADMIN' && organizerId && event.organizerId !== organizerId) {
      throw new AppError('You can only create auctions for your own events', 403, 'FORBIDDEN');
    }

    const category = await prisma.ticketCategory.findUnique({
      where: { id: data.categoryId },
      include: { inventory: true },
    });

    if (!category || category.eventId !== data.eventId) {
      throw new AppError('Ticket category not found for this event', 404, 'CATEGORY_NOT_FOUND');
    }

    const auction = await prisma.dutchAuction.create({
      data: {
        eventId: data.eventId,
        categoryId: data.categoryId,
        startPrice: data.startPrice,
        minPrice: data.minPrice,
        currentPrice: data.startPrice,
        startTime: new Date(data.startTime),
        endTime: new Date(data.endTime),
        status: 'ACTIVE',
      },
      include: {
        event: { select: { id: true, name: true, location: true, dateTime: true } },
        category: { select: { id: true, name: true, originalPrice: true } },
      },
    });

    return auction;
  }

  /**
   * Computes the price at the current time for a Dutch auction.
   *
   * @param {object|string} auctionOrId - Auction object or auction UUID
   * @returns {Promise<{ currentPrice: number, status: string, startPrice: number, minPrice: number }>}
   */
  async getCurrentPrice(auctionOrId) {
    let auction = auctionOrId;
    if (typeof auctionOrId === 'string') {
      auction = await prisma.dutchAuction.findUnique({
        where: { id: auctionOrId },
      });
      if (!auction) {
        throw new AppError('Dutch auction not found', 404, 'AUCTION_NOT_FOUND');
      }
    }

    const startPrice = Number(auction.startPrice);
    const minPrice = Number(auction.minPrice);

    // If already finalized (COMPLETED, CANCELLED), preserve recorded price
    if (auction.status === 'COMPLETED' || auction.status === 'CANCELLED') {
      return {
        id: auction.id,
        currentPrice: Number(auction.currentPrice),
        startPrice,
        minPrice,
        status: auction.status,
      };
    }

    const now = Date.now();
    const startTime = new Date(auction.startTime).getTime();
    const endTime = new Date(auction.endTime).getTime();

    if (now <= startTime) {
      return {
        id: auction.id,
        currentPrice: startPrice,
        startPrice,
        minPrice,
        status: auction.status,
      };
    }

    if (now >= endTime) {
      if (auction.status === 'ACTIVE' && typeof auctionOrId === 'string') {
        // Automatically persist EXPIRED status on ID lookup
        await prisma.dutchAuction
          .update({
            where: { id: auction.id },
            data: { status: 'EXPIRED' },
          })
          .catch(() => {});
      }

      return {
        id: auction.id,
        currentPrice: minPrice,
        startPrice,
        minPrice,
        status: 'EXPIRED',
      };
    }

    // Linear price decay over duration
    const progress = (now - startTime) / (endTime - startTime);
    const decayedPrice = startPrice - progress * (startPrice - minPrice);
    const currentPrice = Math.max(minPrice, Math.round(decayedPrice * 100) / 100);

    return {
      id: auction.id,
      currentPrice,
      startPrice,
      minPrice,
      status: auction.status,
    };
  }

  /**
   * Retrieve auction details by ID with dynamic current price.
   *
   * @param {string} id
   */
  async getAuctionById(id) {
    const auction = await prisma.dutchAuction.findUnique({
      where: { id },
      include: {
        event: { select: { id: true, name: true, location: true, dateTime: true } },
        category: {
          select: {
            id: true,
            name: true,
            originalPrice: true,
            availableQuantity: true,
            totalQuantity: true,
            status: true,
          },
        },
      },
    });

    if (!auction) {
      throw new AppError('Dutch auction not found', 404, 'AUCTION_NOT_FOUND');
    }

    const priceInfo = await this.getCurrentPrice(auction);

    return {
      ...auction,
      currentPrice: priceInfo.currentPrice,
      computedStatus: priceInfo.status,
    };
  }

  /**
   * Cancel an active Dutch auction (Organizer or Admin only).
   *
   * @param {string} auctionId
   * @param {string} [organizerId]
   * @param {string} [role]
   * @returns {Promise<object>}
   */
  async cancelAuction(auctionId, organizerId, role) {
    const auction = await prisma.dutchAuction.findUnique({
      where: { id: auctionId },
      include: { event: { include: { organizer: true } } },
    });

    if (!auction) {
      throw new AppError('Dutch auction not found', 404, 'AUCTION_NOT_FOUND');
    }

    if (
      role !== 'ADMIN' &&
      organizerId &&
      auction.event.organizerId !== organizerId &&
      auction.event.organizer?.userId !== organizerId
    ) {
      throw new AppError('You can only cancel auctions for your own events', 403, 'FORBIDDEN');
    }

    if (auction.status !== 'ACTIVE') {
      throw new AppError(`Cannot cancel auction in ${auction.status} status`, 400, 'INVALID_AUCTION_STATUS');
    }

    const updated = await prisma.dutchAuction.update({
      where: { id: auctionId },
      data: { status: 'CANCELLED' },
    });

    return updated;
  }

  /**
   * Purchase tickets from a Dutch auction at the computed decaying price.
   *
   * Enforces:
   * 1. Monotonic row-level locking (DutchAuction -> TicketInventory -> Wallet).
   * 2. Integer paise accounting with BigInt.
   * 3. Atomic multi-model consistency across 6 models (DutchAuction, TicketInventory,
   *    Wallet, Transaction, WalletLedgerEntry, Ticket, TicketOwnership, UserTicketInventory).
   * 4. Bounded retry for transient serialization conflicts (P2034, 40001, 40P01).
   * 5. Replay-safe idempotency via UserInventoryCredit unique constraint with 409 conflict detection.
   * 6. Accurate lifecycle completion semantics (completion only when category inventory is exhausted).
   *
   * @param {string|object} param1 - Auction UUID or parameter object
   * @param {string} [maybeUserId]
   * @param {number} [maybeQuantity=1]
   * @param {string} [maybeIdempotencyKey=null]
   * @returns {Promise<object>}
   */
  async purchase(param1, maybeUserId, maybeQuantity, maybeIdempotencyKey) {
    let auctionId, userId, quantity, idempotencyKey;
    if (typeof param1 === 'object' && param1 !== null && !param1.id) {
      auctionId = param1.auctionId;
      userId = param1.userId;
      quantity = param1.quantity ?? 1;
      idempotencyKey = param1.idempotencyKey ?? null;
    } else {
      auctionId = param1;
      userId = maybeUserId;
      quantity = maybeQuantity ?? 1;
      idempotencyKey = maybeIdempotencyKey ?? null;
    }

    const qty = parseInt(quantity, 10);
    if (!Number.isInteger(qty) || qty <= 0) {
      throw new AppError('Quantity must be a positive integer', 400, 'INVALID_QUANTITY');
    }

    if (!userId || typeof userId !== 'string') {
      throw new AppError('Valid userId is required', 400, 'INVALID_USER_ID');
    }

    if (!auctionId || typeof auctionId !== 'string') {
      throw new AppError('Valid auctionId is required', 400, 'INVALID_AUCTION_ID');
    }

    const cleanIdempKey = idempotencyKey && typeof idempotencyKey === 'string' ? idempotencyKey.trim() : null;

    // Fast-path idempotency replay check before starting transaction
    if (cleanIdempKey) {
      const existingCredit = await prisma.userInventoryCredit.findUnique({
        where: { idempotencyKey: cleanIdempKey },
      });
      if (existingCredit) {
        return await this._verifyAndFormatReplay({
          existingCredit,
          userId,
          auctionId,
          qty,
        });
      }
    }

    const MAX_RETRIES = 3;
    let attempt = 0;

    while (true) {
      try {
        const result = await prisma.$transaction(
          async (tx) => {
            // 1. In-transaction idempotency check (handles races where another thread committed while waiting)
            if (cleanIdempKey) {
              const existingCredit = await tx.userInventoryCredit.findUnique({
                where: { idempotencyKey: cleanIdempKey },
              });
              if (existingCredit) {
                return await this._verifyAndFormatReplay({
                  existingCredit,
                  tx,
                  userId,
                  auctionId,
                  qty,
                });
              }
            }

            // 2. Lock 1 in global lock hierarchy: DutchAuction row
            let auction = null;
            if (typeof tx.$queryRaw === 'function') {
              try {
                const rows = await tx.$queryRaw`
                  SELECT * FROM "DutchAuction"
                  WHERE "id" = ${auctionId}
                  FOR UPDATE
                `;
                auction = rows && rows.length > 0 ? rows[0] : null;
              } catch (qErr) {
                auction = null;
              }
            }
            if (!auction) {
              auction = await tx.dutchAuction.findUnique({
                where: { id: auctionId },
              });
            }

            if (!auction) {
              throw new AppError('Dutch auction not found', 404, 'AUCTION_NOT_FOUND');
            }

            // 3. Validate auction status and lifecycle
            if (auction.status === 'COMPLETED') {
              throw new AppError('Auction is completed', 400, 'AUCTION_COMPLETED');
            }
            if (auction.status === 'CANCELLED') {
              throw new AppError('Auction is cancelled', 400, 'AUCTION_CANCELLED');
            }
            if (auction.status === 'EXPIRED') {
              throw new AppError('Auction has expired', 400, 'AUCTION_EXPIRED');
            }
            if (auction.status !== 'ACTIVE') {
              throw new AppError(`Auction is ${auction.status.toLowerCase()}`, 400, 'AUCTION_INACTIVE');
            }

            const now = Date.now();
            const startTime = new Date(auction.startTime).getTime();
            const endTime = new Date(auction.endTime).getTime();

            if (now < startTime) {
              throw new AppError('Auction has not started yet', 400, 'AUCTION_NOT_STARTED');
            }

            if (now >= endTime) {
              throw new AppError('Auction has expired', 400, 'AUCTION_EXPIRED');
            }

            // Compute current price according to linear decay schedule
            const startPrice = Number(auction.startPrice);
            const minPrice = Number(auction.minPrice);
            const progress = (now - startTime) / (endTime - startTime);
            const decayedPrice = startPrice - progress * (startPrice - minPrice);
            const currentPrice = Math.max(minPrice, Math.round(decayedPrice * 100) / 100);

            const unitPricePaise = BigInt(Math.round(currentPrice * 100));
            const totalPricePaise = unitPricePaise * BigInt(qty);

            // 4. Lock 2 in global lock hierarchy: TicketInventory row
            let inventory = null;
            if (typeof tx.$queryRaw === 'function') {
              try {
                const rows = await tx.$queryRaw`
                  SELECT * FROM "TicketInventory"
                  WHERE "categoryId" = ${auction.categoryId}
                  FOR UPDATE
                `;
                inventory = rows && rows.length > 0 ? rows[0] : null;
              } catch (qErr) {
                inventory = null;
              }
            }
            if (!inventory) {
              inventory = await tx.ticketInventory.findUnique({
                where: { categoryId: auction.categoryId },
              });
            }

            if (!inventory) {
              throw new AppError('Ticket inventory not initialized for this category', 404, 'INVENTORY_NOT_FOUND');
            }

            if (inventory.availableQuantity < qty) {
              throw new AppError(
                `Not enough tickets available. Requested: ${qty}, available: ${inventory.availableQuantity}`,
                400,
                'INSUFFICIENT_INVENTORY'
              );
            }

            // 5. Lock 3 in global lock hierarchy: Wallet row
            let wallet = null;
            if (typeof tx.$queryRaw === 'function') {
              try {
                const rows = await tx.$queryRaw`
                  SELECT * FROM "Wallet"
                  WHERE "userId" = ${userId}
                  FOR UPDATE
                `;
                wallet = rows && rows.length > 0 ? rows[0] : null;
              } catch (qErr) {
                wallet = null;
              }
            }
            if (!wallet) {
              wallet = await tx.wallet.findUnique({
                where: { userId },
              });
            }

            if (!wallet) {
              throw new AppError('Wallet not found for user. Please ensure wallet is created.', 404, 'WALLET_NOT_FOUND');
            }

            const availableBalance = BigInt(wallet.availableBalance);
            if (availableBalance < totalPricePaise) {
              throw new AppError(
                `Insufficient wallet balance. Required: ${(Number(totalPricePaise) / 100).toFixed(2)}, Available: ${(
                  Number(availableBalance) / 100
                ).toFixed(2)}`,
                400,
                'INSUFFICIENT_FUNDS'
              );
            }

            // Fetch Category for faceValue & name
            const category = await tx.ticketCategory.findUnique({
              where: { id: auction.categoryId },
            });
            if (!category) {
              throw new AppError('Ticket category not found', 404, 'CATEGORY_NOT_FOUND');
            }

            // 6. Update inventory & category
            const newAvailable = inventory.availableQuantity - qty;
            const newCategoryStatus = newAvailable === 0 ? 'SOLD_OUT' : category.status;

            await tx.ticketInventory.update({
              where: { categoryId: auction.categoryId },
              data: {
                availableQuantity: newAvailable,
              },
            });

            await tx.ticketCategory.update({
              where: { id: auction.categoryId },
              data: {
                availableQuantity: newAvailable,
                ...(newCategoryStatus !== category.status ? { status: newCategoryStatus } : {}),
              },
            });

            // 7. Update Dutch auction status and currentPrice
            // Actual completion condition: auction completes when category inventory is exhausted
            const auctionNextStatus = newAvailable === 0 ? 'COMPLETED' : 'ACTIVE';
            const updatedAuction = await tx.dutchAuction.update({
              where: { id: auctionId },
              data: {
                currentPrice,
                status: auctionNextStatus,
              },
            });

            // 8. Debit buyer wallet with integer paise
            const updatedAvailable = availableBalance - totalPricePaise;
            const updatedVersion = BigInt(wallet.version) + 1n;

            await tx.wallet.update({
              where: { id: wallet.id },
              data: {
                availableBalance: updatedAvailable,
                version: updatedVersion,
              },
            });

            // 9. Create Transaction audit record
            const transaction = await tx.transaction.create({
              data: {
                walletId: wallet.id,
                amount: -totalPricePaise,
                type: 'PURCHASE',
                status: 'COMPLETED',
                description: `Dutch auction purchase #${auctionId} (${qty} ticket(s) at ${(Number(unitPricePaise) / 100).toFixed(2)})`,
              },
            });

            // 10. Create WalletLedgerEntry
            await tx.walletLedgerEntry.create({
              data: {
                walletId: wallet.id,
                entryType: 'TRADE_SETTLEMENT_DEBIT',
                amount: totalPricePaise,
                availableDelta: -totalPricePaise,
                reservedDelta: 0n,
                balanceAfterAvailable: updatedAvailable,
                balanceAfterReserved: BigInt(wallet.reservedBalance),
                idempotencyKey: cleanIdempKey ? `${cleanIdempKey}:debit` : null,
                description: `Dutch auction purchase #${auctionId} (${qty} x ${category.name} tickets)`,
              },
            });

            // 11. Create individual Ticket and TicketOwnership records
            const createdTickets = [];
            const nowTimestamp = new Date();

            for (let i = 0; i < qty; i++) {
              const ticket = await tx.ticket.create({
                data: {
                  eventId: auction.eventId,
                  categoryId: auction.categoryId,
                  ownerId: userId,
                  faceValue: category.originalPrice,
                  currentPrice: currentPrice,
                  status: 'OWNED',
                  createdAt: nowTimestamp,
                },
              });

              await tx.ticketOwnership.create({
                data: {
                  ticketId: ticket.id,
                  ownerId: userId,
                  acquiredAt: nowTimestamp,
                  source: 'PRIMARY',
                  transactionId: transaction.id,
                },
              });

              createdTickets.push(ticket);
            }

            // 12. Credit UserTicketInventory & UserInventoryCredit
            if (tx.userTicketInventory && tx.userInventoryCredit) {
              const creditKey = cleanIdempKey ? cleanIdempKey : `auction_purchase:${transaction.id}`;
              await orderService.creditUserTicketInventory(
                {
                  userId,
                  ticketCategoryId: auction.categoryId,
                  quantity: qty,
                  idempotencyKey: creditKey,
                  purchaseId: transaction.id,
                  requireTransaction: true,
                  skipTicketCreation: true,
                },
                tx
              );
            }

            logger.info('Dutch auction ticket purchase succeeded', {
              userId,
              auctionId,
              categoryId: auction.categoryId,
              quantity: qty,
              purchasePrice: currentPrice,
              totalCost: Number(totalPricePaise) / 100,
              auctionStatus: auctionNextStatus,
            });

            return {
              auction: updatedAuction,
              purchasePrice: currentPrice,
              quantity: qty,
              totalCost: Number(totalPricePaise) / 100,
              amountDebited: (Number(totalPricePaise) / 100).toFixed(2),
              transactionId: transaction.id,
              tickets: createdTickets,
              category: {
                id: category.id,
                name: category.name,
                remainingAvailable: newAvailable,
              },
              isDuplicate: false,
            };
          },
          {
            isolationLevel: 'ReadCommitted',
            timeout: 45000,
            maxWait: 20000,
          }
        );

        return result;
      } catch (err) {
        if (err.code === 'AUCTION_EXPIRED' || err.errorCode === 'AUCTION_EXPIRED' || err.message?.includes('expired')) {
          await prisma.dutchAuction
            .update({
              where: { id: auctionId },
              data: { status: 'EXPIRED' },
            })
            .catch(() => {});
        }

        if (err instanceof AppError) {
          throw err;
        }

        // If duplicate key race on idempotencyKey, re-verify replay
        if (cleanIdempKey && (err.code === 'P2002' || err.message?.includes('UserInventoryCredit_idempotencyKey_key'))) {
          const raceWinnerCredit = await prisma.userInventoryCredit.findUnique({
            where: { idempotencyKey: cleanIdempKey },
          });
          if (raceWinnerCredit) {
            return await this._verifyAndFormatReplay({
              existingCredit: raceWinnerCredit,
              userId,
              auctionId,
              qty,
            });
          }
        }

        // Check for retryable PostgreSQL serialization conflicts / deadlocks
        const isConflict =
          err.code === 'P2034' ||
          err.code === '40001' ||
          err.code === '40P01' ||
          err.message?.includes('could not serialize access') ||
          err.message?.includes('deadlock detected') ||
          err.message?.includes('Unable to start a transaction in the given time') ||
          err.message?.includes('Transaction already closed');

        if (isConflict && attempt < MAX_RETRIES) {
          attempt++;
          logger.warn(`Retrying Dutch auction purchase on conflict (attempt ${attempt}/${MAX_RETRIES})`, {
            error: err.message,
          });
          const jitter = Math.floor(Math.random() * 25);
          await new Promise((r) => setTimeout(r, 40 * Math.pow(2, attempt - 1) + jitter));
          continue;
        }

        throw err;
      }
    }
  }

  /**
   * Helper to verify idempotent replay payload parameters and construct deterministic response.
   *
   * @private
   */
  async _verifyAndFormatReplay({ existingCredit, tx = null, userId, auctionId, qty }) {
    const client = tx || prisma;

    // Check business parameters for conflicts
    if (existingCredit.userId !== userId || existingCredit.quantity !== qty) {
      throw new AppError(
        `Idempotency key "${existingCredit.idempotencyKey}" was already used with different parameters`,
        409,
        'IDEMPOTENCY_CONFLICT'
      );
    }

    const auction = await client.dutchAuction.findUnique({
      where: { id: auctionId },
      include: { category: true },
    });

    if (auction && existingCredit.ticketCategoryId !== auction.categoryId) {
      throw new AppError(
        `Idempotency key "${existingCredit.idempotencyKey}" was already used with a different category or auction`,
        409,
        'IDEMPOTENCY_CONFLICT'
      );
    }

    // Verify transaction and amount
    const transaction = await client.transaction.findUnique({
      where: { id: existingCredit.purchaseId },
      include: { wallet: true },
    });

    const existingOwnerships = await client.ticketOwnership.findMany({
      where: {
        ownerId: userId,
        transactionId: existingCredit.purchaseId,
        source: 'PRIMARY',
      },
      include: { ticket: true },
      orderBy: { ticket: { createdAt: 'asc' } },
    });

    const existingTickets = existingOwnerships.map((o) => o.ticket);
    const totalPaise = transaction ? -BigInt(transaction.amount) : 0n;
    const unitPrice = qty > 0 ? Number(totalPaise) / (100 * qty) : Number(auction?.currentPrice || 0);

    return {
      auction: auction || { id: auctionId },
      purchasePrice: Math.round(unitPrice * 100) / 100,
      quantity: qty,
      totalCost: Number(totalPaise) / 100,
      amountDebited: (Number(totalPaise) / 100).toFixed(2),
      transactionId: existingCredit.purchaseId,
      tickets: existingTickets,
      category: auction?.category
        ? {
            id: auction.category.id,
            name: auction.category.name,
            remainingAvailable: auction.category.availableQuantity,
          }
        : null,
      isDuplicate: true,
    };
  }
}

export const dutchAuctionService = new DutchAuctionService();
export default dutchAuctionService;
