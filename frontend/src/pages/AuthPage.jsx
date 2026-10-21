import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { Lock, Mail, User, Phone, ArrowRight, ShieldCheck, Zap } from 'lucide-react';

export default function AuthPage({ defaultMode = 'LOGIN' }) {
  const { switchRole, navigate, showToast } = useApp();

  const [mode, setMode] = useState(defaultMode); // 'LOGIN' | 'REGISTER'

  // Form states
  const [email, setEmail] = useState('ali@example.com');
  const [password, setPassword] = useState('••••••••');
  const [name, setName] = useState('Ali K.');
  const [phone, setPhone] = useState('+91 98765 43210');

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

  const handleRegister = (e) => {
    e.preventDefault();
    switchRole('USER');
    showToast(`Account & Escrow Wallet created for ${name}!`, 'success');
    navigate('/events');
  };

  return (
    <div className="content-wrap" style={{ maxWidth: 880, paddingTop: 40 }}>
      {/* Brand Header */}
      <div style={{ textAlign: 'center', marginBottom: 32 }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 24, fontWeight: 700, marginBottom: 8 }}>
          <span className="brand-diamond" style={{ fontSize: 26 }}>◆</span>
          <span>Darkhold Exchange</span>
        </div>
        <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>
          Fair-price secondary order book & primary event tickets
        </p>
      </div>

      {/* Quick Demo Logins Banner */}
      <div
        className="card"
        style={{
          background: 'linear-gradient(135deg, rgba(249, 115, 22, 0.08), rgba(23, 27, 38, 0.95))',
          borderColor: 'var(--accent-orange-border)',
          marginBottom: 28,
          padding: 16
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <Zap size={16} color="var(--accent-orange)" />
          <strong style={{ fontSize: 13 }}>Instant Role Previewer (1-Click Login)</strong>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button
            className="btn-primary"
            style={{ fontSize: 12, padding: '7px 14px' }}
            onClick={() => {
              switchRole('USER');
              navigate('/events');
            }}
          >
            Buyer/Seller: Ali K. → /events
          </button>
          <button
            className="btn-secondary"
            style={{ fontSize: 12, padding: '7px 14px', borderColor: 'var(--accent-orange-border)' }}
            onClick={() => {
              switchRole('ORGANIZER');
              navigate('/organizer');
            }}
          >
            Organizer: Lumen Events → /organizer
          </button>
          <button
            className="btn-secondary"
            style={{ fontSize: 12, padding: '7px 14px', borderColor: 'var(--accent-emerald-border)' }}
            onClick={() => {
              switchRole('ADMIN');
              navigate('/admin');
            }}
          >
            Platform Admin: admin_01 → /admin
          </button>
        </div>
      </div>

      {/* Main 2-column Auth Cards (Login on Left, Register on Right) */}
      <div className="grid-2">
        {/* Login Card */}
        <div className="card">
          <div style={{ marginBottom: 20 }}>
            <h2 style={{ fontSize: 20, marginBottom: 4 }}>Welcome Back</h2>
            <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              Log in karke wallet aur tickets dekho
            </p>
          </div>

          <form onSubmit={handleLogin}>
            <div style={{ marginBottom: 14 }}>
              <label style={{ display: 'block', fontSize: 12, color: 'var(--text-sub)', marginBottom: 6 }}>
                Email
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                style={{ width: '100%' }}
              />
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', fontSize: 12, color: 'var(--text-sub)', marginBottom: 6 }}>
                Password
              </label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={{ width: '100%' }}
              />
            </div>

            <button type="submit" className="btn-primary" style={{ width: '100%', padding: '11px' }}>
              Log in
            </button>
          </form>
        </div>

        {/* Register Card */}
        <div className="card">
          <div style={{ marginBottom: 20 }}>
            <h2 style={{ fontSize: 20, marginBottom: 4 }}>Create Account</h2>
            <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              Wallet apne aap ban jaata hai
            </p>
          </div>

          <form onSubmit={handleRegister}>
            <div className="grid-2" style={{ marginBottom: 14 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, color: 'var(--text-sub)', marginBottom: 6 }}>
                  Name
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  style={{ width: '100%' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, color: 'var(--text-sub)', marginBottom: 6 }}>
                  Phone
                </label>
                <input
                  type="text"
                  required
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  style={{ width: '100%' }}
                />
              </div>
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={{ display: 'block', fontSize: 12, color: 'var(--text-sub)', marginBottom: 6 }}>
                Email
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                style={{ width: '100%' }}
              />
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', fontSize: 12, color: 'var(--text-sub)', marginBottom: 6 }}>
                Password
              </label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={{ width: '100%' }}
              />
            </div>

            <button
              type="submit"
              className="btn-primary"
              style={{
                width: '100%',
                padding: '11px',
                background: 'linear-gradient(135deg, #059669 0%, #10b981 100%)',
                color: '#06281e',
                fontWeight: 700
              }}
            >
              Create Account
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
