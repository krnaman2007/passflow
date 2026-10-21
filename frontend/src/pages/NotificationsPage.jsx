import React from 'react';
import { useApp } from '../context/AppContext';
import { Bell, CheckCheck, TrendingUp, AlertCircle, Send, ShieldCheck } from 'lucide-react';

export default function NotificationsPage() {
  const { notifications, markNotificationRead, markAllNotificationsRead } = useApp();

  return (
    <div className="content-wrap" style={{ maxWidth: 760 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 26, margin: 0 }}>Notification Center</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4 }}>
            Real-time trade fills, order cancellations, and settlement receipts
          </p>
        </div>

        <button className="btn-secondary" onClick={markAllNotificationsRead}>
          <CheckCheck size={14} />
          <span>Mark all as read</span>
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {notifications.map((notif) => (
          <div
            key={notif.id}
            className="card"
            style={{
              padding: 16,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 16,
              borderColor: notif.unread ? 'var(--accent-orange-border)' : undefined,
              background: notif.unread ? 'rgba(249, 115, 22, 0.04)' : undefined
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: '50%',
                  background:
                    notif.type === 'TRADE'
                      ? 'var(--accent-emerald-subtle)'
                      : notif.type === 'ORDER'
                      ? 'var(--accent-orange-subtle)'
                      : 'var(--accent-blue-subtle)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0
                }}
              >
                {notif.type === 'TRADE' && <TrendingUp size={16} color="#10b981" />}
                {notif.type === 'ORDER' && <Bell size={16} color="#f97316" />}
                {notif.type === 'TRANSFER' && <Send size={16} color="#3b82f6" />}
                {notif.type === 'KYC' && <ShieldCheck size={16} color="#eab308" />}
              </div>

              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                  <strong style={{ fontSize: 14 }}>{notif.title}</strong>
                  {notif.unread && (
                    <span
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: '50%',
                        background: 'var(--accent-orange)'
                      }}
                    />
                  )}
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-sub)' }}>{notif.body}</div>
                <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>{notif.time}</div>
              </div>
            </div>

            {notif.unread && (
              <button
                className="btn-secondary"
                style={{ fontSize: 11, padding: '4px 8px' }}
                onClick={() => markNotificationRead(notif.id)}
              >
                Mark read
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
