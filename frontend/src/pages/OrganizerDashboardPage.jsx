import React, { useState, useEffect, useCallback } from 'react';
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
  TrendingUp,
  RefreshCw,
  Clock,
  Ticket,
  DollarSign,
  ShieldCheck,
  Lock,
  ExternalLink
} from 'lucide-react';
import { api } from '../services/api';
import { formatBackendEvent } from '../utils/eventAdapter';

export default function OrganizerDashboardPage() {
  const {
    navigate,
    addCategoryToEvent,
    publishEvent,
    currentUser,
    currentRole,
    login,
    showToast
  } = useApp();

  const [organizerEvents, setOrganizerEvents] = useState([]);
  const [organizerProfile, setOrganizerProfile] = useState(null);
  const [selectedEventId, setSelectedEventId] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isPublishingId, setIsPublishingId] = useState(null);

  // Add tier form state
  const [tierName, setTierName] = useState('');
  const [tierPrice, setTierPrice] = useState('');
  const [tierQty, setTierQty] = useState('');
  const [isAddingTier, setIsAddingTier] = useState(false);

  // Load Organizer Events from Backend
  const loadOrganizerData = useCallback(async (showNotification = false) => {
    if (!currentUser || currentRole === 'PUBLIC') {
      setIsLoading(false);
      return;
    }

    try {
      const [eventsRes, profileRes] = await Promise.allSettled([
        api.organizer.getEvents(),
        api.organizer.getProfile(),
      ]);

      if (profileRes.status === 'fulfilled' && profileRes.value?.data) {
        setOrganizerProfile(profileRes.value.data);
      }

      if (eventsRes.status === 'fulfilled') {
        const rawList =
          eventsRes.value?.data?.events ||
          eventsRes.value?.events ||
          (Array.isArray(eventsRes.value?.data) ? eventsRes.value.data : []) ||
          (Array.isArray(eventsRes.value) ? eventsRes.value : []);

        const formatted = rawList.map((ev, idx) => formatBackendEvent(ev, idx));
        setOrganizerEvents(formatted);

        // Keep selection or auto-select first event
        if (formatted.length > 0) {
          setSelectedEventId((prev) => (prev && formatted.some((e) => e.id === prev) ? prev : formatted[0].id));
        } else {
          setSelectedEventId(null);
        }

        if (showNotification) {
          showToast(`Dashboard refreshed (${formatted.length} events loaded)`, 'info');
        }
      } else {
        console.warn('Organizer events fetch notice:', eventsRes.reason);
      }
    } catch (err) {
      console.error('Failed to load organizer dashboard data:', err);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [currentUser, currentRole, showToast]);

  useEffect(() => {
    loadOrganizerData();
  }, [loadOrganizerData]);

  const selectedEvent = organizerEvents.find((e) => e.id === selectedEventId) || organizerEvents[0];

  // Aggregate Metrics
  const totalProduced = organizerEvents.length;
  const activeEventsCount = organizerEvents.filter((e) => e.status === 'PUBLISHED').length;

  const totalTicketsSold = organizerEvents.reduce((acc, ev) => {
    const soldForEv = (ev.tiers || []).reduce((tAcc, t) => tAcc + Math.max(0, (t.total || 0) - (t.left || 0)), 0);
    return acc + soldForEv;
  }, 0);

  const totalRevenue = organizerEvents.reduce((acc, ev) => {
    const revForEv = (ev.tiers || []).reduce((tAcc, t) => {
      const sold = Math.max(0, (t.total || 0) - (t.left || 0));
      return tAcc + sold * (t.price || 0);
    }, 0);
    return acc + revForEv;
  }, 0);

  // Handle Add Tier
  const handleSaveTier = async (e) => {
    e.preventDefault();
    if (!selectedEvent?.id) return;

    if (!tierName.trim() || !tierPrice || !tierQty) {
      showToast('Please fill in Tier Name, Price, and Quantity', 'error');
      return;
    }

    const p = parseFloat(tierPrice);
    const q = parseInt(tierQty, 10);

    if (isNaN(p) || p <= 0) {
      showToast('Price must be greater than 0', 'error');
      return;
    }

    if (isNaN(q) || q <= 0) {
      showToast('Quantity must be at least 1', 'error');
      return;
    }

    setIsAddingTier(true);
    try {
      await addCategoryToEvent(selectedEvent.id, {
        name: tierName.trim(),
        price: p,
        quantity: q,
      });

      setTierName('');
      setTierPrice('');
      setTierQty('');

      // Refresh organizer events from backend
      await loadOrganizerData();
    } catch (err) {
      // error handled in AppContext
    } finally {
      setIsAddingTier(false);
    }
  };

  // Handle Publish Event
  const handlePublish = async (eventId, e) => {
    if (e) e.stopPropagation();
    setIsPublishingId(eventId);
    try {
      await publishEvent(eventId);
      await loadOrganizerData();
    } catch (err) {
      // toast shown in AppContext
    } finally {
      setIsPublishingId(null);
    }
  };

  // 1. Guard: Visitor / Unauthenticated
  if (!currentUser || currentRole === 'PUBLIC') {
    return (
      <div className="content-wrap" style={{ maxWidth: 640 }}>
        <div className="card" style={{ textAlign: 'center', padding: '40px 24px', marginTop: 20 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: '50%',
              background: 'rgba(239, 68, 68, 0.1)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 16
            }}
          >
            <Lock size={26} color="#ef4444" />
          </div>

          <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>
            Organizer Access Required
          </h2>
          <p style={{ color: 'var(--text-sub)', fontSize: 14, maxWidth: 440, margin: '0 auto 24px' }}>
            The Organizer Console provides box office operations, ticket category minting, and sales analytics. Sign in with a verified organizer account to continue.
          </p>

          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button
              className="btn-primary"
              style={{ padding: '10px 20px', fontSize: 14 }}
              onClick={() => navigate('/login')}
            >
              Sign In to Your Account
            </button>
            <button
              className="btn-secondary"
              style={{ padding: '10px 20px', fontSize: 14 }}
              onClick={() => navigate('/organizer/apply')}
            >
              Apply as Organizer
            </button>
          </div>

          <div
            style={{
              marginTop: 32,
              paddingTop: 24,
              borderTop: '1px solid var(--border-subtle)',
              fontSize: 13,
              color: 'var(--text-muted)'
            }}
          >
            <p style={{ marginBottom: 12 }}>Test with a verified organizer account:</p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
              <button
                className="btn-secondary"
                style={{ fontSize: 12, padding: '6px 14px' }}
                onClick={() => login('ali@passflow.com', 'Password123!')}
              >
                <Sparkles size={13} color="var(--accent-orange)" />
                <span>Sign In as Ali (Ali Productions)</span>
              </button>
              <button
                className="btn-secondary"
                style={{ fontSize: 12, padding: '6px 14px' }}
                onClick={() => login('organizer@livenation.com', 'Password123!')}
              >
                <Building size={13} color="var(--accent-emerald)" />
                <span>Sign In as Live Nation India</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // 2. Guard: Authenticated but Not an Organizer
  const isOrganizerOrAdmin =
    currentRole === 'ADMIN' ||
    currentUser?.role === 'ADMIN' ||
    currentUser?.role === 'ORGANIZER' ||
    currentUser?.organizer != null;

  if (!isOrganizerOrAdmin && !isLoading) {
    return (
      <div className="content-wrap" style={{ maxWidth: 640 }}>
        <div className="card" style={{ textAlign: 'center', padding: '40px 24px', marginTop: 20 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: '50%',
              background: 'var(--accent-orange-subtle)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 16
            }}
          >
            <Building size={26} color="var(--accent-orange)" />
          </div>

          <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>
            Become an Organizer
          </h2>
          <p style={{ color: 'var(--text-sub)', fontSize: 14, maxWidth: 440, margin: '0 auto 24px' }}>
            Your account ({currentUser.email}) currently does not have an approved organizer profile. Submit an application to unlock the Organizer Console and publish live events.
          </p>

          <button
            className="btn-primary"
            style={{ padding: '10px 24px', fontSize: 14 }}
            onClick={() => navigate('/organizer/apply')}
          >
            <span>Apply for Organizer Status</span>
            <ArrowRight size={14} />
          </button>
        </div>
      </div>
    );
  }

  const organizationName =
    organizerProfile?.organizationName ||
    currentUser?.organizer?.organizationName ||
    (currentUser?.role === 'ADMIN' ? 'PassFlow Global Events (Admin)' : `${currentUser?.name || 'My'} Productions`);

  return (
    <div className="content-wrap">
      {/* Top Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, flexWrap: 'wrap', gap: 14 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h1 style={{ fontSize: 26, fontWeight: 700, margin: 0 }}>Organizer Operations</h1>
            <span className="badge badge-orange font-mono">ORGANIZER CONSOLE</span>
            <span className="badge badge-green font-mono" style={{ fontSize: 11 }}>
              <ShieldCheck size={12} style={{ display: 'inline', marginRight: 4 }} />
              VERIFIED
            </span>
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4 }}>
            Organization: <strong style={{ color: 'var(--text-main)' }}>{organizationName}</strong> · Manage ticket inventories, mint new category tiers, and publish events
          </p>
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button
            className="btn-secondary"
            disabled={isRefreshing}
            onClick={() => {
              setIsRefreshing(true);
              loadOrganizerData(true);
            }}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <RefreshCw size={14} className={isRefreshing ? 'spin' : ''} />
            <span>{isRefreshing ? 'Syncing...' : 'Sync Data'}</span>
          </button>

          <button
            className="btn-primary"
            onClick={() => navigate('/organizer/events/new')}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <Plus size={16} />
            <span>Create Event</span>
          </button>
        </div>
      </div>

      {/* Aggregate KPI Metrics Cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
          gap: 16,
          marginBottom: 24
        }}
      >
        {/* Metric 1: Total Events */}
        <div className="card" style={{ padding: 18 }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6, fontWeight: 500 }}>
            PRODUCED EVENTS
          </div>
          <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--text-main)', fontFamily: 'monospace' }}>
            {totalProduced}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>
            {activeEventsCount} Active on Marketplace
          </div>
        </div>

        {/* Metric 2: Live Marketplace Status */}
        <div className="card" style={{ padding: 18 }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6, fontWeight: 500 }}>
            ACTIVE LIVE PRODUCTIONS
          </div>
          <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--accent-emerald)', fontFamily: 'monospace' }}>
            {activeEventsCount}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>
            {totalProduced - activeEventsCount} In Draft Mode
          </div>
        </div>

        {/* Metric 3: Total Tickets Sold */}
        <div className="card" style={{ padding: 18 }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6, fontWeight: 500 }}>
            TICKETS SOLD TO DATE
          </div>
          <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--accent-orange)', fontFamily: 'monospace' }}>
            {totalTicketsSold.toLocaleString('en-IN')}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>
            Primary allocations validated
          </div>
        </div>

        {/* Metric 4: Total Box Office Revenue */}
        <div className="card" style={{ padding: 18 }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6, fontWeight: 500 }}>
            TOTAL BOX OFFICE REVENUE
          </div>
          <div style={{ fontSize: 24, fontWeight: 700, color: '#38bdf8', fontFamily: 'monospace' }}>
            ₹{totalRevenue.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>
            Direct Primary Gross Sales
          </div>
        </div>
      </div>

      {/* 1. My Events Table Card */}
      <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 24 }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>My Produced Events</h3>
          <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>Click row to inspect inventory tiers & quotas</span>
        </div>

        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Event Name</th>
                <th>Status</th>
                <th>Capacity / Sold</th>
                <th>Box Office Revenue</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={5} style={{ textAlign: 'center', padding: '32px', color: 'var(--text-dim)' }}>
                    <RefreshCw size={18} className="spin" style={{ margin: '0 auto 8px' }} />
                    <div>Loading organizer productions from database...</div>
                  </td>
                </tr>
              ) : organizerEvents.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-sub)' }}>
                    <p style={{ margin: '0 0 12px 0', fontSize: 14 }}>No events created yet under your organizer profile.</p>
                    <button
                      className="btn-primary"
                      onClick={() => navigate('/organizer/events/new')}
                    >
                      <Plus size={14} />
                      <span>Create Your First Event</span>
                    </button>
                  </td>
                </tr>
              ) : (
                organizerEvents.map((ev) => {
                  const isSelected = ev.id === selectedEventId;
                  const totalSold = (ev.tiers || []).reduce(
                    (acc, t) => acc + Math.max(0, (t.total || 0) - (t.left || 0)),
                    0
                  );
                  const totalCapacity = (ev.tiers || []).reduce((acc, t) => acc + (t.total || 0), 0);
                  const revenue = (ev.tiers || []).reduce((acc, t) => {
                    const sold = Math.max(0, (t.total || 0) - (t.left || 0));
                    return acc + sold * (t.price || 0);
                  }, 0);

                  const isPublishingThis = isPublishingId === ev.id;

                  return (
                    <tr
                      key={ev.id}
                      style={{
                        cursor: 'pointer',
                        background: isSelected ? 'rgba(249, 115, 22, 0.07)' : undefined
                      }}
                      onClick={() => setSelectedEventId(ev.id)}
                    >
                      <td>
                        <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-main)' }}>{ev.title}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>
                          {ev.fullDate} · {ev.venue}
                        </div>
                      </td>
                      <td>
                        <span className={`badge ${ev.status === 'PUBLISHED' ? 'badge-green' : 'badge-orange'}`}>
                          {ev.status}
                        </span>
                      </td>
                      <td className="font-mono">
                        {ev.status === 'DRAFT' && totalSold === 0 ? (
                          <span style={{ color: 'var(--text-dim)' }}>{totalCapacity} total (Draft)</span>
                        ) : (
                          <span>
                            <strong>{totalSold}</strong> / {totalCapacity}
                          </span>
                        )}
                      </td>
                      <td className="font-mono" style={{ color: 'var(--accent-emerald)', fontWeight: 600 }}>
                        ₹{revenue.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button
                            className="btn-secondary"
                            style={{ padding: '4px 8px', fontSize: 11 }}
                            onClick={(e) => {
                              e.stopPropagation();
                              navigate(`/events/${ev.id}`);
                            }}
                          >
                            <Eye size={12} />
                            <span>View</span>
                          </button>

                          {ev.status === 'DRAFT' && (
                            <button
                              className="btn-primary"
                              disabled={isPublishingThis}
                              style={{ padding: '4px 10px', fontSize: 11 }}
                              onClick={(e) => handlePublish(ev.id, e)}
                            >
                              {isPublishingThis ? (
                                <RefreshCw size={11} className="spin" />
                              ) : (
                                <span>Publish</span>
                              )}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
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
                <h3 style={{ fontSize: 17, fontWeight: 600, margin: 0 }}>Inventory: {selectedEvent.title}</h3>
                <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                  Live quota allocations, available face stock, and open escrow
                </p>
              </div>
              <span className={`badge ${selectedEvent.status === 'PUBLISHED' ? 'badge-green' : 'badge-orange'}`}>
                {selectedEvent.status}
              </span>
            </div>

            {/* Inventory Tiers List */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
              {(selectedEvent.tiers || []).length === 0 ? (
                <div
                  style={{
                    background: 'var(--bg-app)',
                    padding: 18,
                    borderRadius: 'var(--radius-sm)',
                    textAlign: 'center',
                    color: 'var(--text-dim)',
                    fontSize: 13
                  }}
                >
                  No category tiers configured yet. Add your first tier below.
                </div>
              ) : (
                selectedEvent.tiers.map((tier) => {
                  const sold = Math.max(0, (tier.total || 0) - (tier.left || 0));
                  const pctSold = tier.total > 0 ? Math.round((sold / tier.total) * 100) : 0;

                  return (
                    <div
                      key={tier.id}
                      style={{
                        background: 'var(--bg-app)',
                        padding: 14,
                        borderRadius: 'var(--radius-md)',
                        border: '1px solid var(--border-subtle)',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        flexWrap: 'wrap',
                        gap: 12
                      }}
                    >
                      <div>
                        <strong style={{ fontSize: 14, color: 'var(--text-main)' }}>{tier.name}</strong>
                        <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 2 }}>
                          Face price: <span className="font-mono">₹{tier.price}</span> · Resale cap: <span className="font-mono" style={{ color: 'var(--accent-orange)' }}>₹{tier.cap || tier.price * 2}</span>
                        </div>
                      </div>

                      <div style={{ textAlign: 'right' }}>
                        <div className="font-mono" style={{ fontSize: 13, fontWeight: 600 }}>
                          <span style={{ color: 'var(--accent-emerald)' }}>{tier.left} avail</span>,{' '}
                          <span style={{ color: 'var(--text-muted)' }}>{sold} sold</span>
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>
                          Quota: {tier.total} tickets ({pctSold}% allocated)
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Add Ticket Category Form */}
            <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 16 }}>
              <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Plus size={14} color="var(--accent-orange)" />
                <span>Mint New Category Tier</span>
              </h4>

              <form onSubmit={handleSaveTier}>
                <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr', gap: 10, marginBottom: 12 }}>
                  <input
                    type="text"
                    required
                    placeholder="Tier Name (e.g. Balcony)"
                    value={tierName}
                    onChange={(e) => setTierName(e.target.value)}
                    disabled={isAddingTier}
                  />
                  <input
                    type="number"
                    step="1"
                    min="1"
                    required
                    placeholder="Price (₹)"
                    value={tierPrice}
                    onChange={(e) => setTierPrice(e.target.value)}
                    disabled={isAddingTier}
                  />
                  <input
                    type="number"
                    min="1"
                    required
                    placeholder="Quantity"
                    value={tierQty}
                    onChange={(e) => setTierQty(e.target.value)}
                    disabled={isAddingTier}
                  />
                </div>

                <button
                  type="submit"
                  disabled={isAddingTier}
                  className="btn-secondary"
                  style={{ width: '100%', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                >
                  {isAddingTier ? (
                    <>
                      <RefreshCw size={14} className="spin" />
                      <span>Minting Tier on Database...</span>
                    </>
                  ) : (
                    <>
                      <Plus size={14} />
                      <span>Save Category Tier</span>
                    </>
                  )}
                </button>
              </form>
            </div>
          </div>

          {/* Right: Publish Checklist & Event Analytics */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div className="card">
              <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Publish Checklist</h3>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>
                Prerequisites required before event is discoverable on public `/events` directory:
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <CheckCircle2 size={18} color="#10b981" />
                  <span style={{ fontSize: 13 }}>Details complete (Title, venue, performance time)</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <CheckCircle2
                    size={18}
                    color={(selectedEvent.tiers || []).length > 0 ? '#10b981' : 'var(--text-dim)'}
                  />
                  <span style={{ fontSize: 13 }}>
                    {(selectedEvent.tiers || []).length > 0
                      ? `At least one category minted (${selectedEvent.tiers.length} active)`
                      : 'At least one ticket category minted (Required)'}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <CheckCircle2 size={18} color="#10b981" />
                  <span style={{ fontSize: 13 }}>Face price and anti-scalping 2x resale caps active</span>
                </div>
              </div>

              {selectedEvent.status === 'DRAFT' ? (
                <button
                  className="btn-primary"
                  style={{ width: '100%', padding: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
                  disabled={isPublishingId === selectedEvent.id || (selectedEvent.tiers || []).length === 0}
                  onClick={() => handlePublish(selectedEvent.id)}
                >
                  {isPublishingId === selectedEvent.id ? (
                    <>
                      <RefreshCw size={15} className="spin" />
                      <span>Publishing Event Live...</span>
                    </>
                  ) : (
                    <span>Publish Event Live to Marketplace</span>
                  )}
                </button>
              ) : (
                <div
                  style={{
                    background: 'rgba(16, 185, 129, 0.08)',
                    border: '1px solid var(--accent-emerald-border)',
                    padding: 14,
                    borderRadius: 'var(--radius-sm)',
                    textAlign: 'center',
                    color: 'var(--accent-emerald)',
                    fontSize: 13,
                    fontWeight: 600,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8
                  }}
                >
                  <CheckCircle2 size={16} />
                  <span>Event is Live & Discoverable on Public Exchange</span>
                </div>
              )}
            </div>

            {/* Quick Box Office Metric */}
            <div className="card">
              <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                <TrendingUp size={15} color="var(--accent-orange)" />
                <span>Primary Sales Payout Schedule</span>
              </h4>
              <p style={{ fontSize: 12, color: 'var(--text-sub)', lineHeight: 1.6, margin: 0 }}>
                Primary revenues are settled to your linked organizer account within 24 hours of gate validation. Anti-scalping caps protect your fans from secondary price gouging.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
