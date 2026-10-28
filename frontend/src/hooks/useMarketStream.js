import { useState, useEffect, useRef, useCallback } from 'react';
import { marketStream, CONNECTION_STATUS } from '../services/marketStream.js';
import { api } from '../services/api.js';
import { formatTradeTime } from '../utils/formatters.js';
import { useAppStore } from '../store/useStore.js';

/**
 * Transforms raw price levels from backend (paise) into depth table rows.
 *
 * @param {Array<{ price: number, totalQuantity?: number, qty?: number, orderCount?: number }>} levels
 * @param {boolean} [isAsk=false]
 * @returns {Array<{ price: string, qty: number, total: string, depth: number, orderCount: number, rawPrice: number }>}
 */
export function transformDepthLevels(levels = [], isAsk = false) {
  if (!Array.isArray(levels)) return [];

  // Sort: bids descending (highest price first), asks ascending (lowest price first)
  const sorted = [...levels].sort((a, b) => {
    const pA = Number(a.price) || 0;
    const pB = Number(b.price) || 0;
    return isAsk ? pA - pB : pB - pA;
  });

  let cumulative = 0;
  return sorted.map((lvl) => {
    const rawPrice = Number(lvl.price) || 0;
    // Backend stores prices in minor units (paise). If rawPrice is integer paise (>= 100), convert to major units
    const majorPrice = rawPrice >= 100 ? rawPrice / 100 : rawPrice;
    const qty = lvl.totalQuantity != null ? lvl.totalQuantity : lvl.qty != null ? lvl.qty : 0;
    cumulative += qty;

    return {
      rawPrice,
      price: majorPrice.toFixed(2),
      qty,
      total: (majorPrice * qty).toFixed(2),
      orderCount: lvl.orderCount != null ? lvl.orderCount : 1,
      depth: cumulative,
    };
  });
}

/**
 * Custom React hook for subscribing to a secondary market's real-time feed with authoritative REST initialization.
 *
 * @param {string} eventId - UUID of the target event
 * @param {string} ticketCategoryId - UUID of the target ticket category
 * @returns {Object} Live market state, depth book, trades, and connection status
 */
