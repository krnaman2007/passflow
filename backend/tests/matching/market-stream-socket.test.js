/**
 * Step 9.16 — Secondary Market Real-Time WebSocket Streaming & Event Subscriptions Test Suite
 *
 * Verifies real-time secondary-market updates using Socket.IO:
 * 1. Authenticated connection and rejected invalid credentials.
 * 2. Valid market subscription and invalid market rejection.
 * 3. Unauthorized private order-fill subscription or delivery.
 * 4. Market isolation across different event/category pairs.
 * 5. Snapshot plus subsequent update consistency.
 * 6. No event emitted before transaction commit.
 * 7. No trade event emitted after transaction rollback.
 * 8. Idempotent submissions do not produce duplicate logical trade notifications.
 * 9. Reconnection and snapshot resynchronization after a sequence gap.
 * 10. Disconnect cleanup and subscription limits.
 * 11. Socket delivery behavior across backend instances (in-memory adapter documentation).
 * 12. Read-only WebSocket client boundary (rejection of mutation events).
 */

import http from 'http';
import { Server } from 'socket.io';
import { io as ioc } from 'socket.io-client';
import { jest } from '@jest/globals';
import { prisma as livePrisma } from '../../src/db/prisma.js';
import { WalletService } from '../../src/services/wallet/wallet-service.js';
import { OrderRepository } from '../../src/services/matching/order-repository.js';
import { PersistentMatchingService } from '../../src/services/matching/persistent-matching-service.js';
import { OrderService } from '../../src/services/order/order-service.js';
import { MarketStreamService } from '../../src/services/market-stream/market-stream-service.js';
import { generateAccessToken } from '../../src/utils/token.js';

