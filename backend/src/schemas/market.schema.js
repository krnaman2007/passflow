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

export const queryMarketDepthSchema = z.object({
  limit: z.coerce.number().int().positive().max(100).default(50).optional(),
});

export const queryTradeFeedSchema = z.object({
  limit: z.coerce.number().int().positive().max(100).default(50).optional(),
});

export const queryMarketSummarySchema = z.object({
  limit: z.coerce.number().int().positive().max(50).default(10).optional(),
  sortBy: z.enum(['volume', 'priceMovement', 'trades']).default('volume').optional(),
  timeframe: z.enum(['24h', '7d', 'all']).default('24h').optional(),
});

export const priceHistoryParamsSchema = z.object({
  id: z.string().min(1, 'Event ID is required'),
});

export const queryPriceHistorySchema = z.object({
  categoryId: z.string().optional(),
  interval: z.enum(['1m', '5m', '15m', '1h', '1d']).default('1h').optional(),
  limit: z.coerce.number().int().positive().max(500).default(100).optional(),
});

export default {
  marketParamsSchema,
  marketDataSchema,
  queryMarketDepthSchema,
  queryTradeFeedSchema,
  queryMarketSummarySchema,
  priceHistoryParamsSchema,
  queryPriceHistorySchema,
};
