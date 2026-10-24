import React, { useState } from 'react';
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
  ArrowRight
} from 'lucide-react';

export default function TicketsPage() {
  const {
    userTickets,
    cancelTicketListing,
    setActiveModal,
    navigate,
    currentRole
  } = useApp();

  const [selectedTicketId, setSelectedTicketId] = useState(userTickets[0]?.id || 'TK-20931');
  const selectedTicket = userTickets.find((t) => t.id === selectedTicketId) || userTickets[0];

  const handleSelectTicket = (id) => {
    if (typeof document !== 'undefined' && document.startViewTransition) {
      document.startViewTransition(() => {
        setSelectedTicketId(id);
      });
    } else {
      setSelectedTicketId(id);
    }
  };

  return (
    <div className="content-wrap">
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 28, margin: 0 }}>My Tickets Vault</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4 }}>
            Authenticated event passes with cryptographic provenance, resale, and transfer controls
          </p>
        </div>

        <button className="btn-secondary" onClick={() => navigate('/events')}>
          <span>Browse More Events</span>
          <ArrowRight size={14} />
        </button>
      </div>

      {/* Main Grid: Ticket Cards on Left, Selected Ticket Inspector on Right */}
      <div className="detail-grid">
        {/* Left: Tickets Cards Grid */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {userTickets.map((ticket) => {
            const isSelected = ticket.id === selectedTicketId;

            return (
              <div
                key={ticket.id}
                className={`card ${isSelected ? 'selected-ticket-card' : ''}`}
                style={{
                  cursor: 'pointer',
                  borderColor: isSelected ? 'var(--accent-orange)' : undefined,
                  background: isSelected ? 'var(--bg-card)' : undefined
                }}
                onClick={() => handleSelectTicket(ticket.id)}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                  <div>
                    <h3 style={{ fontSize: 17, marginBottom: 2 }}>{ticket.eventName}</h3>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {ticket.tier} Admission · <span className="font-mono" style={{ color: 'var(--text-sub)' }}>#{ticket.id}</span>
                    </div>
                  </div>

                  <div>
                    {ticket.status === 'OWNED' && (
                      <span className="badge badge-green">OWNED</span>
                    )}
                    {ticket.status === 'LISTED' && (
                      <span className="badge badge-orange font-mono">LISTED AT ${ticket.listedPrice || 140}</span>
                    )}
                    {ticket.status === 'TRANSFER_PENDING' && (
                      <span className="badge badge-blue">TRANSFER PENDING</span>
                    )}
                    {ticket.status === 'USED' && (
                      <span className="badge badge-neutral">USED / REDEEMED</span>
                    )}
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, borderTop: '1px solid var(--border-subtle)', paddingTop: 12 }}>
                  <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                    Original face: <strong className="font-mono" style={{ color: 'var(--text-main)' }}>${ticket.faceValue}</strong>
                  </div>

                  <div style={{ display: 'flex', gap: 8 }}>
                    {ticket.status === 'OWNED' && (
                      <>
                        <button
                          className="btn-primary"
                          style={{ padding: '5px 12px', fontSize: 12 }}
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveModal({ type: 'SELL_TICKET', data: ticket });
                          }}
                        >
                          <Tag size={13} />
                          <span>Sell on market</span>
                        </button>

                        <button
                          className="btn-secondary"
                          style={{ padding: '5px 10px', fontSize: 12 }}
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
                        onClick={(e) => {
                          e.stopPropagation();
                          cancelTicketListing(ticket.id);
                        }}
                      >
                        <XCircle size={13} />
                        <span>Cancel listing</span>
                      </button>
                    )}

                    {ticket.status === 'TRANSFER_PENDING' && (
                      <button
                        className="btn-secondary"
                        style={{ padding: '5px 10px', fontSize: 12 }}
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveModal({ type: 'TRANSFER_TICKET', data: ticket });
                        }}
                      >
                        <span>View transfer</span>
                      </button>
                    )}

                    {ticket.status === 'USED' && (
                      <button
                        className="btn-secondary"
                        style={{ padding: '5px 10px', fontSize: 12 }}
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveModal({ type: 'TICKET_DETAILS', data: ticket });
                        }}
                      >
                        <QrCode size={13} />
                        <span>Details & QR</span>
                      </button>
                    )}

                    <button
                      className="btn-secondary"
                      style={{ padding: '5px 8px' }}
                      title="View entry barcode"
                      onClick={(e) => {
                        e.stopPropagation();
                        setActiveModal({ type: 'TICKET_DETAILS', data: ticket });
                      }}
                    >
                      <QrCode size={14} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Right: Ticket Inspector & Provenance History Panel */}
        {selectedTicket && (
          <div>
            <div className="card" style={{ position: 'sticky', top: 88 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, borderBottom: '1px solid var(--border-subtle)', paddingBottom: 12 }}>
                <div>
                  <h3 style={{ fontSize: 16 }}>Ticket Inspector</h3>
                  <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    #{selectedTicket.id} · {selectedTicket.eventName}
                  </p>
                </div>
                <button
                  className="btn-secondary"
                  style={{ padding: '4px 8px', fontSize: 11 }}
                  onClick={() => setActiveModal({ type: 'TICKET_DETAILS', data: selectedTicket })}
                >
                  <QrCode size={12} />
                  <span>Show QR Pass</span>
                </button>
              </div>

              {/* Status and Action Buttons */}
              <div style={{ background: 'var(--bg-app)', padding: 14, borderRadius: 'var(--radius-md)', marginBottom: 18 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 13 }}>
                  <span style={{ color: 'var(--text-muted)' }}>Current Status:</span>
                  <strong style={{ color: selectedTicket.status === 'OWNED' ? 'var(--accent-emerald)' : 'var(--accent-orange)' }}>
                    {selectedTicket.status}
                  </strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 13 }}>
                  <span style={{ color: 'var(--text-muted)' }}>Face Value:</span>
                  <span className="font-mono">${selectedTicket.faceValue.toFixed(2)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                  <span style={{ color: 'var(--text-muted)' }}>Anti-Scalping Resale Cap:</span>
                  <span className="font-mono" style={{ color: 'var(--accent-orange)', fontWeight: 600 }}>
                    Max ${selectedTicket.resaleCap.toFixed(2)}
                  </span>
                </div>
              </div>

              {/* Provenance Chain History */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
                  <History size={14} color="var(--accent-emerald)" />
                  <strong style={{ fontSize: 13 }}>#{selectedTicket.id} Provenance & Chain of Custody</strong>
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
                  {selectedTicket.ownershipChain.map((step, idx) => (
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
                  ))}
                </div>
              </div>

              {/* Action Buttons for selected ticket */}
              <div style={{ display: 'flex', gap: 8 }}>
                {selectedTicket.status === 'OWNED' && (
                  <>
                    <button
                      className="btn-primary"
                      style={{ flex: 1, fontSize: 13 }}
                      onClick={() => setActiveModal({ type: 'SELL_TICKET', data: selectedTicket })}
                    >
                      <Tag size={13} />
                      <span>List on Market</span>
                    </button>
                    <button
                      className="btn-secondary"
                      style={{ flex: 1, fontSize: 13 }}
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
                    style={{ width: '100%', padding: '10px' }}
                    onClick={() => cancelTicketListing(selectedTicket.id)}
                  >
                    Cancel Resale Listing
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