describe('Step 9.16 — Market Real-Time WebSocket Streaming (Live PostgreSQL)', () => {
  jest.setTimeout(90000);

  const suffix = Math.random().toString(36).substring(2, 8);
  let httpServer;
  let ioServer;
  let serverPort;
  let marketStreamService;
  let orderService;
  let walletService;
  let matchingService;
  let orderRepository;

  let buyerUser;
  let sellerUser;
  let observerUser;
  let organizerUser;
  let organizer;
  let testEvent1;
  let testCat1;
  let testEvent2;
  let testCat2;

  let buyerToken;
  let sellerToken;
  let observerToken;

  const openSockets = [];

  const connectClient = (options = {}) => {
    return new Promise((resolve, reject) => {
      const socket = ioc(`http://localhost:${serverPort}`, {
        transports: ['websocket'],
        forceNew: true,
        reconnection: false,
        ...options,
      });

      openSockets.push(socket);

      socket.on('connect', () => resolve(socket));
      socket.on('connect_error', (err) => resolve({ socket, error: err }));
    });
  };

  beforeAll(async () => {
    // 1. Create test users
    organizerUser = await livePrisma.user.create({
      data: {
        email: `org-${suffix}@stream.passflow.com`,
        passwordHash: 'dummy-hash',
        name: 'Stream Org User',
      },
    });

    buyerUser = await livePrisma.user.create({
      data: {
        email: `buyer-${suffix}@stream.passflow.com`,
        passwordHash: 'dummy-hash',
        name: 'Stream Buyer User',
      },
    });

    sellerUser = await livePrisma.user.create({
      data: {
        email: `seller-${suffix}@stream.passflow.com`,
        passwordHash: 'dummy-hash',
        name: 'Stream Seller User',
      },
    });

    observerUser = await livePrisma.user.create({
      data: {
        email: `observer-${suffix}@stream.passflow.com`,
        passwordHash: 'dummy-hash',
        name: 'Stream Observer User',
      },
    });

    // 2. Create organizer profile
    organizer = await livePrisma.organizer.create({
      data: {
        userId: organizerUser.id,
        organizationName: `Stream Org ${suffix}`,
        verificationStatus: 'VERIFIED',
      },
    });

    // 3. Create two distinct events and categories for market isolation tests
    testEvent1 = await livePrisma.event.create({
      data: {
        name: `Stream Concert 1 ${suffix}`,
        description: 'Test Event 1 for Streaming',
        dateTime: new Date(Date.now() + 86400000),
        location: 'Mumbai Arena 1',
        organizerId: organizer.id,
        status: 'PUBLISHED',
      },
    });

    testCat1 = await livePrisma.ticketCategory.create({
      data: {
        eventId: testEvent1.id,
        name: 'VIP Category 1',
        originalPrice: 100.0,
        totalQuantity: 1000,
        availableQuantity: 1000,
        status: 'ACTIVE',
      },
    });

    testEvent2 = await livePrisma.event.create({
      data: {
        name: `Stream Concert 2 ${suffix}`,
        description: 'Test Event 2 for Streaming',
        dateTime: new Date(Date.now() + 86400000),
        location: 'Mumbai Arena 2',
        organizerId: organizer.id,
        status: 'PUBLISHED',
      },
    });

    testCat2 = await livePrisma.ticketCategory.create({
      data: {
        eventId: testEvent2.id,
        name: 'VIP Category 2',
        originalPrice: 150.0,
        totalQuantity: 1000,
        availableQuantity: 1000,
        status: 'ACTIVE',
      },
    });

    // 4. Generate JWT tokens
    buyerToken = generateAccessToken(buyerUser);
    sellerToken = generateAccessToken(sellerUser);
    observerToken = generateAccessToken(observerUser);

    // 5. Initialize services
    walletService = new WalletService({ prismaClient: livePrisma });
    orderRepository = new OrderRepository({ prismaClient: livePrisma });
    matchingService = new PersistentMatchingService({ repository: orderRepository });
    marketStreamService = new MarketStreamService({ prismaClient: livePrisma });

    orderService = new OrderService({
      prismaClient: livePrisma,
      walletService,
      matchingService,
      orderRepository,
      marketStreamService,
    });

    // 5. Initialize matching engine markets
    await matchingService.initializeAndSynchronizeMarket({
      eventId: testEvent1.id,
      ticketCategoryId: testCat1.id,
    });
    await matchingService.initializeAndSynchronizeMarket({
      eventId: testEvent2.id,
      ticketCategoryId: testCat2.id,
    });

    // 6. Fund buyer wallet
    await walletService.getOrCreateWallet({ userId: buyerUser.id });
    await walletService.getOrCreateWallet({ userId: sellerUser.id });
    await walletService.creditAvailable({
      userId: buyerUser.id,
      amount: 1_000_000, // 10,000 INR
      idempotencyKey: `fund-buyer-${suffix}`,
      description: 'Initial deposit for streaming tests',
    });

    // 7. Fund seller inventory for both categories
    await orderService.creditUserTicketInventory({
      userId: sellerUser.id,
      ticketCategoryId: testCat1.id,
      quantity: 50,
      idempotencyKey: `fund-seller-cat1-${suffix}`,
    });

    await orderService.creditUserTicketInventory({
      userId: sellerUser.id,
      ticketCategoryId: testCat2.id,
      quantity: 50,
      idempotencyKey: `fund-seller-cat2-${suffix}`,
    });

    // 8. Spin up HTTP server and Socket.IO
    httpServer = http.createServer();
    ioServer = new Server(httpServer, {
      cors: { origin: '*' },
    });

    marketStreamService.setServer(ioServer);

    await new Promise((resolve) => {
      httpServer.listen(0, () => {
        serverPort = httpServer.address().port;
        resolve();
      });
    });
  });

  afterAll(async () => {
    for (const socket of openSockets) {
      if (socket.connected) {
        socket.disconnect();
      }
    }

    if (ioServer) {
      await new Promise((resolve) => ioServer.close(resolve));
    }
    if (httpServer && httpServer.listening) {
      await new Promise((resolve) => httpServer.close(resolve));
    }

    // Ledger entries are immutable in PostgreSQL; test users are uniquely suffixed
    try {
      // Clean up open sockets
      for (const socket of openSockets) {
        if (socket && typeof socket.disconnect === 'function') {
          socket.disconnect();
        }
      }
    } catch (cleanupErr) {
      console.warn('Test cleanup warning:', cleanupErr.message);
    }
  });

  // --------------------------------------------------------------------------
  // Scenario 1: Authenticated connection and rejected invalid credentials
  // --------------------------------------------------------------------------
  describe('1. Authentication and Handshake Security', () => {
    it('accepts connection with valid access token in auth payload', async () => {
      const client = await connectClient({
        auth: { token: buyerToken },
      });

      expect(client.connected).toBe(true);
      expect(client.id).toBeDefined();
    });

    it('rejects connection with invalid token in auth payload', async () => {
      const res = await connectClient({
        auth: { token: 'invalid.jwt.token' },
      });

      expect(res.error).toBeDefined();
      expect(res.error.message).toMatch(/Authentication error/i);
    });

    it('allows unauthenticated connection for public market reading', async () => {
      const client = await connectClient();
      expect(client.connected).toBe(true);
    });

    it('allows in-band authentication after unauthenticated connection', async () => {
      const client = await connectClient();
      expect(client.connected).toBe(true);

      const authResult = await new Promise((resolve) => {
        client.emit('authenticate', { token: buyerToken }, (err, res) => {
          resolve({ err, res });
        });
      });

      expect(authResult.err).toBeNull();
      expect(authResult.res.success).toBe(true);
      expect(authResult.res.userId).toBe(buyerUser.id);
    });

    it('rejects in-band authentication with invalid token', async () => {
      const client = await connectClient();
      expect(client.connected).toBe(true);

      const authResult = await new Promise((resolve) => {
        client.emit('authenticate', { token: 'bad-token' }, (err, res) => {
          resolve({ err, res });
        });
      });

      expect(authResult.err).toBeDefined();
      expect(authResult.err.code).toBe('UNAUTHORIZED');
    });
  });

  // --------------------------------------------------------------------------
  // Scenario 2: Valid market subscription and invalid market rejection
  // --------------------------------------------------------------------------
  describe('2. Market Subscription Validation and Authorization', () => {
    it('successfully subscribes to valid market and receives snapshot with sequence cursor', async () => {
      const client = await connectClient();

      const snapshot = await new Promise((resolve) => {
        client.emit(
          'market:subscribe',
          { eventId: testEvent1.id, ticketCategoryId: testCat1.id },
          (err, data) => resolve(data)
        );
      });

      expect(snapshot).toBeDefined();
      expect(snapshot.v).toBe(1);
      expect(snapshot.eventId).toBe(testEvent1.id);
      expect(snapshot.ticketCategoryId).toBe(testCat1.id);
      expect(Array.isArray(snapshot.bids)).toBe(true);
      expect(Array.isArray(snapshot.asks)).toBe(true);
      expect(typeof snapshot.sequenceNumber).toBe('string');
      expect(snapshot.timestamp).toBeDefined();
    });

    it('rejects subscription to non-existent market with MARKET_NOT_FOUND', async () => {
      const client = await connectClient();

      const errorEvent = await new Promise((resolve) => {
        client.on('market:error', (err) => resolve(err));
        client.emit('market:subscribe', {
          eventId: 'non-existent-event',
          ticketCategoryId: 'non-existent-cat',
        });
      });

      expect(errorEvent).toBeDefined();
      expect(errorEvent.code).toBe('MARKET_NOT_FOUND');
    });

    it('rejects subscription with invalid payload / room-name injection attempt', async () => {
      const client = await connectClient();

      const errorEvent = await new Promise((resolve) => {
        client.on('market:error', (err) => resolve(err));
        client.emit('market:subscribe', {
          eventId: 'malicious:event:id', // Colons forbidden to prevent room injection
          ticketCategoryId: testCat1.id,
        });
      });

      expect(errorEvent).toBeDefined();
      expect(errorEvent.code).toBe('INVALID_PAYLOAD');
    });

    it('successfully unsubscribes from a subscribed market', async () => {
      const client = await connectClient();

      // Subscribe first
      await new Promise((resolve) => {
        client.emit(
          'market:subscribe',
          { eventId: testEvent1.id, ticketCategoryId: testCat1.id },
          resolve
        );
      });

      // Unsubscribe
      const unsubs = await new Promise((resolve) => {
        client.emit(
          'market:unsubscribe',
          { eventId: testEvent1.id, ticketCategoryId: testCat1.id },
          (err, res) => resolve(res)
        );
      });

      expect(unsubs.success).toBe(true);
      expect(unsubs.eventId).toBe(testEvent1.id);
    });
  });

  // --------------------------------------------------------------------------
  // Scenario 3: Unauthorized private order-fill subscription or delivery
  // --------------------------------------------------------------------------
  describe('3. Private Order-Fill Delivery Isolation', () => {
    it('delivers order:fill strictly to the authenticated buyer and seller, never to an unauthorized observer', async () => {
      // Connect Buyer (authenticated)
      const buyerSocket = await connectClient({ auth: { token: buyerToken } });
      // Connect Seller (authenticated)
      const sellerSocket = await connectClient({ auth: { token: sellerToken } });
      // Connect Observer (authenticated as different user)
      const observerSocket = await connectClient({ auth: { token: observerToken } });
      // Connect Public (unauthenticated)
      const publicSocket = await connectClient();

      // Subscribe all to the public market
      await Promise.all([
        new Promise((res) =>
          buyerSocket.emit(
            'market:subscribe',
            { eventId: testEvent1.id, ticketCategoryId: testCat1.id },
            res
          )
        ),
        new Promise((res) =>
          sellerSocket.emit(
            'market:subscribe',
            { eventId: testEvent1.id, ticketCategoryId: testCat1.id },
            res
          )
        ),
        new Promise((res) =>
          observerSocket.emit(
            'market:subscribe',
            { eventId: testEvent1.id, ticketCategoryId: testCat1.id },
            res
          )
        ),
        new Promise((res) =>
          publicSocket.emit(
            'market:subscribe',
            { eventId: testEvent1.id, ticketCategoryId: testCat1.id },
            res
          )
        ),
      ]);

      const buyerFills = [];
      const sellerFills = [];
      const observerFills = [];
      const publicFills = [];

      buyerSocket.on('order:fill', (fill) => buyerFills.push(fill));
      sellerSocket.on('order:fill', (fill) => sellerFills.push(fill));
      observerSocket.on('order:fill', (fill) => observerFills.push(fill));
      publicSocket.on('order:fill', (fill) => publicFills.push(fill));

      // 1. Seller places resting ASK @ 5000 paise (50.00 INR) for 2 tickets
      const askOrder = await orderService.placeLimitOrder({
        userId: sellerUser.id,
        eventId: testEvent1.id,
        ticketCategoryId: testCat1.id,
        side: 'ASK',
        price: 5000,
        quantity: 2,
        idempotencyKey: `ask-fill-test-${suffix}`,
      });
      expect(askOrder.status).toBe('OPEN');

      // 2. Buyer places aggressive BID @ 5000 paise for 2 tickets (matches resting ASK!)
      const bidOrder = await orderService.placeLimitOrder({
        userId: buyerUser.id,
        eventId: testEvent1.id,
        ticketCategoryId: testCat1.id,
        side: 'BID',
        price: 5000,
        quantity: 2,
        idempotencyKey: `bid-fill-test-${suffix}`,
      });
      expect(bidOrder.status).toBe('FILLED');

      // Allow async events to propagate
      await new Promise((r) => setTimeout(r, 100));

      // Assertions:
      // Buyer received fill notification for their BID order
      expect(buyerFills.length).toBeGreaterThanOrEqual(1);
      const buyerFill = buyerFills.find((f) => f.orderId === bidOrder.orderId);
      expect(buyerFill).toBeDefined();
      expect(buyerFill.side).toBe('BID');
      expect(buyerFill.fillPrice).toBe(5000);
      expect(buyerFill.fillQuantity).toBe(2);

      // Seller received fill notification for their resting ASK order
      expect(sellerFills.length).toBeGreaterThanOrEqual(1);
      const sellerFill = sellerFills.find((f) => f.orderId === askOrder.orderId);
      expect(sellerFill).toBeDefined();
      expect(sellerFill.side).toBe('ASK');
      expect(sellerFill.fillPrice).toBe(5000);
      expect(sellerFill.fillQuantity).toBe(2);

      // CRITICAL SECURITY INVARIANT: Observer and Public sockets NEVER receive private order:fill
      expect(observerFills.length).toBe(0);
      expect(publicFills.length).toBe(0);
    });
  });

  // --------------------------------------------------------------------------
  // Scenario 4: Market isolation across different event/category pairs
  // --------------------------------------------------------------------------
  describe('4. Market Isolation', () => {
    it('ensures trades in Market 1 are not broadcast to subscribers of Market 2', async () => {
      const clientMarket1 = await connectClient();
      const clientMarket2 = await connectClient();

      await new Promise((res) =>
        clientMarket1.emit(
          'market:subscribe',
          { eventId: testEvent1.id, ticketCategoryId: testCat1.id },
          res
        )
      );
      await new Promise((res) =>
        clientMarket2.emit(
          'market:subscribe',
          { eventId: testEvent2.id, ticketCategoryId: testCat2.id },
          res
        )
      );

      const market1Trades = [];
      const market2Trades = [];

      clientMarket1.on('market:trade', (t) => market1Trades.push(t));
      clientMarket2.on('market:trade', (t) => market2Trades.push(t));

      // Match a trade in Market 1
      await orderService.placeLimitOrder({
        userId: sellerUser.id,
        eventId: testEvent1.id,
        ticketCategoryId: testCat1.id,
        side: 'ASK',
        price: 6000,
        quantity: 1,
        idempotencyKey: `ask-m1-iso-${suffix}`,
      });

      await orderService.placeLimitOrder({
        userId: buyerUser.id,
        eventId: testEvent1.id,
        ticketCategoryId: testCat1.id,
        side: 'BID',
        price: 6000,
        quantity: 1,
        idempotencyKey: `bid-m1-iso-${suffix}`,
      });

      await new Promise((r) => setTimeout(r, 100));

      expect(market1Trades.length).toBe(1);
      expect(market1Trades[0].eventId).toBe(testEvent1.id);
      expect(market1Trades[0].ticketCategoryId).toBe(testCat1.id);

      // Client subscribed to Market 2 received ZERO trade events
      expect(market2Trades.length).toBe(0);
    });
  });

  // --------------------------------------------------------------------------
  // Scenario 5: Snapshot plus subsequent update consistency
  // --------------------------------------------------------------------------
  describe('5. Snapshot and Monotonic Update Consistency', () => {
    it('delivers snapshot followed by monotonic trade and depth updates', async () => {
      const client = await connectClient();

      const snapshot = await new Promise((res) => {
        client.emit(
          'market:subscribe',
          { eventId: testEvent2.id, ticketCategoryId: testCat2.id },
          (err, data) => res(data)
        );
      });

      const initialSeq = BigInt(snapshot.sequenceNumber || '0');

      const trades = [];
      const depthUpdates = [];
      client.on('market:trade', (t) => trades.push(t));
      client.on('market:orderbook', (d) => depthUpdates.push(d));

      // Match a trade in Market 2
      await orderService.placeLimitOrder({
        userId: sellerUser.id,
        eventId: testEvent2.id,
        ticketCategoryId: testCat2.id,
        side: 'ASK',
        price: 7000,
        quantity: 1,
        idempotencyKey: `ask-seq-test-${suffix}`,
      });

      await orderService.placeLimitOrder({
        userId: buyerUser.id,
        eventId: testEvent2.id,
        ticketCategoryId: testCat2.id,
        side: 'BID',
        price: 7000,
        quantity: 1,
        idempotencyKey: `bid-seq-test-${suffix}`,
      });

      await new Promise((r) => setTimeout(r, 100));

      expect(trades.length).toBe(1);
      const tradeSeq = BigInt(trades[0].sequenceNumber);
      expect(tradeSeq).toBeGreaterThan(initialSeq);

      expect(depthUpdates.length).toBeGreaterThanOrEqual(1);
      const latestDepth = depthUpdates[depthUpdates.length - 1];
      expect(BigInt(latestDepth.sequenceNumber)).toBeGreaterThanOrEqual(tradeSeq);
    });
  });

  // --------------------------------------------------------------------------
  // Scenarios 6 & 7: Commit-to-broadcast boundary and rollback safety
  // --------------------------------------------------------------------------
  describe('6 & 7. Commit-to-Broadcast Boundary & Rollback Protection', () => {
    it('does NOT emit trade or orderbook events when an order submission is rejected or rolls back', async () => {
      const client = await connectClient();
      await new Promise((res) =>
        client.emit(
          'market:subscribe',
          { eventId: testEvent1.id, ticketCategoryId: testCat1.id },
          res
        )
      );

      const trades = [];
      const depthUpdates = [];
      client.on('market:trade', (t) => trades.push(t));
      client.on('market:orderbook', (d) => depthUpdates.push(d));

      // Attempt order placement with zero funds (fails at pre-matching reservation)
      await expect(
        orderService.placeLimitOrder({
          userId: 'user-with-zero-funds',
          eventId: testEvent1.id,
          ticketCategoryId: testCat1.id,
          side: 'BID',
          price: 5000,
          quantity: 1,
          idempotencyKey: `failed-order-${suffix}`,
        })
      ).rejects.toThrow();

      await new Promise((r) => setTimeout(r, 100));

      expect(trades.length).toBe(0);
      expect(depthUpdates.length).toBe(0);
    });
  });

  // --------------------------------------------------------------------------
  // Scenario 8: Idempotent submissions do not produce duplicate logical trades
  // --------------------------------------------------------------------------
  describe('8. Idempotent Deduplication', () => {
    it('does not re-broadcast trade or fill notifications on idempotent order replay', async () => {
      const buyerSocket = await connectClient({ auth: { token: buyerToken } });
      const publicSocket = await connectClient();

      await new Promise((res) =>
        publicSocket.emit(
          'market:subscribe',
          { eventId: testEvent1.id, ticketCategoryId: testCat1.id },
          res
        )
      );

      const publicTrades = [];
      const buyerFills = [];

      publicSocket.on('market:trade', (t) => publicTrades.push(t));
      buyerSocket.on('order:fill', (f) => buyerFills.push(f));

      // Setup resting ask
      await orderService.placeLimitOrder({
        userId: sellerUser.id,
        eventId: testEvent1.id,
        ticketCategoryId: testCat1.id,
        side: 'ASK',
        price: 8000,
        quantity: 1,
        idempotencyKey: `ask-idemp-setup-${suffix}`,
      });

      const bidKey = `bid-idemp-dedup-${suffix}`;

      // First submission (fresh match)
      const first = await orderService.placeLimitOrder({
        userId: buyerUser.id,
        eventId: testEvent1.id,
        ticketCategoryId: testCat1.id,
        side: 'BID',
        price: 8000,
        quantity: 1,
        idempotencyKey: bidKey,
      });
      expect(first.isDuplicate).toBe(false);

      await new Promise((r) => setTimeout(r, 100));
      expect(publicTrades.length).toBe(1);
      expect(buyerFills.length).toBe(1);

      // Clear recorded counts
      publicTrades.length = 0;
      buyerFills.length = 0;

      // Second submission (idempotent replay of identical order)
      const replay = await orderService.placeLimitOrder({
        userId: buyerUser.id,
        eventId: testEvent1.id,
        ticketCategoryId: testCat1.id,
        side: 'BID',
        price: 8000,
        quantity: 1,
        idempotencyKey: bidKey,
      });
      expect(replay.isDuplicate).toBe(true);

      await new Promise((r) => setTimeout(r, 100));

      // Deduplication invariant: ZERO new trades or fills broadcast on idempotent replay
      expect(publicTrades.length).toBe(0);
      expect(buyerFills.length).toBe(0);
    });
  });

  // --------------------------------------------------------------------------
  // Scenario 9: Reconnection and snapshot resynchronization after sequence gap
  // --------------------------------------------------------------------------
  describe('9. Sequence Gap Detection and Snapshot Resynchronization', () => {
    it('allows client to resynchronize authoritative state via market:snapshot_request when a gap is detected', async () => {
      const client = await connectClient();

      // 1. Initial snapshot
      const initialSnapshot = await new Promise((res) => {
        client.emit(
          'market:subscribe',
          { eventId: testEvent1.id, ticketCategoryId: testCat1.id },
          (err, data) => res(data)
        );
      });

      const initialSeq = BigInt(initialSnapshot.sequenceNumber);

      // 2. Client simulates missing an intermediate update (e.g. temporary network drop)
      // Execute 2 trades in the market
      await orderService.placeLimitOrder({
        userId: sellerUser.id,
        eventId: testEvent1.id,
        ticketCategoryId: testCat1.id,
        side: 'ASK',
        price: 9000,
        quantity: 1,
        idempotencyKey: `ask-gap-1-${suffix}`,
      });
      await orderService.placeLimitOrder({
        userId: buyerUser.id,
        eventId: testEvent1.id,
        ticketCategoryId: testCat1.id,
        side: 'BID',
        price: 9000,
        quantity: 1,
        idempotencyKey: `bid-gap-1-${suffix}`,
      });

      await orderService.placeLimitOrder({
        userId: sellerUser.id,
        eventId: testEvent1.id,
        ticketCategoryId: testCat1.id,
        side: 'ASK',
        price: 9100,
        quantity: 1,
        idempotencyKey: `ask-gap-2-${suffix}`,
      });
      await orderService.placeLimitOrder({
        userId: buyerUser.id,
        eventId: testEvent1.id,
        ticketCategoryId: testCat1.id,
        side: 'BID',
        price: 9100,
        quantity: 1,
        idempotencyKey: `bid-gap-2-${suffix}`,
      });

      // 3. Client requests fresh authoritative snapshot
      const resyncedSnapshot = await new Promise((res) => {
        client.emit(
          'market:snapshot_request',
          { eventId: testEvent1.id, ticketCategoryId: testCat1.id },
          (err, data) => res(data)
        );
      });

      expect(resyncedSnapshot.v).toBe(1);
      expect(resyncedSnapshot.eventId).toBe(testEvent1.id);
      expect(resyncedSnapshot.ticketCategoryId).toBe(testCat1.id);
      expect(BigInt(resyncedSnapshot.sequenceNumber)).toBeGreaterThan(initialSeq);
    });
  });

  // --------------------------------------------------------------------------
  // Scenario 10: Disconnect cleanup and subscription limits
  // --------------------------------------------------------------------------
  describe('10. Subscription Limits and Cleanup', () => {
    it('enforces maximum subscription bounds per socket', async () => {
      const originalMax = marketStreamService.maxSubscriptionsPerSocket;
      marketStreamService.maxSubscriptionsPerSocket = 2;

      try {
        const client = await connectClient();

        // Subscribe 1
        await new Promise((res) =>
          client.emit(
            'market:subscribe',
            { eventId: testEvent1.id, ticketCategoryId: testCat1.id },
            res
          )
        );

        // Subscribe 2
        await new Promise((res) =>
          client.emit(
            'market:subscribe',
            { eventId: testEvent2.id, ticketCategoryId: testCat2.id },
            res
          )
        );

        // Subscribe 3 (exceeds limit of 2!)
        const result3 = await new Promise((res) => {
          client.emit(
            'market:subscribe',
            { eventId: testEvent1.id, ticketCategoryId: testCat2.id },
            (err, data) => res({ err, data })
          );
        });

        expect(result3.err).toBeDefined();
        expect(result3.err.code).toBe('SUBSCRIPTION_LIMIT_EXCEEDED');
      } finally {
        marketStreamService.maxSubscriptionsPerSocket = originalMax;
      }
    });

    it('cleans up client subscriptions set upon disconnect', async () => {
      const client = await connectClient();
      await new Promise((res) =>
        client.emit(
          'market:subscribe',
          { eventId: testEvent1.id, ticketCategoryId: testCat1.id },
          res
        )
      );

      const serverSocket = ioServer.sockets.sockets.get(client.id);
      expect(serverSocket).toBeDefined();
      expect(serverSocket.data.subscriptions.size).toBeGreaterThan(0);

      client.disconnect();
      await new Promise((r) => setTimeout(r, 50));

      expect(serverSocket.data.subscriptions).toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // Scenario 11: Multi-instance adapter isolation behavior
  // --------------------------------------------------------------------------
  describe('11. Multi-Instance Deployment Isolation Verification', () => {
    it('documents and verifies that standalone in-memory adapters isolate broadcasts to their local instance', async () => {
      // Standalone Socket.IO Server 2 without distributed adapter
      const http2 = http.createServer();
      const io2 = new Server(http2);
      const stream2 = new MarketStreamService({ io: io2, prismaClient: livePrisma });

      await new Promise((res) => http2.listen(0, res));
      const port2 = http2.address().port;

      const clientOnServer1 = await connectClient();
      const clientOnServer2 = await new Promise((res) => {
        const s = ioc(`http://localhost:${port2}`, { transports: ['websocket'] });
        openSockets.push(s);
        s.on('connect', () => res(s));
      });

      await new Promise((res) =>
        clientOnServer1.emit(
          'market:subscribe',
          { eventId: testEvent1.id, ticketCategoryId: testCat1.id },
          res
        )
      );
      await new Promise((res) =>
        clientOnServer2.emit(
          'market:subscribe',
          { eventId: testEvent1.id, ticketCategoryId: testCat1.id },
          res
        )
      );

      const server1Trades = [];
      const server2Trades = [];

      clientOnServer1.on('market:trade', (t) => server1Trades.push(t));
      clientOnServer2.on('market:trade', (t) => server2Trades.push(t));

      // Broadcast on Server 1
      marketStreamService.publishMarketTrade({
        eventId: testEvent1.id,
        ticketCategoryId: testCat1.id,
        tradeId: 't-123',
        price: 5000,
        quantity: 1,
        sequenceNumber: '1',
      });

      await new Promise((r) => setTimeout(r, 50));

      // Client connected to Server 1 receives broadcast
      expect(server1Trades.length).toBe(1);

      // Client connected to Server 2 does NOT receive broadcast (default standalone adapter behavior)
      expect(server2Trades.length).toBe(0);

      io2.close();
      http2.close();
    });
  });

  // --------------------------------------------------------------------------
  // Scenario 12: Read-only WebSocket client boundary
  // --------------------------------------------------------------------------
  describe('12. Read-Only Client Boundary Enforcement', () => {
    it('strictly rejects client mutation attempts (order:place, order:cancel, wallet:mutate)', async () => {
      const client = await connectClient();

      const mutationResults = await Promise.all([
        new Promise((res) => client.emit('order:place', { price: 5000 }, res)),
        new Promise((res) => client.emit('order:cancel', { orderId: '123' }, res)),
        new Promise((res) => client.emit('wallet:mutate', { amount: 100 }, res)),
      ]);

      for (const res of mutationResults) {
        expect(res.code).toBe('FORBIDDEN_MUTATION');
        expect(res.error).toMatch(/Mutations not permitted via WebSocket/i);
      }
    });
  });
});
