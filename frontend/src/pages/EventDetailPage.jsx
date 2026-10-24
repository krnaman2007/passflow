import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { api } from '../services/api';
import { formatBackendEvent } from '../utils/eventAdapter';
import {
  Calendar,
  Clock,
  MapPin,
  ShieldAlert,
  ArrowLeft,
  TrendingUp,
  CheckCircle2,
  Lock,
  Zap,
  ShoppingBag,
  RefreshCw,
  AlertCircle,
} from 'lucide-react';

export default function EventDetailPage() {
  const {
    events,
    routeParams,
    navigate,
    currentRole,
    wallet,
    purchasePrimaryTickets,
    showToast,
  } = useApp();

  const [liveEvent, setLiveEvent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Quantity selected per tier: { [tierId]: number }
  const [quantities, setQuantities] = useState({});
  const [isProcessing, setIsProcessing] = useState(false);
  const [purchaseSuccess, setPurchaseSuccess] = useState(null);

  const eventId = routeParams?.id;

  // Fetch real event details from backend
  useEffect(() => {
    let isMounted = true;

    async function loadEvent() {
      // First check if already formatted in context
      const fromContext = Array.isArray(events)
        ? events.find((e) => e.id === eventId)
        : null;

      if (fromContext && Array.isArray(fromContext.tiers) && fromContext.tiers.length > 0) {
        setLiveEvent(fromContext);
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        if (!eventId) {
          throw new Error('No event ID provided in route.');
        }

        const res = await api.events.getEventById(eventId);
        const rawEvent = res?.data?.event || res?.event || res?.data || res;

        if (!rawEvent || !rawEvent.id) {
          throw new Error('Event not found in backend database.');
        }

        const formatted = formatBackendEvent(rawEvent, 0);
        if (isMounted) {
          setLiveEvent(formatted);
        }
      } catch (err) {
        console.error('Failed to load event details:', err);
        // Fallback: search in context
        if (fromContext) {
          if (isMounted) setLiveEvent(fromContext);
        } else if (isMounted) {
          setError(err.message || 'Unable to load event details from backend.');
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    loadEvent();

    return () => {
      isMounted = false;
    };
  }, [eventId, events]);

  const event = liveEvent;

  // Helper to change quantity
  const updateQty = (tierId, delta, maxAvailable) => {
    if (currentRole === 'PUBLIC') {
      showToast('Please log in to select tickets and purchase', 'info');
      navigate('/login');
      return;
    }

    setQuantities((prev) => {
      const current = prev[tierId] || 0;
      const next = Math.max(0, Math.min(maxAvailable, current + delta));
      return { ...prev, [tierId]: next };
    });
    setPurchaseSuccess(null);
  };

  // Calculations
  let totalCost = 0;
  let totalTickets = 0;
  const summaryLines = [];

  const tiers = Array.isArray(event?.tiers) ? event.tiers : [];

  tiers.forEach((tier) => {
    const qty = quantities[tier.id] || 0;
    if (qty > 0) {
      const lineCost = tier.price * qty;
      totalCost += lineCost;
      totalTickets += qty;
      summaryLines.push({
        id: tier.id,
        name: tier.name,
        qty,
        cost: lineCost,
      });
    }
  });

  const walletBalance = Number(wallet?.available || 0);
  const balanceAfter = walletBalance - totalCost;

  // Handle Buy Click
  const handleBuy = async () => {
    if (currentRole === 'PUBLIC') {
      navigate('/login');
      return;
    }

    if (totalTickets === 0) {
      showToast('Please choose at least 1 ticket to proceed.', 'warning');
      return;
    }

    if (walletBalance < totalCost) {
      showToast('Insufficient wallet balance. Please add funds.', 'error');
      navigate('/wallet');
      return;
    }

    setIsProcessing(true);
    try {
      const success = await purchasePrimaryTickets(event.id, quantities);
      if (success) {
        setPurchaseSuccess({
          totalTickets,
          totalCost,
          balanceBefore: walletBalance,
          balanceAfter,
          summary: summaryLines,
        });
        setQuantities({});
      }
    } catch (err) {
      showToast(err.message || 'Purchase could not be completed.', 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  const organizerName =
    typeof event?.organizer === 'object' && event?.organizer !== null
      ? event.organizer.organizationName || 'Verified Organizer'
      : event?.organizer || 'Official Organizer';

  const defaultCategoryId = tiers[0]?.id || 'general';

  // Loading State
  if (loading) {
    return (
      <div className="content-wrap" style={{ textAlign: 'center', padding: '80px 20px' }}>
        <div
          style={{
            width: 36,
            height: 36,
            margin: '0 auto 16px',
            borderRadius: '50%',
            border: '3px solid rgba(249, 115, 22, 0.2)',
            borderTopColor: 'var(--accent-orange)',
            animation: 'spin 1s linear infinite',
          }}
        />
        <p style={{ color: 'var(--text-muted)', fontSize: 15 }}>
          Loading real event details from PostgreSQL backend...
        </p>
      </div>
    );
  }

  // Error State
  if (error || !event) {
    return (
      <div className="content-wrap" style={{ padding: '40px 20px' }}>
        <button
          className="btn-secondary"
          style={{ marginBottom: 20, padding: '6px 12px', fontSize: 12 }}
          onClick={() => navigate('/events')}
        >
          <ArrowLeft size={14} />
          <span>Back to Events</span>
        </button>

        <div
          style={{
            padding: 32,
            borderRadius: 'var(--radius-lg)',
            background: 'rgba(239, 68, 68, 0.08)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            color: '#fca5a5',
            textAlign: 'center',
            maxWidth: 500,
            margin: '20px auto',
          }}
        >
          <AlertCircle size={32} color="#ef4444" style={{ margin: '0 auto 12px' }} />
          <h3 style={{ fontSize: '1.1rem', fontWeight: 600, color: '#f87171', marginBottom: 6 }}>
            Event Not Found
          </h3>
          <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: 20 }}>
            {error || 'The requested event does not exist in the database.'}
          </p>
          <button className="btn-primary" onClick={() => navigate('/events')}>
            <span>Browse All Live Events</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="content-wrap">
      {/* Back button */}
      <button
        className="btn-secondary"
        style={{ marginBottom: 20, padding: '6px 12px', fontSize: 12 }}
        onClick={() => navigate('/events')}
      >
        <ArrowLeft size={14} />
        <span>Back to Events</span>
      </button>

      {/* Header Banner */}
      <div className="event-detail-header">
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            flexWrap: 'wrap',
            gap: 12,
          }}
        >
          <div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
              <span className="badge badge-orange">{event.category}</span>
              <span className="badge badge-green">VERIFIED ORGANIZER: {organizerName}</span>
              {event.status === 'DRAFT' && <span className="badge badge-neutral">DRAFT</span>}
            </div>
            <h1 style={{ fontSize: 28, marginBottom: 8 }}>{event.title}</h1>
            <p style={{ color: 'var(--text-sub)', fontSize: 14, marginBottom: 16 }}>
              {event.tagline}
            </p>
          </div>

          <button
            className="btn-secondary"
            onClick={() =>
              navigate(`/market/${event.id}/${defaultCategoryId}`, {
                id: event.id,
                categoryId: defaultCategoryId,
              })
            }
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <TrendingUp size={15} color="#f97316" />
            <span>Open Resale Market</span>
          </button>
        </div>

        <div
          style={{
            display: 'flex',
            gap: 24,
            flexWrap: 'wrap',
            borderTop: '1px solid var(--border-subtle)',
            paddingTop: 16,
            color: 'var(--text-sub)',
            fontSize: 13,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Calendar size={15} color="var(--accent-orange)" />
            <span>{event.fullDate}</span>
          </div>
          {event.time && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Clock size={15} />
              <span>{event.time}</span>
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <MapPin size={15} />
            <span>
              {event.venue}
              {event.city && event.city !== event.venue ? `, ${event.city}` : ''}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <ShieldAlert size={15} color="#10b981" />
            <span>Anti-Scalping Protected</span>
          </div>
        </div>
      </div>

      {/* Main 2-column Grid */}
      <div className="detail-grid">
        {/* Left: Tiers Selection & Resale Callout */}
        <div>
          {/* Success banner if just purchased */}
          {purchaseSuccess && (
            <div
              className="card"
              style={{
                marginBottom: 20,
                border: '1px solid var(--accent-emerald-border)',
                background: 'rgba(16, 185, 129, 0.08)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <CheckCircle2 size={20} color="#10b981" />
                <h4 style={{ fontSize: 16, color: '#10b981' }}>
                  ✓ {purchaseSuccess.totalTickets} ticket(s) added to your vault!
                </h4>
              </div>
              <p style={{ fontSize: 13, color: 'var(--text-sub)', marginBottom: 12 }}>
                Wallet balance: ₹{purchaseSuccess.balanceBefore.toLocaleString('en-IN', { minimumFractionDigits: 2 })} →{' '}
                <strong style={{ color: 'var(--accent-emerald)' }}>
                  ₹{(purchaseSuccess.balanceBefore - purchaseSuccess.totalCost).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </strong>
                . Your tickets are issued directly by the backend and ready to hold or trade.
              </p>
              <div style={{ display: 'flex', gap: 10 }}>
                <button className="btn-primary" onClick={() => navigate('/tickets')}>
                  View my tickets
                </button>
                <button className="btn-secondary" onClick={() => setPurchaseSuccess(null)}>
                  Keep browsing
                </button>
              </div>
            </div>
          )}

          {/* Pick Tickets Card */}
          <div className="card" style={{ marginBottom: 24 }}>
            <div
              style={{
                padding: '0 0 16px',
                borderBottom: '1px solid var(--border-subtle)',
                marginBottom: 8,
              }}
            >
              <h3 style={{ fontSize: 16 }}>Pick Tickets (Direct Face-Value)</h3>
              <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Guaranteed authentic tickets issued directly by {organizerName}
              </p>
            </div>

            {tiers.length === 0 ? (
              <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--text-muted)' }}>
                No active ticket tiers found for this event.
              </div>
            ) : (
              tiers.map((tier) => {
                const qty = quantities[tier.id] || 0;
                const isTierSoldOut = tier.left === 0 || tier.soldOut;

                return (
                  <div key={tier.id} className="tier-row">
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <strong style={{ fontSize: 15 }}>{tier.name}</strong>
                        <span className="badge badge-neutral font-mono">₹{tier.price}</span>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 4 }}>
                        {isTierSoldOut ? (
                          <span style={{ color: 'var(--accent-rose)' }}>
                            Sold out from organizer
                          </span>
                        ) : (
                          <span>
                            {tier.left} remaining of {tier.total}
                          </span>
                        )}
                        {tier.description && <span> • {tier.description}</span>}
                      </div>
                    </div>

                    <div>
                      {isTierSoldOut ? (
                        <button
                          className="btn-secondary"
                          style={{ fontSize: 12, color: 'var(--accent-orange)' }}
                          onClick={() =>
                            navigate(`/market/${event.id}/${tier.id}`, {
                              id: event.id,
                              categoryId: tier.id,
                            })
                          }
                        >
                          <span>See resale book</span>
                          <Zap size={13} />
                        </button>
                      ) : (
                        <div className="qty-stepper">
                          <button
                            className="qty-btn"
                            disabled={qty <= 0}
                            onClick={() => updateQty(tier.id, -1, tier.left)}
                          >
                            −
                          </button>
                          <span className="qty-val font-mono">{qty}</span>
                          <button
                            className="qty-btn"
                            disabled={qty >= tier.left}
                            onClick={() => updateQty(tier.id, 1, tier.left)}
                          >
                            +
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Resale Market Callout Card */}
          <div
            className="card"
            style={{
              background: 'linear-gradient(135deg, rgba(23, 27, 38, 0.9), rgba(18, 21, 29, 0.9))',
              border: '1px solid var(--border-medium)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 16,
              flexWrap: 'wrap',
            }}
          >
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <span className="badge badge-orange">LIVE RESALE ORDER BOOK</span>
                <span className="badge badge-green">ANTI-SCALPING PROTECTED</span>
              </div>
              <p style={{ fontSize: 13, color: 'var(--text-main)', fontWeight: 500 }}>
                Looking to trade or buy tickets from peer holders?
              </p>
              <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Trades settle instantly on-chain and in database within anti-scalping price caps.
              </p>
            </div>

            <button
              className="btn-primary"
              onClick={() =>
                navigate(`/market/${event.id}/${defaultCategoryId}`, {
                  id: event.id,
                  categoryId: defaultCategoryId,
                })
              }
            >
              <span>Open market</span>
              <TrendingUp size={14} />
            </button>
          </div>
        </div>

        {/* Right: Order Summary Sticky Card */}
        <div>
          <div className="order-summary-card">
            <h3
              style={{
                fontSize: 16,
                marginBottom: 16,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <ShoppingBag size={17} color="var(--accent-orange)" />
              <span>Order Summary</span>
            </h3>

            {summaryLines.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--text-dim)' }}>
                Select tickets on the left to review your total.
              </div>
            ) : (
              <div>
                {summaryLines.map((line) => (
                  <div key={line.id} className="summary-line">
                    <span>
                      {line.qty} x {line.name}
                    </span>
                    <span className="font-mono">₹{line.cost.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                  </div>
                ))}

                <div className="summary-line total">
                  <span>Total</span>
                  <span className="font-mono">₹{totalCost.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                </div>

                {currentRole !== 'PUBLIC' && (
                  <div className="wallet-debit-note">
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        marginBottom: 4,
                      }}
                    >
                      <span>Wallet Balance:</span>
                      <span className="font-mono">₹{walletBalance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        fontWeight: 600,
                      }}
                    >
                      <span>Balance After:</span>
                      <span
                        className="font-mono"
                        style={{
                          color:
                            balanceAfter >= 0 ? 'var(--accent-emerald)' : 'var(--accent-rose)',
                        }}
                      >
                        ₹{balanceAfter.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Buy / Login Button */}
            {currentRole === 'PUBLIC' ? (
              <div>
                <button
                  className="btn-primary"
                  style={{ width: '100%', padding: '12px', fontSize: 14 }}
                  onClick={() => navigate('/login')}
                >
                  <Lock size={15} />
                  <span>Log in to buy</span>
                </button>
                <p
                  style={{
                    textAlign: 'center',
                    fontSize: 12,
                    color: 'var(--text-dim)',
                    marginTop: 10,
                  }}
                >
                  Don't have an account?{' '}
                  <span
                    style={{
                      color: 'var(--accent-orange)',
                      cursor: 'pointer',
                      textDecoration: 'underline',
                    }}
                    onClick={() => navigate('/register')}
                  >
                    Sign up
                  </span>
                </p>
              </div>
            ) : (
              <button
                className="btn-primary"
                style={{ width: '100%', padding: '12px', fontSize: 14 }}
                disabled={totalTickets === 0 || isProcessing || balanceAfter < 0}
                onClick={handleBuy}
              >
                {isProcessing ? (
                  <span>Reserving inventory...</span>
                ) : (
                  <span>Buy {totalTickets > 0 ? `${totalTickets} ticket(s)` : 'tickets'}</span>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
