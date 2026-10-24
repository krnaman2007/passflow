import React, { createContext, useContext, useState, useEffect } from 'react';
import {
  INITIAL_USERS,
  INITIAL_ORDER_BOOKS,
  INITIAL_USER_TICKETS,
  INITIAL_USER_ORDERS,
  INITIAL_WALLET_STATE,
  INITIAL_NOTIFICATIONS,
  INITIAL_ADMIN_DATA
} from '../mockData';
import { marketStream } from '../services/marketStream.js';
import { api, checkBackendHealth, BACKEND_URL } from '../services/api.js';
import { formatBackendEvent } from '../utils/eventAdapter.js';


const AppContext = createContext(null);

// Helper to normalize URL paths
function normalizePath(rawPath) {
  if (!rawPath) return '/events';
  let p = rawPath.trim();
  if (p.length > 1 && p.endsWith('/')) {
    p = p.slice(0, -1);
  }
  return p === '/' ? '/events' : p;
}

// Helper to extract route params from path
function extractRouteParams(path) {
  const parts = path.split('/').filter(Boolean);
  if (parts[0] === 'events' && parts[1]) {
    return { id: parts[1] };
  }
  if (parts[0] === 'market') {
    return {
      id: parts[1] || 'nightfall',
      categoryId: parts[2] || 'general'
    };
  }
  return {};
}

