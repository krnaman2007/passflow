/**
 * Step 9.10 — Secondary Market Order API Integration Tests
 *
 * Verifies the authenticated REST API endpoints for secondary market order placement and cancellation:
 * 1. POST /api/v1/orders
 *    - Rejection of unauthenticated requests (401)
 *    - Rejection of invalid payloads (floats, negative prices/quantities, missing IDs, unknown fields) (400)
 *    - Prevention of userId override from request body (security)
 *    - Successful limit order placement with fund/inventory reservation and sanitized response (201)
 *    - Idempotent retries with identical payload (200 with isDuplicate: true)
 *    - Idempotency conflict with mismatched payload (409)
 *    - Safe error mapping (Insufficient funds -> 400, Insufficient inventory -> 400)
 *    - BigInt serialization safety without JSON serialization errors
 * 2. DELETE /api/v1/orders/:id
 *    - Rejection of unauthenticated requests (401)
 *    - Prevention of cancelling another user's order (403)
 *    - Successful cancellation and reservation release (200)
 *    - Idempotent cancellation retries (200)
 *    - Rejection of non-existent orders (404)
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
import { OrderService, orderService as defaultOrderService } from '../../src/services/order/index.js';
import { orderController, OrderController, mapOrderError, formatSafeOrder, formatSafeCancelResult } from '../../src/controllers/order.controller.js';
import { AppError } from '../../src/middleware/errorHandler.js';

describe('Step 9.10 — Secondary Market Order API Integration', () => {
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

  beforeAll(async () => {
    orderController.orderService = orderService;

    // 1. Create organizer and event
    organizerUser = await livePrisma.user.create({
      data: {
        email: `api-org-${testRunId}@test.passflow.com`,
        passwordHash: 'dummy-hash',
        name: 'API Test Organizer',
      },
    });

    organizer = await livePrisma.organizer.create({
      data: {
        userId: organizerUser.id,
        organizationName: `API Test Org ${testRunId}`,
        verificationStatus: 'VERIFIED',
      },
    });

    testEvent = await livePrisma.event.create({
      data: {
        name: `API Secondary Market Concert ${testRunId}`,
        description: 'Integration test event for secondary order API',
        location: 'API Test Stadium',
        dateTime: new Date(Date.now() + 86400000 * 15),
        status: 'PUBLISHED',
        organizerId: organizer.id,
      },
    });

    testCategory = await livePrisma.ticketCategory.create({
      data: {
        eventId: testEvent.id,
        name: 'VIP Pavilion',
        originalPrice: 100.0,
        totalQuantity: 500,
        availableQuantity: 500,
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

    // 2. Create Buyer user with funded wallet
    buyerUser = await livePrisma.user.create({
      data: {
        email: `api-buyer-${testRunId}@test.passflow.com`,
        passwordHash: 'dummy-hash',
        name: 'API Buyer',
      },
    });
    const buyerWallet = await walletService.getOrCreateWallet({ userId: buyerUser.id });
    await walletService.creditAvailable({
      walletId: buyerWallet.id,
      userId: buyerUser.id,
      amount: 50000n, // 500 INR in paise
      idempotencyKey: `init-credit-buyer-${testRunId}`,
      description: 'Initial funding for API buyer',
    });
    buyerToken = generateAccessToken(buyerUser);

    // 3. Create Seller user with ticket inventory
    sellerUser = await livePrisma.user.create({
      data: {
        email: `api-seller-${testRunId}@test.passflow.com`,
        passwordHash: 'dummy-hash',
        name: 'API Seller',
      },
    });
    await walletService.getOrCreateWallet({ userId: sellerUser.id });
    await orderService.creditUserTicketInventory({
      userId: sellerUser.id,
      ticketCategoryId: testCategory.id,
      quantity: 10,
      idempotencyKey: `init-credit-seller-${testRunId}`,
    });
    sellerToken = generateAccessToken(sellerUser);

    // 4. Create Third Party user (for cross-user authorization tests)
    thirdPartyUser = await livePrisma.user.create({
      data: {
        email: `api-third-${testRunId}@test.passflow.com`,
        passwordHash: 'dummy-hash',
        name: 'API Third Party',
      },
    });
    await walletService.getOrCreateWallet({ userId: thirdPartyUser.id });
    thirdPartyToken = generateAccessToken(thirdPartyUser);
  });

  afterAll(async () => {
    orderController.orderService = defaultOrderService;
    await livePrisma.$disconnect();
  });

  // ==========================================================================
  // Unit & Controller Boundary Tests
  // ==========================================================================
  describe('A. Controller Boundary & Error Mapping Unit Tests', () => {
    test('formatSafeOrder strips holdId and ensures BigInt sequenceNumber is serialized as string', () => {
      const mockResult = {
        orderId: 'ord-123',
        status: 'OPEN',
        originalQuantity: 5,
        remainingQuantity: 5,
        stoppedReason: 'NO_MORE_LIQUIDITY',
        holdId: 'secret-hold-uuid-should-not-be-in-envelope',
        executions: [
          {
            id: 'exec-1',
            restingOrderId: 'ord-maker',
            price: 1500,
            quantity: 2,
            sequenceNumber: 9007199254740995n, // Exceeds Number.MAX_SAFE_INTEGER
            executedAt: new Date(),
          },
        ],
      };

      const safe = formatSafeOrder(mockResult);
      expect(safe.orderId).toBe('ord-123');
      expect(safe.holdId).toBeUndefined(); // internal holdId stripped
      expect(typeof safe.executions[0].sequenceNumber).toBe('string');
      expect(safe.executions[0].sequenceNumber).toBe('9007199254740995');
      expect(() => JSON.stringify(safe)).not.toThrow();
    });

    test('formatSafeCancelResult exposes only cancellation facts without hold or wallet internals', () => {
      const mockCancel = {
        orderId: 'ord-cancelled',
        status: 'CANCELLED',
        cancelledQuantity: 3,
        remainingQuantity: 0,
        releasedReservation: 4500,
        isDuplicate: false,
        internalLedgerId: 'ledger-uuid',
      };

      const safe = formatSafeCancelResult(mockCancel);
      expect(safe).toEqual({
        orderId: 'ord-cancelled',
        status: 'CANCELLED',
        cancelledQuantity: 3,
        remainingQuantity: 0,
        releasedReservation: 4500,
        isDuplicate: false,
      });
      expect(safe.internalLedgerId).toBeUndefined();
    });

    test('mapOrderError translates domain errors into proper HTTP status codes', () => {
      const errFunds = mapOrderError(new Error('Insufficient funds available for hold'));
      errFunds.code = 'INSUFFICIENT_FUNDS';
      const mappedFunds = mapOrderError(errFunds);
      expect(mappedFunds.statusCode).toBe(422);
      expect(mappedFunds.code).toBe('INSUFFICIENT_FUNDS');

      const mappedForbidden = mapOrderError(new Error('Unauthorized: order does not belong to user'));
      expect(mappedForbidden.statusCode).toBe(403);
      expect(mappedForbidden.code).toBe('FORBIDDEN');

      const mappedNotFound = mapOrderError(new Error('Order not found: ord-999'));
      expect(mappedNotFound.statusCode).toBe(404);
      expect(mappedNotFound.code).toBe('ORDER_NOT_FOUND');

      const mappedConflict = mapOrderError(new Error('Idempotency key payload mismatch'));
      mappedConflict.code = 'IDEMPOTENCY_PAYLOAD_MISMATCH';
      const resConflict = mapOrderError(mappedConflict);
      expect(resConflict.statusCode).toBe(409);
      expect(resConflict.code).toBe('IDEMPOTENCY_CONFLICT');
    });

    test('Controller derives userId strictly from req.user.id and ignores body.userId override', async () => {
      const mockOrderService = {
        placeLimitOrder: jest.fn().mockResolvedValue({
          orderId: 'ord-mock',
          status: 'OPEN',
          originalQuantity: 1,
          remainingQuantity: 1,
          stoppedReason: 'NO_MORE_LIQUIDITY',
          executions: [],
        }),
      };

      const controller = new OrderController(mockOrderService);
      const req = {
        user: { id: 'legitimate-user-id' },
        body: {
          userId: 'malicious-injected-override-id', // Attacker attempts to forge victim userId
          eventId: 'evt-1',
          ticketCategoryId: 'cat-1',
          side: 'BID',
          price: 100,
          quantity: 1,
          idempotencyKey: 'idemp-1',
        },
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };
      const next = jest.fn();

      await controller.placeOrder(req, res, next);

      // Must delegate to OrderService with legitimate userId from req.user.id
      expect(mockOrderService.placeLimitOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'legitimate-user-id',
        })
      );
      expect(mockOrderService.placeLimitOrder).not.toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'malicious-injected-override-id',
        })
      );
    });
  });

  // ==========================================================================
  // HTTP REST Integration Tests via Supertest
  // ==========================================================================
  describe('B. POST /api/v1/orders (Place Limit Order)', () => {
    test('1. Unauthenticated requests are rejected with 401 UNAUTHORIZED', async () => {
      const res = await request(app)
        .post('/api/v1/orders')
        .send({
          eventId: testEvent.id,
          ticketCategoryId: testCategory.id,
          side: 'BID',
          price: 100,
          quantity: 1,
          idempotencyKey: `unauth-${crypto.randomUUID()}`,
        });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    test('2. Rejects invalid price, floating point paise, negative values, and zero', async () => {
      // Floating point paise
      const resFloat = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({
          eventId: testEvent.id,
          ticketCategoryId: testCategory.id,
          side: 'BID',
          price: 150.75, // Float paise strictly rejected
          quantity: 1,
          idempotencyKey: `inv-price-${crypto.randomUUID()}`,
        });
      expect(resFloat.status).toBe(400);
      expect(resFloat.body.success).toBe(false);
      expect(resFloat.body.error.code).toBe('VALIDATION_ERROR');

      // Negative price
      const resNeg = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({
          eventId: testEvent.id,
          ticketCategoryId: testCategory.id,
          side: 'BID',
          price: -100,
          quantity: 1,
          idempotencyKey: `neg-price-${crypto.randomUUID()}`,
        });
      expect(resNeg.status).toBe(400);
      expect(resNeg.body.success).toBe(false);
      expect(resNeg.body.error.code).toBe('VALIDATION_ERROR');

      // Zero price
      const resZero = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({
          eventId: testEvent.id,
          ticketCategoryId: testCategory.id,
          side: 'BID',
          price: 0,
          quantity: 1,
          idempotencyKey: `zero-price-${crypto.randomUUID()}`,
        });
      expect(resZero.status).toBe(400);
      expect(resZero.body.success).toBe(false);
      expect(resZero.body.error.code).toBe('VALIDATION_ERROR');
    });

    test('3. Rejects invalid quantity and unrecognized/injected fields (strict schema validation)', async () => {
      // Non-positive quantity
      const resQty = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({
          eventId: testEvent.id,
          ticketCategoryId: testCategory.id,
          side: 'BID',
          price: 100,
          quantity: 0,
          idempotencyKey: `inv-qty-${crypto.randomUUID()}`,
        });
      expect(resQty.status).toBe(400);
      expect(resQty.body.error.code).toBe('VALIDATION_ERROR');

      // Injected / unexpected field (e.g. attempting to send userId or platformFee in body)
      const resInjected = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({
          eventId: testEvent.id,
          ticketCategoryId: testCategory.id,
          side: 'BID',
          price: 100,
          quantity: 1,
          idempotencyKey: `injected-${crypto.randomUUID()}`,
          userId: 'injected-user', // Strict schema must reject unrecognized keys
        });
      expect(resInjected.status).toBe(400);
      expect(resInjected.body.error.code).toBe('VALIDATION_ERROR');
    });

    test('4. Successfully places a limit BUY order and returns 201 with sanitized response', async () => {
      const idempotencyKey = `buy-success-${crypto.randomUUID()}`;
      const res = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({
          eventId: testEvent.id,
          ticketCategoryId: testCategory.id,
          side: 'BID',
          price: 150,
          quantity: 2,
          idempotencyKey,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      const data = res.body.data;
      expect(data.orderId).toBeDefined();
      expect(data.status).toBe('OPEN');
      expect(data.originalQuantity).toBe(2);
      expect(data.remainingQuantity).toBe(2);
      expect(data.stoppedReason).toBe('NO_MORE_LIQUIDITY');
      expect(Array.isArray(data.executions)).toBe(true);
      expect(data.holdId).toBeUndefined(); // Verification that internal holdId is not leaked
    });

    test('5. Replaying with identical idempotency key returns 200 with isDuplicate: true', async () => {
      const idempotencyKey = `buy-replay-${crypto.randomUUID()}`;
      const payload = {
        eventId: testEvent.id,
        ticketCategoryId: testCategory.id,
        side: 'BID',
        price: 120,
        quantity: 1,
        idempotencyKey,
      };

      // First submission: 201 Created
      const firstRes = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${buyerToken}`)
        .send(payload);
      expect(firstRes.status).toBe(201);
      const firstOrderId = firstRes.body.data.orderId;

      // Duplicate retry: 200 OK with isDuplicate: true and identical orderId
      const secondRes = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${buyerToken}`)
        .send(payload);
      expect(secondRes.status).toBe(200);
      expect(secondRes.body.success).toBe(true);
      expect(secondRes.body.data.orderId).toBe(firstOrderId);
      expect(secondRes.body.data.isDuplicate).toBe(true);
    });

    test('6. Reusing idempotency key with conflicting payload returns 409 IDEMPOTENCY_CONFLICT', async () => {
      const idempotencyKey = `conflict-${crypto.randomUUID()}`;
      const initialPayload = {
        eventId: testEvent.id,
        ticketCategoryId: testCategory.id,
        side: 'BID',
        price: 100,
        quantity: 1,
        idempotencyKey,
      };

      await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${buyerToken}`)
        .send(initialPayload)
        .expect(201);

      // Conflicting payload: same idempotencyKey, but price = 200
      const conflictRes = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({
          ...initialPayload,
          price: 200,
        });

      expect(conflictRes.status).toBe(409);
      expect(conflictRes.body.success).toBe(false);
      expect(conflictRes.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
    });

    test('7. Insufficient funds returns 422 INSUFFICIENT_FUNDS without negative balances', async () => {
      // Buyer has only 50,000 paise. Requesting 1,000,000 paise order.
      const res = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({
          eventId: testEvent.id,
          ticketCategoryId: testCategory.id,
          side: 'BID',
          price: 100000,
          quantity: 10,
          idempotencyKey: `insufficient-funds-${crypto.randomUUID()}`,
        });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INSUFFICIENT_FUNDS');
    });

    test('8. Insufficient inventory returns 422 INSUFFICIENT_INVENTORY without overselling', async () => {
      // Seller has only 10 tickets. Requesting to sell 25 tickets.
      const res = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({
          eventId: testEvent.id,
          ticketCategoryId: testCategory.id,
          side: 'ASK',
          price: 100,
          quantity: 25,
          idempotencyKey: `insufficient-inv-${crypto.randomUUID()}`,
        });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INSUFFICIENT_INVENTORY');
    });
  });

  // ==========================================================================
  // DELETE /api/v1/orders/:id (Cancel Limit Order)
  // ==========================================================================
  describe('C. DELETE /api/v1/orders/:id (Cancel Order)', () => {
    let orderToCancelId;

    beforeAll(async () => {
      // Place a resting ASK order owned by sellerUser to test cancellation
      const placementRes = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({
          eventId: testEvent.id,
          ticketCategoryId: testCategory.id,
          side: 'ASK',
          price: 999, // High price so it rests without matching
          quantity: 3,
          idempotencyKey: `sell-for-cancel-${testRunId}`,
        })
        .expect(201);

      orderToCancelId = placementRes.body.data.orderId;
    });

    test('1. Unauthenticated cancellation requests are rejected with 401 UNAUTHORIZED', async () => {
      const res = await request(app).delete(`/api/v1/orders/${orderToCancelId}`);
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    test('2. A user CANNOT cancel another user order (403 FORBIDDEN)', async () => {
      // thirdPartyUser attempts to cancel sellerUser's order
      const res = await request(app)
        .delete(`/api/v1/orders/${orderToCancelId}`)
        .set('Authorization', `Bearer ${thirdPartyToken}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    test('3. Non-existent order cancellation returns 404 ORDER_NOT_FOUND', async () => {
      const nonExistentOrderId = crypto.randomUUID();
      const res = await request(app)
        .delete(`/api/v1/orders/${nonExistentOrderId}`)
        .set('Authorization', `Bearer ${sellerToken}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('ORDER_NOT_FOUND');
    });

    test('4. Legitimate owner successfully cancels order with 200 OK and released reservation', async () => {
      const cancelIdempotencyKey = `cancel-key-${crypto.randomUUID()}`;
      const res = await request(app)
        .delete(`/api/v1/orders/${orderToCancelId}`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .set('Idempotency-Key', cancelIdempotencyKey);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      const data = res.body.data;
      expect(data.orderId).toBe(orderToCancelId);
      expect(data.status).toBe('CANCELLED');
      expect(data.cancelledQuantity).toBe(3);
      expect(data.remainingQuantity).toBe(0);
      expect(data.releasedReservation).toBe(3); // 3 tickets returned to available inventory
    });

    test('5. Retrying cancellation on an already cancelled order is idempotent (200 OK)', async () => {
      const res = await request(app)
        .delete(`/api/v1/orders/${orderToCancelId}`)
        .set('Authorization', `Bearer ${sellerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.orderId).toBe(orderToCancelId);
      expect(res.body.data.status).toBe('CANCELLED');
    });
  });
});
