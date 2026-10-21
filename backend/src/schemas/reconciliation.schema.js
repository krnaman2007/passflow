import { z } from 'zod';

/**
 * Reconciliation Status Enum
 * Matching Prisma Schema: PENDING | MATCHED | DISCREPANCY_FOUND | FAILED
 */
export const reconciliationStatusEnum = z.enum([
  'PENDING',
  'MATCHED',
  'DISCREPANCY_FOUND',
  'FAILED',
]);

/**
 * Reconciliation Model Schema
 * Compares ledger vs settlements to find mismatches.
 * Fields: id, date, status, reportUrl
 */
export const reconciliationSchema = z.object({
  id: z.string().uuid(),
  date: z.coerce.date().default(() => new Date()),
  status: reconciliationStatusEnum.default('PENDING'),
  reportUrl: z.string().url().nullable().optional(),
  createdAt: z.coerce.date().optional(),
  updatedAt: z.coerce.date().optional(),
});

/**
 * Schema for triggering a daily reconciliation run (POST /admin/reconciliation/run)
 */
export const runReconciliationSchema = z.object({
  date: z.coerce.date().optional(),
});

/**
 * Schema for updating a reconciliation record outcome
 */
export const updateReconciliationSchema = z.object({
  status: reconciliationStatusEnum.optional(),
  reportUrl: z.string().url().optional(),
});

/**
 * Schema for querying and filtering reconciliation reports (GET /admin/reconciliation)
 */
export const queryReconciliationSchema = z.object({
  status: reconciliationStatusEnum.optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export default reconciliationSchema;