export function AppProvider({ children }) {
  // Navigation & Routing with full browser address bar sync
  const initialPath = typeof window !== 'undefined' ? normalizePath(window.location.pathname) : '/events';
  const [currentPath, setCurrentPath] = useState(initialPath);
  const [routeParams, setRouteParams] = useState({
    id: 'nightfall',
    categoryId: 'general',
    ...extractRouteParams(initialPath)
  });

  // Listen for browser Back / Forward buttons and address bar navigation
  useEffect(() => {
    const handlePopState = () => {
      const path = normalizePath(window.location.pathname);
      setCurrentPath(path);
      setRouteParams((prev) => ({
        ...prev,
        ...extractRouteParams(path)
      }));
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Listen for real-time WebSocket wallet updates (Spec: wallet:update)
  useEffect(() => {
    const unsubscribe = marketStream.onWalletUpdate((walletPayload) => {
      if (walletPayload) {
        setWallet((prev) => {
          const available = walletPayload.availableBalance != null
            ? Number(walletPayload.availableBalance) / 100
            : (walletPayload.available != null ? Number(walletPayload.available) / 100 : prev.available);
          const reserved = walletPayload.reservedBalance != null
            ? Number(walletPayload.reservedBalance) / 100
            : prev.held;
          const balance = walletPayload.totalBalance != null
            ? Number(walletPayload.totalBalance) / 100
            : (walletPayload.balance != null ? Number(walletPayload.balance) / 100 : available + reserved);

          return {
            ...prev,
            balance,
            available,
            held: reserved,
            reservedBalance: reserved,
          };
        });
      }
    });

    return () => {
      unsubscribe();
    };
  }, []);

  // Backend connection status state
  const [backendStatus, setBackendStatus] = useState({
    connected: false,
    checking: true,
    latencyMs: null,
    url: BACKEND_URL,
  });

  // Check Backend HTTP & WebSocket connection on mount and maintain heartbeat
  useEffect(() => {
    let isMounted = true;

    async function pingBackend() {
      try {
        const health = await checkBackendHealth();
        if (isMounted) {
          setBackendStatus({
            connected: health.connected,
            checking: false,
            latencyMs: health.latencyMs,
            url: health.url,
          });

          if (health.connected) {
            useAppStore.getState().setConnected(true);
            marketStream.initSocket();
          } else {
            useAppStore.getState().setConnected(false);
          }
        }
      } catch {
        if (isMounted) {
          setBackendStatus((prev) => ({ ...prev, connected: false, checking: false }));
          useAppStore.getState().setConnected(false);
        }
      }
    }

    pingBackend();
    const interval = setInterval(pingBackend, 15000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  // Role: 'PUBLIC' | 'USER' | 'ORGANIZER' | 'ADMIN'
  const [currentRole, setCurrentRole] = useState('USER');
  const [users, setUsers] = useState(INITIAL_USERS);

  // Entities State
  const [events, setEvents] = useState([]);

  // Fetch real events from PostgreSQL backend on mount
  useEffect(() => {
    let isMounted = true;
    async function loadLiveEvents() {
      try {
        const response = await api.events.listEvents();
        const rawList =
          response?.data?.events ||
          response?.events ||
          (Array.isArray(response?.data) ? response.data : []) ||
          (Array.isArray(response) ? response : []);

        if (Array.isArray(rawList) && rawList.length > 0 && isMounted) {
          const formatted = rawList.map((ev, idx) => formatBackendEvent(ev, idx));
          setEvents(formatted);
        }
      } catch (err) {
        console.warn('Backend events load deferred:', err.message);
      }
    }
    loadLiveEvents();
    return () => {
      isMounted = false;
    };
  }, []);
  const [orderBooks, setOrderBooks] = useState(INITIAL_ORDER_BOOKS);
  const [userTickets, setUserTickets] = useState(INITIAL_USER_TICKETS);
  const [userOrders, setUserOrders] = useState(INITIAL_USER_ORDERS);
  const [wallet, setWallet] = useState(INITIAL_WALLET_STATE);
  const [notifications, setNotifications] = useState(INITIAL_NOTIFICATIONS);
  const [adminData, setAdminData] = useState(INITIAL_ADMIN_DATA);

  // UI state: Drawers & Modals
  const [activeModal, setActiveModal] = useState(null); // { type, data }
  const [toasts, setToasts] = useState([]);

  // Toast Helper
  const showToast = (message, type = 'success') => {
    const id = Date.now() + Math.random().toString(36).substring(2, 6);
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  };

  const removeToast = (id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  // Full browser navigation handler (pushes state to address bar and updates page)
  const navigate = (path, params = {}) => {
    const cleanPath = normalizePath(path);
    if (typeof window !== 'undefined' && window.location.pathname !== cleanPath) {
      window.history.pushState({}, '', cleanPath);
    }
    setCurrentPath(cleanPath);
    setRouteParams((prev) => ({
      ...prev,
      ...extractRouteParams(cleanPath),
      ...params
    }));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Current active user object
  const currentUser = React.useMemo(() => {
    if (currentRole === 'PUBLIC') return null;
    if (currentRole === 'ORGANIZER') return users.find((u) => u.role === 'ORGANIZER') || users[1];
    if (currentRole === 'ADMIN') return users.find((u) => u.role === 'ADMIN') || users[2];
    return users.find((u) => u.id === 'usr_ali') || users[0];
  }, [currentRole, users]);

  // Fast Role Switcher
  const switchRole = (newRole) => {
    setCurrentRole(newRole);
    if (newRole === 'PUBLIC') {
      showToast('Switched to Visitor / Public view', 'info');
      if (['/tickets', '/wallet', '/orders', '/organizer', '/admin'].includes(currentPath)) {
        setCurrentPath('/events');
      }
    } else if (newRole === 'ORGANIZER') {
      showToast('Switched to Organizer: Lumen Events', 'info');
    } else if (newRole === 'ADMIN') {
      showToast('Switched to Admin: admin_01', 'info');
    } else {
      showToast('Switched to User: Ali K. (Buyer/Seller)', 'info');
    }
  };

  // Private order fill notifications from WebSocket
  useEffect(() => {
    const unsubFills = marketStream.onOrderFill((fill) => {
      const fillPricePaise = fill.fillPrice != null ? Number(fill.fillPrice) : null;
      const fillPriceStr =
        fillPricePaise != null
          ? (fillPricePaise >= 100 ? fillPricePaise / 100 : fillPricePaise).toFixed(2)
          : '0.00';

      if (fill.status === 'FILLED') {
        showToast(
          `Order #${fill.orderId} filled! ${fill.fillQuantity} tickets @ ₹${fillPriceStr}`,
          'success'
        );
      } else if (fill.status === 'PARTIALLY_FILLED') {
        showToast(
          `Order #${fill.orderId} partial fill: ${fill.fillQuantity} tickets @ ₹${fillPriceStr} (${fill.remainingQuantity} remaining)`,
          'info'
        );
      } else if (fill.status === 'CANCELLED') {
        showToast(`Order #${fill.orderId} cancelled`, 'info');
      }

      // Update userOrders state
      setUserOrders((prev) =>
        prev.map((ord) => {
          if (ord.id === fill.orderId) {
            return {
              ...ord,
              status: fill.status === 'PARTIALLY_FILLED' ? 'PARTIAL' : fill.status,
              filled: (ord.filled || 0) + (fill.fillQuantity || 0),
            };
          }
          return ord;
        })
      );
    });

    return () => {
      unsubFills();
    };
  }, []);

  // Sync authentication token with market streaming client
  useEffect(() => {
    if (!currentUser || currentRole === 'PUBLIC') {
      marketStream.clearAuthToken();
      useAppStore.getState().logout();
    } else {
      const storeToken = useAppStore.getState().token;
      if (storeToken) {
        marketStream.setAuthToken(storeToken);
      }
    }
  }, [currentUser, currentRole]);

  // Primary Purchase Handler (Flow A)
  const purchasePrimaryTickets = (eventId, selectedTiers) => {
    // selectedTiers: { [tierId]: qty }
    const event = events.find((e) => e.id === eventId);
    if (!event) return false;

    let totalCost = 0;
    let totalQty = 0;
    const tierSummaries = [];

    Object.entries(selectedTiers).forEach(([tierId, qty]) => {
      if (qty > 0) {
        const tier = event.tiers.find((t) => t.id === tierId);
        if (tier) {
          totalCost += tier.price * qty;
          totalQty += qty;
          tierSummaries.push(`${qty}x ${tier.name}`);
        }
      }
    });

    if (totalQty === 0) {
      showToast('Please select at least 1 ticket.', 'warning');
      return false;
    }

    if (wallet.available < totalCost) {
      showToast(`Insufficient balance: Need $${totalCost.toFixed(2)}, Available $${wallet.available.toFixed(2)}`, 'error');
      return false;
    }

    // Deduct wallet
    const newBalance = wallet.balance - totalCost;
    const newAvailable = wallet.available - totalCost;
    const newTx = {
      id: `tx_${Date.now()}`,
      type: 'PURCHASE',
      amount: -totalCost,
      status: 'Done',
      date: 'Just now',
      note: `${event.title} (${tierSummaries.join(', ')})`
    };

    setWallet((prev) => ({
      ...prev,
      balance: newBalance,
      available: newAvailable,
      transactions: [newTx, ...prev.transactions]
    }));

    // Create tickets
    const newTickets = [];
    Object.entries(selectedTiers).forEach(([tierId, qty]) => {
      const tier = event.tiers.find((t) => t.id === tierId);
      for (let i = 0; i < qty; i++) {
        const ticketNumber = Math.floor(10000 + Math.random() * 90000);
        newTickets.push({
          id: `TK-${ticketNumber}`,
          eventId: event.id,
          eventName: event.title,
          tier: tier.name,
          status: 'OWNED',
          pricePaid: tier.price,
          faceValue: tier.price,
          resaleCap: tier.cap || 120,
          qrPayload: `PASSFLOW-TICKET-${event.id.toUpperCase()}-TK-${ticketNumber}-AUTH`,
          ownershipChain: [
            { type: 'PRIMARY', user: currentUser?.name || 'Ali K.', action: `Bought from organizer, $${tier.price}`, date: 'Just now' }
          ]
        });
      }
    });

    setUserTickets((prev) => [...newTickets, ...prev]);

    // Update event inventory
    setEvents((prevEvents) =>
      prevEvents.map((ev) => {
        if (ev.id !== eventId) return ev;
        return {
          ...ev,
          tiers: ev.tiers.map((t) => {
            const purchased = selectedTiers[t.id] || 0;
            return {
              ...t,
              left: Math.max(0, t.left - purchased)
            };
          })
        };
      })
    );

    // Notification
    const notif = {
      id: `notif_${Date.now()}`,
      title: 'Tickets Purchased Successfully',
      body: `You bought ${totalQty} ticket(s) for ${event.title} (-$${totalCost.toFixed(2)})`,
      time: 'Just now',
      unread: true,
      type: 'PURCHASE'
    };
    setNotifications((prev) => [notif, ...prev]);

    showToast(`✓ ${totalQty} tickets added to your inventory!`, 'success');
    return true;
  };

  // Resale: Place Order (Flow B)
  const placeOrder = ({ side, type, price, qty, eventId = 'nightfall', tier = 'General' }) => {
    const numPrice = parseFloat(price);
    const numQty = parseInt(qty, 10);
    const total = numPrice * numQty;

    // Check anti-scalping cap
    const capRule = adminData.rules.find((r) => r.eventId === eventId && r.tier === tier && r.enabled);
    if (capRule && numPrice > capRule.maxPrice) {
      showToast(`Rejected: Price $${numPrice} exceeds anti-scalping cap ($${capRule.maxPrice})`, 'error');
      return false;
    }

    if (side === 'BUY') {
      if (wallet.available < total) {
        showToast(`Insufficient funds: Need $${total.toFixed(2)}, Available: $${wallet.available.toFixed(2)}`, 'error');
        return false;
      }

      // Hold funds
      setWallet((prev) => ({
        ...prev,
        held: prev.held + total,
        available: prev.available - total,
        transactions: [
          {
            id: `tx_${Date.now()}`,
            type: 'HOLD',
            amount: total,
            status: 'Held',
            date: 'Just now',
            note: `Buy ${numQty} @ $${numPrice.toFixed(2)} (${tier})`
          },
          ...prev.transactions
        ]
      }));

      const newOrder = {
        id: `ORD-${Math.floor(1000 + Math.random() * 9000)}`,
        eventId,
        eventName: 'Nightfall Festival',
        tier,
        side: 'BUY',
        type,
        qty: numQty,
        price: numPrice,
        filled: 0,
        status: 'OPEN',
        heldAmount: total,
        date: 'Just now'
      };

      setUserOrders((prev) => [newOrder, ...prev]);
      showToast(`Buy order placed: ${numQty}x ${tier} @ $${numPrice}. $${total.toFixed(2)} held in wallet.`, 'success');
      return true;
    } else {
      // SELL order
      // Check if user has an OWNED ticket in this category
      const ownedTicket = userTickets.find((t) => t.status === 'OWNED' && t.tier.toLowerCase() === tier.toLowerCase());
      if (!ownedTicket) {
        showToast(`You do not own any unlisted ${tier} tickets to sell.`, 'error');
        return false;
      }

      // Lock ticket as LISTED
      setUserTickets((prev) =>
        prev.map((t) => (t.id === ownedTicket.id ? { ...t, status: 'LISTED', listedPrice: numPrice } : t))
      );

      const newOrder = {
        id: `ORD-${Math.floor(1000 + Math.random() * 9000)}`,
        eventId,
        eventName: 'Nightfall Festival',
        tier,
        side: 'SELL',
        type,
        qty: 1,
        price: numPrice,
        filled: 0,
        status: 'OPEN',
        ticketId: ownedTicket.id,
        date: 'Just now'
      };

      setUserOrders((prev) => [newOrder, ...prev]);
      showToast(`Ticket #${ownedTicket.id} listed for resale at $${numPrice.toFixed(2)}!`, 'success');
      return true;
    }
  };

  // Cancel Order
  const cancelOrder = (orderId) => {
    const order = userOrders.find((o) => o.id === orderId);
    if (!order) return;

    if (order.side === 'BUY' && order.heldAmount) {
      // Release held funds
      setWallet((prev) => ({
        ...prev,
        held: Math.max(0, prev.held - order.heldAmount),
        available: prev.available + order.heldAmount,
        transactions: [
          {
            id: `tx_${Date.now()}`,
            type: 'RELEASE_HOLD',
            amount: order.heldAmount,
            status: 'Done',
            date: 'Just now',
            note: `Cancelled ${order.id} - Hold released`
          },
          ...prev.transactions
        ]
      }));
    } else if (order.side === 'SELL' && order.ticketId) {
      // Unlock ticket
      setUserTickets((prev) =>
        prev.map((t) => (t.id === order.ticketId ? { ...t, status: 'OWNED' } : t))
      );
    }

    setUserOrders((prev) =>
      prev.map((o) => (o.id === orderId ? { ...o, status: 'CANCELLED' } : o))
    );

    showToast(`Order ${orderId} cancelled. Funds / tickets unlocked.`, 'info');
  };

  // Ticket Operations: Sell from My Tickets
  const listTicketForSale = (ticketId, askPrice) => {
    const ticket = userTickets.find((t) => t.id === ticketId);
    if (!ticket) return false;

    if (askPrice > ticket.resaleCap) {
      showToast(`Ask price ($${askPrice}) exceeds the $${ticket.resaleCap} resale cap.`, 'error');
      return false;
    }

    setUserTickets((prev) =>
      prev.map((t) => (t.id === ticketId ? { ...t, status: 'LISTED', listedPrice: askPrice } : t))
    );

    const newOrder = {
      id: `ORD-${Math.floor(1000 + Math.random() * 9000)}`,
      eventId: ticket.eventId,
      eventName: ticket.eventName,
      tier: ticket.tier,
      side: 'SELL',
      type: 'LIMIT',
      qty: 1,
      price: askPrice,
      filled: 0,
      status: 'OPEN',
      ticketId: ticket.id,
      date: 'Just now'
    };

    setUserOrders((prev) => [newOrder, ...prev]);
    showToast(`Ticket #${ticket.id} listed at $${askPrice.toFixed(2)} on live order book!`, 'success');
    setActiveModal(null);
    return true;
  };

  // Cancel Listing
  const cancelTicketListing = (ticketId) => {
    const ticket = userTickets.find((t) => t.id === ticketId);
    if (!ticket) return;

    setUserTickets((prev) =>
      prev.map((t) => (t.id === ticketId ? { ...t, status: 'OWNED', listedPrice: null } : t))
    );

    // Cancel related order
    setUserOrders((prev) =>
      prev.map((o) => (o.ticketId === ticketId ? { ...o, status: 'CANCELLED' } : o))
    );

    showToast(`Listing cancelled for #${ticketId}. Ticket returned to Owned.`, 'info');
  };

  // Direct Transfer Ticket
  const transferTicket = (ticketId, recipientEmail) => {
    const ticket = userTickets.find((t) => t.id === ticketId);
    if (!ticket) return false;

    setUserTickets((prev) =>
      prev.map((t) =>
        t.id === ticketId
          ? {
              ...t,
              status: 'TRANSFER_PENDING',
              transferTo: recipientEmail,
              ownershipChain: [
                ...t.ownershipChain,
                { type: 'TRANSFER', user: recipientEmail, action: 'Direct transfer initiated', date: 'Just now' }
              ]
            }
          : t
      )
    );

    showToast(`Ticket #${ticketId} dispatched to ${recipientEmail} (Transfer Pending).`, 'success');
    setActiveModal(null);
    return true;
  };

  // Wallet Deposit & Withdraw
  const depositWallet = (amount) => {
    const num = parseFloat(amount);
    if (isNaN(num) || num <= 0) {
      showToast('Enter a valid deposit amount', 'warning');
      return;
    }

    setWallet((prev) => ({
      ...prev,
      balance: prev.balance + num,
      available: prev.available + num,
      transactions: [
        {
          id: `tx_${Date.now()}`,
          type: 'DEPOSIT',
          amount: num,
          status: 'Done',
          date: 'Just now',
          note: 'Mock Instant Gateway'
        },
        ...prev.transactions
      ]
    }));

    showToast(`+$${num.toFixed(2)} deposited into your wallet!`, 'success');
  };

  const withdrawWallet = (amount) => {
    const num = parseFloat(amount);
    if (isNaN(num) || num <= 0) {
      showToast('Enter a valid withdrawal amount', 'warning');
      return;
    }
    if (num > wallet.available) {
      showToast(`Cannot withdraw more than available balance ($${wallet.available.toFixed(2)})`, 'error');
      return;
    }

    setWallet((prev) => ({
      ...prev,
      balance: prev.balance - num,
      available: prev.available - num,
      transactions: [
        {
          id: `tx_${Date.now()}`,
          type: 'WITHDRAW',
          amount: -num,
          status: 'Done',
          date: 'Just now',
          note: 'ACH Bank Payout'
        },
        ...prev.transactions
      ]
    }));

    showToast(`-$${num.toFixed(2)} withdrawn to your bank account!`, 'info');
  };

  // Notifications Handlers
  const markNotificationRead = (id) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, unread: false } : n))
    );
  };

  const markAllNotificationsRead = () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, unread: false })));
    showToast('All notifications marked as read', 'info');
  };

  // Organizer Actions (Flow C)
  const applyForOrganizer = ({ orgName, email, website, volume }) => {
    const newApp = {
      id: `org_app_${Date.now()}`,
      name: orgName,
      email: email || currentUser?.email || 'user@example.com',
      status: 'PENDING',
      volume: volume || '$20k/mo',
      appliedAt: 'Today'
    };

    setAdminData((prev) => ({
      ...prev,
      organizerApplications: [newApp, ...prev.organizerApplications]
    }));

    // Update currentUser kyc/organizer status
    setUsers((prev) =>
      prev.map((u) => (u.id === currentUser?.id ? { ...u, organizerStatus: 'PENDING' } : u))
    );

    showToast('Organizer application submitted! Admin verification is pending.', 'success');
    navigate('/profile');
  };

  const createEventDraft = ({ title, date, venue, description, originalPrice }) => {
    const newId = title.toLowerCase().replace(/[^a-z0-9]/g, '-');
    const newEvent = {
      id: newId,
      title,
      tagline: description || 'Special Event',
      date: date || 'Upcoming',
      fullDate: date || 'Dec 20, 8:00 pm',
      doors: 'Doors 1 hour before',
      ageLimit: 'All Ages',
      venue: venue || 'Main Arena',
      city: 'Metropolis',
      category: 'Concert',
      gradient: 'from-amber-600/20 via-orange-700/30 to-purple-900/40',
      accentColor: '#f97316',
      primaryFrom: parseFloat(originalPrice) || 50,
      resaleFrom: 0,
      bestBid: 0,
      bestAsk: 0,
      lastTrade: 0,
      volume24h: 0,
      tiers: [
        { id: 'general', name: 'General Admission', price: parseFloat(originalPrice) || 50, left: 500, total: 500, held: 0, cap: (parseFloat(originalPrice) || 50) * 2 }
      ],
      status: 'DRAFT',
      organizer: currentUser?.name || 'Lumen Events'
    };

    setEvents((prev) => [newEvent, ...prev]);
    showToast(`Draft event "${title}" created. Now add categories or publish!`, 'success');
    return newEvent;
  };

  const addCategoryToEvent = (eventId, { name, price, quantity }) => {
    const p = parseFloat(price);
    const q = parseInt(quantity, 10);
    const tierId = name.toLowerCase().replace(/[^a-z0-9]/g, '-');

    setEvents((prev) =>
      prev.map((ev) => {
        if (ev.id !== eventId) return ev;
        const newTier = {
          id: tierId,
          name,
          price: p,
          left: q,
          total: q,
          held: 0,
          cap: Math.round(p * 2)
        };
        return {
          ...ev,
          tiers: [...ev.tiers, newTier]
        };
      })
    );

    showToast(`Category "${name}" (${q} tickets @ $${p}) added!`, 'success');
  };

  const publishEvent = (eventId) => {
    setEvents((prev) =>
      prev.map((ev) => (ev.id === eventId ? { ...ev, status: 'PUBLISHED' } : ev))
    );
    showToast(`Event published! It is now live on the public /events directory.`, 'success');
  };

  // Admin Actions (Flow D)
  const runReconciliation = () => {
    const today = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const newReport = {
      date: today,
      status: 'MATCHED',
      discrepancies: 0,
      checkedTrades: 1450,
      ledgerSum: '$168,290.00'
    };

    const newAudit = {
      id: `log_${Date.now()}`,
      admin: currentUser?.name || 'admin_01',
      action: 'Ran automated reconciliation engine (Matched 0 discrepancies)',
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      date: 'Today',
      status: 'SUCCESS'
    };

    setAdminData((prev) => ({
      ...prev,
      reconciliation: [newReport, ...prev.reconciliation],
      auditLogs: [newAudit, ...prev.auditLogs]
    }));

    showToast('Reconciliation executed: Ledger vs Settlements MATCHED (0 discrepancies)', 'success');
  };

  const retrySettlement = (settlementId) => {
    setAdminData((prev) => ({
      ...prev,
      metrics: {
        ...prev.metrics,
        failedSettlements: Math.max(0, prev.metrics.failedSettlements - 1)
      },
      failedSettlements: prev.failedSettlements.map((s) =>
        s.id === settlementId ? { ...s, status: 'COMPLETED' } : s
      ),
      auditLogs: [
        {
          id: `log_${Date.now()}`,
          admin: currentUser?.name || 'admin_01',
          action: `Retried settlement #${settlementId} (Escrow released & Trade settled)`,
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          date: 'Today',
          status: 'SUCCESS'
        },
        ...prev.auditLogs
      ]
    }));

    showToast(`Settlement #${settlementId} retried and COMPLETED.`, 'success');
  };

  const toggleCapRule = (ruleId) => {
    setAdminData((prev) => ({
      ...prev,
      rules: prev.rules.map((r) => (r.id === ruleId ? { ...r, enabled: !r.enabled } : r)),
      auditLogs: [
        {
          id: `log_${Date.now()}`,
          admin: currentUser?.name || 'admin_01',
          action: `Toggled anti-scalping rule #${ruleId}`,
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          date: 'Today',
          status: 'INFO'
        },
        ...prev.auditLogs
      ]
    }));
    showToast('Anti-scalping rule updated instantly in validation engine.', 'info');
  };

  const updateCapPrice = (ruleId, newMax) => {
    const val = parseFloat(newMax);
    setAdminData((prev) => ({
      ...prev,
      rules: prev.rules.map((r) => (r.id === ruleId ? { ...r, maxPrice: val } : r)),
      auditLogs: [
        {
          id: `log_${Date.now()}`,
          admin: currentUser?.name || 'admin_01',
          action: `Updated price cap rule #${ruleId} to $${val}`,
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          date: 'Today',
          status: 'INFO'
        },
        ...prev.auditLogs
      ]
    }));
    showToast(`Price cap updated to $${val}.`, 'success');
  };

  const verifyOrganizer = (appId) => {
    setAdminData((prev) => ({
      ...prev,
      organizerApplications: prev.organizerApplications.map((app) =>
        app.id === appId ? { ...app, status: 'VERIFIED' } : app
      ),
      auditLogs: [
        {
          id: `log_${Date.now()}`,
          admin: currentUser?.name || 'admin_01',
          action: `Verified organizer application #${appId}`,
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          date: 'Today',
          status: 'SUCCESS'
        },
        ...prev.auditLogs
      ]
    }));

    showToast(`Organizer verified! User now has access to the /organizer dashboard.`, 'success');
  };

  const rejectOrganizer = (appId) => {
    setAdminData((prev) => ({
      ...prev,
      organizerApplications: prev.organizerApplications.map((app) =>
        app.id === appId ? { ...app, status: 'REJECTED' } : app
      )
    }));
    showToast(`Organizer application #${appId} rejected.`, 'info');
  };

  const toggleUserSuspension = (userId) => {
    setUsers((prev) =>
      prev.map((u) => {
        if (u.id !== userId) return u;
        const newStatus = u.status === 'SUSPENDED' ? 'ACTIVE' : 'SUSPENDED';
        return { ...u, status: newStatus };
      })
    );
    showToast(`User status updated.`, 'info');
  };

  const approveUserKyc = (userId) => {
    setUsers((prev) =>
      prev.map((u) => (u.id === userId ? { ...u, kycStatus: 'VERIFIED' } : u))
    );
    showToast(`User #${userId} KYC approved.`, 'success');
  };

  const regenerateSolvencyProof = () => {
    setAdminData((prev) => ({
      ...prev,
      solvency: {
        ...prev.solvency,
        verifiedDate: 'Just now',
        merkleRoot: '0x' + Array.from({ length: 48 }, () => Math.floor(Math.random() * 16).toString(16)).join('')
      },
      auditLogs: [
        {
          id: `log_${Date.now()}`,
          admin: currentUser?.name || 'admin_01',
          action: 'Regenerated cryptographic Merkle Proof of Solvency',
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          date: 'Today',
          status: 'SUCCESS'
        },
        ...prev.auditLogs
      ]
    }));
    showToast('Solvency Merkle Tree recalculated. Proof is verified.', 'success');
  };

  return (
    <AppContext.Provider
      value={{
        currentPath,
        routeParams,
        navigate,
        currentRole,
        switchRole,
        currentUser,
        users,
        events,
        orderBooks,
        userTickets,
        userOrders,
        wallet,
        notifications,
        adminData,
        activeModal,
        setActiveModal,
        toasts,
        showToast,
        removeToast,
        // Actions
        purchasePrimaryTickets,
        placeOrder,
        cancelOrder,
        listTicketForSale,
        cancelTicketListing,
        transferTicket,
        depositWallet,
        withdrawWallet,
        markNotificationRead,
        markAllNotificationsRead,
        applyForOrganizer,
        createEventDraft,
        addCategoryToEvent,
        publishEvent,
        runReconciliation,
        retrySettlement,
        toggleCapRule,
        updateCapPrice,
        verifyOrganizer,
        rejectOrganizer,
        toggleUserSuspension,
        approveUserKyc,
        regenerateSolvencyProof,
        marketStream,
        // Backend Connectivity
        backendStatus,
        api,
        checkBackendHealth
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
}
