import { jest, describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import app from '../src/app.js';
import prisma from '../src/db/prisma.js';
import notificationService from '../src/services/notification.service.js';
import rulesService from '../src/services/rules.service.js';
import dutchAuctionService from '../src/services/dutch-auction.service.js';
import monitoringService from '../src/services/monitoring.service.js';
import solvencyService from '../src/services/solvency.service.js';

describe('History, Notifications & Supporting Modules Endpoints & Services', () => {
  jest.setTimeout(30000);

  const timestamp = Date.now();
  const testUserReg = {
    name: 'History Test User',
    email: `history_${timestamp}@example.com`,
    password: 'Password123!',
    phone: '+919988776655',
  };

  let accessToken = null;
  let userId = null;
  let testNotificationId = null;

  beforeAll(async () => {
    // Register test user
    const regRes = await request(app)
      .post('/auth/register')
      .send(testUserReg)
      .expect(201);

    accessToken = regRes.body.data.tokens.accessToken;
    userId = regRes.body.data.user.id;
  });

  afterAll(async () => {
    if (userId) {
      await prisma.notification.deleteMany({ where: { userId } }).catch(() => {});
      await prisma.transactionHistory.deleteMany({ where: { userId } }).catch(() => {});
      await prisma.refreshToken.deleteMany({ where: { userId } }).catch(() => {});
      await prisma.buyerSeller.deleteMany({ where: { userId } }).catch(() => {});
      await prisma.wallet.deleteMany({ where: { userId } }).catch(() => {});
      await prisma.user.deleteMany({ where: { id: userId } }).catch(() => {});
    }
    await prisma.$disconnect();
  });

  describe('History Endpoints (/history)', () => {
    it('GET /history/transactions should reject unauthorized requests (401)', async () => {
      const res = await request(app).get('/history/transactions').expect(401);
      expect(res.body.success).toBe(false);
    });

    it('GET /history/transactions should return paginated transactions for authenticated user (200)', async () => {
      const res = await request(app)
        .get('/history/transactions')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data.transactions)).toBe(true);
      expect(res.body.data.pagination).toBeDefined();
      expect(res.body.data.pagination.page).toBe(1);
    });

    it('GET /history/orders should return past orders for user (200)', async () => {
      const res = await request(app)
        .get('/history/orders')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data.orders)).toBe(true);
      expect(res.body.data.pagination).toBeDefined();
    });

    it('GET /history/trades should return executed trades for user (200)', async () => {
      const res = await request(app)
        .get('/history/trades')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data.trades)).toBe(true);
      expect(res.body.data.pagination).toBeDefined();
    });
  });

  describe('Notification Endpoints (/notifications)', () => {
    it('NotificationService.send() should create notification for user', async () => {
      const notif = await notificationService.send(userId, {
        type: 'TRADE_FILLED',
        message: 'Your buy order was completely filled!',
      });

      expect(notif.id).toBeDefined();
      expect(notif.userId).toBe(userId);
      expect(notif.status).toBe('UNREAD');
      testNotificationId = notif.id;
    });

    it('GET /notifications should list notifications and unread count (200)', async () => {
      const res = await request(app)
        .get('/notifications')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data.notifications)).toBe(true);
      expect(res.body.data.unreadCount).toBeGreaterThanOrEqual(1);
      expect(res.body.data.notifications.some((n) => n.id === testNotificationId)).toBe(true);
    });

    it('PATCH /notifications/:id/read should mark notification as read (200)', async () => {
      const res = await request(app)
        .patch(`/notifications/${testNotificationId}/read`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('READ');
    });

    it('PATCH /notifications/:id/read should return 404 for unknown notification', async () => {
      const fakeId = '123e4567-e89b-12d3-a456-426614174099';
      await request(app)
        .patch(`/notifications/${fakeId}/read`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(404);
    });
  });

  describe('AntiScalpingRule & AntiBotRule Methods', () => {
    it('rulesService.validatePrice() should allow prices within cap and reject prices above cap', () => {
      // Pre-seeded rule Nightfall General has maxPrice 120
      const allowedOrder = { eventId: 'nightfall', price: 100, side: 'ASK' };
      expect(rulesService.validatePrice(allowedOrder, false)).toBe(true);

      const overpricedOrder = { eventId: 'nightfall', price: 250, side: 'ASK' };
      expect(rulesService.validatePrice(overpricedOrder, false)).toBe(false);

      expect(() => {
        rulesService.validatePrice(overpricedOrder, true);
      }).toThrow('exceeds anti-scalping price cap');
    });

    it('rulesService.check() should track and throttle bot requests when limit exceeded', () => {
      const botUserId = 'bot-user-1';
      // Default rate limit is 20
      for (let i = 0; i < 20; i++) {
        expect(rulesService.check(botUserId, 'ORDER_RATE_LIMIT', false)).toBe(true);
      }

      // 21st request should be throttled
      expect(rulesService.check(botUserId, 'ORDER_RATE_LIMIT', false)).toBe(false);
      expect(() => {
        rulesService.check(botUserId, 'ORDER_RATE_LIMIT', true);
      }).toThrow('Rate limit exceeded');
    });
  });

  describe('DutchAuction Service Methods', () => {
    it('dutchAuctionService.getCurrentPrice() should compute correct decay', async () => {
      const now = Date.now();
      const mockAuction = {
        id: 'auction-test-1',
        startPrice: 500,
        minPrice: 100,
        startTime: new Date(now - 1800000), // 30 min ago
        endTime: new Date(now + 1800000),   // 30 min in future (total 60 min, halfway = 300)
        status: 'ACTIVE',
      };

      const result = await dutchAuctionService.getCurrentPrice(mockAuction);
      expect(result.currentPrice).toBeGreaterThanOrEqual(290);
      expect(result.currentPrice).toBeLessThanOrEqual(310);
    });

    it('POST /auctions should reject unauthorized request without token (401)', async () => {
      await request(app).post('/auctions').send({}).expect(401);
    });

    it('POST /auctions should reject regular user without organizer profile (403)', async () => {
      const futureStart = new Date(Date.now() + 60000).toISOString();
      const futureEnd = new Date(Date.now() + 3600000).toISOString();
      await request(app)
        .post('/auctions')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          eventId: '123e4567-e89b-12d3-a456-426614174001',
          categoryId: '123e4567-e89b-12d3-a456-426614174002',
          startPrice: 500,
          minPrice: 100,
          startTime: futureStart,
          endTime: futureEnd,
        })
        .expect(403);
    });

    it('GET /auctions/:id should return 404 for non-existent auction', async () => {
      const fakeId = '123e4567-e89b-12d3-a456-426614174099';
      await request(app).get(`/auctions/${fakeId}`).expect(404);
    });

    it('GET /auctions/:id/price should return 404 for non-existent auction', async () => {
      const fakeId = '123e4567-e89b-12d3-a456-426614174099';
      await request(app).get(`/auctions/${fakeId}/price`).expect(404);
    });
  });

  describe('PerformanceMetrics & SolvencyProof Methods', () => {
    it('monitoringService.recordMetrics() and getReport() should compute summary', async () => {
      await monitoringService.recordMetrics({
        ordersPerSec: 60,
        avgLatency: 2.5,
        throughput: 1600,
        errorRate: 0.0005,
      });

      const report = await monitoringService.getReport();
      expect(report.summary).toBeDefined();
      expect(report.summary.ordersPerSec).toBeGreaterThan(0);
      expect(report.summary.avgLatency).toBeGreaterThan(0);
    });

    it('solvencyService.generateProof() and verify() should produce verified proof', async () => {
      const proof = await solvencyService.generateProof({
        backingAssets: 2000000,
        liabilities: 1000000,
        escrowBalance: 200000,
      });

      expect(proof.id).toBeDefined();
      expect(proof.isSolvent).toBe(true);
      expect(proof.ratio).toBe(2.0);

      const verification = solvencyService.verify();
      expect(verification.isSolvent).toBe(true);
      expect(verification.verified).toBe(true);
    });
  });
});
