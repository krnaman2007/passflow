import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import { api } from '../services/api';
import {
  Search,
  Calendar,
  MapPin,
  ArrowRight,
  Zap,
  RefreshCw,
  AlertCircle,
  Sparkles,
  Ticket,
  PlusCircle,
  ShieldCheck,
  CheckCircle2,
  TrendingUp,
  Clock,
  ArrowUpRight,
  Shield,
  Layers,
} from 'lucide-react';

import { formatBackendEvent } from '../utils/eventAdapter';
import { EventGridSkeleton } from '../components/Skeleton';
export { formatBackendEvent };

export default function EventsPage() {
  const { events: contextEvents, navigate, currentRole, currentUser, setEvents: updateContextEvents } = useApp();
  const effectiveRole = currentUser ? (currentUser.role || 'USER') : (currentRole || 'PUBLIC');

  // Fast-start with cached events from AppContext / sessionStorage if available
  const [backendEvents, setBackendEvents] = useState(() => (Array.isArray(contextEvents) && contextEvents.length > 0 ? contextEvents : []));
  const [loading, setLoading] = useState(() => (!contextEvents || contextEvents.length === 0));
  const [error, setError] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeFilter, setActiveFilter] = useState('All');
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Sync state if context events update
  useEffect(() => {
    if (Array.isArray(contextEvents)) {
      setBackendEvents(contextEvents);
      setLoading(false);
    }
  }, [contextEvents]);

  // Fetch real events directly from backend API
  const fetchLiveEvents = useCallback(async (isManualRefresh = false) => {
    if (isManualRefresh) {
      setIsRefreshing(true);
    }
    setError(null);

    try {
      const response = await api.events.listEvents();
      const rawList =
        response?.data?.events ||
        response?.events ||
        (Array.isArray(response?.data) ? response.data : []) ||
        (Array.isArray(response) ? response : []);

      const formatted = rawList.map((ev, idx) => formatBackendEvent(ev, idx));
      setBackendEvents(formatted);

      if (typeof updateContextEvents === 'function') {
        updateContextEvents(formatted);
      }
    } catch (err) {
      console.error('Failed to load live events from backend:', err);
      setBackendEvents((prev) => {
        if (!prev || prev.length === 0) {
          setError(err.message || 'Unable to load events from PassFlow backend.');
        }
        return prev;
      });
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, [updateContextEvents]);

  // Initial load from backend (runs on mount)
  useEffect(() => {
    fetchLiveEvents();
  }, [fetchLiveEvents]);

  // Client-side search and status filters on live data
  const filteredEvents = useMemo(() => {
    return backendEvents.filter((ev) => {
      // Access control: drafts only visible to Organizer or Admin
      if (currentRole !== 'ORGANIZER' && currentRole !== 'ADMIN' && ev.status === 'DRAFT') {
        return false;
      }

      // Search match
      const search = searchTerm.trim().toLowerCase();
      if (search) {
        const matchesTitle = ev.title.toLowerCase().includes(search);
        const matchesVenue = ev.venue.toLowerCase().includes(search);
        const matchesCategory = ev.category.toLowerCase().includes(search);
        const matchesDesc = ev.tagline.toLowerCase().includes(search);
        const matchesTier = ev.tiers.some((t) => t.name.toLowerCase().includes(search));
        if (!matchesTitle && !matchesVenue && !matchesCategory && !matchesDesc && !matchesTier) {
          return false;
        }
      }

      // Filter chips
      if (activeFilter === 'Available') return !ev.isSoldOut;
      if (activeFilter === 'Sold out') return ev.isSoldOut;
      if (activeFilter === 'Drafts') return ev.status === 'DRAFT';

      return true;
    });
  }, [backendEvents, searchTerm, activeFilter, currentRole]);

  // Spotlight featured event
  const featuredEvent = useMemo(() => {
    if (!backendEvents || backendEvents.length === 0) return null;
    return backendEvents.find((e) => !e.isSoldOut && e.status !== 'DRAFT') || backendEvents[0];
  }, [backendEvents]);

  const availableCount = backendEvents.filter((e) => !e.isSoldOut).length;
  const soldOutCount = backendEvents.filter((e) => e.isSoldOut).length;
  const draftCount = backendEvents.filter((e) => e.status === 'DRAFT').length;

  return (
    <div className="content-wrap">
      {/* Hero Header Section */}
      <div className="hero-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 20 }}>
          <div style={{ maxWidth: 740 }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '4px 12px', borderRadius: 'var(--radius-full)', background: 'rgba(249, 115, 22, 0.1)', border: '1px solid rgba(249, 115, 22, 0.3)', marginBottom: 14 }}>
              <span className="brand-diamond" style={{ fontSize: 13 }}>◆</span>
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--accent-orange)', textTransform: 'uppercase' }}>
                Next-Gen Fair-Price Ticket Exchange
              </span>
            </div>

            <h1 className="hero-title text-gradient-white">
              Institutional Event Tickets & Real-Time Resale Order Books.
            </h1>
            <p className="hero-sub">
              Access authenticated primary tier ticket sales and liquid secondary exchange order books protected by algorithmic anti-scalping price caps and cryptographic proof of reserves.
            </p>
          </div>

          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              className="btn-secondary"
              onClick={() => fetchLiveEvents(true)}
              disabled={loading || isRefreshing}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}
              title="Refresh live events from backend"
            >
              <RefreshCw size={14} className={isRefreshing ? 'animate-spin' : ''} />
              <span>{isRefreshing ? 'Refreshing...' : 'Refresh'}</span>
            </button>

            {(effectiveRole === 'ORGANIZER' || effectiveRole === 'ADMIN') && (
              <button
                className="btn-primary"
                onClick={() => navigate('/organizer/create-event')}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}
              >
                <PlusCircle size={15} />
                <span>Create Event</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Trust & Guarantees Metric Bar */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          gap: 14,
          marginBottom: 32,
        }}
      >
        <div className="stat-card-glow" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 42, height: 42, borderRadius: 'var(--radius-md)', background: 'rgba(16, 185, 129, 0.12)', border: '1px solid rgba(16, 185, 129, 0.28)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <ShieldCheck size={20} color="var(--accent-emerald)" />
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-main)' }}>100% Provably Solvent</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Public Merkle tree audit backs all escrow holdings</div>
          </div>
        </div>

        <div className="stat-card-glow" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 42, height: 42, borderRadius: 'var(--radius-md)', background: 'rgba(249, 115, 22, 0.12)', border: '1px solid rgba(249, 115, 22, 0.28)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Zap size={20} color="var(--accent-orange)" />
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-main)' }}>Anti-Scalping 2.0x Cap</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Algorithmic ceiling eliminates predatory secondary scalpers</div>
          </div>
        </div>

        <div className="stat-card-glow" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 42, height: 42, borderRadius: 'var(--radius-md)', background: 'rgba(6, 182, 212, 0.12)', border: '1px solid rgba(6, 182, 212, 0.28)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <TrendingUp size={20} color="var(--accent-cyan)" />
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-main)' }}>Sub-Millisecond Order Books</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Continuous real-time secondary liquidity & bid/ask matching</div>
          </div>
        </div>
      </div>

      {/* Featured Premier Event Spotlight Card */}
      {!loading && !error && featuredEvent && !searchTerm && activeFilter === 'All' && (
        <div className="hero-spotlight-card">
          <div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
              <span className="badge badge-orange font-mono">SPOTLIGHT EVENT</span>
              <span className="badge badge-neutral">{featuredEvent.category}</span>
              {featuredEvent.isSoldOut ? (
                <span className="badge badge-red">RESALE ACTIVE</span>
              ) : (
                <span className="badge badge-green">PRIMARY AVAILABLE</span>
              )}
            </div>

            <h2 style={{ fontSize: 'clamp(1.5rem, 1.2rem + 1vw, 2.1rem)', fontWeight: 800, marginBottom: 8, letterSpacing: '-0.025em' }}>
              {featuredEvent.title}
            </h2>
            <p style={{ color: 'var(--text-sub)', fontSize: 14, marginBottom: 20, maxWidth: 600, lineHeight: 1.5 }}>
              {featuredEvent.tagline}
            </p>

            <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginBottom: 24, fontSize: 13, color: 'var(--text-sub)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Calendar size={15} color="var(--accent-orange)" />
                <span style={{ fontWeight: 500 }}>{featuredEvent.fullDate}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <MapPin size={15} color="var(--text-dim)" />
                <span>{featuredEvent.venue}</span>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {!featuredEvent.isSoldOut ? (
                <button
                  className="btn-primary"
                  onClick={() => navigate('/events/' + featuredEvent.id, { id: featuredEvent.id })}
                  style={{ padding: '11px 22px', fontSize: 14 }}
                >
                  <span>Book Tickets at Face Value</span>
                  <ArrowRight size={16} />
                </button>
              ) : (
                <button
                  className="btn-primary"
                  onClick={() => {
                    const defaultCat = featuredEvent.tiers[0]?.id || 'general';
                    navigate(`/market/${featuredEvent.id}/${defaultCat}`, {
                      id: featuredEvent.id,
                      categoryId: defaultCat,
                    });
                  }}
                  style={{ padding: '11px 22px', fontSize: 14 }}
                >
                  <span>View Resale Order Book</span>
                  <TrendingUp size={16} />
                </button>
              )}

              <button
                className="btn-secondary"
                onClick={() => {
                  const defaultCat = featuredEvent.tiers[0]?.id || 'general';
                  navigate(`/market/${featuredEvent.id}/${defaultCat}`, {
                    id: featuredEvent.id,
                    categoryId: defaultCat,
                  });
                }}
                style={{ padding: '11px 20px', fontSize: 14 }}
              >
                <span>Live Exchange Desk</span>
                <ArrowUpRight size={15} />
              </button>
            </div>
          </div>

          <div
            style={{
              background: 'rgba(11, 14, 23, 0.85)',
              border: '1px solid var(--border-glass-bright)',
              borderRadius: 'var(--radius-lg)',
              padding: 24,
              boxShadow: 'var(--inner-highlight), var(--shadow-md)',
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--text-dim)', textTransform: 'uppercase', marginBottom: 14 }}>
              Tier & Pricing Matrix
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: 'var(--text-sub)', fontSize: 13 }}>Primary Face Value</span>
                <span className="font-mono" style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-main)' }}>
                  ₹{Number(featuredEvent.primaryFrom).toLocaleString('en-IN')}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: 'var(--text-sub)', fontSize: 13 }}>Active Seating Tiers</span>
                <span className="font-mono" style={{ color: 'var(--accent-orange)', fontWeight: 600 }}>
                  {featuredEvent.tiers.length} Category{featuredEvent.tiers.length !== 1 ? 's' : ''}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: 'var(--text-sub)', fontSize: 13 }}>Anti-Scalp Price Cap</span>
                <span className="font-mono" style={{ color: 'var(--accent-emerald)', fontWeight: 600 }}>
                  ₹{(Number(featuredEvent.primaryFrom) * 2).toLocaleString('en-IN')} (Max 2x)
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 10, borderTop: '1px solid var(--border-subtle)' }}>
                <span style={{ color: 'var(--text-sub)', fontSize: 13 }}>Availability</span>
                <span className="badge badge-green">
                  {featuredEvent.isSoldOut ? '0 Tickets Left' : `${featuredEvent.totalAvailable} Seats Open`}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Search Bar and Discovery Filters */}
      <div className="search-filter-row">
        <div className="search-box-wrap">
          <Search size={16} className="search-icon" />
          <input
            type="text"
            className="search-input"
            placeholder="Search live events, venues, categories, or seating tiers..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        <div className="filter-chips">
          {[
            { label: 'All', count: backendEvents.length },
            { label: 'Available', count: availableCount },
            { label: 'Sold out', count: soldOutCount },
            ...(currentRole === 'ORGANIZER' || currentRole === 'ADMIN' ? [{ label: 'Drafts', count: draftCount }] : []),
          ].map((chip) => (
            <button
              key={chip.label}
              className={`filter-chip ${activeFilter === chip.label ? 'active' : ''}`}
              onClick={() => setActiveFilter(chip.label)}
            >
              <span>{chip.label}</span>
              <span
                style={{
                  fontSize: 11,
                  padding: '1px 6px',
                  borderRadius: 'var(--radius-full)',
                  background: activeFilter === chip.label ? 'rgba(249, 115, 22, 0.25)' : 'rgba(255, 255, 255, 0.08)',
                  marginLeft: 4,
                }}
              >
                {chip.count}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Loading Shimmer State */}
      {loading && backendEvents.length === 0 && (
        <div style={{ marginTop: 24 }}>
          <EventGridSkeleton count={6} />
        </div>
      )}

      {/* Error Alert State */}
      {!loading && error && (
        <div
          style={{
            padding: 28,
            borderRadius: 'var(--radius-lg)',
            background: 'rgba(239, 68, 68, 0.08)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            color: '#fca5a5',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 14,
            textAlign: 'center',
            margin: '24px 0',
          }}
        >
          <AlertCircle size={32} color="#ef4444" />
          <div>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#f87171', marginBottom: 4 }}>
              Unable to load live events
            </h3>
            <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)' }}>{error}</p>
          </div>
          <button className="btn-secondary" onClick={() => fetchLiveEvents(true)}>
            <span>Try Again</span>
          </button>
        </div>
      )}

      {/* Empty State */}
      {!loading && !error && filteredEvents.length === 0 && (
        <div
          style={{
            padding: '64px 24px',
            textAlign: 'center',
            background: 'var(--bg-glass-card)',
            backdropFilter: 'var(--blur-glass)',
            borderRadius: 'var(--radius-xl)',
            border: '1px solid var(--border-glass)',
            margin: '24px 0',
          }}
        >
          <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'rgba(255, 255, 255, 0.04)', border: '1px solid var(--border-subtle)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
            <Ticket size={28} color="var(--text-dim)" />
          </div>
          <h3
            style={{
              fontSize: '1.25rem',
              fontWeight: 700,
              color: 'var(--text-main)',
              marginBottom: !searchTerm && activeFilter === 'Sold out' ? 20 : 8,
            }}
          >
            No live events found
          </h3>
          {searchTerm ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.92rem', maxWidth: 460, margin: '0 auto 24px', lineHeight: 1.5 }}>
              {`No backend events matched "${searchTerm}". Try a different search term or clear filters.`}
            </p>
          ) : activeFilter !== 'Sold out' && backendEvents.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.92rem', maxWidth: 460, margin: '0 auto 24px', lineHeight: 1.5 }}>
              There are currently no events registered in the database. Organizers can publish events using the Organizer Console.
            </p>
          ) : null}
          {searchTerm ? (
            <button className="btn-secondary" onClick={() => setSearchTerm('')}>
              Clear Search Query
            </button>
          ) : effectiveRole === 'ORGANIZER' || effectiveRole === 'ADMIN' ? (
            <button className="btn-primary" onClick={() => navigate('/organizer/create-event')}>
              <span>Create First Event</span>
              <ArrowRight size={15} />
            </button>
          ) : (
            <button className="btn-secondary" onClick={() => fetchLiveEvents(true)}>
              <span>Refresh Marketplace</span>
            </button>
          )}
        </div>
      )}

      {/* Live Events Grid */}
      {!loading && !error && filteredEvents.length > 0 && (
        <div className="grid-2">
          {filteredEvents.map((ev) => {
            const defaultCategoryId = ev.tiers[0]?.id || 'general';

            return (
              <div key={ev.id} className="event-card">
                {/* Card Banner */}
                <div
                  className="event-card-banner"
                  style={{
                    background: `linear-gradient(135deg, rgba(18, 23, 36, 0.94), rgba(12, 16, 26, 0.88)), linear-gradient(45deg, ${ev.accentColor || '#f97316'}33, transparent 70%)`,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <span className="badge badge-neutral" style={{ background: 'rgba(8, 11, 18, 0.7)', backdropFilter: 'blur(8px)' }}>
                      {ev.category}
                    </span>
                    {ev.status === 'DRAFT' && (
                      <span className="badge badge-orange">DRAFT</span>
                    )}
                    {ev.isSoldOut ? (
                      <span className="badge badge-red">SOLD OUT · RESALE LIVE</span>
                    ) : (
                      <span className="badge badge-green">PRIMARY AVAILABLE</span>
                    )}
                  </div>

                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7, color: '#fff', fontSize: 13, fontWeight: 600 }}>
                      <Calendar size={14} color="var(--accent-orange)" />
                      <span>{ev.fullDate}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-muted)', fontSize: 12, marginTop: 3 }}>
                      <MapPin size={12} />
                      <span>{ev.venue}</span>
                    </div>
                  </div>
                </div>

                {/* Card Content Body */}
                <div className="event-card-body">
                  <h3 className="event-card-title">{ev.title}</h3>
                  <p className="event-card-meta">{ev.tagline}</p>

                  {/* Price & Tier Matrix Summary */}
                  <div className="price-comparison-box">
                    <div className="price-col">
                      <span className="label">Primary Face Value</span>
                      <span className="val font-mono">
                        {ev.isSoldOut ? 'Sold Out' : `from ₹${Number(ev.primaryFrom).toLocaleString('en-IN')}`}
                      </span>
                      <span className="sub">
                        {ev.isSoldOut ? '0 left at face value' : `${ev.totalAvailable} tickets remaining`}
                      </span>
                    </div>

                    <div style={{ width: 1, background: 'var(--border-subtle)' }} />

                    <div className="price-col" style={{ textAlign: 'right' }}>
                      <span className="label">Available Tiers</span>
                      <span className="val font-mono" style={{ color: 'var(--accent-orange)' }}>
                        {ev.tiers.length} Tier{ev.tiers.length !== 1 ? 's' : ''}
                      </span>
                      <span className="sub" style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {ev.tiers.map((t) => t.name).join(', ') || 'Standard'}
                      </span>
                    </div>
                  </div>

                  {/* Actions */}
                  <div style={{ display: 'flex', gap: 10 }}>
                    {!ev.isSoldOut ? (
                      <button
                        className="btn-primary"
                        style={{ flex: 1 }}
                        onClick={() => navigate('/events/' + ev.id, { id: ev.id })}
                      >
                        <span>Buy Primary Tickets</span>
                        <ArrowRight size={15} />
                      </button>
                    ) : (
                      <button
                        className="btn-primary"
                        style={{
                          flex: 1,
                          background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
                          boxShadow: '0 4px 16px rgba(99, 102, 241, 0.4)',
                        }}
                        onClick={() =>
                          navigate(`/market/${ev.id}/${defaultCategoryId}`, {
                            id: ev.id,
                            categoryId: defaultCategoryId,
                          })
                        }
                      >
                        <span>See Resale Book</span>
                        <Zap size={14} />
                      </button>
                    )}

                    <button
                      className="btn-secondary"
                      onClick={() =>
                        navigate(`/market/${ev.id}/${defaultCategoryId}`, {
                          id: ev.id,
                          categoryId: defaultCategoryId,
                        })
                      }
                      title="View live exchange order book"
                    >
                      <TrendingUp size={14} color="var(--accent-orange)" />
                      <span>Order Book</span>
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
