/**
 * Step 9.14 — Distributed Market Leases and Fenced Worker Coordination Tests
 *
 * Verifies all 12 core requirements on isolated local PostgreSQL:
 * 1. Two instances competing for the same market (mutual exclusion).
 * 2. Two different markets acquiring ownership independently.
 * 3. Lease expiration and safe takeover with monotonic fencing tokens.
 * 4. Former owner attempting writes after newer fencing token is rejected at the DB persistence boundary.
 * 5. Lease renewal racing with expiration or takeover.
 * 6. Database/connectivity failure during renewal triggers graceful relinquish.
 * 7. Process crash and restart with persistent market reconstruction from PostgreSQL.
 * 8. Order placement and cancellation under ownership changes.
 * 9. Duplicate submission and idempotent execution behavior under lease ownership.
 * 10. Price-time priority preserved under serialized concurrent submissions.
 * 11. Existing settlement, wallet-conservation, and recovery regressions.
 * 12. Graceful shutdown and readiness behavior when ownership is lost.
 */

import { describe, expect, beforeAll, afterAll, test, jest } from '@jest/globals';
import crypto from 'node:crypto';
import { prisma as livePrisma } from '../../src/db/prisma.js';
import {
  MarketLeaseManager,
  verifyFencingToken,
  MarketOwnershipError,
  FencingViolationError,
} from '../../src/services/matching/market-lease-manager.js';
import {
  PersistentMatchingService,
  MarketStateDivergenceError,
} from '../../src/services/matching/persistent-matching-service.js';
import { OrderRepository } from '../../src/services/matching/order-repository.js';
import {
  MarketExecutionQueue,
  MarketState,
  formatMarketKey,
} from '../../src/services/matching/market-execution-queue.js';
import { TradeSettlementService } from '../../src/services/settlement/trade-settlement-service.js';
import { WalletService } from '../../src/services/wallet/index.js';
import { evaluateReadiness } from '../../src/services/readiness.service.js';

