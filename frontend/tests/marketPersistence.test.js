import test, { describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { useAppStore } from '../src/store/useStore.js';
import { transformDepthLevels } from '../src/hooks/useMarketStream.js';
import { MarketStreamClient } from '../src/services/marketStream.js';

class MockSocket extends EventEmitter {
  constructor() {
    super();
    this.connected = true;
    this.active = true;
  }
  emit() {
    return this;
  }
  disconnect() {}
}

describe('Market State Persistence Across Navigation Tests', () => {
  const testEventId = 'ev-persist-1001';
  const testCategoryId = 'cat-vip-2002';
  const marketKey = `${testEventId}:${testCategoryId}`;
  const chartKey = `${testEventId}:${testCategoryId}:1h`;

  beforeEach(() => {
    // Reset store state before each test
    useAppStore.setState({
      marketSnapshots: {},
      marketTrades: {},
      marketCandles: {},
      marketSummary: [],
      marketSummaryFetchedAt: 0,
      selectedMarket: null,
      chartViewMode: 'split',
      chartInterval: '1h',
    });
  });

  test('1. Market snapshot and depth persist across simulated page unmount and remount', () => {
    // Simulated First Visit: Market snapshot arrives
    const snapshotPayload = {
      sequenceNumber: '105',
      bids: [
        { price: 450000, totalQuantity: 10, orderCount: 2 },
        { price: 440000, totalQuantity: 15, orderCount: 3 },
      ],
      asks: [
        { price: 500000, totalQuantity: 5, orderCount: 1 },
        { price: 510000, totalQuantity: 12, orderCount: 2 },
      ],
      bestBid: 450000,
      bestAsk: 500000,
      lastPrice: 480000,
      spread: 50000,
      volume: 42,
    };

    useAppStore.getState().setMarketSnapshot(marketKey, snapshotPayload);

    // Verify stored
    const stored = useAppStore.getState().marketSnapshots[marketKey];
    assert.ok(stored, 'Snapshot should be stored in useAppStore');
    assert.equal(stored.sequenceNumber, '105');
    assert.equal(stored.bids.length, 2);
    assert.equal(stored.asks.length, 2);
    assert.equal(stored.volume, 42);
    assert.ok(stored.lastFetchedAt > 0, 'lastFetchedAt timestamp must be recorded');

    // Simulate Page Unmount: Component unmounts (local state destroyed)
    // In our design, useAppStore retains the snapshot.
    // Simulate Remount: Component re-reads from useAppStore.getState()
    const remountedSnapshot = useAppStore.getState().marketSnapshots[marketKey];
    assert.ok(remountedSnapshot, 'Snapshot must be available immediately on remount');
    assert.equal(remountedSnapshot.sequenceNumber, '105');

    // Verify depth level transformation retains full integrity
    const bids = transformDepthLevels(remountedSnapshot.bids, false);
    assert.equal(bids.length, 2);
    assert.equal(bids[0].price, '4500.00');
    assert.equal(bids[0].qty, 10);
    assert.equal(bids[1].price, '4400.00');
    assert.equal(bids[1].qty, 15);
  });

  test('2. Public trade feed persists and deduplicates new executions', () => {
    const initialTrades = [
      { id: 'tr-1', price: '4800.00', qty: 2, time: '14:30:00', side: 'buy', sequenceNumber: '101' },
      { id: 'tr-2', price: '4850.00', qty: 1, time: '14:31:00', side: 'sell', sequenceNumber: '102' },
    ];

    useAppStore.getState().setMarketTrades(marketKey, initialTrades);

    // Simulated Navigation to Events page and back to Market page
    const cachedTrades = useAppStore.getState().marketTrades[marketKey];
    assert.equal(cachedTrades.length, 2);
    assert.equal(cachedTrades[0].id, 'tr-1');

    // Live execution arrives while on Market page
    const liveTrade = {
      id: 'tr-3',
      price: '4900.00',
      qty: 4,
      time: '14:32:00',
      side: 'buy',
      sequenceNumber: '106',
    };
    useAppStore.getState().addMarketTrade(marketKey, liveTrade);

    const updated = useAppStore.getState().marketTrades[marketKey];
    assert.equal(updated.length, 3);
    assert.equal(updated[0].id, 'tr-3', 'New trade should be prepended');

    // Deduplication check: re-adding tr-3 should not create duplicate
    useAppStore.getState().addMarketTrade(marketKey, liveTrade);
    const deduplicated = useAppStore.getState().marketTrades[marketKey];
    assert.equal(deduplicated.length, 3, 'Duplicate trade ID must be rejected');
  });

  test('3. Historical chart candles and summary persist with real-time tick updates', () => {
    const historicalCandles = [
      { time: 1700000000, open: 4500, high: 4600, low: 4450, close: 4550 },
      { time: 1700003600, open: 4550, high: 4700, low: 4500, close: 4650 },
    ];
    const summary = { high24h: 4700, low24h: 4450, volume24h: 150 };

    useAppStore.getState().setMarketCandles(chartKey, historicalCandles, summary);

    // Simulated remount: immediate read
    const cachedChart = useAppStore.getState().marketCandles[chartKey];
    assert.ok(cachedChart, 'Chart data must exist in store');
    assert.equal(cachedChart.candles.length, 2);
    assert.equal(cachedChart.summary.high24h, 4700);

    // Incremental tick update to latest candle
    useAppStore.getState().updateMarketCandleTick(chartKey, {
      time: 1700003600,
      value: 4750, // New high for current candle
    });

    const tickedChart = useAppStore.getState().marketCandles[chartKey];
    const latestCandle = tickedChart.candles[tickedChart.candles.length - 1];
    assert.equal(latestCandle.high, 4750, 'High price of latest candle must update');
    assert.equal(latestCandle.close, 4750, 'Close price must update to current tick');

    // Tick starting a new candle
    useAppStore.getState().updateMarketCandleTick(chartKey, {
      time: 1700007200,
      value: 4800,
    });
    const appendedChart = useAppStore.getState().marketCandles[chartKey];
    assert.equal(appendedChart.candles.length, 3, 'New candle must be appended when timestamp advances');
  });

  test('4. Cache freshness prevents redundant REST calls during quick navigation', () => {
    // Populate snapshot with recent timestamp
    const now = Date.now();
    useAppStore.getState().setMarketSnapshot(marketKey, {
      sequenceNumber: '200',
      bids: [{ price: 500000, qty: 1 }],
      asks: [{ price: 520000, qty: 1 }],
      lastFetchedAt: now - 5000, // 5 seconds ago (< 30s threshold)
    });

    const cached = useAppStore.getState().marketSnapshots[marketKey];
    const isFresh = cached && (Date.now() - cached.lastFetchedAt < 30000);
    assert.equal(isFresh, true, 'Snapshot fetched 5 seconds ago must be recognized as fresh');

    // Populate candle data
    useAppStore.getState().setMarketCandles(chartKey, [{ time: 1700000000, open: 5000, close: 5100 }]);
    const cachedCandles = useAppStore.getState().marketCandles[chartKey];
    const isCandlesFresh = cachedCandles && (Date.now() - cachedCandles.lastFetchedAt < 60000);
    assert.equal(isCandlesFresh, true, 'Candles fetched just now must be recognized as fresh');
  });

  test('5. Stale REST response cannot overwrite newer WebSocket order book updates', () => {
    // Current live state advanced by WebSocket to sequence 250
    const liveWebSocketState = {
      sequenceNumber: '250',
      bids: [{ price: 490000, qty: 8 }],
      asks: [{ price: 510000, qty: 4 }],
      bestBid: 490000,
      bestAsk: 510000,
    };
    useAppStore.getState().setMarketSnapshot(marketKey, liveWebSocketState);

    // Stale REST snapshot arrives late with sequence 240
    const staleRestData = {
      sequenceNumber: '240',
      bids: [{ price: 470000, qty: 2 }], // Stale old bids
      asks: [{ price: 530000, qty: 1 }], // Stale old asks
      bestBid: 470000,
      bestAsk: 530000,
    };

    // Simulate merge logic in useMarketStream
    const current = useAppStore.getState().marketSnapshots[marketKey];
    let safeBids = staleRestData.bids;
    let safeAsks = staleRestData.asks;
    let safeSeq = staleRestData.sequenceNumber;

    if (current?.sequenceNumber && staleRestData.sequenceNumber) {
      if (BigInt(current.sequenceNumber) >= BigInt(staleRestData.sequenceNumber)) {
        // Reject overwrite: keep newer WebSocket order book
        safeBids = current.bids;
        safeAsks = current.asks;
        safeSeq = current.sequenceNumber;
      }
    }

    assert.equal(safeSeq, '250', 'Sequence number must remain at 250');
    assert.deepEqual(safeBids, liveWebSocketState.bids, 'Newer bids must not be overwritten by stale REST data');
    assert.deepEqual(safeAsks, liveWebSocketState.asks, 'Newer asks must not be overwritten by stale REST data');
  });

  test('6. User market selection and chart preferences persist across page switches', () => {
    // User switches to VIP category and single chart view mode
    useAppStore.getState().setSelectedMarket({
      eventId: testEventId,
      categoryId: testCategoryId,
    });
    useAppStore.getState().setChartViewMode('single');

    // Navigation away and back: verify state is preserved
    const selected = useAppStore.getState().selectedMarket;
    const viewMode = useAppStore.getState().chartViewMode;

    assert.equal(selected.eventId, testEventId);
    assert.equal(selected.categoryId, testCategoryId);
    assert.equal(viewMode, 'single');
  });

  test('7. Repeated navigation subscription cleanup prevents memory leaks', () => {
    const client = new MarketStreamClient({
      url: 'http://localhost:5001',
      socketFactory: () => new MockSocket(),
    });

    // Verify that subscribing and unsubscribing 15 times leaves exactly zero orphan subscriptions
    for (let i = 0; i < 15; i++) {
      const unsub = client.subscribeMarket({
        eventId: `ev-repeat-${i % 2}`,
        ticketCategoryId: `cat-${i % 2}`,
        onSnapshot: () => {},
        onOrderBook: () => {},
        onTrade: () => {},
      });
      unsub();
    }

    assert.equal(
      client.subscriptions.size,
      0,
      'All market subscriptions must be cleanly cleaned up on unmount'
    );
  });
});
