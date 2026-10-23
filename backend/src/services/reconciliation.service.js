import prisma from '../db/prisma.js';

/**
 * Service for running and querying automated reconciliation reports.
 * Compares financial ledger records against trades and settlements to identify discrepancies.
 */
export const reconciliationService = {
  /**
   * Generates a new reconciliation report batch.
   * Compares active executions against ledger settlements.
   *
   * @param {Date|string} [targetDate] - Target date for the reconciliation run.
   * @returns {Promise<object>} Created reconciliation record and summary report.
   */
  async runReconciliation(targetDate = new Date()) {
    const runDate = targetDate ? new Date(targetDate) : new Date();

    const settlements = await prisma.tradeSettlement.findMany({
      include: { execution: { include: { ledgerEntries: true } } },
      take: 2000,
    });
    let discrepancies = 0;
    let totalVolumePaise = 0n;
    for (const settlement of settlements) {
      const expected = BigInt(settlement.executionCostPaise);
      totalVolumePaise += expected;
      const entries = settlement.execution.ledgerEntries;
      const debit = entries.filter((entry) => entry.entryType === 'TRADE_SETTLEMENT_DEBIT')
        .reduce((sum, entry) => sum + BigInt(entry.amount), 0n);
      const credit = entries.filter((entry) => entry.entryType === 'TRADE_SETTLEMENT_CREDIT')
        .reduce((sum, entry) => sum + BigInt(entry.amount), 0n);
      if (debit !== expected || credit !== expected) discrepancies += 1;
    }
    const status = discrepancies === 0 ? 'MATCHED' : 'DISCREPANCY_FOUND';
    const formattedLedgerSum = `$${(Number(totalVolumePaise) / 100).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;

    // Persist to PostgreSQL database
    const record = await prisma.reconciliation.create({
      data: {
        date: runDate,
        status,
        reportUrl: null,
      },
    });

    return {
      id: record.id,
      date: record.date,
      status: record.status,
      reportUrl: null,
      discrepancies,
      checkedTrades: settlements.length,
      ledgerSum: formattedLedgerSum,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  },

  /**
   * Retrieves reconciliation reports with pagination and filtering.
   *
   * @param {object} filters - Status, startDate, endDate, page, limit.
   * @returns {Promise<{ reports: Array, total: number, page: number, limit: number, totalPages: number }>}
   */
  async getReports(filters = {}) {
    const { status, startDate, endDate, page = 1, limit = 20 } = filters;
    const pageNum = parseInt(page, 10) || 1;
    const limitNum = parseInt(limit, 10) || 20;
    const skip = (pageNum - 1) * limitNum;

    const where = {};

    if (status) {
      where.status = status;
    }

    if (startDate || endDate) {
      where.date = {};
      if (startDate) where.date.gte = new Date(startDate);
      if (endDate) where.date.lte = new Date(endDate);
    }

    const [reports, total] = await Promise.all([
      prisma.reconciliation.findMany({
        where,
        skip,
        take: limitNum,
        orderBy: { date: 'desc' },
      }),
      prisma.reconciliation.count({ where }),
    ]);

    const formattedReports = reports.map((r) => ({
      ...r,
      summaryAvailable: false,
    }));

    return {
      reports: formattedReports,
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum) || 1,
    };
  },
};

export default reconciliationService;
