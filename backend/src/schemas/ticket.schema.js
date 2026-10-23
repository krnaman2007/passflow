import { z } from 'zod';

/**
 * Schema for validating primary ticket purchase requests (POST /events/:id/purchase)
 */
export const purchaseTicketSchema = z.object({
  categoryId: z.string().uuid({ message: 'A valid category UUID is required' }),
  quantity: z.coerce
    .number()
    .int('Quantity must be an integer')
    .min(1, 'Quantity must be at least 1')
    .max(50, 'Cannot purchase more than 50 tickets in a single transaction'),
});

/**
 * Schema for validating direct peer-to-peer ticket transfer requests (POST /tickets/:id/transfer)
 */
export const transferTicketSchema = z
  .object({
    toUserId: z.string().uuid('A valid recipient user UUID is required').optional(),
    recipientEmail: z.string().email('A valid recipient email address is required').optional(),
  })
  .refine((data) => Boolean(data.toUserId || data.recipientEmail), {
    message: 'Either toUserId or recipientEmail must be provided to initiate transfer',
    path: ['toUserId'],
  });

/**
 * Schema for query parameter filtering when listing personal tickets (GET /tickets/me)
 */
export const listMyTicketsQuerySchema = z.object({
  status: z
    .enum(['AVAILABLE', 'OWNED', 'LISTED', 'USED', 'TRANSFERRED'], {
      errorMap: () => ({ message: 'Invalid ticket status filter' }),
    })
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
