import { z } from 'zod';

/**
 * Route parameter validation schema for market data
 * GET /market/:eventId/:categoryId
 */
export const marketParamsSchema = z.object({
  eventId: z.string().min(1, 'Event ID is required'),
  categoryId: z.string().min(1, 'Category ID is required'),
});

/**
 * MarketData model schema
 * Fields: id, eventId, categoryId, bestBid, bestAsk, lastPrice, volume, updatedAt
 */
export const marketDataSchema = z.object({
  id: z.string(),
  eventId: z.string(),
  categoryId: z.string(),
  bestBid: z.number().nullable(),
  bestAsk: z.number().nullable(),
  lastPrice: z.number().nullable(),
  volume: z.number().nonnegative(),
  spread: z.number().nullable().optional(),
  updatedAt: z.coerce.date(),
});

export default {
  marketParamsSchema,
  marketDataSchema,
};
