import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { Lock, Mail, ArrowRight, Zap, ShieldCheck } from 'lucide-react';

export default function LoginPage() {
  const { switchRole, navigate, showToast } = useApp();

  const [email, setEmail] = useState('ali@example.com');
  const [password, setPassword] = useState('••••••••');

  const handleLogin = (e) => {
    e.preventDefault();
    if (email.includes('admin')) {
      switchRole('ADMIN');
      navigate('/admin');
    } else if (email.includes('lumen') || email.includes('organizer')) {
      switchRole('ORGANIZER');
      navigate('/organizer');
    } else {
      switchRole('USER');
      navigate('/events');
    }
  };

  return (
    <div className="content-wrap" style={{ maxWidth: 520, paddingTop: 40 }}>
      {/* Brand Header */}
      <div style={{ textAlign: 'center', marginBottom: 28 }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 24, fontWeight: 700, marginBottom: 6 }}>
          <span className="brand-diamond" style={{ fontSize: 26 }}>◆</span>
          <span>Darkhold Exchange</span>
        </div>
        <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
          Fair-price secondary order book & primary event tickets
        </p>
      </div>

      {/* Instant Role Previewer (1-Click Login) */}
      <div
        className="card"
        style={{
          background: 'linear-gradient(135deg, rgba(249, 115, 22, 0.08), rgba(23, 27, 38, 0.95))',
          borderColor: 'var(--accent-orange-border)',
          marginBottom: 24,
          padding: 16
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <Zap size={16} color="var(--accent-orange)" />
          <strong style={{ fontSize: 13 }}>Instant Role Previewer (1-Click Login)</strong>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button
            type="button"
            className="btn-primary"
            style={{ fontSize: 12, padding: '8px 14px', justifyContent: 'flex-start' }}
            onClick={() => {
              switchRole('USER');
              navigate('/events');
            }}
          >
            <span>Buyer / Seller: Ali K. → /events</span>
          </button>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <button
              type="button"
              className="btn-secondary"
              style={{ fontSize: 12, padding: '7px 12px', borderColor: 'var(--accent-orange-border)' }}
              onClick={() => {
                switchRole('ORGANIZER');
                navigate('/organizer');
              }}
            >
              <span>Organizer: Lumen Events</span>
            </button>
            <button
              type="button"
              className="btn-secondary"
              style={{ fontSize: 12, padding: '7px 12px', borderColor: 'var(--accent-emerald-border)' }}
              onClick={() => {
                switchRole('ADMIN');
                navigate('/admin');
              }}
            >
              <span>Admin: admin_01</span>
            </button>
          </div>
        </div>
      </div>

      {/* Login Card */}
      <div className="card">
        <div style={{ marginBottom: 20 }}>
          <h2 style={{ fontSize: 20, marginBottom: 4 }}>Welcome Back</h2>
          <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            Sign in to access your wallet and ticket vault
          </p>
        </div>

        <form onSubmit={handleLogin}>
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: 'block', fontSize: 12, color: 'var(--text-sub)', marginBottom: 6, fontWeight: 500 }}>
              Email Address
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={{ width: '100%', fontSize: 14 }}
              placeholder="ali@example.com"
            />
          </div>

          <div style={{ marginBottom: 20 }}>
            <label style={{ display: 'block', fontSize: 12, color: 'var(--text-sub)', marginBottom: 6, fontWeight: 500 }}>
              Password
            </label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={{ width: '100%', fontSize: 14 }}
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            className="btn-primary"
            style={{ width: '100%', padding: '12px', fontSize: 14 }}
          >
            Log in
          </button>
        </form>

        <div style={{ textAlign: 'center', marginTop: 18, paddingTop: 16, borderTop: '1px solid var(--border-subtle)', fontSize: 13, color: 'var(--text-muted)' }}>
          <span>Don't have an account? </span>
          <button
            onClick={() => navigate('/register')}
            style={{ color: 'var(--accent-orange)', fontWeight: 600, textDecoration: 'underline' }}
          >
            Create account
          </button>
        </div>
      </div>
    </div>
  );
}
