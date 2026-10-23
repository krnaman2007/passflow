/**
 * Step 9.13 — Settlement and Escrow HTTP APIs Integration Tests
 *
 * Verifies authenticated REST API endpoints:
 * 1. GET /api/v1/settlements/:id (and /settlements/:id)
 *    - Unauthenticated requests rejected (401 UNAUTHORIZED)
 *    - Participant authorization: Non-participant rejected with 403 FORBIDDEN
 *    - Administrator access: Admin can inspect any settlement
 *    - Non-existent ID returns 404 SETTLEMENT_NOT_FOUND
 *    - Invalid UUID returns 400 VALIDATION_ERROR
 *    - Pending execution returns status: 'PENDING', hasReceipt: false, settlement: null
 *    - Settled execution returns status: 'SETTLED', hasReceipt: true, and receipt details
 *    - Manual-review execution returns status: 'MANUAL_REVIEW', hasReceipt: false, settlement: null
 *    - Privacy: Never exposes counterparty user IDs, counterparty order IDs, hold IDs, or wallet IDs to participants
 * 2. GET /api/v1/escrows/:id (and /escrows/:id)
 *    - Unauthenticated requests rejected (401 UNAUTHORIZED)
 *    - Owner authorization: Non-owner regular user rejected with 403 FORBIDDEN
 *    - Administrator access: Admin can inspect any escrow hold
 *    - Non-existent ID returns 404 ESCROW_NOT_FOUND
 *    - Invalid UUID returns 400 VALIDATION_ERROR
 *    - Returns real persisted status (ACTIVE, PARTIALLY_SETTLED, SETTLED, etc.) and stringified minor unit amounts
 *    - Resolves both by WalletHold ID and linked Order ID
 * 3. POST /api/v1/settlements/:id/retry (and /settlements/:id/retry)
 *    - Unauthenticated requests rejected (401 UNAUTHORIZED)
 *    - Authenticated regular user (non-admin) rejected with 403 FORBIDDEN
 *    - Non-existent ID returns 404 EXECUTION_NOT_FOUND
 *    - Invalid UUID returns 400 VALIDATION_ERROR
 *    - Rejection of already settled execution (409 SETTLEMENT_ALREADY_SETTLED)
 *    - Rejection of manual-review execution (409 SETTLEMENT_MANUAL_REVIEW_REQUIRED)
 *    - Safe retry of eligible PENDING execution by administrator:
 *      - Transitions execution to SETTLED
 *      - Creates TradeSettlement receipt
 *      - Moves wallet funds and updates balances
 *      - Transfers ticket ownership
 *      - Records audit log in AuditLog table
 *    - Concurrent retry requests: no duplicate wallet movements, ledger entries, or settlement receipts
 */

import { jest } from '@jest/globals';
import request from 'supertest';
import crypto from 'node:crypto';
import app from '../../src/app.js';
import { prisma as livePrisma } from '../../src/db/prisma.js';
import { generateAccessToken } from '../../src/utils/token.js';
import { WalletService } from '../../src/services/wallet/index.js';
import { TradeSettlementService } from '../../src/services/settlement/index.js';
import { SettlementApiService } from '../../src/services/settlement/settlement-api.service.js';
import { settlementController } from '../../src/controllers/settlement.controller.js';

