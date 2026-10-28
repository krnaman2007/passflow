import React, { useState, useEffect, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { api } from '../services/api';
import { formatBackendEvent } from '../utils/eventAdapter';
import { EventDetailSkeleton } from '../components/Skeleton';
import {
  Calendar,
  Clock,
  MapPin,
  ShieldAlert,
  ArrowLeft,
  TrendingUp,
  TrendingDown,
  CheckCircle2,
  Lock,
  Zap,
  ShoppingBag,
  RefreshCw,
  AlertCircle,
  Gavel,
  ShieldCheck,
  Sparkles,
  ArrowRight,
  Wallet,
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
    syncLiveWallet,
    fetchLiveOrders,
  } = useApp();

  const eventId = routeParams?.id;

  const [liveEvent, setLiveEvent] = useState(() => {
    const fromContext = Array.isArray(events)
      ? events.find((e) => e.id === eventId)
      : null;
    return fromContext && Array.isArray(fromContext.tiers) && fromContext.tiers.length > 0
      ? fromContext
      : null;
  });
  const [loading, setLoading] = useState(() => {
    const fromContext = Array.isArray(events)
      ? events.find((e) => e.id === eventId)
      : null;
    return !(fromContext && Array.isArray(fromContext.tiers) && fromContext.tiers.length > 0);
  });
  const [error, setError] = useState(null);

  // Quantity selected per tier: { [tierId]: number }
  const [quantities, setQuantities] = useState({});
  const [isProcessing, setIsProcessing] = useState(false);
  const [purchaseSuccess, setPurchaseSuccess] = useState(null);
  const [auctionPrices, setAuctionPrices] = useState({});
  const [purchasingAuctionId, setPurchasingAuctionId] = useState(null);

  // Fetch full live event details from backend
  useEffect(() => {
    let isMounted = true;

    async function loadEvent() {
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
      const livePrice = tier.activeAuction
        ? (auctionPrices[tier.activeAuction.id] ?? tier.activeAuction.currentPrice ?? tier.activeAuction.startPrice)
        : tier.price;
      const lineCost = Math.round(Number(livePrice) * qty * 100) / 100;
      totalCost += lineCost;
      totalTickets += qty;
      summaryLines.push({
        id: tier.id,
        name: tier.activeAuction ? `${tier.name} (Live Auction)` : tier.name,
        qty,
        unitPrice: livePrice,
        cost: lineCost,
        activeAuction: tier.activeAuction,
      });
    }
  });

  const walletBalance = Number(wallet?.available || 0);
  const balanceAfter = walletBalance - totalCost;

  // Purchase primary tickets handler
  const handleBuy = async () => {
    if (currentRole === 'PUBLIC') {
      showToast('Please log in to purchase tickets', 'info');
      navigate('/login');
      return;
    }

    if (totalTickets === 0) {
      showToast('Please select at least 1 ticket to purchase', 'warning');
      return;
    }

    if (balanceAfter < 0) {
      showToast(
        `Insufficient wallet balance. You need ₹${totalCost.toLocaleString('en-IN', { minimumFractionDigits: 2 })} but have ₹${walletBalance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}. Please deposit funds.`,
        'error'
      );
      navigate('/wallet');
      return;
    }

    setIsProcessing(true);
    try {
      const tierPurchases = Object.entries(quantities)
        .filter(([_, qty]) => qty > 0)
        .map(([tierId, quantity]) => ({ tierId, quantity }));

      const res = await purchasePrimaryTickets(event.id, tierPurchases);
      const data = res?.data || res;

      setPurchaseSuccess({
        totalTickets,
        totalCost,
        balanceBefore: walletBalance,
        balanceAfter,
        purchasedTickets: data?.tickets || [],
      });

      setQuantities({});
      showToast(
        `Successfully purchased ${totalTickets} ticket(s) for ₹${totalCost.toLocaleString('en-IN', { minimumFractionDigits: 2 })}!`,
        'success'
      );
    } catch (err) {
      const msg = err?.data?.error?.message || err?.message || 'Purchase could not be completed.';
      showToast(msg, 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  // Poll live Dutch auction prices for any tier with an active auction
  const activeAuctions = useMemo(() => {
    return (Array.isArray(event?.tiers) ? event.tiers : [])
      .map((t) => t.activeAuction)
      .filter(Boolean);
  }, [event]);

  const activeAuctionIds = useMemo(() => {
    return activeAuctions.map((a) => a.id).join(',');
  }, [activeAuctions]);

  useEffect(() => {
    if (activeAuctions.length === 0) return;

    let isPolling = true;

    const fetchAuctionPrices = async () => {
      for (const auc of activeAuctions) {
        try {
          const res = await api.auctions.getCurrentPrice(auc.id);
          const priceData = res?.data || res;
          if (isPolling && priceData?.currentPrice != null) {
            setAuctionPrices((prev) => ({
              ...prev,
              [auc.id]: Number(priceData.currentPrice),
            }));
          }
        } catch (e) {
          console.warn('Auction price poll skipped:', e.message);
        }
      }
    };

    fetchAuctionPrices();
    const interval = setInterval(fetchAuctionPrices, 4000);
    return () => {
      isPolling = false;
      clearInterval(interval);
    };
  }, [activeAuctionIds]);

  const handleBuyAuction = async (auction, tier) => {
    if (currentRole === 'PUBLIC') {
      showToast('Please log in to participate in the Dutch Auction', 'info');
      navigate('/login');
      return;
    }

    const currentPrice = auctionPrices[auction.id] ?? auction.currentPrice ?? auction.startPrice;
    if (walletBalance < currentPrice) {
      showToast(`Insufficient wallet balance (₹${walletBalance}) to purchase Dutch auction ticket (₹${currentPrice}). Please add funds.`, 'error');
      navigate('/wallet');
      return;
    }

    setPurchasingAuctionId(auction.id);
    try {
      await api.auctions.purchaseAuction(auction.id, 1);
      if (typeof syncLiveWallet === 'function') await syncLiveWallet();
      if (typeof fetchLiveOrders === 'function') await fetchLiveOrders();

      showToast(`Successfully purchased 1x ${tier.name} via Dutch Auction for ₹${currentPrice}!`, 'success');
      setPurchaseSuccess({
        totalTickets: 1,
        totalCost: currentPrice,
        balanceBefore: walletBalance,
        balanceAfter: walletBalance - currentPrice,
        summary: [{ id: tier.id, name: `${tier.name} (Dutch Auction)`, qty: 1, cost: currentPrice }],
      });
    } catch (err) {
      console.error('Dutch auction purchase failed:', err);
      const msg = err?.data?.error?.message || err?.message || 'Failed to complete Dutch auction purchase';
      showToast(msg, 'error');
    } finally {
      setPurchasingAuctionId(null);
    }
  };

  const organizerName =
    typeof event?.organizer === 'object' && event?.organizer !== null
      ? event.organizer.organizationName || 'Verified Organizer'
      : event?.organizer || 'Official Organizer';

  const defaultCategoryId = tiers[0]?.id || 'general';

  // Loading State
  if (loading && !liveEvent) {
    return <EventDetailSkeleton />;
  }

  // Error State
  if (error || !event) {
    return (
      <div className="content-wrap" style={{ padding: '40px 20px' }}>
        <button
          className="btn-secondary"
          style={{ marginBottom: 20, padding: '7px 14px', fontSize: 13 }}
          onClick={() => navigate('/events')}
        >
          <ArrowLeft size={14} />
          <span>Back to Events</span>
        </button>

        <div
          style={{
            padding: 36,
            borderRadius: 'var(--radius-xl)',
            background: 'rgba(239, 68, 68, 0.08)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            color: '#fca5a5',
            textAlign: 'center',
            maxWidth: 520,
            margin: '24px auto',
          }}
        >
          <AlertCircle size={36} color="#ef4444" style={{ margin: '0 auto 14px' }} />
          <h3 style={{ fontSize: '1.2rem', fontWeight: 700, color: '#f87171', marginBottom: 6 }}>
            Event Not Found
          </h3>
          <p style={{ fontSize: '0.92rem', color: 'var(--text-muted)', marginBottom: 24, lineHeight: 1.5 }}>
            {error || 'The requested event does not exist in the database or may have concluded.'}
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
      {/* Return to Discovery */}
      <button
        className="btn-secondary"
        style={{ marginBottom: 22, padding: '7px 14px', fontSize: 13 }}
        onClick={() => navigate('/events')}
      >
        <ArrowLeft size={14} />
        <span>Return to Marketplace</span>
      </button>

      {/* Hero Header Banner */}
      <div className="event-detail-header">
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            flexWrap: 'wrap',
            gap: 16,
            marginBottom: 20,
          }}
        >
          <div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
              <span className="badge badge-orange font-mono">{event.category}</span>
              <span className="badge badge-green" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <ShieldCheck size={12} />
                <span>VERIFIED ORGANIZER: {organizerName}</span>
              </span>
              {event.status === 'DRAFT' && <span className="badge badge-neutral">DRAFT MODE</span>}
            </div>

            <h1 style={{ fontSize: 'clamp(1.7rem, 1.3rem + 1.6vw, 2.6rem)', fontWeight: 800, marginBottom: 8, letterSpacing: '-0.03em' }}>
              {event.title}
            </h1>
            <p style={{ color: 'var(--text-sub)', fontSize: 15, maxWidth: 660, lineHeight: 1.5 }}>
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
            style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '10px 18px' }}
          >
            <TrendingUp size={15} color="var(--accent-orange)" />
            <span>Open Resale Order Book</span>
          </button>
        </div>

        {/* Event Key Meta Strip */}
        <div
          style={{
            display: 'flex',
            gap: 24,
            flexWrap: 'wrap',
            borderTop: '1px solid var(--border-subtle)',
            paddingTop: 18,
            color: 'var(--text-sub)',
            fontSize: 13,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <Calendar size={15} color="var(--accent-orange)" />
            <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>{event.fullDate}</span>
          </div>
          {event.time && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <Clock size={15} color="var(--text-dim)" />
              <span>{event.time}</span>
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <MapPin size={15} color="var(--text-dim)" />
            <span>
              {event.venue}
              {event.city && event.city !== event.venue ? `, ${event.city}` : ''}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <ShieldAlert size={15} color="var(--accent-emerald)" />
            <span style={{ color: 'var(--accent-emerald)', fontWeight: 600 }}>Anti-Scalping 2x Protected</span>
          </div>
        </div>
      </div>

      {/* Main 2-Column Grid */}
      <div className="detail-grid">
        {/* Left Column: Tiers Selection & Secondary Resale Callout */}
        <div>
          {/* Success Banner if purchased */}
          {purchaseSuccess && (
            <div
              className="card"
              style={{
                marginBottom: 24,
                border: '1px solid var(--accent-emerald-border)',
                background: 'rgba(16, 185, 129, 0.09)',
                boxShadow: '0 0 24px -4px var(--accent-emerald-glow)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <CheckCircle2 size={22} color="var(--accent-emerald)" />
                <h4 style={{ fontSize: 17, fontWeight: 700, color: 'var(--accent-emerald)' }}>
                  ✓ {purchaseSuccess.totalTickets} Ticket(s) Successfully Added to Your Vault!
                </h4>
              </div>
              <p style={{ fontSize: 13, color: 'var(--text-sub)', marginBottom: 14, lineHeight: 1.5 }}>
                Wallet balance: ₹{purchaseSuccess.balanceBefore.toLocaleString('en-IN', { minimumFractionDigits: 2 })} →{' '}
                <strong style={{ color: 'var(--accent-emerald)' }}>
                  ₹{(purchaseSuccess.balanceBefore - purchaseSuccess.totalCost).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </strong>
                . Authenticated passes with cryptographic provenance custody are ready to hold, transfer, or list on the secondary exchange.
              </p>
              <div style={{ display: 'flex', gap: 10 }}>
                <button className="btn-primary" onClick={() => navigate('/tickets')}>
                  <span>View in My Tickets Vault</span>
                  <ArrowRight size={15} />
                </button>
                <button className="btn-secondary" onClick={() => setPurchaseSuccess(null)}>
                  Keep Browsing Tiers
                </button>
              </div>
            </div>
          )}

          {/* Ticket Tier Selection Desk */}
          <div className="card" style={{ marginBottom: 26 }}>
            <div
              style={{
                paddingBottom: 16,
                borderBottom: '1px solid var(--border-subtle)',
                marginBottom: 16,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: 10,
              }}
            >
              <div>
                <h3 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>Select Seating Tiers</h3>
                <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                  Guaranteed authentic passes issued directly by {organizerName}
                </p>
              </div>
              <span className="badge badge-neutral font-mono">{tiers.length} TIER{tiers.length !== 1 ? 'S' : ''} AVAILABLE</span>
            </div>

            {tiers.length === 0 ? (
              <div style={{ padding: '36px 0', textAlign: 'center', color: 'var(--text-muted)' }}>
                No active ticket tiers found for this event.
              </div>
            ) : (
              tiers.map((tier) => {
                const qty = quantities[tier.id] || 0;
                const isTierSoldOut = tier.left === 0 || tier.soldOut;
                const percentLeft = tier.total > 0 ? Math.round((tier.left / tier.total) * 100) : 0;

                return (
                  <div
                    key={tier.id}
                    className={`tier-row ${qty > 0 ? 'selected' : ''}`}
                    style={{ opacity: isTierSoldOut ? 0.7 : 1 }}
                  >
                    <div style={{ flex: 1, minWidth: 200 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                        <strong style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-main)' }}>{tier.name}</strong>

                        {tier.activeAuction ? (
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            <span
                              className="badge font-mono"
                              style={{
                                background: 'rgba(16, 185, 129, 0.15)',
                                color: 'var(--accent-emerald)',
                                border: '1px solid rgba(16, 185, 129, 0.35)',
                                fontSize: 13,
                                fontWeight: 700,
                                padding: '3px 8px',
                              }}
                            >
                              ₹{auctionPrices[tier.activeAuction.id] ?? tier.activeAuction.currentPrice ?? tier.activeAuction.startPrice}
                            </span>
                            <span
                              className="badge font-mono"
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 4,
                                background: 'rgba(236, 72, 153, 0.15)',
                                color: '#ec4899',
                                border: '1px solid rgba(236, 72, 153, 0.3)',
                                fontSize: 11,
                              }}
                            >
                              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#10b981', display: 'inline-block', boxShadow: '0 0 6px #10b981' }} />
                              <Gavel size={11} /> Dutch Decaying Price
                            </span>
                          </div>
                        ) : (
                          <span className="font-mono" style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-main)' }}>
                            ₹{Number(tier.price).toLocaleString('en-IN')}
                          </span>
                        )}
                      </div>

                      <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 6 }}>
                        {isTierSoldOut ? (
                          <span style={{ color: 'var(--accent-rose)', fontWeight: 600 }}>
                            Sold out from primary organizer · Secondary trading active
                          </span>
                        ) : (
                          <span>
                            {tier.left} of {tier.total} tickets remaining ({percentLeft}% available)
                          </span>
                        )}
                        {tier.description && <span> • {tier.description}</span>}
                      </div>

                      {/* Capacity progress bar */}
                      {!isTierSoldOut && tier.total > 0 && (
                        <div style={{ width: '100%', maxWidth: 260, height: 4, background: 'rgba(255, 255, 255, 0.08)', borderRadius: 'var(--radius-full)', marginTop: 8, overflow: 'hidden' }}>
                          <div
                            style={{
                              width: `${Math.max(5, 100 - percentLeft)}%`,
                              height: '100%',
                              background: percentLeft < 20 ? 'var(--accent-rose)' : 'var(--accent-orange)',
                              borderRadius: 'var(--radius-full)',
                            }}
                          />
                        </div>
                      )}
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
                          <span>See Resale Book</span>
                          <Zap size={13} />
                        </button>
                      ) : (
                        <div className="qty-stepper">
                          <button
                            className="qty-btn"
                            disabled={qty <= 0}
                            onClick={() => updateQty(tier.id, -1, tier.left)}
                            aria-label="Decrease quantity"
                          >
                            −
                          </button>
                          <span className="qty-val font-mono">{qty}</span>
                          <button
                            className="qty-btn"
                            disabled={qty >= tier.left}
                            onClick={() => updateQty(tier.id, 1, tier.left)}
                            aria-label="Increase quantity"
                          >
                            +
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Live Dutch Auction Buy Callout inside Tier */}
                    {tier.activeAuction && (
                      <div
                        style={{
                          width: '100%',
                          marginTop: 12,
                          padding: '12px 16px',
                          borderRadius: 'var(--radius-md)',
                          background: 'linear-gradient(135deg, rgba(236, 72, 153, 0.08), rgba(24, 28, 42, 0.85))',
                          border: '1px solid rgba(236, 72, 153, 0.28)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          flexWrap: 'wrap',
                          gap: 12,
                        }}
                      >
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#10b981', display: 'inline-block', boxShadow: '0 0 8px #10b981' }} />
                            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-main)', letterSpacing: '0.04em' }}>
                              LIVE DUTCH AUCTION DECAY
                            </span>
                            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                              (Price falls from ₹{tier.activeAuction.startPrice} → reserve floor ₹{tier.activeAuction.minPrice})
                            </span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 4 }}>
                            <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>Current real-time quote:</span>
                            <strong style={{ fontSize: 17, color: 'var(--accent-emerald)', fontFamily: 'var(--font-mono)' }}>
                              ₹{auctionPrices[tier.activeAuction.id] ?? tier.activeAuction.currentPrice ?? tier.activeAuction.startPrice}
                            </strong>
                          </div>
                        </div>

                        <button
                          className="btn-primary"
                          style={{
                            background: 'linear-gradient(135deg, #ec4899, #db2777)',
                            borderColor: '#db2777',
                            fontSize: 12,
                            padding: '8px 16px',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 6,
                          }}
                          disabled={purchasingAuctionId === tier.activeAuction.id}
                          onClick={() => handleBuyAuction(tier.activeAuction, tier)}
                        >
                          {purchasingAuctionId === tier.activeAuction.id ? (
                            <>
                              <RefreshCw size={13} className="spin" />
                              <span>Locking Price...</span>
                            </>
                          ) : (
                            <>
                              <Zap size={13} />
                              <span>Lock Bid at ₹{auctionPrices[tier.activeAuction.id] ?? tier.activeAuction.currentPrice ?? tier.activeAuction.startPrice}</span>
                            </>
                          )}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* Secondary Resale Market Callout */}
          <div
            className="card"
            style={{
              background: 'linear-gradient(135deg, rgba(22, 29, 46, 0.9), rgba(14, 18, 30, 0.95))',
              border: '1px solid var(--border-glass-bright)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 18,
              flexWrap: 'wrap',
            }}
          >
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 6 }}>
                <span className="badge badge-orange font-mono">LIVE RESALE ORDER BOOK</span>
                <span className="badge badge-green font-mono">ANTI-SCALPING CAPPED</span>
              </div>
              <p style={{ fontSize: 14, color: 'var(--text-main)', fontWeight: 600, margin: 0 }}>
                Looking to trade or buy tickets from peer holders?
              </p>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2, margin: '2px 0 0 0' }}>
                All secondary market tickets are verified, guaranteed valid, and capped at 2.0x face value.
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
              style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}
            >
              <span>Open Resale Desk</span>
              <TrendingUp size={14} />
            </button>
          </div>
        </div>

        {/* Right Column: Order Summary Terminal Card */}
        <div>
          <div className="order-summary-card">
            <h3
              style={{
                fontSize: 17,
                fontWeight: 700,
                marginBottom: 18,
                display: 'flex',
                alignItems: 'center',
                gap: 9,
              }}
            >
              <ShoppingBag size={18} color="var(--accent-orange)" />
              <span>Checkout Summary</span>
            </h3>

            {summaryLines.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '36px 0', color: 'var(--text-dim)' }}>
                <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'rgba(255, 255, 255, 0.04)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
                  <ShoppingBag size={20} color="var(--text-dim)" />
                </div>
                <p style={{ fontSize: 13, color: 'var(--text-sub)', margin: 0 }}>Select tickets on the left to review your cart.</p>
              </div>
            ) : (
              <div>
                {summaryLines.map((line) => (
                  <div key={line.id} className="summary-line">
                    <span style={{ color: 'var(--text-main)', fontWeight: 500 }}>
                      {line.qty} × {line.name}
                    </span>
                    <span className="font-mono" style={{ fontWeight: 600 }}>
                      ₹{line.cost.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                ))}

                <div className="summary-line total">
                  <span>Total Amount</span>
                  <span className="font-mono" style={{ color: 'var(--text-main)', fontSize: 22 }}>
                    ₹{totalCost.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </span>
                </div>

                {currentRole !== 'PUBLIC' && (
                  <div className="wallet-debit-note">
                    <Wallet size={16} color="var(--accent-orange)" style={{ flexShrink: 0, marginTop: 2 }} />
                    <div style={{ flex: 1 }}>
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          marginBottom: 4,
                          fontSize: 12,
                        }}
                      >
                        <span style={{ color: 'var(--text-muted)' }}>Wallet Balance:</span>
                        <span className="font-mono" style={{ fontWeight: 600 }}>
                          ₹{walletBalance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </span>
                      </div>
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          fontWeight: 600,
                          fontSize: 12,
                        }}
                      >
                        <span style={{ color: 'var(--text-sub)' }}>Balance After Purchase:</span>
                        <span
                          className="font-mono"
                          style={{
                            color: balanceAfter >= 0 ? 'var(--accent-emerald)' : 'var(--accent-rose)',
                            fontSize: 13,
                          }}
                        >
                          ₹{balanceAfter.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </span>
                      </div>
                      {balanceAfter < 0 && (
                        <div style={{ marginTop: 8, fontSize: 11, color: 'var(--accent-rose)' }}>
                          Insufficient balance. Add funds via Escrow Wallet before continuing.
                        </div>
                      )}
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
                  style={{ width: '100%', padding: '13px', fontSize: 14 }}
                  onClick={() => navigate('/login')}
                >
                  <Lock size={15} />
                  <span>Log in to Complete Purchase</span>
                </button>
                <p
                  style={{
                    textAlign: 'center',
                    fontSize: 12,
                    color: 'var(--text-dim)',
                    marginTop: 12,
                  }}
                >
                  Don't have an account?{' '}
                  <span
                    style={{
                      color: 'var(--accent-orange)',
                      cursor: 'pointer',
                      fontWeight: 600,
                    }}
                    onClick={() => navigate('/register')}
                  >
                    Sign up
                  </span>
                </p>
              </div>
            ) : (
              <div>
                <button
                  className="btn-primary"
                  style={{ width: '100%', padding: '13px', fontSize: 14 }}
                  disabled={totalTickets === 0 || isProcessing || balanceAfter < 0}
                  onClick={handleBuy}
                >
                  {isProcessing ? (
                    <span>Reserving Inventory & Minting Passes...</span>
                  ) : (
                    <span>Complete Purchase ({totalTickets > 0 ? `${totalTickets} Ticket${totalTickets > 1 ? 's' : ''}` : '0 Tickets'})</span>
                  )}
                </button>

                {balanceAfter < 0 && (
                  <button
                    className="btn-secondary"
                    style={{ width: '100%', marginTop: 10, fontSize: 12, padding: '8px' }}
                    onClick={() => navigate('/wallet')}
                  >
                    <Wallet size={14} color="var(--accent-emerald)" />
                    <span>Deposit Funds to Wallet</span>
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
