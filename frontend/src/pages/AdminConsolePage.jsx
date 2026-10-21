import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import {
  ShieldCheck,
  Activity,
  RotateCcw,
  Sliders,
  FileCheck2,
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Users,
  Building,
  RefreshCw,
  Search,
  Check,
  X,
  Play
} from 'lucide-react';

export default function AdminConsolePage() {
  const {
    adminData,
    users,
    events,
    runReconciliation,
    retrySettlement,
    toggleCapRule,
    updateCapPrice,
    verifyOrganizer,
    rejectOrganizer,
    toggleUserSuspension,
    approveUserKyc,
    regenerateSolvencyProof,
    setActiveModal,
    navigate,
    currentPath
  } = useApp();

  // Derive active tab from currentPath
  const getTabFromPath = (path) => {
    if (path === '/admin/users') return 'USERS';
    if (path === '/admin/organizers') return 'ORGANIZERS';
    if (path === '/admin/settlements') return 'SETTLEMENTS';
    return 'CONSOLE';
  };

  const activeAdminTab = getTabFromPath(currentPath);
  const [userSearch, setUserSearch] = useState('');

  const handleAdminTabClick = (tabId) => {
    if (tabId === 'USERS') navigate('/admin/users');
    else if (tabId === 'ORGANIZERS') navigate('/admin/organizers');
    else if (tabId === 'SETTLEMENTS') navigate('/admin/settlements');
    else navigate('/admin');
  };

  return (
    <div className="content-wrap">
      {/* Top Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h1 style={{ fontSize: 28, margin: 0 }}>PassFlow Platform Admin</h1>
            <span className="badge badge-red font-mono">SUPERADMIN ACCESS</span>
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4 }}>
            Real-time exchange telemetry, automated reconciliation, and administrative moderation
          </p>
        </div>

        {/* Admin Navigation Sub-Tabs */}
        <div style={{ display: 'flex', gap: 6, background: 'var(--bg-surface)', padding: 4, borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)', flexWrap: 'wrap' }}>
          {[
            { id: 'CONSOLE', label: 'Console & Telemetry' },
            { id: 'USERS', label: `Users & KYC (${users.length})` },
            { id: 'ORGANIZERS', label: `Organizers Queue (${adminData.organizerApplications.filter((a) => a.status === 'PENDING').length} pending)` },
            { id: 'SETTLEMENTS', label: `Settlements (${adminData.failedSettlements.filter((s) => s.status === 'FAILED').length} failed)` }
          ].map((t) => (
            <button
              key={t.id}
              className={`nav-item ${activeAdminTab === t.id ? 'active' : ''}`}
              style={{ padding: '6px 12px', fontSize: 12 }}
              onClick={() => handleAdminTabClick(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* ===================== TAB 1: CONSOLE & TELEMETRY ===================== */}
      {activeAdminTab === 'CONSOLE' && (
        <>
          {/* Top 4 Performance Metric Tiles */}
          <div className="grid-4" style={{ marginBottom: 20 }}>
            <div className="card">
              <span style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Orders Per Second
              </span>
              <div className="font-mono" style={{ fontSize: 26, fontWeight: 700, color: 'var(--text-main)', marginTop: 4 }}>
                {adminData.metrics.ordersPerSecond}
              </div>
              <span style={{ fontSize: 11, color: 'var(--accent-emerald)' }}>↑ 14% vs yesterday</span>
            </div>

            <div className="card">
              <span style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Engine Avg Latency
              </span>
              <div className="font-mono" style={{ fontSize: 26, fontWeight: 700, color: 'var(--accent-emerald)', marginTop: 4 }}>
                {adminData.metrics.avgLatencyMs} ms
              </div>
              <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>In-memory tick optimal</span>
            </div>

            <div className="card">
              <span style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Active Open Orders
              </span>
              <div className="font-mono" style={{ fontSize: 26, fontWeight: 700, color: 'var(--accent-orange)', marginTop: 4 }}>
                {adminData.metrics.openOrders.toLocaleString()}
              </div>
              <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>Across all live events</span>
            </div>

            <div className="card" style={{ borderColor: adminData.metrics.failedSettlements > 0 ? 'var(--accent-rose-border)' : undefined }}>
              <span style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Failed Settlements
              </span>
              <div
                className="font-mono"
                style={{
                  fontSize: 26,
                  fontWeight: 700,
                  color: adminData.metrics.failedSettlements > 0 ? 'var(--accent-rose)' : 'var(--text-main)',
                  marginTop: 4
                }}
              >
                {adminData.metrics.failedSettlements}
              </div>
              <span style={{ fontSize: 11, color: adminData.metrics.failedSettlements > 0 ? 'var(--accent-rose)' : 'var(--accent-emerald)' }}>
                {adminData.metrics.failedSettlements > 0 ? 'Action required in queue' : 'Clean settlement ledger'}
              </span>
            </div>
          </div>

          {/* 4 System Health Lights (Click to open Logs Modal) */}
          <div
            className="card"
            style={{
              padding: '12px 20px',
              marginBottom: 24,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              cursor: 'pointer',
              background: 'rgba(18, 21, 29, 0.6)'
            }}
            onClick={() => setActiveModal({ type: 'HEALTH_LOGS' })}
            title="Click to view live monitoring telemetry logs"
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-sub)' }}>
                Cluster Health Status:
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#10b981' }} />
                <span>Database PostgreSQL ok ({adminData.health.database.latency})</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#10b981' }} />
                <span>Redis Cluster ok ({adminData.health.redis.latency})</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#10b981' }} />
                <span>WebSocket Rooms ok ({adminData.health.websocket.connections} conns)</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#10b981' }} />
                <span>Matching Engine ok ({adminData.health.matchingEngine.tick})</span>
              </div>
            </div>

            <button className="btn-secondary" style={{ padding: '4px 10px', fontSize: 11 }}>
              <Activity size={13} color="#10b981" />
              <span>Inspect Logs</span>
            </button>
          </div>

          {/* 2-column Grid: Reconciliation & Audit Log */}
          <div className="grid-2" style={{ marginBottom: 24 }}>
            {/* Reconciliation Card */}
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                <div>
                  <h3 style={{ fontSize: 16 }}>Daily Ledger Reconciliation</h3>
                  <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    Compares in-memory matching fills against PostgreSQL ledger balances
                  </p>
                </div>
                <button
                  className="btn-primary"
                  style={{ padding: '6px 12px', fontSize: 12 }}
                  onClick={runReconciliation}
                >
                  <Play size={13} />
                  <span>Run Recon</span>
                </button>
              </div>

              <div className="data-table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Batch Date</th>
                      <th>Status</th>
                      <th>Discrepancies</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {adminData.reconciliation.map((rec, idx) => (
                      <tr key={idx}>
                        <td className="font-mono">{rec.date}</td>
                        <td>
                          <span className={`badge ${rec.status === 'MATCHED' ? 'badge-green' : 'badge-red'}`}>
                            {rec.status}
                          </span>
                        </td>
                        <td className="font-mono">
                          {rec.discrepancies > 0 ? (
                            <span style={{ color: 'var(--accent-rose)', fontWeight: 600 }}>
                              {rec.discrepancies} mismatches
                            </span>
                          ) : (
                            <span style={{ color: 'var(--accent-emerald)' }}>0</span>
                          )}
                        </td>
                        <td>
                          {rec.discrepancies > 0 ? (
                            <button
                              className="btn-danger-outline"
                              onClick={() => setActiveModal({ type: 'SETTLEMENT_REVIEW' })}
                            >
                              Review ({rec.discrepancies})
                            </button>
                          ) : (
                            <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>Audited ✓</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Audit Log Card */}
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                <div>
                  <h3 style={{ fontSize: 16 }}>Administrative Audit Log</h3>
                  <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    Immutable append-only administrative trace
                  </p>
                </div>
                <span className="badge badge-neutral font-mono">APPEND-ONLY</span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {adminData.auditLogs.map((log) => (
                  <div
                    key={log.id}
                    style={{
                      background: 'var(--bg-app)',
                      padding: 10,
                      borderRadius: 'var(--radius-sm)',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      fontSize: 12
                    }}
                  >
                    <div>
                      <span className="font-mono" style={{ color: 'var(--accent-orange)', fontWeight: 600 }}>
                        {log.admin}
                      </span>{' '}
                      <span style={{ color: 'var(--text-sub)' }}>{log.action}</span>
                    </div>
                    <span style={{ color: 'var(--text-dim)', fontSize: 11 }} className="font-mono">
                      {log.time}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* 2-column Grid: Pricing/Bot Rules & Solvency Proof */}
          <div className="grid-2">
            {/* Pricing & Bot Rules Management */}
            <div className="card">
              <h3 style={{ fontSize: 16, marginBottom: 4 }}>Anti-Scalping & Bot Rules</h3>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>
                Enforces maximum resale price caps to eliminate ticket scalping bots
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
                {adminData.rules.filter((r) => r.eventId).map((rule) => (
                  <div
                    key={rule.id}
                    style={{
                      background: 'var(--bg-app)',
                      padding: 12,
                      borderRadius: 'var(--radius-sm)',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center'
                    }}
                  >
                    <div>
                      <strong style={{ fontSize: 13 }}>{rule.name}</strong>
                      <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>
                        Resale Ceiling: <span className="font-mono" style={{ color: 'var(--accent-orange)' }}>Max ${rule.maxPrice}</span>
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <button
                        className={`btn-pill ${rule.enabled ? 'active' : ''}`}
                        style={{
                          padding: '4px 12px',
                          borderRadius: 'var(--radius-full)',
                          fontSize: 11,
                          fontWeight: 700,
                          background: rule.enabled ? 'var(--accent-emerald)' : 'var(--bg-input)',
                          color: rule.enabled ? '#06281e' : 'var(--text-dim)'
                        }}
                        onClick={() => toggleCapRule(rule.id)}
                      >
                        {rule.enabled ? 'ACTIVE ON' : 'DISABLED'}
                      </button>
                    </div>
                  </div>
                ))}

                <div
                  style={{
                    background: 'var(--bg-app)',
                    padding: 12,
                    borderRadius: 'var(--radius-sm)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                  }}
                >
                  <div>
                    <strong style={{ fontSize: 13 }}>Global Bot Rate Limit</strong>
                    <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                      20 order placements per minute per authenticated IP/user
                    </div>
                  </div>
                  <span className="badge badge-green">ENFORCED</span>
                </div>
              </div>
            </div>

            {/* Solvency Proof Card */}
            <div className="card" style={{ borderColor: 'var(--accent-emerald-border)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <h3 style={{ fontSize: 16 }}>Cryptographic Proof of Solvency</h3>
                <span className="badge badge-green">VERIFIED {adminData.solvency.verifiedDate}</span>
              </div>

              <div style={{ background: 'rgba(16, 185, 129, 0.05)', padding: 16, borderRadius: 'var(--radius-md)', marginBottom: 16 }}>
                <div className="font-mono" style={{ fontSize: 28, fontWeight: 700, color: 'var(--accent-emerald)' }}>
                  ${adminData.solvency.assets.toLocaleString()} assets
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-sub)', marginTop: 4 }}>
                  Covers <strong className="font-mono">${adminData.solvency.liabilities.toLocaleString()}</strong> in user wallet balances and escrow orders ({adminData.solvency.ratio}% reserve ratio).
                </div>
              </div>

              <div style={{ marginBottom: 16, fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', wordBreak: 'break-all' }}>
                Merkle Root: {adminData.solvency.merkleRoot}
              </div>

              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  className="btn-secondary"
                  style={{ flex: 1, fontSize: 12 }}
                  onClick={regenerateSolvencyProof}
                >
                  <RefreshCw size={13} />
                  <span>Re-generate Proof</span>
                </button>
                <button
                  className="btn-primary"
                  style={{ flex: 1, fontSize: 12 }}
                  onClick={() => navigate('/solvency/verify')}
                >
                  <ExternalLink size={13} />
                  <span>Public Verify Page</span>
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ===================== TAB 2: USERS & KYC ===================== */}
      {activeAdminTab === 'USERS' && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ fontSize: 16 }}>User Accounts & KYC Moderation</h3>
            <div style={{ position: 'relative', width: 240 }}>
              <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-dim)' }} />
              <input
                type="text"
                placeholder="Search users..."
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                style={{ width: '100%', paddingLeft: 30, fontSize: 12 }}
              />
            </div>
          </div>

          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Role</th>
                  <th>KYC Status</th>
                  <th>Account Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{u.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>{u.email}</div>
                    </td>
                    <td>
                      <span className="badge badge-neutral">{u.role}</span>
                    </td>
                    <td>
                      <span className={`badge ${u.kycStatus === 'VERIFIED' ? 'badge-green' : 'badge-orange'}`}>
                        {u.kycStatus}
                      </span>
                    </td>
                    <td>
                      <span className={`badge ${u.status === 'ACTIVE' ? 'badge-green' : 'badge-red'}`}>
                        {u.status}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 6 }}>
                        {u.kycStatus === 'PENDING' && (
                          <button
                            className="btn-success"
                            style={{ padding: '4px 10px', fontSize: 11 }}
                            onClick={() => approveUserKyc(u.id)}
                          >
                            Approve KYC
                          </button>
                        )}
                        <button
                          className={u.status === 'ACTIVE' ? 'btn-danger-outline' : 'btn-secondary'}
                          style={{ padding: '4px 10px', fontSize: 11 }}
                          onClick={() => toggleUserSuspension(u.id)}
                        >
                          {u.status === 'ACTIVE' ? 'Suspend' : 'Activate'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ===================== TAB 3: ORGANIZERS QUEUE ===================== */}
      {activeAdminTab === 'ORGANIZERS' && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-subtle)' }}>
            <h3 style={{ fontSize: 16 }}>Organizer Applications & Promoter Verification</h3>
            <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              Approving an application unlocks the /organizer dashboard and minting privileges for the promoter
            </p>
          </div>

          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Organizer Entity</th>
                  <th>Contact Email</th>
                  <th>Estimated Volume</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {adminData.organizerApplications.map((app) => (
                  <tr key={app.id}>
                    <td style={{ fontWeight: 600 }}>{app.name}</td>
                    <td style={{ color: 'var(--text-dim)' }}>{app.email}</td>
                    <td className="font-mono">{app.volume}</td>
                    <td>
                      <span className={`badge ${app.status === 'VERIFIED' ? 'badge-green' : app.status === 'PENDING' ? 'badge-orange' : 'badge-red'}`}>
                        {app.status}
                      </span>
                    </td>
                    <td>
                      {app.status === 'PENDING' ? (
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button
                            className="btn-success"
                            style={{ padding: '4px 10px', fontSize: 11 }}
                            onClick={() => verifyOrganizer(app.id)}
                          >
                            Verify & Authorize
                          </button>
                          <button
                            className="btn-danger-outline"
                            onClick={() => rejectOrganizer(app.id)}
                          >
                            Reject
                          </button>
                        </div>
                      ) : (
                        <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>Processed ✓</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ===================== TAB 4: SETTLEMENTS RETRY ===================== */}
      {activeAdminTab === 'SETTLEMENTS' && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-subtle)' }}>
            <h3 style={{ fontSize: 16 }}>Failed Settlements Recovery Desk</h3>
            <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              Idempotent retry mechanism for escrow payments or transfer lockouts
            </p>
          </div>

          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Settlement #</th>
                  <th>Trade Reference</th>
                  <th>Event</th>
                  <th>Amount</th>
                  <th>Failure Reason</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {adminData.failedSettlements.map((s) => (
                  <tr key={s.id}>
                    <td className="font-mono">#{s.id}</td>
                    <td className="font-mono">{s.tradeId}</td>
                    <td>{s.eventName}</td>
                    <td className="font-mono" style={{ fontWeight: 600 }}>${s.amount.toFixed(2)}</td>
                    <td style={{ fontSize: 12, color: 'var(--accent-rose)' }}>{s.reason}</td>
                    <td>
                      <span className={`badge ${s.status === 'COMPLETED' ? 'badge-green' : 'badge-red'}`}>
                        {s.status}
                      </span>
                    </td>
                    <td>
                      {s.status === 'FAILED' ? (
                        <button
                          className="btn-primary"
                          style={{ padding: '4px 12px', fontSize: 11 }}
                          onClick={() => retrySettlement(s.id)}
                        >
                          <RotateCcw size={12} />
                          <span>Retry Idempotently</span>
                        </button>
                      ) : (
                        <span style={{ color: 'var(--accent-emerald)', fontSize: 11, fontWeight: 600 }}>
                          ✓ Resolved
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
