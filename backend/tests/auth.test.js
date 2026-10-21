import { jest } from '@jest/globals';
import request from 'supertest';
import app from '../src/app.js';
import prisma from '../src/db/prisma.js';

describe('Authentication API Endpoints (/auth)', () => {
  jest.setTimeout(30000);

  const timestamp = Date.now();
  const testUser = {
    name: 'Auth Test User',
    email: `authtest_${timestamp}@example.com`,
    password: 'Password123!',
    phone: '+919876543210',
  };

  let registeredTokens = null;
  let loggedInTokens = null;
  let createdUserId = null;

  afterAll(async () => {
    // Clean up created test user and cascades (refresh tokens, wallet, buyerSeller)
    if (createdUserId) {
      await prisma.refreshToken.deleteMany({
        where: { userId: createdUserId },
      });
      await prisma.buyerSeller.deleteMany({
        where: { userId: createdUserId },
      });
      await prisma.wallet.deleteMany({
        where: { userId: createdUserId },
      });
      await prisma.user.deleteMany({
        where: { id: createdUserId },
      });
    }
    await prisma.$disconnect();
  });

  describe('POST /auth/register', () => {
    it('should register a new user, create a wallet, and return access + refresh tokens', async () => {
      const response = await request(app)
        .post('/auth/register')
        .send(testUser)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();

      const { user, tokens } = response.body.data;
      expect(user.id).toBeDefined();
      expect(user.email).toBe(testUser.email.toLowerCase());
      expect(user.name).toBe(testUser.name);
      expect(user.phone).toBe(testUser.phone);
      expect(user.walletId).toBeDefined();
      expect(user.wallet).toBeDefined();
      expect(user.wallet.availableBalance).toBe('0');
      expect(user.buyerSeller).toBeDefined();

      expect(tokens.accessToken).toBeDefined();
      expect(tokens.refreshToken).toBeDefined();
      expect(tokens.tokenType).toBe('Bearer');

      createdUserId = user.id;
      registeredTokens = tokens;
    });

    it('should reject registration with an existing email (409 Conflict)', async () => {
      const response = await request(app)
        .post('/auth/register')
        .send(testUser)
        .expect(409);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('EMAIL_EXISTS');
    });

    it('should reject registration with invalid email or short password (400 Bad Request)', async () => {
      const response = await request(app)
        .post('/auth/register')
        .send({
          name: 'Bad User',
          email: 'invalid-email',
          password: '123',
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('POST /auth/login', () => {
    it('should log in successfully with valid credentials and return tokens', async () => {
      const response = await request(app)
        .post('/auth/login')
        .send({
          email: testUser.email,
          password: testUser.password,
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      const { user, tokens } = response.body.data;
      expect(user.email).toBe(testUser.email.toLowerCase());
      expect(tokens.accessToken).toBeDefined();
      expect(tokens.refreshToken).toBeDefined();

      loggedInTokens = tokens;
    });

    it('should reject login with wrong password (401 Unauthorized)', async () => {
      const response = await request(app)
        .post('/auth/login')
        .send({
          email: testUser.email,
          password: 'WrongPassword123!',
        })
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('INVALID_CREDENTIALS');
    });

    it('should reject login with non-existent email (401 Unauthorized)', async () => {
      const response = await request(app)
        .post('/auth/login')
        .send({
          email: 'doesnotexist@example.com',
          password: 'Password123!',
        })
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('INVALID_CREDENTIALS');
    });
  });

  describe('POST /auth/refresh', () => {
    it('should issue a new access token from a valid refresh token', async () => {
      const response = await request(app)
        .post('/auth/refresh')
        .send({
          refreshToken: loggedInTokens.refreshToken,
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.accessToken).toBeDefined();
      expect(response.body.data.refreshToken).toBe(loggedInTokens.refreshToken);
    });

    it('should reject an invalid refresh token string (401 Unauthorized)', async () => {
      const response = await request(app)
        .post('/auth/refresh')
        .send({
          refreshToken: 'invalid.jwt.token',
        })
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('INVALID_REFRESH_TOKEN');
    });
  });

  describe('POST /auth/logout', () => {
    it('should reject logout without an access token (401 Unauthorized)', async () => {
      const response = await request(app)
        .post('/auth/logout')
        .send({
          refreshToken: loggedInTokens.refreshToken,
        })
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('UNAUTHORIZED');
    });

    it('should log out successfully and revoke the refresh token', async () => {
      const response = await request(app)
        .post('/auth/logout')
        .set('Authorization', `Bearer ${loggedInTokens.accessToken}`)
        .send({
          refreshToken: loggedInTokens.refreshToken,
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.message).toMatch(/logged out/i);
    });

    it('should not allow refreshing with a revoked refresh token (401 Unauthorized)', async () => {
      const response = await request(app)
        .post('/auth/refresh')
        .send({
          refreshToken: loggedInTokens.refreshToken,
        })
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('INVALID_REFRESH_TOKEN');
    });
  });
});
