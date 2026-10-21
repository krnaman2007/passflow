import { z } from 'zod';

/**
 * Verification Status Enum
 * Matching Prisma Schema: PENDING | VERIFIED | REJECTED
 */
export const verificationStatusEnum = z.enum(['PENDING', 'VERIFIED', 'REJECTED']);

/**
 * Organizer Model Schema
 * Extra profile for users who create events (1 User : 0..1 Organizer).
 */
export const organizerSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  organizationName: z.string().min(1, 'Organization name is required'),
  verificationStatus: verificationStatusEnum.default('PENDING'),
  createdAt: z.coerce.date().optional(),
});

/**
 * Schema for applying / creating an Organizer profile
 * (POST /organizers/apply)
 */
export const applyOrganizerSchema = z.object({
  organizationName: z.string().min(2, 'Organization name must be at least 2 characters').max(100),
});

/**
 * Schema for updating Organizer verification status (Admin action)
 */
export const updateOrganizerStatusSchema = z.object({
  verificationStatus: verificationStatusEnum,
});

export default organizerSchema;
