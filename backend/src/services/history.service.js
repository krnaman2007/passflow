import prisma from '../db/prisma.js';

/**
 * HistoryService
 * Read model of a user's financial and trade history.
 */
class HistoryService {
  /**
   * Get paginated financial transaction history for a user.
   * Reads from TransactionHistory model or derives from WalletLedgerEntry.
   * Supports filtering by type, date range (startDate/endDate or from/to), and pagination.
   *
   * @param {string} userId
   * @param {object} query - { type, entryType, status, startDate, endDate, from, to, page, limit, source }
   * @returns {Promise<object>}
   */
  async getTransactions(userId, query = {}) {
    const page = Math.max(1, parseInt(query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 20));
    const skip = (page - 1) * limit;

    const typeFilter = query.type || query.entryType || null;
    const rawStart = query.startDate || query.from || null;
    const rawEnd = query.endDate || query.to || null;

    let startDate = null;
    if (rawStart) {
      const parsed = new Date(rawStart);
      if (!isNaN(parsed.getTime())) startDate = parsed;
    }

    let endDate = null;
    if (rawEnd) {
      const parsed = new Date(rawEnd);
      if (!isNaN(parsed.getTime())) endDate = parsed;
    }

    const preferLedger = query.source === 'ledger';

    let total = 0;
    let transactions = [];

    // Query TransactionHistory table if not explicitly requesting direct ledger
    if (!preferLedger) {
      const whereClause = { userId };
      if (typeFilter) whereClause.type = typeFilter;
      if (query.status) whereClause.status = query.status;
      if (startDate || endDate) {
        whereClause.createdAt = {};
        if (startDate) whereClause.createdAt.gte = startDate;
        if (endDate) whereClause.createdAt.lte = endDate;
      }

      try {
        [total, transactions] = await Promise.all([
          prisma.transactionHistory.count({ where: whereClause }),
          prisma.transactionHistory.findMany({
            where: whereClause,
            orderBy: { createdAt: 'desc' },
            skip,
            take: limit,
          }),
        ]);
      } catch {
        // Non-blocking fallback
        total = 0;
        transactions = [];
      }
    }

    // If preferLedger OR no direct records in TransactionHistory table, query WalletLedgerEntry
    if (total === 0) {
      const userWallet = await prisma.wallet.findUnique({
        where: { userId },
        select: { id: true },
      });

      if (userWallet) {
        const ledgerWhere = { walletId: userWallet.id };
        if (typeFilter) ledgerWhere.entryType = typeFilter;
        if (startDate || endDate) {
          ledgerWhere.createdAt = {};
          if (startDate) ledgerWhere.createdAt.gte = startDate;
          if (endDate) ledgerWhere.createdAt.lte = endDate;
        }

        const [ledgerTotal, ledgerEntries] = await Promise.all([
          prisma.walletLedgerEntry.count({ where: ledgerWhere }),
          prisma.walletLedgerEntry.findMany({
            where: ledgerWhere,
            orderBy: { createdAt: 'desc' },
            skip,
            take: limit,
          }),
        ]);

        total = ledgerTotal;
        transactions = ledgerEntries.map((entry) => ({
          id: entry.id,
          userId,
          walletId: entry.walletId,
          type: entry.entryType,
          entryType: entry.entryType,
          amount: Number(entry.amount) / 100, // convert paise to base unit for backward compatibility
          amountPaise: entry.amount.toString(),
          availableDelta: entry.availableDelta !== null && entry.availableDelta !== undefined ? entry.availableDelta.toString() : '0',
          reservedDelta: entry.reservedDelta !== null && entry.reservedDelta !== undefined ? entry.reservedDelta.toString() : '0',
          balanceAfterAvailable: entry.balanceAfterAvailable !== null && entry.balanceAfterAvailable !== undefined ? entry.balanceAfterAvailable.toString() : '0',
          balanceAfterReserved: entry.balanceAfterReserved !== null && entry.balanceAfterReserved !== undefined ? entry.balanceAfterReserved.toString() : '0',
          sequenceNumber: entry.sequenceNumber !== null && entry.sequenceNumber !== undefined ? entry.sequenceNumber.toString() : null,
          status: 'COMPLETED',
          description: entry.description,
          createdAt: entry.createdAt,
        }));
      }
    }

    return {
      transactions,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || (total === 0 ? 0 : 1),
      },
    };
  }

  /**
   * Get past orders placed by the user.
   *
   * @param {string} userId
   * @param {object} query - { status, side, eventId, page, limit }
   * @returns {Promise<object>}
   */
  async getOrders(userId, query = {}) {
    const page = Math.max(1, parseInt(query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 20));
    const skip = (page - 1) * limit;

    const whereClause = { userId };
    if (query.status) whereClause.status = query.status;
    if (query.side) whereClause.side = query.side;
    if (query.eventId) whereClause.eventId = query.eventId;

    const [total, orders] = await Promise.all([
      prisma.order.count({ where: whereClause }),
      prisma.order.findMany({
        where: whereClause,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          event: {
            select: { id: true, name: true, location: true, dateTime: true },
          },
          ticketCategory: {
            select: { id: true, name: true, originalPrice: true },
          },
        },
      }),
    ]);

    return {
      orders: orders.map((o) => ({
        id: o.id,
        side: o.side,
        status: o.status,
        price: o.price,
        initialQuantity: o.initialQuantity,
        remainingQuantity: o.remainingQuantity,
        eventId: o.eventId,
        eventName: o.event?.name,
        ticketCategoryId: o.ticketCategoryId,
        categoryName: o.ticketCategory?.name,
        createdAt: o.createdAt,
        updatedAt: o.updatedAt,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  /**
   * Get past trades / executions involving the user.
   *
   * @param {string} userId
   * @param {object} query - { page, limit }
   * @returns {Promise<object>}
   */
  async getTrades(userId, query = {}) {
    const page = Math.max(1, parseInt(query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 20));
    const skip = (page - 1) * limit;

    const whereClause = {
      OR: [
        { incomingOrder: { userId } },
        { restingOrder: { userId } },
      ],
    };

    const [total, executions] = await Promise.all([
      prisma.execution.count({ where: whereClause }),
      prisma.execution.findMany({
        where: whereClause,
        orderBy: { executedAt: 'desc' },
        skip,
        take: limit,
        include: {
          incomingOrder: {
            select: { id: true, userId: true, side: true, eventId: true, ticketCategoryId: true },
          },
          restingOrder: {
            select: { id: true, userId: true, side: true, eventId: true, ticketCategoryId: true },
          },
        },
      }),
    ]);

    const trades = executions.map((exec) => {
      const isIncoming = exec.incomingOrder.userId === userId;
      const userSide = isIncoming ? exec.incomingOrder.side : exec.restingOrder.side;

      return {
        id: exec.id,
        price: exec.price,
        quantity: exec.quantity,
        totalAmount: (exec.price * exec.quantity) / 100,
        settlementStatus: exec.settlementStatus,
        side: userSide,
        eventId: exec.incomingOrder.eventId,
        ticketCategoryId: exec.incomingOrder.ticketCategoryId,
        executedAt: exec.executedAt,
      };
    });

    return {
      trades,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }
}

export const historyService = new HistoryService();
export default historyService;
