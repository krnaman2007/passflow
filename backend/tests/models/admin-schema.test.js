import { jest } from '@jest/globals';
import prisma from '../../src/db/prisma.js';
import {
  adminSchema,
  createAdminSchema,
  updateAdminSchema,
  adminManageUserSchema,
} from '../../src/schemas/admin.schema.js';

describe('Admin Model & Zod Schema Validation', () => {
  jest.setTimeout(30000);

  const timestamp = Date.now();
  const validAdminData = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    name: 'Master Operator',
    email: `admin_${timestamp}@passflow.com`,
    role: 'ADMIN',
  };

  let createdAdmin = null;
  let linkedUser = null;

  afterAll(async () => {
    if (createdAdmin) {
      await prisma.admin.deleteMany({
        where: { id: createdAdmin.id },
      });
    }
    if (linkedUser) {
      await prisma.user.deleteMany({
        where: { id: linkedUser.id },
      });
    }
    await prisma.$disconnect();
  });

  describe('Zod Schema Validations', () => {
    it('should validate a correct Admin model representation', () => {
      const parsed = adminSchema.safeParse(validAdminData);
      expect(parsed.success).toBe(true);
      expect(parsed.data.name).toBe(validAdminData.name);
      expect(parsed.data.role).toBe('ADMIN');
    });

    it('should reject invalid email or non-UUID id', () => {
      const invalid = adminSchema.safeParse({
        id: 'invalid-uuid',
        name: 'Bad Admin',
        email: 'not-an-email',
        role: 'ADMIN',
      });
      expect(invalid.success).toBe(false);
    });

    it('should validate createAdminSchema defaults', () => {
      const parsed = createAdminSchema.safeParse({
        name: 'New Operator',
        email: 'operator@passflow.com',
      });
      expect(parsed.success).toBe(true);
      expect(parsed.data.role).toBe('ADMIN');
    });

    it('should validate admin user management schema', () => {
      const parsed = adminManageUserSchema.safeParse({
        role: 'ORGANIZER',
        isActive: false,
        kycStatus: 'VERIFIED',
      });
      expect(parsed.success).toBe(true);
      expect(parsed.data.kycStatus).toBe('VERIFIED');
    });
  });

  describe('Prisma Admin Model (Database Persistence)', () => {
    it('should create an Admin record in PostgreSQL with id, name, email, and role', async () => {
      createdAdmin = await prisma.admin.create({
        data: {
          name: validAdminData.name,
          email: validAdminData.email,
          role: 'ADMIN',
        },
      });

      expect(createdAdmin.id).toBeDefined();
      expect(createdAdmin.name).toBe(validAdminData.name);
      expect(createdAdmin.email).toBe(validAdminData.email);
      expect(createdAdmin.role).toBe('ADMIN');
      expect(createdAdmin.createdAt).toBeDefined();
      expect(createdAdmin.updatedAt).toBeDefined();
    });

    it('should query the created Admin by unique email', async () => {
      const fetched = await prisma.admin.findUnique({
        where: { email: validAdminData.email },
      });

      expect(fetched).not.toBeNull();
      expect(fetched.id).toBe(createdAdmin.id);
      expect(fetched.name).toBe(validAdminData.name);
      expect(fetched.role).toBe('ADMIN');
    });

    it('should update Admin operator details', async () => {
      const updated = await prisma.admin.update({
        where: { id: createdAdmin.id },
        data: { name: 'Senior Platform Operator' },
      });

      expect(updated.name).toBe('Senior Platform Operator');
    });

    it('should link Admin record with User relation', async () => {
      linkedUser = await prisma.user.create({
        data: {
          email: `admin_user_${timestamp}@passflow.com`,
          passwordHash: 'dummy-hash',
          name: 'Admin User Account',
          role: 'ADMIN',
        },
      });

      const linkedAdmin = await prisma.admin.create({
        data: {
          userId: linkedUser.id,
          name: linkedUser.name,
          email: `linked_${timestamp}@passflow.com`,
          role: 'ADMIN',
        },
        include: {
          user: true,
        },
      });

      expect(linkedAdmin.userId).toBe(linkedUser.id);
      expect(linkedAdmin.user).toBeDefined();
      expect(linkedAdmin.user.email).toBe(linkedUser.email);

      // Clean up linkedAdmin
      await prisma.admin.delete({
        where: { id: linkedAdmin.id },
      });
    });
  });
});
