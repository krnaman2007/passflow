import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { Lock, Mail, ArrowRight, Zap, ShieldCheck, ShieldAlert, AlertCircle, Loader2, UserCheck } from 'lucide-react';

export default function LoginPage() {
  const { login, navigate, showToast, routeParams } = useApp();

  const [isAdminMode, setIsAdminMode] = useState(() => Boolean(routeParams?.adminMode));
  const [email, setEmail] = useState(() => (routeParams?.adminMode ? 'admin@passflow.com' : 'ali@passflow.com'));
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (routeParams?.adminMode) {
      setIsAdminMode(true);
      setEmail('admin@passflow.com');
      setPassword('');
      setError(null);
    }
  }, [routeParams?.adminMode]);

  const toggleAdminMode = (toAdmin) => {
    setIsAdminMode(toAdmin);
    setError(null);
    if (toAdmin) {
      setEmail('admin@passflow.com');
      setPassword('');
    } else {
      setEmail('ali@passflow.com');
      setPassword('');
    }
  };

  const executeLogin = async (loginEmail, loginPassword, targetPath = null) => {
    if (!loginEmail || !loginEmail.trim()) {
      setError('Please provide your email address.');
      return;
    }
    if (!loginPassword) {
      setError('Please enter your password.');
      return;
    }

    setError(null);
    setLoading(true);
    try {
      const res = await login(loginEmail.trim(), loginPassword);
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
    executeLogin(email, password, isAdminMode ? '/admin' : null);
  };

  return (
    <div className="content-wrap" style={{ maxWidth: 520, paddingTop: 40 }}>
      {/* Brand Header */}
      <div style={{ textAlign: 'center', marginBottom: 28 }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10, fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 800, marginBottom: 8 }}>
          <span className="brand-diamond" style={{ fontSize: 28 }}>◆</span>
          <span className="text-gradient-white">PassFlow Exchange</span>
        </div>
        <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
          Fair-price secondary order book & primary event tickets
        </p>
      </div>

      {/* Quick Account Switcher Previewer */}
      <div
        className="card"
        style={{
          background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.08), rgba(23, 27, 38, 0.95))',
          borderColor: 'var(--accent-orange-border)',
          marginBottom: 24,
          padding: 16
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Zap size={16} color="var(--accent-orange)" />
            <strong style={{ fontSize: 13 }}>Quick Role Autofill (Verified Backend Accounts)</strong>
          </div>
          <span className="badge badge-orange" style={{ fontSize: 10 }}>DEV ASSIST</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button
            type="button"
            className="btn-primary"
            disabled={loading}
            style={{ fontSize: 12, padding: '8px 14px', justifyContent: 'flex-start' }}
            onClick={() => {
              toggleAdminMode(false);
              setEmail('ali@passflow.com');
              setPassword('Password123!');
            }}
          >
            <span>Fill Buyer / Seller: Ali Khan (ali@passflow.com)</span>
          </button>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <button
              type="button"
              className="btn-secondary"
              disabled={loading}
              style={{ fontSize: 12, padding: '7px 12px', borderColor: 'var(--accent-orange-border)' }}
              onClick={() => {
                toggleAdminMode(false);
                setEmail('organizer@livenation.com');
                setPassword('Password123!');
              }}
            >
              <span>Fill Organizer: Live Nation</span>
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={loading}
              style={{ fontSize: 12, padding: '7px 12px', borderColor: 'var(--accent-emerald-border)' }}
              onClick={() => {
                toggleAdminMode(true);
                setPassword('Password123!');
              }}
            >
              <span>Fill Admin: Platform Admin</span>
            </button>
          </div>
        </div>
      </div>

      {/* Login Card */}
      <div
        className="card stat-card-glow card-accent-top"
        style={{
          padding: 32,
          borderColor: isAdminMode ? 'rgba(99, 102, 241, 0.45)' : undefined,
          boxShadow: isAdminMode ? '0 12px 32px -8px rgba(99, 102, 241, 0.22)' : undefined
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
          <div>
            {isAdminMode ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span
                    className="badge badge-purple"
                    style={{
                      fontSize: 11,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 5,
                      padding: '3px 8px'
                    }}
                  >
                    <ShieldAlert size={12} />
                    ROOT ADMIN PORTAL
                  </span>
                </div>
                <h2 style={{ fontSize: 20, marginBottom: 4, color: '#e0e7ff' }}>Administrator Login</h2>
                <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                  Enter your platform administrator credentials to proceed.
                </p>
              </>
            ) : (
              <>
                <h2 style={{ fontSize: 20, marginBottom: 4 }}>Welcome Back</h2>
                <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                  Sign in with your verified backend credentials
                </p>
              </>
            )}
          </div>

          {/* Toggle Admin Mode / User Mode in top corner */}
          {isAdminMode ? (
            <button
              type="button"
              className="btn-secondary"
              style={{
                padding: '6px 14px',
                fontSize: 12,
                fontWeight: 600,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                borderRadius: 'var(--radius-full)',
                borderColor: 'var(--border-subtle)',
                color: 'var(--text-muted)',
                background: 'rgba(255, 255, 255, 0.04)'
              }}
              onClick={() => toggleAdminMode(false)}
              title="Return to standard user sign in"
            >
              <UserCheck size={14} />
              <span>← Switch to User Login</span>
            </button>
          ) : (
            <button
              type="button"
              className="btn-secondary"
              style={{
                padding: '6px 14px',
                fontSize: 12,
                fontWeight: 600,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                borderRadius: 'var(--radius-full)',
                borderColor: 'rgba(99, 102, 241, 0.4)',
                color: '#a5b4fc',
                background: 'rgba(99, 102, 241, 0.12)'
              }}
              onClick={() => toggleAdminMode(true)}
              title="Open Platform Administrator Login"
            >
              <ShieldCheck size={14} color="#818cf8" />
              <span>Login as Admin</span>
            </button>
          )}
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
              {isAdminMode ? 'Administrator Email' : 'Email Address'}
            </label>
            <div style={{ position: 'relative' }}>
              <input
                type="email"
                required
                disabled={loading}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                style={{
                  width: '100%',
                  fontSize: 14,
                  paddingLeft: 34,
                  borderColor: isAdminMode ? 'rgba(99, 102, 241, 0.35)' : undefined
                }}
                placeholder={isAdminMode ? 'admin@passflow.com' : 'you@example.com'}
              />
              <Mail
                size={16}
                color={isAdminMode ? '#818cf8' : 'var(--text-dim)'}
                style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }}
              />
            </div>
          </div>

          <div style={{ marginBottom: 20 }}>
            <label style={{ display: 'block', fontSize: 12, color: 'var(--text-sub)', marginBottom: 6, fontWeight: 500 }}>
              {isAdminMode ? 'Administrator Password' : 'Password'}
            </label>
            <div style={{ position: 'relative' }}>
              <input
                type="password"
                required
                disabled={loading}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={{
                  width: '100%',
                  fontSize: 14,
                  paddingLeft: 34,
                  borderColor: isAdminMode ? 'rgba(99, 102, 241, 0.35)' : undefined
                }}
                placeholder={isAdminMode ? 'Enter admin password' : '••••••••'}
                autoFocus={isAdminMode}
              />
              <Lock
                size={16}
                color={isAdminMode ? '#818cf8' : 'var(--text-dim)'}
                style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }}
              />
            </div>
          </div>

          <button
            type="submit"
            className="btn-primary"
            disabled={loading}
            style={{
              width: '100%',
              padding: '12px',
              fontSize: 14,
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              gap: 8,
              background: isAdminMode ? 'linear-gradient(135deg, #4f46e5, #6366f1)' : undefined,
              borderColor: isAdminMode ? 'rgba(99, 102, 241, 0.6)' : undefined
            }}
          >
            {loading ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                <span>Authenticating credentials...</span>
              </>
            ) : (
              <>
                <span>{isAdminMode ? 'Authenticate as Admin' : 'Log in'}</span>
                <ArrowRight size={16} />
              </>
            )}
          </button>
        </form>

        <div style={{ textAlign: 'center', marginTop: 18, paddingTop: 16, borderTop: '1px solid var(--border-subtle)', fontSize: 13, color: 'var(--text-muted)' }}>
          {isAdminMode ? (
            <span>
              Administrator access is restricted.{' '}
              <button
                type="button"
                onClick={() => toggleAdminMode(false)}
                style={{ color: 'var(--accent-orange)', fontWeight: 600, textDecoration: 'underline' }}
              >
                Back to User Login
              </button>
            </span>
          ) : (
            <span>
              Don't have an account?{' '}
              <button
                type="button"
                onClick={() => navigate('/register')}
                style={{ color: 'var(--accent-orange)', fontWeight: 600, textDecoration: 'underline' }}
              >
                Create account
              </button>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
