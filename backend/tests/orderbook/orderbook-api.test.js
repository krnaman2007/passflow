import { jest } from '@jest/globals';
import request from 'supertest';
import app from '../../src/app.js';
import prisma from '../../src/db/prisma.js';

describe('Phase 6 — Orderbook Read APIs & Contract Compatibility', () => {
  jest.setTimeout(120000);

  const timestamp = Date.now();

  let organizerUserId = null;
  let organizerId = null;

  // Event 1 & Category 1 (Primary Market)
  let event1Id = null;
  let category1Id = null;

  // Event 2 & Category 2 (Isolated Market)
  let event2Id = null;
  let category2Id = null;

  // Traders
  let buyer1UserId = null;
  let buyer2UserId = null;
  let seller1UserId = null;
  let seller2UserId = null;

  // Orders
  let bid1Id = null;
  let bid2Id = null;
  let bid3Id = null;
  let ask1Id = null;
  let ask2Id = null;
  let ask3Id = null;

  let cancelledOrderId = null;
  let filledOrderId = null;
  let rejectedOrderId = null;

  let event2BidId = null;

  beforeAll(async () => {
    // 1. Ensure DB connection
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await prisma.$queryRaw`SELECT 1`;
        break;
      } catch (e) {
        if (attempt === 3) throw e;
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
    }

    // 2. Create Organizer
    const orgUser = await prisma.user.create({
      data: {
        name: 'Orderbook Organizer',
        email: `orderbook_org_${timestamp}@example.com`,
        passwordHash: '$2a$10$abcdefghijklmnopqrstuu',
        phone: `+919911${String(timestamp).slice(-6)}`,
        role: 'ORGANIZER',
      },
    });
    organizerUserId = orgUser.id;

    const org = await prisma.organizer.create({
      data: {
        userId: organizerUserId,
        organizationName: `Orderbook Events ${timestamp}`,
        verificationStatus: 'VERIFIED',
      },
    });
    organizerId = org.id;

    // 3. Create Event 1
    const event1 = await prisma.event.create({
      data: {
        name: `Orderbook Primary Event ${timestamp}`,
        description: 'Primary testing event for orderbook read APIs',
        dateTime: new Date(Date.now() + 86400000 * 2),
        location: 'Mumbai Arena',
        organizerId: organizerId,
        status: 'PUBLISHED',
        originalPrice: 2000,
      },
    });
    event1Id = event1.id;

    const cat1 = await prisma.ticketCategory.create({
      data: {
        eventId: event1Id,
        name: 'VIP Front Row',
        originalPrice: 2000,
        totalQuantity: 200,
        availableQuantity: 200,
        status: 'ACTIVE',
      },
    });
    category1Id = cat1.id;

    // 4. Create Event 2 (For Market Isolation Testing)
    const event2 = await prisma.event.create({
      data: {
        name: `Orderbook Secondary Event ${timestamp}`,
        description: 'Second event for strict market isolation testing',
        dateTime: new Date(Date.now() + 86400000 * 3),
        location: 'Delhi Dome',
        organizerId: organizerId,
        status: 'PUBLISHED',
        originalPrice: 1500,
      },
    });
    event2Id = event2.id;

    const cat2 = await prisma.ticketCategory.create({
      data: {
        eventId: event2Id,
        name: 'General Admission',
        originalPrice: 1500,
        totalQuantity: 100,
        availableQuantity: 100,
        status: 'ACTIVE',
      },
    });
    category2Id = cat2.id;

    // 5. Create Buyers & Sellers
    const b1 = await prisma.user.create({
      data: {
        name: 'Buyer Alpha',
        email: `buyer1_${timestamp}@example.com`,
        passwordHash: '$2a$10$abcdefghijklmnopqrstuu',
        phone: `+919811${String(timestamp).slice(-6)}`,
        role: 'USER',
      },
    });
    buyer1UserId = b1.id;

    const b2 = await prisma.user.create({
      data: {
        name: 'Buyer Beta',
        email: `buyer2_${timestamp}@example.com`,
        passwordHash: '$2a$10$abcdefghijklmnopqrstuu',
        phone: `+919812${String(timestamp).slice(-6)}`,
        role: 'USER',
      },
    });
    buyer2UserId = b2.id;

    const s1 = await prisma.user.create({
      data: {
        name: 'Seller Gamma',
        email: `seller1_${timestamp}@example.com`,
        passwordHash: '$2a$10$abcdefghijklmnopqrstuu',
        phone: `+919711${String(timestamp).slice(-6)}`,
        role: 'USER',
      },
    });
    seller1UserId = s1.id;

    const s2 = await prisma.user.create({
      data: {
        name: 'Seller Delta',
        email: `seller2_${timestamp}@example.com`,
        passwordHash: '$2a$10$abcdefghijklmnopqrstuu',
        phone: `+919712${String(timestamp).slice(-6)}`,
        role: 'USER',
      },
    });
    seller2UserId = s2.id;

    // 6. Seed Event 1 Orders to establish Price-Time Priority:
    // Bids:
    // Order 1: Price 2000, Qty 2 (placed first)
    const oBid1 = await prisma.order.create({
      data: {
        userId: buyer1UserId,
        eventId: event1Id,
        ticketCategoryId: category1Id,
        side: 'BID',
        status: 'OPEN',
        price: 2000,
        initialQuantity: 2,
        remainingQuantity: 2,
      },
    });
    bid1Id = oBid1.id;

    // Order 2: Price 2100, Qty 3 (higher price, placed second)
    const oBid2 = await prisma.order.create({
      data: {
        userId: buyer2UserId,
        eventId: event1Id,
        ticketCategoryId: category1Id,
        side: 'BID',
        status: 'OPEN',
        price: 2100,
        initialQuantity: 3,
        remainingQuantity: 3,
      },
    });
    bid2Id = oBid2.id;

    // Order 3: Price 2100, Qty 1 (same price as Order 2, placed third)
    const oBid3 = await prisma.order.create({
      data: {
        userId: buyer1UserId,
        eventId: event1Id,
        ticketCategoryId: category1Id,
        side: 'BID',
        status: 'OPEN',
        price: 2100,
        initialQuantity: 1,
        remainingQuantity: 1,
      },
    });
    bid3Id = oBid3.id;

    // Asks:
    // Order 4: Price 2500, Qty 2 (placed first)
    const oAsk1 = await prisma.order.create({
      data: {
        userId: seller1UserId,
        eventId: event1Id,
        ticketCategoryId: category1Id,
        side: 'ASK',
        status: 'OPEN',
        price: 2500,
        initialQuantity: 2,
        remainingQuantity: 2,
      },
    });
    ask1Id = oAsk1.id;

    // Order 5: Price 2400, Qty 3 (lower price, placed second)
    const oAsk2 = await prisma.order.create({
      data: {
        userId: seller2UserId,
        eventId: event1Id,
        ticketCategoryId: category1Id,
        side: 'ASK',
        status: 'OPEN',
        price: 2400,
        initialQuantity: 3,
        remainingQuantity: 3,
      },
    });
    ask2Id = oAsk2.id;

    // Order 6: Price 2400, Qty 1 (same price as Order 5, placed third)
    const oAsk3 = await prisma.order.create({
      data: {
        userId: seller1UserId,
        eventId: event1Id,
        ticketCategoryId: category1Id,
        side: 'ASK',
        status: 'OPEN',
        price: 2400,
        initialQuantity: 1,
        remainingQuantity: 1,
      },
    });
    ask3Id = oAsk3.id;

    // 7. Seed Ineligible Orders for Event 1 (must be excluded from active liquidity)
    const oCancelled = await prisma.order.create({
      data: {
        userId: buyer1UserId,
        eventId: event1Id,
        ticketCategoryId: category1Id,
        side: 'BID',
        status: 'CANCELLED',
        price: 2200,
        initialQuantity: 5,
        remainingQuantity: 5,
      },
    });
    cancelledOrderId = oCancelled.id;

    const oFilled = await prisma.order.create({
      data: {
        userId: seller1UserId,
        eventId: event1Id,
        ticketCategoryId: category1Id,
        side: 'ASK',
        status: 'FILLED',
        price: 2300,
        initialQuantity: 2,
        remainingQuantity: 0,
      },
    });
    filledOrderId = oFilled.id;

    const oRejected = await prisma.order.create({
      data: {
        userId: buyer2UserId,
        eventId: event1Id,
        ticketCategoryId: category1Id,
        side: 'BID',
        status: 'REJECTED',
        price: 2150,
        initialQuantity: 1,
        remainingQuantity: 1,
      },
    });
    rejectedOrderId = oRejected.id;

    // 8. Seed Order in Event 2 (for market isolation)
    const oEv2 = await prisma.order.create({
      data: {
        userId: buyer1UserId,
        eventId: event2Id,
        ticketCategoryId: category2Id,
        side: 'BID',
        status: 'OPEN',
        price: 1400,
        initialQuantity: 4,
        remainingQuantity: 4,
      },
    });
    event2BidId = oEv2.id;
  });

  afterAll(async () => {
    // Cleanup in reverse dependency order
    const eventIds = [event1Id, event2Id].filter(Boolean);
    if (eventIds.length > 0) {
      await prisma.order.deleteMany({
        where: { eventId: { in: eventIds } },
      });
      await prisma.ticketCategory.deleteMany({
        where: { eventId: { in: eventIds } },
      });
      await prisma.event.deleteMany({
        where: { id: { in: eventIds } },
      });
    }

    if (organizerId) {
      await prisma.organizer.deleteMany({
        where: { id: organizerId },
      });
    }

    const userIds = [
      organizerUserId,
      buyer1UserId,
      buyer2UserId,
      seller1UserId,
      seller2UserId,
    ].filter(Boolean);

    if (userIds.length > 0) {
      await prisma.refreshToken.deleteMany({
        where: { userId: { in: userIds } },
      });
      await prisma.user.deleteMany({
        where: { id: { in: userIds } },
      });
    }

    await prisma.$disconnect();
  });

  describe('1. Event Orderbook Endpoint (GET /api/v1/events/:eventId/orderbook)', () => {
    it('is public: accessible without authentication tokens (200 OK)', async () => {
      const res = await request(app)
        .get(`/api/v1/events/${event1Id}/orderbook?categoryId=${category1Id}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeDefined();
    });

    it('returns consistent contract for backward-compatible root alias (/events/:eventId/orderbook)', async () => {
      const res = await request(app)
        .get(`/events/${event1Id}/orderbook?categoryId=${category1Id}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(`${event1Id}:${category1Id}`);
      expect(res.body.data.eventId).toBe(event1Id);
      expect(res.body.data.categoryId).toBe(category1Id);
    });

    it('preserves strict Price-Time Priority in resting orders', async () => {
      const res = await request(app)
        .get(`/api/v1/events/${event1Id}/orderbook?categoryId=${category1Id}`)
        .expect(200);

      const { bids, asks } = res.body.data;

      // Bids: Sorted price DESC, sequenceNumber ASC
      expect(bids.length).toBe(3);
      // Top bid: price 2100 (from order 2, placed before order 3)
      expect(bids[0].id).toBe(bid2Id);
      expect(bids[0].price).toBe(2100);
      expect(bids[0].quantity).toBe(3);

      // Second bid: price 2100 (from order 3, placed after order 2)
      expect(bids[1].id).toBe(bid3Id);
      expect(bids[1].price).toBe(2100);
      expect(bids[1].quantity).toBe(1);

      // Third bid: price 2000 (from order 1, lower price)
      expect(bids[2].id).toBe(bid1Id);
      expect(bids[2].price).toBe(2000);
      expect(bids[2].quantity).toBe(2);

      // Asks: Sorted price ASC, sequenceNumber ASC
      expect(asks.length).toBe(3);
      // Top ask: price 2400 (from order 5, placed before order 6)
      expect(asks[0].id).toBe(ask2Id);
      expect(asks[0].price).toBe(2400);
      expect(asks[0].quantity).toBe(3);

      // Second ask: price 2400 (from order 6, placed after order 5)
      expect(asks[1].id).toBe(ask3Id);
      expect(asks[1].price).toBe(2400);
      expect(asks[1].quantity).toBe(1);

      // Third ask: price 2500 (from order 4, higher price)
      expect(asks[2].id).toBe(ask1Id);
      expect(asks[2].price).toBe(2500);
      expect(asks[2].quantity).toBe(2);
    });

    it('aggregates depth levels accurately with orderCount and totalQuantity', async () => {
      const res = await request(app)
        .get(`/api/v1/events/${event1Id}/orderbook?categoryId=${category1Id}`)
        .expect(200);

      const { depth, bestBid, bestAsk, spread } = res.body.data;

      expect(bestBid).toBe(2100);
      expect(bestAsk).toBe(2400);
      expect(spread).toBe(300);

      // Bid levels
      expect(depth.bids.length).toBe(2);
      expect(depth.bids[0]).toEqual({
        price: 2100,
        totalQuantity: 4, // 3 + 1
        orderCount: 2,
      });
      expect(depth.bids[1]).toEqual({
        price: 2000,
        totalQuantity: 2,
        orderCount: 1,
      });

      // Ask levels
      expect(depth.asks.length).toBe(2);
      expect(depth.asks[0]).toEqual({
        price: 2400,
        totalQuantity: 4, // 3 + 1
        orderCount: 2,
      });
      expect(depth.asks[1]).toEqual({
        price: 2500,
        totalQuantity: 2,
        orderCount: 1,
      });
    });

    it('excludes cancelled, filled, and rejected orders from active liquidity', async () => {
      const res = await request(app)
        .get(`/api/v1/events/${event1Id}/orderbook?categoryId=${category1Id}`)
        .expect(200);

      const allOrderIds = [
        ...res.body.data.bids.map((b) => b.id),
        ...res.body.data.asks.map((a) => a.id),
      ];

      expect(allOrderIds).not.toContain(cancelledOrderId);
      expect(allOrderIds).not.toContain(filledOrderId);
      expect(allOrderIds).not.toContain(rejectedOrderId);

      // Check prices: 2200 (cancelled) and 2300 (filled) and 2150 (rejected) must not appear in depth
      const bidPrices = res.body.data.depth.bids.map((b) => b.price);
      const askPrices = res.body.data.depth.asks.map((a) => a.price);

      expect(bidPrices).not.toContain(2200);
      expect(bidPrices).not.toContain(2150);
      expect(askPrices).not.toContain(2300);
    });

    it('preserves strict market isolation between distinct events and categories', async () => {
      const res1 = await request(app)
        .get(`/api/v1/events/${event1Id}/orderbook?categoryId=${category1Id}`)
        .expect(200);

      const res2 = await request(app)
        .get(`/api/v1/events/${event2Id}/orderbook?categoryId=${category2Id}`)
        .expect(200);

      // Event 1 does NOT contain Event 2 orders
      const event1OrderIds = [
        ...res1.body.data.bids.map((b) => b.id),
        ...res1.body.data.asks.map((a) => a.id),
      ];
      expect(event1OrderIds).not.toContain(event2BidId);

      // Event 2 only contains its own order
      const event2OrderIds = [
        ...res2.body.data.bids.map((b) => b.id),
        ...res2.body.data.asks.map((a) => a.id),
      ];
      expect(event2OrderIds).toContain(event2BidId);
      expect(res2.body.data.bids.length).toBe(1);
      expect(res2.body.data.bids[0].price).toBe(1400);
      expect(res2.body.data.asks.length).toBe(0);
    });

    it('enforces privacy: does NOT expose userId, walletId, holdId, or idempotencyKey', async () => {
      const res = await request(app)
        .get(`/api/v1/events/${event1Id}/orderbook?categoryId=${category1Id}`)
        .expect(200);

      const allOrders = [...res.body.data.bids, ...res.body.data.asks];
      expect(allOrders.length).toBeGreaterThan(0);

      for (const order of allOrders) {
        expect(order.userId).toBeUndefined();
        expect(order.walletId).toBeUndefined();
        expect(order.holdId).toBeUndefined();
        expect(order.buyerHoldId).toBeUndefined();
        expect(order.idempotencyKey).toBeUndefined();
        expect(order.stoppedReason).toBeUndefined();

        // Exposed public attributes
        expect(order.id).toBeDefined();
        expect(order.side).toBeDefined();
        expect(typeof order.price).toBe('number');
        expect(typeof order.quantity).toBe('number');
        expect(typeof order.initialQuantity).toBe('number');
        expect(order.sequenceNumber).toBeDefined();
        expect(order.createdAt).toBeDefined();
      }
    });

    it('supports ticketCategoryId alias in query parameters', async () => {
      const res = await request(app)
        .get(`/api/v1/events/${event1Id}/orderbook?ticketCategoryId=${category1Id}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.categoryId).toBe(category1Id);
    });

    it('supports limit query parameter for pagination of book depth and orders', async () => {
      const res = await request(app)
        .get(`/api/v1/events/${event1Id}/orderbook?categoryId=${category1Id}&limit=1`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.bids.length).toBe(1);
      expect(res.body.data.asks.length).toBe(1);
      expect(res.body.data.depth.bids.length).toBe(1);
      expect(res.body.data.depth.asks.length).toBe(1);
    });

    it('returns 400 VALIDATION_ERROR when categoryId is missing in query', async () => {
      const res = await request(app)
        .get(`/api/v1/events/${event1Id}/orderbook`)
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 VALIDATION_ERROR when eventId is not a valid UUID', async () => {
      const res = await request(app)
        .get(`/api/v1/events/invalid-uuid-format/orderbook?categoryId=${category1Id}`)
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 VALIDATION_ERROR when categoryId is not a valid UUID', async () => {
      const res = await request(app)
        .get(`/api/v1/events/${event1Id}/orderbook?categoryId=not-a-valid-uuid`)
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 404 EVENT_NOT_FOUND when event does not exist', async () => {
      const res = await request(app)
        .get(
          `/api/v1/events/00000000-0000-0000-0000-000000000000/orderbook?categoryId=${category1Id}`
        )
        .expect(404);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('EVENT_NOT_FOUND');
    });

    it('returns 404 CATEGORY_NOT_FOUND when category does not belong to the requested event', async () => {
      // Pass Event 1 ID with Event 2 Category ID
      const res = await request(app)
        .get(`/api/v1/events/${event1Id}/orderbook?categoryId=${category2Id}`)
        .expect(404);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('CATEGORY_NOT_FOUND');
    });
  });

  describe('2. Orderbook Depth Endpoint (GET /api/v1/orderbook/:id/depth)', () => {
    it('is public: accessible without authentication tokens (200 OK)', async () => {
      const res = await request(app)
        .get(`/api/v1/orderbook/${category1Id}/depth`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeDefined();
    });

    it('returns consistent contract for backward-compatible root alias (/orderbook/:id/depth)', async () => {
      const res = await request(app)
        .get(`/orderbook/${category1Id}/depth`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(`${event1Id}:${category1Id}`);
    });

    it('resolves market depth unambiguously via composite eventId:categoryId identifier', async () => {
      const compositeId = `${event1Id}:${category1Id}`;
      const res = await request(app)
        .get(`/api/v1/orderbook/${compositeId}/depth`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(compositeId);
      expect(res.body.data.eventId).toBe(event1Id);
      expect(res.body.data.categoryId).toBe(category1Id);
      expect(res.body.data.bids.length).toBe(2);
      expect(res.body.data.asks.length).toBe(2);
      expect(res.body.data.bids[0].price).toBe(2100);
      expect(res.body.data.asks[0].price).toBe(2400);
    });

    it('resolves market depth unambiguously via ticketCategoryId identifier', async () => {
      const res = await request(app)
        .get(`/api/v1/orderbook/${category1Id}/depth`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(`${event1Id}:${category1Id}`);
      expect(res.body.data.eventId).toBe(event1Id);
      expect(res.body.data.categoryId).toBe(category1Id);
      expect(res.body.data.bids[0].price).toBe(2100);
    });

    it('resolves market depth unambiguously via orderId identifier', async () => {
      // Pass bid1Id (an order belonging to Event 1 & Category 1)
      const res = await request(app)
        .get(`/api/v1/orderbook/${bid1Id}/depth`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(`${event1Id}:${category1Id}`);
      expect(res.body.data.eventId).toBe(event1Id);
      expect(res.body.data.categoryId).toBe(category1Id);
      expect(res.body.data.bids[0].price).toBe(2100);
      expect(res.body.data.asks[0].price).toBe(2400);
    });

    it('supports limit query parameter on depth endpoint', async () => {
      const res = await request(app)
        .get(`/api/v1/orderbook/${category1Id}/depth?limit=1`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.bids.length).toBe(1);
      expect(res.body.data.asks.length).toBe(1);
    });

    it('returns identical response format as existing GET /market/:eventId/:categoryId/depth', async () => {
      const resExisting = await request(app)
        .get(`/api/v1/market/${event1Id}/${category1Id}/depth`)
        .expect(200);

      const resNew = await request(app)
        .get(`/api/v1/orderbook/${category1Id}/depth`)
        .expect(200);

      expect(resNew.body.data.id).toBe(resExisting.body.data.id);
      expect(resNew.body.data.eventId).toBe(resExisting.body.data.eventId);
      expect(resNew.body.data.categoryId).toBe(resExisting.body.data.categoryId);
      expect(resNew.body.data.bids).toEqual(resExisting.body.data.bids);
      expect(resNew.body.data.asks).toEqual(resExisting.body.data.asks);
    });

    it('returns 400 VALIDATION_ERROR for malformed identifier string', async () => {
      const res = await request(app)
        .get('/api/v1/orderbook/invalid-id-format/depth')
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 404 ORDERBOOK_NOT_FOUND when UUID does not exist as category or order', async () => {
      const res = await request(app)
        .get('/api/v1/orderbook/00000000-0000-0000-0000-000000000000/depth')
        .expect(404);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('ORDERBOOK_NOT_FOUND');
    });

    it('returns 404 EVENT_NOT_FOUND when composite ID specifies a nonexistent event', async () => {
      const nonExistentComposite = `00000000-0000-0000-0000-000000000000:${category1Id}`;
      const res = await request(app)
        .get(`/api/v1/orderbook/${nonExistentComposite}/depth`)
        .expect(404);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('EVENT_NOT_FOUND');
    });
  });

  describe('3. Thin Compatibility Routes & Existing Market Routes', () => {
    it('supports compatibility route GET /orderbook/:eventId/:categoryId/depth', async () => {
      const res = await request(app)
        .get(`/orderbook/${event1Id}/${category1Id}/depth`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(`${event1Id}:${category1Id}`);
      expect(res.body.data.bids[0].price).toBe(2100);
    });

    it('supports compatibility route GET /orderbook/:eventId/:categoryId', async () => {
      const res = await request(app)
        .get(`/orderbook/${event1Id}/${category1Id}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(`${event1Id}:${category1Id}`);
      expect(res.body.data.bestBid).toBe(2100);
      expect(res.body.data.bestAsk).toBe(2400);
    });

    it('preserves existing GET /market/:eventId/:categoryId contract without regression', async () => {
      const res = await request(app)
        .get(`/api/v1/market/${event1Id}/${category1Id}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.bestBid).toBe(2100);
      expect(res.body.data.bestAsk).toBe(2400);
      expect(res.body.data.spread).toBe(300);
    });

    it('preserves existing GET /market/:eventId/:categoryId/trades contract without regression', async () => {
      const res = await request(app)
        .get(`/api/v1/market/${event1Id}/${category1Id}/trades`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data.trades)).toBe(true);
    });
  });
});
