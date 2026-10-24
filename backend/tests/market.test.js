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
    // Ensure DB connection is active (Neon serverless wake-up retry)
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await prisma.$queryRaw`SELECT 1`;
        break;
      } catch (e) {
        if (attempt === 3) throw e;
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }

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

  describe('GET /market/:eventId/:categoryId/depth', () => {
    it('should return 404 when event does not exist', async () => {
      const res = await request(app)
        .get(`/market/00000000-0000-0000-0000-000000000000/${categoryId}/depth`)
        .expect(404);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('EVENT_NOT_FOUND');
    });

    it('should return 404 when ticket category does not exist for event', async () => {
      const res = await request(app)
        .get(`/market/${eventId}/00000000-0000-0000-0000-000000000000/depth`)
        .expect(404);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('CATEGORY_NOT_FOUND');
    });

    it('should return aggregated MarketDepth price levels (200 OK)', async () => {
      const res = await request(app)
        .get(`/market/${eventId}/${categoryId}/depth`)
        .expect(200);

      expect(res.body.success).toBe(true);
      const data = res.body.data;
      expect(data).toBeDefined();
      expect(data.id).toBe(`${eventId}:${categoryId}`);
      expect(Array.isArray(data.bids)).toBe(true);
      expect(Array.isArray(data.asks)).toBe(true);
      expect(data.bids.length).toBeGreaterThan(0);
      expect(data.asks.length).toBeGreaterThan(0);

      // Verify bid price level
      const topBid = data.bids[0];
      expect(topBid.price).toBe(1900);
      expect(topBid.totalQuantity).toBe(2);

      // Verify ask price level
      const topAsk = data.asks[0];
      expect(topAsk.price).toBe(2100);
      expect(topAsk.totalQuantity).toBe(3);

      expect(data.timestamp).toBeDefined();
    });

    it('should support /api/v1/market/:eventId/:categoryId/depth alias route (200 OK)', async () => {
      const res = await request(app)
        .get(`/api/v1/market/${eventId}/${categoryId}/depth`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.bids.length).toBeGreaterThan(0);
      expect(res.body.data.asks.length).toBeGreaterThan(0);
    });
  });

  describe('GET /market/:eventId/:categoryId/trades', () => {
    it('should return 404 when event does not exist', async () => {
      const res = await request(app)
        .get(`/market/00000000-0000-0000-0000-000000000000/${categoryId}/trades`)
        .expect(404);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('EVENT_NOT_FOUND');
    });

    it('should return 404 when ticket category does not exist for event', async () => {
      const res = await request(app)
        .get(`/market/${eventId}/00000000-0000-0000-0000-000000000000/trades`)
        .expect(404);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('CATEGORY_NOT_FOUND');
    });

    it('should return recent executed TradeFeed (200 OK)', async () => {
      const res = await request(app)
        .get(`/market/${eventId}/${categoryId}/trades`)
        .expect(200);

      expect(res.body.success).toBe(true);
      const data = res.body.data;
      expect(data).toBeDefined();
      expect(Array.isArray(data.trades)).toBe(true);
      expect(data.total).toBeGreaterThan(0);

      const trade = data.trades[0];
      expect(trade.price).toBe(2050);
      expect(trade.quantity).toBe(1);
      expect(trade.timestamp).toBeDefined();
    });

    it('should support /api/v1/market/:eventId/:categoryId/trades alias route (200 OK)', async () => {
      const res = await request(app)
        .get(`/api/v1/market/${eventId}/${categoryId}/trades`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data.trades)).toBe(true);
      expect(res.body.data.total).toBeGreaterThan(0);
    });
  });

  describe('GET /market/summary', () => {
    let summaryExecId = null;

    beforeAll(async () => {
      const sOrder1 = await prisma.order.create({
        data: {
          userId: buyerUserId,
          eventId,
          ticketCategoryId: categoryId,
          side: 'BID',
          status: 'FILLED',
          price: 2050,
          initialQuantity: 500000,
          remainingQuantity: 0,
        },
      });
      const sOrder2 = await prisma.order.create({
        data: {
          userId: sellerUserId,
          eventId,
          ticketCategoryId: categoryId,
          side: 'ASK',
          status: 'FILLED',
          price: 2050,
          initialQuantity: 500000,
          remainingQuantity: 0,
        },
      });
      const sExec = await prisma.execution.create({
        data: {
          incomingOrderId: sOrder1.id,
          restingOrderId: sOrder2.id,
          price: 2050,
          quantity: 500000,
        },
      });
      summaryExecId = sExec.id;
    });

    afterAll(async () => {
      if (summaryExecId) {
        await prisma.execution.deleteMany({ where: { id: summaryExecId } });
      }
    });

    it('should return market summary of top events (200 OK)', async () => {
      const res = await request(app).get('/market/summary').expect(200);

      expect(res.body.success).toBe(true);
      const data = res.body.data;
      expect(data).toBeDefined();
      expect(Array.isArray(data.summary)).toBe(true);
      expect(data.totalEvents).toBeGreaterThan(0);

      const targetEvent = data.summary.find((e) => e.eventId === eventId);
      expect(targetEvent).toBeDefined();
      expect(targetEvent.eventName).toBeDefined();
      expect(targetEvent.volume).toBeGreaterThanOrEqual(1);
    });

    it('should support query params sortBy=priceMovement and sortBy=trades (200 OK)', async () => {
      const res = await request(app)
        .get('/market/summary?sortBy=priceMovement&limit=5')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data.summary)).toBe(true);
      expect(res.body.data.sortBy).toBe('priceMovement');
    });

    it('should support /api/v1/market/summary alias route (200 OK)', async () => {
      const res = await request(app).get('/api/v1/market/summary').expect(200);

      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data.summary)).toBe(true);
    });
  });

  describe('GET /events/:id/price-history', () => {
    it('should return 404 when event does not exist', async () => {
      const res = await request(app)
        .get('/events/00000000-0000-0000-0000-000000000000/price-history')
        .expect(404);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('EVENT_NOT_FOUND');
    });

    it('should return 404 when categoryId query does not exist for event', async () => {
      const res = await request(app)
        .get(`/events/${eventId}/price-history?categoryId=00000000-0000-0000-0000-000000000000`)
        .expect(404);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('CATEGORY_NOT_FOUND');
    });

    it('should return OHLC candlestick price history for event (200 OK)', async () => {
      const res = await request(app)
        .get(`/events/${eventId}/price-history?interval=1h`)
        .expect(200);

      expect(res.body.success).toBe(true);
      const data = res.body.data;
      expect(data).toBeDefined();
      expect(data.eventId).toBe(eventId);
      expect(Array.isArray(data.candles)).toBe(true);
      expect(data.candles.length).toBeGreaterThan(0);

      const candle = data.candles[0];
      expect(candle.open).toBeDefined();
      expect(candle.high).toBeDefined();
      expect(candle.low).toBeDefined();
      expect(candle.close).toBeDefined();
      expect(candle.volume).toBeDefined();
      expect(candle.timestamp).toBeDefined();

      expect(data.summary).toBeDefined();
      expect(data.summary.currentPrice).toBeDefined();
    });

    it('should filter price history by categoryId (200 OK)', async () => {
      const res = await request(app)
        .get(`/events/${eventId}/price-history?categoryId=${categoryId}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.categoryId).toBe(categoryId);
      expect(Array.isArray(res.body.data.candles)).toBe(true);
    });

    it('should support /api/v1/events/:id/price-history alias route (200 OK)', async () => {
      const res = await request(app)
        .get(`/api/v1/events/${eventId}/price-history`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.eventId).toBe(eventId);
      expect(Array.isArray(res.body.data.candles)).toBe(true);
    });
  });
});
