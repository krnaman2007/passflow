import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import {
  X,
  QrCode,
  Tag,
  Send,
  History,
  Activity,
  AlertTriangle,
  CheckCircle,
  ExternalLink,
  ShieldCheck,
  RotateCcw
} from 'lucide-react';

export default function Modals() {
  const {
    activeModal,
    setActiveModal,
    listTicketForSale,
    transferTicket,
    retrySettlement,
    adminData
  } = useApp();

  const [askPrice, setAskPrice] = useState(
    activeModal?.data?.resaleFrom || activeModal?.data?.pricePaid || '52.00'
  );
  const [recipient, setRecipient] = useState('ravi@example.com');
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!activeModal) return null;

  const { type, data } = activeModal;

  const handleClose = () => setActiveModal(null);

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        {/* Modal Close Button */}
        <button
          onClick={handleClose}
          style={{
            position: 'absolute',
            top: 20,
            right: 20,
            color: 'var(--text-dim)',
            padding: 4
          }}
        >
          <X size={18} />
        </button>

        {/* 1. SELL TICKET MODAL */}
        {type === 'SELL_TICKET' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--accent-orange-subtle)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                <Tag size={18} color="#f97316" />
              </div>
              <div>
                <h3 style={{ fontSize: 17 }}>Sell Ticket on Live Market</h3>
                <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {data.eventName} · {data.tier} (#{data.id})
                </p>
              </div>
            </div>

            <div style={{ background: 'var(--bg-card)', padding: 16, borderRadius: 'var(--radius-md)', marginBottom: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 13 }}>
                <span style={{ color: 'var(--text-muted)' }}>Original purchase price:</span>
                <span className="font-mono">₹{Number(data.faceValue || data.pricePaid || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 13 }}>
                <span style={{ color: 'var(--text-muted)' }}>Fair-price anti-scalping cap:</span>
                <span className="font-mono" style={{ color: 'var(--accent-orange)', fontWeight: 600 }}>
                  ₹{Number(data.resaleCap || (Number(data.faceValue || data.pricePaid || 0) * 2)).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                <span style={{ color: 'var(--text-muted)' }}>Estimated payout (after 2% fee):</span>
                <span className="font-mono" style={{ color: 'var(--accent-emerald)', fontWeight: 600 }}>
                  ₹{(parseFloat(askPrice || 0) * 0.98).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </span>
              </div>
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', fontSize: 12, color: 'var(--text-sub)', marginBottom: 6, fontWeight: 500 }}>
                Ask Price (₹)
              </label>
              <input
                type="number"
                step="1"
                max={data.resaleCap || ((data.faceValue || data.pricePaid || 0) * 2)}
                value={askPrice}
                onChange={(e) => setAskPrice(e.target.value)}
                style={{ width: '100%', fontSize: 16, fontWeight: 600 }}
              />
              <p style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 6 }}>
                Anti-scalping rule: Cannot exceed ₹{data.resaleCap || ((data.faceValue || data.pricePaid || 0) * 2)} for {data.tier}.
              </p>
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn-secondary" style={{ flex: 1 }} onClick={handleClose}>
                Cancel
              </button>
              <button
                className="btn-primary"
                style={{ flex: 2 }}
                onClick={() => {
                  listTicketForSale(data.id, parseFloat(askPrice));
                }}
              >
                List for Resale
              </button>
            </div>
          </div>
        )}

        {/* 2. TRANSFER TICKET MODAL */}
        {type === 'TRANSFER_TICKET' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--accent-blue-subtle)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                <Send size={18} color="#3b82f6" />
              </div>
              <div>
                <h3 style={{ fontSize: 17 }}>Direct Ticket Transfer</h3>
                <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {data.eventName} · {data.tier} (#{data.id})
                </p>
              </div>
            </div>

            <p style={{ fontSize: 13, color: 'var(--text-sub)', marginBottom: 16 }}>
              Send this ticket directly to a friend without payment. Once transferred, your ticket barcode will be invalidated and re-issued to the recipient.
            </p>

            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', fontSize: 12, color: 'var(--text-sub)', marginBottom: 6, fontWeight: 500 }}>
                Recipient Email or PassFlow Username
              </label>
              <input
                type="email"
                placeholder="friend@example.com"
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                style={{ width: '100%', fontSize: 14 }}
              />
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn-secondary" style={{ flex: 1 }} onClick={handleClose}>
                Cancel
              </button>
              <button
                className="btn-primary"
                style={{ flex: 2 }}
                onClick={() => {
                  transferTicket(data.id, recipient);
                }}
              >
                Send Directly
              </button>
            </div>
          </div>
        )}

        {/* 3. OWNERSHIP HISTORY MODAL */}
        {type === 'OWNERSHIP_HISTORY' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 'var(--radius-sm)',
                  background: 'rgba(16, 185, 129, 0.12)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                <History size={18} color="#10b981" />
              </div>
              <div>
                <h3 style={{ fontSize: 17 }}>#{data.id} Ownership History</h3>
                <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  Cryptographically verified chain of custody
                </p>
              </div>
            </div>

            <div style={{ position: 'relative', paddingLeft: 20, margin: '20px 0' }}>
              <div
                style={{
                  position: 'absolute',
                  left: 6,
                  top: 8,
                  bottom: 8,
                  width: 2,
                  background: 'var(--border-medium)'
                }}
              />
              {data.ownershipChain.map((step, idx) => (
                <div key={idx} style={{ position: 'relative', marginBottom: 20 }}>
                  <div
                    style={{
                      position: 'absolute',
                      left: -20,
                      top: 4,
                      width: 10,
                      height: 10,
                      borderRadius: '50%',
                      background:
                        step.type === 'PRIMARY'
                          ? 'var(--accent-orange)'
                          : step.type === 'RESALE'
                          ? 'var(--accent-emerald)'
                          : 'var(--accent-blue)',
                      boxShadow: '0 0 6px currentColor'
                    }}
                  />
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                    <span
                      className={`badge ${
                        step.type === 'PRIMARY'
                          ? 'badge-orange'
                          : step.type === 'RESALE'
                          ? 'badge-green'
                          : 'badge-blue'
                      }`}
                    >
                      {step.type}
                    </span>
                    <strong style={{ fontSize: 13 }}>{step.user}</strong>
                    <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{step.date}</span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-sub)' }}>{step.action}</div>
                </div>
              ))}
            </div>

            <div
              style={{
                background: 'var(--bg-card)',
                padding: 12,
                borderRadius: 'var(--radius-sm)',
                fontSize: 11,
                color: 'var(--text-dim)',
                fontFamily: 'var(--font-mono)'
              }}
            >
              Hash: 0x7e8f1920bcf47a19c55d0124890a84f32... Verified on-ledger
            </div>
          </div>
        )}

        {/* 4. TICKET QR ENTRY MODAL */}
        {type === 'TICKET_DETAILS' && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ marginBottom: 12 }}>
              <h3 style={{ fontSize: 18 }}>{data.eventName}</h3>
              <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                {data.tier} Admission · Ticket #{data.id}
              </p>
            </div>

            <div
              style={{
                background: '#fff',
                padding: 24,
                borderRadius: 'var(--radius-md)',
                display: 'inline-block',
                margin: '16px auto',
                boxShadow: '0 0 20px rgba(0,0,0,0.5)'
              }}
            >
              <QrCode size={180} color="#0d0f14" />
              <div
                style={{
                  color: '#0d0f14',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11,
                  marginTop: 8,
                  fontWeight: 600
                }}
              >
                PASSFLOW-ID-{data.id}
              </div>
            </div>

            <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text-sub)' }}>
              {data.status === 'USED' ? (
                <span className="badge badge-red">REDEEMED AT GATE: {data.usedAt}</span>
              ) : (
                <span className="badge badge-green">VALID FOR GATE SCANNER ENTRY</span>
              )}
            </div>

            <p style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 12 }}>
              Dynamic rotation code refreshes automatically every 15 seconds to prevent screenshot fraud.
            </p>
          </div>
        )}

        {/* 5. MONITORING HEALTH LOGS MODAL */}
        {type === 'HEALTH_LOGS' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--accent-emerald-subtle)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                <Activity size={18} color="#10b981" />
              </div>
              <div>
                <h3 style={{ fontSize: 17 }}>Real-Time System Monitoring Logs</h3>
                <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  All nodes active: PostgreSQL, Redis, WebSocket & Matching Engine
                </p>
              </div>
            </div>

            <div
              style={{
                background: 'var(--bg-app)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-md)',
                padding: 14,
                fontFamily: 'var(--font-mono)',
                fontSize: 12,
                lineHeight: 1.6,
                maxHeight: 260,
                overflowY: 'auto'
              }}
            >
              {adminData.monitoringLogs.map((log, idx) => (
                <div key={idx} style={{ marginBottom: 6, display: 'flex', gap: 10 }}>
                  <span style={{ color: 'var(--text-dim)' }}>[{log.time}]</span>
                  <span style={{ color: 'var(--accent-emerald)' }}>{log.type}:</span>
                  <span style={{ color: 'var(--text-sub)' }}>{log.message}</span>
                </div>
              ))}
            </div>

            <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
              <button className="btn-secondary" onClick={handleClose}>
                Close Panel
              </button>
            </div>
          </div>
        )}

        {/* 6. SETTLEMENT DISCREPANCY & RETRY MODAL */}
        {type === 'SETTLEMENT_REVIEW' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--accent-rose-subtle)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                <AlertTriangle size={18} color="#f43f5e" />
              </div>
              <div>
                <h3 style={{ fontSize: 17 }}>Settlement Discrepancy #8821</h3>
                <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  Review mismatched ledger & escrow state
                </p>
              </div>
            </div>

            <div style={{ background: 'var(--bg-card)', padding: 16, borderRadius: 'var(--radius-md)', marginBottom: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 13 }}>
                <span style={{ color: 'var(--text-muted)' }}>Trade Reference:</span>
                <span className="font-mono">T-5530 (Nightfall Festival)</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 13 }}>
                <span style={{ color: 'var(--text-muted)' }}>Mismatched Escrow Amount:</span>
                <span className="font-mono" style={{ color: 'var(--accent-rose)', fontWeight: 600 }}>$212.00</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                <span style={{ color: 'var(--text-muted)' }}>Failure Reason:</span>
                <span style={{ color: 'var(--text-sub)' }}>Bank gateway lock timeout during settlement</span>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn-secondary" style={{ flex: 1 }} onClick={handleClose}>
                Dismiss
              </button>
              <button
                className="btn-primary"
                style={{ flex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                onClick={() => {
                  retrySettlement('8821');
                  handleClose();
                }}
              >
                <RotateCcw size={14} />
                <span>Retry Settlement Now</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
