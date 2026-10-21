import { z } from 'zod';

/**
 * User Role Enum
 * Matching Prisma Schema: ORGANIZER | USER | ADMIN
 */
export const userRoleEnum = z.enum(['USER', 'ORGANIZER', 'ADMIN']);

/**
 * User Model Schema
 * Base account for every person on the platform (organizer or buyer/seller).
 */
export const userSchema = z.object({
  id: z.string().uuid(),
  name: z.string().nullable().optional(),
  email: z.string().email(),
  passwordHash: z.string(),
  phone: z.string().nullable().optional(),
  profile: z.string().nullable().optional(),
  walletId: z.string().nullable().optional(),
  role: userRoleEnum.default('USER'),
  createdAt: z.coerce.date().optional(),
  updatedAt: z.coerce.date().optional(),
});

/**
 * User Registration Validation Schema
 */
export const registerUserSchema = z.object({
  name: z.string().min(1, 'Name is required').optional(),
  email: z.string().email('Valid email is required'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  phone: z.string().optional(),
  role: userRoleEnum.optional().default('USER'),
});

/**
 * User Login Validation Schema
 */
export const loginUserSchema = z.object({
  email: z.string().email('Valid email is required'),
  password: z.string().min(1, 'Password is required'),
});

/**
 * Refresh Token Validation Schema
 */
export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

/**
 * Logout Validation Schema
 */
export const logoutSchema = z.object({
  refreshToken: z.string().optional(),
});

/**
 * Update Profile Validation Schema
 */
export const updateProfileSchema = z.object({
  name: z.string().min(1, 'Name cannot be empty').optional(),
  phone: z.string().optional(),
  profile: z.string().optional(),
});

/**
 * Change Password Validation Schema
 */
export const changePasswordSchema = z.object({
  oldPassword: z.string().min(1, 'Old password is required'),
  newPassword: z.string().min(6, 'New password must be at least 6 characters'),
});

export default userSchema;
