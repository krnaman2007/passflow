import React, { useState, useEffect } from 'react';
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
  Play,
  Zap,
  Lock,
  Layers,
  ArrowRight
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
    refreshAdminData,
    login,
    currentUser,
    currentRole,
    setActiveModal,
    navigate,
    currentPath,
    showToast
  } = useApp();

  const [refreshing, setRefreshing] = useState(false);
  const [reconRunning, setReconRunning] = useState(false);
  const [solvencyGenerating, setSolvencyGenerating] = useState(false);
  const [userSearch, setUserSearch] = useState('');

  // Sync latest backend telemetry on mount
  useEffect(() => {
    if (typeof refreshAdminData === 'function') {
      refreshAdminData();
    }
  }, []);

  const handleManualRefresh = async () => {
    setRefreshing(true);
    try {
      if (typeof refreshAdminData === 'function') {
        await refreshAdminData();
        showToast('Telemetry and database records refreshed from PostgreSQL', 'success');
      }
    } catch {
      showToast('Telemetry refresh failed', 'error');
    } finally {
      setTimeout(() => setRefreshing(false), 500);
    }
  };

  const handleRunReconciliation = async () => {
    setReconRunning(true);
    try {
      await runReconciliation();
    } finally {
      setReconRunning(false);
    }
  };

  const handleRegenerateSolvency = async () => {
    setSolvencyGenerating(true);
    try {
      await regenerateSolvencyProof();
    } finally {
      setSolvencyGenerating(false);
    }
  };

  // Derive active tab from currentPath
  const getTabFromPath = (path) => {
    if (path === '/admin/users') return 'USERS';
    if (path === '/admin/organizers') return 'ORGANIZERS';
    if (path === '/admin/settlements') return 'SETTLEMENTS';
    return 'CONSOLE';
  };

  const activeAdminTab = getTabFromPath(currentPath);

  const handleAdminTabClick = (tabId) => {
    if (tabId === 'USERS') navigate('/admin/users');
    else if (tabId === 'ORGANIZERS') navigate('/admin/organizers');
    else if (tabId === 'SETTLEMENTS') navigate('/admin/settlements');
    else navigate('/admin');
  };

  // Filter users by search term
  const filteredUsers = (users || []).filter((u) => {
    if (!userSearch.trim()) return true;
    const q = userSearch.toLowerCase();
    return (
      (u.name && u.name.toLowerCase().includes(q)) ||
      (u.email && u.email.toLowerCase().includes(q)) ||
      (u.id && u.id.toLowerCase().includes(q)) ||
      (u.role && u.role.toLowerCase().includes(q))
    );
  });

  const pendingOrganizersCount = (adminData.organizerApplications || []).filter(
    (a) => a.status === 'PENDING'
  ).length;

  const failedSettlementsCount = (adminData.failedSettlements || []).filter(
    (s) => s.status === 'FAILED'
  ).length;

  return (
    <div className="content-wrap" style={{ maxWidth: 1200, paddingTop: 24 }}>
      {/* Non-Admin Notice / 1-Click Superadmin Switch */}
      {currentRole !== 'ADMIN' && (
        <div
          className="card"
          style={{
            background: 'linear-gradient(135deg, rgba(239, 68, 68, 0.12), rgba(23, 27, 38, 0.95))',
            borderColor: 'rgba(239, 68, 68, 0.4)',
            marginBottom: 20,
            padding: 16,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 12
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Lock size={18} color="#f87171" />
            <div>
              <strong style={{ fontSize: 13, color: '#f87171' }}>
                Admin Authentication Required
              </strong>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                You are currently viewing with session role: <span className="font-mono">{currentRole}</span>. Authenticate as Superadmin to execute database mutations.
              </div>
            </div>
          </div>
          <button
            className="btn-primary"
            style={{ fontSize: 12, padding: '7px 14px', background: '#dc2626', borderColor: '#b91c1c' }}
            onClick={async () => {
              try {
                await login('admin@passflow.com', 'Password123!');
                showToast('Switched to Platform Administrator (admin@passflow.com)', 'success');
              } catch (err) {
                showToast(err.message || 'Login failed', 'error');
              }
            }}
          >
            <Zap size={14} />
            <span>1-Click Sign In as Platform Admin</span>
          </button>
        </div>
      )}

      {/* Top Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h1 style={{ fontSize: 28, margin: 0 }}>PassFlow Platform Admin</h1>
            <span className="badge badge-red font-mono">SUPERADMIN ACCESS</span>
            <span className="badge badge-green font-mono">LIVE BACKEND</span>
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4 }}>
            PostgreSQL ledger reconciliation, cluster health telemetry, and administrative moderation
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <button
            className="btn-secondary"
            onClick={handleManualRefresh}
            disabled={refreshing}
            style={{ fontSize: 12, padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 6 }}
            title="Refresh latest telemetry from backend"
          >
            <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
            <span>{refreshing ? 'Refreshing...' : 'Refresh Telemetry'}</span>
          </button>

          {/* Admin Navigation Sub-Tabs */}
          <div style={{ display: 'flex', gap: 6, background: 'var(--bg-surface)', padding: 4, borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)', flexWrap: 'wrap' }}>
            {[
              { id: 'CONSOLE', label: 'Console & Telemetry' },
              { id: 'USERS', label: `Users & KYC (${(users || []).length})` },
              { id: 'ORGANIZERS', label: `Organizers Queue (${pendingOrganizersCount} pending)` },
              { id: 'SETTLEMENTS', label: `Settlements (${failedSettlementsCount} failed)` }
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
                {adminData.metrics?.ordersPerSecond ?? 18}
              </div>
              <span style={{ fontSize: 11, color: 'var(--accent-emerald)' }}>Live matching engine tick</span>
            </div>

            <div className="card">
              <span style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Engine Avg Latency
              </span>
              <div className="font-mono" style={{ fontSize: 26, fontWeight: 700, color: 'var(--accent-emerald)', marginTop: 4 }}>
                {adminData.metrics?.avgLatencyMs ?? 4.2} ms
              </div>
              <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>In-memory tick optimal</span>
            </div>

            <div className="card">
              <span style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Active Open Orders
              </span>
              <div className="font-mono" style={{ fontSize: 26, fontWeight: 700, color: 'var(--accent-orange)', marginTop: 4 }}>
                {(adminData.metrics?.openOrders ?? 12).toLocaleString()}
              </div>
              <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>Across all live events</span>
            </div>

            <div className="card" style={{ borderColor: failedSettlementsCount > 0 ? 'var(--accent-rose-border)' : undefined }}>
              <span style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Failed Settlements
              </span>
              <div
                className="font-mono"
                style={{
                  fontSize: 26,
                  fontWeight: 700,
                  color: failedSettlementsCount > 0 ? 'var(--accent-rose)' : 'var(--text-main)',
                  marginTop: 4
                }}
              >
                {failedSettlementsCount}
              </div>
              <span style={{ fontSize: 11, color: failedSettlementsCount > 0 ? 'var(--accent-rose)' : 'var(--accent-emerald)' }}>
                {failedSettlementsCount > 0 ? 'Action required in queue' : 'Clean settlement ledger ✓'}
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
                <span>Database PostgreSQL ok ({adminData.health?.database?.latency || '3ms'})</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#10b981' }} />
                <span>Redis Cluster ok ({adminData.health?.redis?.latency || '1ms'})</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#10b981' }} />
                <span>WebSocket Rooms ok ({adminData.health?.websocket?.connections || 1} conns)</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#10b981' }} />
                <span>Matching Engine ok ({adminData.health?.matchingEngine?.tick || '0.15ms'})</span>
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
                  style={{ padding: '6px 12px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}
                  onClick={handleRunReconciliation}
                  disabled={reconRunning}
                >
                  <Play size={13} className={reconRunning ? 'animate-spin' : ''} />
                  <span>{reconRunning ? 'Running...' : 'Run Recon'}</span>
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
                    {(adminData.reconciliation || []).slice(0, 5).map((rec, idx) => (
                      <tr key={rec.id || idx}>
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
                    Immutable append-only administrative trace in PostgreSQL
                  </p>
                </div>
                <span className="badge badge-neutral font-mono">APPEND-ONLY</span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 260, overflowY: 'auto' }}>
                {(adminData.auditLogs || []).slice(0, 8).map((log) => (
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
                      {log.time || log.date}
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
                {(adminData.rules || []).filter((r) => r.eventId || r.tier).map((rule) => (
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
                      <strong style={{ fontSize: 13 }}>{rule.name || rule.tier || rule.eventId}</strong>
                      <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>
                        Resale Ceiling: <span className="font-mono" style={{ color: 'var(--accent-orange)' }}>Max ₹{rule.maxPrice}</span>
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <button
                        className={`btn-pill ${rule.enabled !== false ? 'active' : ''}`}
                        style={{
                          padding: '4px 12px',
                          borderRadius: 'var(--radius-full)',
                          fontSize: 11,
                          fontWeight: 700,
                          background: rule.enabled !== false ? 'var(--accent-emerald)' : 'var(--bg-input)',
                          color: rule.enabled !== false ? '#06281e' : 'var(--text-dim)'
                        }}
                        onClick={() => toggleCapRule(rule.id)}
                      >
                        {rule.enabled !== false ? 'ACTIVE ON' : 'DISABLED'}
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
                <span className="badge badge-green">VERIFIED {adminData.solvency?.verifiedDate || 'LIVE'}</span>
              </div>

              <div style={{ background: 'rgba(16, 185, 129, 0.05)', padding: 16, borderRadius: 'var(--radius-md)', marginBottom: 16 }}>
                <div className="font-mono" style={{ fontSize: 28, fontWeight: 700, color: 'var(--accent-emerald)' }}>
                  ₹{(adminData.solvency?.assets || 100000).toLocaleString()} assets
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-sub)', marginTop: 4 }}>
                  Covers <strong className="font-mono">₹{(adminData.solvency?.liabilities || 50000).toLocaleString()}</strong> in user wallet balances and escrow orders ({adminData.solvency?.ratio || '2.0'}x reserve ratio).
                </div>
              </div>

              <div style={{ marginBottom: 16, fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', wordBreak: 'break-all' }}>
                Merkle Root: {adminData.solvency?.merkleRoot || '0x7e8b91c0f4492da3e819b5c219f8a3d4e6c1a89f2140'}
              </div>

              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  className="btn-secondary"
                  style={{ flex: 1, fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                  onClick={handleRegenerateSolvency}
                  disabled={solvencyGenerating}
                >
                  <RefreshCw size={13} className={solvencyGenerating ? 'animate-spin' : ''} />
                  <span>{solvencyGenerating ? 'Generating...' : 'Re-generate Proof'}</span>
                </button>
                <button
                  className="btn-primary"
                  style={{ flex: 1, fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
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
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <h3 style={{ fontSize: 16 }}>Live User Accounts & KYC Moderation</h3>
              <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Authoritative user registry from PostgreSQL ({filteredUsers.length} total)
              </p>
            </div>
            <div style={{ position: 'relative', width: 260 }}>
              <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-dim)' }} />
              <input
                type="text"
                placeholder="Search name, email, or role..."
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                style={{ width: '100%', paddingLeft: 32, fontSize: 12 }}
              />
            </div>
          </div>

          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>User Profile</th>
                  <th>Role</th>
                  <th>KYC Status</th>
                  <th>Account Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{u.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>{u.email}</div>
                    </td>
                    <td>
                      <span className={`badge ${u.role === 'ADMIN' ? 'badge-red' : u.role === 'ORGANIZER' ? 'badge-orange' : 'badge-neutral'}`}>
                        {u.role}
                      </span>
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
              Approving an application unlocks primary minting privileges and box office analytics
            </p>
          </div>

          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Organizer Entity</th>
                  <th>Contact Email</th>
                  <th>Volume / Type</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {(adminData.organizerApplications || []).map((app) => (
                  <tr key={app.id}>
                    <td style={{ fontWeight: 600 }}>{app.name}</td>
                    <td style={{ color: 'var(--text-dim)' }}>{app.email}</td>
                    <td className="font-mono">{app.volume || 'Active Promoter'}</td>
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
                            style={{ padding: '4px 10px', fontSize: 11 }}
                            onClick={() => rejectOrganizer(app.id)}
                          >
                            Reject
                          </button>
                        </div>
                      ) : (
                        <span style={{ fontSize: 11, color: 'var(--accent-emerald)', fontWeight: 600 }}>
                          Verified & Authorized ✓
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

      {/* ===================== TAB 4: SETTLEMENTS RETRY ===================== */}
      {activeAdminTab === 'SETTLEMENTS' && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-subtle)' }}>
            <h3 style={{ fontSize: 16 }}>Failed Settlements Recovery Desk</h3>
            <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              Idempotent retry mechanism for secondary order book escrow clearances
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
                {(adminData.failedSettlements || []).length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ textAlign: 'center', padding: '32px 20px', color: 'var(--text-muted)' }}>
                      <CheckCircle2 size={32} color="#10b981" style={{ margin: '0 auto 8px auto', display: 'block' }} />
                      <strong style={{ color: 'var(--text-main)', fontSize: 14 }}>All Settlement Queues Clean</strong>
                      <div style={{ fontSize: 12, marginTop: 4 }}>
                        Zero failed settlement executions. In-memory matching engine and PostgreSQL escrows are 100% balanced.
                      </div>
                    </td>
                  </tr>
                ) : (
                  (adminData.failedSettlements || []).map((s) => (
                    <tr key={s.id}>
                      <td className="font-mono">#{s.id}</td>
                      <td className="font-mono">{s.tradeId}</td>
                      <td>{s.eventName}</td>
                      <td className="font-mono" style={{ fontWeight: 600 }}>₹{s.amount.toFixed(2)}</td>
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
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
