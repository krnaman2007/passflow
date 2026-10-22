import { jest } from '@jest/globals';
import request from 'supertest';
import app from '../src/app.js';
import prisma from '../src/db/prisma.js';

describe('Market Data API (/market)', () => {
  jest.setTimeout(120000);

  const timestamp = Date.now();
  let organizerUserId = null;
  let organizerId = null;
  let eventId = null;
  let categoryId = null;
  let buyerUserId = null;
  let sellerUserId = null;
  let bidOrderId = null;
  let askOrderId = null;
  let executionId = null;

  beforeAll(async () => {
    // 1. Create an organizer user
    const organizerUser = await prisma.user.create({
      data: {
        name: 'Market Organizer',
        email: `market_org_${timestamp}@example.com`,
        passwordHash: '$2a$10$abcdefghijklmnopqrstuu',
        phone: `+919911${String(timestamp).slice(-6)}`,
        role: 'ORGANIZER',
      },
    });
    organizerUserId = organizerUser.id;

    // 2. Create organizer profile
    const organizer = await prisma.organizer.create({
      data: {
        userId: organizerUserId,
        organizationName: `Market Promotions ${timestamp}`,
        verificationStatus: 'VERIFIED',
      },
    });
    organizerId = organizer.id;

    // 3. Create Event
    const event = await prisma.event.create({
      data: {
        name: `Market Test Event ${timestamp}`,
        description: 'Test event for market data testing',
        dateTime: new Date(Date.now() + 86400000),
        location: 'Bengaluru Tech Arena',
        organizerId: organizerId,
        status: 'PUBLISHED',
        originalPrice: 2000,
      },
    });
    eventId = event.id;

    // 4. Create Ticket Category
    const category = await prisma.ticketCategory.create({
      data: {
        eventId: eventId,
        name: 'VIP Pavilion',
        originalPrice: 2000,
        totalQuantity: 100,
        availableQuantity: 100,
        status: 'ACTIVE',
      },
    });
    categoryId = category.id;

    // 5. Create Buyer & Seller users
    const buyer = await prisma.user.create({
      data: {
        name: 'Market Buyer',
        email: `buyer_${timestamp}@example.com`,
        passwordHash: '$2a$10$abcdefghijklmnopqrstuu',
        phone: `+919811${String(timestamp).slice(-6)}`,
        role: 'USER',
      },
    });
    buyerUserId = buyer.id;

    const seller = await prisma.user.create({
      data: {
        name: 'Market Seller',
        email: `seller_${timestamp}@example.com`,
        passwordHash: '$2a$10$abcdefghijklmnopqrstuu',
        phone: `+919711${String(timestamp).slice(-6)}`,
        role: 'USER',
      },
    });
    sellerUserId = seller.id;

    // 6. Create resting BID order (e.g. price 1900, qty 2)
    const bidOrder = await prisma.order.create({
      data: {
        userId: buyerUserId,
        eventId: eventId,
        ticketCategoryId: categoryId,
        side: 'BID',
        status: 'OPEN',
        price: 1900,
        initialQuantity: 2,
        remainingQuantity: 2,
      },
    });
    bidOrderId = bidOrder.id;

    // 7. Create resting ASK order (e.g. price 2100, qty 3)
    const askOrder = await prisma.order.create({
      data: {
        userId: sellerUserId,
        eventId: eventId,
        ticketCategoryId: categoryId,
        side: 'ASK',
        status: 'OPEN',
        price: 2100,
        initialQuantity: 3,
        remainingQuantity: 3,
      },
    });
    askOrderId = askOrder.id;

    // 8. Create an execution (trade) between buyer and seller (e.g. price 2050, qty 1)
    const execOrder1 = await prisma.order.create({
      data: {
        userId: buyerUserId,
        eventId: eventId,
        ticketCategoryId: categoryId,
        side: 'BID',
        status: 'FILLED',
        price: 2050,
        initialQuantity: 1,
        remainingQuantity: 0,
      },
    });

    const execOrder2 = await prisma.order.create({
      data: {
        userId: sellerUserId,
        eventId: eventId,
        ticketCategoryId: categoryId,
        side: 'ASK',
        status: 'FILLED',
        price: 2050,
        initialQuantity: 1,
        remainingQuantity: 0,
      },
    });

    const execution = await prisma.execution.create({
      data: {
        incomingOrderId: execOrder1.id,
        restingOrderId: execOrder2.id,
        price: 2050,
        quantity: 1,
      },
    });
    executionId = execution.id;
  }, 120000);

  afterAll(async () => {
    // Cleanup in reverse dependency order
    if (executionId) {
      await prisma.execution.deleteMany({
        where: { id: executionId },
      });
    }

    if (eventId && categoryId) {
      await prisma.order.deleteMany({
        where: { eventId, ticketCategoryId: categoryId },
      });
      await prisma.ticketCategory.deleteMany({
        where: { id: categoryId },
      });
      await prisma.event.deleteMany({
        where: { id: eventId },
      });
    }

    if (organizerId) {
      await prisma.organizer.deleteMany({
        where: { id: organizerId },
      });
    }

    const userIds = [organizerUserId, buyerUserId, sellerUserId].filter(Boolean);
    if (userIds.length > 0) {
      await prisma.refreshToken.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.wallet.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.buyerSeller.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }

    await prisma.$disconnect();
  }, 120000);

  describe('GET /market/:eventId/:categoryId', () => {
    it('should return 404 when event does not exist', async () => {
      const res = await request(app)
        .get(`/market/00000000-0000-0000-0000-000000000000/${categoryId}`)
        .expect(404);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('EVENT_NOT_FOUND');
    });

    it('should return 404 when ticket category does not exist for event', async () => {
      const res = await request(app)
        .get(`/market/${eventId}/00000000-0000-0000-0000-000000000000`)
        .expect(404);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('CATEGORY_NOT_FOUND');
    });

    it('should return MarketData snapshot for public caller (200 OK)', async () => {
      const res = await request(app)
        .get(`/market/${eventId}/${categoryId}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      const data = res.body.data;
      expect(data).toBeDefined();
      expect(data.id).toBe(`${eventId}:${categoryId}`);
      expect(data.eventId).toBe(eventId);
      expect(data.categoryId).toBe(categoryId);
      expect(data.bestBid).toBe(1900);
      expect(data.bestAsk).toBe(2100);
      expect(data.lastPrice).toBe(2050);
      expect(data.volume).toBe(1);
      expect(data.spread).toBe(200);
      expect(data.updatedAt).toBeDefined();
    });

    it('should support /api/v1/market/:eventId/:categoryId alias route (200 OK)', async () => {
      const res = await request(app)
        .get(`/api/v1/market/${eventId}/${categoryId}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.bestBid).toBe(1900);
      expect(res.body.data.bestAsk).toBe(2100);
      expect(res.body.data.lastPrice).toBe(2050);
    });
  });
});
