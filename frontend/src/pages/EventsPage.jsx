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
} from 'lucide-react';

import { formatBackendEvent } from '../utils/eventAdapter';
export { formatBackendEvent };


export default function EventsPage() {
  const { navigate, currentRole, currentUser, setEvents: updateContextEvents } = useApp();
  const effectiveRole = currentUser ? (currentUser.role || 'USER') : (currentRole || 'PUBLIC');

  const [backendEvents, setBackendEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeFilter, setActiveFilter] = useState('All');
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Fetch real events directly from backend API
  const fetchLiveEvents = useCallback(async (isManualRefresh = false) => {
    if (isManualRefresh) setIsRefreshing(true);
    else setLoading(true);
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
      setError(err.message || 'Unable to load events from PassFlow backend.');
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, [updateContextEvents]);

  // Initial load from backend
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
              Live Exchange Events.<br />
              <span style={{ color: 'var(--accent-orange)' }}>Direct from Backend Database.</span>
            </h1>
            <p className="hero-sub">
              Real-time ticket inventory and resale order books synced directly from PostgreSQL.
            </p>
          </div>

          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <button
              className="btn-secondary"
              onClick={() => fetchLiveEvents(true)}
              disabled={loading || isRefreshing}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              title="Refresh live events from PostgreSQL"
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

      {/* Loading State */}
      {loading && (
        <div
          style={{
            padding: '60px 20px',
            textAlign: 'center',
            color: 'var(--text-muted)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 16,
          }}
        >
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: '50%',
              border: '3px solid rgba(249, 115, 22, 0.2)',
              borderTopColor: 'var(--accent-orange)',
              animation: 'spin 1s linear infinite',
            }}
          />
          <p style={{ fontSize: '0.95rem', fontWeight: 500 }}>
            Querying authoritative events from PostgreSQL backend...
          </p>
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
              <span>Create Event in Backend</span>
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
