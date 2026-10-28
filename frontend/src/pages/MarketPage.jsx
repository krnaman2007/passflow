import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import { api } from '../services/api';
import { formatBackendEvent } from '../utils/eventAdapter';
import { useMarketStream } from '../hooks/useMarketStream.js';
import { useAppStore } from '../store/useStore.js';
import {
  TrendingUp,
  Lock,
  RefreshCw,
  AlertCircle,
  Activity,
  Layers,
  ChevronDown,
  ArrowRight,
  ShieldAlert,
} from 'lucide-react';
import TradingChart from '../components/TradingChart';
import { MarketDepthSkeleton } from '../components/Skeleton';

export default function MarketPage() {
  const {
    events,
    setEvents: updateContextEvents,
    userOrders,
    userTickets,
    routeParams,
    navigate,
    currentRole,
    wallet,
    placeOrder,
    cancelOrder,
    showToast,
  } = useApp();

  const [loadingEvents, setLoadingEvents] = useState(false);
  const [selectedEventData, setSelectedEventData] = useState(null);

  // Determine current active event
  const currentEvent = useMemo(() => {
    if (selectedEventData) return selectedEventData;

    if (Array.isArray(events) && events.length > 0) {
      if (routeParams.id) {
        const found = events.find((e) => e.id === routeParams.id);
        if (found) return found;
      }
      // If no routeParam.id, restore previously selected market from store
      const saved = useAppStore.getState().selectedMarket;
      if (saved?.eventId) {
        const foundSaved = events.find((e) => e.id === saved.eventId);
        if (foundSaved) return foundSaved;
      }
      return events[0];
    }
    return null;
  }, [events, routeParams.id, selectedEventData]);





  // If events list is empty in context on direct load, query backend events
  useEffect(() => {
    let isMounted = true;
    async function loadEventsIfNeeded() {
      if ((!events || events.length === 0) && !selectedEventData) {
        setLoadingEvents(true);
        try {
          const res = await api.events.listEvents();
          const rawList =
            res?.data?.events ||
            res?.events ||
            (Array.isArray(res?.data) ? res.data : []) ||
            (Array.isArray(res) ? res : []);

          if (Array.isArray(rawList) && rawList.length > 0 && isMounted) {
            const formatted = rawList.map((ev, idx) => formatBackendEvent(ev, idx));
            if (typeof updateContextEvents === 'function') {
              updateContextEvents(formatted);
            }
            const match = routeParams.id
              ? formatted.find((e) => e.id === routeParams.id) || formatted[0]
              : formatted[0];
            setSelectedEventData(match);
          }
        } catch (err) {
          console.error('Failed to load events for market page:', err);
        } finally {
          if (isMounted) setLoadingEvents(false);
        }
      }
    }

    loadEventsIfNeeded();
    return () => {
      isMounted = false;
    };
  }, [events, routeParams.id, selectedEventData, updateContextEvents]);

  // If routeParams.id changed and event is not in context, fetch event directly
  useEffect(() => {
    let isMounted = true;
    if (
      routeParams.id &&
      (!currentEvent || currentEvent.id !== routeParams.id)
    ) {
      api.events
        .getEventById(routeParams.id)
        .then((res) => {
          const raw = res?.data?.event || res?.event || res?.data || res;
          if (raw && raw.id && isMounted) {
            setSelectedEventData(formatBackendEvent(raw, 0));
          }
        })
        .catch((err) => {
          console.warn('Could not fetch event for market by ID:', err.message);
        });
    }
    return () => {
      isMounted = false;
    };
  }, [routeParams.id, currentEvent]);

  const activeEventId = currentEvent?.id || null;
  const tiers = Array.isArray(currentEvent?.tiers) ? currentEvent.tiers : [];

  // Market Summary: Real-Time Top Events by Volume & Price Movement (GET /market/summary)
  const initialSummary = useAppStore.getState().marketSummary || [];
  const [marketSummary, setMarketSummary] = useState(initialSummary);

  useEffect(() => {
    let isMounted = true;
    async function loadSummary() {
      // Check cache freshness (< 30 seconds)
      const fetchedAt = useAppStore.getState().marketSummaryFetchedAt;
      const cached = useAppStore.getState().marketSummary;
      if (cached && cached.length > 0 && fetchedAt && Date.now() - fetchedAt < 30000) {
        if (isMounted) setMarketSummary(cached);
        return;
      }

      try {
        const res = await api.market.getMarketSummary({ limit: 6, sortBy: 'volume' });
        const list = res?.data?.summary || res?.summary || [];
        if (isMounted && Array.isArray(list)) {
          setMarketSummary(list);
          useAppStore.getState().setMarketSummaryData(list);
        }
      } catch (err) {
        console.warn('Market summary fetch deferred:', err.message);
      }
    }
    loadSummary();
    const interval = setInterval(loadSummary, 12000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  // Determine active category
  const activeCategoryId = useMemo(() => {
    if (!tiers || tiers.length === 0) return null;
    if (routeParams.categoryId) {
      const match = tiers.find(
        (t) => t.id.toLowerCase() === routeParams.categoryId.toLowerCase()
      );
      if (match) return match.id;
    }
    const saved = useAppStore.getState().selectedMarket;
    if (saved?.categoryId && (!saved.eventId || saved.eventId === activeEventId)) {
      const matchSaved = tiers.find(
        (t) => t.id.toLowerCase() === saved.categoryId.toLowerCase()
      );
      if (matchSaved) return matchSaved.id;
    }
    return tiers[0].id;
  }, [tiers, routeParams.categoryId, activeEventId]);

  // Keep selected market in shared store for navigation persistence
  useEffect(() => {
    if (activeEventId && activeCategoryId) {
      useAppStore.getState().setSelectedMarket({
        eventId: activeEventId,
        categoryId: activeCategoryId,
      });
    }
  }, [activeEventId, activeCategoryId]);

  const currentTier = useMemo(() => {
    if (!tiers || tiers.length === 0) {
      return { id: 'default', name: 'General', price: 0, cap: 0, resalePriceCap: 0 };
    }
    return tiers.find((t) => t.id === activeCategoryId) || tiers[0];
  }, [tiers, activeCategoryId]);

  // Keep browser address bar synchronized with the active real event and tier
  useEffect(() => {
    if (activeEventId && activeCategoryId) {
      const isMissingParams = !routeParams.id || !routeParams.categoryId;
      const isMismatch = routeParams.id !== activeEventId || routeParams.categoryId !== activeCategoryId;

      if (isMissingParams || isMismatch) {
        navigate(`/market/${activeEventId}/${activeCategoryId}`, {
          id: activeEventId,
          categoryId: activeCategoryId,
        });
      }
    }
  }, [activeEventId, activeCategoryId, routeParams.id, routeParams.categoryId, navigate]);

  // Hook up real-time secondary market stream
  const {
    connectionStatus,
    isReconnecting,
    isDisconnected,
    isResyncing,
    streamError,
    hasLiveSnapshot,
    sequenceNumber,
    volume,
    book,
    refetch: refetchMarket,
  } = useMarketStream(activeEventId, activeCategoryId);

  // Order Form State
  const [side, setSide] = useState('BUY'); // 'BUY' | 'SELL'
  const [orderType, setOrderType] = useState('LIMIT'); // 'LIMIT' | 'MARKET'
  const [price, setPrice] = useState('');
  const [qty, setQty] = useState(1);
  const [bottomTab, setBottomTab] = useState('OPEN_ORDERS'); // 'OPEN_ORDERS' | 'TRADE_FEED'
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Update initial price suggestion when tier or book changes
  useEffect(() => {
    if (book.bestAsk) {
      setPrice(book.bestAsk);
    } else if (book.lastPrice) {
      setPrice(book.lastPrice);
    } else if (currentTier?.price) {
      setPrice(currentTier.price.toFixed(2));
    }
  }, [book.bestAsk, book.lastPrice, currentTier?.price, activeCategoryId]);

  const resaleCap = currentTier?.resalePriceCap || currentTier?.cap || (currentTier?.price ? currentTier.price * 1.1 : 0);

  // Best market match calculation
  const bestAskPrice = book.bestAsk || book.asks[book.asks.length - 1]?.price || (currentTier?.price ? currentTier.price.toFixed(2) : '0.00');
  const bestBidPrice = book.bestBid || book.bids[0]?.price || (currentTier?.price ? (currentTier.price * 0.95).toFixed(2) : '0.00');

  const numPrice =
    orderType === 'MARKET'
      ? side === 'BUY'
        ? parseFloat(bestAskPrice)
        : parseFloat(bestBidPrice)
      : parseFloat(price || 0);

  const totalCost = numPrice * qty;

  // Handle clicking row to autofill price
  const handlePriceClick = (clickedPrice) => {
    setPrice(clickedPrice);
    if (orderType === 'MARKET') setOrderType('LIMIT');
    showToast(`Filled ₹${clickedPrice} into order ticket`, 'info');
  };

  // Submit Order via existing HTTP / App action
  const handleSubmitOrder = async (e) => {
    e.preventDefault();
    if (currentRole === 'PUBLIC') {
      navigate('/login');
      return;
    }

    if (qty <= 0) {
      showToast('Quantity must be at least 1', 'warning');
      return;
    }

    if (!numPrice || numPrice <= 0) {
      showToast('Please enter a valid price', 'warning');
      return;
    }

    if (resaleCap > 0 && numPrice > resaleCap) {
      showToast(`Rejected: Price ₹${numPrice} exceeds anti-scalping cap (₹${resaleCap.toFixed(2)})`, 'error');
      return;
    }

    setIsSubmitting(true);
    try {
      await placeOrder({
        side,
        type: orderType,
        price: numPrice,
        qty,
        eventId: activeEventId,
        categoryId: activeCategoryId,
        tier: currentTier?.name || 'General',
      });

      refetchMarket();
    } catch (err) {
      console.warn('Market order placement failed:', err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Switch event
  const handleSelectEvent = (newEvId) => {
    const target = Array.isArray(events) ? events.find((e) => e.id === newEvId) : null;
    if (target) {
      setSelectedEventData(target);
      const defaultCat = target.tiers?.[0]?.id || 'general';
      navigate(`/market/${target.id}/${defaultCat}`, { id: target.id, categoryId: defaultCat });
    }
  };

  // Loading State
  if (loadingEvents && !currentEvent) {
    return <MarketDepthSkeleton />;
  }

  // No Events State
  if (!currentEvent) {
    return (
      <div className="content-wrap" style={{ padding: '60px 20px', textAlign: 'center' }}>
        <AlertCircle size={36} color="var(--accent-orange)" style={{ margin: '0 auto 12px' }} />
        <h2 style={{ fontSize: 20, marginBottom: 8 }}>No Live Markets Available</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: 14, maxWidth: 460, margin: '0 auto 20px' }}>No live markets available. Browse events to explore.</p>
        <button className="btn-primary" onClick={() => navigate('/events')}>
          Browse Events
        </button>
      </div>
    );
  }

  return (
    <div className="content-wrap">
      {/* Real-Time Market Summary Ticker (GET /market/summary) */}
      {marketSummary.length > 0 && (
        <div
          style={{
            marginBottom: 16,
            padding: '8px 14px',
            borderRadius: 'var(--radius-md, 8px)',
            background: 'rgba(15, 23, 42, 0.65)',
            border: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            overflowX: 'auto',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            <Activity size={14} color="var(--accent-orange)" />
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-dim)', letterSpacing: '0.05em' }}>
              MARKET SUMMARY
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'nowrap' }}>
            {marketSummary.map((item) => {
              const isPositive = (item.priceChangePercent || 0) >= 0;
              return (
                <div
                  key={item.eventId}
                  onClick={() => handleSelectEvent(item.eventId)}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '3px 10px',
                    borderRadius: 'var(--radius-sm, 6px)',
                    background: item.eventId === activeEventId ? 'rgba(99, 102, 241, 0.18)' : 'rgba(255, 255, 255, 0.04)',
                    border: item.eventId === activeEventId ? '1px solid var(--brand-primary, #6366f1)' : '1px solid rgba(255, 255, 255, 0.08)',
                    fontSize: 12,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                  title="Click to view market"
                >
                  <strong style={{ color: 'var(--text-main)', fontSize: 12 }}>{item.eventName}</strong>
                  <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>Vol: {item.volume}</span>
                  <span
                    style={{
                      color: isPositive ? 'var(--accent-emerald)' : 'var(--accent-rose)',
                      fontSize: 11,
                      fontWeight: 600,
                    }}
                  >
                    {isPositive ? '+' : ''}{item.priceChangePercent}%
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Top Header: Title, Event Switcher, Category Tabs & Live Status */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: 16,
          flexWrap: 'wrap',
          gap: 16,
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h1 style={{ fontSize: 24, margin: 0 }}>{currentEvent.title}</h1>

            <span
              className={`badge ${
                connectionStatus === 'CONNECTED'
                  ? 'badge-green'
                  : isReconnecting
                  ? 'badge-orange'
                  : isDisconnected
                  ? 'badge-red'
                  : 'badge-blue'
              }`}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background:
                    connectionStatus === 'CONNECTED'
                      ? '#10b981'
                      : isReconnecting
                      ? '#f59e0b'
                      : isDisconnected
                      ? '#ef4444'
                      : '#3b82f6',
                  display: 'inline-block',
                }}
              />
              {connectionStatus === 'CONNECTED'
                ? '● Live Stream'
                : isReconnecting
                ? '● Reconnecting...'
                : isDisconnected
                ? '● Stream Offline'
                : '● Connecting...'}
            </span>

            {isResyncing && (
              <span className="badge badge-orange" style={{ fontSize: 11 }}>
                Resyncing...
              </span>
            )}

            {hasLiveSnapshot && sequenceNumber && sequenceNumber !== '0' && (
              <span
                style={{
                  fontSize: 11,
                  color: 'var(--text-dim)',
                  fontFamily: 'monospace',
                  background: 'var(--bg-card)',
                  padding: '2px 6px',
                  borderRadius: 4,
                  border: '1px solid var(--border-subtle)',
                }}
              >
                Seq #{sequenceNumber}
              </span>
            )}
          </div>




        </div>

        {/* Right Header Actions: Event Selector & Refresh */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Event Dropdown Switcher if multiple events exist */}
          {Array.isArray(events) && events.length > 0 && (
            <div className="market-event-selector-wrap">
              <select
                className="market-event-select"
                value={activeEventId}
                onChange={(e) => handleSelectEvent(e.target.value)}
                aria-label="Select Event Market"
              >
                {events.map((ev) => (
                  <option key={ev.id} value={ev.id}>
                    {ev.title}
                  </option>
                ))}
              </select>
              <ChevronDown
                size={14}
                className="market-event-chevron"
              />
            </div>
          )}

          <button
            className="btn-secondary"
            onClick={() => refetchMarket()}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '6px 12px' }}
            title="Refresh order book"
          >
            <RefreshCw size={13} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Category Tabs: General / VIP / Dynamic Categories */}
      {tiers.length > 0 && (
        <div
          style={{
            display: 'flex',
            gap: 6,
            background: 'var(--bg-surface)',
            padding: 4,
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--border-subtle)',
            marginBottom: 16,
            overflowX: 'auto',
          }}
        >
          {tiers.map((t) => (
            <button
              key={t.id}
              className={`nav-item ${activeCategoryId === t.id ? 'active' : ''}`}
              style={{ padding: '6px 14px', fontSize: 12, whiteSpace: 'nowrap' }}
              onClick={() =>
                navigate(`/market/${activeEventId}/${t.id}`, { id: activeEventId, categoryId: t.id })
              }
            >
              {t.name}
            </button>
          ))}
        </div>
      )}

      {/* Stream Error Banner */}
      {streamError && (
        <div
          style={{
            background: 'rgba(239, 68, 68, 0.15)',
            border: '1px solid #ef4444',
            borderRadius: 'var(--radius-sm)',
            padding: '10px 14px',
            marginBottom: 16,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: 13,
            color: '#fca5a5',
          }}
        >
          <span>⚠ {streamError}</span>
          <button
            type="button"
            className="btn-secondary"
            style={{ fontSize: 11, padding: '4px 8px' }}
            onClick={() => refetchMarket()}
          >
            Retry
          </button>
        </div>
      )}

      {/* Ticker Bar */}
      <div className="market-ticker-bar">
        <div className="ticker-tile">
          <span className="label">Best Bid</span>
          <span className="val font-mono" style={{ color: 'var(--accent-emerald)' }}>
            {book.bestBid ? `₹${book.bestBid}` : 'None'}
          </span>
        </div>
        <div className="ticker-tile">
          <span className="label">Best Ask</span>
          <span className="val font-mono" style={{ color: 'var(--accent-rose)' }}>
            {book.bestAsk ? `₹${book.bestAsk}` : 'None'}
          </span>
        </div>
        <div className="ticker-tile">
          <span className="label">Last Traded</span>
          <span className="val font-mono" style={{ color: 'var(--text-main)' }}>
            {book.lastPrice ? `₹${book.lastPrice}` : (currentTier?.price ? `₹${currentTier.price.toFixed(2)}` : 'None')}
          </span>
        </div>
        <div className="ticker-tile">
          <span className="label">Traded Volume</span>
          <span className="val font-mono" style={{ color: 'var(--accent-orange)' }}>
            {volume || 0} tickets
          </span>
        </div>
        <div className="ticker-tile">
          <span className="label">Anti-Scalp Cap</span>
          <span className="val font-mono" style={{ color: 'var(--text-sub)' }}>
            {resaleCap > 0 ? `Max ₹${resaleCap.toFixed(2)}` : 'No Cap'}
          </span>
        </div>
      </div>

      {/* Connection status badge */}
      <div style={{ marginBottom: 8, fontSize: 12, color: connectionStatus === 'RECONNECTING' ? 'var(--accent-rose)' : 'var(--text-sub)' }}>
        Connection: {connectionStatus}
      </div>
      {/* Real-Time Price Action Chart */}
      <TradingChart
        eventId={activeEventId}
        categoryId={activeCategoryId}
        eventName={currentEvent?.title || currentEvent?.name}
        tierName={currentTier?.name}
        basePrice={currentTier?.price}
        bestBid={book.bestBid}
        bestAsk={book.bestAsk}
        spread={book.spread}
        trades={book.trades}
      />

      {/* Main 2-column Grid: Orderbook on Left, Order Form on Right */}
      <div className="trading-desk-grid">
        {/* Left: Order Book Table */}
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div
            style={{
              padding: '14px 16px',
              borderBottom: '1px solid var(--border-subtle)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <h3 style={{ fontSize: 15, display: 'flex', alignItems: 'center', gap: 6, margin: 0 }}>
              <TrendingUp size={16} color="var(--accent-orange)" />
              <span>Order Book ({currentTier.name})</span>
            </h3>
            <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
              Click any row to fill price
            </span>
          </div>

          {/* Table Header */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr 1fr',
              padding: '8px 14px',
              borderBottom: '1px solid var(--border-subtle)',
              fontSize: 11,
              color: 'var(--text-dim)',
              fontWeight: 600,
            }}
          >
            <span>PRICE (₹)</span>
            <span style={{ textAlign: 'center' }}>QTY</span>
            <span style={{ textAlign: 'right' }}>TOTAL (₹)</span>
          </div>

          {/* Asks (Sells) in reverse order (highest to lowest ask) */}
          <div className="orderbook-table">
            {book.asks.length === 0 ? (
              <div
                style={{
                  padding: 16,
                  textAlign: 'center',
                  color: 'var(--text-dim)',
                  fontSize: 12,
                }}
              >
                No resting ask orders in database
              </div>
            ) : (
              book.asks.map((ask, idx) => (
                <div
                  key={`ask-${idx}`}
                  className="orderbook-row font-mono"
                  onClick={() => handlePriceClick(ask.price)}
                  title={`Click to fill ₹${ask.price}`}
                >
                  <div
                    className="ask-depth-bar"
                    style={{ width: `${Math.min(100, (ask.depth || 1) * 4)}%` }}
                  />
                  <span style={{ color: 'var(--accent-rose)', fontWeight: 600 }}>{ask.price}</span>
                  <span style={{ textAlign: 'center', color: 'var(--text-sub)' }}>{ask.qty}</span>
                  <span style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{ask.total}</span>
                </div>
              ))
            )}
          </div>

          {/* Spread Divider */}
          <div className="spread-divider font-mono">
            <span>Spread</span>
            <span style={{ color: 'var(--accent-orange)', fontWeight: 600 }}>
              {book.spread !== '--' ? `₹${book.spread}` : '--'}
            </span>
          </div>

          {/* Bids (Buys) */}
          <div className="orderbook-table">
            {book.bids.length === 0 ? (
              <div
                style={{
                  padding: 16,
                  textAlign: 'center',
                  color: 'var(--text-dim)',
                  fontSize: 12,
                }}
              >
                No resting bid orders in database
              </div>
            ) : (
              book.bids.map((bid, idx) => (
                <div
                  key={`bid-${idx}`}
                  className="orderbook-row font-mono"
                  onClick={() => handlePriceClick(bid.price)}
                  title={`Click to fill ₹${bid.price}`}
                >
                  <div
                    className="bid-depth-bar"
                    style={{ width: `${Math.min(100, (bid.depth || 1) * 4)}%` }}
                  />
                  <span style={{ color: 'var(--accent-emerald)', fontWeight: 600 }}>{bid.price}</span>
                  <span style={{ textAlign: 'center', color: 'var(--text-sub)' }}>{bid.qty}</span>
                  <span style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{bid.total}</span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right: Order Form or Public Login Lock */}
        <div>
          {currentRole === 'PUBLIC' ? (
            /* Public View-Only Lock Box */
            <div className="card" style={{ textAlign: 'center', padding: '36px 24px' }}>
              <div
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: '50%',
                  background: 'var(--accent-orange-subtle)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto 16px',
                }}
              >
                <Lock size={24} color="#f97316" />
              </div>
              <h3 style={{ fontSize: 18, marginBottom: 8 }}>Log In to Start Trading</h3>
              <p
                style={{
                  fontSize: 13,
                  color: 'var(--text-muted)',
                  marginBottom: 24,
                  lineHeight: 1.5,
                }}
              >
                Viewing the live order book is free. To place buy or sell limit orders, an
                authenticated account and wallet balance are required.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <button className="btn-primary" onClick={() => navigate('/login')}>
                  Log in to trade
                </button>
                <button className="btn-secondary" onClick={() => navigate('/register')}>
                  Sign up
                </button>
              </div>
            </div>
          ) : (
            /* Active Trading Form */
            <div className="card" style={{ padding: 20 }}>
              <form onSubmit={handleSubmitOrder}>
                {/* Buy / Sell Toggle */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: 6,
                    marginBottom: 16,
                  }}
                >
                  <button
                    type="button"
                    className={`btn-pill ${side === 'BUY' ? 'active' : ''}`}
                    style={{
                      background: side === 'BUY' ? 'var(--accent-emerald)' : 'var(--bg-input)',
                      color: side === 'BUY' ? '#06281e' : 'var(--text-muted)',
                      fontWeight: 700,
                      padding: '8px',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: 13,
                    }}
                    onClick={() => setSide('BUY')}
                  >
                    Buy Tickets
                  </button>
                  <button
                    type="button"
                    className={`btn-pill ${side === 'SELL' ? 'active' : ''}`}
                    style={{
                      background: side === 'SELL' ? 'var(--accent-rose)' : 'var(--bg-input)',
                      color: side === 'SELL' ? '#fff' : 'var(--text-muted)',
                      fontWeight: 700,
                      padding: '8px',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: 13,
                    }}
                    onClick={() => setSide('SELL')}
                  >
                    Sell Tickets
                  </button>
                </div>

                {/* Limit / Market Toggle */}
                <div style={{ display: 'flex', gap: 12, marginBottom: 16, fontSize: 12 }}>
                  <label
                    style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}
                  >
                    <input
                      type="radio"
                      name="orderType"
                      checked={orderType === 'LIMIT'}
                      onChange={() => setOrderType('LIMIT')}
                    />
                    <span>Limit Order</span>
                  </label>
                  <label
                    style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}
                  >
                    <input
                      type="radio"
                      name="orderType"
                      checked={orderType === 'MARKET'}
                      onChange={() => setOrderType('MARKET')}
                    />
                    <span>Market Order</span>
                  </label>
                </div>

                {/* Price Input */}
                <div style={{ marginBottom: 14 }}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      marginBottom: 4,
                    }}
                  >
                    <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Price (₹)</label>
                    {orderType === 'MARKET' && (
                      <span style={{ fontSize: 11, color: 'var(--accent-orange)' }}>
                        Best market match
                      </span>
                    )}
                  </div>
                  <input
                    type="number"
                    step="0.5"
                    disabled={orderType === 'MARKET'}
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    placeholder="Enter limit price"
                    style={{ width: '100%', fontSize: 15, fontWeight: 600 }}
                  />
                </div>

                {/* Quantity Input */}
                <div style={{ marginBottom: 16 }}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      marginBottom: 4,
                    }}
                  >
                    <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Quantity</label>
                    <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                      {side === 'SELL'
                        ? 'From owned tickets'
                        : `Wallet: ₹${Number(wallet?.available || 0).toFixed(2)}`}
                    </span>
                  </div>
                  <input
                    type="number"
                    min="1"
                    max={side === 'SELL' ? 10 : 20}
                    value={qty}
                    onChange={(e) => setQty(parseInt(e.target.value, 10) || 1)}
                    style={{ width: '100%', fontSize: 15, fontWeight: 600 }}
                  />
                </div>

                {/* Total and Cap Warning */}
                <div
                  style={{
                    background: 'var(--bg-app)',
                    padding: 12,
                    borderRadius: 'var(--radius-sm)',
                    marginBottom: 18,
                    fontSize: 12,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      marginBottom: 6,
                    }}
                  >
                    <span style={{ color: 'var(--text-muted)' }}>Total Amount:</span>
                    <strong
                      className="font-mono"
                      style={{ fontSize: 14, color: 'var(--text-main)' }}
                    >
                      ₹{totalCost.toFixed(2)}
                    </strong>
                  </div>
                  {resaleCap > 0 && (
                    <p style={{ color: 'var(--text-dim)', fontSize: 11, lineHeight: 1.4 }}>
                      Resale cap: <strong>₹{resaleCap.toFixed(2)}</strong>. Funds are held in escrow until filled or cancelled.
                    </p>
                  )}
                </div>

                {/* Submit button */}
                <button
                  type="submit"
                  disabled={isSubmitting || (side === 'BUY' && Number(wallet?.available || 0) < totalCost)}
                  className="btn-primary"
                  style={{
                    width: '100%',
                    padding: 12,
                    fontSize: 14,
                    background:
                      side === 'SELL'
                        ? 'linear-gradient(135deg, #e11d48, #f43f5e)'
                        : undefined,
                  }}
                >
                  {isSubmitting
                    ? 'Submitting order...'
                    : side === 'BUY'
                    ? `Place Buy Order (₹${totalCost.toFixed(2)})`
                    : `Place Sell Order (₹${totalCost.toFixed(2)})`}
                </button>
              </form>
            </div>
          )}
        </div>
      </div>

      {/* Bottom Section: Tabs for Open Orders & Trade Feed */}
      <div className="card" style={{ marginTop: 24, padding: 0, overflow: 'hidden' }}>
        <div
          style={{
            display: 'flex',
            gap: 10,
            padding: '12px 16px',
            borderBottom: '1px solid var(--border-subtle)',
            background: 'rgba(0,0,0,0.2)',
          }}
        >
          <button
            className={`btn-pill ${bottomTab === 'OPEN_ORDERS' ? 'active' : ''}`}
            style={{
              padding: '6px 14px',
              fontSize: 12,
              fontWeight: 600,
              background: bottomTab === 'OPEN_ORDERS' ? 'var(--bg-card)' : 'transparent',
              color: bottomTab === 'OPEN_ORDERS' ? 'var(--accent-orange)' : 'var(--text-muted)',
              borderRadius: 'var(--radius-sm)',
            }}
            onClick={() => setBottomTab('OPEN_ORDERS')}
          >
            My Active Orders (
            {Array.isArray(userOrders) ? userOrders.filter((o) => o.status === 'OPEN' || o.status === 'PARTIAL').length : 0})
          </button>
          <button
            className={`btn-pill ${bottomTab === 'TRADE_FEED' ? 'active' : ''}`}
            style={{
              padding: '6px 14px',
              fontSize: 12,
              fontWeight: 600,
              background: bottomTab === 'TRADE_FEED' ? 'var(--bg-card)' : 'transparent',
              color: bottomTab === 'TRADE_FEED' ? 'var(--accent-orange)' : 'var(--text-muted)',
              borderRadius: 'var(--radius-sm)',
            }}
            onClick={() => setBottomTab('TRADE_FEED')}
          >
            Recent Public Trades (Live Feed: {book.trades.length})
          </button>
        </div>

        {bottomTab === 'OPEN_ORDERS' ? (
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Order #</th>
                  <th>Side</th>
                  <th>Tier</th>
                  <th>Qty</th>
                  <th>Price</th>
                  <th>Filled</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {!Array.isArray(userOrders) || userOrders.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-dim)', padding: 24 }}>
                      No active orders found in this session
                    </td>
                  </tr>
                ) : (
                  userOrders.map((ord) => (
                    <tr key={ord.id}>
                      <td className="font-mono"></td>
                      <td>
                        <span
                          className={`badge ${ord.side === 'BUY' ? 'badge-green' : 'badge-red'}`}
                        >
                          {ord.side}
                        </span>
                      </td>
                      <td>{ord.tier || currentTier.name}</td>
                      <td className="font-mono">{ord.qty}</td>
                      <td className="font-mono">₹{Number(ord.price || 0).toFixed(2)}</td>
                      <td className="font-mono">
                        {ord.filled || 0} / {ord.qty}
                      </td>
                      <td>
                        <span
                          className={`badge ${
                            ord.status === 'OPEN'
                              ? 'badge-blue'
                              : ord.status === 'PARTIAL'
                              ? 'badge-orange'
                              : ord.status === 'FILLED'
                              ? 'badge-green'
                              : 'badge-neutral'
                          }`}
                        >
                          {ord.status}
                        </span>
                      </td>
                      <td>
                        {(ord.status === 'OPEN' || ord.status === 'PARTIAL') && (
                          <button
                            className="btn-danger-outline"
                            onClick={() => cancelOrder(ord.id)}
                          >
                            Cancel
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        ) : (
          /* Trade Feed */
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Price (₹)</th>
                  <th>Quantity</th>
                  <th>Timestamp</th>
                  <th>Trade ID</th>
                  <th>Side</th>
                </tr>
              </thead>
              <tbody>
                {book.trades.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-dim)', padding: 24 }}>
                      No trade executions recorded yet.
                    </td>
                  </tr>
                ) : (
                  book.trades.map((tr, idx) => (
                    <tr key={tr.id || idx} className="font-mono">
                      <td
                        style={{
                          color:
                            tr.side === 'buy' ? 'var(--accent-emerald)' : 'var(--accent-rose)',
                          fontWeight: 600,
                        }}
                      >
                        ₹{tr.price}
                      </td>
                      <td>{tr.qty} tickets</td>
                      <td style={{ color: 'var(--text-dim)' }}>{tr.time}</td>
                      <td style={{ color: 'var(--text-dim)', fontSize: 11 }}>
                        {tr.id ? tr.id.slice(0, 12) : '--'}
                      </td>
                      <td>
                        <span
                          className={`badge ${tr.side === 'buy' ? 'badge-green' : 'badge-red'}`}
                        >
                          {tr.side ? tr.side.toUpperCase() : 'TRADE'}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
