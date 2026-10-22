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
    side: z.enum(['BID', 'ASK'], {
      errorMap: () => ({ message: 'side must be either "BID" or "ASK"' }),
    }),
    price: z
      .number({ invalid_type_error: 'price must be an integer (paise)' })
      .int('price must be an integer (paise)')
      .positive('price must be positive')
      .max(Number.MAX_SAFE_INTEGER, 'price exceeds safe limit'),
    quantity: z
      .number({ invalid_type_error: 'quantity must be an integer' })
      .int('quantity must be an integer')
      .positive('quantity must be positive')
      .max(Number.MAX_SAFE_INTEGER, 'quantity exceeds safe limit'),
    idempotencyKey: z.string().min(1, 'idempotencyKey is required'),
  })
  .strict();

/**
 * Zod schema for order cancellation route parameters.
 * DELETE /api/v1/orders/:id
 */
export const cancelOrderParamsSchema = z
  .object({
    id: z.string().min(1, 'Order ID is required'),
  })
  .strict();

export default {
  placeLimitOrderSchema,
  cancelOrderParamsSchema,
};