export function useMarketStream(eventId, ticketCategoryId) {
  const currentKey = eventId && ticketCategoryId ? `${eventId}:${ticketCategoryId}` : null;
  const cachedSnapshot = currentKey ? useAppStore.getState().marketSnapshots[currentKey] : null;
  const cachedTrades = currentKey ? useAppStore.getState().marketTrades[currentKey] : [];

  const [connectionStatus, setConnectionStatus] = useState(marketStream.status);
  const [liveSnapshot, setLiveSnapshot] = useState(cachedSnapshot || null);
  const [liveTrades, setLiveTrades] = useState(cachedTrades || []);
  const [isResyncing, setIsResyncing] = useState(false);
  const [streamError, setStreamError] = useState(null);
  const [loadingInitial, setLoadingInitial] = useState(!cachedSnapshot);

  // Track active market to reject any stale cross-market callbacks
  const activeMarketRef = useRef(currentKey);

  // Authoritative fetch from backend REST endpoints
  const fetchAuthoritativeMarketData = useCallback(async (targetEventId, targetCategoryId, force = false) => {
    if (!targetEventId || !targetCategoryId) return;
    const marketKey = `${targetEventId}:${targetCategoryId}`;

    // Cache freshness: If snapshot was fetched within the last 30 seconds and not forced, skip redundant REST calls
    if (!force) {
      const cached = useAppStore.getState().marketSnapshots[marketKey];
      if (cached && cached.lastFetchedAt && Date.now() - cached.lastFetchedAt < 30000) {
        setLoadingInitial(false);
        return;
      }
    }

    try {
      const [depthRes, tradesRes, marketRes] = await Promise.allSettled([
        api.market.getMarketDepth(targetEventId, targetCategoryId),
        api.market.getRecentTrades(targetEventId, targetCategoryId),
        api.market.getMarketData(targetEventId, targetCategoryId),
      ]);

      if (activeMarketRef.current !== marketKey) return;

      let depthData = depthRes.status === 'fulfilled' ? depthRes.value?.data || depthRes.value : null;
      if (!depthData || (!depthData.bids && !depthData.asks)) {
        try {
          const eventObRes = await api.orders.getEventOrderbook(targetEventId, targetCategoryId);
          depthData = eventObRes?.data || eventObRes;
        } catch {
          // Non-blocking
        }
      }
      let tradesData = tradesRes.status === 'fulfilled' ? tradesRes.value?.data?.trades || tradesRes.value?.trades || [] : [];
      if (!Array.isArray(tradesData) || tradesData.length === 0) {
        try {
          const eventTradesRes = await api.trades.getEventTrades(targetEventId, { categoryId: targetCategoryId, limit: 20 });
          tradesData = eventTradesRes?.data?.trades || eventTradesRes?.trades || [];
        } catch {
          // Non-blocking
        }
      }
      const summaryData = marketRes.status === 'fulfilled' ? marketRes.value?.data || marketRes.value : null;

      if (depthData) {
        setLiveSnapshot((prev) => {
          let safeBids = depthData.bids || [];
          let safeAsks = depthData.asks || [];
          let safeSeq = depthData.sequenceNumber || '0';

          // Prevent stale REST response from overwriting newer WebSocket state
          if (prev?.sequenceNumber && depthData.sequenceNumber) {
            try {
              if (BigInt(prev.sequenceNumber) >= BigInt(depthData.sequenceNumber)) {
                safeBids = prev.bids || safeBids;
                safeAsks = prev.asks || safeAsks;
                safeSeq = prev.sequenceNumber;
              }
            } catch {
              // fallback
            }
          }

          const merged = {
            ...depthData,
            bids: safeBids,
            asks: safeAsks,
            sequenceNumber: safeSeq,
            bestBid: summaryData?.bestBid != null ? summaryData.bestBid : (prev?.bestBid ?? depthData.bestBid),
            bestAsk: summaryData?.bestAsk != null ? summaryData.bestAsk : (prev?.bestAsk ?? depthData.bestAsk),
            lastPrice: summaryData?.lastPrice != null ? summaryData.lastPrice : (prev?.lastPrice ?? depthData.lastPrice),
            spread: summaryData?.spread != null ? summaryData.spread : (prev?.spread ?? depthData.spread),
            volume: summaryData?.volume || prev?.volume || depthData.volume || 0,
            lastFetchedAt: Date.now(),
          };

          // Store in shared Zustand store
          useAppStore.getState().setMarketSnapshot(marketKey, merged);
          return merged;
        });
      }

      if (Array.isArray(tradesData) && tradesData.length > 0) {
        const formatted = tradesData.map((t) => ({
          id: t.id || t.tradeId,
          price: (Number(t.price) >= 100 ? Number(t.price) / 100 : Number(t.price)).toFixed(2),
          qty: t.quantity,
          time: formatTradeTime(t.executedAt),
          side: t.side?.toLowerCase() === 'ask' ? 'sell' : 'buy',
          sequenceNumber: t.sequenceNumber || '0',
        }));
        setLiveTrades((prev) => {
          const result = prev.length > 0 ? prev : formatted;
          useAppStore.getState().setMarketTrades(marketKey, result);
          return result;
        });
      }
    } catch (err) {
      console.warn('Initial REST market depth fetch failed:', err);
    } finally {
      setLoadingInitial(false);
    }
  }, []);

  useEffect(() => {
    const targetEventId = eventId;
    const targetCategoryId = ticketCategoryId;
    const marketKey = `${targetEventId}:${targetCategoryId}`;
    activeMarketRef.current = marketKey;

    // 1. Connection status listener
    const unsubStatus = marketStream.onStatusChange((status) => {
      setConnectionStatus(status);
    });

    // Check store for existing snapshot/trades
    const cachedSnap = targetEventId && targetCategoryId ? useAppStore.getState().marketSnapshots[marketKey] : null;
    const cachedTr = targetEventId && targetCategoryId ? useAppStore.getState().marketTrades[marketKey] : [];

    if (cachedSnap) {
      setLiveSnapshot(cachedSnap);
      setLiveTrades(cachedTr || []);
      setLoadingInitial(false);
    } else {
      setLiveSnapshot(null);
      setLiveTrades([]);
      setLoadingInitial(true);
    }

    setIsResyncing(false);
    setStreamError(null);

    // Fetch REST authoritative state (will skip redundant request if cached within 30s)
    fetchAuthoritativeMarketData(targetEventId, targetCategoryId, false);

    // 2. Subscribe to WebSocket real-time updates
    const unsubscribe = marketStream.subscribeMarket({
      eventId: targetEventId,
      ticketCategoryId: targetCategoryId,
      onSnapshot: (snapshot) => {
        if (activeMarketRef.current !== marketKey) return;
        setStreamError(null);
        setIsResyncing(false);
        setLiveSnapshot((prev) => {
          const next = {
            ...prev,
            ...snapshot,
            bids: snapshot.bids || [],
            asks: snapshot.asks || [],
            lastFetchedAt: Date.now(),
          };
          useAppStore.getState().setMarketSnapshot(marketKey, next);
          return next;
        });
      },
      onOrderBook: (update) => {
        if (activeMarketRef.current !== marketKey) return;
        setLiveSnapshot((prev) => {
          const base = prev || {};
          const next = {
            ...base,
            sequenceNumber: update.sequenceNumber || base.sequenceNumber || '0',
            bids: update.bids !== undefined ? update.bids : base.bids || [],
            asks: update.asks !== undefined ? update.asks : base.asks || [],
            bestBid: update.bestBid !== undefined ? update.bestBid : base.bestBid,
            bestAsk: update.bestAsk !== undefined ? update.bestAsk : base.bestAsk,
            lastPrice: update.lastPrice !== undefined ? update.lastPrice : base.lastPrice,
            spread: update.spread !== undefined ? update.spread : base.spread,
            timestamp: update.timestamp || new Date().toISOString(),
            lastFetchedAt: Date.now(),
          };
          useAppStore.getState().setMarketSnapshot(marketKey, next);
          return next;
        });
      },
      onTrade: (trade) => {
        if (activeMarketRef.current !== marketKey) return;
        const majorPrice =
          trade.price != null
            ? (Number(trade.price) >= 100 ? Number(trade.price) / 100 : Number(trade.price)).toFixed(2)
            : '0.00';

        const formattedTrade = {
          id: trade.tradeId,
          price: majorPrice,
          qty: trade.quantity,
          time: formatTradeTime(trade.executedAt),
          side: trade.side?.toLowerCase() === 'ask' ? 'sell' : 'buy',
          sequenceNumber: trade.sequenceNumber,
        };

        setLiveTrades((prev) => {
          const next = [formattedTrade, ...prev.filter((t) => t.id !== formattedTrade.id).slice(0, 99)];
          useAppStore.getState().setMarketTrades(marketKey, next);
          return next;
        });

        // Update lastPrice on liveSnapshot
        setLiveSnapshot((prev) => {
          if (!prev) return prev;
          const next = {
            ...prev,
            lastPrice: trade.price != null ? trade.price : prev.lastPrice,
          };
          useAppStore.getState().setMarketSnapshot(marketKey, next);
          return next;
        });
      },
      onError: (err) => {
        if (activeMarketRef.current !== marketKey) return;
        setStreamError(err.friendlyMessage || err.message || 'Market stream error');
        setIsResyncing(false);
      },
      onResyncing: (resyncing) => {
        if (activeMarketRef.current !== marketKey) return;
        setIsResyncing(Boolean(resyncing));
      },
    });

    return () => {
      unsubscribe();
      unsubStatus();
    };
  }, [eventId, ticketCategoryId, fetchAuthoritativeMarketData]);

  // Compute aggregated order book from authoritative snapshot
  const bids = transformDepthLevels(liveSnapshot?.bids || [], false);
  const rawAsks = transformDepthLevels(liveSnapshot?.asks || [], true);

  // For order-book visual display: highest ask at top down to lowest ask near spread
  const asksDisplay = [...rawAsks].reverse();

  const bestBid =
    bids[0]?.price ||
    (liveSnapshot?.bestBid != null
      ? (Number(liveSnapshot.bestBid) >= 100
          ? Number(liveSnapshot.bestBid) / 100
          : Number(liveSnapshot.bestBid)
        ).toFixed(2)
      : null);

  const bestAsk =
    rawAsks[0]?.price ||
    (liveSnapshot?.bestAsk != null
      ? (Number(liveSnapshot.bestAsk) >= 100
          ? Number(liveSnapshot.bestAsk) / 100
          : Number(liveSnapshot.bestAsk)
        ).toFixed(2)
      : null);

  const spread =
    bestBid && bestAsk
      ? Math.max(0, Number(bestAsk) - Number(bestBid)).toFixed(2)
      : liveSnapshot?.spread != null
      ? (Number(liveSnapshot.spread) >= 100
          ? Number(liveSnapshot.spread) / 100
          : Number(liveSnapshot.spread)
        ).toFixed(2)
      : null;

  const lastPrice =
    liveSnapshot?.lastPrice != null
      ? (Number(liveSnapshot.lastPrice) >= 100
          ? Number(liveSnapshot.lastPrice) / 100
          : Number(liveSnapshot.lastPrice)
        ).toFixed(2)
      : liveTrades[0]?.price || null;

  return {
    connectionStatus,
    isConnected: connectionStatus === CONNECTION_STATUS.CONNECTED,
    isReconnecting: connectionStatus === CONNECTION_STATUS.RECONNECTING,
    isDisconnected: connectionStatus === CONNECTION_STATUS.DISCONNECTED,
    isResyncing,
    streamError,
    loadingInitial,
    hasLiveSnapshot: Boolean(liveSnapshot),
    sequenceNumber: liveSnapshot?.sequenceNumber || '0',
    volume: liveSnapshot?.volume || 0,
    book: {
      bids,
      asks: asksDisplay,
      spread: spread || '--',
      bestBid,
      bestAsk,
      lastPrice,
      trades: liveTrades,
    },
    refetch: () => fetchAuthoritativeMarketData(eventId, ticketCategoryId, true),
  };
}

export default useMarketStream;
