import { z } from 'zod';

/**
 * Zod schema for single trade / execution lookup route parameters.
 * GET /api/v1/trades/:id
 */
export const getTradeParamsSchema = z
  .object({
    id: z.string().min(1, 'Trade ID is required'),
  })
  .strict();

const VALID_SIDES = ['BID', 'ASK', 'BUY', 'SELL'];
const VALID_SETTLEMENT_STATUSES = ['PENDING', 'SETTLED', 'MANUAL_REVIEW'];

/**
 * Zod schema for querying authenticated user's executed trades.
 * GET /api/v1/trades
 */
export const queryTradesSchema = z.object({
  status: z
    .string()
    .optional()
    .refine(
      (val) => !val || VALID_SETTLEMENT_STATUSES.includes(val.trim().toUpperCase()),
      {
        message: 'status must be one of: PENDING, SETTLED, MANUAL_REVIEW',
      }
    ),
  settlementStatus: z
    .string()
    .optional()
    .refine(
      (val) => !val || VALID_SETTLEMENT_STATUSES.includes(val.trim().toUpperCase()),
      {
        message: 'settlementStatus must be one of: PENDING, SETTLED, MANUAL_REVIEW',
      }
    ),
  side: z
    .string()
    .optional()
    .refine(
      (val) => !val || VALID_SIDES.includes(val.trim().toUpperCase()),
      {
        message: 'side must be one of: BID, ASK, BUY, SELL',
      }
    ),
  eventId: z.string().optional(),
  event: z.string().optional(),
  ticketCategoryId: z.string().optional(),
  categoryId: z.string().optional(),
  page: z.coerce
    .number({ invalid_type_error: 'page must be a number' })
    .int('page must be an integer')
    .positive('page must be positive')
    .default(1),
  limit: z.coerce
    .number({ invalid_type_error: 'limit must be a number' })
    .int('limit must be an integer')
    .positive('limit must be positive')
    .max(100, 'limit cannot exceed 100')
    .default(20),
});

/**
 * Zod schema for public event trades route parameters.
 * GET /api/v1/events/:id/trades
 */
export const eventTradesParamsSchema = z
  .object({
    id: z.string().min(1, 'Event ID is required'),
  })
  .strict();

/**
 * Zod schema for querying public event recent trades.
 * GET /api/v1/events/:id/trades
 */
export const queryEventTradesSchema = z.object({
  categoryId: z.string().optional(),
  ticketCategoryId: z.string().optional(),
  page: z.coerce
    .number({ invalid_type_error: 'page must be a number' })
    .int('page must be an integer')
    .positive('page must be positive')
    .default(1),
  limit: z.coerce
    .number({ invalid_type_error: 'limit must be a number' })
    .int('limit must be an integer')
    .positive('limit must be positive')
    .max(100, 'limit cannot exceed 100')
    .default(50),
});

export default {
  getTradeParamsSchema,
  queryTradesSchema,
  eventTradesParamsSchema,
  queryEventTradesSchema,
};
