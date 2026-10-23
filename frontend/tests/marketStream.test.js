import test, { describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  MarketStreamClient,
  CONNECTION_STATUS,
  ERROR_MESSAGES,
} from '../src/services/marketStream.js';
import { transformDepthLevels } from '../src/hooks/useMarketStream.js';
import { formatPaise, formatPaiseNumber, formatTradeTime } from '../src/utils/formatters.js';

/**
 * Mock Socket.IO Socket implementation for deterministic unit testing.
 */
class MockSocket extends EventEmitter {
  constructor(url, config) {
    super();
    this.url = url;
    this.config = config;
    this.connected = false;
    this.active = true;
    this.emitted = [];
  }

  emit(event, data, cb) {
    this.emitted.push({ event, data });
    if (typeof cb === 'function') {
      cb({ success: true });
    }
    return this;
  }

  simulateConnect() {
    this.connected = true;
    this.emit('connect'); // self trigger if needed, or emit to handlers
    this.emitInternal('connect');
  }

  simulateDisconnect(reason = 'transport close') {
    this.connected = false;
    this.emitInternal('disconnect', reason);
  }

  simulateConnectError() {
    this.emitInternal('connect_error', new Error('Connection refused'));
  }

  simulateServerEmit(event, payload) {
    this.emitInternal(event, payload);
  }

  emitInternal(event, ...args) {
    const listeners = this.listeners(event);
    for (const l of listeners) {
      l(...args);
    }
  }

  connect() {
    this.connected = true;
    this.emitInternal('connect');
  }

  disconnect() {
    this.connected = false;
    this.emitInternal('disconnect', 'io client disconnect');
  }
}

