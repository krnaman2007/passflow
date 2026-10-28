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
      // Handle standard response wrapper: { success: true, data: { events: [...] } } or direct array
      const rawList =
        response?.data?.events ||
        response?.events ||
        (Array.isArray(response?.data) ? response.data : []) ||
        (Array.isArray(response) ? response : []);

      const formatted = rawList.map((ev, idx) => formatBackendEvent(ev, idx));
      setBackendEvents(formatted);

      // Keep AppContext in sync so EventDetailPage and other routes use the real events
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

  return (
    <div className="content-wrap">
      {/* Hero Header */}
      <div className="hero-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }}>
          <div>
            <h1 className="hero-title">
              Fair-Price Live Event Exchange

            </h1>
            <p className="hero-sub">
              Access authenticated primary ticket sales and real-time secondary order books with anti-scalping price caps and provable solvency.
            </p>
          </div>

          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <button
              className="btn-secondary"
              onClick={() => fetchLiveEvents(true)}
              disabled={loading || isRefreshing}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              title="Refresh live events"
            >
              <RefreshCw size={14} className={isRefreshing ? 'animate-spin' : ''} />
              <span>{isRefreshing ? 'Refreshing...' : 'Refresh'}</span>
            </button>

            {(effectiveRole === 'ORGANIZER' || effectiveRole === 'ADMIN') && (
              <button
                className="btn-primary"
                onClick={() => navigate('/organizer/create-event')}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <PlusCircle size={15} />
                <span>Create Event</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Institutional Exchange Guarantees Strip */}
      <div
        style={{
          display: 'flex',
          gap: 16,
          flexWrap: 'wrap',
          marginBottom: 24,
          padding: '11px 18px',
          background: 'var(--bg-glass-card)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--border-glass)',
          boxShadow: 'var(--inner-highlight-subtle)',
          alignItems: 'center',
          fontSize: 12,
        }}
      >
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, color: 'var(--text-sub)' }}>
          <ShieldCheck size={15} color="var(--accent-emerald)" />
          <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>100% Provably Solvent:</span>
          <span>Cryptographic Merkle tree reserves audit</span>
        </div>
        <span style={{ color: 'var(--border-strong)' }}>·</span>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, color: 'var(--text-sub)' }}>
          <Zap size={15} color="var(--accent-orange)" />
          <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>Anti-Scalping Protection:</span>
          <span>Hard-capped resale pricing eliminates bot gouging</span>
        </div>
        <span style={{ color: 'var(--border-strong)' }}>·</span>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, color: 'var(--text-sub)' }}>
          <Sparkles size={15} color="var(--accent-cyan)" />
          <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>Secondary Liquidity:</span>
          <span>Continuous bid/ask limit order books</span>
        </div>
      </div>

      {/* Search and Filter Chips */}
      <div className="search-filter-row">
        <div className="search-box-wrap">
          <Search size={16} className="search-icon" />
          <input
            type="text"
            className="search-input"
            placeholder="Search live events, venues, categories..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        <div className="filter-chips">
          {['All', 'Available', 'Sold out', ...(currentRole === 'ORGANIZER' || currentRole === 'ADMIN' ? ['Drafts'] : [])].map(
            (chip) => (
              <button
                key={chip}
                className={`filter-chip ${activeFilter === chip ? 'active' : ''}`}
                onClick={() => setActiveFilter(chip)}
              >
                {chip}
              </button>
            )
          )}
        </div>
      </div>

      {/* Loading State: Shimmer Skeleton */}
      {loading && backendEvents.length === 0 && (
        <div style={{ marginTop: 24 }}>
          <EventGridSkeleton count={6} />
        </div>
      )}

      {/* Error State */}
      {!loading && error && (
        <div
          style={{
            padding: 24,
            borderRadius: 'var(--radius-lg)',
            background: 'rgba(239, 68, 68, 0.08)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            color: '#fca5a5',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 12,
            textAlign: 'center',
            margin: '20px 0',
          }}
        >
          <AlertCircle size={28} color="#ef4444" />
          <div>
            <h3 style={{ fontSize: '1rem', fontWeight: 600, color: '#f87171', marginBottom: 4 }}>
              Failed to connect to backend
            </h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{error}</p>
          </div>
          <button className="btn-secondary" onClick={() => fetchLiveEvents()}>
            <span>Try Again</span>
          </button>
        </div>
      )}

      {/* Empty State */}
      {!loading && !error && filteredEvents.length === 0 && (
        <div
          style={{
            padding: '60px 20px',
            textAlign: 'center',
            background: 'var(--bg-card)',
            borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--border-subtle)',
            margin: '20px 0',
          }}
        >
          <Ticket size={40} color="var(--text-dim)" style={{ margin: '0 auto 16px' }} />
          <h3 style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: 8 }}>
            No live events found
          </h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', maxWidth: 440, margin: '0 auto 20px' }}>
            {searchTerm
              ? `No backend events matched "${searchTerm}". Try a different search term or clear filters.`
              : 'There are currently no events registered in the database. Organizers can publish events using the Organizer Console.'}
          </p>
          {searchTerm ? (
            <button className="btn-secondary" onClick={() => setSearchTerm('')}>
              Clear Search
            </button>
          ) : effectiveRole === 'ORGANIZER' || effectiveRole === 'ADMIN' ? (
            <button className="btn-primary" onClick={() => navigate('/organizer/create-event')}>
              <span>Create Event</span>
              <ArrowRight size={15} />
            </button>
          ) : (
            <button className="btn-secondary" onClick={() => fetchLiveEvents(true)}>
              <span>Refresh Events</span>
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
                    background: `linear-gradient(135deg, rgba(23, 27, 38, 0.95), rgba(18, 21, 29, 0.8)), linear-gradient(45deg, ${ev.accentColor}33, transparent 70%)`,
                    borderBottom: '1px solid var(--border-subtle)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <span className="badge badge-neutral" style={{ background: 'rgba(0,0,0,0.5)' }}>
                      {ev.category}
                    </span>
                    {ev.status === 'DRAFT' && (
                      <span className="badge badge-orange">DRAFT</span>
                    )}
                    {ev.isSoldOut ? (
                      <span className="badge badge-red">SOLD OUT</span>
                    ) : (
                      <span className="badge badge-green">PRIMARY AVAILABLE</span>
                    )}
                  </div>

                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#fff', fontSize: 13, fontWeight: 500 }}>
                      <Calendar size={13} color="var(--accent-orange)" />
                      <span>{ev.fullDate}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-muted)', fontSize: 12, marginTop: 2 }}>
                      <MapPin size={12} />
                      <span>{ev.venue}</span>
                    </div>
                  </div>
                </div>

                {/* Card Content Body */}
                <div className="event-card-body">
                  <h3 className="event-card-title">{ev.title}</h3>
                  <p className="event-card-meta">{ev.tagline}</p>

                  {/* Price & Tier Summary */}
                  <div className="price-comparison-box">
                    <div className="price-col">
                      <span className="label">Primary Face Value</span>
                      <span className="val font-mono">
                        {ev.isSoldOut ? 'Sold out' : `from ₹${Number(ev.primaryFrom).toLocaleString('en-IN')}`}
                      </span>
                      <span className="sub">
                        {ev.isSoldOut ? '0 left at face value' : `${ev.totalAvailable} tickets available`}
                      </span>
                    </div>

                    <div style={{ width: 1, background: 'var(--border-subtle)' }} />

                    <div className="price-col" style={{ textAlign: 'right' }}>
                      <span className="label">Available Tiers</span>
                      <span className="val font-mono" style={{ color: 'var(--accent-orange)' }}>
                        {ev.tiers.length} Tier{ev.tiers.length !== 1 ? 's' : ''}
                      </span>
                      <span className="sub">
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
                        <span>Buy tickets</span>
                        <ArrowRight size={15} />
                      </button>
                    ) : (
                      <button
                        className="btn-primary"
                        style={{
                          flex: 1,
                          background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
                          boxShadow: '0 2px 8px rgba(99, 102, 241, 0.35)',
                        }}
                        onClick={() =>
                          navigate(`/market/${ev.id}/${defaultCategoryId}`, {
                            id: ev.id,
                            categoryId: defaultCategoryId,
                          })
                        }
                      >
                        <span>See resale book</span>
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
                      title="View live order book"
                    >
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
