import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import {
  Bell,
  CheckCheck,
  TrendingUp,
  AlertCircle,
  Send,
  ShieldCheck,
  RefreshCw,
  CheckCircle2,
  Inbox,
  Lock,
  Zap,
  Filter
} from 'lucide-react';

export default function NotificationsPage() {
  const {
    notifications,
    markNotificationRead,
    markAllNotificationsRead,
    fetchLiveNotifications,
    currentUser,
    currentRole,
    authLoading,
    navigate,
    login,
    showToast
  } = useApp();

  const [activeTab, setActiveTab] = useState('ALL'); // 'ALL' | 'UNREAD' | 'TRADE' | 'ORDER'
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if ((currentUser || currentRole !== 'PUBLIC') && typeof fetchLiveNotifications === 'function') {
      fetchLiveNotifications();
    }
  }, [currentUser, currentRole]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      if (typeof fetchLiveNotifications === 'function') {
        await fetchLiveNotifications();
        showToast('Notifications refreshed from backend', 'success');
      }
    } catch {
      showToast('Failed to refresh notifications', 'error');
    } finally {
      setTimeout(() => setRefreshing(false), 400);
    }
  };

  const unreadCount = (notifications || []).filter((n) => n.unread).length;

  const filteredNotifications = (notifications || []).filter((notif) => {
    if (activeTab === 'UNREAD') return notif.unread;
    if (activeTab === 'TRADE') return notif.type === 'TRADE';
    if (activeTab === 'ORDER') return notif.type === 'ORDER';
    return true;
  });

  // 1. Session Restoring Guard
  if (authLoading) {
    return (
      <div className="content-wrap" style={{ maxWidth: 640, textAlign: 'center', padding: '80px 24px', margin: '40px auto' }}>
        <RefreshCw size={32} className="spin" style={{ margin: '0 auto 16px', display: 'block', color: 'var(--brand-primary, #6366f1)' }} />
        <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8, color: 'var(--text-main)' }}>Restoring Notifications...</h3>
        <p style={{ color: 'var(--text-sub)', fontSize: 14 }}>Connecting to alerts stream</p>
      </div>
    );
  }

  const effectiveRole = currentUser ? (currentUser.role || 'USER') : (currentRole || 'PUBLIC');

  // 2. Visitor / Unauthenticated Guard
  if (!currentUser || effectiveRole === 'PUBLIC') {
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
            Sign in to view your personalized PostgreSQL notifications, order fills, and escrow updates.
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
            <p style={{ marginBottom: 12 }}>1-Click demo authentication:</p>
            <button
              className="btn-secondary"
              style={{ fontSize: 12, padding: '6px 14px' }}
              onClick={async () => {
                try {
                  await login('ali@passflow.com', 'Password123!');
                  showToast('Signed in as Ali Khan', 'success');
                } catch (err) {
                  showToast(err.message || 'Login failed', 'error');
                }
              }}
            >
              <Zap size={13} color="var(--accent-orange)" />
              <span>1-Click Sign In as Ali Khan</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="content-wrap" style={{ maxWidth: 780, paddingTop: 28 }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h1 style={{ fontSize: 26, margin: 0 }}>Notification Center</h1>
            {unreadCount > 0 && (
              <span className="badge badge-orange font-mono" style={{ fontSize: 11 }}>
                {unreadCount} NEW
              </span>
            )}
            <span className="badge badge-green font-mono" style={{ fontSize: 10 }}>
              POSTGRESQL SYNC
            </span>
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4 }}>
            Authoritative alerts for secondary matching engine order fills, cancellations, and settlement receipts
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <button
            className="btn-secondary"
            onClick={handleRefresh}
            disabled={refreshing}
            style={{ fontSize: 12, padding: '7px 12px', display: 'flex', alignItems: 'center', gap: 6 }}
            title="Refresh latest notifications"
          >
            <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
            <span>{refreshing ? 'Syncing...' : 'Refresh'}</span>
          </button>

          <button
            className="btn-secondary"
            onClick={markAllNotificationsRead}
            disabled={unreadCount === 0}
            style={{ fontSize: 12, padding: '7px 12px', opacity: unreadCount === 0 ? 0.6 : 1 }}
          >
            <CheckCheck size={14} />
            <span>Mark all as read</span>
          </button>
        </div>
      </div>

      {/* Filter Tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, borderBottom: '1px solid var(--border-subtle)', paddingBottom: 10 }}>
        {[
          { id: 'ALL', label: `All Alerts (${(notifications || []).length})` },
          { id: 'UNREAD', label: `Unread (${unreadCount})` },
          { id: 'TRADE', label: 'Order Fills' },
          { id: 'ORDER', label: 'Bids & Asks' }
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            style={{
              padding: '6px 14px',
              fontSize: 12,
              fontWeight: activeTab === t.id ? 600 : 500,
              borderRadius: 'var(--radius-full)',
              background: activeTab === t.id ? 'var(--accent-orange)' : 'var(--bg-card)',
              color: activeTab === t.id ? '#fff' : 'var(--text-sub)',
              border: '1px solid',
              borderColor: activeTab === t.id ? 'var(--accent-orange)' : 'var(--border-subtle)',
              cursor: 'pointer',
              transition: 'all 0.15s ease'
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Notifications List */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {filteredNotifications.length === 0 ? (
          <div
            className="card"
            style={{
              textAlign: 'center',
              padding: '48px 20px',
              color: 'var(--text-muted)'
            }}
          >
            <Inbox size={36} color="var(--text-dim)" style={{ margin: '0 auto 12px auto', display: 'block' }} />
            <strong style={{ fontSize: 15, color: 'var(--text-main)', display: 'block', marginBottom: 4 }}>
              No notifications in this view
            </strong>
            <p style={{ fontSize: 12, maxWidth: 420, margin: '0 auto', color: 'var(--text-dim)' }}>
              Real-time alerts for secondary order book fills, custodial wallet transactions, and KYC status will appear here automatically.
            </p>
          </div>
        ) : (
          filteredNotifications.map((notif) => (
            <div
              key={notif.id}
              className="card"
              style={{
                padding: 16,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 16,
                borderColor: notif.unread ? 'var(--accent-orange-border)' : 'var(--border-subtle)',
                background: notif.unread ? 'rgba(249, 115, 22, 0.05)' : 'var(--bg-card)',
                transition: 'border-color 0.15s ease, background 0.15s ease'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: '50%',
                    background:
                      notif.type === 'TRADE'
                        ? 'var(--accent-emerald-subtle)'
                        : notif.type === 'ORDER'
                        ? 'var(--accent-orange-subtle)'
                        : notif.type === 'TRANSFER'
                        ? 'var(--accent-blue-subtle)'
                        : 'rgba(234, 179, 8, 0.12)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0
                  }}
                >
                  {notif.type === 'TRADE' && <TrendingUp size={17} color="#10b981" />}
                  {notif.type === 'ORDER' && <Bell size={17} color="#f97316" />}
                  {notif.type === 'TRANSFER' && <Send size={17} color="#3b82f6" />}
                  {notif.type === 'KYC' && <ShieldCheck size={17} color="#eab308" />}
                  {!['TRADE', 'ORDER', 'TRANSFER', 'KYC'].includes(notif.type) && (
                    <Bell size={17} color="#f97316" />
                  )}
                </div>

                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                    <strong style={{ fontSize: 13, color: 'var(--text-main)' }}>{notif.title}</strong>
                    {notif.unread && (
                      <span
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: '50%',
                          background: 'var(--accent-orange)',
                          display: 'inline-block'
                        }}
                      />
                    )}
                    <span className="badge badge-neutral" style={{ fontSize: 9, padding: '1px 5px' }}>
                      {notif.type}
                    </span>
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text-sub)', lineHeight: 1.4 }}>{notif.body}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }} className="font-mono">
                    {notif.time}
                  </div>
                </div>
              </div>

              {notif.unread && (
                <button
                  className="btn-secondary"
                  style={{ fontSize: 11, padding: '5px 10px', flexShrink: 0 }}
                  onClick={() => markNotificationRead(notif.id)}
                >
                  Mark read
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
