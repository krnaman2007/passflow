/**
 * Step 9.12 — Secondary Market Trade Read APIs Integration Tests
 *
 * Verifies authenticated and public REST API read endpoints:
 * 1. GET /api/v1/trades (and /trades)
 *    - Rejection of unauthenticated requests (401 UNAUTHORIZED)
 *    - Empty results for user with no executed trades (200 with empty list & pagination)
 *    - Pagination boundaries and validation (page, limit)
 *    - Filtering by settlementStatus / status (PENDING, SETTLED, MANUAL_REVIEW)
 *    - Filtering by user order side (BID, ASK, BUY, SELL)
 *    - Filtering by event (eventId, event) and category (ticketCategoryId, categoryId)
 *    - Rejection of invalid filter parameters (400 VALIDATION_ERROR)
 * 2. GET /api/v1/trades/:id (and /trades/:id)
 *    - Rejection of unauthenticated requests (401 UNAUTHORIZED)
 *    - Participant authorization: Non-participant rejected with 403 FORBIDDEN
 *    - Non-existent trade ID returns 404 TRADE_NOT_FOUND
 *    - Incoming participant retrieves trade details with role 'TAKER' and user's own order ID
 *    - Resting participant retrieves trade details with role 'MAKER' and user's own order ID
 *    - Privacy: Never exposes counterparty user IDs, counterparty order IDs, hold IDs, or wallet IDs
 *    - Persisted settlement status and settlement receipt verification
 * 3. GET /api/v1/events/:id/trades (and /events/:id/trades)
 *    - Public access without authentication (200 OK)
 *    - Approved public fields only: id, price, quantity, sequenceNumber, timestamp, eventId, categoryId
 *    - Absolute omission of user IDs, order IDs, hold IDs, or private financial details
 *    - Event validation: Non-existent event returns 404 EVENT_NOT_FOUND
 *    - Optional category filtering and validation: Non-existent category returns 404 CATEGORY_NOT_FOUND
 *    - Pagination support (page, limit) and validation (400 for out-of-bounds parameters)
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
import { HistoryService } from '../../src/services/history.service.js';
import { tradeController } from '../../src/controllers/trade.controller.js';
import { orderController } from '../../src/controllers/order.controller.js';

describe('Step 9.12 — Secondary Market Trade Read APIs Integration', () => {
  jest.setTimeout(60000);

  const testRunId = Math.random().toString(36).substring(2, 8);
  const walletService = new WalletService({ prismaClient: livePrisma });
  const orderRepository = new OrderRepository({ prismaClient: livePrisma });
  const matchingService = new PersistentMatchingService({ repository: orderRepository });
  const settlementService = new TradeSettlementService({ prismaClient: livePrisma });
  const historyService = new HistoryService({ prismaClient: livePrisma });
  const orderService = new OrderService({
    prismaClient: livePrisma,
    walletService,
    matchingService,
    orderRepository,
    settlementService,
    historyService,
  });

  let organizerUser;
  let organizer;
  let testEvent;
  let vipCategory;
  let generalCategory;

  let buyerUser;
  let buyerToken;
  let sellerUser;
  let sellerToken;
  let thirdPartyUser;
  let thirdPartyToken;

  let vipExecutionId;
  let generalExecutionId;
  let buyerVipOrderId;
  let sellerVipOrderId;

  beforeAll(async () => {
    orderController.orderService = orderService;
    tradeController.historyService = historyService;

    // 1. Create Organizer and Event
    organizerUser = await livePrisma.user.create({
      data: {
        email: `trade-org-${testRunId}@test.passflow.com`,
        passwordHash: 'dummy-hash',
        name: 'Trade Read Organizer',
      },
    });

    organizer = await livePrisma.organizer.create({
      data: {
        userId: organizerUser.id,
        organizationName: `Trade Read Org ${testRunId}`,
        verificationStatus: 'VERIFIED',
      },
    });

    testEvent = await livePrisma.event.create({
      data: {
        name: `Trade Read Championship ${testRunId}`,
        description: 'Integration test event for trade read APIs',
        location: 'Trade Stadium',
        dateTime: new Date(Date.now() + 86400000 * 30),
        status: 'PUBLISHED',
        organizerId: organizer.id,
      },
    });

    // 2. Create Two Ticket Categories (VIP and General)
    vipCategory = await livePrisma.ticketCategory.create({
      data: {
        eventId: testEvent.id,
        name: 'VIP Platinum',
        originalPrice: 200.0,
        totalQuantity: 100,
        availableQuantity: 100,
        status: 'ACTIVE',
      },
    });

    generalCategory = await livePrisma.ticketCategory.create({
      data: {
        eventId: testEvent.id,
        name: 'General Admission',
        originalPrice: 80.0,
        totalQuantity: 300,
        availableQuantity: 300,
        status: 'ACTIVE',
      },
    });

    // 3. Synchronize in-memory order books for both markets
    const vipBook = new OrderBook({
      eventId: testEvent.id,
      ticketCategoryId: vipCategory.id,
    });
    const vipMarketKey = matchingService.registerMarketBook(
      { eventId: testEvent.id, ticketCategoryId: vipCategory.id },
      vipBook,
      { synchronized: true }
    );
    matchingService.stateManager.transition(vipMarketKey, 'READY');

    const generalBook = new OrderBook({
      eventId: testEvent.id,
      ticketCategoryId: generalCategory.id,
    });
    const generalMarketKey = matchingService.registerMarketBook(
      { eventId: testEvent.id, ticketCategoryId: generalCategory.id },
      generalBook,
      { synchronized: true }
    );
    matchingService.stateManager.transition(generalMarketKey, 'READY');

    // 4. Create Users
    buyerUser = await livePrisma.user.create({
      data: {
        email: `trade-buyer-${testRunId}@test.passflow.com`,
        passwordHash: 'dummy-hash',
        name: 'Trade Buyer',
      },
    });
    buyerToken = generateAccessToken({ id: buyerUser.id, email: buyerUser.email, role: 'USER' });

    sellerUser = await livePrisma.user.create({
      data: {
        email: `trade-seller-${testRunId}@test.passflow.com`,
        passwordHash: 'dummy-hash',
        name: 'Trade Seller',
      },
    });
    sellerToken = generateAccessToken({ id: sellerUser.id, email: sellerUser.email, role: 'USER' });

    thirdPartyUser = await livePrisma.user.create({
      data: {
        email: `trade-thirdparty-${testRunId}@test.passflow.com`,
        passwordHash: 'dummy-hash',
        name: 'Trade Third Party',
      },
    });
    thirdPartyToken = generateAccessToken({ id: thirdPartyUser.id, email: thirdPartyUser.email, role: 'USER' });

    // Initialize user wallets
    const buyerWallet = await walletService.getOrCreateWallet({ userId: buyerUser.id });
    await walletService.getOrCreateWallet({ userId: sellerUser.id });
    await walletService.getOrCreateWallet({ userId: thirdPartyUser.id });

    // Fund buyer wallet (1,000,000 paise = ₹10,000.00)
    await walletService.creditAvailable({
      walletId: buyerWallet.id,
      amount: 1000000n,
      idempotencyKey: `fund-trade-buyer-${testRunId}`,
      entryType: 'DEPOSIT',
      operationType: 'DEPOSIT',
    });

    // Credit seller inventory: 10 VIP tickets, 10 General tickets
    await orderService.creditUserTicketInventory({
      userId: sellerUser.id,
      ticketCategoryId: vipCategory.id,
      quantity: 10,
      idempotencyKey: `credit-trade-seller-vip-${testRunId}`,
    });
    await orderService.creditUserTicketInventory({
      userId: sellerUser.id,
      ticketCategoryId: generalCategory.id,
      quantity: 10,
      idempotencyKey: `credit-trade-seller-gen-${testRunId}`,
    });

    // 5. Execute Match 1 (VIP): Seller lists 5 VIP tickets at 3000 paise, Buyer matches 2 tickets at 3000 paise
    const sellerVipPlacement = await orderService.placeLimitOrder({
      userId: sellerUser.id,
      eventId: testEvent.id,
      ticketCategoryId: vipCategory.id,
      side: 'ASK',
      price: 3000,
      quantity: 5,
      idempotencyKey: `seller-vip-order-${testRunId}`,
    });
    sellerVipOrderId = sellerVipPlacement.orderId;

    const buyerVipPlacement = await orderService.placeLimitOrder({
      userId: buyerUser.id,
      eventId: testEvent.id,
      ticketCategoryId: vipCategory.id,
      side: 'BID',
      price: 3000,
      quantity: 2,
      idempotencyKey: `buyer-vip-order-${testRunId}`,
    });
    buyerVipOrderId = buyerVipPlacement.orderId;
    expect(buyerVipPlacement.executions).toHaveLength(1);
    vipExecutionId = buyerVipPlacement.executions[0].id;

    // 6. Execute Match 2 (General): Seller lists 3 General tickets at 1500 paise, Buyer matches 3 tickets at 1500 paise
    await orderService.placeLimitOrder({
      userId: sellerUser.id,
      eventId: testEvent.id,
      ticketCategoryId: generalCategory.id,
      side: 'ASK',
      price: 1500,
      quantity: 3,
      idempotencyKey: `seller-gen-order-${testRunId}`,
    });

    const buyerGenPlacement = await orderService.placeLimitOrder({
      userId: buyerUser.id,
      eventId: testEvent.id,
      ticketCategoryId: generalCategory.id,
      side: 'BID',
      price: 1500,
      quantity: 3,
      idempotencyKey: `buyer-gen-order-${testRunId}`,
    });
    expect(buyerGenPlacement.executions).toHaveLength(1);
    generalExecutionId = buyerGenPlacement.executions[0].id;
  });

  afterAll(async () => {
    await livePrisma.$disconnect();
  });

  // =========================================================================
  // 1. Authentication Enforcement (401 UNAUTHORIZED)
  // =========================================================================
  describe('1. Authentication Validation (401 UNAUTHORIZED)', () => {
    test('GET /api/v1/trades rejects unauthenticated requests with 401', async () => {
      const res = await request(app).get('/api/v1/trades');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    test('GET /trades root alias rejects unauthenticated requests with 401', async () => {
      const res = await request(app).get('/trades');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    test('GET /api/v1/trades/:id rejects unauthenticated requests with 401', async () => {
      const res = await request(app).get(`/api/v1/trades/${vipExecutionId}`);
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    test('GET /trades/:id root alias rejects unauthenticated requests with 401', async () => {
      const res = await request(app).get(`/trades/${vipExecutionId}`);
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    test('Rejects requests with forged or invalid Bearer tokens', async () => {
      const res = await request(app)
        .get('/api/v1/trades')
        .set('Authorization', 'Bearer forged.token.signature');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(['UNAUTHORIZED', 'INVALID_TOKEN']).toContain(res.body.error.code);
    });
  });

  // =========================================================================
  // 2. Participant Authorization & Privacy (403 FORBIDDEN)
  // =========================================================================
  describe('2. Participant Authorization & Privacy (403 FORBIDDEN)', () => {
    test('Non-participant user cannot retrieve execution details (403 FORBIDDEN)', async () => {
      const res = await request(app)
        .get(`/api/v1/trades/${vipExecutionId}`)
        .set('Authorization', `Bearer ${thirdPartyToken}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('FORBIDDEN');
      expect(res.body.error.message).toMatch(/not authorized/i);
      expect(res.body.data).toBeUndefined();
    });

    test('Root alias /trades/:id enforces identical 403 authorization denial', async () => {
      const res = await request(app)
        .get(`/trades/${vipExecutionId}`)
        .set('Authorization', `Bearer ${thirdPartyToken}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });
  });

  // =========================================================================
  // 3. Nonexistent Trade ID (404 TRADE_NOT_FOUND)
  // =========================================================================
  describe('3. Non-Existent Trade Handling (404 TRADE_NOT_FOUND)', () => {
    test('GET /api/v1/trades/:id with non-existent UUID returns 404 TRADE_NOT_FOUND', async () => {
      const nonExistentId = crypto.randomUUID();
      const res = await request(app)
        .get(`/api/v1/trades/${nonExistentId}`)
        .set('Authorization', `Bearer ${buyerToken}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('TRADE_NOT_FOUND');
      expect(res.body.error.message).toContain(nonExistentId);
    });
  });

  // =========================================================================
  // 4. Authenticated User Trades Listing & Filtering (GET /api/v1/trades)
  // =========================================================================
  describe('4. GET /api/v1/trades Listing & Filtering', () => {
    test('Third party with zero trades receives empty list and valid pagination', async () => {
      const res = await request(app)
        .get('/api/v1/trades')
        .set('Authorization', `Bearer ${thirdPartyToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.trades).toEqual([]);
      expect(res.body.data.pagination).toEqual({
        page: 1,
        limit: 20,
        total: 0,
        totalPages: 1,
      });
    });

    test('Buyer retrieves all executed trades (VIP and General)', async () => {
      const res = await request(app)
        .get('/api/v1/trades')
        .set('Authorization', `Bearer ${buyerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.trades.length).toBeGreaterThanOrEqual(2);

      const tradeIds = res.body.data.trades.map((t) => t.id);
      expect(tradeIds).toContain(vipExecutionId);
      expect(tradeIds).toContain(generalExecutionId);

      // Verify buyer's perspective: side is BID and role is TAKER
      for (const trade of res.body.data.trades) {
        expect(trade.side).toBe('BID');
        expect(trade.role).toBe('TAKER');
        // Ensure counterparty user ID is not exposed
        expect(trade.counterpartyUserId).toBeUndefined();
        expect(trade.sellerId).toBeUndefined();
      }
    });

    test('Seller retrieves all executed trades (VIP and General)', async () => {
      const res = await request(app)
        .get('/api/v1/trades')
        .set('Authorization', `Bearer ${sellerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.trades.length).toBeGreaterThanOrEqual(2);

      // Verify seller's perspective: side is ASK and role is MAKER
      for (const trade of res.body.data.trades) {
        expect(trade.side).toBe('ASK');
        expect(trade.role).toBe('MAKER');
        // Ensure buyer user ID is not exposed
        expect(trade.counterpartyUserId).toBeUndefined();
        expect(trade.buyerId).toBeUndefined();
      }
    });

    test('Root alias /trades functions identically to /api/v1/trades', async () => {
      const res = await request(app)
        .get('/trades')
        .set('Authorization', `Bearer ${buyerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.trades.length).toBeGreaterThanOrEqual(2);
    });

    test('Filter by side=BUY and side=BID returns buyer trades', async () => {
      const resBuy = await request(app)
        .get('/api/v1/trades?side=BUY')
        .set('Authorization', `Bearer ${buyerToken}`);
      expect(resBuy.status).toBe(200);
      expect(resBuy.body.data.trades.length).toBeGreaterThanOrEqual(2);

      const resBid = await request(app)
        .get('/api/v1/trades?side=BID')
        .set('Authorization', `Bearer ${buyerToken}`);
      expect(resBid.status).toBe(200);
      expect(resBid.body.data.trades.length).toBe(resBuy.body.data.trades.length);

      // Seller filtering by BUY returns zero trades
      const resSellerBuy = await request(app)
        .get('/api/v1/trades?side=BUY')
        .set('Authorization', `Bearer ${sellerToken}`);
      expect(resSellerBuy.status).toBe(200);
      expect(resSellerBuy.body.data.trades).toHaveLength(0);
    });

    test('Filter by side=SELL and side=ASK returns seller trades', async () => {
      const resSell = await request(app)
        .get('/api/v1/trades?side=SELL')
        .set('Authorization', `Bearer ${sellerToken}`);
      expect(resSell.status).toBe(200);
      expect(resSell.body.data.trades.length).toBeGreaterThanOrEqual(2);

      const resAsk = await request(app)
        .get('/api/v1/trades?side=ASK')
        .set('Authorization', `Bearer ${sellerToken}`);
      expect(resAsk.status).toBe(200);
      expect(resAsk.body.data.trades.length).toBe(resSell.body.data.trades.length);

      // Buyer filtering by SELL returns zero trades
      const resBuyerSell = await request(app)
        .get('/api/v1/trades?side=SELL')
        .set('Authorization', `Bearer ${buyerToken}`);
      expect(resBuyerSell.status).toBe(200);
      expect(resBuyerSell.body.data.trades).toHaveLength(0);
    });

    test('Filter by ticketCategoryId and categoryId returns only matching category trades', async () => {
      const resVip = await request(app)
        .get(`/api/v1/trades?ticketCategoryId=${vipCategory.id}`)
        .set('Authorization', `Bearer ${buyerToken}`);
      expect(resVip.status).toBe(200);
      expect(resVip.body.data.trades).toHaveLength(1);
      expect(resVip.body.data.trades[0].id).toBe(vipExecutionId);
      expect(resVip.body.data.trades[0].price).toBe(3000);

      const resGen = await request(app)
        .get(`/api/v1/trades?categoryId=${generalCategory.id}`)
        .set('Authorization', `Bearer ${buyerToken}`);
      expect(resGen.status).toBe(200);
      expect(resGen.body.data.trades).toHaveLength(1);
      expect(resGen.body.data.trades[0].id).toBe(generalExecutionId);
      expect(resGen.body.data.trades[0].price).toBe(1500);
    });

    test('Filter by settlementStatus=SETTLED returns settled trades', async () => {
      const res = await request(app)
        .get('/api/v1/trades?settlementStatus=SETTLED')
        .set('Authorization', `Bearer ${buyerToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.trades.length).toBeGreaterThanOrEqual(2);
      expect(res.body.data.trades.every((t) => t.settlementStatus === 'SETTLED')).toBe(true);
    });

    test('Pagination: page=1&limit=1 returns single item with totalPages >= 2', async () => {
      const res = await request(app)
        .get('/api/v1/trades?page=1&limit=1')
        .set('Authorization', `Bearer ${buyerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.trades).toHaveLength(1);
      expect(res.body.data.pagination.page).toBe(1);
      expect(res.body.data.pagination.limit).toBe(1);
      expect(res.body.data.pagination.total).toBeGreaterThanOrEqual(2);
      expect(res.body.data.pagination.totalPages).toBeGreaterThanOrEqual(2);
    });

    test('Validation: Rejects invalid side with 400 VALIDATION_ERROR', async () => {
      const res = await request(app)
        .get('/api/v1/trades?side=INVALID_SIDE')
        .set('Authorization', `Bearer ${buyerToken}`);
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    test('Validation: Rejects invalid settlementStatus with 400 VALIDATION_ERROR', async () => {
      const res = await request(app)
        .get('/api/v1/trades?status=COMPLETED')
        .set('Authorization', `Bearer ${buyerToken}`);
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    test('Validation: Rejects non-positive page or limit with 400 VALIDATION_ERROR', async () => {
      const resZeroPage = await request(app)
        .get('/api/v1/trades?page=0')
        .set('Authorization', `Bearer ${buyerToken}`);
      expect(resZeroPage.status).toBe(400);
      expect(resZeroPage.body.error.code).toBe('VALIDATION_ERROR');

      const resOverLimit = await request(app)
        .get('/api/v1/trades?limit=150')
        .set('Authorization', `Bearer ${buyerToken}`);
      expect(resOverLimit.status).toBe(400);
      expect(resOverLimit.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  // =========================================================================
  // 5. Single Trade Details & Persisted Settlement Status (GET /api/v1/trades/:id)
  // =========================================================================
  describe('5. GET /api/v1/trades/:id Trade Details & Settlement Status', () => {
    test('Buyer (incoming taker) retrieves trade details and actual settlement receipt', async () => {
      const res = await request(app)
        .get(`/api/v1/trades/${vipExecutionId}`)
        .set('Authorization', `Bearer ${buyerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const data = res.body.data;
      expect(data.id).toBe(vipExecutionId);
      expect(data.orderId).toBe(buyerVipOrderId);
      expect(data.role).toBe('TAKER');
      expect(data.side).toBe('BID');
      expect(data.price).toBe(3000);
      expect(data.quantity).toBe(2);
      expect(data.totalAmount).toBe(60); // ₹60.00
      expect(data.totalAmountPaise).toBe('6000');
      expect(data.settlementStatus).toBe('SETTLED');
      expect(typeof data.sequenceNumber).toBe('string');
      expect(data.eventId).toBe(testEvent.id);
      expect(data.ticketCategoryId).toBe(vipCategory.id);

      // Verify settlement receipt details
      expect(data.settlement).toBeDefined();
      expect(data.settlement.id).toBeDefined();
      expect(data.settlement.executionPricePaise).toBe(3000);
      expect(data.settlement.settledAt).toBeDefined();

      // Security check: Private counterparty and hold internals are never exposed
      expect(data.counterpartyUserId).toBeUndefined();
      expect(data.sellerOrderId).toBeUndefined();
      expect(data.buyerHoldId).toBeUndefined();
      expect(data.sellerHoldId).toBeUndefined();
    });

    test('Seller (resting maker) retrieves trade details with maker role and seller order ID', async () => {
      const res = await request(app)
        .get(`/api/v1/trades/${vipExecutionId}`)
        .set('Authorization', `Bearer ${sellerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const data = res.body.data;
      expect(data.id).toBe(vipExecutionId);
      expect(data.orderId).toBe(sellerVipOrderId);
      expect(data.role).toBe('MAKER');
      expect(data.side).toBe('ASK');
      expect(data.price).toBe(3000);
      expect(data.quantity).toBe(2);
      expect(data.settlementStatus).toBe('SETTLED');

      // Security check: Private buyer info is never exposed
      expect(data.counterpartyUserId).toBeUndefined();
      expect(data.buyerOrderId).toBeUndefined();
    });

    test('Root alias /trades/:id functions identically to /api/v1/trades/:id', async () => {
      const res = await request(app)
        .get(`/trades/${vipExecutionId}`)
        .set('Authorization', `Bearer ${buyerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(vipExecutionId);
    });
  });

  // =========================================================================
  // 6. Public Event Recent Trades (GET /api/v1/events/:id/trades)
  // =========================================================================
  describe('6. GET /api/v1/events/:id/trades Public Recent Executions', () => {
    test('Public access without authentication succeeds with 200 OK', async () => {
      const res = await request(app).get(`/api/v1/events/${testEvent.id}/trades`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.eventId).toBe(testEvent.id);
      expect(res.body.data.eventName).toBe(testEvent.name);
      expect(res.body.data.trades.length).toBeGreaterThanOrEqual(2);
      expect(res.body.data.pagination.total).toBeGreaterThanOrEqual(2);
    });

    test('Root alias /events/:id/trades functions identically to /api/v1/events/:id/trades', async () => {
      const res = await request(app).get(`/events/${testEvent.id}/trades`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.trades.length).toBeGreaterThanOrEqual(2);
    });

    test('Public trade items expose only approved public fields and zero private data', async () => {
      const res = await request(app).get(`/api/v1/events/${testEvent.id}/trades`);
      expect(res.status).toBe(200);

      const trades = res.body.data.trades;
      expect(trades.length).toBeGreaterThanOrEqual(1);

      for (const t of trades) {
        // Approved public fields
        expect(t.id).toBeDefined();
        expect(t.tradeId).toBeDefined();
        expect(t.price).toBeGreaterThan(0);
        expect(t.quantity).toBeGreaterThan(0);
        expect(typeof t.sequenceNumber).toBe('string');
        expect(t.timestamp).toBeDefined();
        expect(t.eventId).toBe(testEvent.id);
        expect(t.categoryId).toBeDefined();

        // Strictly forbidden private fields
        expect(t.userId).toBeUndefined();
        expect(t.buyerUserId).toBeUndefined();
        expect(t.sellerUserId).toBeUndefined();
        expect(t.orderId).toBeUndefined();
        expect(t.incomingOrderId).toBeUndefined();
        expect(t.restingOrderId).toBeUndefined();
        expect(t.buyerHoldId).toBeUndefined();
        expect(t.sellerHoldId).toBeUndefined();
        expect(t.settlement).toBeUndefined();
      }
    });

    test('Public event trades are ordered in reverse chronological / sequence order', async () => {
      const res = await request(app).get(`/api/v1/events/${testEvent.id}/trades`);
      const trades = res.body.data.trades;

      for (let i = 0; i < trades.length - 1; i++) {
        const seqCurrent = BigInt(trades[i].sequenceNumber);
        const seqNext = BigInt(trades[i + 1].sequenceNumber);
        expect(seqCurrent >= seqNext).toBe(true);
      }
    });

    test('Filter by categoryId returns only trades for the specified category', async () => {
      const resVip = await request(app).get(
        `/api/v1/events/${testEvent.id}/trades?categoryId=${vipCategory.id}`
      );
      expect(resVip.status).toBe(200);
      expect(resVip.body.data.categoryId).toBe(vipCategory.id);
      expect(resVip.body.data.categoryName).toBe(vipCategory.name);
      expect(resVip.body.data.trades).toHaveLength(1);
      expect(resVip.body.data.trades[0].id).toBe(vipExecutionId);
      expect(resVip.body.data.trades[0].price).toBe(3000);

      const resGen = await request(app).get(
        `/api/v1/events/${testEvent.id}/trades?ticketCategoryId=${generalCategory.id}`
      );
      expect(resGen.status).toBe(200);
      expect(resGen.body.data.trades).toHaveLength(1);
      expect(resGen.body.data.trades[0].id).toBe(generalExecutionId);
      expect(resGen.body.data.trades[0].price).toBe(1500);
    });

    test('Non-existent event ID returns 404 EVENT_NOT_FOUND', async () => {
      const nonExistentEventId = crypto.randomUUID();
      const res = await request(app).get(`/api/v1/events/${nonExistentEventId}/trades`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('EVENT_NOT_FOUND');
    });

    test('Non-existent category ID for event returns 404 CATEGORY_NOT_FOUND', async () => {
      const nonExistentCatId = crypto.randomUUID();
      const res = await request(app).get(
        `/api/v1/events/${testEvent.id}/trades?categoryId=${nonExistentCatId}`
      );

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('CATEGORY_NOT_FOUND');
    });

    test('Pagination on public event trades works accurately', async () => {
      const res = await request(app).get(
        `/api/v1/events/${testEvent.id}/trades?page=1&limit=1`
      );
      expect(res.status).toBe(200);
      expect(res.body.data.trades).toHaveLength(1);
      expect(res.body.data.pagination.page).toBe(1);
      expect(res.body.data.pagination.limit).toBe(1);
      expect(res.body.data.pagination.total).toBeGreaterThanOrEqual(2);
      expect(res.body.data.pagination.totalPages).toBeGreaterThanOrEqual(2);
    });

    test('Validation: Rejects invalid page or limit with 400 VALIDATION_ERROR', async () => {
      const resZeroPage = await request(app).get(
        `/api/v1/events/${testEvent.id}/trades?page=0`
      );
      expect(resZeroPage.status).toBe(400);
      expect(resZeroPage.body.error.code).toBe('VALIDATION_ERROR');

      const resOverLimit = await request(app).get(
        `/api/v1/events/${testEvent.id}/trades?limit=500`
      );
      expect(resOverLimit.status).toBe(400);
      expect(resOverLimit.body.error.code).toBe('VALIDATION_ERROR');
    });
  });
});
