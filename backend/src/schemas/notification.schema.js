import { z } from 'zod';

/**
 * Notification Status Enum
 * Matching Prisma Schema: UNREAD | READ
 */
export const notificationStatusEnum = z.enum(['UNREAD', 'READ']);

/**
 * Notification Model Schema
 * User alerts (trade filled, order cancelled, etc.).
 * Fields: id, userId, type, message, status, createdAt
 */
export const notificationSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  type: z.string().min(1, 'Type is required'),
  message: z.string().min(1, 'Message is required'),
  status: notificationStatusEnum.default('UNREAD'),
  createdAt: z.coerce.date().default(() => new Date()),
  updatedAt: z.coerce.date().optional(),
});

/**
 * Schema for creating a notification
 */
export const createNotificationSchema = z.object({
  userId: z.string().uuid('Valid user ID required'),
  type: z.string().min(1, 'Notification type is required'),
  message: z.string().min(1, 'Message is required'),
});

/**
 * Schema for querying notifications
 */
export const queryNotificationsSchema = z.object({
  status: notificationStatusEnum.optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export default notificationSchema;
