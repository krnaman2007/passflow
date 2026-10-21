import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
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
  ShoppingBag
} from 'lucide-react';

export default function EventDetailPage() {
  const {
    events,
    routeParams,
    navigate,
    currentRole,
    wallet,
    purchasePrimaryTickets,
    showToast
  } = useApp();

  const event = events.find((e) => e.id === routeParams.id) || events[0];

  // Quantity selected per tier: { [tierId]: number }
  const [quantities, setQuantities] = useState({
    vip: 0,
    general: 0,
    'early-bird': 0
  });

  const [isProcessing, setIsProcessing] = useState(false);
  const [purchaseSuccess, setPurchaseSuccess] = useState(null);

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

  event.tiers.forEach((tier) => {
    const qty = quantities[tier.id] || 0;
    if (qty > 0) {
      const lineCost = tier.price * qty;
      totalCost += lineCost;
      totalTickets += qty;
      summaryLines.push({
        id: tier.id,
        name: tier.name,
        qty,
        cost: lineCost
      });
    }
  });

  const balanceAfter = wallet.available - totalCost;

  // Handle Buy Click
  const handleBuy = () => {
    if (currentRole === 'PUBLIC') {
      navigate('/login');
      return;
    }

    if (totalTickets === 0) {
      showToast('Please choose at least 1 ticket to proceed.', 'warning');
      return;
    }

    if (wallet.available < totalCost) {
      showToast('Insufficient wallet balance. Please add funds.', 'error');
      navigate('/wallet');
      return;
    }

    setIsProcessing(true);
    setTimeout(() => {
      const success = purchasePrimaryTickets(event.id, quantities);
      setIsProcessing(false);
      if (success) {
        setPurchaseSuccess({
          totalTickets,
          totalCost,
          balanceBefore: wallet.available,
          balanceAfter,
          summary: summaryLines
        });
        setQuantities({ vip: 0, general: 0, 'early-bird': 0 });
      }
    }, 500);
  };

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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
              <span className="badge badge-orange">{event.category}</span>
              <span className="badge badge-green">VERIFIED ORGANIZER: {event.organizer}</span>
            </div>
            <h1 style={{ fontSize: 28, marginBottom: 8 }}>{event.title}</h1>
            <p style={{ color: 'var(--text-sub)', fontSize: 14, marginBottom: 16 }}>{event.tagline}</p>
          </div>

          <button
            className="btn-secondary"
            onClick={() => navigate(`/market/${event.id}/general`, { id: event.id, categoryId: 'general' })}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <TrendingUp size={15} color="#f97316" />
            <span>Open Resale Market</span>
          </button>
        </div>

        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', borderTop: '1px solid var(--border-subtle)', paddingTop: 16, color: 'var(--text-sub)', fontSize: 13 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Calendar size={15} color="var(--accent-orange)" />
            <span>{event.fullDate}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Clock size={15} />
            <span>{event.doors}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <MapPin size={15} />
            <span>{event.venue}, {event.city}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <ShieldAlert size={15} color="#10b981" />
            <span>{event.ageLimit}</span>
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
                background: 'rgba(16, 185, 129, 0.08)'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <CheckCircle2 size={20} color="#10b981" />
                <h4 style={{ fontSize: 16, color: '#10b981' }}>
                  ✓ {purchaseSuccess.totalTickets} ticket(s) added to your vault!
                </h4>
              </div>
              <p style={{ fontSize: 13, color: 'var(--text-sub)', marginBottom: 12 }}>
                Wallet balance: ${purchaseSuccess.balanceBefore.toFixed(2)} →{' '}
                <strong style={{ color: 'var(--accent-emerald)' }}>
                  ${(purchaseSuccess.balanceBefore - purchaseSuccess.totalCost).toFixed(2)}
                </strong>
                . Your tickets are issued and ready to hold, trade, or transfer.
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
            <div style={{ padding: '0 0 16px', borderBottom: '1px solid var(--border-subtle)', marginBottom: 8 }}>
              <h3 style={{ fontSize: 16 }}>Pick Tickets (Direct Face-Value)</h3>
              <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Guaranteed authentic tickets issued directly by {event.organizer}
              </p>
            </div>

            {event.tiers.map((tier) => {
              const qty = quantities[tier.id] || 0;
              const isTierSoldOut = tier.left === 0 || tier.soldOut;

              return (
                <div key={tier.id} className="tier-row">
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <strong style={{ fontSize: 15 }}>{tier.name}</strong>
                      <span className="badge badge-neutral font-mono">${tier.price}</span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 4 }}>
                      {isTierSoldOut ? (
                        <span style={{ color: 'var(--accent-rose)' }}>Sold out from organizer</span>
                      ) : (
                        <span>{tier.left} remaining of {tier.total}</span>
                      )}
                    </div>
                  </div>

                  <div>
                    {isTierSoldOut ? (
                      <button
                        className="btn-secondary"
                        style={{ fontSize: 12, color: 'var(--accent-orange)' }}
                        onClick={() => navigate(`/market/${event.id}/${tier.id}`, { id: event.id, categoryId: tier.id })}
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
            })}
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
              flexWrap: 'wrap'
            }}
          >
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <span className="badge badge-orange">LIVE RESALE ORDER BOOK</span>
                <span className="badge badge-green">ANTI-SCALPING PROTECTED</span>
              </div>
              <p style={{ fontSize: 13, color: 'var(--text-main)', fontWeight: 500 }}>
                Best ask <span className="font-mono" style={{ color: 'var(--accent-orange)' }}>${event.bestAsk || 108}</span>, best bid <span className="font-mono" style={{ color: 'var(--accent-emerald)' }}>${event.bestBid || 105}</span> for General.
              </p>
              <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Looking to trade or buy sold-out tiers? Enter the live matching book.
              </p>
            </div>

            <button
              className="btn-primary"
              onClick={() => navigate(`/market/${event.id}/general`, { id: event.id, categoryId: 'general' })}
            >
              <span>Open market</span>
              <TrendingUp size={14} />
            </button>
          </div>
        </div>

        {/* Right: Order Summary Sticky Card */}
        <div>
          <div className="order-summary-card">
            <h3 style={{ fontSize: 16, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
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
                    <span className="font-mono">${line.cost.toFixed(2)}</span>
                  </div>
                ))}

                <div className="summary-line total">
                  <span>Total</span>
                  <span className="font-mono">${totalCost.toFixed(2)}</span>
                </div>

                {currentRole !== 'PUBLIC' && (
                  <div className="wallet-debit-note">
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span>Wallet Balance:</span>
                      <span className="font-mono">${wallet.available.toFixed(2)}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600 }}>
                      <span>Balance After:</span>
                      <span
                        className="font-mono"
                        style={{ color: balanceAfter >= 0 ? 'var(--accent-emerald)' : 'var(--accent-rose)' }}
                      >
                        ${balanceAfter.toFixed(2)}
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
                <p style={{ textAlign: 'center', fontSize: 12, color: 'var(--text-dim)', marginTop: 10 }}>
                  Don't have an account?{' '}
                  <span
                    style={{ color: 'var(--accent-orange)', cursor: 'pointer', textDecoration: 'underline' }}
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
                  <span>
                    Buy {totalTickets > 0 ? `${totalTickets} ticket(s)` : 'tickets'}
                  </span>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
