import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { Lock, Mail, ArrowRight, Zap, ShieldCheck, AlertCircle, Loader2 } from 'lucide-react';

export default function LoginPage() {
  const { login, navigate, showToast } = useApp();

  const [email, setEmail] = useState('ali@passflow.com');
  const [password, setPassword] = useState('Password123!');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const executeLogin = async (loginEmail, loginPassword, targetPath = null) => {
    setError(null);
    setLoading(true);
    try {
      const res = await login(loginEmail, loginPassword);
      showToast(`Welcome back, ${res.user.name || res.user.email}!`, 'success');
      if (targetPath) {
        navigate(targetPath);
      } else if (res.user.role === 'ADMIN') {
        navigate('/admin');
      } else if (res.user.role === 'ORGANIZER') {
        navigate('/organizer');
      } else {
        navigate('/events');
      }
    } catch (err) {
      const msg = err.data?.message || err.message || 'Login failed. Please verify credentials.';
      setError(msg);
      showToast(msg, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = (e) => {
    e.preventDefault();
    executeLogin(email, password);
  };

  return (
    <div className="content-wrap" style={{ maxWidth: 520, paddingTop: 40 }}>
      {/* Brand Header */}
      <div style={{ textAlign: 'center', marginBottom: 28 }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 24, fontWeight: 700, marginBottom: 6 }}>
          <span className="brand-diamond" style={{ fontSize: 26 }}>◆</span>
          <span>PassFlow Exchange</span>
        </div>
        <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
          Fair-price secondary order book & primary event tickets
        </p>
      </div>

      {/* Instant Role Previewer (1-Click Real Backend Login) */}
      <div
        className="card"
        style={{
          background: 'linear-gradient(135deg, rgba(249, 115, 22, 0.08), rgba(23, 27, 38, 0.95))',
          borderColor: 'var(--accent-orange-border)',
          marginBottom: 24,
          padding: 16
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Zap size={16} color="var(--accent-orange)" />
            <strong style={{ fontSize: 13 }}>Instant Role Previewer (Real Backend Auth)</strong>
          </div>
          <span className="badge badge-orange" style={{ fontSize: 10 }}>1-CLICK LOGIN</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button
            type="button"
            className="btn-primary"
            disabled={loading}
            style={{ fontSize: 12, padding: '8px 14px', justifyContent: 'flex-start' }}
            onClick={() => {
              setEmail('ali@passflow.com');
              setPassword('Password123!');
              executeLogin('ali@passflow.com', 'Password123!', '/events');
            }}
          >
            <span>Buyer / Seller: Ali Khan (ali@passflow.com) → /events</span>
          </button>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <button
              type="button"
              className="btn-secondary"
              disabled={loading}
              style={{ fontSize: 12, padding: '7px 12px', borderColor: 'var(--accent-orange-border)' }}
              onClick={() => {
                setEmail('organizer@livenation.com');
                setPassword('Password123!');
                executeLogin('organizer@livenation.com', 'Password123!', '/organizer');
              }}
            >
              <span>Organizer: Live Nation</span>
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={loading}
              style={{ fontSize: 12, padding: '7px 12px', borderColor: 'var(--accent-emerald-border)' }}
              onClick={() => {
                setEmail('admin@passflow.com');
                setPassword('Password123!');
                executeLogin('admin@passflow.com', 'Password123!', '/admin');
              }}
            >
              <span>Admin: Platform Admin</span>
            </button>
          </div>
        </div>
      </div>

      {/* Login Card */}
      <div className="card">
        <div style={{ marginBottom: 20 }}>
          <h2 style={{ fontSize: 20, marginBottom: 4 }}>Welcome Back</h2>
          <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            Sign in with your verified backend credentials
          </p>
        </div>

        {error && (
          <div
            style={{
              padding: '10px 14px',
              borderRadius: 'var(--radius-md)',
              background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              color: '#f87171',
              fontSize: 13,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginBottom: 16
            }}
          >
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleLogin}>
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: 'block', fontSize: 12, color: 'var(--text-sub)', marginBottom: 6, fontWeight: 500 }}>
              Email Address
            </label>
            <div style={{ position: 'relative' }}>
              <input
                type="email"
                required
                disabled={loading}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                style={{ width: '100%', fontSize: 14, paddingLeft: 34 }}
                placeholder="ali@passflow.com"
              />
              <Mail
                size={16}
                color="var(--text-dim)"
                style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }}
              />
            </div>
          </div>

          <div style={{ marginBottom: 20 }}>
            <label style={{ display: 'block', fontSize: 12, color: 'var(--text-sub)', marginBottom: 6, fontWeight: 500 }}>
              Password
            </label>
            <div style={{ position: 'relative' }}>
              <input
                type="password"
                required
                disabled={loading}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={{ width: '100%', fontSize: 14, paddingLeft: 34 }}
                placeholder="••••••••"
              />
              <Lock
                size={16}
                color="var(--text-dim)"
                style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }}
              />
            </div>
          </div>

          <button
            type="submit"
            className="btn-primary"
            disabled={loading}
            style={{ width: '100%', padding: '12px', fontSize: 14, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8 }}
          >
            {loading ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                <span>Signing in...</span>
              </>
            ) : (
              <>
                <span>Log in</span>
                <ArrowRight size={16} />
              </>
            )}
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
