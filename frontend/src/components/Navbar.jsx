import React, { useState, useRef, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import {
  Wallet,
  User,
  Bell,
  Ticket,
  FileText,
  ShieldCheck,
  Building,
  LogOut,
  ChevronDown,
  TrendingUp,
  Calendar,
  Layers,
  Sparkles
} from 'lucide-react';

export default function Navbar() {
  const {
    currentPath,
    navigate,
    currentRole,
    switchRole,
    currentUser,
    wallet,
    notifications
  } = useApp();

  const [walletMenuOpen, setWalletMenuOpen] = useState(false);
  const [avatarMenuOpen, setAvatarMenuOpen] = useState(false);
  const walletRef = useRef(null);
  const avatarRef = useRef(null);

  const unreadCount = notifications.filter((n) => n.unread).length;

  // Close menus on outside click
  useEffect(() => {
    function handleClickOutside(e) {
      if (walletRef.current && !walletRef.current.contains(e.target)) {
        setWalletMenuOpen(false);
      }
      if (avatarRef.current && !avatarRef.current.contains(e.target)) {
        setAvatarMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <header className="navbar">
      {/* Left: Brand & Navigation Links */}
      <div className="nav-left">
        <div className="brand-badge" onClick={() => navigate('/events')}>
          <span className="brand-diamond">◆</span>
          <span>Darkhold</span>
        </div>

        <nav className="nav-links">
          <button
            className={`nav-item ${currentPath === '/events' ? 'active' : ''}`}
            onClick={() => navigate('/events')}
          >
            <Calendar size={15} />
            <span>Events</span>
          </button>

          <button
            className={`nav-item ${currentPath.startsWith('/market') ? 'active' : ''}`}
            onClick={() => navigate('/market/nightfall/general')}
          >
            <TrendingUp size={15} />
            <span>Market</span>
          </button>

          {currentRole !== 'PUBLIC' && (
            <button
              className={`nav-item ${currentPath === '/tickets' ? 'active' : ''}`}
              onClick={() => navigate('/tickets')}
            >
              <Ticket size={15} />
              <span>My tickets</span>
            </button>
          )}

          {currentRole === 'ORGANIZER' && (
            <button
              className={`nav-item ${currentPath.startsWith('/organizer') ? 'active' : ''}`}
              onClick={() => navigate('/organizer')}
            >
              <Building size={15} />
              <span>Organizer</span>
              <span className="nav-badge-tab">PRO</span>
            </button>
          )}

          {currentRole === 'ADMIN' && (
            <button
              className={`nav-item ${currentPath.startsWith('/admin') ? 'active' : ''}`}
              onClick={() => navigate('/admin')}
            >
              <ShieldCheck size={15} />
              <span>Admin</span>
              <span className="nav-badge-tab">ROOT</span>
            </button>
          )}
        </nav>
      </div>

      {/* Right: Role Switcher Simulator & User Controls */}
      <div className="nav-right">
        {/* Fast Role Simulator Pill (Allows testing all roles effortlessly) */}
        <div className="role-switcher-pill" title="Instant Role Previewer">
          <span style={{ fontSize: '10px', color: 'var(--text-dim)', padding: '0 6px', fontWeight: 600 }}>
            ROLE:
          </span>
          <button
            className={`role-chip ${currentRole === 'PUBLIC' ? 'active' : ''}`}
            onClick={() => switchRole('PUBLIC')}
          >
            Visitor
          </button>
          <button
            className={`role-chip ${currentRole === 'USER' ? 'active' : ''}`}
            onClick={() => switchRole('USER')}
          >
            User
          </button>
          <button
            className={`role-chip ${currentRole === 'ORGANIZER' ? 'active' : ''}`}
            onClick={() => switchRole('ORGANIZER')}
          >
            Organizer
          </button>
          <button
            className={`role-chip ${currentRole === 'ADMIN' ? 'active' : ''}`}
            onClick={() => switchRole('ADMIN')}
          >
            Admin
          </button>
        </div>

        {/* If Logged in: Wallet Pill & User Avatar */}
        {currentRole !== 'PUBLIC' ? (
          <>
            {/* Wallet Pill */}
            <div className="relative" ref={walletRef} style={{ position: 'relative' }}>
              <button
                className="wallet-pill"
                onClick={() => setWalletMenuOpen(!walletMenuOpen)}
              >
                <Wallet size={15} color="#10b981" />
                <span>
                  Wallet <span className="amount font-mono">${wallet.balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </span>
                <ChevronDown size={13} color="var(--text-dim)" />
              </button>

              {walletMenuOpen && (
                <div className="wallet-dropdown">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <span style={{ fontWeight: 600, fontSize: 13 }}>Escrow Wallet</span>
                    <span className="badge badge-green">LIVE READY</span>
                  </div>
                  <div className="wallet-stat-row">
                    <span style={{ color: 'var(--text-muted)' }}>Total Balance:</span>
                    <span className="val font-mono">${wallet.balance.toFixed(2)}</span>
                  </div>
                  <div className="wallet-stat-row">
                    <span style={{ color: 'var(--text-muted)' }}>Held in open orders:</span>
                    <span className="val font-mono" style={{ color: 'var(--accent-orange)' }}>${wallet.held.toFixed(2)}</span>
                  </div>
                  <div className="wallet-stat-row" style={{ paddingTop: 8, borderTop: '1px solid var(--border-subtle)' }}>
                    <span style={{ color: 'var(--text-sub)', fontWeight: 600 }}>Available to spend:</span>
                    <span className="val font-mono" style={{ color: 'var(--accent-emerald)', fontSize: 14 }}>
                      ${wallet.available.toFixed(2)}
                    </span>
                  </div>
                  <button
                    className="btn-primary"
                    style={{ width: '100%', marginTop: 14, fontSize: 12, padding: '7px 12px' }}
                    onClick={() => {
                      setWalletMenuOpen(false);
                      navigate('/wallet');
                    }}
                  >
                    Manage Wallet & Ledger
                  </button>
                </div>
              )}
            </div>

            {/* Notifications Shortcut */}
            <button
              className="nav-item"
              style={{ position: 'relative', padding: '8px' }}
              onClick={() => navigate('/notifications')}
              title="Notifications"
            >
              <Bell size={17} />
              {unreadCount > 0 && (
                <span
                  style={{
                    position: 'absolute',
                    top: 4,
                    right: 4,
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: 'var(--accent-orange)'
                  }}
                />
              )}
            </button>

            {/* Avatar Pill & Dropdown */}
            <div style={{ position: 'relative' }} ref={avatarRef}>
              <button
                className="avatar-btn"
                onClick={() => setAvatarMenuOpen(!avatarMenuOpen)}
              >
                <div className="avatar-circle">{currentUser?.avatar || 'U'}</div>
                <span style={{ fontSize: 13 }}>{currentUser?.name || 'User'}</span>
                <ChevronDown size={13} color="var(--text-dim)" />
              </button>

              {avatarMenuOpen && (
                <div className="avatar-dropdown-menu">
                  <div className="menu-header">
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{currentUser?.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{currentUser?.email}</div>
                    <div style={{ marginTop: 6, display: 'flex', gap: 6 }}>
                      <span className="badge badge-orange">{currentUser?.role}</span>
                      <span className="badge badge-neutral">KYC: {currentUser?.kycStatus}</span>
                    </div>
                  </div>

                  <button
                    className="menu-item"
                    onClick={() => {
                      setAvatarMenuOpen(false);
                      navigate('/tickets');
                    }}
                  >
                    <Ticket size={14} />
                    <span>My tickets</span>
                  </button>

                  <button
                    className="menu-item"
                    onClick={() => {
                      setAvatarMenuOpen(false);
                      navigate('/orders');
                    }}
                  >
                    <FileText size={14} />
                    <span>Orders & history</span>
                  </button>

                  <button
                    className="menu-item"
                    onClick={() => {
                      setAvatarMenuOpen(false);
                      navigate('/notifications');
                    }}
                  >
                    <Bell size={14} />
                    <span>Notifications ({unreadCount})</span>
                  </button>

                  <button
                    className="menu-item"
                    onClick={() => {
                      setAvatarMenuOpen(false);
                      navigate('/profile');
                    }}
                  >
                    <User size={14} />
                    <span>Profile & KYC</span>
                  </button>

                  {currentRole === 'USER' && (
                    <button
                      className="menu-item"
                      onClick={() => {
                        setAvatarMenuOpen(false);
                        navigate('/organizer/apply');
                      }}
                    >
                      <Sparkles size={14} color="#f97316" />
                      <span>Become an organizer</span>
                    </button>
                  )}

                  {currentRole === 'ORGANIZER' && (
                    <button
                      className="menu-item"
                      onClick={() => {
                        setAvatarMenuOpen(false);
                        navigate('/organizer');
                      }}
                    >
                      <Building size={14} color="#f97316" />
                      <span>Organizer Console</span>
                    </button>
                  )}

                  {currentRole === 'ADMIN' && (
                    <button
                      className="menu-item"
                      onClick={() => {
                        setAvatarMenuOpen(false);
                        navigate('/admin');
                      }}
                    >
                      <ShieldCheck size={14} color="#10b981" />
                      <span>Admin Console</span>
                    </button>
                  )}

                  <button
                    className="menu-item"
                    onClick={() => {
                      setAvatarMenuOpen(false);
                      navigate('/solvency/verify');
                    }}
                  >
                    <Layers size={14} />
                    <span>Proof of Solvency</span>
                  </button>

                  <div style={{ height: 1, background: 'var(--border-subtle)', margin: '4px 0' }} />

                  <button
                    className="menu-item danger"
                    onClick={() => {
                      setAvatarMenuOpen(false);
                      switchRole('PUBLIC');
                    }}
                  >
                    <LogOut size={14} />
                    <span>Log out</span>
                  </button>
                </div>
              )}
            </div>
          </>
        ) : (
          /* Visitor: Log in & Sign up buttons */
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button className="btn-secondary" onClick={() => navigate('/login')}>
              Log in
            </button>
            <button className="btn-primary" onClick={() => navigate('/register')}>
              Sign up
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
