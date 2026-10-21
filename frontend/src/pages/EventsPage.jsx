import React, { useState, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { Search, Calendar, MapPin, ArrowRight, ShieldCheck, Tag, Zap } from 'lucide-react';

export default function EventsPage() {
  const { events, navigate, currentRole } = useApp();
  const [searchTerm, setSearchTerm] = useState('');
  const [activeFilter, setActiveFilter] = useState('All');

  // Filter logic
  const filteredEvents = useMemo(() => {
    return events.filter((ev) => {
      // Must be published for public/regular users, or show all
      if (currentRole !== 'ORGANIZER' && currentRole !== 'ADMIN' && ev.status === 'DRAFT') {
        return false;
      }

      const matchesSearch =
        ev.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        ev.venue.toLowerCase().includes(searchTerm.toLowerCase()) ||
        ev.city.toLowerCase().includes(searchTerm.toLowerCase()) ||
        ev.category.toLowerCase().includes(searchTerm.toLowerCase());

      if (!matchesSearch) return false;

      if (activeFilter === 'Festival') return ev.category === 'Festival';
      if (activeFilter === 'Concert') return ev.category === 'Concert';
      if (activeFilter === 'Resale available') return ev.resaleFrom > 0;
      if (activeFilter === 'This month') return ev.date.includes('Oct') || ev.date.includes('Nov');

      return true;
    });
  }, [events, searchTerm, activeFilter, currentRole]);

  return (
    <div className="content-wrap">
      {/* Hero Header */}
      <div className="hero-header">
        <h1 className="hero-title">
          Face-value tickets.<br />
          <span style={{ color: 'var(--accent-orange)' }}>Fair-price resale.</span>
        </h1>
        <p className="hero-sub">
          {currentRole === 'PUBLIC'
            ? 'Primary + resale, ek hi jagah. Stock-exchange style order book with anti-scalping caps.'
            : 'Wallet ready — seedha khareedo. Buy primary or trade on the live order book.'}
        </p>
      </div>

      {/* Search and Filter Chips */}
      <div className="search-filter-row">
        <div className="search-box-wrap">
          <Search size={16} className="search-icon" />
          <input
            type="text"
            className="search-input"
            placeholder="Search events, artists, cities..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        <div className="filter-chips">
          {['All', 'Festival', 'Concert', 'This month', 'Resale available'].map((chip) => (
            <button
              key={chip}
              className={`filter-chip ${activeFilter === chip ? 'active' : ''}`}
              onClick={() => setActiveFilter(chip)}
            >
              {chip}
            </button>
          ))}
        </div>
      </div>

      {/* Events Grid */}
      <div className="grid-2">
        {filteredEvents.map((ev) => {
          // Check if primary is sold out
          const primaryLeft = ev.tiers.reduce((acc, t) => acc + (t.left || 0), 0);
          const isSoldOut = primaryLeft === 0;

          return (
            <div key={ev.id} className="event-card">
              {/* Card Banner Mesh */}
              <div
                className={`event-card-banner bg-gradient-to-br ${ev.gradient}`}
                style={{
                  background: `linear-gradient(135deg, rgba(23, 27, 38, 0.95), rgba(18, 21, 29, 0.8)), linear-gradient(45deg, ${ev.accentColor}33, transparent 70%)`,
                  borderBottom: '1px solid var(--border-subtle)'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <span className="badge badge-neutral" style={{ background: 'rgba(0,0,0,0.5)' }}>
                    {ev.category}
                  </span>
                  {ev.status === 'DRAFT' && (
                    <span className="badge badge-orange">ORGANIZER DRAFT</span>
                  )}
                  {isSoldOut ? (
                    <span className="badge badge-red">PRIMARY SOLD OUT</span>
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

                {/* Price Comparison Box */}
                <div className="price-comparison-box">
                  <div className="price-col">
                    <span className="label">Primary</span>
                    <span className="val font-mono">
                      {isSoldOut ? 'Sold out' : `from $${ev.primaryFrom}`}
                    </span>
                    <span className="sub">
                      {isSoldOut ? '0 left at face' : `${ev.tiers.find((t) => !t.soldOut)?.left || 0} left at face`}
                    </span>
                  </div>

                  <div style={{ width: 1, background: 'var(--border-subtle)' }} />

                  <div className="price-col" style={{ textAlign: 'right' }}>
                    <span className="label">Resale Book</span>
                    <span className="val font-mono" style={{ color: 'var(--accent-orange)' }}>
                      {ev.resaleFrom > 0 ? `from $${ev.resaleFrom}` : 'No active ask'}
                    </span>
                    <span className="sub">
                      {ev.bestBid > 0 ? `Best bid $${ev.bestBid}` : 'Order book ready'}
                    </span>
                  </div>
                </div>

                {/* Action Buttons */}
                <div style={{ display: 'flex', gap: 10 }}>
                  {!isSoldOut ? (
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
                        boxShadow: '0 2px 8px rgba(99, 102, 241, 0.35)'
                      }}
                      onClick={() => navigate(`/market/${ev.id}/general`, { id: ev.id, categoryId: 'general' })}
                    >
                      <span>See resale book</span>
                      <Zap size={14} />
                    </button>
                  )}

                  <button
                    className="btn-secondary"
                    onClick={() => navigate(`/market/${ev.id}/general`, { id: ev.id, categoryId: 'general' })}
                    title="View live order book"
                  >
                    <span>Market</span>
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
