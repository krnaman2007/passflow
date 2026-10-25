import React from 'react';
import { useApp } from '../context/AppContext';
import {
  Calendar,
  TrendingUp,
  Ticket,
  Building,
  Wallet,
  User,
  ShieldCheck,
  LogIn
} from 'lucide-react';

export default function MobileBottomNav() {
  const {
    currentPath,
    navigate,
    currentUser,
    currentRole,
    wallet,
    events
  } = useApp();

  const effectiveRole = currentUser ? (currentUser.role || 'USER') : (currentRole || 'PUBLIC');
  const isLoggedIn = effectiveRole !== 'PUBLIC';

  return (
    <nav className="mobile-bottom-nav" aria-label="Mobile Navigation">
      {/* 1. Events */}
      <button
        type="button"
        className={`mobile-nav-btn ${currentPath === '/' || currentPath === '/events' || currentPath.startsWith('/events/') ? 'active' : ''}`}
        onClick={() => navigate('/events')}
      >
        <Calendar size={18} />
        <span>Events</span>
      </button>

      {/* 2. Market */}
      <button
        type="button"
        className={`mobile-nav-btn ${currentPath.startsWith('/market') ? 'active' : ''}`}
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
        <TrendingUp size={18} />
        <span>Market</span>
      </button>

      {/* 3. My Tickets */}
      {isLoggedIn ? (
        <button
          type="button"
          className={`mobile-nav-btn ${currentPath === '/tickets' ? 'active' : ''}`}
          onClick={() => navigate('/tickets')}
        >
          <Ticket size={18} />
          <span>Tickets</span>
        </button>
      ) : null}

      {/* 4. Organizer or Admin or Apply */}
      {effectiveRole === 'ORGANIZER' ? (
        <button
          type="button"
          className={`mobile-nav-btn ${currentPath.startsWith('/organizer') ? 'active' : ''}`}
          onClick={() => navigate('/organizer')}
        >
          <Building size={18} />
          <span>Organizer</span>
        </button>
      ) : effectiveRole === 'ADMIN' ? (
        <button
          type="button"
          className={`mobile-nav-btn ${currentPath.startsWith('/admin') ? 'active' : ''}`}
          onClick={() => navigate('/admin')}
        >
          <ShieldCheck size={18} />
          <span>Admin</span>
        </button>
      ) : null}

      {/* 5. Wallet */}
      {isLoggedIn ? (
        <button
          type="button"
          className={`mobile-nav-btn ${currentPath === '/wallet' ? 'active' : ''}`}
          onClick={() => navigate('/wallet')}
        >
          <Wallet size={18} />
          <span>Wallet</span>
        </button>
      ) : (
        <button
          type="button"
          className={`mobile-nav-btn ${currentPath === '/login' || currentPath === '/register' ? 'active' : ''}`}
          onClick={() => navigate('/login')}
        >
          <LogIn size={18} />
          <span>Log In</span>
        </button>
      )}

      {/* 6. Profile if logged in */}
      {isLoggedIn ? (
        <button
          type="button"
          className={`mobile-nav-btn ${currentPath === '/profile' ? 'active' : ''}`}
          onClick={() => navigate('/profile')}
        >
          <User size={18} />
          <span>Profile</span>
        </button>
      ) : null}
    </nav>
  );
}
