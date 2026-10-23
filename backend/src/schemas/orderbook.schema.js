import { z } from 'zod';

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const COMPOSITE_ORDERBOOK_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * Route parameter validation for event orderbook:
 * GET /events/:eventId/orderbook?categoryId=...
 */
export const eventOrderbookParamsSchema = z
  .object({
    eventId: z
      .string()
      .min(1, 'Event ID is required')
      .refine((val) => UUID_REGEX.test(val), {
        message: 'Event ID must be a valid UUID',
      })
      .optional(),
    id: z
      .string()
      .min(1, 'Event ID is required')
      .refine((val) => UUID_REGEX.test(val), {
        message: 'Event ID must be a valid UUID',
      })
      .optional(),
  })
  .refine((data) => Boolean(data.eventId || data.id), {
    message: 'Event ID is required',
  });

/**
 * Query parameter validation for event orderbook:
 * Requires categoryId (or alias ticketCategoryId), supports optional limit.
 */
export const eventOrderbookQuerySchema = z
  .object({
    categoryId: z
      .string()
      .optional()
      .refine((val) => !val || UUID_REGEX.test(val), {
        message: 'categoryId must be a valid UUID',
      }),
    ticketCategoryId: z
      .string()
      .optional()
      .refine((val) => !val || UUID_REGEX.test(val), {
        message: 'ticketCategoryId must be a valid UUID',
      }),
    limit: z.coerce
      .number({ invalid_type_error: 'limit must be a number' })
      .int('limit must be an integer')
      .positive('limit must be positive')
      .max(100, 'limit cannot exceed 100')
      .default(50)
      .optional(),
  })
  .refine((data) => Boolean(data.categoryId || data.ticketCategoryId), {
    message: 'Category ID is required in query params (categoryId or ticketCategoryId)',
    path: ['categoryId'],
  });

/**
 * Route parameter validation for orderbook depth:
 * GET /orderbook/:id/depth
 * :id can be a UUID (ticketCategory ID or order ID) or composite eventId:categoryId.
 */
export const orderbookDepthParamsSchema = z.object({
  id: z
    .string()
    .min(1, 'Orderbook identifier is required')
    .refine(
      (val) => UUID_REGEX.test(val) || COMPOSITE_ORDERBOOK_REGEX.test(val),
      {
        message: 'Invalid orderbook identifier format; must be a UUID or composite eventId:categoryId',
      }
    ),
});

/**
 * Query parameter validation for orderbook depth:
 * Supports optional limit (default: 50, max: 100).
 */
export const orderbookDepthQuerySchema = z.object({
  limit: z.coerce
    .number({ invalid_type_error: 'limit must be a number' })
    .int('limit must be an integer')
    .positive('limit must be positive')
    .max(100, 'limit cannot exceed 100')
    .default(50)
    .optional(),
});

export default {
  eventOrderbookParamsSchema,
  eventOrderbookQuerySchema,
  orderbookDepthParamsSchema,
  orderbookDepthQuerySchema,
};
