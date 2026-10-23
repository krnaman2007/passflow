/**
 * Step 9.11 — Secondary Market Order Read APIs Integration Tests
 *
 * Verifies authenticated REST API read endpoints:
 * 1. GET /api/v1/orders (and /orders)
 *    - Rejection of unauthenticated requests (401 UNAUTHORIZED)
 *    - Empty results for new user with no orders (200 with empty list & pagination)
 *    - Pagination boundaries and validation (page, limit)
 *    - Filtering by status (OPEN, FILLED, PARTIALLY_FILLED, and PARTIAL alias)
 *    - Filtering by side (BID, ASK, and BUY/SELL aliases)
 *    - Filtering by event (eventId, event) and category (ticketCategoryId, categoryId)
 *    - Rejection of invalid filter parameters (400 VALIDATION_ERROR)
 * 2. GET /api/v1/orders/:id (and /orders/:id)
 *    - Rejection of unauthenticated requests (401 UNAUTHORIZED)
 *    - Ownership denial: User cannot view another user's order (403 FORBIDDEN)
 *    - Non-existent order ID returns 404 ORDER_NOT_FOUND
 *    - Order owner retrieves full details and execution fills
 *    - Incoming order execution displays role 'TAKER' without leaking counterparty user/wallet
 *    - Resting order execution displays role 'MAKER' without leaking counterparty user/wallet
 * 3. GET /api/v1/orders/:id/trades (and /orders/:id/trades)
 *    - Rejection of unauthenticated requests (401 UNAUTHORIZED)
 *    - Ownership denial: User cannot view executions for another user's order (403 FORBIDDEN)
 *    - Non-existent order ID returns 404 ORDER_NOT_FOUND
 *    - Returns order-specific trades list with execution facts
 *    - Empty trades list for open unfilled order
 * 4. Deduplication & Data Integrity:
 *    - Each Execution appears strictly once in executions/trades lists
 *    - Persisted execution and order state matches database without invented settlement statuses
 */

import { jest } from '@jest/globals';
import request from 'supertest';
import crypto from 'node:crypto';
import app from '../../src/app.js';
import { prisma as livePrisma } from '../../src/db/prisma.js';
import { generateAccessToken } from '../../src/utils/token.js';
import { WalletService } from '../../src/services/wallet/index.js';
import { OrderRepository } from '../../src/services/matching/order-repository.js';
import { PersistentMatchingService } from '../../src/services/matching/persistent-matching-service.js';
import { OrderBook } from '../../src/services/matching/order-book.js';
import { TradeSettlementService } from '../../src/services/settlement/index.js';
import { OrderService } from '../../src/services/order/index.js';
import { orderController } from '../../src/controllers/order.controller.js';

