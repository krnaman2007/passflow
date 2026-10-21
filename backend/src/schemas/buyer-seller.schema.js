import { z } from 'zod';

/**
 * KYC Status Enum
 * Matching Prisma Schema: PENDING | VERIFIED | REJECTED
 */
export const kycStatusEnum = z.enum(['PENDING', 'VERIFIED', 'REJECTED']);

/**
 * BuyerSeller Model Schema
 * Extra profile for trading users (1 User : 1 BuyerSeller).
 */
export const buyerSellerSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  kycStatus: kycStatusEnum.default('PENDING'),
  isActive: z.boolean().default(true),
  createdAt: z.coerce.date().optional(),
});

/**
 * Submit KYC Request Schema (POST /users/me/kyc)
 */
export const submitKycSchema = z.object({
  documentType: z.string().min(1, 'Document type is required').optional(),
  documentNumber: z.string().min(1, 'Document number is required').optional(),
});

/**
 * Update KYC / Trading Status Schema (Admin action)
 */
export const updateBuyerSellerStatusSchema = z.object({
  kycStatus: kycStatusEnum.optional(),
  isActive: z.boolean().optional(),
});

export default buyerSellerSchema;
