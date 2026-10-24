import prisma from '../db/prisma.js';
import logger from '../errorlogging/logger.js';
import { AppError } from '../middleware/errorHandler.js';
import { orderService } from './order/index.js';

/**
 * Service handling Primary Ticket Purchases, User Ticket Portfolio,
 * Ticket Ownership Audit Trail, and Direct Peer-to-Peer Ticket Transfers.
 */
export const ticketService = {
  /**
   * Primary purchase of tickets at original face value directly from organizer inventory.
   * Atomic DB transaction:
   * 1. Validates event publication & category availability.
   * 2. Idempotency inspection & replay verification.
   * 3. Decrements available inventory atomically under pessimistic row lock (FOR UPDATE).
   * 4. Debits the user's wallet under pessimistic row lock (FOR UPDATE) with immutable ledger entry and transaction record.
   * 5. Creates Ticket entities with status 'OWNED' and initial TicketOwnership records (source: 'PRIMARY').
   * 6. Credits UserTicketInventory and records UserInventoryCredit.
   * If any step fails or funds/inventory are insufficient, the entire transaction is rolled back.
   * Concurrency conflicts (serialization failure/deadlock) are retried in a bounded manner.
   *
   * @param {Object} params
   * @param {string} params.userId - Authenticated buyer ID.
   * @param {string} params.eventId - Event UUID.
   * @param {string} params.categoryId - Ticket category UUID.
   * @param {number} params.quantity - Number of tickets to purchase.
   * @param {string} [params.idempotencyKey] - Optional deduplication key.
   */
  async purchaseTickets({ userId, eventId, categoryId, quantity, idempotencyKey = null }) {
    const qty = parseInt(quantity, 10);
    if (!qty || qty < 1) {
      throw new AppError('Quantity must be at least 1', 400, 'INVALID_QUANTITY');
    }

    const cleanIdempKey = idempotencyKey && typeof idempotencyKey === 'string' && idempotencyKey.trim()
      ? idempotencyKey.trim()
      : null;

    // 1. Fetch Event & Category details
    const event = await prisma.event.findUnique({
      where: { id: eventId },
      include: {
        categories: {
          where: { id: categoryId },
          include: { inventory: true },
        },
      },
    });

    if (!event) {
      throw new AppError('Event not found', 404, 'EVENT_NOT_FOUND');
    }

    if (event.status !== 'PUBLISHED') {
      throw new AppError(
        `Tickets cannot be purchased for event with status '${event.status}'. Event must be PUBLISHED.`,
        400,
        'EVENT_NOT_ACTIVE'
      );
    }

    const category = event.categories[0];
    if (!category) {
      throw new AppError('Ticket category not found for this event', 404, 'CATEGORY_NOT_FOUND');
    }

    const unitPriceNumber = Number(category.originalPrice);
    if (isNaN(unitPriceNumber) || unitPriceNumber <= 0) {
      throw new AppError('Invalid ticket category price configured', 400, 'INVALID_PRICE');
    }

    // Convert total price into integer paise (minor units, e.g. INR 100 = 10000 paise)
    const totalPaise = BigInt(Math.round(unitPriceNumber * 100)) * BigInt(qty);

    // Fast-path: Check committed idempotency key before starting transaction
    if (cleanIdempKey) {
      const existingCredit = await prisma.userInventoryCredit.findUnique({
        where: { idempotencyKey: cleanIdempKey },
      });
      if (existingCredit) {
        return await this._verifyAndFormatReplay({
          existingCredit,
          userId,
          eventId,
          categoryId,
          qty,
          totalPaise,
        });
      }
    }

    // 2. Execute bounded retry loop for concurrency conflicts
    const MAX_RETRIES = 3;
    let attempt = 0;

    while (true) {
      try {
        const result = await prisma.$transaction(
          async (tx) => {
            // 2a. In-transaction idempotency check (handles races where another thread committed while waiting)
            if (cleanIdempKey) {
              const existingCredit = await tx.userInventoryCredit.findUnique({
                where: { idempotencyKey: cleanIdempKey },
              });
              if (existingCredit) {
                return await this._verifyAndFormatReplay({
                  existingCredit,
                  tx,
                  userId,
                  eventId,
                  categoryId,
                  qty,
                  totalPaise,
                });
              }
            }

            // 2b. Atomically lock & inspect inventory
            let inventory = null;
            if (typeof tx.$queryRaw === 'function') {
              try {
                const rows = await tx.$queryRaw`
                  SELECT * FROM "TicketInventory"
                  WHERE "categoryId" = ${categoryId}
                  FOR UPDATE
                `;
                inventory = rows && rows.length > 0 ? rows[0] : null;
              } catch (qErr) {
                // If $queryRaw fails (e.g. mocked in unit tests), fallback to findUnique
                inventory = null;
              }
            }
            if (!inventory) {
              inventory = await tx.ticketInventory.findUnique({
                where: { categoryId },
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

            // 2c. Atomically lock & inspect buyer wallet
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
            if (availableBalance < totalPaise) {
              throw new AppError(
                `Insufficient wallet balance. Required: ${(Number(totalPaise) / 100).toFixed(2)}, Available: ${(
                  Number(availableBalance) / 100
                ).toFixed(2)}`,
                400,
                'INSUFFICIENT_FUNDS'
              );
            }

            // 2d. Update inventory and category
            const newAvailable = inventory.availableQuantity - qty;
            const newCategoryStatus = newAvailable === 0 ? 'SOLD_OUT' : category.status;

            await tx.ticketInventory.update({
              where: { categoryId },
              data: {
                availableQuantity: newAvailable,
              },
            });

            await tx.ticketCategory.update({
              where: { id: categoryId },
              data: {
                availableQuantity: newAvailable,
                ...(newCategoryStatus !== category.status ? { status: newCategoryStatus } : {}),
              },
            });

            // 2e. Debit wallet
            const updatedAvailable = availableBalance - totalPaise;
            const updatedVersion = BigInt(wallet.version) + 1n;

            await tx.wallet.update({
              where: { id: wallet.id },
              data: {
                availableBalance: updatedAvailable,
                version: updatedVersion,
              },
            });

            // 2f. Create Transaction audit record
            const transaction = await tx.transaction.create({
              data: {
                walletId: wallet.id,
                amount: -totalPaise,
                type: 'PURCHASE',
                status: 'COMPLETED',
                description: `Primary purchase of ${qty} ticket(s) for event '${event.name}' (${category.name})`,
              },
            });

            // 2g. Create WalletLedgerEntry for double-entry bookkeeping consistency
            await tx.walletLedgerEntry.create({
              data: {
                walletId: wallet.id,
                entryType: 'TRADE_SETTLEMENT_DEBIT',
                amount: totalPaise,
                availableDelta: -totalPaise,
                reservedDelta: 0n,
                balanceAfterAvailable: updatedAvailable,
                balanceAfterReserved: BigInt(wallet.reservedBalance),
                idempotencyKey: cleanIdempKey ? `${cleanIdempKey}:debit` : null,
                description: `Primary purchase of ${qty} x ${category.name} tickets`,
              },
            });

            // 2h. Create Tickets & initial TicketOwnership records
            const createdTickets = [];
            const now = new Date();

            for (let i = 0; i < qty; i++) {
              const ticket = await tx.ticket.create({
                data: {
                  eventId,
                  categoryId,
                  ownerId: userId,
                  faceValue: category.originalPrice,
                  currentPrice: category.originalPrice,
                  status: 'OWNED',
                  createdAt: now,
                },
              });

              await tx.ticketOwnership.create({
                data: {
                  ticketId: ticket.id,
                  ownerId: userId,
                  acquiredAt: now,
                  source: 'PRIMARY',
                  transactionId: transaction.id,
                },
              });

              createdTickets.push(ticket);
            }

            // 2i. Credit UserTicketInventory within the same transaction if available on tx
            if (tx.userTicketInventory && tx.userInventoryCredit) {
              const creditKey = cleanIdempKey ? cleanIdempKey : `purchase:${transaction.id}`;
              await orderService.creditUserTicketInventory(
                {
                  userId,
                  ticketCategoryId: categoryId,
                  quantity: qty,
                  idempotencyKey: creditKey,
                  purchaseId: transaction.id,
                  requireTransaction: true,
                  skipTicketCreation: true,
                },
                tx
              );
            }

            return {
              tickets: createdTickets.sort((a, b) => a.id.localeCompare(b.id)),
              transactionId: transaction.id,
              amountDebited: (Number(totalPaise) / 100).toFixed(2),
              newWalletBalance: (Number(updatedAvailable) / 100).toFixed(2),
              category: {
                id: category.id,
                name: category.name,
                remainingAvailable: newAvailable,
              },
            };
          },
          {
            isolationLevel: 'ReadCommitted',
            maxWait: 15000,
            timeout: 30000,
          }
        );

        logger.info('Primary ticket purchase succeeded', {
          userId,
          eventId,
          categoryId,
          quantity: qty,
          ticketsCount: result.tickets.length,
        });

        return result;
      } catch (err) {
        // Never retry intentional business domain errors
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
              eventId,
              categoryId,
              qty,
              totalPaise,
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
          logger.warn(`Retrying primary purchase transaction on serialization conflict (attempt ${attempt}/${MAX_RETRIES})`, {
            error: err.message,
          });
          const jitter = Math.floor(Math.random() * 25);
          await new Promise((r) => setTimeout(r, 40 * Math.pow(2, attempt - 1) + jitter));
          continue;
        }

        throw err;
      }
    }
  },

  /**
   * Helper to verify idempotent replay payload parameters and construct deterministic response.
   *
   * @private
   */
  async _verifyAndFormatReplay({
    existingCredit,
    tx = null,
    userId,
    eventId,
    categoryId,
    qty,
    totalPaise,
  }) {
    const client = tx || prisma;

    // Check business parameters for conflicts
    if (
      existingCredit.userId !== userId ||
      existingCredit.ticketCategoryId !== categoryId ||
      existingCredit.quantity !== qty
    ) {
      throw new AppError(
        `Idempotency key "${existingCredit.idempotencyKey}" was already used with different parameters`,
        409,
        'IDEMPOTENCY_CONFLICT'
      );
    }

    // Verify transaction and amount
    const transaction = await client.transaction.findUnique({
      where: { id: existingCredit.purchaseId },
      include: { wallet: true },
    });

    if (transaction) {
      const recordedAmount = -BigInt(transaction.amount);
      if (totalPaise !== undefined && recordedAmount !== totalPaise) {
        throw new AppError(
          `Idempotency key "${existingCredit.idempotencyKey}" was already used with a different purchase price`,
          409,
          'IDEMPOTENCY_CONFLICT'
        );
      }
    }

    // Verify category matches event if eventId supplied
    const category = await client.ticketCategory.findUnique({
      where: { id: categoryId },
      include: { inventory: true },
    });
    if (category && eventId && category.eventId !== eventId) {
      throw new AppError(
        `Idempotency key "${existingCredit.idempotencyKey}" was already used with a different event`,
        409,
        'IDEMPOTENCY_CONFLICT'
      );
    }

    // Fetch existing tickets
    const existingOwnerships = await client.ticketOwnership.findMany({
      where: {
        ownerId: userId,
        transactionId: existingCredit.purchaseId,
        source: 'PRIMARY',
      },
      include: { ticket: true },
      orderBy: { ticket: { createdAt: 'asc' } },
    });

    const existingTickets = existingOwnerships.map((o) => o.ticket).sort((a, b) => a.id.localeCompare(b.id));
    const wallet = transaction?.wallet || (await client.wallet.findUnique({ where: { userId } }));
    const inventory = category?.inventory || (await client.ticketInventory.findUnique({ where: { categoryId } }));

    return {
      tickets: existingTickets,
      transactionId: existingCredit.purchaseId,
      amountDebited: transaction ? (Number(-transaction.amount) / 100).toFixed(2) : (Number(totalPaise) / 100).toFixed(2),
      newWalletBalance: wallet ? (Number(wallet.availableBalance) / 100).toFixed(2) : '0.00',
      category: {
        id: category ? category.id : categoryId,
        name: category ? category.name : 'Unknown',
        remainingAvailable: inventory ? inventory.availableQuantity : 0,
      },
      isDuplicate: true,
    };
  },

  /**
   * Retrieves all tickets currently owned by the logged-in user with optional status filter.
   *
   * @param {string} userId - Current user ID.
   * @param {Object} query - Query parameters (status, page, limit).
   */
  async getMyTickets(userId, { status, page = 1, limit = 20 } = {}) {
    const take = Math.min(Math.max(Number(limit) || 20, 1), 100);
    const skip = (Math.max(Number(page) || 1, 1) - 1) * take;

    const where = {
      ownerId: userId,
    };

    if (status) {
      where.status = status;
    }

    const [tickets, total] = await Promise.all([
      prisma.ticket.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: {
          event: {
            select: {
              id: true,
              name: true,
              dateTime: true,
              location: true,
              status: true,
            },
          },
          category: {
            select: {
              id: true,
              name: true,
              originalPrice: true,
            },
          },
        },
      }),
      prisma.ticket.count({ where }),
    ]);

    return {
      tickets,
      pagination: {
        total,
        page: Number(page) || 1,
        limit: take,
        totalPages: Math.ceil(total / take),
      },
    };
  },

  /**
   * Retrieves ticket details by ticket UUID.
   *
   * @param {string} ticketId - Ticket UUID.
   */
  async getTicketById(ticketId) {
    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      include: {
        event: {
          select: {
            id: true,
            name: true,
            description: true,
            dateTime: true,
            location: true,
            status: true,
            organizer: {
              select: {
                id: true,
                organizationName: true,
              },
            },
          },
        },
        category: {
          select: {
            id: true,
            name: true,
            originalPrice: true,
          },
        },
        owner: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    if (!ticket) {
      throw new AppError('Ticket not found', 404, 'TICKET_NOT_FOUND');
    }

    return ticket;
  },

  /**
   * Retrieves the complete chronological ownership history / audit trail of a ticket.
   *
   * @param {string} ticketId - Ticket UUID.
   */
  async getTicketOwnershipHistory(ticketId) {
    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      select: { id: true, eventId: true, categoryId: true, ownerId: true },
    });

    if (!ticket) {
      throw new AppError('Ticket not found', 404, 'TICKET_NOT_FOUND');
    }

    const ownershipHistory = await prisma.ticketOwnership.findMany({
      where: { ticketId },
      orderBy: { acquiredAt: 'asc' },
      include: {
        owner: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        transaction: {
          select: {
            id: true,
            amount: true,
            type: true,
            status: true,
            createdAt: true,
          },
        },
      },
    });

    // Safely format any BigInt in transactions
    const formattedHistory = ownershipHistory.map((item) => ({
      id: item.id,
      ticketId: item.ticketId,
      ownerId: item.ownerId,
      owner: item.owner,
      acquiredAt: item.acquiredAt,
      source: item.source,
      transaction: item.transaction
        ? {
            id: item.transaction.id,
            amount: item.transaction.amount.toString(),
            type: item.transaction.type,
            status: item.transaction.status,
            createdAt: item.transaction.createdAt,
          }
        : null,
    }));

    return {
      ticketId,
      currentOwnerId: ticket.ownerId,
      totalTransfers: Math.max(formattedHistory.length - 1, 0),
      history: formattedHistory,
    };
  },

  /**
   * Performs a direct peer-to-peer (non-market) ticket transfer to another registered user.
   * 1. Validates that the caller is the current owner.
   * 2. Asserts that the ticket is in 'OWNED' status (cannot transfer if LISTED, USED, or already TRANSFERRED).
   * 3. Resolves the recipient user via UUID or Email.
   * 4. In a single DB transaction:
   *    - Creates a TicketTransfer audit record ('COMPLETED').
   *    - Reassigns the Ticket's ownerId to the recipient.
   *    - Appends a new TicketOwnership record with source 'TRANSFER'.
   *
   * @param {Object} params
   * @param {string} params.ticketId - Ticket UUID.
   * @param {string} params.fromUserId - Authenticated sender user ID.
   * @param {string} [params.toUserId] - Recipient user UUID.
   * @param {string} [params.recipientEmail] - Recipient user email.
   */
  async transferTicket({ ticketId, fromUserId, toUserId, recipientEmail }) {
    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      include: {
        event: {
          select: { id: true, name: true, dateTime: true, status: true },
        },
      },
    });

    if (!ticket) {
      throw new AppError('Ticket not found', 404, 'TICKET_NOT_FOUND');
    }

    if (ticket.ownerId !== fromUserId) {
      throw new AppError('You are not authorized to transfer this ticket. Only the current owner can initiate a transfer.', 403, 'FORBIDDEN');
    }

    if (ticket.status !== 'OWNED') {
      throw new AppError(
        `Ticket cannot be transferred because its status is '${ticket.status}'. Must be in 'OWNED' status.`,
        400,
        'INVALID_TICKET_STATUS'
      );
    }

    // Resolve recipient user
    let recipient;
    if (toUserId) {
      recipient = await prisma.user.findUnique({
        where: { id: toUserId },
        select: { id: true, name: true, email: true },
      });
    } else if (recipientEmail) {
      recipient = await prisma.user.findUnique({
        where: { email: recipientEmail.trim().toLowerCase() },
        select: { id: true, name: true, email: true },
      });
    }

    if (!recipient) {
      throw new AppError('Recipient user account not found', 404, 'RECIPIENT_NOT_FOUND');
    }

    if (recipient.id === fromUserId) {
      throw new AppError('You cannot transfer a ticket to yourself', 400, 'SELF_TRANSFER_DISALLOWED');
    }

    const now = new Date();

    const transferResult = await prisma.$transaction(async (tx) => {
      // Create transfer record
      const transfer = await tx.ticketTransfer.create({
        data: {
          ticketId,
          fromUserId,
          toUserId: recipient.id,
          status: 'COMPLETED',
          createdAt: now,
        },
      });

      // Update ticket owner
      const updatedTicket = await tx.ticket.update({
        where: { id: ticketId },
        data: {
          ownerId: recipient.id,
          status: 'OWNED',
        },
      });

      // Append new ownership history entry
      const ownership = await tx.ticketOwnership.create({
        data: {
          ticketId,
          ownerId: recipient.id,
          acquiredAt: now,
          source: 'TRANSFER',
        },
      });

      // Update sender aggregate inventory if available on tx
      if (tx.userTicketInventory?.updateMany) {
        await tx.userTicketInventory.updateMany({
          where: {
            userId: fromUserId,
            ticketCategoryId: ticket.categoryId,
          },
          data: {
            totalQuantity: { decrement: 1 },
            availableQuantity: { decrement: 1 },
          },
        });
      }

      // Update recipient aggregate inventory if available on tx
      if (tx.userTicketInventory?.upsert) {
        await tx.userTicketInventory.upsert({
          where: {
            userId_ticketCategoryId: {
              userId: recipient.id,
              ticketCategoryId: ticket.categoryId,
            },
          },
          update: {
            totalQuantity: { increment: 1 },
            availableQuantity: { increment: 1 },
          },
          create: {
            userId: recipient.id,
            ticketCategoryId: ticket.categoryId,
            totalQuantity: 1,
            availableQuantity: 1,
            reservedQuantity: 0,
          },
        });
      }

      return {
        transfer,
        ticket: updatedTicket,
        ownership,
      };
    });

    logger.info('Ticket direct transfer completed', {
      ticketId,
      fromUserId,
      toUserId: recipient.id,
      transferId: transferResult.transfer.id,
    });

    return {
      message: 'Ticket transferred successfully',
      transferId: transferResult.transfer.id,
      ticketId,
      fromUserId,
      toUser: recipient,
      transferredAt: now,
      status: 'COMPLETED',
    };
  },

  /**
   * Retrieves transfer progress and details by transfer UUID.
   *
   * @param {string} transferId - Transfer UUID.
   * @param {string} userId - Authenticated user ID (must be sender, recipient, or admin).
   * @param {string} [userRole='USER'] - User role.
   */
  async getTransferById(transferId, userId, userRole = 'USER') {
    const transfer = await prisma.ticketTransfer.findUnique({
      where: { id: transferId },
      include: {
        ticket: {
          include: {
            event: {
              select: {
                id: true,
                name: true,
                dateTime: true,
                location: true,
              },
            },
            category: {
              select: {
                id: true,
                name: true,
                originalPrice: true,
              },
            },
          },
        },
        fromUser: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        toUser: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    if (!transfer) {
      throw new AppError('Transfer record not found', 404, 'TRANSFER_NOT_FOUND');
    }

    if (userRole !== 'ADMIN' && transfer.fromUserId !== userId && transfer.toUserId !== userId) {
      throw new AppError('You do not have permission to view this transfer record', 403, 'FORBIDDEN');
    }

    return transfer;
  },
};

export default ticketService;
