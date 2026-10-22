import { z } from 'zod';

/**
 * DutchAuction Status Enum
 * Matching Prisma Schema: ACTIVE | COMPLETED | CANCELLED | EXPIRED
 */
export const dutchAuctionStatusEnum = z.enum(['ACTIVE', 'COMPLETED', 'CANCELLED', 'EXPIRED']);

/**
 * DutchAuction Model Schema
 * Price drops over time until someone buys.
 * Fields: id, eventId, categoryId, startPrice, minPrice, currentPrice, startTime, endTime, status
 */
export const dutchAuctionSchema = z.object({
  id: z.string().uuid(),
  eventId: z.string().uuid(),
  categoryId: z.string().uuid(),
  startPrice: z.coerce.number().positive('Start price must be positive'),
  minPrice: z.coerce.number().positive('Min price must be positive'),
  currentPrice: z.coerce.number().positive('Current price must be positive'),
  startTime: z.coerce.date(),
  endTime: z.coerce.date(),
  status: dutchAuctionStatusEnum.default('ACTIVE'),
  createdAt: z.coerce.date().optional(),
  updatedAt: z.coerce.date().optional(),
});

/**
 * Schema for creating a Dutch auction
 */
export const createDutchAuctionSchema = z
  .object({
    eventId: z.string().uuid('Event ID must be a valid UUID'),
    categoryId: z.string().uuid('Category ID must be a valid UUID'),
    startPrice: z.coerce.number().positive('Start price must be positive'),
    minPrice: z.coerce.number().positive('Min price must be positive'),
    startTime: z.coerce.date(),
    endTime: z.coerce.date(),
  })
  .refine((data) => data.startPrice > data.minPrice, {
    message: 'startPrice must be greater than minPrice',
    path: ['startPrice'],
  })
  .refine((data) => new Date(data.endTime) > new Date(data.startTime), {
    message: 'endTime must be after startTime',
    path: ['endTime'],
  });

/**
 * Schema for purchasing from a Dutch auction
 */
export const purchaseDutchAuctionSchema = z.object({
  quantity: z.coerce.number().int().positive().default(1),
});

export default dutchAuctionSchema;
