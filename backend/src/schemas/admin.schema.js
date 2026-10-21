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
 * Schema for Admin Event Management (PATCH /admin/events/:id)
 */
export const adminManageEventSchema = z.object({
  status: z.enum(['DRAFT', 'PUBLISHED', 'CANCELLED', 'COMPLETED']),
});

export default adminSchema;
