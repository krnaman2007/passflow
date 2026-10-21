import { z } from 'zod';

/**
 * Schema for validating event creation requests (POST /events)
 */
export const createEventSchema = z.object({
  name: z.string().trim().min(1, 'Event name is required').max(255),
  description: z.string().trim().optional(),
  dateTime: z.string().datetime({ message: 'A valid ISO date-time string is required' }),
  location: z.string().trim().min(1, 'Location is required').max(255),
  originalPrice: z.coerce.number().positive('Price must be greater than 0').optional(),
});

/**
 * Schema for validating event updates (PUT /events/:id)
 */
export const updateEventSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  description: z.string().trim().optional(),
  dateTime: z.string().datetime({ message: 'A valid ISO date-time string is required' }).optional(),
  location: z.string().trim().min(1).max(255).optional(),
  originalPrice: z.coerce.number().positive('Price must be greater than 0').optional(),
});

/**
 * Schema for updating event lifecycle status (PATCH /events/:id/status)
 */
export const updateEventStatusSchema = z.object({
  status: z.enum(['PUBLISHED', 'CANCELLED', 'COMPLETED'], {
    errorMap: () => ({ message: 'Status must be PUBLISHED, CANCELLED, or COMPLETED' }),
  }),
});

/**
 * Schema for creating a ticket category (POST /events/:id/categories)
 */
export const createCategorySchema = z.object({
  name: z.string().trim().min(1, 'Category name is required (e.g. VIP, General)'),
  originalPrice: z.coerce.number().positive('Ticket price must be greater than 0'),
  totalQuantity: z.coerce.number().int().positive('Total quantity must be at least 1'),
});

/**
 * Schema for updating ticket category details (PUT /categories/:id)
 */
export const updateCategorySchema = z.object({
  name: z.string().trim().min(1).optional(),
  originalPrice: z.coerce.number().positive('Price must be greater than 0').optional(),
});

/**
 * Schema for adjusting category inventory (PUT /categories/:id/inventory)
 */
export const updateInventorySchema = z.object({
  totalQuantity: z.coerce.number().int().min(0, 'Quantity cannot be negative'),
});
