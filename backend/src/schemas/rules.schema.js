import { z } from 'zod';

/**
 * AntiBot Rule Status Enum
 * Matching Prisma Schema: ACTIVE | SUSPENDED | EXPIRED
 */
export const antiBotStatusEnum = z.enum(['ACTIVE', 'SUSPENDED', 'EXPIRED']);

/**
 * AntiScalpingRule Model Schema
 * Caps resale price per category.
 * Fields: id, eventId, categoryId, maxResalePrice, isActive
 */
export const antiScalpingRuleSchema = z.object({
  id: z.string(),
  eventId: z.string().min(1, 'Event ID is required'),
  categoryId: z.string().nullable().optional(),
  maxResalePrice: z.coerce.number().positive('Max resale price must be positive'),
  isActive: z.boolean().default(true),
  createdAt: z.coerce.date().optional(),
  updatedAt: z.coerce.date().optional(),
});

/**
 * AntiBotRule Model Schema
 * Rate limits / bot protection per user or rule type.
 * Fields: id, userId, ruleType, limit, status
 */
export const antiBotRuleSchema = z.object({
  id: z.string(),
  userId: z.string().uuid().nullable().optional(),
  ruleType: z.string().min(1, 'Rule type is required'),
  limit: z.coerce.number().int().positive('Limit must be a positive integer'),
  status: antiBotStatusEnum.default('ACTIVE'),
  createdAt: z.coerce.date().optional(),
  updatedAt: z.coerce.date().optional(),
});

export default {
  antiScalpingRuleSchema,
  antiBotRuleSchema,
  antiBotStatusEnum,
};
