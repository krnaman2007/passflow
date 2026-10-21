import { z } from 'zod';

/**
 * AuditLog Model Schema
 * Append-only record of sensitive actions (Admin 1 : * logs).
 * Fields: id, adminId, action, details, timestamp
 */
export const auditLogSchema = z.object({
  id: z.string().uuid(),
  adminId: z.string().uuid('Valid adminId UUID is required'),
  action: z.string().min(1, 'Action description is required').max(100),
  details: z.union([z.record(z.any()), z.string()]).nullable().optional(),
  timestamp: z.coerce.date().default(() => new Date()),
});

/**
 * Schema for creating a new AuditLog entry
 */
export const createAuditLogSchema = z.object({
  adminId: z.string().uuid('Valid adminId UUID is required'),
  action: z.string().min(1, 'Action is required').max(100),
  details: z.union([z.record(z.any()), z.string()]).nullable().optional(),
});

/**
 * Schema for querying and filtering audit logs
 * (GET /admin/audit-logs)
 */
export const queryAuditLogsSchema = z.object({
  adminId: z.string().uuid().optional(),
  action: z.string().optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export default auditLogSchema;
