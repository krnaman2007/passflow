import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { User, ShieldCheck, Building, Zap, ArrowRight, AlertCircle, Loader2, CheckCircle2 } from 'lucide-react';

export default function RegisterPage() {
  const { register, login, navigate, showToast } = useApp();

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [selectedRole, setSelectedRole] = useState('USER'); // 'USER' | 'ORGANIZER' | 'ADMIN'
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleQuickLogin = async (quickEmail, quickPassword, targetPath) => {
    setError(null);
    setLoading(true);
    try {
      const res = await login(quickEmail, quickPassword);
      showToast(`Quick login as ${res.user.name || quickEmail} (${res.user.role})`, 'success');
      navigate(targetPath);
    } catch (err) {
      const msg = err.data?.message || err.message || 'Quick login failed';
      setError(msg);
      showToast(msg, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError('Please provide your full name');
      return;
    }
    if (!email.trim()) {
      setError('Please provide a valid email address');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters long');
      return;
    }

    setLoading(true);
    try {
      const res = await register({
        name: name.trim(),
        email: email.trim(),
        password,
        phone: phone.trim() || undefined,
        role: selectedRole,
      });

      showToast(`Account & Escrow Wallet created for ${res.user.name || name}!`, 'success');

      if (res.user.role === 'ADMIN') {
        navigate('/admin');
      } else if (res.user.role === 'ORGANIZER') {
        navigate('/organizer');
      } else {
        navigate('/events');
      }
    } catch (err) {
      const msg = err.data?.message || err.message || 'Registration failed. Please check your details.';
      setError(msg);
      showToast(msg, 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="content-wrap" style={{ maxWidth: 580, paddingTop: 36 }}>
      {/* Brand Header */}
      <div style={{ textAlign: 'center', marginBottom: 28 }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 24, fontWeight: 700, marginBottom: 6 }}>
          <span className="brand-diamond" style={{ fontSize: 26 }}>◆</span>
          <span className="text-gradient-white">PassFlow Exchange</span>
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
            <strong style={{ fontSize: 13 }}>Instant Role Previewer (1-Click Login)</strong>
          </div>
          <span className="badge badge-orange" style={{ fontSize: 10 }}>REAL BACKEND</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button
            type="button"
            className="btn-primary"
            disabled={loading}
            style={{ fontSize: 12, padding: '8px 14px', justifyContent: 'flex-start' }}
            onClick={() => handleQuickLogin('ali@passflow.com', 'Password123!', '/events')}
          >
            <span>Buyer / Seller: Ali Khan (ali@passflow.com) → /events</span>
          </button>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <button
              type="button"
              className="btn-secondary"
              disabled={loading}
              style={{ fontSize: 12, padding: '7px 12px', borderColor: 'var(--accent-orange-border)' }}
              onClick={() => handleQuickLogin('organizer@livenation.com', 'Password123!', '/organizer')}
            >
              <span>Organizer: Live Nation</span>
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={loading}
              style={{ fontSize: 12, padding: '7px 12px', borderColor: 'var(--accent-emerald-border)' }}
              onClick={() => handleQuickLogin('admin@passflow.com', 'Password123!', '/admin')}
            >
              <span>Admin: Platform Admin</span>
            </button>
          </div>
        </div>
      </div>

      {/* Create Account Card */}
      <div className="card stat-card-glow card-accent-top" style={{ padding: 32 }}>
        <div style={{ marginBottom: 20 }}>
          <h2 style={{ fontSize: 20, marginBottom: 4 }}>Create Account</h2>
          <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            Your custodial escrow wallet and ledger will be set up automatically.
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

        <form onSubmit={handleRegister}>
          <div className="grid-2" style={{ marginBottom: 14 }}>
            <div>
              <label style={{ display: 'block', fontSize: 12, color: 'var(--text-sub)', marginBottom: 6, fontWeight: 500 }}>
                Full Name
              </label>
              <input
                type="text"
                required
                disabled={loading}
                value={name}
                onChange={(e) => setName(e.target.value)}
                style={{ width: '100%', fontSize: 14 }}
                placeholder="Rohan Sharma"
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 12, color: 'var(--text-sub)', marginBottom: 6, fontWeight: 500 }}>
                Phone Number
              </label>
              <input
                type="tel"
                disabled={loading}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                style={{ width: '100%', fontSize: 14 }}
                placeholder="+91 98765 43210"
              />
            </div>
          </div>

          <div style={{ marginBottom: 14 }}>
            <label style={{ display: 'block', fontSize: 12, color: 'var(--text-sub)', marginBottom: 6, fontWeight: 500 }}>
              Email Address
            </label>
            <input
              type="email"
              required
              disabled={loading}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={{ width: '100%', fontSize: 14 }}
              placeholder="rohan@example.com"
            />
          </div>

          <div style={{ marginBottom: 18 }}>
            <label style={{ display: 'block', fontSize: 12, color: 'var(--text-sub)', marginBottom: 6, fontWeight: 500 }}>
              Password
            </label>
            <input
              type="password"
              required
              disabled={loading}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={{ width: '100%', fontSize: 14 }}
              placeholder="Minimum 6 characters"
            />
          </div>

          {/* Account Role Selector */}
          <div style={{ marginBottom: 22 }}>
            <label style={{ display: 'block', fontSize: 12, color: 'var(--text-sub)', marginBottom: 8, fontWeight: 600 }}>
              Select Account Role:
            </label>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {/* Role 1: User */}
              <div
                onClick={() => setSelectedRole('USER')}
                style={{
                  background: selectedRole === 'USER' ? 'var(--bg-card)' : 'var(--bg-app)',
                  border: '1px solid',
                  borderColor: selectedRole === 'USER' ? 'var(--accent-orange)' : 'var(--border-subtle)',
                  borderRadius: 'var(--radius-md)',
                  padding: 12,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease'
                }}
              >
                <div
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: '50%',
                    background: selectedRole === 'USER' ? 'var(--accent-orange-subtle)' : 'var(--bg-card)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                >
                  <User size={16} color={selectedRole === 'USER' ? '#f97316' : 'var(--text-dim)'} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <strong style={{ fontSize: 13, color: selectedRole === 'USER' ? 'var(--text-main)' : 'var(--text-sub)' }}>
                      User (Buyer / Seller)
                    </strong>
                    <span className="badge badge-orange" style={{ fontSize: 9, padding: '1px 5px' }}>DEFAULT</span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                    Primary ticket purchase, live resale order book trading, vault & escrow wallet
                  </div>
                </div>
                <input
                  type="radio"
                  name="userRole"
                  checked={selectedRole === 'USER'}
                  onChange={() => setSelectedRole('USER')}
                />
              </div>

              {/* Role 2: Organizer */}
              <div
                onClick={() => setSelectedRole('ORGANIZER')}
                style={{
                  background: selectedRole === 'ORGANIZER' ? 'var(--bg-card)' : 'var(--bg-app)',
                  border: '1px solid',
                  borderColor: selectedRole === 'ORGANIZER' ? 'var(--accent-orange)' : 'var(--border-subtle)',
                  borderRadius: 'var(--radius-md)',
                  padding: 12,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease'
                }}
              >
                <div
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: '50%',
                    background: selectedRole === 'ORGANIZER' ? 'var(--accent-orange-subtle)' : 'var(--bg-card)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                >
                  <Building size={16} color={selectedRole === 'ORGANIZER' ? '#f97316' : 'var(--text-dim)'} />
                </div>
                <div style={{ flex: 1 }}>
                  <strong style={{ fontSize: 13, color: selectedRole === 'ORGANIZER' ? 'var(--text-main)' : 'var(--text-sub)' }}>
                    Event Organizer (Promoter)
                  </strong>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                    Create events, configure ticket tiers & quotas, box office revenue analytics
                  </div>
                </div>
                <input
                  type="radio"
                  name="userRole"
                  checked={selectedRole === 'ORGANIZER'}
                  onChange={() => setSelectedRole('ORGANIZER')}
                />
              </div>

              {/* Role 3: Admin */}
              <div
                onClick={() => setSelectedRole('ADMIN')}
                style={{
                  background: selectedRole === 'ADMIN' ? 'var(--bg-card)' : 'var(--bg-app)',
                  border: '1px solid',
                  borderColor: selectedRole === 'ADMIN' ? 'var(--accent-emerald)' : 'var(--border-subtle)',
                  borderRadius: 'var(--radius-md)',
                  padding: 12,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease'
                }}
              >
                <div
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: '50%',
                    background: selectedRole === 'ADMIN' ? 'var(--accent-emerald-subtle)' : 'var(--bg-card)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                >
                  <ShieldCheck size={16} color={selectedRole === 'ADMIN' ? '#10b981' : 'var(--text-dim)'} />
                </div>
                <div style={{ flex: 1 }}>
                  <strong style={{ fontSize: 13, color: selectedRole === 'ADMIN' ? 'var(--text-main)' : 'var(--text-sub)' }}>
                    Platform Administrator
                  </strong>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                    System telemetry, reconciliation engine, anti-scalping caps & settlement recovery
                  </div>
                </div>
                <input
                  type="radio"
                  name="userRole"
                  checked={selectedRole === 'ADMIN'}
                  onChange={() => setSelectedRole('ADMIN')}
                />
              </div>
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
              background: 'linear-gradient(135deg, #059669 0%, #10b981 100%)',
              color: '#06281e',
              fontWeight: 700,
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              gap: 8
            }}
          >
            {loading ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                <span>Creating Account in Backend...</span>
              </>
            ) : (
              <>
                <span>Create Account as {selectedRole}</span>
                <ArrowRight size={16} />
              </>
            )}
          </button>
        </form>

        <div style={{ textAlign: 'center', marginTop: 18, paddingTop: 16, borderTop: '1px solid var(--border-subtle)', fontSize: 13, color: 'var(--text-muted)' }}>
          <span>Already have an account? </span>
          <button
            onClick={() => navigate('/login')}
            style={{ color: 'var(--accent-orange)', fontWeight: 600, textDecoration: 'underline' }}
          >
            Log in
          </button>
        </div>
      </div>
    </div>
  );
}
