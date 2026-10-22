import { z } from 'zod';
import { userRoleEnum } from './user.schema.js';
import { verificationStatusEnum } from './organizer.schema.js';
import { kycStatusEnum } from './buyer-seller.schema.js';

/**
 * Admin Model Schema
 * Platform operator with elevated management permissions.
 * Fields: id, name, email, role
 */
export const adminSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid().nullable().optional(),
  name: z.string().min(1, 'Name is required'),
  email: z.string().email('Valid email is required'),
  role: z.literal('ADMIN').default('ADMIN'),
  createdAt: z.coerce.date().optional(),
  updatedAt: z.coerce.date().optional(),
});

/**
 * Schema for creating a new Admin operator
 */
export const createAdminSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email('Valid email is required'),
  role: z.literal('ADMIN').optional().default('ADMIN'),
  userId: z.string().uuid().optional(),
});

/**
 * Schema for updating an Admin operator details
 */
export const updateAdminSchema = z.object({
  name: z.string().min(1, 'Name cannot be empty').optional(),
  email: z.string().email('Valid email is required').optional(),
});

/**
 * Schema for Admin User Management (PATCH /admin/users/:id)
 * - suspend / activate
 * - change role
 * - approve KYC
 */
export const adminManageUserSchema = z.object({
  role: userRoleEnum.optional(),
  isActive: z.boolean().optional(),
  kycStatus: kycStatusEnum.optional(),
});

/**
 * Schema for Admin Organizer Verification (PATCH /admin/organizers/:id/verify)
 */
export const adminVerifyOrganizerSchema = z.object({
  verificationStatus: verificationStatusEnum,
});

/**
 * Schema for Admin User Query (GET /admin/users)
 */
export const adminGetUsersQuerySchema = z.object({
  search: z.string().optional(),
  role: userRoleEnum.optional(),
  kycStatus: kycStatusEnum.optional(),
  isActive: z
    .preprocess((val) => {
      if (val === 'true' || val === true) return true;
      if (val === 'false' || val === false) return false;
      return undefined;
    }, z.boolean().optional()),
  page: z.preprocess((val) => (val !== undefined ? parseInt(val, 10) : 1), z.number().int().min(1).default(1)),
  limit: z.preprocess((val) => (val !== undefined ? parseInt(val, 10) : 20), z.number().int().min(1).max(100).default(20)),
});

/**
 * Schema for Admin Events Query (GET /admin/events)
 */
export const adminGetEventsQuerySchema = z.object({
  search: z.string().optional(),
  status: z.enum(['DRAFT', 'PUBLISHED', 'CANCELLED', 'COMPLETED']).optional(),
  organizerId: z.string().uuid().optional(),
  page: z.preprocess((val) => (val !== undefined ? parseInt(val, 10) : 1), z.number().int().min(1).default(1)),
  limit: z.preprocess((val) => (val !== undefined ? parseInt(val, 10) : 20), z.number().int().min(1).max(100).default(20)),
});

/**
 * Schema for Admin Event Management (PATCH /admin/events/:id)
 */
export const adminManageEventSchema = z.object({
  status: z.enum(['DRAFT', 'PUBLISHED', 'CANCELLED', 'COMPLETED']),
});

/**
 * Schema for creating Anti-Scalping Rule (POST /admin/rules/anti-scalping)
 */
export const createAntiScalpingRuleSchema = z
  .object({
    name: z.string().min(1, 'Rule name is required'),
    eventId: z.string().min(1, 'Event identifier is required'),
    categoryId: z.string().optional(),
    tier: z.string().optional(),
    maxResalePrice: z.coerce.number().positive('Max resale price must be positive').optional(),
    maxPrice: z.coerce.number().positive('Max price must be positive').optional(),
    enabled: z.boolean().default(true),
  })
  .refine((data) => data.maxResalePrice !== undefined || data.maxPrice !== undefined, {
    message: 'maxResalePrice or maxPrice must be provided',
  });

/**
 * Schema for updating Anti-Scalping Rule (PUT /admin/rules/anti-scalping/:id)
 */
export const updateAntiScalpingRuleSchema = z.object({
  name: z.string().min(1).optional(),
  maxResalePrice: z.coerce.number().positive().optional(),
  maxPrice: z.coerce.number().positive().optional(),
  enabled: z.boolean().optional(),
});

/**
 * Schema for updating Anti-Bot Rule (PUT /admin/rules/anti-bot)
 */
export const updateAntiBotRuleSchema = z.object({
  ordersPerMinute: z.coerce.number().int().positive().optional(),
  maxRequestsPerMinute: z.coerce.number().int().positive().optional(),
  burstLimit: z.coerce.number().int().positive().optional(),
  enabled: z.boolean().optional(),
});

export default adminSchema;
