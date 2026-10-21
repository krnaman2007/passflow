import { z } from 'zod';

/**
 * Monitoring Status Enum
 * Matching Prisma Schema: HEALTHY | DEGRADED | DOWN | INFO | WARNING | ERROR
 */
export const monitoringStatusEnum = z.enum([
  'HEALTHY',
  'DEGRADED',
  'DOWN',
  'INFO',
  'WARNING',
  'ERROR',
]);

/**
 * Monitoring Model Schema
 * System health and log tracking.
 * Fields: id, type, details, status, createdAt
 */
export const monitoringSchema = z.object({
  id: z.string().uuid(),
  type: z.string().min(1, 'Log type is required').max(100),
  details: z.union([z.record(z.any()), z.string()]).nullable().optional(),
  status: monitoringStatusEnum.default('HEALTHY'),
  createdAt: z.coerce.date().default(() => new Date()),
});

/**
 * Schema for recording a new monitoring or system log entry
 */
export const createMonitoringLogSchema = z.object({
  type: z.string().min(1, 'Type is required').max(100),
  details: z.union([z.record(z.any()), z.string()]).nullable().optional(),
  status: monitoringStatusEnum.optional().default('HEALTHY'),
});

/**
 * Schema for querying monitoring logs (GET /admin/monitoring/logs)
 */
export const queryMonitoringLogsSchema = z.object({
  type: z.string().optional(),
  status: monitoringStatusEnum.optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

/**
 * Schema for System Health Check response (GET /admin/monitoring/health)
 * Checks DB, Redis, WebSocket, and Matching Engine status
 */
export const systemHealthResponseSchema = z.object({
  status: monitoringStatusEnum,
  timestamp: z.coerce.date(),
  services: z.object({
    database: z.object({
      status: monitoringStatusEnum,
      latencyMs: z.number().optional(),
      message: z.string().optional(),
    }),
    redis: z.object({
      status: monitoringStatusEnum,
      message: z.string().optional(),
    }),
    websocket: z.object({
      status: monitoringStatusEnum,
      activeConnections: z.number().optional(),
    }),
    matchingEngine: z.object({
      status: monitoringStatusEnum,
      activeMarkets: z.number().optional(),
    }),
  }),
});

export default monitoringSchema;
