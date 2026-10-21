import prisma from '../db/prisma.js';

/**
 * Service for logging and retrieving append-only audit trail records.
 */
export const auditLogService = {
  /**
   * Appends an audit log entry for a sensitive action.
   * @param {string} adminId - ID of the admin performing the action.
   * @param {string} action - Action name (e.g., 'SUSPEND_USER', 'VERIFY_ORGANIZER').
   * @param {object|string|null} details - Structured contextual data.
   * @returns {Promise<object>} Created AuditLog record.
   */
  async logAction(adminId, action, details = null) {
    return prisma.auditLog.create({
      data: {
        adminId,
        action,
        details: details ? (typeof details === 'object' ? details : { info: details }) : null,
      },
      include: {
        admin: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
          },
        },
      },
    });
  },

  /**
   * Queries audit logs with pagination and filters.
   * @param {object} filters - Filter criteria.
   * @returns {Promise<{ logs: Array, total: number, page: number, limit: number }>}
   */
  async getAuditLogs(filters = {}) {
    const { adminId, action, startDate, endDate, page = 1, limit = 20 } = filters;
    const skip = (page - 1) * limit;

    const where = {};
    if (adminId) where.adminId = adminId;
    if (action) where.action = { contains: action, mode: 'insensitive' };
    if (startDate || endDate) {
      where.timestamp = {};
      if (startDate) where.timestamp.gte = new Date(startDate);
      if (endDate) where.timestamp.lte = new Date(endDate);
    }

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: { timestamp: 'desc' },
        include: {
          admin: {
            select: {
              id: true,
              name: true,
              email: true,
              role: true,
            },
          },
        },
      }),
      prisma.auditLog.count({ where }),
    ]);

    return {
      logs,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  },
};

export default auditLogService;