describe('Step 9.13 — Settlement and Escrow HTTP APIs Integration', () => {
  jest.setTimeout(60000);

  const testRunId = Math.random().toString(36).substring(2, 8);
  const walletService = new WalletService({ prismaClient: livePrisma });
  const settlementService = new TradeSettlementService({ prismaClient: livePrisma });
  const settlementApiService = new SettlementApiService({
    prismaClient: livePrisma,
    settlementService,
  });

  let organizerUser;
  let organizer;
  let testEvent;
  let vipCategory;

  let buyerUser;
  let buyerToken;
  let buyerWallet;

  let sellerUser;
  let sellerToken;
  let sellerWallet;

  let adminUser;
  let adminToken;
  let adminRecord;

  let thirdPartyUser;
  let thirdPartyToken;

  // Test executions & holds
  let settledExecutionId;
  let settledTradeSettlementId;
  let pendingExecutionId;
  let manualReviewExecutionId;
  let activeBuyerHoldId;
  let buyerOrderId;
  let sellerOrderId;

  beforeAll(async () => {
    settlementController.settlementService = settlementApiService;

    // 1. Create Admin User & Admin Record
    adminUser = await livePrisma.user.create({
      data: {
        email: `admin-settle-${testRunId}@test.passflow.com`,
        passwordHash: 'dummy-hash',
        name: 'Settlement Admin',
        role: 'ADMIN',
      },
    });
    adminToken = generateAccessToken(adminUser);

    adminRecord = await livePrisma.admin.create({
      data: {
        userId: adminUser.id,
        name: 'Settlement Admin',
        email: adminUser.email,
        role: 'ADMIN',
      },
    });

    // 2. Create Organizer & Event
    organizerUser = await livePrisma.user.create({
      data: {
        email: `org-settle-${testRunId}@test.passflow.com`,
        passwordHash: 'dummy-hash',
        name: 'Settlement Event Organizer',
      },
    });

    organizer = await livePrisma.organizer.create({
      data: {
        userId: organizerUser.id,
        organizationName: `Settlement Org ${testRunId}`,
        verificationStatus: 'VERIFIED',
      },
    });

    testEvent = await livePrisma.event.create({
      data: {
        name: `Settlement Test Event ${testRunId}`,
        description: 'Settlement API Integration Event',
        dateTime: new Date(Date.now() + 86400000 * 30),
        location: 'Settlement Stadium',
        organizerId: organizer.id,
        status: 'PUBLISHED',
      },
    });

    vipCategory = await livePrisma.ticketCategory.create({
      data: {
        eventId: testEvent.id,
        name: 'VIP Tier',
        originalPrice: 30.0,
        totalQuantity: 100,
        availableQuantity: 100,
      },
    });

    // 3. Create Buyer, Seller, Third Party Users
    buyerUser = await livePrisma.user.create({
      data: {
        email: `buyer-settle-${testRunId}@test.passflow.com`,
        passwordHash: 'dummy-hash',
        name: 'Settlement Buyer',
      },
    });
    buyerToken = generateAccessToken(buyerUser);

    sellerUser = await livePrisma.user.create({
      data: {
        email: `seller-settle-${testRunId}@test.passflow.com`,
        passwordHash: 'dummy-hash',
        name: 'Settlement Seller',
      },
    });
    sellerToken = generateAccessToken(sellerUser);

    thirdPartyUser = await livePrisma.user.create({
      data: {
        email: `thirdparty-settle-${testRunId}@test.passflow.com`,
        passwordHash: 'dummy-hash',
        name: 'Third Party User',
      },
    });
    thirdPartyToken = generateAccessToken(thirdPartyUser);

    // 4. Create and fund Wallets
    buyerWallet = await walletService.getOrCreateWallet({ userId: buyerUser.id });
    await walletService.creditAvailable({
      walletId: buyerWallet.id,
      amount: 100000n, // 1,000.00 INR
      idempotencyKey: `init-deposit-buyer-${testRunId}`,
    });

    sellerWallet = await walletService.getOrCreateWallet({ userId: sellerUser.id });
    await walletService.creditAvailable({
      walletId: sellerWallet.id,
      amount: 10000n,
      idempotencyKey: `init-deposit-seller-${testRunId}`,
    });

    // 5. Create Seller's Ticket and inventory
    const sellerTicket1 = await livePrisma.ticket.create({
      data: {
        eventId: testEvent.id,
        categoryId: vipCategory.id,
        ownerId: sellerUser.id,
        faceValue: 30.0,
        currentPrice: 30.0,
        status: 'OWNED',
      },
    });

    const sellerTicket2 = await livePrisma.ticket.create({
      data: {
        eventId: testEvent.id,
        categoryId: vipCategory.id,
        ownerId: sellerUser.id,
        faceValue: 30.0,
        currentPrice: 30.0,
        status: 'OWNED',
      },
    });

    await livePrisma.userTicketInventory.create({
      data: {
        userId: sellerUser.id,
        ticketCategoryId: vipCategory.id,
        totalQuantity: 2,
        availableQuantity: 2,
        reservedQuantity: 0,
      },
    });

    // 6. Set up Order Escrow Hold for Buyer
    const holdAmount = 3000n; // 30.00 INR
    const holdRes = await walletService.reserveFunds({
      walletId: buyerWallet.id,
      amount: holdAmount,
      reason: 'ORDER_ESCROW',
      idempotencyKey: `buyer-hold-${testRunId}`,
    });
    activeBuyerHoldId = holdRes.hold.id;

    // 7. Create Orders
    const buyerOrder = await livePrisma.order.create({
      data: {
        userId: buyerUser.id,
        eventId: testEvent.id,
        ticketCategoryId: vipCategory.id,
        side: 'BID',
        status: 'FILLED',
        price: 3000,
        initialQuantity: 1,
        remainingQuantity: 0,
        idempotencyKey: `buyer-order-${testRunId}`,
      },
    });
    buyerOrderId = buyerOrder.id;

    // Link hold to order
    await livePrisma.walletHold.update({
      where: { id: activeBuyerHoldId },
      data: { orderId: buyerOrderId },
    });

    const sellerOrder = await livePrisma.order.create({
      data: {
        userId: sellerUser.id,
        eventId: testEvent.id,
        ticketCategoryId: vipCategory.id,
        side: 'ASK',
        status: 'FILLED',
        price: 3000,
        initialQuantity: 1,
        remainingQuantity: 0,
        idempotencyKey: `seller-order-${testRunId}`,
      },
    });
    sellerOrderId = sellerOrder.id;

    // Reserve ticket1 for sellerOrder
    await livePrisma.ticket.update({
      where: { id: sellerTicket1.id },
      data: { orderId: sellerOrderId, status: 'LISTED' },
    });
    await livePrisma.userTicketInventory.update({
      where: { userId_ticketCategoryId: { userId: sellerUser.id, ticketCategoryId: vipCategory.id } },
      data: { availableQuantity: 1, reservedQuantity: 1 },
    });

    // 8. Create Execution 1: SETTLED
    const settledExec = await livePrisma.execution.create({
      data: {
        incomingOrderId: buyerOrderId,
        restingOrderId: sellerOrderId,
        price: 3000,
        quantity: 1,
        settlementStatus: 'PENDING',
      },
    });
    settledExecutionId = settledExec.id;

    // Settle Execution 1 via settlementService
    const settleOutcome = await settlementService.settleExecution({ executionId: settledExecutionId });
    settledTradeSettlementId = settleOutcome.settlement.id;

    // 9. Create Execution 2: PENDING (eligible for retry)
    // Setup for Execution 2 (sellerTicket2 reserved for sellerOrder2)
    const holdRes2 = await walletService.reserveFunds({
      walletId: buyerWallet.id,
      amount: 3000n,
      reason: 'ORDER_ESCROW',
      idempotencyKey: `buyer-hold-pending-${testRunId}`,
    });

    const buyerOrder2 = await livePrisma.order.create({
      data: {
        userId: buyerUser.id,
        eventId: testEvent.id,
        ticketCategoryId: vipCategory.id,
        side: 'BID',
        status: 'OPEN',
        price: 3000,
        initialQuantity: 1,
        remainingQuantity: 0,
        idempotencyKey: `buyer-order-pending-${testRunId}`,
      },
    });
    await livePrisma.walletHold.update({
      where: { id: holdRes2.hold.id },
      data: { orderId: buyerOrder2.id },
    });

    const sellerOrder2 = await livePrisma.order.create({
      data: {
        userId: sellerUser.id,
        eventId: testEvent.id,
        ticketCategoryId: vipCategory.id,
        side: 'ASK',
        status: 'OPEN',
        price: 3000,
        initialQuantity: 1,
        remainingQuantity: 0,
        idempotencyKey: `seller-order-pending-${testRunId}`,
      },
    });
    await livePrisma.ticket.update({
      where: { id: sellerTicket2.id },
      data: { orderId: sellerOrder2.id, status: 'LISTED' },
    });
    await livePrisma.userTicketInventory.update({
      where: { userId_ticketCategoryId: { userId: sellerUser.id, ticketCategoryId: vipCategory.id } },
      data: { availableQuantity: 0, reservedQuantity: 1 },
    });

    const pendingExec = await livePrisma.execution.create({
      data: {
        incomingOrderId: buyerOrder2.id,
        restingOrderId: sellerOrder2.id,
        price: 3000,
        quantity: 1,
        settlementStatus: 'PENDING',
      },
    });
    pendingExecutionId = pendingExec.id;

    // 10. Create Execution 3: MANUAL_REVIEW
    const manualExec = await livePrisma.execution.create({
      data: {
        incomingOrderId: buyerOrderId,
        restingOrderId: sellerOrderId,
        price: 3000,
        quantity: 1,
        settlementStatus: 'MANUAL_REVIEW',
        retryCount: 5,
        lastErrorCode: 'PERMANENT_INVARIANT_VIOLATION',
      },
    });
    manualReviewExecutionId = manualExec.id;
  });

  afterAll(async () => {
    await livePrisma.$disconnect();
  });

  // =========================================================================
  // 1. Authentication Validation (401 UNAUTHORIZED)
  // =========================================================================
  describe('1. Authentication Validation (401 UNAUTHORIZED)', () => {
    test('GET /api/v1/settlements/:id rejects unauthenticated requests with 401', async () => {
      const res = await request(app).get(`/api/v1/settlements/${settledExecutionId}`);
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    test('GET /settlements/:id root alias rejects unauthenticated requests with 401', async () => {
      const res = await request(app).get(`/settlements/${settledExecutionId}`);
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    test('GET /api/v1/escrows/:id rejects unauthenticated requests with 401', async () => {
      const res = await request(app).get(`/api/v1/escrows/${activeBuyerHoldId}`);
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    test('GET /escrows/:id root alias rejects unauthenticated requests with 401', async () => {
      const res = await request(app).get(`/escrows/${activeBuyerHoldId}`);
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    test('POST /api/v1/settlements/:id/retry rejects unauthenticated requests with 401', async () => {
      const res = await request(app).post(`/api/v1/settlements/${pendingExecutionId}/retry`);
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    test('POST /settlements/:id/retry root alias rejects unauthenticated requests with 401', async () => {
      const res = await request(app).post(`/settlements/${pendingExecutionId}/retry`);
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    test('Rejects requests with forged Bearer token', async () => {
      const res = await request(app)
        .get(`/api/v1/settlements/${settledExecutionId}`)
        .set('Authorization', 'Bearer forged-or-expired-token');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });
  });

  // =========================================================================
  // 2. Administrator Authorization (403 FORBIDDEN for non-admin on retry)
  // =========================================================================
  describe('2. Administrator Authorization (403 FORBIDDEN on retry)', () => {
    test('Regular authenticated user (buyer) cannot call retry endpoint (403 FORBIDDEN)', async () => {
      const res = await request(app)
        .post(`/api/v1/settlements/${pendingExecutionId}/retry`)
        .set('Authorization', `Bearer ${buyerToken}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    test('Regular authenticated user (seller) cannot call retry root alias (403 FORBIDDEN)', async () => {
      const res = await request(app)
        .post(`/settlements/${pendingExecutionId}/retry`)
        .set('Authorization', `Bearer ${sellerToken}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });
  });

  // =========================================================================
  // 3. Participant Authorization & Privacy (403 FORBIDDEN for non-participants)
  // =========================================================================
  describe('3. Participant Authorization & Privacy', () => {
    test('Non-participant user cannot retrieve settlement details (403 FORBIDDEN)', async () => {
      const res = await request(app)
        .get(`/api/v1/settlements/${settledExecutionId}`)
        .set('Authorization', `Bearer ${thirdPartyToken}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    test('Non-owner user cannot retrieve escrow hold details (403 FORBIDDEN)', async () => {
      const res = await request(app)
        .get(`/api/v1/escrows/${activeBuyerHoldId}`)
        .set('Authorization', `Bearer ${thirdPartyToken}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    test('Participant buyer retrieves settlement details with role TAKER and own orderId', async () => {
      const res = await request(app)
        .get(`/api/v1/settlements/${settledExecutionId}`)
        .set('Authorization', `Bearer ${buyerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      const data = res.body.data;
      expect(data.executionId).toBe(settledExecutionId);
      expect(data.status).toBe('SETTLED');
      expect(data.hasReceipt).toBe(true);
      expect(data.role).toBe('TAKER');
      expect(data.side).toBe('BID');
      expect(data.orderId).toBe(buyerOrderId);

      // Privacy invariants: No counterparty IDs or wallet IDs
      expect(data.counterpartyUserId).toBeUndefined();
      expect(data.sellerOrderId).toBeUndefined();
      expect(data.walletId).toBeUndefined();
      expect(data.buyerHoldId).toBeUndefined();
    });

    test('Participant seller retrieves settlement details with role MAKER and own orderId', async () => {
      const res = await request(app)
        .get(`/api/v1/settlements/${settledExecutionId}`)
        .set('Authorization', `Bearer ${sellerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      const data = res.body.data;
      expect(data.executionId).toBe(settledExecutionId);
      expect(data.status).toBe('SETTLED');
      expect(data.hasReceipt).toBe(true);
      expect(data.role).toBe('MAKER');
      expect(data.side).toBe('ASK');
      expect(data.orderId).toBe(sellerOrderId);

      // Privacy invariants
      expect(data.counterpartyUserId).toBeUndefined();
      expect(data.buyerOrderId).toBeUndefined();
      expect(data.walletId).toBeUndefined();
      expect(data.buyerHoldId).toBeUndefined();
    });

    test('Administrator can inspect settlement details for any execution', async () => {
      const res = await request(app)
        .get(`/api/v1/settlements/${settledExecutionId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      const data = res.body.data;
      expect(data.executionId).toBe(settledExecutionId);
      expect(data.status).toBe('SETTLED');
      expect(data.hasReceipt).toBe(true);
      expect(data.buyerOrderId).toBe(buyerOrderId);
      expect(data.sellerOrderId).toBe(sellerOrderId);
    });

    test('Administrator can inspect any escrow hold', async () => {
      const res = await request(app)
        .get(`/api/v1/escrows/${activeBuyerHoldId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      const data = res.body.data;
      expect(data.id).toBe(activeBuyerHoldId);
      expect(data.walletId).toBe(buyerWallet.id);
      expect(data.userId).toBe(buyerUser.id);
    });
  });

  // =========================================================================
  // 4. Missing & Invalid ID Handling (400 and 404)
  // =========================================================================
  describe('4. Missing & Invalid ID Handling (400 / 404)', () => {
    test('GET /api/v1/settlements/:id with non-existent UUID returns 404 SETTLEMENT_NOT_FOUND', async () => {
      const nonExistentUuid = crypto.randomUUID();
      const res = await request(app)
        .get(`/api/v1/settlements/${nonExistentUuid}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('SETTLEMENT_NOT_FOUND');
    });

    test('GET /api/v1/settlements/invalid-uuid returns 400 VALIDATION_ERROR', async () => {
      const res = await request(app)
        .get('/api/v1/settlements/not-a-valid-uuid')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    test('GET /api/v1/escrows/:id with non-existent UUID returns 404 ESCROW_NOT_FOUND', async () => {
      const nonExistentUuid = crypto.randomUUID();
      const res = await request(app)
        .get(`/api/v1/escrows/${nonExistentUuid}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('ESCROW_NOT_FOUND');
    });

    test('GET /api/v1/escrows/invalid-uuid returns 400 VALIDATION_ERROR', async () => {
      const res = await request(app)
        .get('/api/v1/escrows/not-a-valid-uuid')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    test('POST /api/v1/settlements/:id/retry with non-existent UUID returns 404 EXECUTION_NOT_FOUND', async () => {
      const nonExistentUuid = crypto.randomUUID();
      const res = await request(app)
        .post(`/api/v1/settlements/${nonExistentUuid}/retry`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('EXECUTION_NOT_FOUND');
    });

    test('POST /api/v1/settlements/invalid-uuid/retry returns 400 VALIDATION_ERROR', async () => {
      const res = await request(app)
        .post('/api/v1/settlements/not-a-valid-uuid/retry')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  // =========================================================================
  // 5. Settlement Status & Receipt Representation (PENDING, SETTLED, MANUAL_REVIEW)
  // =========================================================================
  describe('5. Settlement Status & Receipt Representation', () => {
    test('Settled execution lookup by executionId returns SETTLED status and receipt facts', async () => {
      const res = await request(app)
        .get(`/api/v1/settlements/${settledExecutionId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      const data = res.body.data;
      expect(data.status).toBe('SETTLED');
      expect(data.hasReceipt).toBe(true);
      expect(data.settlement).toBeDefined();
      expect(data.settlement.id).toBe(settledTradeSettlementId);
      expect(data.settlement.executionPricePaise).toBe(3000);
      expect(data.settlement.executionCostPaise).toBe('3000');
      expect(data.settlement.priceImprovementPaise).toBe('0');
      expect(data.settlement.quantity).toBe(1);
    });

    test('Settled execution lookup by tradeSettlementId resolves identically', async () => {
      const res = await request(app)
        .get(`/api/v1/settlements/${settledTradeSettlementId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.executionId).toBe(settledExecutionId);
      expect(res.body.data.status).toBe('SETTLED');
      expect(res.body.data.hasReceipt).toBe(true);
    });

    test('Pending execution lookup clearly distinguishes missing receipt from completed settlement', async () => {
      const res = await request(app)
        .get(`/api/v1/settlements/${pendingExecutionId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      const data = res.body.data;
      expect(data.executionId).toBe(pendingExecutionId);
      expect(data.status).toBe('PENDING');
      expect(data.hasReceipt).toBe(false);
      expect(data.settlement).toBeNull();
    });

    test('Manual review execution lookup preserves MANUAL_REVIEW status and error metadata', async () => {
      const res = await request(app)
        .get(`/api/v1/settlements/${manualReviewExecutionId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      const data = res.body.data;
      expect(data.executionId).toBe(manualReviewExecutionId);
      expect(data.status).toBe('MANUAL_REVIEW');
      expect(data.hasReceipt).toBe(false);
      expect(data.settlement).toBeNull();
      expect(data.lastErrorCode).toBe('PERMANENT_INVARIANT_VIOLATION');
      expect(data.retryCount).toBe(5);
    });
  });

  // =========================================================================
  // 6. Escrow Status Endpoint (GET /api/v1/escrows/:id)
  // =========================================================================
  describe('6. Escrow Status Endpoint (GET /api/v1/escrows/:id)', () => {
    test('Hold owner retrieves real persisted WalletHold record with stringified paise amounts', async () => {
      const res = await request(app)
        .get(`/api/v1/escrows/${activeBuyerHoldId}`)
        .set('Authorization', `Bearer ${buyerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      const data = res.body.data;
      expect(data.id).toBe(activeBuyerHoldId);
      expect(data.orderId).toBe(buyerOrderId);
      expect(data.reason).toBe('ORDER_ESCROW');
      expect(['ACTIVE', 'PARTIALLY_SETTLED', 'SETTLED']).toContain(data.status);
      expect(typeof data.heldAmountPaise).toBe('string');
      expect(typeof data.remainingAmountPaise).toBe('string');
      expect(typeof data.releasedAmountPaise).toBe('string');
      expect(data.heldAmountPaise).toBe('3000');

      // Privacy: No walletId exposed to regular user
      expect(data.walletId).toBeUndefined();
    });

    test('Resolving escrow by linked orderId succeeds for hold owner', async () => {
      const res = await request(app)
        .get(`/api/v1/escrows/${buyerOrderId}`)
        .set('Authorization', `Bearer ${buyerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(activeBuyerHoldId);
      expect(res.body.data.orderId).toBe(buyerOrderId);
    });

    test('Root alias /escrows/:id functions identically to /api/v1/escrows/:id', async () => {
      const res = await request(app)
        .get(`/escrows/${activeBuyerHoldId}`)
        .set('Authorization', `Bearer ${buyerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(activeBuyerHoldId);
    });
  });

  // =========================================================================
  // 7. Admin Settlement Retry & State Transitions (POST /api/v1/settlements/:id/retry)
  // =========================================================================
  describe('7. Admin Settlement Retry & State Transitions', () => {
    test('Rejection of already settled execution returns 409 SETTLEMENT_ALREADY_SETTLED', async () => {
      const res = await request(app)
        .post(`/api/v1/settlements/${settledExecutionId}/retry`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('SETTLEMENT_ALREADY_SETTLED');
    });

    test('Rejection of manual-review execution returns 409 SETTLEMENT_MANUAL_REVIEW_REQUIRED', async () => {
      const res = await request(app)
        .post(`/api/v1/settlements/${manualReviewExecutionId}/retry`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('SETTLEMENT_MANUAL_REVIEW_REQUIRED');
    });

    test('Safe retry of eligible PENDING execution transitions to SETTLED and records audit log', async () => {
      const res = await request(app)
        .post(`/api/v1/settlements/${pendingExecutionId}/retry`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      const data = res.body.data;
      expect(data.executionId).toBe(pendingExecutionId);
      expect(data.status).toBe('SETTLED');
      expect(data.settlement).toBeDefined();
      expect(data.settlement.executionPricePaise).toBe(3000);
      expect(data.settlement.executionCostPaise).toBe('3000');

      // Verify execution in database is now SETTLED
      const dbExec = await livePrisma.execution.findUnique({
        where: { id: pendingExecutionId },
        include: { settlement: true },
      });
      expect(dbExec.settlementStatus).toBe('SETTLED');
      expect(dbExec.settlement).not.toBeNull();

      // Verify audit log entry was created
      const auditEntry = await livePrisma.auditLog.findFirst({
        where: {
          adminId: adminRecord.id,
          action: 'SETTLEMENT_RETRY',
        },
        orderBy: { timestamp: 'desc' },
      });
      expect(auditEntry).not.toBeNull();
      expect(auditEntry.action).toBe('SETTLEMENT_RETRY');
      expect(auditEntry.details?.executionId).toBe(pendingExecutionId);
    });

    test('Subsequent retry on the now-settled execution is rejected with 409 SETTLEMENT_ALREADY_SETTLED', async () => {
      const res = await request(app)
        .post(`/api/v1/settlements/${pendingExecutionId}/retry`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('SETTLEMENT_ALREADY_SETTLED');
    });
  });

  // =========================================================================
  // 8. Concurrency & Idempotency Protection
  // =========================================================================
  describe('8. Concurrency & Idempotency Protection', () => {
    test('Concurrent retry requests on an execution do not cause duplicate financial effects', async () => {
      // Create a fresh PENDING execution with dedicated hold & orders
      const holdRes = await walletService.reserveFunds({
        walletId: buyerWallet.id,
        amount: 3000n,
        reason: 'ORDER_ESCROW',
        idempotencyKey: `concurrent-buyer-hold-${testRunId}`,
      });

      const buyerOrderConc = await livePrisma.order.create({
        data: {
          userId: buyerUser.id,
          eventId: testEvent.id,
          ticketCategoryId: vipCategory.id,
          side: 'BID',
          status: 'OPEN',
          price: 3000,
          initialQuantity: 1,
          remainingQuantity: 0,
          idempotencyKey: `buyer-order-conc-${testRunId}`,
        },
      });
      await livePrisma.walletHold.update({
        where: { id: holdRes.hold.id },
        data: { orderId: buyerOrderConc.id },
      });

      const sellerOrderConc = await livePrisma.order.create({
        data: {
          userId: sellerUser.id,
          eventId: testEvent.id,
          ticketCategoryId: vipCategory.id,
          side: 'ASK',
          status: 'OPEN',
          price: 3000,
          initialQuantity: 1,
          remainingQuantity: 0,
          idempotencyKey: `seller-order-conc-${testRunId}`,
        },
      });

      const concTicket = await livePrisma.ticket.create({
        data: {
          eventId: testEvent.id,
          categoryId: vipCategory.id,
          ownerId: sellerUser.id,
          faceValue: 30.0,
          currentPrice: 30.0,
          status: 'LISTED',
          orderId: sellerOrderConc.id,
        },
      });

      await livePrisma.userTicketInventory.update({
        where: { userId_ticketCategoryId: { userId: sellerUser.id, ticketCategoryId: vipCategory.id } },
        data: { totalQuantity: { increment: 1 }, reservedQuantity: { increment: 1 } },
      });

      const concExec = await livePrisma.execution.create({
        data: {
          incomingOrderId: buyerOrderConc.id,
          restingOrderId: sellerOrderConc.id,
          price: 3000,
          quantity: 1,
          settlementStatus: 'PENDING',
        },
      });

      // Issue 3 concurrent retry requests
      const [res1, res2, res3] = await Promise.all([
        request(app)
          .post(`/api/v1/settlements/${concExec.id}/retry`)
          .set('Authorization', `Bearer ${adminToken}`),
        request(app)
          .post(`/api/v1/settlements/${concExec.id}/retry`)
          .set('Authorization', `Bearer ${adminToken}`),
        request(app)
          .post(`/api/v1/settlements/${concExec.id}/retry`)
          .set('Authorization', `Bearer ${adminToken}`),
      ]);

      const responses = [res1, res2, res3];
      // At least one must succeed with 200, others either return 200 (idempotent replay) or 409 (already settled)
      const successResponses = responses.filter((r) => r.status === 200);
      expect(successResponses.length).toBeGreaterThanOrEqual(1);

      for (const r of responses) {
        expect([200, 409]).toContain(r.status);
      }

      // Assert database integrity: Exactly ONE TradeSettlement created
      const settlements = await livePrisma.tradeSettlement.findMany({
        where: { executionId: concExec.id },
      });
      expect(settlements).toHaveLength(1);

      // Assert database integrity: Exactly ONE debit and ONE credit ledger entry created
      const ledgerEntries = await livePrisma.walletLedgerEntry.findMany({
        where: { executionId: concExec.id },
      });
      expect(ledgerEntries).toHaveLength(2);
      const debitEntries = ledgerEntries.filter((e) => e.entryType === 'TRADE_SETTLEMENT_DEBIT');
      const creditEntries = ledgerEntries.filter((e) => e.entryType === 'TRADE_SETTLEMENT_CREDIT');
      expect(debitEntries).toHaveLength(1);
      expect(creditEntries).toHaveLength(1);

      // Assert ticket ownership transferred to buyer exactly once
      const updatedTicket = await livePrisma.ticket.findUnique({
        where: { id: concTicket.id },
      });
      expect(updatedTicket.ownerId).toBe(buyerUser.id);
      expect(updatedTicket.status).toBe('OWNED');
    });
  });
});