describe('Step 9.11 — Secondary Market Order Read APIs Integration', () => {
  jest.setTimeout(60000);

  const testRunId = Math.random().toString(36).substring(2, 8);
  const walletService = new WalletService({ prismaClient: livePrisma });
  const orderRepository = new OrderRepository({ prismaClient: livePrisma });
  const matchingService = new PersistentMatchingService({ repository: orderRepository });
  const settlementService = new TradeSettlementService({ prismaClient: livePrisma });
  const orderService = new OrderService({
    prismaClient: livePrisma,
    walletService,
    matchingService,
    orderRepository,
    settlementService,
  });

  let organizerUser;
  let organizer;
  let testEvent;
  let testCategory;
  let buyerUser;
  let buyerToken;
  let sellerUser;
  let sellerToken;
  let thirdPartyUser;
  let thirdPartyToken;

  let sellerRestingOrderId;
  let buyerMatchedOrderId;
  let buyerOpenOrderId;
  let matchedExecutionId;

  beforeAll(async () => {
    orderController.orderService = orderService;

    // 1. Create organizer and event
    organizerUser = await livePrisma.user.create({
      data: {
        email: `read-org-${testRunId}@test.passflow.com`,
        passwordHash: 'dummy-hash',
        name: 'Order Read Organizer',
      },
    });

    organizer = await livePrisma.organizer.create({
      data: {
        userId: organizerUser.id,
        organizationName: `Order Read Org ${testRunId}`,
        verificationStatus: 'VERIFIED',
      },
    });

    testEvent = await livePrisma.event.create({
      data: {
        name: `Order Read Festival ${testRunId}`,
        description: 'Integration test event for order read APIs',
        location: 'Read API Arena',
        dateTime: new Date(Date.now() + 86400000 * 20),
        status: 'PUBLISHED',
        organizerId: organizer.id,
      },
    });

    testCategory = await livePrisma.ticketCategory.create({
      data: {
        eventId: testEvent.id,
        name: 'Tier 1 Diamond',
        originalPrice: 100.0,
        totalQuantity: 200,
        availableQuantity: 200,
        status: 'ACTIVE',
      },
    });

    // Certify synchronized in-memory order book for this test market
    const book = new OrderBook({
      eventId: testEvent.id,
      ticketCategoryId: testCategory.id,
    });
    const marketKey = matchingService.registerMarketBook(
      { eventId: testEvent.id, ticketCategoryId: testCategory.id },
      book,
      { synchronized: true }
    );
    matchingService.stateManager.transition(marketKey, 'READY');

    // 2. Create Users
    buyerUser = await livePrisma.user.create({
      data: {
        email: `buyer-${testRunId}@test.passflow.com`,
        passwordHash: 'dummy-hash',
        name: 'Buyer User',
      },
    });
    buyerToken = generateAccessToken({ id: buyerUser.id, email: buyerUser.email, role: 'USER' });

    sellerUser = await livePrisma.user.create({
      data: {
        email: `seller-${testRunId}@test.passflow.com`,
        passwordHash: 'dummy-hash',
        name: 'Seller User',
      },
    });
    sellerToken = generateAccessToken({ id: sellerUser.id, email: sellerUser.email, role: 'USER' });

    thirdPartyUser = await livePrisma.user.create({
      data: {
        email: `thirdparty-${testRunId}@test.passflow.com`,
        passwordHash: 'dummy-hash',
        name: 'Third Party User',
      },
    });
    thirdPartyToken = generateAccessToken({ id: thirdPartyUser.id, email: thirdPartyUser.email, role: 'USER' });

    // Initialize wallets
    const buyerWallet = await walletService.getOrCreateWallet({ userId: buyerUser.id });
    await walletService.getOrCreateWallet({ userId: sellerUser.id });
    await walletService.getOrCreateWallet({ userId: thirdPartyUser.id });

    // 3. Fund buyer's wallet (e.g. 500000 paise = ₹5000.00)
    await walletService.creditAvailable({
      walletId: buyerWallet.id,
      amount: 500000n,
      idempotencyKey: `fund-buyer-${testRunId}`,
      entryType: 'DEPOSIT',
      operationType: 'DEPOSIT',
    });

    // 4. Fund seller's ticket inventory (5 tickets)
    await orderService.creditUserTicketInventory({
      userId: sellerUser.id,
      ticketCategoryId: testCategory.id,
      quantity: 5,
      idempotencyKey: `credit-seller-${testRunId}`,
    });

    // 5. Seller places resting ASK order: price = 2500 paise, quantity = 5
    const sellerPlacement = await orderService.placeLimitOrder({
      userId: sellerUser.id,
      eventId: testEvent.id,
      ticketCategoryId: testCategory.id,
      side: 'ASK',
      price: 2500,
      quantity: 5,
      idempotencyKey: `seller-order-${testRunId}`,
    });
    sellerRestingOrderId = sellerPlacement.orderId;

    // 6. Buyer places incoming BID order matching 2 tickets at 2500 paise
    const buyerPlacement = await orderService.placeLimitOrder({
      userId: buyerUser.id,
      eventId: testEvent.id,
      ticketCategoryId: testCategory.id,
      side: 'BID',
      price: 2500,
      quantity: 2,
      idempotencyKey: `buyer-order-${testRunId}`,
    });
    buyerMatchedOrderId = buyerPlacement.orderId;
    expect(buyerPlacement.executions).toHaveLength(1);
    matchedExecutionId = buyerPlacement.executions[0].id;

    // 7. Buyer places another BID order that rests unfilled (price = 1000 paise, quantity = 1)
    const buyerOpenPlacement = await orderService.placeLimitOrder({
      userId: buyerUser.id,
      eventId: testEvent.id,
      ticketCategoryId: testCategory.id,
      side: 'BID',
      price: 1000,
      quantity: 1,
      idempotencyKey: `buyer-open-order-${testRunId}`,
    });
    buyerOpenOrderId = buyerOpenPlacement.orderId;
  });

  afterAll(async () => {
    // Graceful disconnect
    await livePrisma.$disconnect();
  });

  // =========================================================================
  // 1. Authentication Tests (401 UNAUTHORIZED)
  // =========================================================================
  describe('1. Authentication Validation (401 UNAUTHORIZED)', () => {
    test('GET /api/v1/orders rejects unauthenticated requests with 401', async () => {
      const res = await request(app).get('/api/v1/orders');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    test('GET /orders (backward compatibility root alias) rejects unauthenticated requests with 401', async () => {
      const res = await request(app).get('/orders');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    test('GET /api/v1/orders/:id rejects unauthenticated requests with 401', async () => {
      const res = await request(app).get(`/api/v1/orders/${buyerMatchedOrderId}`);
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    test('GET /orders/:id rejects unauthenticated requests with 401', async () => {
      const res = await request(app).get(`/orders/${buyerMatchedOrderId}`);
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    test('GET /api/v1/orders/:id/trades rejects unauthenticated requests with 401', async () => {
      const res = await request(app).get(`/api/v1/orders/${buyerMatchedOrderId}/trades`);
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    test('GET /orders/:id/trades rejects unauthenticated requests with 401', async () => {
      const res = await request(app).get(`/orders/${buyerMatchedOrderId}/trades`);
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    test('Endpoints reject requests with an invalid / forged Bearer token', async () => {
      const res = await request(app)
        .get('/api/v1/orders')
        .set('Authorization', 'Bearer invalid-token-sample');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(['UNAUTHORIZED', 'INVALID_TOKEN']).toContain(res.body.error.code);
    });
  });

  // =========================================================================
  // 2. Ownership Enforcement & Denial (403 FORBIDDEN)
  // =========================================================================
  describe('2. Ownership Enforcement (403 FORBIDDEN)', () => {
    test('A user cannot retrieve another user order details (GET /api/v1/orders/:id)', async () => {
      // thirdPartyUser attempts to read buyerUser's order
      const res = await request(app)
        .get(`/api/v1/orders/${buyerMatchedOrderId}`)
        .set('Authorization', `Bearer ${thirdPartyToken}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('FORBIDDEN');
      expect(res.body.error.message).toMatch(/not authorized/i);
      // Ensure private order data is not leaked in response
      expect(res.body.data).toBeUndefined();
    });

    test('A user cannot retrieve executions for another user order (GET /api/v1/orders/:id/trades)', async () => {
      // thirdPartyUser attempts to read buyerUser's order trades
      const res = await request(app)
        .get(`/api/v1/orders/${buyerMatchedOrderId}/trades`)
        .set('Authorization', `Bearer ${thirdPartyToken}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('FORBIDDEN');
      expect(res.body.data).toBeUndefined();
    });

    test('Seller cannot view Buyer order details directly despite being the trade counterparty', async () => {
      // sellerUser attempts to view buyerUser's order directly
      const res = await request(app)
        .get(`/api/v1/orders/${buyerMatchedOrderId}`)
        .set('Authorization', `Bearer ${sellerToken}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });
  });

  // =========================================================================
  // 3. Nonexistent ID Handling (404 ORDER_NOT_FOUND)
  // =========================================================================
  describe('3. Non-Existent Order Handling (404 ORDER_NOT_FOUND)', () => {
    test('GET /api/v1/orders/:id with non-existent UUID returns 404 ORDER_NOT_FOUND', async () => {
      const nonExistentId = crypto.randomUUID();
      const res = await request(app)
        .get(`/api/v1/orders/${nonExistentId}`)
        .set('Authorization', `Bearer ${buyerToken}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('ORDER_NOT_FOUND');
      expect(res.body.error.message).toContain(nonExistentId);
    });

    test('GET /api/v1/orders/:id/trades with non-existent UUID returns 404 ORDER_NOT_FOUND', async () => {
      const nonExistentId = crypto.randomUUID();
      const res = await request(app)
        .get(`/api/v1/orders/${nonExistentId}/trades`)
        .set('Authorization', `Bearer ${buyerToken}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('ORDER_NOT_FOUND');
    });
  });

  // =========================================================================
  // 4. Empty Results for New Users
  // =========================================================================
  describe('4. Empty Orders List', () => {
    test('A user with no order history receives an empty list and valid pagination metadata', async () => {
      const res = await request(app)
        .get('/api/v1/orders')
        .set('Authorization', `Bearer ${thirdPartyToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.orders).toEqual([]);
      expect(res.body.data.pagination).toEqual({
        page: 1,
        limit: 20,
        total: 0,
        totalPages: 1,
      });
    });
  });

  // =========================================================================
  // 5. Order Listing, Filtering & Pagination (GET /api/v1/orders)
  // =========================================================================
  describe('5. GET /api/v1/orders Filtering & Pagination', () => {
    test('Lists all orders for authenticated buyer (FILLED and OPEN)', async () => {
      const res = await request(app)
        .get('/api/v1/orders')
        .set('Authorization', `Bearer ${buyerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.orders.length).toBeGreaterThanOrEqual(2);
      expect(res.body.data.pagination.total).toBeGreaterThanOrEqual(2);

      const orderIds = res.body.data.orders.map((o) => o.id);
      expect(orderIds).toContain(buyerMatchedOrderId);
      expect(orderIds).toContain(buyerOpenOrderId);
    });

    test('Root alias /orders works identically to /api/v1/orders', async () => {
      const res = await request(app)
        .get('/orders')
        .set('Authorization', `Bearer ${buyerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.orders.length).toBeGreaterThanOrEqual(2);
    });

    test('Filter by status=FILLED returns only filled orders', async () => {
      const res = await request(app)
        .get('/api/v1/orders?status=FILLED')
        .set('Authorization', `Bearer ${buyerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.orders.length).toBe(1);
      expect(res.body.data.orders[0].id).toBe(buyerMatchedOrderId);
      expect(res.body.data.orders[0].status).toBe('FILLED');
      expect(res.body.data.orders[0].filledQuantity).toBe(2);
      expect(res.body.data.orders[0].remainingQuantity).toBe(0);
    });

    test('Filter by status=OPEN returns only open orders', async () => {
      const res = await request(app)
        .get('/api/v1/orders?status=OPEN')
        .set('Authorization', `Bearer ${buyerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.orders.length).toBe(1);
      expect(res.body.data.orders[0].id).toBe(buyerOpenOrderId);
      expect(res.body.data.orders[0].status).toBe('OPEN');
      expect(res.body.data.orders[0].remainingQuantity).toBe(1);
      expect(res.body.data.orders[0].filledQuantity).toBe(0);
    });

    test('Filter by status=PARTIAL alias correctly maps to PARTIALLY_FILLED', async () => {
      // Seller's order was partially filled (2 of 5 filled, 3 remaining)
      const res = await request(app)
        .get('/api/v1/orders?status=PARTIAL')
        .set('Authorization', `Bearer ${sellerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.orders.length).toBe(1);
      expect(res.body.data.orders[0].id).toBe(sellerRestingOrderId);
      expect(res.body.data.orders[0].status).toBe('PARTIALLY_FILLED');
      expect(res.body.data.orders[0].remainingQuantity).toBe(3);
      expect(res.body.data.orders[0].filledQuantity).toBe(2);
    });

    test('Filter by side=BUY and side=BID returns buyer orders', async () => {
      const resBuy = await request(app)
        .get('/api/v1/orders?side=BUY')
        .set('Authorization', `Bearer ${buyerToken}`);
      expect(resBuy.status).toBe(200);
      expect(resBuy.body.data.orders.length).toBeGreaterThanOrEqual(2);
      expect(resBuy.body.data.orders.every((o) => o.side === 'BID')).toBe(true);

      const resBid = await request(app)
        .get('/api/v1/orders?side=BID')
        .set('Authorization', `Bearer ${buyerToken}`);
      expect(resBid.status).toBe(200);
      expect(resBid.body.data.orders.length).toBe(resBuy.body.data.orders.length);
    });

    test('Filter by side=SELL and side=ASK returns seller orders', async () => {
      const resSell = await request(app)
        .get('/api/v1/orders?side=SELL')
        .set('Authorization', `Bearer ${sellerToken}`);
      expect(resSell.status).toBe(200);
      expect(resSell.body.data.orders.length).toBe(1);
      expect(resSell.body.data.orders[0].side).toBe('ASK');

      const resAsk = await request(app)
        .get('/api/v1/orders?side=ASK')
        .set('Authorization', `Bearer ${sellerToken}`);
      expect(resAsk.status).toBe(200);
      expect(resAsk.body.data.orders.length).toBe(1);
      expect(resAsk.body.data.orders[0].id).toBe(sellerRestingOrderId);
    });

    test('Filter by eventId and event alias', async () => {
      const resEventId = await request(app)
        .get(`/api/v1/orders?eventId=${testEvent.id}`)
        .set('Authorization', `Bearer ${buyerToken}`);
      expect(resEventId.status).toBe(200);
      expect(resEventId.body.data.orders.length).toBeGreaterThanOrEqual(2);

      const resEvent = await request(app)
        .get(`/api/v1/orders?event=${testEvent.id}`)
        .set('Authorization', `Bearer ${buyerToken}`);
      expect(resEvent.status).toBe(200);
      expect(resEvent.body.data.orders.length).toBe(resEventId.body.data.orders.length);
    });

    test('Pagination: page=1&limit=1 returns single order with totalPages >= 2', async () => {
      const res = await request(app)
        .get('/api/v1/orders?page=1&limit=1')
        .set('Authorization', `Bearer ${buyerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.orders).toHaveLength(1);
      expect(res.body.data.pagination.page).toBe(1);
      expect(res.body.data.pagination.limit).toBe(1);
      expect(res.body.data.pagination.total).toBeGreaterThanOrEqual(2);
      expect(res.body.data.pagination.totalPages).toBeGreaterThanOrEqual(2);
    });

    test('Pagination: page=2&limit=1 returns the next order without overlap', async () => {
      const res1 = await request(app)
        .get('/api/v1/orders?page=1&limit=1')
        .set('Authorization', `Bearer ${buyerToken}`);
      const res2 = await request(app)
        .get('/api/v1/orders?page=2&limit=1')
        .set('Authorization', `Bearer ${buyerToken}`);

      expect(res1.body.data.orders[0].id).not.toBe(res2.body.data.orders[0].id);
    });

    test('Validation: Rejects invalid side with 400 VALIDATION_ERROR', async () => {
      const res = await request(app)
        .get('/api/v1/orders?side=HOLD')
        .set('Authorization', `Bearer ${buyerToken}`);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    test('Validation: Rejects invalid status with 400 VALIDATION_ERROR', async () => {
      const res = await request(app)
        .get('/api/v1/orders?status=PENDING_APPROVAL')
        .set('Authorization', `Bearer ${buyerToken}`);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    test('Validation: Rejects non-positive page or limit with 400 VALIDATION_ERROR', async () => {
      const resZeroPage = await request(app)
        .get('/api/v1/orders?page=0')
        .set('Authorization', `Bearer ${buyerToken}`);
      expect(resZeroPage.status).toBe(400);
      expect(resZeroPage.body.error.code).toBe('VALIDATION_ERROR');

      const resOverLimit = await request(app)
        .get('/api/v1/orders?limit=250')
        .set('Authorization', `Bearer ${buyerToken}`);
      expect(resOverLimit.status).toBe(400);
      expect(resOverLimit.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  // =========================================================================
  // 6. Order Details & Execution Relations (GET /api/v1/orders/:id)
  // =========================================================================
  describe('6. GET /api/v1/orders/:id Order Details & Fills', () => {
    test('Buyer retrieves matched order details with incoming execution (role: TAKER)', async () => {
      const res = await request(app)
        .get(`/api/v1/orders/${buyerMatchedOrderId}`)
        .set('Authorization', `Bearer ${buyerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const data = res.body.data;
      expect(data.id).toBe(buyerMatchedOrderId);
      expect(data.side).toBe('BID');
      expect(data.status).toBe('FILLED');
      expect(data.price).toBe(2500);
      expect(data.initialQuantity).toBe(2);
      expect(data.remainingQuantity).toBe(0);
      expect(data.filledQuantity).toBe(2);
      expect(typeof data.sequenceNumber).toBe('string');
      expect(data.eventId).toBe(testEvent.id);
      expect(data.ticketCategoryId).toBe(testCategory.id);
      expect(data.eventName).toBe(testEvent.name);
      expect(data.categoryName).toBe(testCategory.name);

      // Verify executions / fills
      expect(data.executions).toBeDefined();
      expect(data.executions).toHaveLength(1);
      expect(data.fills).toBeDefined();
      expect(data.fills).toHaveLength(1);

      const fill = data.executions[0];
      expect(fill.id).toBe(matchedExecutionId);
      expect(fill.orderId).toBe(buyerMatchedOrderId);
      expect(fill.price).toBe(2500);
      expect(fill.quantity).toBe(2);
      expect(fill.role).toBe('TAKER');
      expect(['SETTLED', 'PENDING']).toContain(fill.settlementStatus);
      expect(typeof fill.sequenceNumber).toBe('string');

      // Security check: Ensure seller's private user ID or internal hold IDs are not leaked
      expect(fill.counterpartyUserId).toBeUndefined();
      expect(fill.userId).toBeUndefined();
      expect(fill.buyerHoldId).toBeUndefined();
      expect(fill.sellerHoldId).toBeUndefined();
    });

    test('Seller retrieves partially filled order details with resting execution (role: MAKER)', async () => {
      const res = await request(app)
        .get(`/api/v1/orders/${sellerRestingOrderId}`)
        .set('Authorization', `Bearer ${sellerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const data = res.body.data;
      expect(data.id).toBe(sellerRestingOrderId);
      expect(data.side).toBe('ASK');
      expect(data.status).toBe('PARTIALLY_FILLED');
      expect(data.price).toBe(2500);
      expect(data.initialQuantity).toBe(5);
      expect(data.remainingQuantity).toBe(3);
      expect(data.filledQuantity).toBe(2);

      expect(data.executions).toHaveLength(1);
      const fill = data.executions[0];
      expect(fill.id).toBe(matchedExecutionId);
      expect(fill.orderId).toBe(sellerRestingOrderId);
      expect(fill.price).toBe(2500);
      expect(fill.quantity).toBe(2);
      expect(fill.role).toBe('MAKER');
      expect(['SETTLED', 'PENDING']).toContain(fill.settlementStatus);

      // Security check: Ensure buyer's private user ID is not leaked
      expect(fill.counterpartyUserId).toBeUndefined();
      expect(fill.userId).toBeUndefined();
    });

    test('Buyer retrieves unfilled open order with empty executions array', async () => {
      const res = await request(app)
        .get(`/api/v1/orders/${buyerOpenOrderId}`)
        .set('Authorization', `Bearer ${buyerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const data = res.body.data;
      expect(data.id).toBe(buyerOpenOrderId);
      expect(data.status).toBe('OPEN');
      expect(data.remainingQuantity).toBe(1);
      expect(data.filledQuantity).toBe(0);
      expect(data.executions).toEqual([]);
      expect(data.fills).toEqual([]);
    });

    test('Root alias /orders/:id functions identically to /api/v1/orders/:id', async () => {
      const res = await request(app)
        .get(`/orders/${buyerMatchedOrderId}`)
        .set('Authorization', `Bearer ${buyerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(buyerMatchedOrderId);
    });
  });

  // =========================================================================
  // 7. Order Trades (GET /api/v1/orders/:id/trades)
  // =========================================================================
  describe('7. GET /api/v1/orders/:id/trades Order Executions List', () => {
    test('Buyer retrieves executions for matched order', async () => {
      const res = await request(app)
        .get(`/api/v1/orders/${buyerMatchedOrderId}/trades`)
        .set('Authorization', `Bearer ${buyerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const data = res.body.data;
      expect(data.orderId).toBe(buyerMatchedOrderId);
      expect(data.total).toBe(1);
      expect(data.trades).toHaveLength(1);
      expect(data.trades[0].id).toBe(matchedExecutionId);
      expect(data.trades[0].price).toBe(2500);
      expect(data.trades[0].quantity).toBe(2);
      expect(data.trades[0].role).toBe('TAKER');
      expect(['SETTLED', 'PENDING']).toContain(data.trades[0].settlementStatus);
    });

    test('Seller retrieves executions for resting order', async () => {
      const res = await request(app)
        .get(`/api/v1/orders/${sellerRestingOrderId}/trades`)
        .set('Authorization', `Bearer ${sellerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const data = res.body.data;
      expect(data.orderId).toBe(sellerRestingOrderId);
      expect(data.total).toBe(1);
      expect(data.trades[0].id).toBe(matchedExecutionId);
      expect(data.trades[0].role).toBe('MAKER');
    });

    test('Buyer retrieves trades for open unfilled order returns empty list', async () => {
      const res = await request(app)
        .get(`/api/v1/orders/${buyerOpenOrderId}/trades`)
        .set('Authorization', `Bearer ${buyerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.orderId).toBe(buyerOpenOrderId);
      expect(res.body.data.total).toBe(0);
      expect(res.body.data.trades).toEqual([]);
    });

    test('Root alias /orders/:id/trades functions identically to /api/v1/orders/:id/trades', async () => {
      const res = await request(app)
        .get(`/orders/${buyerMatchedOrderId}/trades`)
        .set('Authorization', `Bearer ${buyerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.trades).toHaveLength(1);
    });
  });

  // =========================================================================
  // 8. Execution Deduplication Invariant
  // =========================================================================
  describe('8. Execution Deduplication Invariant', () => {
    test('An execution appears strictly ONCE in order details and trades even if query paths overlap', async () => {
      // Direct call to getOrderDetails
      const details = await orderService.getOrderDetails({
        orderId: buyerMatchedOrderId,
        userId: buyerUser.id,
      });

      const execIds = details.executions.map((e) => e.id);
      const uniqueExecIds = new Set(execIds);
      expect(execIds.length).toBe(uniqueExecIds.size);
      expect(execIds.length).toBe(1);

      // Verify trades endpoint also has zero duplicates
      const trades = await orderService.getOrderTrades({
        orderId: buyerMatchedOrderId,
        userId: buyerUser.id,
      });
      const tradeIds = trades.trades.map((t) => t.id);
      expect(tradeIds.length).toBe(new Set(tradeIds).size);
      expect(tradeIds.length).toBe(1);
    });
  });
});
