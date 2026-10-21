import { jest } from '@jest/globals';
import prisma from '../../src/db/prisma.js';
import auditLogService from '../../src/services/audit-log.service.js';
import {
  auditLogSchema,
  createAuditLogSchema,
  queryAuditLogsSchema,
} from '../../src/schemas/audit-log.schema.js';

describe('AuditLog Model & Zod Schema Validation', () => {
  jest.setTimeout(30000);

  const timestamp = Date.now();
  const validAuditLogData = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    adminId: '987fcdeb-51a2-43f7-9876-543210987654',
    action: 'SUSPEND_USER',
    details: { targetUserId: 'usr-123', reason: 'Suspicious bot activity' },
    timestamp: new Date(),
  };

  let testAdmin = null;
  let testLog1 = null;
  let testLog2 = null;

  beforeAll(async () => {
    // Create an Admin to own audit logs
    testAdmin = await prisma.admin.create({
      data: {
        name: 'Audit Officer',
        email: `audit_officer_${timestamp}@passflow.com`,
        role: 'ADMIN',
      },
    });
  });

  afterAll(async () => {
    if (testAdmin) {
      await prisma.auditLog.deleteMany({
        where: { adminId: testAdmin.id },
      });
      await prisma.admin.deleteMany({
        where: { id: testAdmin.id },
      });
    }
    await prisma.$disconnect();
  });

  describe('Zod Schema Validations', () => {
    it('should validate a correct AuditLog representation', () => {
      const parsed = auditLogSchema.safeParse(validAuditLogData);
      expect(parsed.success).toBe(true);
      expect(parsed.data.action).toBe('SUSPEND_USER');
      expect(parsed.data.details).toEqual(validAuditLogData.details);
    });

    it('should reject invalid UUIDs or missing action', () => {
      const invalid = auditLogSchema.safeParse({
        id: 'not-a-uuid',
        adminId: 'not-a-uuid',
        action: '',
      });
      expect(invalid.success).toBe(false);
    });

    it('should validate createAuditLogSchema', () => {
      const parsed = createAuditLogSchema.safeParse({
        adminId: validAuditLogData.adminId,
        action: 'VERIFY_ORGANIZER',
        details: { organizerId: 'org-456' },
      });
      expect(parsed.success).toBe(true);
      expect(parsed.data.action).toBe('VERIFY_ORGANIZER');
    });

    it('should validate queryAuditLogsSchema with defaults and pagination', () => {
      const parsed = queryAuditLogsSchema.safeParse({
        action: 'SUSPEND',
        page: '2',
        limit: '10',
      });
      expect(parsed.success).toBe(true);
      expect(parsed.data.page).toBe(2);
      expect(parsed.data.limit).toBe(10);
    });
  });

  describe('Prisma AuditLog Model (Database Persistence & Service)', () => {
    it('should append an audit log entry in PostgreSQL with id, adminId, action, details, timestamp', async () => {
      testLog1 = await auditLogService.logAction(
        testAdmin.id,
        'APPROVE_KYC',
        { targetUserId: 'buyer-seller-789', status: 'VERIFIED' }
      );

      expect(testLog1.id).toBeDefined();
      expect(testLog1.adminId).toBe(testAdmin.id);
      expect(testLog1.action).toBe('APPROVE_KYC');
      expect(testLog1.details).toBeDefined();
      expect(testLog1.details.status).toBe('VERIFIED');
      expect(testLog1.timestamp).toBeInstanceOf(Date);
      expect(testLog1.admin).toBeDefined();
      expect(testLog1.admin.email).toBe(testAdmin.email);
    });

    it('should append a second audit log entry', async () => {
      testLog2 = await auditLogService.logAction(
        testAdmin.id,
        'CANCEL_EVENT',
        { eventId: 'evt-999', reason: 'Venue unavailability' }
      );

      expect(testLog2.id).toBeDefined();
      expect(testLog2.action).toBe('CANCEL_EVENT');
    });

    it('should retrieve audit trail via getAuditLogs with filters and pagination', async () => {
      const result = await auditLogService.getAuditLogs({
        adminId: testAdmin.id,
        limit: 10,
      });

      expect(result.total).toBeGreaterThanOrEqual(2);
      expect(result.logs.length).toBeGreaterThanOrEqual(2);
      expect(result.logs[0].adminId).toBe(testAdmin.id);
    });

    it('should filter logs by action keyword', async () => {
      const result = await auditLogService.getAuditLogs({
        adminId: testAdmin.id,
        action: 'CANCEL_EVENT',
      });

      expect(result.total).toBe(1);
      expect(result.logs[0].action).toBe('CANCEL_EVENT');
    });

    it('should verify relation Admin.auditLogs from database', async () => {
      const adminWithLogs = await prisma.admin.findUnique({
        where: { id: testAdmin.id },
        include: { auditLogs: true },
      });

      expect(adminWithLogs).not.toBeNull();
      expect(adminWithLogs.auditLogs.length).toBeGreaterThanOrEqual(2);
    });
  });
});
