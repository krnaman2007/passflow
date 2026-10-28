import React, { useState, useRef, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import NavLink from './NavLink';
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
  Sparkles,
  Menu,
  X
} from 'lucide-react';

export default function Navbar() {
  const {
    currentPath,
    navigate,
    currentRole,
    switchRole,
    currentUser,
    wallet,
    notifications,
    backendStatus,
    logout,
    events,
  } = useApp();

  const [walletMenuOpen, setWalletMenuOpen] = useState(false);
  const [avatarMenuOpen, setAvatarMenuOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const walletRef = useRef(null);
  const avatarRef = useRef(null);

  const unreadCount = notifications.filter((n) => n.unread).length;
  const effectiveRole = currentUser ? (currentUser.role || 'USER') : (currentRole || 'PUBLIC');

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

  // Close mobile menu on route change
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [currentPath]);

  return (
    <header className="navbar">
      {/* Left: Brand & Navigation Links */}
      <div className="nav-left">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div className="brand-badge" onClick={() => navigate('/events')}>
            <span className="brand-diamond">◆</span>
            <span>PassFlow</span>
            <span className="brand-exchange-tag">EXCHANGE</span>
          </div>
          <div className="exchange-status-pill" title="PassFlow Matching Engine is live and responsive">
            <span className="pulse-radar-dot"></span>
            <span>LIVE ENGINE</span>
          </div>



            

        </div>

        <nav className="nav-links">
          <NavLink to="/events" exact>
            <Calendar size={15} />
            <span>Events</span>
          </NavLink>

          <NavLink to="/market">
            <TrendingUp size={15} />
            <span>Market</span>
          </NavLink>

          {effectiveRole !== 'PUBLIC' && (
            <NavLink to="/tickets">
              <Ticket size={15} />
              <span>My tickets</span>
            </NavLink>
          )}

          {effectiveRole === 'ORGANIZER' && (
            <NavLink to="/organizer">
              <Building size={15} />
              <span>Organizer</span>
              <span className="nav-badge-tab">PRO</span>
            </NavLink>
          )}

          {effectiveRole === 'ADMIN' && (
            <NavLink to="/admin">
              <ShieldCheck size={15} />
              <span>Admin</span>
              <span className="nav-badge-tab">ROOT</span>
            </NavLink>
          )}
        </nav>
      </div>

      {/* Right: User Controls & Auth Buttons */}
      <div className="nav-right">
        {/* If Logged in: Wallet Pill & User Avatar */}
        {effectiveRole !== 'PUBLIC' ? (
          <>
            {/* Wallet Pill */}
            <div className="relative" ref={walletRef} style={{ position: 'relative' }}>
              <button
                className="wallet-pill"
                onClick={() => setWalletMenuOpen(!walletMenuOpen)}
              >
                <Wallet size={15} color="#10b981" />
                <span>
                  Wallet <span className="amount font-mono">₹{Number(wallet.balance || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
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
                    <span className="val font-mono">₹{Number(wallet.balance || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </div>
                  <div className="wallet-stat-row">
                    <span style={{ color: 'var(--text-muted)' }}>Held in open orders:</span>
                    <span className="val font-mono" style={{ color: 'var(--accent-orange)' }}>₹{Number(wallet.held || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </div>
                  <div className="wallet-stat-row" style={{ paddingTop: 8, borderTop: '1px solid var(--border-subtle)' }}>
                    <span style={{ color: 'var(--text-sub)', fontWeight: 600 }}>Available to spend:</span>
                    <span className="val font-mono" style={{ color: 'var(--accent-emerald)', fontSize: 14 }}>
                      ₹{Number(wallet.available || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
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

                  {effectiveRole === 'USER' && (
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

                  {effectiveRole === 'ORGANIZER' && (
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

                  {effectiveRole === 'ADMIN' && (
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
                      logout();
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
          <div className="nav-visitor-btns" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button className="btn-secondary" onClick={() => navigate('/login')}>
              Log in
            </button>
            <button className="btn-primary" onClick={() => navigate('/register')}>
              Sign up
            </button>
          </div>
        )}

        {/* Mobile Hamburger Toggle Button */}
        <button
          className="mobile-menu-toggle"
          aria-label="Toggle mobile menu"
          aria-expanded={mobileMenuOpen}
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
        >
          {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      {/* Mobile Drawer Menu (Overlay & Slide-down Drawer) */}
      {mobileMenuOpen && (
        <div className="mobile-drawer-overlay" onClick={() => setMobileMenuOpen(false)}>
          <div className="mobile-drawer-content" onClick={(e) => e.stopPropagation()}>
            <div className="mobile-drawer-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="brand-diamond">◆</span>
                <strong style={{ fontSize: 16 }}>PassFlow Menu</strong>
              </div>
              <button
                className="btn-pill"
                style={{ padding: '6px', color: 'var(--text-muted)' }}
                onClick={() => setMobileMenuOpen(false)}
              >
                <X size={18} />
              </button>
            </div>

            {/* User Profile Card inside Mobile Drawer */}
            {effectiveRole !== 'PUBLIC' && (
              <div className="mobile-user-card">
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div className="avatar-circle">{currentUser?.avatar || 'U'}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-main)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {currentUser?.name}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {currentUser?.email}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                  <span className="badge badge-orange">{currentUser?.role || effectiveRole}</span>
                  <span className="badge badge-green">Wallet: ₹{Number(wallet.balance || 0).toLocaleString('en-IN')}</span>
                </div>
              </div>
            )}

            <div className="mobile-drawer-links">
              <button
                className={`mobile-drawer-link ${currentPath === '/events' ? 'active' : ''}`}
                onClick={() => navigate('/events')}
              >
                <Calendar size={16} />
                <span>Events</span>
              </button>

              <button
                className={`mobile-drawer-link ${currentPath.startsWith('/market') ? 'active' : ''}`}
                onClick={() => {
                  if (Array.isArray(events) && events.length > 0) {
                    const firstEv = events[0];
                    const firstCat = firstEv.tiers?.[0]?.id || firstEv.categories?.[0]?.id || '';
                    navigate(firstCat ? `/market/${firstEv.id}/${firstCat}` : `/market/${firstEv.id}`, {
                      id: firstEv.id,
                      categoryId: firstCat,
                    });
                  } else {
                    navigate('/market');
                  }
                }}
              >
                <TrendingUp size={16} />
                <span>Market (Resale Order Book)</span>
              </button>

              {effectiveRole !== 'PUBLIC' && (
                <>
                  <button
                    className={`mobile-drawer-link ${currentPath === '/tickets' ? 'active' : ''}`}
                    onClick={() => navigate('/tickets')}
                  >
                    <Ticket size={16} />
                    <span>My Tickets</span>
                  </button>

                  <button
                    className={`mobile-drawer-link ${currentPath === '/wallet' ? 'active' : ''}`}
                    onClick={() => navigate('/wallet')}
                  >
                    <Wallet size={16} color="#10b981" />
                    <span>Wallet & Ledger (₹{Number(wallet.available || 0).toLocaleString('en-IN')})</span>
                  </button>

                  <button
                    className={`mobile-drawer-link ${currentPath === '/orders' ? 'active' : ''}`}
                    onClick={() => navigate('/orders')}
                  >
                    <FileText size={16} />
                    <span>Orders & Trade History</span>
                  </button>

                  <button
                    className={`mobile-drawer-link ${currentPath === '/notifications' ? 'active' : ''}`}
                    onClick={() => navigate('/notifications')}
                  >
                    <Bell size={16} />
                    <span>Notifications ({unreadCount})</span>
                  </button>

                  <button
                    className={`mobile-drawer-link ${currentPath === '/profile' ? 'active' : ''}`}
                    onClick={() => navigate('/profile')}
                  >
                    <User size={16} />
                    <span>Profile & KYC</span>
                  </button>
                </>
              )}

              {effectiveRole === 'USER' && (
                <button
                  className={`mobile-drawer-link ${currentPath === '/organizer/apply' ? 'active' : ''}`}
                  onClick={() => navigate('/organizer/apply')}
                >
                  <Sparkles size={16} color="var(--accent-orange)" />
                  <span>Become an Organizer</span>
                </button>
              )}

              {effectiveRole === 'ORGANIZER' && (
                <button
                  className={`mobile-drawer-link ${currentPath.startsWith('/organizer') ? 'active' : ''}`}
                  onClick={() => navigate('/organizer')}
                >
                  <Building size={16} color="var(--accent-orange)" />
                  <span>Organizer Console (PRO)</span>
                </button>
              )}

              {effectiveRole === 'ADMIN' && (
                <button
                  className={`mobile-drawer-link ${currentPath.startsWith('/admin') ? 'active' : ''}`}
                  onClick={() => navigate('/admin')}
                >
                  <ShieldCheck size={16} color="#10b981" />
                  <span>Admin Console (ROOT)</span>
                </button>
              )}

              <button
                className={`mobile-drawer-link ${currentPath.startsWith('/solvency') ? 'active' : ''}`}
                onClick={() => navigate('/solvency/verify')}
              >
                <Layers size={16} />
                <span>Proof of Solvency</span>
              </button>
            </div>

            {/* Auth Actions in Drawer */}
            <div className="mobile-drawer-footer">
              {effectiveRole !== 'PUBLIC' ? (
                <button
                  className="btn-danger-outline"
                  style={{ width: '100%', padding: '10px', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                  onClick={() => {
                    setMobileMenuOpen(false);
                    logout();
                  }}
                >
                  <LogOut size={15} />
                  <span>Log out of account</span>
                </button>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <button className="btn-secondary" style={{ width: '100%' }} onClick={() => navigate('/login')}>
                    Log in
                  </button>
                  <button className="btn-primary" style={{ width: '100%' }} onClick={() => navigate('/register')}>
                    Sign up
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
