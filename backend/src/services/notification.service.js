import prisma from '../db/prisma.js';
import { AppError } from '../middleware/errorHandler.js';

let ioInstance = null;

/**
 * NotificationService
 * Handles user alerts (trade filled, order cancelled, etc.).
 * Methods: send() - Create + push notification via WebSocket.
 */
class NotificationService {
  /**
   * Set global Socket.IO instance for real-time push.
   */
  setIo(io) {
    ioInstance = io;
  }

  /**
   * Create + push notification via WebSocket.
   *
   * @param {string} userId - Target user UUID
   * @param {object} payload - { type, message }
   * @returns {Promise<object>} Created notification
   */
  async send(userId, payload) {
    const { type, message } = payload;
    if (!userId || !type || !message) {
      throw new AppError('userId, type, and message are required', 400, 'INVALID_NOTIFICATION');
    }

    const notification = await prisma.notification.create({
      data: {
        userId,
        type,
        message,
        status: 'UNREAD',
      },
    });

    // Push via WebSocket if socket server is active
    if (ioInstance) {
      try {
        ioInstance.to(`user:${userId}`).emit('notification', notification);
        ioInstance.emit(`notification:${userId}`, notification);
      } catch {
        // Non-blocking WebSocket delivery
      }
    }

    return notification;
  }

  /**
   * List paginated notifications for a user.
   *
   * @param {string} userId
   * @param {object} query - { status, page, limit }
   */
  async getNotifications(userId, query = {}) {
    const page = Math.max(1, parseInt(query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 20));
    const skip = (page - 1) * limit;

    const whereClause = { userId };
    if (query.status) {
      whereClause.status = query.status;
    }

    const [total, unreadCount, notifications] = await Promise.all([
      prisma.notification.count({ where: whereClause }),
      prisma.notification.count({ where: { userId, status: 'UNREAD' } }),
      prisma.notification.findMany({
        where: whereClause,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    return {
      notifications,
      unreadCount,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  /**
   * Mark a notification as read.
   *
   * @param {string} userId
   * @param {string} notificationId
   */
  async markAsRead(userId, notificationId) {
    const existing = await prisma.notification.findFirst({
      where: { id: notificationId, userId },
    });

    if (!existing) {
      throw new AppError('Notification not found', 404, 'NOT_FOUND');
    }

    const updated = await prisma.notification.update({
      where: { id: notificationId },
      data: { status: 'READ' },
    });

    return updated;
  }

  /**
   * Mark all unread notifications as read for a user.
   *
   * @param {string} userId
   */
  async markAllAsRead(userId) {
    const result = await prisma.notification.updateMany({
      where: { userId, status: 'UNREAD' },
      data: { status: 'READ' },
    });

    return { count: result.count };
  }
}

export const notificationService = new NotificationService();
export default notificationService;
