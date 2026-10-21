import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import {
  Building,
  Plus,
  CheckCircle2,
  AlertCircle,
  Eye,
  Layers,
  ArrowRight,
  Sparkles,
  TrendingUp
} from 'lucide-react';

export default function OrganizerDashboardPage() {
  const {
    events,
    navigate,
    addCategoryToEvent,
    publishEvent,
    currentUser
  } = useApp();

  const [selectedEventId, setSelectedEventId] = useState('nightfall');
  const selectedEvent = events.find((e) => e.id === selectedEventId) || events[0];

  // Add tier form state
  const [tierName, setTierName] = useState('Balcony');
  const [tierPrice, setTierPrice] = useState('80.00');
  const [tierQty, setTierQty] = useState('150');

  const handleSaveTier = (e) => {
    e.preventDefault();
    if (!tierName || !tierPrice || !tierQty) return;
    addCategoryToEvent(selectedEvent.id, {
      name: tierName,
      price: tierPrice,
      quantity: tierQty
    });
    setTierName('');
    setTierPrice('');
    setTierQty('');
  };

  return (
    <div className="content-wrap">
      {/* Top Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h1 style={{ fontSize: 28, margin: 0 }}>Organizer Operations</h1>
            <span className="badge badge-orange font-mono">ORGANIZER CONSOLE</span>
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4 }}>
            Manage ticket inventories, mint new category tiers, and publish events to public markets
          </p>
        </div>

        <button
          className="btn-primary"
          onClick={() => navigate('/organizer/events/new')}
        >
          <Plus size={16} />
          <span>Create Event</span>
        </button>
      </div>

      {/* 1. My Events Table Card */}
      <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 24 }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ fontSize: 16 }}>My Produced Events</h3>
          <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>Click row to inspect inventory</span>
        </div>

        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Event Name</th>
                <th>Status</th>
                <th>Tickets Sold</th>
                <th>Total Box Office Revenue</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {events.map((ev) => {
                const isSelected = ev.id === selectedEventId;
                const totalSold = ev.tiers.reduce((acc, t) => acc + (t.total - t.left), 0);
                const revenue = ev.id === 'nightfall' ? '$24,300' : ev.id === 'ember-ash' ? '$9,120' : ev.id === 'hollow-pines' ? '$18,400' : '$0';

                return (
                  <tr
                    key={ev.id}
                    style={{
                      cursor: 'pointer',
                      background: isSelected ? 'rgba(249, 115, 22, 0.05)' : undefined
                    }}
                    onClick={() => setSelectedEventId(ev.id)}
                  >
                    <td>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{ev.title}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>{ev.fullDate} · {ev.venue}</div>
                    </td>
                    <td>
                      <span className={`badge ${ev.status === 'PUBLISHED' ? 'badge-green' : 'badge-orange'}`}>
                        {ev.status}
                      </span>
                    </td>
                    <td className="font-mono">{ev.status === 'DRAFT' ? '—' : totalSold}</td>
                    <td className="font-mono" style={{ color: 'var(--accent-emerald)', fontWeight: 600 }}>
                      {revenue}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          className="btn-secondary"
                          style={{ padding: '4px 8px', fontSize: 11 }}
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/events/${ev.id}`, { id: ev.id });
                          }}
                        >
                          <Eye size={12} />
                          <span>View</span>
                        </button>
                        {ev.status === 'DRAFT' && (
                          <button
                            className="btn-primary"
                            style={{ padding: '4px 10px', fontSize: 11 }}
                            onClick={(e) => {
                              e.stopPropagation();
                              publishEvent(ev.id);
                            }}
                          >
                            Publish
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* 2. Selected Event Inspector & Inventory Tier Panel */}
      {selectedEvent && (
        <div className="grid-2">
          {/* Left: Inventory Breakdown & Add Category */}
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div>
                <h3 style={{ fontSize: 17 }}>Inventory: {selectedEvent.title}</h3>
                <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  Total / Available / Held in open order book escrow
                </p>
              </div>
              <span className={`badge ${selectedEvent.status === 'PUBLISHED' ? 'badge-green' : 'badge-orange'}`}>
                {selectedEvent.status}
              </span>
            </div>

            {/* Inventory Tiers List */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
              {selectedEvent.tiers.map((tier) => (
                <div
                  key={tier.id}
                  style={{
                    background: 'var(--bg-app)',
                    padding: 12,
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-subtle)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                  }}
                >
                  <div>
                    <strong style={{ fontSize: 14 }}>{tier.name}</strong>
                    <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 2 }}>
                      Face price: <span className="font-mono">${tier.price}</span> · Resale cap: <span className="font-mono">${tier.cap || tier.price * 2}</span>
                    </div>
                  </div>

                  <div style={{ textAlign: 'right' }}>
                    <div className="font-mono" style={{ fontSize: 13, fontWeight: 600 }}>
                      <span style={{ color: 'var(--accent-emerald)' }}>{tier.left} avail</span>,{' '}
                      <span style={{ color: 'var(--accent-orange)' }}>{tier.held} held</span>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                      Total quota: {tier.total} tickets
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Add Ticket Category Form */}
            <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 16 }}>
              <h4 style={{ fontSize: 14, marginBottom: 10 }}>Add Ticket Category Tier</h4>
              <form onSubmit={handleSaveTier}>
                <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr', gap: 10, marginBottom: 12 }}>
                  <input
                    type="text"
                    placeholder="e.g. Balcony"
                    value={tierName}
                    onChange={(e) => setTierName(e.target.value)}
                  />
                  <input
                    type="number"
                    step="1"
                    placeholder="Price ($)"
                    value={tierPrice}
                    onChange={(e) => setTierPrice(e.target.value)}
                  />
                  <input
                    type="number"
                    placeholder="Quantity"
                    value={tierQty}
                    onChange={(e) => setTierQty(e.target.value)}
                  />
                </div>
                <button
                  type="submit"
                  className="btn-secondary"
                  style={{ width: '100%', fontSize: 13 }}
                >
                  <Plus size={14} />
                  <span>Save Category Tier</span>
                </button>
              </form>
            </div>
          </div>

          {/* Right: Publish Checklist & Event Analytics */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div className="card">
              <h3 style={{ fontSize: 16, marginBottom: 12 }}>Publish Checklist</h3>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>
                Prerequisites required before event is discoverable on public `/events` directory:
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <CheckCircle2 size={18} color="#10b981" />
                  <span style={{ fontSize: 13 }}>Details complete (Title, venue, doors, date)</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <CheckCircle2 size={18} color="#10b981" />
                  <span style={{ fontSize: 13 }}>At least one ticket category minted</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <CheckCircle2 size={18} color="#10b981" />
                  <span style={{ fontSize: 13 }}>Face price and anti-scalping resale caps calibrated</span>
                </div>
              </div>

              {selectedEvent.status === 'DRAFT' ? (
                <button
                  className="btn-primary"
                  style={{ width: '100%', padding: '12px' }}
                  onClick={() => publishEvent(selectedEvent.id)}
                >
                  Publish Event Live to Marketplace
                </button>
              ) : (
                <div
                  style={{
                    background: 'rgba(16, 185, 129, 0.08)',
                    border: '1px solid var(--accent-emerald-border)',
                    padding: 12,
                    borderRadius: 'var(--radius-sm)',
                    textAlign: 'center',
                    color: 'var(--accent-emerald)',
                    fontSize: 13,
                    fontWeight: 600
                  }}
                >
                  ✓ Event is Live and Trading on Public Exchange
                </div>
              )}
            </div>

            {/* Quick Box Office Metric */}
            <div className="card">
              <h4 style={{ fontSize: 14, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                <TrendingUp size={15} color="var(--accent-orange)" />
                <span>Primary Sales Payout Schedule</span>
              </h4>
              <p style={{ fontSize: 12, color: 'var(--text-sub)', lineHeight: 1.5 }}>
                Primary revenues are settled to your linked organizer account within 24 hours of gate validation. Anti-scalping caps protect your fans from secondary price gouging.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
