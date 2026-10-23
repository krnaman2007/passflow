import { z } from 'zod';

/**
 * Monetary amount validator for integer minor units (INR paise).
 * Rejects floats, negative values, zero, non-integers, and out-of-range numbers.
 */
const monetaryAmountSchema = z
  .union([
    z
      .number({ invalid_type_error: 'amount must be an integer (paise)' })
      .int('amount must be an integer (paise)')
      .positive('amount must be strictly positive'),
    z
      .string()
      .regex(/^[1-9]\d*$/, 'amount must be a positive integer in paise (minor units)'),
  ])
  .refine(
    (val) => {
      try {
        const b = BigInt(val);
        return b > 0n && b <= 9_000_000_000_000_000n;
      } catch {
        return false;
      }
    },
    { message: 'amount exceeds maximum allowable monetary limit' }
  );

/**
 * Zod schema for wallet deposit request body.
 * POST /api/v1/wallet/deposit
 */
export const depositWalletSchema = z
  .object({
    amount: monetaryAmountSchema,
    idempotencyKey: z
      .string()
      .min(1, 'idempotencyKey cannot be empty')
      .max(128, 'idempotencyKey must not exceed 128 characters')
      .optional(),
    description: z
      .string()
      .max(255, 'description must not exceed 255 characters')
      .optional(),
  })
  .strict();

/**
 * Zod schema for wallet withdrawal request body.
 * POST /api/v1/wallet/withdraw
 */
export const withdrawWalletSchema = z
  .object({
    amount: monetaryAmountSchema,
    idempotencyKey: z
      .string()
      .min(1, 'idempotencyKey cannot be empty')
      .max(128, 'idempotencyKey must not exceed 128 characters')
      .optional(),
    description: z
      .string()
      .max(255, 'description must not exceed 255 characters')
      .optional(),
  })
  .strict();

/**
 * Zod schema for querying paginated wallet transaction history.
 * GET /api/v1/wallet/transactions
 */
export const queryWalletTransactionsSchema = z
  .object({
    type: z.string().optional(),
    entryType: z.string().optional(),
    status: z.string().optional(),
    startDate: z
      .string()
      .optional()
      .refine((val) => !val || !isNaN(Date.parse(val)), {
        message: 'startDate must be a valid date or ISO string',
      }),
    endDate: z
      .string()
      .optional()
      .refine((val) => !val || !isNaN(Date.parse(val)), {
        message: 'endDate must be a valid date or ISO string',
      }),
    from: z
      .string()
      .optional()
      .refine((val) => !val || !isNaN(Date.parse(val)), {
        message: 'from must be a valid date or ISO string',
      }),
    to: z
      .string()
      .optional()
      .refine((val) => !val || !isNaN(Date.parse(val)), {
        message: 'to must be a valid date or ISO string',
      }),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
  })
  .refine(
    (data) => {
      const start = data.startDate || data.from;
      const end = data.endDate || data.to;
      if (start && end) {
        return new Date(start).getTime() <= new Date(end).getTime();
      }
      return true;
    },
    { message: 'startDate must be less than or equal to endDate', path: ['startDate'] }
  );

export default {
  depositWalletSchema,
  withdrawWalletSchema,
  queryWalletTransactionsSchema,
};
