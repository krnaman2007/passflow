import prisma from '../db/prisma.js';
import logger from '../errorlogging/logger.js';
import { AppError } from '../middleware/errorHandler.js';

/**
 * Service handling Primary Ticket Purchases, User Ticket Portfolio,
 * Ticket Ownership Audit Trail, and Direct Peer-to-Peer Ticket Transfers.
 */
export const ticketService = {
  /**
   * Primary purchase of tickets at original face value directly from organizer inventory.
   * Atomic DB transaction:
   * 1. Validates event publication & category availability.
   * 2. Decrements available inventory atomically.
   * 3. Debits the user's wallet with immutable ledger entry and transaction record.
   * 4. Creates Ticket entities with status 'OWNED' and initial TicketOwnership records (source: 'PRIMARY').
   * If any step fails or funds/inventory are insufficient, the entire transaction is rolled back.
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

    // 2. Execute atomic database transaction
    const result = await prisma.$transaction(async (tx) => {
      // 2a. Atomically inspect and decrement inventory
      const inventory = await tx.ticketInventory.findUnique({
        where: { categoryId },
      });

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

      const newAvailable = inventory.availableQuantity - qty;
      const newCategoryStatus = newAvailable === 0 ? 'SOLD_OUT' : category.status;

      await tx.ticketInventory.update({
        where: { categoryId },
        data: {
          availableQuantity: newAvailable,
        },
      });

      if (newCategoryStatus !== category.status) {
        await tx.ticketCategory.update({
          where: { id: categoryId },
          data: { status: newCategoryStatus },
        });
      }

      // 2b. Lock and debit buyer wallet
      const wallet = await tx.wallet.findUnique({
        where: { userId },
      });

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

      const updatedAvailable = availableBalance - totalPaise;
      const updatedVersion = BigInt(wallet.version) + 1n;

      await tx.wallet.update({
        where: { id: wallet.id },
        data: {
          availableBalance: updatedAvailable,
          version: updatedVersion,
        },
      });

      // 2c. Create Transaction audit record
      const transaction = await tx.transaction.create({
        data: {
          walletId: wallet.id,
          amount: -totalPaise,
          type: 'PURCHASE',
          status: 'COMPLETED',
          description: `Primary purchase of ${qty} ticket(s) for event '${event.name}' (${category.name})`,
        },
      });

      // 2d. Create WalletLedgerEntry for double-entry bookkeeping consistency
      await tx.walletLedgerEntry.create({
        data: {
          walletId: wallet.id,
          entryType: 'TRADE_SETTLEMENT_DEBIT',
          amount: totalPaise,
          availableDelta: -totalPaise,
          reservedDelta: 0n,
          balanceAfterAvailable: updatedAvailable,
          balanceAfterReserved: BigInt(wallet.reservedBalance),
          idempotencyKey: idempotencyKey ? `${idempotencyKey}:debit` : null,
          description: `Primary purchase of ${qty} x ${category.name} tickets`,
        },
      });

      // 2e. Create Tickets & initial TicketOwnership records
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

      return {
        tickets: createdTickets,
        transactionId: transaction.id,
        amountDebited: (Number(totalPaise) / 100).toFixed(2),
        newWalletBalance: (Number(updatedAvailable) / 100).toFixed(2),
        category: {
          id: category.id,
          name: category.name,
          remainingAvailable: newAvailable,
        },
      };
    });

    logger.info('Primary ticket purchase succeeded', {
      userId,
      eventId,
      categoryId,
      quantity: qty,
      ticketsCount: result.tickets.length,
    });

    return result;
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
