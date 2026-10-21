import { jest } from '@jest/globals';
import prisma from '../../src/db/prisma.js';
import {
  monitoringSchema,
  monitoringStatusEnum,
  createMonitoringLogSchema,
  queryMonitoringLogsSchema,
  systemHealthResponseSchema,
} from '../../src/schemas/monitoring.schema.js';

describe('Monitoring Model & Zod Schema Validation', () => {
  jest.setTimeout(30000);

  const validRecordData = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    type: 'SYSTEM_HEALTH_CHECK',
    details: {
      dbLatencyMs: 14,
      redisConnected: true,
      activeSockets: 42,
    },
    status: 'HEALTHY',
    createdAt: new Date(),
  };

  let createdRecord1 = null;
  let createdRecord2 = null;

  afterAll(async () => {
    const ids = [createdRecord1?.id, createdRecord2?.id].filter(Boolean);
    if (ids.length > 0) {
      await prisma.monitoring.deleteMany({
        where: { id: { in: ids } },
      });
    }
    await prisma.$disconnect();
  });

  describe('Zod Schema Validations', () => {
    it('should validate a correct Monitoring model representation', () => {
      const parsed = monitoringSchema.safeParse(validRecordData);
      expect(parsed.success).toBe(true);
      expect(parsed.data.type).toBe('SYSTEM_HEALTH_CHECK');
      expect(parsed.data.status).toBe('HEALTHY');
      expect(parsed.data.details).toEqual(validRecordData.details);
    });

    it('should reject invalid UUIDs or invalid status', () => {
      const invalid = monitoringSchema.safeParse({
        id: 'bad-id',
        type: 'TEST',
        status: 'UNKNOWN_STATUS',
      });
      expect(invalid.success).toBe(false);
    });

    it('should validate createMonitoringLogSchema', () => {
      const parsed = createMonitoringLogSchema.safeParse({
        type: 'ERROR_SPIKE',
        details: { endpoint: '/orders', errorCount: 15 },
        status: 'WARNING',
      });
      expect(parsed.success).toBe(true);
      expect(parsed.data.status).toBe('WARNING');
    });

    it('should validate queryMonitoringLogsSchema with defaults and pagination', () => {
      const parsed = queryMonitoringLogsSchema.safeParse({
        type: 'SYSTEM_HEALTH_CHECK',
        status: 'HEALTHY',
        page: '2',
        limit: '15',
      });
      expect(parsed.success).toBe(true);
      expect(parsed.data.page).toBe(2);
      expect(parsed.data.limit).toBe(15);
    });

    it('should validate systemHealthResponseSchema', () => {
      const healthPayload = {
        status: 'HEALTHY',
        timestamp: new Date(),
        services: {
          database: { status: 'HEALTHY', latencyMs: 12 },
          redis: { status: 'HEALTHY' },
          websocket: { status: 'HEALTHY', activeConnections: 120 },
          matchingEngine: { status: 'HEALTHY', activeMarkets: 4 },
        },
      };

      const parsed = systemHealthResponseSchema.safeParse(healthPayload);
      expect(parsed.success).toBe(true);
      expect(parsed.data.services.database.status).toBe('HEALTHY');
    });
  });

  describe('Prisma Monitoring Model (Database Persistence)', () => {
    it('should create a Monitoring record in PostgreSQL with id, type, details, status, createdAt', async () => {
      createdRecord1 = await prisma.monitoring.create({
        data: {
          type: 'HEALTH_CHECK',
          details: { memoryUsageMb: 256, uptimeSec: 3600 },
          status: 'HEALTHY',
        },
      });

      expect(createdRecord1.id).toBeDefined();
      expect(createdRecord1.type).toBe('HEALTH_CHECK');
      expect(createdRecord1.status).toBe('HEALTHY');
      expect(createdRecord1.details).toBeDefined();
      expect(createdRecord1.createdAt).toBeInstanceOf(Date);
    });

    it('should create a second Monitoring record with warning status', async () => {
      createdRecord2 = await prisma.monitoring.create({
        data: {
          type: 'LATENCY_ALERT',
          details: { endpoint: '/api/v1/orders', avgLatencyMs: 350 },
          status: 'WARNING',
        },
      });

      expect(createdRecord2.id).toBeDefined();
      expect(createdRecord2.status).toBe('WARNING');
    });

    it('should query Monitoring records by type and status', async () => {
      const logs = await prisma.monitoring.findMany({
        where: {
          type: 'HEALTH_CHECK',
          status: 'HEALTHY',
        },
      });

      expect(logs.length).toBeGreaterThanOrEqual(1);
      expect(logs.some((l) => l.id === createdRecord1.id)).toBe(true);
    });

    it('should query Monitoring records by date range and ordering', async () => {
      const logs = await prisma.monitoring.findMany({
        where: {
          id: { in: [createdRecord1.id, createdRecord2.id] },
        },
        orderBy: { createdAt: 'desc' },
      });

      expect(logs.length).toBe(2);
      expect(logs[0].id).toBe(createdRecord2.id); // Most recent first
    });
  });
});
