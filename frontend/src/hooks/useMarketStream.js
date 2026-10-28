import { useState, useEffect, useRef, useCallback } from 'react';
import { marketStream, CONNECTION_STATUS } from '../services/marketStream.js';
import { api } from '../services/api.js';
import { formatTradeTime } from '../utils/formatters.js';

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
  const [connectionStatus, setConnectionStatus] = useState(marketStream.status);
  const [liveSnapshot, setLiveSnapshot] = useState(null);
  const [liveTrades, setLiveTrades] = useState([]);
  const [isResyncing, setIsResyncing] = useState(false);
  const [streamError, setStreamError] = useState(null);
  const [loadingInitial, setLoadingInitial] = useState(true);

  // Track active market to reject any stale cross-market callbacks
  const activeMarketRef = useRef(`${eventId}:${ticketCategoryId}`);

  // Authoritative fetch from backend REST endpoints
  const fetchAuthoritativeMarketData = useCallback(async (targetEventId, targetCategoryId) => {
    if (!targetEventId || !targetCategoryId) return;

    try {
      const [depthRes, tradesRes, marketRes] = await Promise.allSettled([
        api.market.getMarketDepth(targetEventId, targetCategoryId),
        api.market.getRecentTrades(targetEventId, targetCategoryId),
        api.market.getMarketData(targetEventId, targetCategoryId),
      ]);

      const currentKey = `${targetEventId}:${targetCategoryId}`;
      if (activeMarketRef.current !== currentKey) return;

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
        setLiveSnapshot((prev) => ({
          ...depthData,
          bids: depthData.bids || [],
          asks: depthData.asks || [],
          bestBid: summaryData?.bestBid != null ? summaryData.bestBid : depthData.bestBid,
          bestAsk: summaryData?.bestAsk != null ? summaryData.bestAsk : depthData.bestAsk,
          lastPrice: summaryData?.lastPrice != null ? summaryData.lastPrice : depthData.lastPrice,
          spread: summaryData?.spread != null ? summaryData.spread : depthData.spread,
          volume: summaryData?.volume || 0,
          ...prev, // WebSocket live updates take precedence over initial snapshot
        }));
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
        setLiveTrades((prev) => (prev.length > 0 ? prev : formatted));
      }
    } catch (err) {
      console.warn('Initial REST market depth fetch failed:', err);
    } finally {
      setLoadingInitial(false);
    }
  }, []);

  useEffect(() => {
    activeMarketRef.current = `${eventId}:${ticketCategoryId}`;

    // 1. Connection status listener
    const unsubStatus = marketStream.onStatusChange((status) => {
      setConnectionStatus(status);
    });

    // Reset market state on parameter change
    setLiveSnapshot(null);
    setLiveTrades([]);
    setIsResyncing(false);
    setStreamError(null);
    setLoadingInitial(true);

    const targetEventId = eventId;
    const targetCategoryId = ticketCategoryId;
    const currentKey = `${targetEventId}:${targetCategoryId}`;

    // Fetch REST authoritative state first
    fetchAuthoritativeMarketData(targetEventId, targetCategoryId);

    // 2. Subscribe to WebSocket real-time updates
    const unsubscribe = marketStream.subscribeMarket({
      eventId: targetEventId,
      ticketCategoryId: targetCategoryId,
      onSnapshot: (snapshot) => {
        if (activeMarketRef.current !== currentKey) return;
        setStreamError(null);
        setIsResyncing(false);
        setLiveSnapshot((prev) => ({
          ...prev,
          ...snapshot,
          bids: snapshot.bids || [],
          asks: snapshot.asks || [],
        }));
      },
      onOrderBook: (update) => {
        if (activeMarketRef.current !== currentKey) return;
        setLiveSnapshot((prev) => {
          const base = prev || {};
          return {
            ...base,
            sequenceNumber: update.sequenceNumber || base.sequenceNumber || '0',
            bids: update.bids !== undefined ? update.bids : base.bids || [],
            asks: update.asks !== undefined ? update.asks : base.asks || [],
            bestBid: update.bestBid !== undefined ? update.bestBid : base.bestBid,
            bestAsk: update.bestAsk !== undefined ? update.bestAsk : base.bestAsk,
            lastPrice: update.lastPrice !== undefined ? update.lastPrice : base.lastPrice,
            spread: update.spread !== undefined ? update.spread : base.spread,
            timestamp: update.timestamp || new Date().toISOString(),
          };
        });
      },
      onTrade: (trade) => {
        if (activeMarketRef.current !== currentKey) return;
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

        setLiveTrades((prev) => [formattedTrade, ...prev.slice(0, 99)]);

        // Update lastPrice on liveSnapshot
        setLiveSnapshot((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            lastPrice: trade.price != null ? trade.price : prev.lastPrice,
          };
        });
      },
      onError: (err) => {
        if (activeMarketRef.current !== currentKey) return;
        setStreamError(err.friendlyMessage || err.message || 'Market stream error');
        setIsResyncing(false);
      },
      onResyncing: (resyncing) => {
        if (activeMarketRef.current !== currentKey) return;
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
    refetch: () => fetchAuthoritativeMarketData(eventId, ticketCategoryId),
  };
}

export default useMarketStream;