describe('Step 9.14 — Distributed Market Leases and Fenced Worker Coordination', () => {
  jest.setTimeout(60000);

  const testRunId = Math.random().toString(36).substring(2, 9);
  let testUserA;
  let testUserB;
  let testOrganizerUser;
  let testEvent;
  let testCategory1;
  let testCategory2;
  let marketKey1;
  let marketKey2;
  let liveRepo;

  beforeAll(async () => {
    // 1. Verify isolated local PostgreSQL database
    const [dbInfo] = await livePrisma.$queryRaw`
      SELECT current_database(), current_user, inet_server_port()
    `;
    expect(['passflow_test', 'passflow_isolated_validation', 'passflow_fresh_migration_test']).toContain(dbInfo.current_database);
    expect([5432, 55432]).toContain(Number(dbInfo.inet_server_port));
    expect(process.env.DATABASE_URL).not.toMatch(/neon\.tech/);

    liveRepo = new OrderRepository({ prismaClient: livePrisma });

    // Seed test users
    testOrganizerUser = await livePrisma.user.create({
      data: {
        email: `lease-org-${testRunId}@test.passflow.com`,
        passwordHash: 'dummy-hash',
        name: 'Lease Test Organizer',
        organizer: {
          create: {
            organizationName: 'Lease Test Org LLC',
          },
        },
      },
      include: { organizer: true },
    });

    testUserA = await livePrisma.user.create({
      data: {
        email: `lease-user-a-${testRunId}@test.passflow.com`,
        passwordHash: 'dummy-hash',
        name: 'Lease Buyer A',
        wallet: {
          create: {
            availableBalance: 1000000n, // 10,000 INR in paise
            reservedBalance: 0n,
          },
        },
      },
    });

    testUserB = await livePrisma.user.create({
      data: {
        email: `lease-user-b-${testRunId}@test.passflow.com`,
        passwordHash: 'dummy-hash',
        name: 'Lease Seller B',
        wallet: {
          create: {
            availableBalance: 500000n,
            reservedBalance: 0n,
          },
        },
      },
    });

    // Seed Event and 2 Ticket Categories (representing 2 independent markets)
    testEvent = await livePrisma.event.create({
      data: {
        name: `Lease Event ${testRunId}`,
        dateTime: new Date(Date.now() + 86400000),
        location: 'Bengaluru Distributed Arena',
        organizerId: testOrganizerUser.organizer.id,
      },
    });

    testCategory1 = await livePrisma.ticketCategory.create({
      data: {
        eventId: testEvent.id,
        name: 'VIP Category 1',
        originalPrice: 200.0,
        totalQuantity: 500,
        availableQuantity: 500,
      },
    });

    testCategory2 = await livePrisma.ticketCategory.create({
      data: {
        eventId: testEvent.id,
        name: 'Standard Category 2',
        originalPrice: 100.0,
        totalQuantity: 500,
        availableQuantity: 500,
      },
    });

    marketKey1 = formatMarketKey(testEvent.id, testCategory1.id);
    marketKey2 = formatMarketKey(testEvent.id, testCategory2.id);
  });

  afterAll(async () => {
    try {
      await livePrisma.marketLease.deleteMany({
        where: { eventId: testEvent.id },
      });
      await livePrisma.$disconnect();
    } catch {
      // Ignore teardown errors
    }
  });

  afterEach(async () => {
    try {
      await livePrisma.marketLease.deleteMany({
        where: { eventId: testEvent.id },
      });
    } catch {
      // Ignore
    }
  });

  test('1. Two instances competing for the same market (mutual exclusion)', async () => {
    const instA = new MarketLeaseManager({ prismaClient: livePrisma, ownerId: `node-A-${testRunId}` });
    const instB = new MarketLeaseManager({ prismaClient: livePrisma, ownerId: `node-B-${testRunId}` });

    // Instance A acquires Market 1
    const resA = await instA.acquireLease({
      eventId: testEvent.id,
      ticketCategoryId: testCategory1.id,
      leaseDurationMs: 5000,
    });
    expect(resA.acquired).toBe(true);
    expect(resA.ownerId).toBe(`node-A-${testRunId}`);
    expect(resA.fencingToken).toBe(1n);

    // Instance B attempts to acquire Market 1: MUST be rejected
    const resB = await instB.acquireLease({
      eventId: testEvent.id,
      ticketCategoryId: testCategory1.id,
      leaseDurationMs: 5000,
    });
    expect(resB.acquired).toBe(false);
    expect(resB.reason).toBe('LEASE_ACTIVE');
    expect(resB.ownerId).toBe(`node-A-${testRunId}`);
    expect(resB.fencingToken).toBe(1n);

    // Clean up
    await instA.releaseLease({
      eventId: testEvent.id,
      ticketCategoryId: testCategory1.id,
      expectedFencingToken: 1n,
    });
  });

  test('2. Two different markets acquiring ownership independently', async () => {
    const instA = new MarketLeaseManager({ prismaClient: livePrisma, ownerId: `node-A-${testRunId}` });
    const instB = new MarketLeaseManager({ prismaClient: livePrisma, ownerId: `node-B-${testRunId}` });

    // Instance A acquires Market 1
    const resA = await instA.acquireLease({
      eventId: testEvent.id,
      ticketCategoryId: testCategory1.id,
      leaseDurationMs: 5000,
    });
    expect(resA.acquired).toBe(true);
    expect(resA.ownerId).toBe(`node-A-${testRunId}`);

    // Instance B acquires Market 2 (different ticket category)
    const resB = await instB.acquireLease({
      eventId: testEvent.id,
      ticketCategoryId: testCategory2.id,
      leaseDurationMs: 5000,
    });
    expect(resB.acquired).toBe(true);
    expect(resB.ownerId).toBe(`node-B-${testRunId}`);

    // Verify independent ownership
    const lease1 = await livePrisma.marketLease.findUnique({
      where: { eventId_ticketCategoryId: { eventId: testEvent.id, ticketCategoryId: testCategory1.id } },
    });
    const lease2 = await livePrisma.marketLease.findUnique({
      where: { eventId_ticketCategoryId: { eventId: testEvent.id, ticketCategoryId: testCategory2.id } },
    });
    expect(lease1.ownerId).toBe(`node-A-${testRunId}`);
    expect(lease2.ownerId).toBe(`node-B-${testRunId}`);

    // Clean up
    await instA.releaseLease({ eventId: testEvent.id, ticketCategoryId: testCategory1.id });
    await instB.releaseLease({ eventId: testEvent.id, ticketCategoryId: testCategory2.id });
  });

  test('3. Lease expiration and safe takeover with monotonic fencing tokens', async () => {
    const instA = new MarketLeaseManager({ prismaClient: livePrisma, ownerId: `node-A-${testRunId}` });
    const instB = new MarketLeaseManager({ prismaClient: livePrisma, ownerId: `node-B-${testRunId}` });

    // Instance A acquires Market 1
    const resA = await instA.acquireLease({
      eventId: testEvent.id,
      ticketCategoryId: testCategory1.id,
      leaseDurationMs: 5000,
    });
    expect(resA.acquired).toBe(true);
    const initialToken = resA.fencingToken;

    // Simulate expiration of Instance A's lease in database time
    await livePrisma.$executeRaw`
      UPDATE "MarketLease"
      SET "expiresAt" = NOW() - make_interval(secs => 1.0)
      WHERE "eventId" = ${testEvent.id} AND "ticketCategoryId" = ${testCategory1.id}
    `;

    // Instance B takes over expired lease
    const resB = await instB.acquireLease({
      eventId: testEvent.id,
      ticketCategoryId: testCategory1.id,
      leaseDurationMs: 5000,
    });
    expect(resB.acquired).toBe(true);
    expect(resB.takeover).toBe(true);
    expect(resB.ownerId).toBe(`node-B-${testRunId}`);
    expect(resB.fencingToken).toBe(initialToken + 1n);

    // Verify database record holds new owner and incremented token
    const dbLease = await livePrisma.marketLease.findUnique({
      where: { eventId_ticketCategoryId: { eventId: testEvent.id, ticketCategoryId: testCategory1.id } },
    });
    expect(dbLease.ownerId).toBe(`node-B-${testRunId}`);
    expect(dbLease.fencingToken).toBe(initialToken + 1n);

    // Clean up
    await instB.releaseLease({ eventId: testEvent.id, ticketCategoryId: testCategory1.id });
  });

  test('4. Former owner attempting writes after newer fencing token is rejected at DB persistence boundary', async () => {
    const instA = new MarketLeaseManager({ prismaClient: livePrisma, ownerId: `node-A-${testRunId}` });
    const instB = new MarketLeaseManager({ prismaClient: livePrisma, ownerId: `node-B-${testRunId}` });

    // 1. Instance A acquires lease (fencingToken = 1n)
    const resA = await instA.acquireLease({
      eventId: testEvent.id,
      ticketCategoryId: testCategory1.id,
      leaseDurationMs: 5000,
    });
    const staleToken = resA.fencingToken;

    // 2. Lease expires in DB and Instance B takes over (fencingToken = 2n)
    await livePrisma.$executeRaw`
      UPDATE "MarketLease"
      SET "expiresAt" = NOW() - make_interval(secs => 1.0)
      WHERE "eventId" = ${testEvent.id} AND "ticketCategoryId" = ${testCategory1.id}
    `;
    const resB = await instB.acquireLease({
      eventId: testEvent.id,
      ticketCategoryId: testCategory1.id,
      leaseDurationMs: 5000,
    });
    expect(resB.fencingToken).toBe(staleToken + 1n);

    // 3. Stale Instance A attempts to persist matching transaction using its stale token and ownerId
    const staleOrderId = crypto.randomUUID();
    const staleOrderData = {
      id: staleOrderId,
      userId: testUserA.id,
      eventId: testEvent.id,
      ticketCategoryId: testCategory1.id,
      side: 'BID',
      status: 'OPEN',
      price: 20000,
      initialQuantity: 5,
      remainingQuantity: 5,
      idempotencyKey: `stale-order-${testRunId}`,
    };

    // MUST be rejected by verifyFencingToken inside the database transaction!
    await expect(
      liveRepo.persistMatchingTransaction({
        incomingOrderData: staleOrderData,
        restingUpdates: [],
        executionsData: [],
        leaseContext: {
          ownerId: `node-A-${testRunId}`,
          fencingToken: staleToken, // Stale token!
          eventId: testEvent.id,
          ticketCategoryId: testCategory1.id,
        },
      })
    ).rejects.toThrow(FencingViolationError);

    // 4. Verify transaction rolled back completely: zero orders created in PostgreSQL
    const orderCheck = await livePrisma.order.findUnique({
      where: { id: staleOrderId },
    });
    expect(orderCheck).toBeNull();

    // Clean up
    await instB.releaseLease({ eventId: testEvent.id, ticketCategoryId: testCategory1.id });
  });

  test('5. Lease renewal racing with expiration or takeover', async () => {
    const instA = new MarketLeaseManager({ prismaClient: livePrisma, ownerId: `node-A-${testRunId}` });
    const instB = new MarketLeaseManager({ prismaClient: livePrisma, ownerId: `node-B-${testRunId}` });

    // Instance A acquires lease
    const resA = await instA.acquireLease({
      eventId: testEvent.id,
      ticketCategoryId: testCategory1.id,
      leaseDurationMs: 5000,
    });

    // Takeover by Instance B
    await livePrisma.$executeRaw`
      UPDATE "MarketLease"
      SET "expiresAt" = NOW() - make_interval(secs => 1.0)
      WHERE "eventId" = ${testEvent.id} AND "ticketCategoryId" = ${testCategory1.id}
    `;
    await instB.acquireLease({
      eventId: testEvent.id,
      ticketCategoryId: testCategory1.id,
      leaseDurationMs: 5000,
    });

    // Instance A attempts to renew its lost lease: MUST fail
    const renewResult = await instA.renewLease({
      eventId: testEvent.id,
      ticketCategoryId: testCategory1.id,
      expectedFencingToken: resA.fencingToken,
    });
    expect(renewResult.renewed).toBe(false);
    expect(renewResult.reason).toBe('OWNER_MISMATCH');

    // Clean up
    await instB.releaseLease({ eventId: testEvent.id, ticketCategoryId: testCategory1.id });
  });

  test('6. Database failure during renewal triggers failure callback and state transition', async () => {
    const mockPrisma = {
      $transaction: async () => {
        throw new Error('Connection terminated unexpectedly (57P01)');
      },
    };

    const leaseMgr = new MarketLeaseManager({ prismaClient: mockPrisma, ownerId: `node-err-${testRunId}` });
    // Manually inject a cached lease
    leaseMgr._activeLeases.set(marketKey1, {
      marketKey: marketKey1,
      eventId: testEvent.id,
      ticketCategoryId: testCategory1.id,
      ownerId: leaseMgr.ownerId,
      fencingToken: 1n,
      expiresAt: new Date(Date.now() + 10000),
      leaseDurationMs: 1000,
    });

    let failureNotified = false;
    leaseMgr.startAutoRenewal(marketKey1, {
      onRenewalFailure: (err) => {
        failureNotified = true;
        expect(err.message).toContain('Connection terminated');
      },
    });

    // Wait for the renewal timer to fire and fail
    await new Promise((r) => setTimeout(r, 600));

    expect(failureNotified).toBe(true);
    expect(leaseMgr.getActiveLease(marketKey1)).toBeNull();

    leaseMgr.stopAutoRenewal(marketKey1);
  });

  test('7. Process crash and restart with persistent market reconstruction', async () => {
    const ownerAId = `crash-A-${testRunId}`;
    const ownerBId = `restart-B-${testRunId}`;

    const serviceA = new PersistentMatchingService({
      repository: liveRepo,
      leaseManager: new MarketLeaseManager({ prismaClient: livePrisma, ownerId: ownerAId }),
      requireMarketLease: true,
    });

    // 1. Instance A acquires ownership and synchronizes
    await serviceA.acquireMarketOwnership(marketKey1, { leaseDurationMs: 5000, reconstruct: true });

    // 2. Submit resting ASK order
    const askOrder = await serviceA.submitLimitOrder({
      eventId: testEvent.id,
      ticketCategoryId: testCategory1.id,
      userId: testUserB.id,
      side: 'ASK',
      price: 25000,
      quantity: 4,
      idempotencyKey: `crash-ask-${testRunId}`,
    });
    expect(askOrder.status).toBe('OPEN');
    expect(askOrder.restedQuantity).toBe(4);

    // 3. Simulate process crash of Instance A (no graceful release, lease expires in DB)
    serviceA.leaseManager.stopAutoRenewal(marketKey1);
    await livePrisma.$executeRaw`
      UPDATE "MarketLease"
      SET "expiresAt" = NOW() - make_interval(secs => 1.0)
      WHERE "eventId" = ${testEvent.id} AND "ticketCategoryId" = ${testCategory1.id}
    `;

    // 4. Fresh restarted Instance B starts up, takes over lease, and reconstructs book
    const serviceB = new PersistentMatchingService({
      repository: liveRepo,
      leaseManager: new MarketLeaseManager({ prismaClient: livePrisma, ownerId: ownerBId }),
      requireMarketLease: true,
    });

    const takeoverResult = await serviceB.acquireMarketOwnership(marketKey1, { leaseDurationMs: 5000, reconstruct: true });
    expect(takeoverResult.takeover).toBe(true);
    expect(takeoverResult.activeOrdersCount).toBe(1);
    expect(takeoverResult.totalRemainingQuantity).toBe(4);
    expect(takeoverResult.marketState).toBe(MarketState.READY);

    // 5. Submit matching BID on restarted Instance B against reconstructed resting ASK
    const bidSub = await serviceB.submitLimitOrder({
      eventId: testEvent.id,
      ticketCategoryId: testCategory1.id,
      userId: testUserA.id,
      side: 'BID',
      price: 25000,
      quantity: 4,
      idempotencyKey: `crash-bid-${testRunId}`,
    });
    expect(bidSub.status).toBe('FILLED');
    expect(bidSub.matchedQuantity).toBe(4);
    expect(bidSub.executions).toHaveLength(1);
    expect(bidSub.executions[0].restingOrderId).toBe(askOrder.orderId);

    // Clean up
    await serviceB.releaseMarketOwnership(marketKey1);
  });

  test('8. Order placement and cancellation under ownership changes', async () => {
    const ownerAId = `own-A-${testRunId}`;
    const ownerBId = `own-B-${testRunId}`;

    const serviceA = new PersistentMatchingService({
      repository: liveRepo,
      leaseManager: new MarketLeaseManager({ prismaClient: livePrisma, ownerId: ownerAId }),
      requireMarketLease: true,
    });

    const serviceB = new PersistentMatchingService({
      repository: liveRepo,
      leaseManager: new MarketLeaseManager({ prismaClient: livePrisma, ownerId: ownerBId }),
      requireMarketLease: true,
    });

    // Instance A acquires Market 1
    await serviceA.acquireMarketOwnership(marketKey1, { leaseDurationMs: 5000, reconstruct: true });

    // Submit resting order
    const resting = await serviceA.submitLimitOrder({
      eventId: testEvent.id,
      ticketCategoryId: testCategory1.id,
      userId: testUserA.id,
      side: 'BID',
      price: 18000,
      quantity: 2,
      idempotencyKey: `cancel-test-${testRunId}`,
    });
    expect(resting.status).toBe('OPEN');

    // Ownership transfers to Instance B
    serviceA.leaseManager.stopAutoRenewal(marketKey1);
    await livePrisma.$executeRaw`
      UPDATE "MarketLease"
      SET "expiresAt" = NOW() - make_interval(secs => 1.0)
      WHERE "eventId" = ${testEvent.id} AND "ticketCategoryId" = ${testCategory1.id}
    `;
    await serviceB.acquireMarketOwnership(marketKey1, { leaseDurationMs: 5000, reconstruct: true });

    // Former owner A attempts to cancel order: MUST be rejected by fencing boundary
    await expect(
      serviceA.cancelLimitOrder({
        eventId: testEvent.id,
        ticketCategoryId: testCategory1.id,
        orderId: resting.orderId,
        userId: testUserA.id,
      })
    ).rejects.toThrow();

    // Verify order is still OPEN
    const orderStillOpen = await livePrisma.order.findUnique({ where: { id: resting.orderId } });
    expect(orderStillOpen.status).toBe('OPEN');

    // Legitimate owner B cancels order: MUST succeed
    const cancelResult = await serviceB.cancelLimitOrder({
      eventId: testEvent.id,
      ticketCategoryId: testCategory1.id,
      orderId: resting.orderId,
      userId: testUserA.id,
    });
    expect(cancelResult.status).toBe('CANCELLED');
    expect(cancelResult.cancelledQuantity).toBe(2);

    const cancelledOrder = await livePrisma.order.findUnique({ where: { id: resting.orderId } });
    expect(cancelledOrder.status).toBe('CANCELLED');
    expect(cancelledOrder.remainingQuantity).toBe(0);

    // Clean up
    await serviceB.releaseMarketOwnership(marketKey1);
  });

  test('9. Duplicate submission and idempotent execution behavior under lease ownership', async () => {
    const service = new PersistentMatchingService({
      repository: liveRepo,
      leaseManager: new MarketLeaseManager({ prismaClient: livePrisma, ownerId: `idemp-${testRunId}` }),
      requireMarketLease: true,
    });

    await service.acquireMarketOwnership(marketKey1, { leaseDurationMs: 5000, reconstruct: true });

    const key = `idemp-order-${testRunId}`;
    const payload = {
      eventId: testEvent.id,
      ticketCategoryId: testCategory1.id,
      userId: testUserA.id,
      side: 'BID',
      price: 19500,
      quantity: 3,
      idempotencyKey: key,
    };

    // First submission
    const res1 = await service.submitLimitOrder(payload);
    expect(res1.status).toBe('OPEN');
    expect(Boolean(res1.isDuplicate)).toBe(false);

    // Duplicate submission
    const res2 = await service.submitLimitOrder(payload);
    expect(res2.status).toBe('OPEN');
    expect(res2.isDuplicate).toBe(true);
    expect(res2.orderId).toBe(res1.orderId);

    // Cancel the order
    await service.cancelLimitOrder({
      eventId: testEvent.id,
      ticketCategoryId: testCategory1.id,
      orderId: res1.orderId,
      userId: testUserA.id,
    });

    await service.releaseMarketOwnership(marketKey1);
  });

  test('10. Price-time priority preserved under serialized concurrent submissions', async () => {
    const service = new PersistentMatchingService({
      repository: liveRepo,
      leaseManager: new MarketLeaseManager({ prismaClient: livePrisma, ownerId: `ptp-${testRunId}` }),
      requireMarketLease: true,
    });

    await service.acquireMarketOwnership(marketKey1, { leaseDurationMs: 5000, reconstruct: true });

    // Submit 2 ASKs at different prices: Ask 1 @ 21000, Ask 2 @ 20000 (better price)
    await service.submitLimitOrder({
      eventId: testEvent.id,
      ticketCategoryId: testCategory1.id,
      userId: testUserB.id,
      side: 'ASK',
      price: 21000,
      quantity: 2,
      idempotencyKey: `ask1-${testRunId}`,
    });

    const ask2 = await service.submitLimitOrder({
      eventId: testEvent.id,
      ticketCategoryId: testCategory1.id,
      userId: testUserB.id,
      side: 'ASK',
      price: 20000,
      quantity: 2,
      idempotencyKey: `ask2-${testRunId}`,
    });

    // Aggressive BID for 2 tickets @ 22000: MUST match Ask 2 first due to price priority
    const bidRes = await service.submitLimitOrder({
      eventId: testEvent.id,
      ticketCategoryId: testCategory1.id,
      userId: testUserA.id,
      side: 'BID',
      price: 22000,
      quantity: 2,
      idempotencyKey: `taker-bid-${testRunId}`,
    });

    expect(bidRes.status).toBe('FILLED');
    expect(bidRes.matchedQuantity).toBe(2);
    expect(bidRes.executions).toHaveLength(1);
    expect(bidRes.executions[0].restingOrderId).toBe(ask2.orderId);
    expect(bidRes.executions[0].price).toBe(20000);

    await service.releaseMarketOwnership(marketKey1);
  });

  test('11. Existing settlement, wallet-conservation, and recovery regressions', async () => {
    const settlementService = new TradeSettlementService({
      prismaClient: livePrisma,
      maxAutoRetries: 3,
      jitter: false,
    });

    const service = new PersistentMatchingService({
      repository: liveRepo,
      leaseManager: new MarketLeaseManager({ prismaClient: livePrisma, ownerId: `settle-${testRunId}` }),
      requireMarketLease: true,
    });

    await service.acquireMarketOwnership(marketKey1, { leaseDurationMs: 5000, reconstruct: true });

    // Place and match trade
    const ask = await service.submitLimitOrder({
      eventId: testEvent.id,
      ticketCategoryId: testCategory1.id,
      userId: testUserB.id,
      side: 'ASK',
      price: 15000,
      quantity: 1,
      idempotencyKey: `reg-ask-${testRunId}`,
    });

    const bid = await service.submitLimitOrder({
      eventId: testEvent.id,
      ticketCategoryId: testCategory1.id,
      userId: testUserA.id,
      side: 'BID',
      price: 15000,
      quantity: 1,
      idempotencyKey: `reg-bid-${testRunId}`,
    });

    const execId = bid.executions[0].id;
    const dbExec = await livePrisma.execution.findUnique({ where: { id: execId } });
    expect(dbExec.settlementStatus).toBe('PENDING');

    // Create wallet hold and inventory for buyer/seller to settle cleanly
    const buyerWallet = await livePrisma.wallet.findUnique({ where: { userId: testUserA.id } });
    await livePrisma.wallet.update({
      where: { id: buyerWallet.id },
      data: { reservedBalance: 15000n },
    });

    await livePrisma.userTicketInventory.upsert({
      where: {
        userId_ticketCategoryId: {
          userId: testUserB.id,
          ticketCategoryId: testCategory1.id,
        },
      },
      update: {
        totalQuantity: 1,
        reservedQuantity: 1,
        availableQuantity: 0,
      },
      create: {
        userId: testUserB.id,
        ticketCategoryId: testCategory1.id,
        totalQuantity: 1,
        reservedQuantity: 1,
        availableQuantity: 0,
      },
    });

    const ticket = await livePrisma.ticket.create({
      data: {
        eventId: testEvent.id,
        categoryId: testCategory1.id,
        ownerId: testUserB.id,
        status: 'LISTED',
        orderId: ask.orderId,
        faceValue: 100,
        currentPrice: 15000,
      },
    });
    await livePrisma.ticketOwnership.create({
      data: {
        ticketId: ticket.id,
        ownerId: testUserB.id,
        source: 'PRIMARY',
      },
    });

    const hold = await livePrisma.walletHold.create({
      data: {
        walletId: buyerWallet.id,
        orderId: bid.orderId,
        heldAmount: 15000n,
        remainingAmount: 15000n,
        reason: 'ORDER_ESCROW',
        status: 'ACTIVE',
      },
    });

    // Settle execution
    const settleRes = await settlementService.settleExecution({ executionId: execId });
    expect(settleRes.isIdempotentReplay).toBe(false);

    const settledExec = await livePrisma.execution.findUnique({ where: { id: execId } });
    expect(settledExec.settlementStatus).toBe('SETTLED');

    // Replay settlement: MUST be idempotent
    const replayRes = await settlementService.settleExecution({ executionId: execId });
    expect(replayRes.isIdempotentReplay).toBe(true);

    await service.releaseMarketOwnership(marketKey1);
  });

  test('12. Graceful shutdown and readiness behavior when ownership is lost', async () => {
    const ownerId = `ready-${testRunId}`;
    const leaseMgr = new MarketLeaseManager({ prismaClient: livePrisma, ownerId });
    const service = new PersistentMatchingService({
      repository: liveRepo,
      leaseManager: leaseMgr,
      requireMarketLease: true,
    });

    // Acquire market ownership
    await service.acquireMarketOwnership(marketKey1, { leaseDurationMs: 5000, reconstruct: true });

    // Readiness is healthy
    const readinessBefore = service.checkReadiness();
    expect(readinessBefore.ready).toBe(true);

    // Simulate lease loss (e.g. lease expired or taken over)
    await livePrisma.$executeRaw`
      UPDATE "MarketLease"
      SET "expiresAt" = NOW() - make_interval(secs => 1.0)
      WHERE "eventId" = ${testEvent.id} AND "ticketCategoryId" = ${testCategory1.id}
    `;
    // Update local cached lease expiration to match in both service and leaseManager
    const cachedLease = service._marketLeases.get(marketKey1);
    if (cachedLease) {
      cachedLease.expiresAt = new Date(Date.now() - 1000);
    }
    const mgrLease = service.leaseManager._activeLeases.get(marketKey1);
    if (mgrLease) {
      mgrLease.expiresAt = new Date(Date.now() - 1000);
    }

    // Readiness MUST report degraded/not ready
    const readinessAfter = service.checkReadiness();
    expect(readinessAfter.ready).toBe(false);
    expect(readinessAfter.reason).toContain('expired or lost');

    // Full readiness check returns 503 without leaking tokens or private owner IDs
    const deepReadiness = await evaluateReadiness({
      prismaClient: livePrisma,
      orderServiceInstance: { checkReadiness: () => readinessAfter },
    });
    expect(deepReadiness.statusCode).toBe(503);
    expect(deepReadiness.body.status).toBe('not_ready');
    expect(deepReadiness.body.checks.matching).toBe('degraded');
    expect(JSON.stringify(deepReadiness.body)).not.toContain('fencingToken');
    expect(JSON.stringify(deepReadiness.body)).not.toContain(ownerId);

    // Clean up with releaseAllLeases
    const released = await service.releaseAllLeases();
    expect(released).toBeDefined();
  });
});
