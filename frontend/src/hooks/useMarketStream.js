import { useState, useEffect, useRef } from 'react';
import { marketStream, CONNECTION_STATUS } from '../services/marketStream.js';
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
 * Custom React hook for subscribing to a secondary market's real-time feed.
 *
 * @param {string} eventId
 * @param {string} ticketCategoryId
 * @param {Object} [fallbackData]
 * @returns {Object} Live market state, depth book, trades, and connection status
 */
export function useMarketStream(eventId, ticketCategoryId, fallbackData = null) {
  const [connectionStatus, setConnectionStatus] = useState(marketStream.status);
  const [liveSnapshot, setLiveSnapshot] = useState(null);
  const [liveTrades, setLiveTrades] = useState([]);
  const [isResyncing, setIsResyncing] = useState(false);
  const [streamError, setStreamError] = useState(null);

  // Track active market to reject any stale cross-market callbacks
  const activeMarketRef = useRef(`${eventId}:${ticketCategoryId}`);

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

    const targetEventId = eventId;
    const targetCategoryId = ticketCategoryId;
    const currentKey = `${targetEventId}:${targetCategoryId}`;

    // 2. Subscribe to market
    const unsubscribe = marketStream.subscribeMarket({
      eventId: targetEventId,
      ticketCategoryId: targetCategoryId,
      onSnapshot: (snapshot) => {
        if (activeMarketRef.current !== currentKey) return;
        setStreamError(null);
        setIsResyncing(false);
        setLiveSnapshot(snapshot);
      },
      onOrderBook: (update) => {
        if (activeMarketRef.current !== currentKey) return;
        setLiveSnapshot((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            sequenceNumber: update.sequenceNumber || prev.sequenceNumber,
            bids: update.bids || prev.bids,
            asks: update.asks || prev.asks,
            timestamp: update.timestamp || new Date().toISOString(),
          };
        });
      },
      onTrade: (trade) => {
        if (activeMarketRef.current !== currentKey) return;
        const majorPrice =
          trade.price != null
            ? (Number(trade.price) >= 100 ? Number(trade.price) / 100 : Number(trade.price)).toFixed(
                2
              )
            : '0.00';

        const formattedTrade = {
          id: trade.tradeId,
          price: majorPrice,
          qty: trade.quantity,
          time: formatTradeTime(trade.executedAt),
          side: 'buy', // Public feed trade
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
  }, [eventId, ticketCategoryId]);

  // Compute aggregated order book: use live snapshot if available, otherwise fallback
  const hasLive = Boolean(liveSnapshot);

  const bids = hasLive
    ? transformDepthLevels(liveSnapshot.bids || [], false)
    : fallbackData?.bids || [];

  const rawAsks = hasLive
    ? transformDepthLevels(liveSnapshot.asks || [], true)
    : fallbackData?.asks || [];

  // For order-book visual display: highest ask at top down to lowest ask near spread
  const asksDisplay = hasLive ? [...rawAsks].reverse() : rawAsks;

  const bestBid = hasLive
    ? bids[0]?.price ||
      (liveSnapshot.bestBid != null
        ? (Number(liveSnapshot.bestBid) / 100).toFixed(2)
        : null)
    : fallbackData?.bids?.[0]?.price || null;

  const bestAsk = hasLive
    ? rawAsks[0]?.price ||
      (liveSnapshot.bestAsk != null
        ? (Number(liveSnapshot.bestAsk) / 100).toFixed(2)
        : null)
    : fallbackData?.asks?.[fallbackData.asks.length - 1]?.price || null;

  const spread = hasLive
    ? liveSnapshot.spread != null
      ? (Number(liveSnapshot.spread) / 100).toFixed(2)
      : bestBid && bestAsk
      ? Math.max(0, Number(bestAsk) - Number(bestBid)).toFixed(2)
      : '0.00'
    : fallbackData?.spread || '0.00';

  const lastPrice = hasLive
    ? liveSnapshot.lastPrice != null
      ? (Number(liveSnapshot.lastPrice) >= 100
          ? Number(liveSnapshot.lastPrice) / 100
          : Number(liveSnapshot.lastPrice)
        ).toFixed(2)
      : fallbackData?.trades?.[0]?.price || '0.00'
    : fallbackData?.trades?.[0]?.price || '0.00';

  const trades = liveTrades.length > 0 ? liveTrades : fallbackData?.trades || [];

  return {
    connectionStatus,
    isConnected: connectionStatus === CONNECTION_STATUS.CONNECTED,
    isReconnecting: connectionStatus === CONNECTION_STATUS.RECONNECTING,
    isDisconnected: connectionStatus === CONNECTION_STATUS.DISCONNECTED,
    isResyncing,
    streamError,
    hasLiveSnapshot: hasLive,
    sequenceNumber: liveSnapshot?.sequenceNumber || '0',
    book: {
      bids,
      asks: asksDisplay,
      spread,
      bestBid,
      bestAsk,
      lastPrice,
      trades,
    },
  };
}

export default useMarketStream;
