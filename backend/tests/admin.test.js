import { jest } from '@jest/globals';
import request from 'supertest';
import app from '../src/app.js';
import prisma from '../src/db/prisma.js';

describe('Admin Management API Endpoints (/admin)', () => {
  jest.setTimeout(30000);

  const timestamp = Date.now();
  let adminToken = null;
  let adminUserId = null;
  let userToken = null;
  let regularUserId = null;
  let organizerId = null;

  beforeAll(async () => {
    // 1. Create a regular user
    const regRes = await request(app)
      .post('/auth/register')
      .send({
        name: 'Regular Test User',
        email: `reguser_${timestamp}@example.com`,
        password: 'Password123!',
        phone: '+919988112233',
      })
      .expect(201);

    userToken = regRes.body.data.tokens.accessToken;
    regularUserId = regRes.body.data.user.id;

    // 2. Create an admin user
    const adminRegRes = await request(app)
      .post('/auth/register')
      .send({
        name: 'Admin Test Operator',
        email: `admin_${timestamp}@example.com`,
        password: 'AdminPassword123!',
        phone: '+919988445566',
      })
      .expect(201);

    adminUserId = adminRegRes.body.data.user.id;

    // Elevate admin user to ADMIN role in database
    await prisma.user.update({
      where: { id: adminUserId },
      data: { role: 'ADMIN' },
    });

    // Login to get token with ADMIN role in payload
    const loginRes = await request(app)
      .post('/auth/login')
      .send({
        email: `admin_${timestamp}@example.com`,
        password: 'AdminPassword123!',
      })
      .expect(200);

    adminToken = loginRes.body.data.tokens.accessToken;

    // 3. Create an organizer application for regular user
    const orgRes = await request(app)
      .post('/organizers/apply')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ organizationName: 'Admin Test Promotions' })
      .expect(201);

    organizerId = orgRes.body.data.organizer.id;
  });

  afterAll(async () => {
    if (regularUserId) {
      await prisma.refreshToken.deleteMany({ where: { userId: regularUserId } });
      await prisma.organizer.deleteMany({ where: { userId: regularUserId } });
      await prisma.buyerSeller.deleteMany({ where: { userId: regularUserId } });
      await prisma.wallet.deleteMany({ where: { userId: regularUserId } });
      await prisma.user.deleteMany({ where: { id: regularUserId } });
    }

    if (adminUserId) {
      await prisma.refreshToken.deleteMany({ where: { userId: adminUserId } });
      await prisma.buyerSeller.deleteMany({ where: { userId: adminUserId } });
      await prisma.wallet.deleteMany({ where: { userId: adminUserId } });
      await prisma.user.deleteMany({ where: { id: adminUserId } });
    }

    await prisma.$disconnect();
  });

  describe('GET /admin/users', () => {
    it('should reject request without authentication (401 Unauthorized)', async () => {
      const res = await request(app).get('/admin/users').expect(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('should reject non-admin users (403 Forbidden)', async () => {
      const res = await request(app)
        .get('/admin/users')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(403);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('should return list of users with pagination for admin', async () => {
      const res = await request(app)
        .get('/admin/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data.users)).toBe(true);
      expect(res.body.data.pagination).toBeDefined();
      expect(res.body.data.users.length).toBeGreaterThan(0);
    });

    it('should filter users by search query', async () => {
      const res = await request(app)
        .get(`/admin/users?search=admin_${timestamp}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.users.length).toBe(1);
      expect(res.body.data.users[0].id).toBe(adminUserId);
    });
  });

  describe('PATCH /admin/users/:id', () => {
    it('should reject non-admin caller (403 Forbidden)', async () => {
      const res = await request(app)
        .patch(`/admin/users/${regularUserId}`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({ isActive: false })
        .expect(403);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('should return 404 for nonexistent user ID', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';
      const res = await request(app)
        .patch(`/admin/users/${fakeId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ isActive: false })
        .expect(404);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('USER_NOT_FOUND');
    });

    it('should update user kycStatus and isActive (suspend / approve KYC)', async () => {
      const res = await request(app)
        .patch(`/admin/users/${regularUserId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          kycStatus: 'VERIFIED',
          isActive: true,
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.user.buyerSeller.kycStatus).toBe('VERIFIED');
      expect(res.body.data.user.buyerSeller.isActive).toBe(true);
    });

    it('should suspend user (isActive: false)', async () => {
      const res = await request(app)
        .patch(`/admin/users/${regularUserId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ isActive: false })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.user.buyerSeller.isActive).toBe(false);
    });
  });

  describe('PATCH /admin/organizers/:id/verify', () => {
    it('should reject non-admin caller (403 Forbidden)', async () => {
      const res = await request(app)
        .patch(`/admin/organizers/${organizerId}/verify`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({ verificationStatus: 'VERIFIED' })
        .expect(403);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('should return 404 for nonexistent organizer', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';
      const res = await request(app)
        .patch(`/admin/organizers/${fakeId}/verify`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ verificationStatus: 'VERIFIED' })
        .expect(404);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('ORGANIZER_NOT_FOUND');
    });

    it('should verify organizer application and elevate user role', async () => {
      const res = await request(app)
        .patch(`/admin/organizers/${organizerId}/verify`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ verificationStatus: 'VERIFIED' })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.organizer.verificationStatus).toBe('VERIFIED');
    });

    it('should reject organizer application when requested', async () => {
      const res = await request(app)
        .patch(`/admin/organizers/${organizerId}/verify`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ verificationStatus: 'REJECTED' })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.organizer.verificationStatus).toBe('REJECTED');
    });
  });
});