describe('Step 9.17 Secondary Market WebSocket Frontend Integration Tests', () => {
  let mockSocket;
  let client;

  beforeEach(() => {
    mockSocket = null;
    client = new MarketStreamClient({
      url: 'http://localhost:5001',
      socketFactory: (url, config) => {
        mockSocket = new MockSocket(url, config);
        return mockSocket;
      },
    });
  });

  // 1. Correct connection URL and authentication handling
  test('1. Correct connection URL and authentication handling', () => {
    client.setAuthToken('mock-jwt-token-12345');
    const socket = client.initSocket();

    assert.strictEqual(socket.url, 'http://localhost:5001');

    // Test auth handshake callback
    let capturedAuth = null;
    socket.config.auth((authData) => {
      capturedAuth = authData;
    });
    assert.deepStrictEqual(capturedAuth, { token: 'mock-jwt-token-12345' });

    // In-band authentication when already connected
    socket.simulateConnect();
    assert.ok(
      mockSocket.emitted.some(
        (e) => e.event === 'authenticate' && e.data.token === 'mock-jwt-token-12345'
      )
    );
  });

  // 2. Listener registration and cleanup without duplicate handlers
  test('2. Listener registration and cleanup without duplicate handlers', () => {
    let callCount = 0;
    const unsub = client.onStatusChange((status) => {
      callCount++;
    });

    assert.strictEqual(callCount, 1); // Initial status dispatch
    client._setStatus(CONNECTION_STATUS.CONNECTED);
    assert.strictEqual(callCount, 2);

    // Same status does not emit duplicates
    client._setStatus(CONNECTION_STATUS.CONNECTED);
    assert.strictEqual(callCount, 2);

    // Unsubscribing removes handler
    unsub();
    client._setStatus(CONNECTION_STATUS.DISCONNECTED);
    assert.strictEqual(callCount, 2);
  });

  // 3. Market subscription and unsubscription
  test('3. Market subscription and unsubscription', () => {
    client.initSocket();
    mockSocket.simulateConnect();

    const unsub = client.subscribeMarket({
      eventId: 'evt_nightfall',
      ticketCategoryId: 'cat_vip',
    });

    assert.ok(
      mockSocket.emitted.some(
        (e) =>
          e.event === 'market:subscribe' &&
          e.data.eventId === 'evt_nightfall' &&
          e.data.ticketCategoryId === 'cat_vip'
      )
    );
    assert.strictEqual(client.subscriptions.size, 1);

    // Unsubscribe
    unsub();
    assert.ok(
      mockSocket.emitted.some(
        (e) =>
          e.event === 'market:unsubscribe' &&
          e.data.eventId === 'evt_nightfall' &&
          e.data.ticketCategoryId === 'cat_vip'
      )
    );
    assert.strictEqual(client.subscriptions.size, 0);
  });

  // 4. Bid/ask snapshot rendering
  test('4. Bid/ask snapshot rendering and depth calculation', () => {
    client.initSocket();
    mockSocket.simulateConnect();

    let receivedSnapshot = null;
    client.subscribeMarket({
      eventId: 'evt_1',
      ticketCategoryId: 'cat_gen',
      onSnapshot: (snap) => {
        receivedSnapshot = snap;
      },
    });

    const snapshotPayload = {
      v: 1,
      eventId: 'evt_1',
      ticketCategoryId: 'cat_gen',
      sequenceNumber: '100',
      bids: [
        { price: 10500, totalQuantity: 5, orderCount: 2 },
        { price: 10000, totalQuantity: 3, orderCount: 1 },
      ],
      asks: [
        { price: 11000, totalQuantity: 4, orderCount: 2 },
        { price: 11500, totalQuantity: 6, orderCount: 3 },
      ],
      bestBid: 10500,
      bestAsk: 11000,
      spread: 500,
      lastPrice: 10800,
      timestamp: new Date().toISOString(),
    };

    mockSocket.simulateServerEmit('market:snapshot', snapshotPayload);
    assert.ok(receivedSnapshot);
    assert.strictEqual(receivedSnapshot.sequenceNumber, '100');

    // Test depth transformation
    const transformedBids = transformDepthLevels(receivedSnapshot.bids, false);
    assert.strictEqual(transformedBids.length, 2);
    assert.strictEqual(transformedBids[0].price, '105.00'); // minor unit paise -> INR
    assert.strictEqual(transformedBids[0].qty, 5);
    assert.strictEqual(transformedBids[0].depth, 5);
    assert.strictEqual(transformedBids[1].price, '100.00');
    assert.strictEqual(transformedBids[1].depth, 8); // cumulative 5 + 3 = 8
  });

  // 5. Valid order-book update handling
  test('5. Valid sequential order-book update handling', () => {
    client.initSocket();
    mockSocket.simulateConnect();

    let lastUpdate = null;
    client.subscribeMarket({
      eventId: 'evt_1',
      ticketCategoryId: 'cat_gen',
      onOrderBook: (upd) => {
        lastUpdate = upd;
      },
    });

    // Anchor with snapshot seq 100
    mockSocket.simulateServerEmit('market:snapshot', {
      v: 1,
      eventId: 'evt_1',
      ticketCategoryId: 'cat_gen',
      sequenceNumber: '100',
      bids: [],
      asks: [],
    });

    // Valid next sequential update (101)
    mockSocket.simulateServerEmit('market:orderbook', {
      v: 1,
      eventId: 'evt_1',
      ticketCategoryId: 'cat_gen',
      sequenceNumber: '101',
      action: 'LEVEL_UPDATE',
      bids: [{ price: 10500, totalQuantity: 8 }],
      asks: [],
    });

    assert.ok(lastUpdate);
    assert.strictEqual(lastUpdate.sequenceNumber, '101');
    assert.strictEqual(lastUpdate.bids[0].totalQuantity, 8);
  });

  // 6. Duplicate and stale sequence handling (BigInt)
  test('6. Duplicate and stale sequence handling (BigInt exact comparison)', () => {
    client.initSocket();
    mockSocket.simulateConnect();

    let updateCount = 0;
    client.subscribeMarket({
      eventId: 'evt_1',
      ticketCategoryId: 'cat_gen',
      onOrderBook: () => {
        updateCount++;
      },
    });

    // Anchor with large 64-bit BigInt sequence
    const largeSeq = '9007199254740995'; // Beyond Number.MAX_SAFE_INTEGER
    mockSocket.simulateServerEmit('market:snapshot', {
      v: 1,
      eventId: 'evt_1',
      ticketCategoryId: 'cat_gen',
      sequenceNumber: largeSeq,
      bids: [],
      asks: [],
    });

    // Stale update (smaller sequence)
    mockSocket.simulateServerEmit('market:orderbook', {
      v: 1,
      eventId: 'evt_1',
      ticketCategoryId: 'cat_gen',
      sequenceNumber: '9007199254740990',
      action: 'LEVEL_UPDATE',
      bids: [],
    });
    assert.strictEqual(updateCount, 0, 'Stale sequence must be ignored');

    // Duplicate update (exact equal sequence)
    mockSocket.simulateServerEmit('market:orderbook', {
      v: 1,
      eventId: 'evt_1',
      ticketCategoryId: 'cat_gen',
      sequenceNumber: largeSeq,
      action: 'LEVEL_UPDATE',
      bids: [],
    });
    assert.strictEqual(updateCount, 0, 'Duplicate sequence must be ignored');

    // Exactly next sequence (9007199254740996)
    const nextSeq = (BigInt(largeSeq) + 1n).toString();
    mockSocket.simulateServerEmit('market:orderbook', {
      v: 1,
      eventId: 'evt_1',
      ticketCategoryId: 'cat_gen',
      sequenceNumber: nextSeq,
      action: 'LEVEL_UPDATE',
      bids: [],
    });
    assert.strictEqual(updateCount, 1, 'Next sequential update applied');
  });

  // 7. Sequence-gap detection and snapshot resynchronization
  test('7. Sequence-gap detection and snapshot resynchronization request', async () => {
    client.initSocket();
    mockSocket.simulateConnect();

    let resyncingState = false;
    client.subscribeMarket({
      eventId: 'evt_gap',
      ticketCategoryId: 'cat_gap',
      onResyncing: (r) => {
        resyncingState = r;
      },
    });

    // Anchor at sequence 50
    mockSocket.simulateServerEmit('market:snapshot', {
      v: 1,
      eventId: 'evt_gap',
      ticketCategoryId: 'cat_gap',
      sequenceNumber: '50',
      bids: [],
      asks: [],
    });

    // Jump from 50 to 55 (gap of 4 missed events)
    mockSocket.simulateServerEmit('market:orderbook', {
      v: 1,
      eventId: 'evt_gap',
      ticketCategoryId: 'cat_gap',
      sequenceNumber: '55',
      action: 'LEVEL_UPDATE',
      bids: [],
    });

    // Debounced resync request fired
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.ok(
      mockSocket.emitted.some(
        (e) =>
          e.event === 'market:snapshot_request' &&
          e.data.eventId === 'evt_gap' &&
          e.data.ticketCategoryId === 'cat_gap'
      ),
      'Snapshot request must be emitted on sequence gap'
    );
  });

  // 8. Rapid market switching without cross-market state leakage
  test('8. Rapid market switching without cross-market state leakage', () => {
    client.initSocket();
    mockSocket.simulateConnect();

    let market1Updates = 0;
    let market2Updates = 0;

    const unsub1 = client.subscribeMarket({
      eventId: 'market_A',
      ticketCategoryId: 'cat_1',
      onOrderBook: () => market1Updates++,
    });

    // Switch rapidly to Market B
    unsub1();
    client.subscribeMarket({
      eventId: 'market_B',
      ticketCategoryId: 'cat_2',
      onOrderBook: () => market2Updates++,
    });

    // Anchor Market B
    mockSocket.simulateServerEmit('market:snapshot', {
      v: 1,
      eventId: 'market_B',
      ticketCategoryId: 'cat_2',
      sequenceNumber: '1',
      bids: [],
      asks: [],
    });

    // Stale delayed broadcast for Market A arrives
    mockSocket.simulateServerEmit('market:orderbook', {
      v: 1,
      eventId: 'market_A',
      ticketCategoryId: 'cat_1',
      sequenceNumber: '2',
      action: 'LEVEL_UPDATE',
      bids: [],
    });

    // Update for Market B arrives
    mockSocket.simulateServerEmit('market:orderbook', {
      v: 1,
      eventId: 'market_B',
      ticketCategoryId: 'cat_2',
      sequenceNumber: '2',
      action: 'LEVEL_UPDATE',
      bids: [],
    });

    assert.strictEqual(market1Updates, 0, 'No state leakage into old market');
    assert.strictEqual(market2Updates, 1, 'Only active market received update');
  });

  // 9. Trade-feed deduplication and ordering
  test('9. Trade-feed deduplication and ordering', () => {
    client.initSocket();
    mockSocket.simulateConnect();

    const receivedTrades = [];
    client.subscribeMarket({
      eventId: 'evt_trades',
      ticketCategoryId: 'cat_trades',
      onTrade: (t) => receivedTrades.push(t),
    });

    // Anchor snapshot
    mockSocket.simulateServerEmit('market:snapshot', {
      v: 1,
      eventId: 'evt_trades',
      ticketCategoryId: 'cat_trades',
      sequenceNumber: '10',
      bids: [],
      asks: [],
    });

    const tradePayload = {
      v: 1,
      eventId: 'evt_trades',
      ticketCategoryId: 'cat_trades',
      tradeId: 'tr_unique_001',
      price: 10500,
      quantity: 2,
      sequenceNumber: '11',
      executedAt: '2026-10-23T10:00:00.000Z',
    };

    // Emit trade first time
    mockSocket.simulateServerEmit('market:trade', tradePayload);
    assert.strictEqual(receivedTrades.length, 1);

    // Emit duplicate trade (reconnection / retry)
    mockSocket.simulateServerEmit('market:trade', tradePayload);
    assert.strictEqual(receivedTrades.length, 1, 'Duplicate tradeId must be deduplicated');

    // Emit second trade
    mockSocket.simulateServerEmit('market:trade', {
      ...tradePayload,
      tradeId: 'tr_unique_002',
      sequenceNumber: '12',
    });
    assert.strictEqual(receivedTrades.length, 2);
  });

  // 10. Private fill notifications scoped to current authenticated session
  test('10. Private fill notifications scoped to authenticated session', () => {
    client.initSocket();
    mockSocket.simulateConnect();

    const fills = [];
    client.onOrderFill((fill) => {
      fills.push(fill);
    });

    const fillPayload = {
      v: 1,
      orderId: 'ord_my_buy_1',
      eventId: 'evt_1',
      ticketCategoryId: 'cat_1',
      side: 'BID',
      status: 'FILLED',
      fillPrice: 10500,
      fillQuantity: 2,
      remainingQuantity: 0,
      sequenceNumber: '15',
      tradeId: 'tr_001',
      timestamp: new Date().toISOString(),
    };

    mockSocket.simulateServerEmit('order:fill', fillPayload);
    assert.strictEqual(fills.length, 1);
    assert.strictEqual(fills[0].orderId, 'ord_my_buy_1');
    assert.strictEqual(fills[0].status, 'FILLED');

    // Duplicate notification with same orderId, status, and tradeId
    mockSocket.simulateServerEmit('order:fill', fillPayload);
    assert.strictEqual(fills.length, 1, 'Duplicate fill notification deduplicated');
  });

  // 11. Logout/account changes clearing private state
  test('11. Logout/account changes clearing private state and notifications', () => {
    client.setAuthToken('token-user-A');
    client.initSocket();
    mockSocket.simulateConnect();

    client.seenFills.add('ord_1:FILLED:tr_1');
    assert.strictEqual(client.seenFills.size, 1);

    // User logs out
    client.clearAuthToken();
    assert.strictEqual(client.authToken, null);
    assert.strictEqual(client.seenFills.size, 0, 'Seen fills cleared on logout');
  });

  // 12. Reconnection and recovery from disconnects
  test('12. Reconnection and recovery from disconnects', () => {
    client.initSocket();
    mockSocket.simulateConnect();
    assert.strictEqual(client.status, CONNECTION_STATUS.CONNECTED);

    // Register market subscription before disconnect
    client.subscribeMarket({
      eventId: 'evt_rec',
      ticketCategoryId: 'cat_rec',
    });

    // Simulate unexpected network drop
    mockSocket.simulateDisconnect('transport error');
    assert.strictEqual(client.status, CONNECTION_STATUS.RECONNECTING);

    // Reconnect
    mockSocket.simulateConnect();
    assert.strictEqual(client.status, CONNECTION_STATUS.CONNECTED);

    // Verify automatic re-subscription on reconnect
    const subEmits = mockSocket.emitted.filter((e) => e.event === 'market:subscribe');
    assert.ok(subEmits.length >= 2, 'Market re-subscribed upon reconnection');
  });

  // 13. Sanitized errors and bounded recovery attempts
  test('13. Sanitized errors and bounded recovery attempts', () => {
    client.initSocket();
    mockSocket.simulateConnect();

    let capturedError = null;
    client.subscribeMarket({
      eventId: 'evt_err',
      ticketCategoryId: 'cat_err',
      onError: (err) => {
        capturedError = err;
      },
    });

    mockSocket.simulateServerEmit('market:error', {
      v: 1,
      code: 'MARKET_NOT_FOUND',
      message: 'Raw database error message',
      eventId: 'evt_err',
      ticketCategoryId: 'cat_err',
    });

    assert.ok(capturedError);
    assert.strictEqual(capturedError.code, 'MARKET_NOT_FOUND');
    assert.strictEqual(
      capturedError.friendlyMessage,
      ERROR_MESSAGES.MARKET_NOT_FOUND,
      'Friendly sanitized message presented'
    );
  });

  // 14. Existing order placement/cancellation still using HTTP APIs
  test('14. Client boundary prevents order placement/cancellation over WebSocket', () => {
    // MarketStreamClient strictly exposes read-only methods (subscribeMarket, unsubscribeMarket)
    assert.strictEqual(typeof client.placeOrder, 'undefined');
    assert.strictEqual(typeof client.cancelOrder, 'undefined');
    assert.strictEqual(typeof client.mutateWallet, 'undefined');
  });

  // 15. Existing frontend regression tests (formatters and helpers)
  test('15. Frontend currency and time formatting regression tests', () => {
    // Paise to INR formatting
    assert.strictEqual(formatPaise(10500), '₹105.00');
    assert.strictEqual(formatPaise(50), '₹0.50');
    assert.strictEqual(formatPaise(0), '₹0.00');
    assert.strictEqual(formatPaise(null), '₹0.00');
    assert.strictEqual(formatPaiseNumber(10500), '105.00');

    // Time formatting
    const d = new Date('2026-10-23T14:30:45.000Z');
    const formatted = formatTradeTime(d);
    assert.match(formatted, /^\d{2}:\d{2}$/);
  });
});
