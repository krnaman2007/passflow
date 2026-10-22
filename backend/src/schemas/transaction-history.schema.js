import { z } from 'zod';

/**
 * TransactionHistory Model Schema
 * Read model of a user's financial history.
 * Fields: id, userId, type, amount, status, createdAt
 */
export const transactionHistorySchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  type: z.string().min(1, 'Transaction type is required'),
  amount: z.coerce.number().positive('Amount must be positive'),
  status: z.string().default('COMPLETED'),
  createdAt: z.coerce.date().default(() => new Date()),
});

/**
 * Schema for querying paginated transaction history
 */
export const queryTransactionHistorySchema = z.object({
  type: z.string().optional(),
  status: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export default transactionHistorySchema;
