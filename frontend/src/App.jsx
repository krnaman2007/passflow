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

      {/* Production Responsive Footer */}
      <footer className="site-footer">
        <div className="site-footer-container">
          <div className="site-footer-top">
            <div className="site-footer-brand">
              <span className="brand-diamond">◆</span>
              <span className="brand-name">PassFlow Exchange</span>
              <span className="brand-exchange-tag">MAINNET v2.4</span>
            </div>
            <nav className="site-footer-links" aria-label="Footer Navigation">
              <button type="button" onClick={() => navigate('/events')}>Events</button>
              <button type="button" onClick={() => navigate('/market')}>Secondary Market</button>
              <button type="button" onClick={() => navigate('/solvency/verify')} className="solvency-link">
                <ShieldCheck size={14} color="var(--accent-emerald)" />
                <span>Proof of Solvency</span>
              </button>
              <button type="button" onClick={() => navigate('/organizer/apply')}>Organizers</button>
            </nav>
          </div>

          <div className="site-footer-bottom">
            <div className="site-footer-status">
              <span className="pulse-radar-dot" />
              <span className="status-live">All Core Systems Operational</span>
              <span className="status-divider">·</span>
              <span className="status-sub">Sub-millisecond L3 matching engine</span>
            </div>
            <div className="site-footer-copy">
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
