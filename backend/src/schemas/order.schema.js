import { z } from 'zod';

/**
 * Zod schema for limit order placement.
 * POST /api/v1/orders
 *
 * Requirements:
 * - market identifiers: eventId, ticketCategoryId (non-empty strings)
 * - side: 'BID' or 'ASK'
 * - price: positive safe integer minor units (paise)
 * - quantity: positive safe integer
 * - idempotencyKey: non-empty client-supplied deduplication key
 * - strict(): rejects unexpected / unknown fields (including attempts to inject userId in body)
 */
export const placeLimitOrderSchema = z
  .object({
    eventId: z.string().min(1, 'eventId is required'),
    ticketCategoryId: z.string().min(1, 'ticketCategoryId is required'),
    side: z.enum(['BID', 'ASK', 'BUY', 'SELL'], {
      errorMap: () => ({ message: 'side must be BUY, SELL, BID, or ASK' }),
    }),
    type: z.enum(['LIMIT', 'MARKET']).default('LIMIT'),
    price: z
      .number({ invalid_type_error: 'price must be an integer (paise)' })
      .int('price must be an integer (paise)')
      .positive('price must be positive')
      .max(Number.MAX_SAFE_INTEGER, 'price exceeds safe limit')
      .optional(),
    quantity: z
      .number({ invalid_type_error: 'quantity must be an integer' })
      .int('quantity must be an integer')
      .positive('quantity must be positive')
      .max(Number.MAX_SAFE_INTEGER, 'quantity exceeds safe limit'),
    idempotencyKey: z.string().min(1, 'idempotencyKey cannot be empty'),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.type === 'LIMIT' && value.price === undefined) {
      ctx.addIssue({ code: 'custom', path: ['price'], message: 'price is required for LIMIT orders' });
    }
  });

/**
 * Zod schema for order cancellation route parameters.
 * DELETE /api/v1/orders/:id
 */
export const cancelOrderParamsSchema = z
  .object({
    id: z.string().min(1, 'Order ID is required'),
  })
  .strict();

/**
 * Zod schema for order lookup route parameters.
 * GET /api/v1/orders/:id and GET /api/v1/orders/:id/trades
 */
export const getOrderParamsSchema = z
  .object({
    id: z.string().min(1, 'Order ID is required'),
  })
  .strict();

const VALID_SIDES = ['BID', 'ASK', 'BUY', 'SELL'];
const VALID_STATUSES = [
  'OPEN',
  'PARTIALLY_FILLED',
  'FILLED',
  'CANCELLED',
  'REJECTED',
  'PARTIAL',
];

/**
 * Zod schema for querying paginated orders.
 * GET /api/v1/orders
 */
export const queryOrdersSchema = z.object({
  status: z
    .string()
    .optional()
    .refine(
      (val) => !val || VALID_STATUSES.includes(val.trim().toUpperCase()),
      {
        message:
          'status must be one of: OPEN, PARTIALLY_FILLED, FILLED, CANCELLED, REJECTED, PARTIAL',
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

export default {
  placeLimitOrderSchema,
  cancelOrderParamsSchema,
  getOrderParamsSchema,
  queryOrdersSchema,
};

