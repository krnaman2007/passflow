import React, { useState, useEffect, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import {
  Ticket,
  Tag,
  Send,
  History,
  QrCode,
  AlertCircle,
  CheckCircle,
  ExternalLink,
  XCircle,
  ArrowRight,
  RefreshCw,
  Sparkles,
  Lock,
  Calendar,
  MapPin,
  Clock,
  ShieldCheck,
  Share2
} from 'lucide-react';
import { api } from '../services/api';
import { TicketCardSkeleton, DashboardSkeleton } from '../components/Skeleton';

export default function TicketsPage() {
  const {
    userTickets,
    cancelTicketListing,
    setActiveModal,
    navigate,
    currentRole,
    currentUser,
    authLoading,
    login,
    showToast,
    fetchLiveTickets
  } = useApp();

  const [statusFilter, setStatusFilter] = useState('ALL');
  const [selectedTicketId, setSelectedTicketId] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [ownershipHistory, setOwnershipHistory] = useState(null);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Load tickets on mount
  const loadTickets = useCallback(async (isManualRefresh = false) => {
    if (isManualRefresh) setIsRefreshing(true);
    try {
      if (fetchLiveTickets) {
        await fetchLiveTickets();
      }
      if (isManualRefresh) {
        showToast('Tickets updated', 'info');
      }
    } catch (err) {
      console.warn('Could not sync tickets:', err.message);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [fetchLiveTickets, showToast]);

  useEffect(() => {
    loadTickets();
  }, [loadTickets]);

  // Keep selection valid
  useEffect(() => {
    if (userTickets.length > 0) {
      setSelectedTicketId((prev) => (prev && userTickets.some((t) => t.id === prev) ? prev : userTickets[0].id));
    } else {
      setSelectedTicketId(null);
    }
  }, [userTickets]);

  const selectedTicket = userTickets.find((t) => t.id === selectedTicketId) || userTickets[0];

  // Fetch real ownership chain from backend whenever selected ticket changes
  useEffect(() => {
    let isCurrent = true;
    if (!selectedTicket?.id) {
      setOwnershipHistory(null);
      return;
    }

    async function loadOwnership() {
      setLoadingHistory(true);
      try {
        const res = await api.tickets.getTicketOwnership(selectedTicket.id);
        const data = res?.data || res;
        if (isCurrent && data?.history) {
          setOwnershipHistory(data.history);
        }
      } catch (err) {
        console.warn('Could not fetch ticket ownership history:', err.message);
        if (isCurrent) setOwnershipHistory(null);
      } finally {
        if (isCurrent) setLoadingHistory(false);
      }
    }

    loadOwnership();
    return () => {
      isCurrent = false;
    };
  }, [selectedTicket?.id]);

  const handleSelectTicket = (id) => {
    if (typeof document !== 'undefined' && document.startViewTransition) {
      const transition = document.startViewTransition(() => {
        setSelectedTicketId(id);
      });
      if (transition?.finished) {
        transition.finished.catch(() => {});
      }
    } else {
      setSelectedTicketId(id);
    }
  };

  // Filtered tickets list
  const filteredTickets = userTickets.filter((ticket) => {
    if (statusFilter === 'ALL') return true;
    return ticket.status === statusFilter;
  });

  // 1. Session Restoring Guard
  if (authLoading && !currentUser) {
    return (
      <div className="content-wrap" style={{ maxWidth: 1200, padding: '32px 20px' }}>
        <DashboardSkeleton count={3} />
      </div>
    );
  }

  // 2. Guard: Visitor / Unauthenticated
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
            Authentication Required
          </h2>
          <p style={{ color: 'var(--text-sub)', fontSize: 14, maxWidth: 440, margin: '0 auto 24px' }}>
            Your cryptographic ticket vault stores authenticated digital event passes, provenance custody records, and secondary market resale rights.
          </p>

          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button
              className="btn-primary"
              style={{ padding: '10px 20px', fontSize: 14 }}
              onClick={() => navigate('/login')}
            >
              Sign In to Access Vault
            </button>
            <button
              className="btn-secondary"
              style={{ padding: '10px 20px', fontSize: 14 }}
              onClick={() => navigate('/register')}
            >
              Create Account
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
            <p style={{ marginBottom: 12 }}>Explore with a demo account holding real tickets:</p>
            <button
              className="btn-secondary"
              style={{ fontSize: 12, padding: '6px 14px' }}
              onClick={() => login('ali@passflow.com', 'Password123!')}
            >
              <Sparkles size={13} color="var(--accent-orange)" />
              <span>1-Click Sign In as Ali Khan (4 Tickets in Vault)</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="content-wrap">
      {/* Top Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, flexWrap: 'wrap', gap: 14 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0 }}>My Tickets Vault</h1>
            <span className="badge badge-orange font-mono" style={{ fontSize: 11 }}>
              {userTickets.length} PASSES OWNED
            </span>
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4 }}>
            Authenticated event passes with cryptographic provenance, secondary resale caps, and peer-to-peer transfers
          </p>
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button
            className="btn-secondary"
            disabled={isRefreshing || isLoading}
            onClick={() => loadTickets(true)}
            style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}
          >
            <RefreshCw size={14} className={isRefreshing ? 'spin' : ''} />
            <span>{isRefreshing ? 'Syncing...' : 'Sync Vault'}</span>
          </button>

          <button
            className="btn-primary"
            onClick={() => navigate('/events')}
            style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}
          >
            <span>Browse More Events</span>
            <ArrowRight size={14} />
          </button>
        </div>
      </div>

      {/* Vault Portfolio Metrics */}
      <div className="grid-3" style={{ marginBottom: 24 }}>
        <div className="stat-card-glow card-accent-top">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Vault Holdings
            </span>
            <Ticket size={15} color="var(--accent-orange)" />
          </div>
          <div className="font-mono" style={{ fontSize: 26, fontWeight: 700, color: 'var(--text-main)' }}>
            {userTickets.length} <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-dim)' }}>Passes</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>
            {userTickets.filter((t) => t.status === 'OWNED').length} in active custody · {userTickets.filter((t) => t.status === 'LISTED').length} on order book
          </div>
        </div>

        <div className="stat-card-glow">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Listed for Resale
            </span>
            <Tag size={15} color="var(--accent-orange)" />
          </div>
          <div className="font-mono" style={{ fontSize: 26, fontWeight: 700, color: 'var(--accent-orange)' }}>
            {userTickets.filter((t) => t.status === 'LISTED').length} <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-dim)' }}>Active Asks</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>
            Listed with fair-price cap protection
          </div>
        </div>

        <div className="stat-card-glow card-accent-emerald">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--accent-emerald)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Vault Estimated Value
            </span>
            <ShieldCheck size={15} color="var(--accent-emerald)" />
          </div>
          <div className="font-mono" style={{ fontSize: 26, fontWeight: 700, color: 'var(--accent-emerald)' }}>
            ₹{userTickets.reduce((sum, t) => sum + Number(t.currentPrice ?? t.purchasePrice ?? t.faceValue ?? 0), 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>
            100% verified custody & non-fungible provenance
          </div>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="scrollable-tabs-bar" style={{ marginBottom: 20 }}>
        {[
          { id: 'ALL', label: `All Tickets (${userTickets.length})` },
          { id: 'OWNED', label: `Owned (${userTickets.filter((t) => t.status === 'OWNED').length})` },
          { id: 'LISTED', label: `Listed for Resale (${userTickets.filter((t) => t.status === 'LISTED').length})` },
          { id: 'TRANSFERRED', label: `Transferred (${userTickets.filter((t) => t.status === 'TRANSFERRED' || t.status === 'TRANSFER_PENDING').length})` },
          { id: 'USED', label: `Redeemed / Used (${userTickets.filter((t) => t.status === 'USED').length})` },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setStatusFilter(tab.id)}
            className={`btn-secondary ${statusFilter === tab.id ? 'active' : ''}`}
            style={{
              padding: '6px 14px',
              fontSize: 12,
              borderRadius: 'var(--radius-sm)',
              background: statusFilter === tab.id ? 'var(--accent-orange)' : undefined,
              color: statusFilter === tab.id ? '#fff' : undefined,
              borderColor: statusFilter === tab.id ? 'var(--accent-orange)' : undefined
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Main Grid: Ticket Cards on Left, Selected Ticket Inspector on Right */}
      <div className="detail-grid">
        {/* Left: Tickets Cards Grid */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {isLoading && userTickets.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <TicketCardSkeleton />
              <TicketCardSkeleton />
            </div>
          ) : filteredTickets.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: '50px 20px' }}>
              <div
                style={{
                  width: 50,
                  height: 50,
                  borderRadius: '50%',
                  background: 'var(--bg-app)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: 14
                }}
              >
                <Ticket size={24} color="var(--text-dim)" />
              </div>
              <h3 style={{ fontSize: 17, marginBottom: 6 }}>
                {statusFilter === 'ALL'
                  ? 'Your Ticket Vault is Empty'
                  : `No ${statusFilter.toLowerCase()} tickets found`}
              </h3>
              <p style={{ color: 'var(--text-sub)', fontSize: 13, maxWidth: 380, margin: '0 auto 20px' }}>
                Buy primary tickets from official organizers or place bids on the secondary exchange to start building your collection.
              </p>
              <button className="btn-primary" onClick={() => navigate('/events')}>
                <span>Browse Live Events</span>
                <ArrowRight size={14} />
              </button>
            </div>
          ) : (
            filteredTickets.map((ticket) => {
              const isSelected = ticket.id === selectedTicketId;

              return (
                <div
                  key={ticket.id}
                  className={`ticket-pass-card ${isSelected ? 'selected-ticket-card' : ''}`}
                  style={{
                    cursor: 'pointer',
                    borderColor: isSelected ? 'var(--accent-orange)' : undefined,
                    boxShadow: isSelected ? '0 0 0 1px var(--accent-orange), 0 10px 28px rgba(249, 115, 22, 0.16)' : undefined,
                    transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)'
                  }}
                  onClick={() => handleSelectTicket(ticket.id)}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <span className="font-mono" style={{ fontSize: 11, color: 'var(--text-dim)', background: 'var(--bg-card-subtle)', padding: '2px 6px', borderRadius: 4 }}>
                          #{ticket.id.slice(0, 10).toUpperCase()}
                        </span>
                        <span className="badge badge-orange font-mono" style={{ fontSize: 10, padding: '2px 6px' }}>
                          {ticket.tier}
                        </span>
                      </div>
                      <h3 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 6px 0', color: 'var(--text-main)', letterSpacing: '-0.01em' }}>
                        {ticket.eventName}
                      </h3>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 12, color: 'var(--text-sub)' }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <Calendar size={13} color="var(--accent-orange)" />
                          {ticket.eventDate || 'Upcoming'}
                        </span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <MapPin size={13} color="var(--text-dim)" />
                          {ticket.venue || 'Live Venue'}
                        </span>
                      </div>
                    </div>

                    <div>
                      {ticket.status === 'OWNED' && (
                        <span className="badge badge-green font-mono">OWNED</span>
                      )}
                      {ticket.status === 'LISTED' && (
                        <span className="badge badge-orange font-mono">
                          LISTED AT ₹{Number(ticket.listedPrice || ticket.currentPrice || ticket.faceValue).toLocaleString('en-IN')}
                        </span>
                      )}
                      {(ticket.status === 'TRANSFERRED' || ticket.status === 'TRANSFER_PENDING') && (
                        <span className="badge badge-blue font-mono">TRANSFERRED</span>
                      )}
                      {ticket.status === 'USED' && (
                        <span className="badge badge-neutral font-mono">REDEEMED</span>
                      )}
                    </div>
                  </div>

                  {/* Perforated divider with circular notches */}
                  <div className="ticket-divider-strip">
                    <div className="ticket-notch-left" />
                    <div className="ticket-notch-right" />
                  </div>

                  {/* Ticket Stub Footer */}
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                      gap: 10
                    }}
                  >
                    <div>
                      <div style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        Face / Purchase Price
                      </div>
                      <div className="font-mono" style={{ color: 'var(--accent-emerald)', fontSize: 15, fontWeight: 700 }}>
                        ₹{Number(ticket.currentPrice ?? ticket.purchasePrice ?? ticket.faceValue).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: 8 }}>
                      {ticket.status === 'OWNED' && (
                        <>
                          <button
                            className="btn-primary"
                            style={{ padding: '6px 12px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveModal({ type: 'SELL_TICKET', data: ticket });
                            }}
                          >
                            <Tag size={13} />
                            <span>List Resale</span>
                          </button>

                          <button
                            className="btn-secondary"
                            style={{ padding: '6px 10px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveModal({ type: 'TRANSFER_TICKET', data: ticket });
                            }}
                          >
                            <Send size={13} />
                            <span>Transfer</span>
                          </button>
                        </>
                      )}

                      {ticket.status === 'LISTED' && (
                        <button
                          className="btn-danger-outline"
                          style={{ padding: '6px 10px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}
                          onClick={(e) => {
                            e.stopPropagation();
                            cancelTicketListing(ticket.id);
                          }}
                        >
                          <XCircle size={13} />
                          <span>Cancel Listing</span>
                        </button>
                      )}

                      <button
                        className="btn-secondary"
                        style={{ padding: '6px 10px', display: 'flex', alignItems: 'center', gap: 4 }}
                        title="Show Entry Pass and QR"
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveModal({ type: 'TICKET_DETAILS', data: ticket });
                        }}
                      >
                        <QrCode size={14} />
                        <span style={{ fontSize: 12 }}>QR Pass</span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Right: Ticket Inspector & Provenance History Panel */}
        {selectedTicket && (
          <div>
            <div className="card" style={{ position: 'sticky', top: 88, padding: 22 }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 16,
                  borderBottom: '1px solid var(--border-subtle)',
                  paddingBottom: 12
                }}
              >
                <div>
                  <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Ticket Inspector</h3>
                  <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, fontFamily: 'monospace' }}>
                    UUID: #{selectedTicket.id.slice(0, 18)}...
                  </p>
                </div>
                <button
                  className="btn-secondary"
                  style={{ padding: '4px 10px', fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}
                  onClick={() => setActiveModal({ type: 'TICKET_DETAILS', data: selectedTicket })}
                >
                  <QrCode size={12} />
                  <span>Entry Barcode</span>
                </button>
              </div>

              {/* Status and Valuation Breakdown */}
              <div
                style={{
                  background: 'var(--bg-app)',
                  padding: 16,
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border-subtle)',
                  marginBottom: 18
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10, fontSize: 13 }}>
                  <span style={{ color: 'var(--text-muted)' }}>Event Production:</span>
                  <strong style={{ color: 'var(--text-main)', textAlign: 'right' }}>
                    {selectedTicket.eventName}
                  </strong>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 13 }}>
                  <span style={{ color: 'var(--text-muted)' }}>Current Status:</span>
                  <strong
                    style={{
                      color:
                        selectedTicket.status === 'OWNED'
                          ? 'var(--accent-emerald)'
                          : selectedTicket.status === 'LISTED'
                          ? 'var(--accent-orange)'
                          : 'var(--accent-blue)'
                    }}
                  >
                    {selectedTicket.status}
                  </strong>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 13 }}>
                  <span style={{ color: 'var(--text-muted)' }}>Purchase Price:</span>
                  <span className="font-mono" style={{ color: 'var(--accent-emerald)', fontWeight: 700 }}>
                    ₹{Number(selectedTicket.currentPrice ?? selectedTicket.purchasePrice ?? selectedTicket.faceValue).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                  <span style={{ color: 'var(--text-muted)' }}>Anti-Scalp Resale Ceiling:</span>
                  <span className="font-mono" style={{ color: 'var(--accent-orange)', fontWeight: 600 }}>
                    Max ₹{Number(selectedTicket.resaleCap || selectedTicket.faceValue * 2).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </span>
                </div>
              </div>

              {/* Provenance Chain of Custody History */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <History size={14} color="var(--accent-emerald)" />
                    <strong style={{ fontSize: 13 }}>Chain of Custody Provenance</strong>
                  </div>
                  {loadingHistory && <RefreshCw size={12} className="spin" color="var(--text-dim)" />}
                </div>

                <div style={{ position: 'relative', paddingLeft: 18 }}>
                  <div
                    style={{
                      position: 'absolute',
                      left: 5,
                      top: 6,
                      bottom: 6,
                      width: 2,
                      background: 'var(--border-medium)'
                    }}
                  />

                  {ownershipHistory && ownershipHistory.length > 0 ? (
                    ownershipHistory.map((step, idx) => (
                      <div key={step.id || idx} style={{ position: 'relative', marginBottom: 14 }}>
                        <div
                          style={{
                            position: 'absolute',
                            left: -18,
                            top: 4,
                            width: 8,
                            height: 8,
                            borderRadius: '50%',
                            background:
                              step.source === 'PRIMARY'
                                ? 'var(--accent-orange)'
                                : step.source === 'RESALE'
                                ? 'var(--accent-emerald)'
                                : 'var(--accent-blue)'
                          }}
                        />
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span
                            className={`badge ${
                              step.source === 'PRIMARY'
                                ? 'badge-orange'
                                : step.source === 'RESALE'
                                ? 'badge-green'
                                : 'badge-blue'
                            }`}
                            style={{ fontSize: 10, padding: '1px 6px' }}
                          >
                            {step.source || 'OWNERSHIP'}
                          </span>
                          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-main)' }}>
                            {step.owner?.name || step.owner?.email || 'Authenticated Owner'}
                          </span>
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-sub)', marginTop: 2 }}>
                          {step.source === 'PRIMARY'
                            ? `Primary Mint Allocation (Face: ₹${Number(selectedTicket.faceValue).toLocaleString('en-IN')})`
                            : 'Custody Transferred'}
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 1 }}>
                          {step.acquiredAt ? new Date(step.acquiredAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : 'Verified'}
                        </div>
                      </div>
                    ))
                  ) : (
                    (selectedTicket.ownershipChain || []).map((step, idx) => (
                      <div key={idx} style={{ position: 'relative', marginBottom: 14 }}>
                        <div
                          style={{
                            position: 'absolute',
                            left: -18,
                            top: 4,
                            width: 8,
                            height: 8,
                            borderRadius: '50%',
                            background:
                              step.type === 'PRIMARY'
                                ? 'var(--accent-orange)'
                                : step.type === 'RESALE'
                                ? 'var(--accent-emerald)'
                                : 'var(--accent-blue)'
                          }}
                        />
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span
                            className={`badge ${
                              step.type === 'PRIMARY'
                                ? 'badge-orange'
                                : step.type === 'RESALE'
                                ? 'badge-green'
                                : 'badge-blue'
                            }`}
                            style={{ fontSize: 10, padding: '1px 6px' }}
                          >
                            {step.type}
                          </span>
                          <span style={{ fontSize: 12, fontWeight: 600 }}>{step.user}</span>
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-sub)', marginTop: 2 }}>{step.action}</div>
                        <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>{step.date}</div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Action Buttons for selected ticket */}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {selectedTicket.status === 'OWNED' && (
                  <>
                    <button
                      className="btn-primary"
                      style={{ flex: 1, fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                      onClick={() => setActiveModal({ type: 'SELL_TICKET', data: selectedTicket })}
                    >
                      <Tag size={13} />
                      <span>List for Resale</span>
                    </button>

                    <button
                      className="btn-secondary"
                      style={{ flex: 1, fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                      onClick={() => setActiveModal({ type: 'TRANSFER_TICKET', data: selectedTicket })}
                    >
                      <Send size={13} />
                      <span>Transfer</span>
                    </button>
                  </>
                )}

                {selectedTicket.status === 'LISTED' && (
                  <button
                    className="btn-danger-outline"
                    style={{ width: '100%', padding: '10px', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                    onClick={() => cancelTicketListing(selectedTicket.id)}
                  >
                    <XCircle size={14} />
                    <span>Cancel Resale Listing</span>
                  </button>
                )}

                {(selectedTicket.status === 'TRANSFERRED' || selectedTicket.status === 'TRANSFER_PENDING') && (
                  <div
                    style={{
                      width: '100%',
                      background: 'rgba(59, 130, 246, 0.08)',
                      border: '1px solid rgba(59, 130, 246, 0.25)',
                      padding: 10,
                      borderRadius: 'var(--radius-sm)',
                      textAlign: 'center',
                      color: 'var(--accent-blue)',
                      fontSize: 12
                    }}
                  >
                    Ticket Transferred Peer-to-Peer
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
