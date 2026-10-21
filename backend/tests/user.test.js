import { jest } from '@jest/globals';
import request from 'supertest';
import app from '../src/app.js';
import prisma from '../src/db/prisma.js';

describe('User Management API Endpoints (/users/me)', () => {
  jest.setTimeout(30000);

  const timestamp = Date.now();
  const initialPassword = 'Password123!';
  const updatedPassword = 'NewPassword456!';
  const userRegistration = {
    name: 'Profile Test User',
    email: `usertest_${timestamp}@example.com`,
    password: initialPassword,
    phone: '+919988776655',
  };

  let accessToken = null;
  let userId = null;

  beforeAll(async () => {
    // Register user via auth endpoint
    const regRes = await request(app)
      .post('/auth/register')
      .send(userRegistration)
      .expect(201);

    accessToken = regRes.body.data.tokens.accessToken;
    userId = regRes.body.data.user.id;
  });

  afterAll(async () => {
    if (userId) {
      await prisma.refreshToken.deleteMany({ where: { userId } });
      await prisma.buyerSeller.deleteMany({ where: { userId } });
      await prisma.wallet.deleteMany({ where: { userId } });
      await prisma.user.deleteMany({ where: { id: userId } });
    }
    await prisma.$disconnect();
  });

  describe('GET /users/me', () => {
    it('should reject request without bearer token (401 Unauthorized)', async () => {
      const response = await request(app)
        .get('/users/me')
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('UNAUTHORIZED');
    });

    it('should return current user profile with role and wallet summary', async () => {
      const response = await request(app)
        .get('/users/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      const user = response.body.data;
      expect(user.id).toBe(userId);
      expect(user.email).toBe(userRegistration.email.toLowerCase());
      expect(user.name).toBe(userRegistration.name);
      expect(user.role).toBe('USER');
      expect(user.walletId).toBeDefined();

      // Wallet summary
      expect(user.wallet).toBeDefined();
      expect(user.wallet.availableBalance).toBe('0');
      expect(user.wallet.reservedBalance).toBe('0');
      expect(user.wallet.currency).toBe('INR');

      // Sub-profile
      expect(user.buyerSeller).toBeDefined();
      expect(user.buyerSeller.kycStatus).toBe('PENDING');
      expect(user.passwordHash).toBeUndefined();
    });
  });

  describe('PUT /users/me', () => {
    it('should update profile name, phone, and profile text', async () => {
      const updatePayload = {
        name: 'Updated Name',
        phone: '+911122334455',
        profile: 'Senior ticket enthusiast and event collector',
      };

      const response = await request(app)
        .put('/users/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(updatePayload)
        .expect(200);

      expect(response.body.success).toBe(true);
      const updatedUser = response.body.data;
      expect(updatedUser.name).toBe(updatePayload.name);
      expect(updatedUser.phone).toBe(updatePayload.phone);
      expect(updatedUser.profile).toBe(updatePayload.profile);
      expect(updatedUser.wallet).toBeDefined();
    });

    it('should reject invalid profile updates (400 Bad Request)', async () => {
      const response = await request(app)
        .put('/users/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          name: '', // Empty name rejected by schema
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('PUT /users/me/password', () => {
    it('should reject change password if old password does not match (400 Bad Request)', async () => {
      const response = await request(app)
        .put('/users/me/password')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          oldPassword: 'IncorrectPassword!',
          newPassword: updatedPassword,
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('INVALID_PASSWORD');
    });

    it('should reject change password if new password is too short (400 Bad Request)', async () => {
      const response = await request(app)
        .put('/users/me/password')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          oldPassword: initialPassword,
          newPassword: '123',
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should change password successfully', async () => {
      const response = await request(app)
        .put('/users/me/password')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          oldPassword: initialPassword,
          newPassword: updatedPassword,
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.message).toMatch(/password changed successfully/i);

      // Verify that login works with new password
      const loginRes = await request(app)
        .post('/auth/login')
        .send({
          email: userRegistration.email,
          password: updatedPassword,
        })
        .expect(200);

      expect(loginRes.body.success).toBe(true);
      accessToken = loginRes.body.data.tokens.accessToken;
    });
  });

  describe('POST /users/me/kyc', () => {
    it('should submit KYC details and set kycStatus to PENDING', async () => {
      const kycPayload = {
        documentType: 'PASSPORT',
        documentNumber: 'A12345678',
      };

      const response = await request(app)
        .post('/users/me/kyc')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(kycPayload)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.message).toMatch(/kyc details submitted/i);
      expect(response.body.data.buyerSeller).toBeDefined();
      expect(response.body.data.buyerSeller.kycStatus).toBe('PENDING');
      expect(response.body.data.buyerSeller.userId).toBe(userId);
    });
  });
});
