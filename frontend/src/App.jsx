import React, { useEffect, useRef } from 'react';
import { ShieldCheck, Activity, Layers } from 'lucide-react';
import { AppProvider, useApp } from './context/AppContext';
import Navbar from './components/Navbar';
import Toast from './components/Toast';
import Modals from './components/Modals';
import MobileBottomNav from './components/MobileBottomNav';

// Pages
import EventsPage from './pages/EventsPage';
import EventDetailPage from './pages/EventDetailPage';
import MarketPage from './pages/MarketPage';
import TicketsPage from './pages/TicketsPage';
import WalletPage from './pages/WalletPage';
import OrdersHistoryPage from './pages/OrdersHistoryPage';
import NotificationsPage from './pages/NotificationsPage';
import ProfilePage from './pages/ProfilePage';
import OrganizerApplyPage from './pages/OrganizerApplyPage';
import OrganizerDashboardPage from './pages/OrganizerDashboardPage';
import OrganizerCreateEventPage from './pages/OrganizerCreateEventPage';
import AdminConsolePage from './pages/AdminConsolePage';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import SolvencyVerifyPage from './pages/SolvencyVerifyPage';

import './App.css';

function MainRouter() {
  const { currentPath, navigate } = useApp();
  const pageRef = useRef(null);
  useEffect(() => {
    const el = pageRef.current;
    if (!el) return;
    el.classList.remove('page-enter-active');
    el.classList.add('page-enter');
    requestAnimationFrame(() => {
      el.classList.add('page-enter-active');
    });
  }, [currentPath]);

  const renderCurrentPage = () => {
    if (currentPath === '/' || currentPath === '/events') return <EventsPage />;
    if (currentPath.startsWith('/events/')) return <EventDetailPage />;
    if (currentPath === '/market' || currentPath.startsWith('/market/')) return <MarketPage />;
    if (currentPath === '/tickets' || currentPath.startsWith('/tickets/')) return <TicketsPage />;
    if (currentPath === '/wallet' || currentPath.startsWith('/wallet/')) return <WalletPage />;
    if (currentPath === '/orders' || currentPath.startsWith('/orders/') || currentPath === '/history' || currentPath.startsWith('/history/')) return <OrdersHistoryPage />;
    if (currentPath === '/notifications' || currentPath.startsWith('/notifications/')) return <NotificationsPage />;
    if (currentPath === '/profile' || currentPath.startsWith('/profile/')) return <ProfilePage />;
    if (currentPath === '/organizer/apply') return <OrganizerApplyPage />;
    if (currentPath === '/organizer/events/new' || currentPath === '/organizer/create-event') return <OrganizerCreateEventPage />;
    if (currentPath === '/organizer' || currentPath.startsWith('/organizer/')) return <OrganizerDashboardPage />;
    if (currentPath.startsWith('/admin')) return <AdminConsolePage />;
    if (currentPath === '/login') return <LoginPage />;
    if (currentPath === '/register' || currentPath === '/signup') return <RegisterPage />;
    if (currentPath === '/solvency' || currentPath.startsWith('/solvency/')) return <SolvencyVerifyPage />;
    return <EventsPage />;
  };

  return (
    <div className="app-container">
      <Navbar />
      <Toast />
      <Modals />

      <main className="app-main-content">
        <div key={currentPath} className="page-transition-wrapper">
          {renderCurrentPage()}
        </div>
      </main>

      <MobileBottomNav />

      {/* Production Footer */}
      <footer
        style={{
          borderTop: '1px solid var(--border-subtle)',
          padding: '24px 20px',
          textAlign: 'center',
          color: 'var(--text-dim)',
          fontSize: 12,
          background: 'rgba(8, 10, 16, 0.92)',
          backdropFilter: 'var(--blur-strong)',
          WebkitBackdropFilter: 'var(--blur-strong)',
        }}
      >
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span className="brand-diamond" style={{ fontSize: 18 }}>◆</span>
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15, color: 'var(--text-main)' }}>
                PassFlow Exchange
              </span>
              <span className="brand-exchange-tag">MAINNET v2.4</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', fontSize: 13 }}>
              <button onClick={() => navigate('/events')} style={{ color: 'var(--text-sub)' }}>Events</button>
              <span style={{ color: 'var(--border-strong)' }}>·</span>
              <button onClick={() => navigate('/market')} style={{ color: 'var(--text-sub)' }}>Secondary Market</button>
              <span style={{ color: 'var(--border-strong)' }}>·</span>
              <button onClick={() => navigate('/solvency/verify')} style={{ color: 'var(--text-sub)', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <ShieldCheck size={14} color="var(--accent-emerald)" />
                <span>Proof of Solvency</span>
              </button>
              <span style={{ color: 'var(--border-strong)' }}>·</span>
              <button onClick={() => navigate('/organizer/apply')} style={{ color: 'var(--text-sub)' }}>Organizers</button>
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border-subtle)', fontSize: 12, color: 'var(--text-dim)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="pulse-radar-dot" style={{ width: 5, height: 5 }} />
              <span style={{ color: 'var(--accent-emerald)', fontWeight: 500 }}>All Core Systems Operational</span>
              <span>·</span>
              <span>Sub-millisecond L3 matching engine</span>
            </div>
            <div>
              <span>&copy; {new Date().getFullYear()} PassFlow Exchange. Provably solvent fair-price event ticketing.</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <MainRouter />
    </AppProvider>
  );
}
