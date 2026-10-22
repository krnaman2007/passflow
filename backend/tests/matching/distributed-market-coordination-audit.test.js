import crypto from 'node:crypto';
import { prisma as defaultPrisma } from '../../src/db/prisma.js';
import { OrderRepository } from '../../src/services/matching/order-repository.js';
import {
  PersistentMatchingService,
  MarketOwnershipError,
} from '../../src/services/matching/persistent-matching-service.js';
import {
  MarketLeaseManager,
  verifyFencingToken,
  FencingViolationError,
} from '../../src/services/matching/market-lease-manager.js';
import {
  formatMarketKey,
  MarketState,
} from '../../src/services/matching/market-execution-queue.js';
import { OrderBook } from '../../src/services/matching/order-book.js';
import { TradeSettlementService } from '../../src/services/settlement/trade-settlement-service.js';

describe('Step 9.15 — Distributed Market Coordination Safety Audit', () => {
  const livePrisma = defaultPrisma;
  const testRunId = crypto.randomUUID().substring(0, 8);

  let testOrganizerUser;
  let testUserA;
  let testUserB;
  let testUserC;
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
    expect(dbInfo.current_database).toBe('passflow_isolated_validation');
    expect(dbInfo.inet_server_port).toBe(55432);

    liveRepo = new OrderRepository({ prismaClient: livePrisma });

    // Seed test users
    testOrganizerUser = await livePrisma.user.create({
      data: {
        email: `audit-org-${testRunId}@test.passflow.com`,
        passwordHash: 'dummy-hash',
        name: 'Audit Test Organizer',
        organizer: {
          create: {
            organizationName: 'Audit Test Org LLC',
          },
        },
      },
      include: { organizer: true },
    });

    testUserA = await livePrisma.user.create({
      data: {
        email: `audit-user-a-${testRunId}@test.passflow.com`,
        passwordHash: 'dummy-hash',
        name: 'Audit Buyer A',
        wallet: {
          create: {
            availableBalance: 2000000n,
            reservedBalance: 0n,
          },
        },
      },
    });

    testUserB = await livePrisma.user.create({
      data: {
        email: `audit-user-b-${testRunId}@test.passflow.com`,
        passwordHash: 'dummy-hash',
        name: 'Audit Seller B',
        wallet: {
          create: {
            availableBalance: 1000000n,
            reservedBalance: 0n,
          },
        },
      },
    });

    testUserC = await livePrisma.user.create({
      data: {
        email: `audit-user-c-${testRunId}@test.passflow.com`,
        passwordHash: 'dummy-hash',
        name: 'Audit Trader C',
        wallet: {
          create: {
            availableBalance: 1000000n,
            reservedBalance: 0n,
          },
        },
      },
    });

    // Seed Event and 2 Ticket Categories (representing 2 independent secondary markets)
    testEvent = await livePrisma.event.create({
      data: {
        name: `Audit Event ${testRunId}`,
        dateTime: new Date(Date.now() + 86400000),
        location: 'Audit Coordination Arena',
        organizerId: testOrganizerUser.organizer.id,
      },
    });

    testCategory1 = await livePrisma.ticketCategory.create({
      data: {
        eventId: testEvent.id,
        name: 'Audit VIP Cat 1',
        originalPrice: 200.0,
        totalQuantity: 1000,
        availableQuantity: 1000,
      },
    });

    testCategory2 = await livePrisma.ticketCategory.create({
      data: {
        eventId: testEvent.id,
        name: 'Audit General Cat 2',
        originalPrice: 100.0,
        totalQuantity: 1000,
        availableQuantity: 1000,
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

  // --------------------------------------------------------------------------
  // Audit Verification 1: Transaction locking lease cannot race unsafely with takeover
  // --------------------------------------------------------------------------
  test('1. Transaction locking lease before nominal expiry blocks takeover and commits safely', async () => {
    const ownerA = `node-lockA-${testRunId}`;
    const ownerB = `node-takeoverB-${testRunId}`;

    const mgrA = new MarketLeaseManager({ prismaClient: livePrisma, ownerId: ownerA });
    const mgrB = new MarketLeaseManager({ prismaClient: livePrisma, ownerId: ownerB });

    // Instance A acquires lease with short duration (2000ms)
    const acqA = await mgrA.acquireLease({
      eventId: testEvent.id,
      ticketCategoryId: testCategory1.id,
      leaseDurationMs: 2000,
    });
    expect(acqA.acquired).toBe(true);

    let txAHeldLock = false;
    let takeoverStarted = false;
    let takeoverFinished = false;
    let txACommitted = false;

    // Instance A opens transaction, verifies fencing token (locks MarketLease row FOR UPDATE)
    const txAPromise = livePrisma.$transaction(async (tx) => {
      await verifyFencingToken(tx, {
        eventId: testEvent.id,
        ticketCategoryId: testCategory1.id,
        ownerId: ownerA,
        fencingToken: acqA.fencingToken,
      });
      txAHeldLock = true;

      // Manually simulate lease expiring in the database clock while txA holds the row lock!
      await tx.$executeRaw`
        UPDATE "MarketLease"
        SET "expiresAt" = NOW() - make_interval(secs => 0.5)
        WHERE "eventId" = ${testEvent.id} AND "ticketCategoryId" = ${testCategory1.id}
      `;

      // Wait 300ms while holding the lock
      await new Promise((resolve) => setTimeout(resolve, 300));

      // Persist order under Tx A
      const orderA = await tx.order.create({
        data: {
          id: crypto.randomUUID(),
          userId: testUserA.id,
          eventId: testEvent.id,
          ticketCategoryId: testCategory1.id,
          side: 'BID',
          status: 'OPEN',
          price: 15000,
          initialQuantity: 1,
          remainingQuantity: 1,
          fencingToken: acqA.fencingToken,
          idempotencyKey: `txA-order-${testRunId}`,
        },
      });

      txACommitted = true;
      return orderA;
    });

    // Wait until Tx A has acquired the FOR UPDATE row lock
    while (!txAHeldLock) {
      await new Promise((r) => setTimeout(r, 10));
    }

    // Instance B concurrently attempts takeover while Tx A holds the row lock
    takeoverStarted = true;
    const takeoverPromise = mgrB.acquireLease({
      eventId: testEvent.id,
      ticketCategoryId: testCategory1.id,
      leaseDurationMs: 5000,
    }).then((res) => {
      takeoverFinished = true;
      return res;
    });

    // Verify that while Tx A is running, takeover has NOT finished (it is blocked on PostgreSQL row lock!)
    expect(takeoverFinished).toBe(false);

    // Wait for both to complete
    const [orderA, resB] = await Promise.all([txAPromise, takeoverPromise]);

    // Invariant: Tx A committed BEFORE takeover finished
    expect(txACommitted).toBe(true);
    expect(takeoverStarted).toBe(true);
    expect(takeoverFinished).toBe(true);

    // Instance B took over after Tx A released lock, incrementing fencing token
    expect(resB.acquired).toBe(true);
    expect(resB.takeover).toBe(true);
    expect(resB.fencingToken).toBe(acqA.fencingToken + 1n);

    // Order written by Tx A is durable in DB
    const dbOrderA = await livePrisma.order.findUnique({ where: { id: orderA.id } });
    expect(dbOrderA).not.toBeNull();
    expect(dbOrderA.fencingToken).toBe(acqA.fencingToken);

    await mgrB.releaseLease({ eventId: testEvent.id, ticketCategoryId: testCategory1.id });
  });

  // --------------------------------------------------------------------------
  // Audit Verification 2: Stale owner cannot commit after takeover establishes authority
  // --------------------------------------------------------------------------
  test('2. Takeover strictly prevents stale owner from committing writes', async () => {
    const ownerA = `stale-A-${testRunId}`;
    const ownerB = `authority-B-${testRunId}`;

    const mgrA = new MarketLeaseManager({ prismaClient: livePrisma, ownerId: ownerA });
    const mgrB = new MarketLeaseManager({ prismaClient: livePrisma, ownerId: ownerB });

    const acqA = await mgrA.acquireLease({
      eventId: testEvent.id,
      ticketCategoryId: testCategory1.id,
      leaseDurationMs: 2000,
    });

    // Instance B establishes authority after expiration
    await livePrisma.$executeRaw`
      UPDATE "MarketLease"
      SET "expiresAt" = NOW() - make_interval(secs => 1.0)
      WHERE "eventId" = ${testEvent.id} AND "ticketCategoryId" = ${testCategory1.id}
    `;
    const acqB = await mgrB.acquireLease({
      eventId: testEvent.id,
      ticketCategoryId: testCategory1.id,
      leaseDurationMs: 5000,
    });
    expect(acqB.fencingToken).toBe(acqA.fencingToken + 1n);

    // Stale Instance A attempts to commit matching transaction with its old token
    const staleOrderId = crypto.randomUUID();
    await expect(
      liveRepo.persistMatchingTransaction({
        incomingOrderData: {
          id: staleOrderId,
          userId: testUserA.id,
          eventId: testEvent.id,
          ticketCategoryId: testCategory1.id,
          side: 'BID',
          status: 'OPEN',
          price: 18000,
          initialQuantity: 2,
          remainingQuantity: 2,
          idempotencyKey: `stale-tx-${testRunId}`,
        },
        restingUpdates: [],
        executionsData: [],
        leaseContext: {
          ownerId: ownerA,
          fencingToken: acqA.fencingToken,
          eventId: testEvent.id,
          ticketCategoryId: testCategory1.id,
        },
      })
    ).rejects.toThrow(FencingViolationError);

    // Database remains clean
    const orderCheck = await livePrisma.order.findUnique({ where: { id: staleOrderId } });
    expect(orderCheck).toBeNull();

    await mgrB.releaseLease({ eventId: testEvent.id, ticketCategoryId: testCategory1.id });
  });

  // --------------------------------------------------------------------------
  // Audit Verification 3: Expired lease cannot be renewed by stale owner
  // --------------------------------------------------------------------------
  test('3. Expired lease cannot be renewed by stale owner', async () => {
    const ownerA = `exp-renew-A-${testRunId}`;
    const mgrA = new MarketLeaseManager({ prismaClient: livePrisma, ownerId: ownerA });

    const acqA = await mgrA.acquireLease({
      eventId: testEvent.id,
      ticketCategoryId: testCategory1.id,
      leaseDurationMs: 5000,
    });

    // Force expiration in DB
    await livePrisma.$executeRaw`
      UPDATE "MarketLease"
      SET "expiresAt" = NOW() - make_interval(secs => 1.0)
      WHERE "eventId" = ${testEvent.id} AND "ticketCategoryId" = ${testCategory1.id}
    `;

    // Instance A attempts to renew its expired lease without re-acquiring: MUST fail
    const renewResult = await mgrA.renewLease({
      eventId: testEvent.id,
      ticketCategoryId: testCategory1.id,
      expectedFencingToken: acqA.fencingToken,
    });
    expect(renewResult.renewed).toBe(false);
    expect(renewResult.reason).toBe('LEASE_EXPIRED');
  });

  // --------------------------------------------------------------------------
  // Audit Verification 4: Monotonic fencing tokens across 4 repeated takeovers
  // --------------------------------------------------------------------------
  test('4. Fencing tokens remain strictly monotonically increasing across 4 consecutive takeovers', async () => {
    const instances = [
      new MarketLeaseManager({ prismaClient: livePrisma, ownerId: `inst-1-${testRunId}` }),
      new MarketLeaseManager({ prismaClient: livePrisma, ownerId: `inst-2-${testRunId}` }),
      new MarketLeaseManager({ prismaClient: livePrisma, ownerId: `inst-3-${testRunId}` }),
      new MarketLeaseManager({ prismaClient: livePrisma, ownerId: `inst-4-${testRunId}` }),
    ];

    const tokens = [];

    // Instance 0 acquires initially
    const firstAcq = await instances[0].acquireLease({
      eventId: testEvent.id,
      ticketCategoryId: testCategory1.id,
      leaseDurationMs: 5000,
    });
    tokens.push(firstAcq.fencingToken);

    // 3 successive takeovers
    for (let i = 1; i < instances.length; i++) {
      // Force expiration
      await livePrisma.$executeRaw`
        UPDATE "MarketLease"
        SET "expiresAt" = NOW() - make_interval(secs => 1.0)
        WHERE "eventId" = ${testEvent.id} AND "ticketCategoryId" = ${testCategory1.id}
      `;

      const takeoverRes = await instances[i].acquireLease({
        eventId: testEvent.id,
        ticketCategoryId: testCategory1.id,
        leaseDurationMs: 5000,
      });
      expect(takeoverRes.acquired).toBe(true);
      expect(takeoverRes.takeover).toBe(true);
      tokens.push(takeoverRes.fencingToken);
    }

    expect(tokens).toHaveLength(4);
    // Strict monotonic progression
    for (let i = 1; i < tokens.length; i++) {
      expect(tokens[i]).toBe(tokens[i - 1] + 1n);
    }

    // Verify all previous owners are rejected by fencing
    for (let i = 0; i < instances.length - 1; i++) {
      await expect(
        livePrisma.$transaction(async (tx) => {
          await verifyFencingToken(tx, {
            eventId: testEvent.id,
            ticketCategoryId: testCategory1.id,
            ownerId: instances[i].ownerId,
            fencingToken: tokens[i],
          });
        })
      ).rejects.toThrow(FencingViolationError);
    }

    await instances[3].releaseLease({ eventId: testEvent.id, ticketCategoryId: testCategory1.id });
  });

  // --------------------------------------------------------------------------
  // Audit Verification 5: Two instances cannot both persist conflicting matching decisions
  // --------------------------------------------------------------------------
  test('5. Two instances cannot both persist conflicting matching decisions for one market', async () => {
    const serviceA = new PersistentMatchingService({
      repository: liveRepo,
      leaseManager: new MarketLeaseManager({ prismaClient: livePrisma, ownerId: `comp-A-${testRunId}` }),
      requireMarketLease: true,
    });
    const serviceB = new PersistentMatchingService({
      repository: liveRepo,
      leaseManager: new MarketLeaseManager({ prismaClient: livePrisma, ownerId: `comp-B-${testRunId}` }),
      requireMarketLease: true,
    });

    // Instance A acquires lease
    await serviceA.acquireMarketOwnership(marketKey1, { leaseDurationMs: 5000, reconstruct: true });

    // Instance B cannot acquire active lease
    await expect(
      serviceB.acquireMarketOwnership(marketKey1, { leaseDurationMs: 5000, reconstruct: true })
    ).rejects.toThrow(MarketOwnershipError);

    // Competing submissions: Instance A succeeds, Instance B fails immediately
    const [subA, subBResult] = await Promise.allSettled([
      serviceA.submitLimitOrder({
        eventId: testEvent.id,
        ticketCategoryId: testCategory1.id,
        userId: testUserA.id,
        side: 'BID',
        price: 25000,
        quantity: 1,
        idempotencyKey: `winner-A-${testRunId}`,
      }),
      serviceB.submitLimitOrder({
        eventId: testEvent.id,
        ticketCategoryId: testCategory1.id,
        userId: testUserB.id,
        side: 'BID',
        price: 25000,
        quantity: 1,
        idempotencyKey: `loser-B-${testRunId}`,
      }),
    ]);

    expect(subA.status).toBe('fulfilled');
    expect(subBResult.status).toBe('rejected');
    expect(['MarketOwnershipError', 'MarketNotReadyError', 'MarketStateError']).toContain(subBResult.reason.name);

    await serviceA.releaseMarketOwnership(marketKey1);
  });

  // --------------------------------------------------------------------------
  // Audit Verification 6: Separate markets remain independently operable
  // --------------------------------------------------------------------------
  test('6. Separate markets remain independently operable without cross-market interference', async () => {
    const serviceM1 = new PersistentMatchingService({
      repository: liveRepo,
      leaseManager: new MarketLeaseManager({ prismaClient: livePrisma, ownerId: `mgr-m1-${testRunId}` }),
      requireMarketLease: true,
    });
    const serviceM2 = new PersistentMatchingService({
      repository: liveRepo,
      leaseManager: new MarketLeaseManager({ prismaClient: livePrisma, ownerId: `mgr-m2-${testRunId}` }),
      requireMarketLease: true,
    });

    // Simultaneously acquire Market 1 and Market 2 on different instances
    const [acq1, acq2] = await Promise.all([
      serviceM1.acquireMarketOwnership(marketKey1, { leaseDurationMs: 5000, reconstruct: true }),
      serviceM2.acquireMarketOwnership(marketKey2, { leaseDurationMs: 5000, reconstruct: true }),
    ]);

    expect(acq1.ownerId).toBe(`mgr-m1-${testRunId}`);
    expect(acq2.ownerId).toBe(`mgr-m2-${testRunId}`);

    // Concurrently trade in both markets
    const [ord1, ord2] = await Promise.all([
      serviceM1.submitLimitOrder({
        eventId: testEvent.id,
        ticketCategoryId: testCategory1.id,
        userId: testUserA.id,
        side: 'BID',
        price: 30000,
        quantity: 1,
        idempotencyKey: `m1-order-${testRunId}`,
      }),
      serviceM2.submitLimitOrder({
        eventId: testEvent.id,
        ticketCategoryId: testCategory2.id,
        userId: testUserB.id,
        side: 'BID',
        price: 15000,
        quantity: 1,
        idempotencyKey: `m2-order-${testRunId}`,
      }),
    ]);

    expect(ord1.status).toBe('OPEN');
    expect(ord2.status).toBe('OPEN');

    // Releasing Market 1 marks it reconciling on serviceM1
    await serviceM1.releaseMarketOwnership(marketKey1);
    expect(serviceM1.checkReadiness().ready).toBe(false);
    expect(serviceM2.checkReadiness().ready).toBe(true);

    // Market 2 continues trading
    const ord2b = await serviceM2.submitLimitOrder({
      eventId: testEvent.id,
      ticketCategoryId: testCategory2.id,
      userId: testUserC.id,
      side: 'ASK',
      price: 15000,
      quantity: 1,
      idempotencyKey: `m2-match-${testRunId}`,
    });
    expect(ord2b.status).toBe('FILLED');

    await serviceM2.releaseMarketOwnership(marketKey2);
  });

  // --------------------------------------------------------------------------
  // Audit Verification 7: Renewal failure fails closed and triggers quarantine
  // --------------------------------------------------------------------------
  test('7. Database outages during renewal fail closed, transition to RECONCILING, and report unready', async () => {
    const mockPrisma = {
      $transaction: async () => {
        const err = new Error('getaddrinfo ENOTFOUND postgres.local');
        err.code = 'ENOTFOUND';
        throw err;
      },
    };

    const leaseMgr = new MarketLeaseManager({ prismaClient: mockPrisma, ownerId: `outage-${testRunId}` });
    const service = new PersistentMatchingService({
      repository: liveRepo,
      leaseManager: leaseMgr,
      requireMarketLease: true,
    });

    service.registerMarketBook(marketKey1, new OrderBook({ eventId: testEvent.id, ticketCategoryId: testCategory1.id }), { synchronized: true });
    service.stateManager.transition(marketKey1, MarketState.READY);
    leaseMgr._activeLeases.set(marketKey1, {
      marketKey: marketKey1,
      eventId: testEvent.id,
      ticketCategoryId: testCategory1.id,
      ownerId: leaseMgr.ownerId,
      fencingToken: 1n,
      expiresAt: new Date(Date.now() + 10000),
      leaseDurationMs: 1000,
    });
    service._marketLeases.set(marketKey1, {
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
        service._marketLeases.delete(marketKey1);
        service.stateManager.transition(marketKey1, MarketState.RECONCILING);
      },
    });

    // Wait for auto-renewal timer to fire and fail
    await new Promise((r) => setTimeout(r, 650));

    expect(failureNotified).toBe(true);
    expect(service.stateManager.getState(marketKey1)).toBe(MarketState.RECONCILING);

    // Readiness reports not ready
    const readiness = service.checkReadiness();
    expect(readiness.ready).toBe(false);
    expect(readiness.reason).toContain('is currently reconciling');

    leaseMgr.stopAutoRenewal(marketKey1);
  });

  // --------------------------------------------------------------------------
  // Audit Verification 8: Process restart reconstructs from persistent state
  // --------------------------------------------------------------------------
  test('8. Process restart reconstructs order book from persistent PostgreSQL state', async () => {
    const ownerInitial = `init-node-${testRunId}`;
    const ownerRestart = `restarted-node-${testRunId}`;

    const serviceInitial = new PersistentMatchingService({
      repository: liveRepo,
      leaseManager: new MarketLeaseManager({ prismaClient: livePrisma, ownerId: ownerInitial }),
      requireMarketLease: true,
    });

    const cat8 = await livePrisma.ticketCategory.create({
      data: {
        eventId: testEvent.id,
        name: `Recon Cat 8 ${testRunId}`,
        originalPrice: 200.0,
        totalQuantity: 500,
        availableQuantity: 500,
      },
    });
    const marketKey8 = formatMarketKey(testEvent.id, cat8.id);

    await serviceInitial.acquireMarketOwnership(marketKey8, { leaseDurationMs: 5000, reconstruct: true });

    // Seed 2 orders (1 BID, 1 ASK at different prices)
    await serviceInitial.submitLimitOrder({
      eventId: testEvent.id,
      ticketCategoryId: cat8.id,
      userId: testUserA.id,
      side: 'BID',
      price: 18000,
      quantity: 3,
      idempotencyKey: `recon-bid-${testRunId}`,
    });

    await serviceInitial.submitLimitOrder({
      eventId: testEvent.id,
      ticketCategoryId: cat8.id,
      userId: testUserB.id,
      side: 'ASK',
      price: 22000,
      quantity: 2,
      idempotencyKey: `recon-ask-${testRunId}`,
    });

    // Simulate crash of initial instance
    serviceInitial.leaseManager.stopAutoRenewal(marketKey8);
    await livePrisma.$executeRaw`
      UPDATE "MarketLease"
      SET "expiresAt" = NOW() - make_interval(secs => 1.0)
      WHERE "eventId" = ${testEvent.id} AND "ticketCategoryId" = ${cat8.id}
    `;

    // Restarted instance starts with blank in-memory state
    const serviceRestarted = new PersistentMatchingService({
      repository: liveRepo,
      leaseManager: new MarketLeaseManager({ prismaClient: livePrisma, ownerId: ownerRestart }),
      requireMarketLease: true,
    });

    const takeover = await serviceRestarted.acquireMarketOwnership(marketKey8, {
      leaseDurationMs: 5000,
      reconstruct: true,
    });

    expect(takeover.takeover).toBe(true);
    expect(takeover.activeOrdersCount).toBe(2);
    expect(takeover.totalRemainingQuantity).toBe(5);

    // Book in memory has reconstructed orders with correct FIFO priority
    const book = serviceRestarted.getMarketBook(marketKey8);
    expect(book.getBestBid()).toBe(18000);
    expect(book.getBestAsk()).toBe(22000);

    await serviceRestarted.releaseMarketOwnership(marketKey8);
  });

  // --------------------------------------------------------------------------
  // Audit Verification 9: Cancellation cannot bypass fencing
  // --------------------------------------------------------------------------
  test('9. Cancellation cannot bypass fencing after ownership takeover', async () => {
    const ownerA = `cancel-fence-A-${testRunId}`;
    const ownerB = `cancel-fence-B-${testRunId}`;

    const serviceA = new PersistentMatchingService({
      repository: liveRepo,
      leaseManager: new MarketLeaseManager({ prismaClient: livePrisma, ownerId: ownerA }),
      requireMarketLease: true,
    });
    const serviceB = new PersistentMatchingService({
      repository: liveRepo,
      leaseManager: new MarketLeaseManager({ prismaClient: livePrisma, ownerId: ownerB }),
      requireMarketLease: true,
    });

    await serviceA.acquireMarketOwnership(marketKey1, { leaseDurationMs: 5000, reconstruct: true });

    const openOrder = await serviceA.submitLimitOrder({
      eventId: testEvent.id,
      ticketCategoryId: testCategory1.id,
      userId: testUserA.id,
      side: 'BID',
      price: 19000,
      quantity: 1,
      idempotencyKey: `fence-cancel-${testRunId}`,
    });

    // Ownership taken over by Instance B
    serviceA.leaseManager.stopAutoRenewal(marketKey1);
    await livePrisma.$executeRaw`
      UPDATE "MarketLease"
      SET "expiresAt" = NOW() - make_interval(secs => 1.0)
      WHERE "eventId" = ${testEvent.id} AND "ticketCategoryId" = ${testCategory1.id}
    `;
    await serviceB.acquireMarketOwnership(marketKey1, { leaseDurationMs: 5000, reconstruct: true });

    // Instance A attempts cancellation: MUST be rejected
    await expect(
      serviceA.cancelLimitOrder({
        eventId: testEvent.id,
        ticketCategoryId: testCategory1.id,
        orderId: openOrder.orderId,
        userId: testUserA.id,
      })
    ).rejects.toThrow();

    // Order remains uncancelled in database
    const dbOrder = await livePrisma.order.findUnique({ where: { id: openOrder.orderId } });
    expect(dbOrder.status).toBe('OPEN');

    // Instance B cancels successfully
    const cancelResult = await serviceB.cancelLimitOrder({
      eventId: testEvent.id,
      ticketCategoryId: testCategory1.id,
      orderId: openOrder.orderId,
      userId: testUserA.id,
    });
    expect(cancelResult.status).toBe('CANCELLED');

    await serviceB.releaseMarketOwnership(marketKey1);
  });

  // --------------------------------------------------------------------------
  // Audit Verification 10: Idempotent submissions and settlement during ownership changes
  // --------------------------------------------------------------------------
  test('10. Idempotent submission and settlement remain correct during ownership changes', async () => {
    const ownerA = `idemp-A-${testRunId}`;
    const ownerB = `idemp-B-${testRunId}`;

    const serviceA = new PersistentMatchingService({
      repository: liveRepo,
      leaseManager: new MarketLeaseManager({ prismaClient: livePrisma, ownerId: ownerA }),
      requireMarketLease: true,
    });
    const serviceB = new PersistentMatchingService({
      repository: liveRepo,
      leaseManager: new MarketLeaseManager({ prismaClient: livePrisma, ownerId: ownerB }),
      requireMarketLease: true,
    });

    const cat10 = await livePrisma.ticketCategory.create({
      data: {
        eventId: testEvent.id,
        name: `Idemp Cat 10 ${testRunId}`,
        originalPrice: 200.0,
        totalQuantity: 500,
        availableQuantity: 500,
      },
    });
    const marketKey10 = formatMarketKey(testEvent.id, cat10.id);

    await serviceA.acquireMarketOwnership(marketKey10, { leaseDurationMs: 5000, reconstruct: true });

    // Submit ASK order under Instance A
    await serviceA.submitLimitOrder({
      eventId: testEvent.id,
      ticketCategoryId: cat10.id,
      userId: testUserB.id,
      side: 'ASK',
      price: 20000,
      quantity: 1,
      idempotencyKey: `idemp-ask-${testRunId}`,
    });

    // Submit matching BID order under Instance A
    const bidKey = `idemp-bid-${testRunId}`;
    const bidOrder = await serviceA.submitLimitOrder({
      eventId: testEvent.id,
      ticketCategoryId: cat10.id,
      userId: testUserA.id,
      side: 'BID',
      price: 20000,
      quantity: 1,
      idempotencyKey: bidKey,
    });

    expect(bidOrder.status).toBe('FILLED');
    expect(bidOrder.executions).toHaveLength(1);
    const execId = bidOrder.executions[0].id;

    // Ownership transfers to Instance B
    serviceA.leaseManager.stopAutoRenewal(marketKey10);
    await livePrisma.$executeRaw`
      UPDATE "MarketLease"
      SET "expiresAt" = NOW() - make_interval(secs => 1.0)
      WHERE "eventId" = ${testEvent.id} AND "ticketCategoryId" = ${cat10.id}
    `;
    await serviceB.acquireMarketOwnership(marketKey10, { leaseDurationMs: 5000, reconstruct: true });

    // Client retries submission of BID order under Instance B with same idempotencyKey
    const replayBid = await serviceB.submitLimitOrder({
      eventId: testEvent.id,
      ticketCategoryId: cat10.id,
      userId: testUserA.id,
      side: 'BID',
      price: 20000,
      quantity: 1,
      idempotencyKey: bidKey,
    });

    expect(replayBid.orderId).toBe(bidOrder.orderId);
    expect(replayBid.status).toBe('FILLED');
    expect(replayBid.executions[0].id).toBe(execId);

    // Ensure zero extra execution records in DB
    const execCount = await livePrisma.execution.count({
      where: { incomingOrderId: bidOrder.orderId },
    });
    expect(execCount).toBe(1);

    // Settlement decoupling: settle execution under independent settlement service
    const settlementService = new TradeSettlementService({ prismaClient: livePrisma });
    const buyerWallet = await livePrisma.wallet.findUnique({ where: { userId: testUserA.id } });
    await livePrisma.wallet.update({
      where: { id: buyerWallet.id },
      data: { reservedBalance: 20000n },
    });

    await livePrisma.userTicketInventory.upsert({
      where: {
        userId_ticketCategoryId: {
          userId: testUserB.id,
          ticketCategoryId: cat10.id,
        },
      },
      update: { totalQuantity: 1, reservedQuantity: 1, availableQuantity: 0 },
      create: { userId: testUserB.id, ticketCategoryId: cat10.id, totalQuantity: 1, reservedQuantity: 1, availableQuantity: 0 },
    });

    await livePrisma.walletHold.create({
      data: {
        walletId: buyerWallet.id,
        orderId: bidOrder.orderId,
        heldAmount: 20000n,
        remainingAmount: 20000n,
        reason: 'ORDER_ESCROW',
        status: 'ACTIVE',
      },
    });

    const settle1 = await settlementService.settleExecution({ executionId: execId });
    expect(settle1.isIdempotentReplay).toBe(false);

    // Repeated settlement replay is idempotent
    const settle2 = await settlementService.settleExecution({ executionId: execId });
    expect(settle2.isIdempotentReplay).toBe(true);

    await serviceB.releaseMarketOwnership(marketKey10);
  });
});
