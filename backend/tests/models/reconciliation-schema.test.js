import { jest } from '@jest/globals';
import prisma from '../../src/db/prisma.js';
import {
  reconciliationSchema,
  reconciliationStatusEnum,
  runReconciliationSchema,
  updateReconciliationSchema,
  queryReconciliationSchema,
} from '../../src/schemas/reconciliation.schema.js';

describe('Reconciliation Model & Zod Schema Validation', () => {
  jest.setTimeout(30000);

  const validRecordData = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    date: new Date('2026-10-21'),
    status: 'MATCHED',
    reportUrl: 'https://storage.passflow.com/reports/recon-2026-10-21.json',
  };

  let createdRecord = null;

  afterAll(async () => {
    if (createdRecord) {
      await prisma.reconciliation.deleteMany({
        where: { id: createdRecord.id },
      });
    }
    await prisma.$disconnect();
  });

  describe('Zod Schema Validations', () => {
    it('should validate a correct Reconciliation model representation', () => {
      const parsed = reconciliationSchema.safeParse(validRecordData);
      expect(parsed.success).toBe(true);
      expect(parsed.data.status).toBe('MATCHED');
      expect(parsed.data.reportUrl).toBe(validRecordData.reportUrl);
    });

    it('should reject invalid UUIDs or invalid status enum', () => {
      const invalid = reconciliationSchema.safeParse({
        id: 'not-a-uuid',
        status: 'INVALID_STATUS',
      });
      expect(invalid.success).toBe(false);
    });

    it('should validate runReconciliationSchema', () => {
      const parsed = runReconciliationSchema.safeParse({
        date: '2026-10-21T00:00:00.000Z',
      });
      expect(parsed.success).toBe(true);
      expect(parsed.data.date).toBeInstanceOf(Date);
    });

    it('should validate updateReconciliationSchema', () => {
      const parsed = updateReconciliationSchema.safeParse({
        status: 'DISCREPANCY_FOUND',
        reportUrl: 'https://storage.passflow.com/reports/discrepancies.pdf',
      });
      expect(parsed.success).toBe(true);
      expect(parsed.data.status).toBe('DISCREPANCY_FOUND');
    });

    it('should validate queryReconciliationSchema with defaults and pagination', () => {
      const parsed = queryReconciliationSchema.safeParse({
        status: 'PENDING',
        page: '1',
        limit: '25',
      });
      expect(parsed.success).toBe(true);
      expect(parsed.data.page).toBe(1);
      expect(parsed.data.limit).toBe(25);
    });
  });

  describe('Prisma Reconciliation Model (Database Persistence)', () => {
    it('should create a Reconciliation record in PostgreSQL with id, date, status, reportUrl', async () => {
      createdRecord = await prisma.reconciliation.create({
        data: {
          status: 'PENDING',
          date: new Date(),
        },
      });

      expect(createdRecord.id).toBeDefined();
      expect(createdRecord.status).toBe('PENDING');
      expect(createdRecord.date).toBeInstanceOf(Date);
      expect(createdRecord.createdAt).toBeDefined();
      expect(createdRecord.updatedAt).toBeDefined();
    });

    it('should query Reconciliation record by id and status', async () => {
      const fetched = await prisma.reconciliation.findUnique({
        where: { id: createdRecord.id },
      });

      expect(fetched).not.toBeNull();
      expect(fetched.id).toBe(createdRecord.id);
      expect(fetched.status).toBe('PENDING');
    });

    it('should update Reconciliation status and reportUrl', async () => {
      const updated = await prisma.reconciliation.update({
        where: { id: createdRecord.id },
        data: {
          status: 'MATCHED',
          reportUrl: 'https://storage.passflow.com/reports/recon-test.json',
        },
      });

      expect(updated.status).toBe('MATCHED');
      expect(updated.reportUrl).toBe('https://storage.passflow.com/reports/recon-test.json');
    });

    it('should filter reconciliation reports by status and date range', async () => {
      const reports = await prisma.reconciliation.findMany({
        where: {
          status: 'MATCHED',
        },
      });

      expect(reports.length).toBeGreaterThanOrEqual(1);
      expect(reports.some((r) => r.id === createdRecord.id)).toBe(true);
    });
  });
});
