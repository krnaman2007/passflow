import React from 'react';
import { AppProvider, useApp } from './context/AppContext';
import Navbar from './components/Navbar';
import Toast from './components/Toast';
import Modals from './components/Modals';

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
  const { currentPath } = useApp();

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
    if (currentPath === '/organizer/events/new') return <OrganizerCreateEventPage />;
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

      <main style={{ flex: 1 }}>
        {renderCurrentPage()}
      </main>

      {/* Production Footer */}
      <footer
        style={{
          borderTop: '1px solid var(--border-subtle)',
          padding: '24px 20px',
          textAlign: 'center',
          color: 'var(--text-dim)',
          fontSize: 12,
          background: 'rgba(13, 15, 20, 0.95)'
        }}
      >
        <div style={{ maxWidth: 1200, margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: 'var(--accent-orange)' }}>◆</span>
            <span style={{ fontWeight: 600, color: 'var(--text-sub)' }}>Darkhold Exchange</span>
            <span>· High-Concurrence Ticket Market Engine</span>
          </div>

          <div style={{ display: 'flex', gap: 16 }}>
            <span>Solvency: 103.9% Backed</span>
            <span>·</span>
            <span>Anti-Scalping Protected</span>
            <span>·</span>
            <span>In-Memory Matching</span>
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
