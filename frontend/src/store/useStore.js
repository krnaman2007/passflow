import { create } from 'zustand';

export const useAppStore = create((set, get) => ({
  // Authentication & Session
  user: null,
  token: null,
  isConnected: false,
  chartSymbol: 'BTC/USDT',

  setUser: (user, token) =>
    set((state) => ({
      user,
      ...(token !== undefined ? { token } : {}),
    })),

  logout: () =>
    set({
      user: null,
      token: null,
    }),

  setConnected: (status) => set({ isConnected: status }),
  setChartSymbol: (symbol) => set({ chartSymbol: symbol }),

  // =========================================================================
  // Persistent Market & Order Book State (survives page navigation)
  // =========================================================================

  // Snapshots keyed by `${eventId}:${ticketCategoryId}`
  // Shape: { bids, asks, sequenceNumber, volume, bestBid, bestAsk, lastPrice, spread, timestamp, lastFetchedAt }
  marketSnapshots: {},

  // Recent public trade execution feed keyed by `${eventId}:${ticketCategoryId}`
  marketTrades: {},

  // Historical OHLCV candle points & summary keyed by `${eventId}:${categoryId || 'all'}:${interval}`
  // Shape: { candles: Array<{ time, open, high, low, close }>, summary: Object, lastFetchedAt: number }
  marketCandles: {},

  // Market Summary (Top traded markets on exchange)
  marketSummary: [],
  marketSummaryFetchedAt: 0,

  // User UI preferences across page transitions
  selectedMarket: null, // { eventId, categoryId }
  chartViewMode: 'split', // 'split' | 'single'
  chartInterval: '1h',

  // Actions: Market Selection & View Settings
  setSelectedMarket: (market) => set({ selectedMarket: market }),
  setChartViewMode: (mode) => set({ chartViewMode: mode }),
  setChartInterval: (interval) => set({ chartInterval: interval }),

  // Action: Set or merge order book snapshot
  setMarketSnapshot: (marketKey, snapshotOrUpdater) =>
    set((state) => {
      if (!marketKey) return state;
      const existing = state.marketSnapshots[marketKey] || {};
      const updated =
        typeof snapshotOrUpdater === 'function'
          ? snapshotOrUpdater(existing)
          : snapshotOrUpdater;

      if (!updated) return state;

      return {
        marketSnapshots: {
          ...state.marketSnapshots,
          [marketKey]: {
            ...existing,
            ...updated,
            lastFetchedAt: updated.lastFetchedAt || Date.now(),
          },
        },
      };
    }),

  // Action: Set entire trade history array for a market
  setMarketTrades: (marketKey, tradesOrUpdater) =>
    set((state) => {
      if (!marketKey) return state;
      const existing = state.marketTrades[marketKey] || [];
      const updated =
        typeof tradesOrUpdater === 'function'
          ? tradesOrUpdater(existing)
          : tradesOrUpdater;

      return {
        marketTrades: {
          ...state.marketTrades,
          [marketKey]: Array.isArray(updated) ? updated : existing,
        },
      };
    }),

  // Action: Incrementally prepend a live execution trade with deduplication
  addMarketTrade: (marketKey, trade) =>
    set((state) => {
      if (!marketKey || !trade) return state;
      const existing = state.marketTrades[marketKey] || [];
      const tradeId = trade.id || trade.tradeId;

      if (tradeId && existing.some((t) => (t.id || t.tradeId) === tradeId)) {
        return state;
      }

      return {
        marketTrades: {
          ...state.marketTrades,
          [marketKey]: [trade, ...existing.slice(0, 99)],
        },
      };
    }),

  // Action: Set historical candle data and summary for a market chart
  setMarketCandles: (chartKey, candles, summary) =>
    set((state) => {
      if (!chartKey) return state;
      return {
        marketCandles: {
          ...state.marketCandles,
          [chartKey]: {
            candles: Array.isArray(candles)
              ? candles
              : state.marketCandles[chartKey]?.candles || [],
            summary:
              summary !== undefined
                ? summary
                : state.marketCandles[chartKey]?.summary || null,
            lastFetchedAt: Date.now(),
          },
        },
      };
    }),

  // Action: Incrementally update the latest chart candle with real-time price ticks
  updateMarketCandleTick: (chartKey, tick) =>
    set((state) => {
      if (
        !chartKey ||
        !tick ||
        !Number.isFinite(tick.time) ||
        !Number.isFinite(tick.value)
      ) {
        return state;
      }
      const existing = state.marketCandles[chartKey];
      if (!existing || !Array.isArray(existing.candles) || existing.candles.length === 0) {
        return state;
      }

      const candles = [...existing.candles];
      const last = { ...candles[candles.length - 1] };
      const tickTime = tick.time;

      if (tickTime > last.time) {
        candles.push({
          time: tickTime,
          open: tick.value,
          high: tick.value,
          low: tick.value,
          close: tick.value,
        });
      } else {
        last.high = Math.max(last.high, tick.value);
        last.low = Math.min(last.low, tick.value);
        last.close = tick.value;
        candles[candles.length - 1] = last;
      }

      return {
        marketCandles: {
          ...state.marketCandles,
          [chartKey]: {
            ...existing,
            candles,
            lastFetchedAt: Date.now(),
          },
        },
      };
    }),

  // Action: Set top market summary list
  setMarketSummaryData: (list) =>
    set({
      marketSummary: Array.isArray(list) ? list : [],
      marketSummaryFetchedAt: Date.now(),
    }),

  // Action: Explicitly clear market cache if requested
  clearMarketCache: (marketKey) =>
    set((state) => {
      if (marketKey) {
        const nextSnapshots = { ...state.marketSnapshots };
        const nextTrades = { ...state.marketTrades };
        delete nextSnapshots[marketKey];
        delete nextTrades[marketKey];
        return { marketSnapshots: nextSnapshots, marketTrades: nextTrades };
      }
      return {
        marketSnapshots: {},
        marketTrades: {},
        marketCandles: {},
      };
    }),
}));

export default useAppStore;
