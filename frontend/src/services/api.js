/**
 * PassFlow REST API Client
 * Authoritative connection layer between Frontend and Backend (Base: http://localhost:5001)
 */

export const BACKEND_URL =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_BACKEND_URL) ||
  'http://localhost:5001';

/**
 * Retrieves the stored auth token.
 */
export function getAuthToken() {
  if (typeof window === 'undefined') return null;
  return (
    localStorage.getItem('token') ||
    localStorage.getItem('passflow_token') ||
    sessionStorage.getItem('token') ||
    null
  );
}

/**
 * Saves auth token to persistent storage.
 */
export function setAuthToken(token) {
  if (typeof window === 'undefined') return;
  if (token) {
    localStorage.setItem('token', token);
    localStorage.setItem('passflow_token', token);
  } else {
    localStorage.removeItem('token');
    localStorage.removeItem('passflow_token');
  }
}

/**
 * Centralized fetch request wrapper.
 */
export async function apiRequest(endpoint, { method = 'GET', body, headers = {}, token, idempotencyKey } = {}) {
  const url = endpoint.startsWith('http') ? endpoint : `${BACKEND_URL}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;
  const authToken = token || getAuthToken();

  const requestHeaders = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...headers,
  };

  if (authToken) {
    requestHeaders['Authorization'] = authToken.startsWith('Bearer ') ? authToken : `Bearer ${authToken}`;
  }

  if (idempotencyKey) {
    requestHeaders['Idempotency-Key'] = idempotencyKey;
  }

  const options = {
    method,
    headers: requestHeaders,
  };

  if (body && method !== 'GET' && method !== 'HEAD') {
    options.body = typeof body === 'string' ? body : JSON.stringify(body);
  }

  try {
    const response = await fetch(url, options);
    const contentType = response.headers.get('content-type') || '';
    const isJson = contentType.includes('application/json');

    const data = isJson ? await response.json() : await response.text();

    if (!response.ok) {
      const errorMsg = data?.error?.message || data?.message || `HTTP ${response.status}: ${response.statusText}`;
      const error = new Error(errorMsg);
      error.status = response.status;
      error.data = data;
      throw error;
    }

    return data;
  } catch (err) {
    if (err.name === 'TypeError' && err.message.includes('Failed to fetch')) {
      const connErr = new Error(`Cannot connect to PassFlow backend at ${BACKEND_URL}. Ensure backend is running.`);
      connErr.status = 0;
      throw connErr;
    }
    throw err;
  }
}

// ==========================================
// System & Health Connection Checks
// ==========================================

export async function checkBackendHealth() {
  const start = Date.now();
  try {
    const res = await apiRequest('/health', { method: 'GET' });
    const latency = Date.now() - start;
    return {
      connected: true,
      status: res?.status || 'ok',
      latencyMs: latency,
      timestamp: res?.timestamp || new Date().toISOString(),
      url: BACKEND_URL,
    };
  } catch (err) {
    return {
      connected: false,
      error: err.message,
      latencyMs: Date.now() - start,
      url: BACKEND_URL,
    };
  }
}

export async function checkBackendReadiness() {
  try {
    return await apiRequest('/api/v1/health/ready', { method: 'GET' });
  } catch (err) {
    return { ready: false, error: err.message };
  }
}

// ==========================================
// Authentication & Profile Endpoints
// ==========================================

export const authApi = {
  register: (payload) => apiRequest('/api/v1/auth/register', { method: 'POST', body: payload }),
  login: (payload) => apiRequest('/api/v1/auth/login', { method: 'POST', body: payload }),
  refresh: (refreshToken) => apiRequest('/api/v1/auth/refresh', { method: 'POST', body: { refreshToken } }),
  logout: () => apiRequest('/api/v1/auth/logout', { method: 'POST' }),
  getProfile: () => apiRequest('/api/v1/users/me'),
  updateProfile: (payload) => apiRequest('/api/v1/users/me', { method: 'PUT', body: payload }),
  changePassword: (payload) => apiRequest('/api/v1/users/me/password', { method: 'PUT', body: payload }),
  submitKyc: (payload) => apiRequest('/api/v1/users/me/kyc', { method: 'POST', body: payload }),
  applyOrganizer: (payload) => apiRequest('/api/v1/organizers/apply', { method: 'POST', body: payload }),
  getOrganizerProfile: () => apiRequest('/api/v1/organizers/me'),
  getOrganizerEvents: () => apiRequest('/api/v1/organizers/me/events'),
};

// ==========================================
// Event & Category Management Endpoints
// ==========================================

export const eventsApi = {
  listEvents: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return apiRequest(`/api/v1/events${query ? `?${query}` : ''}`);
  },
  getEventById: (id) => apiRequest(`/api/v1/events/${id}`),
  createEvent: (payload) => apiRequest('/api/v1/events', { method: 'POST', body: payload }),
  updateEvent: (id, payload) => apiRequest(`/api/v1/events/${id}`, { method: 'PUT', body: payload }),
  updateEventStatus: (id, status) => apiRequest(`/api/v1/events/${id}/status`, { method: 'PATCH', body: { status } }),
  addCategory: (eventId, payload) => apiRequest(`/api/v1/events/${eventId}/categories`, { method: 'POST', body: payload }),
  getCategories: (eventId) => apiRequest(`/api/v1/events/${eventId}/categories`),
  updateCategory: (categoryId, payload) => apiRequest(`/api/v1/categories/${categoryId}`, { method: 'PUT', body: payload }),
  getCategoryInventory: (categoryId) => apiRequest(`/api/v1/categories/${categoryId}/inventory`),
  updateCategoryInventory: (categoryId, payload) => apiRequest(`/api/v1/categories/${categoryId}/inventory`, { method: 'PUT', body: payload }),
  getPriceHistory: (eventId, params = {}) => {
    const query = new URLSearchParams(params).toString();
    return apiRequest(`/api/v1/events/${eventId}/price-history${query ? `?${query}` : ''}`);
  },
};

// ==========================================
// Primary Ticket Purchase & Transfers
// ==========================================

export const ticketsApi = {
  purchaseTickets: (eventId, { categoryId, quantity, idempotencyKey }) =>
    apiRequest(`/api/v1/events/${eventId}/purchase`, {
      method: 'POST',
      body: { categoryId, quantity },
      idempotencyKey: idempotencyKey || `purchase-${Date.now()}`,
    }),
  getMyTickets: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return apiRequest(`/api/v1/tickets/me${query ? `?${query}` : ''}`);
  },
  getTicketById: (id) => apiRequest(`/api/v1/tickets/${id}`),
  getTicketOwnership: (id) => apiRequest(`/api/v1/tickets/${id}/ownership`),
  transferTicket: (ticketId, payload) => apiRequest(`/api/v1/tickets/${ticketId}/transfer`, { method: 'POST', body: payload }),
  getTransferStatus: (transferId) => apiRequest(`/api/v1/transfers/${transferId}`),
};

// ==========================================
// Orders & Secondary Order Book Endpoints
// ==========================================

export const ordersApi = {
  placeOrder: (payload, idempotencyKey) =>
    apiRequest('/api/v1/orders', {
      method: 'POST',
      body: payload,
      idempotencyKey: idempotencyKey || payload.idempotencyKey || `ord-${Date.now()}`,
    }),
  getOrders: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return apiRequest(`/api/v1/orders${query ? `?${query}` : ''}`);
  },
  getOrderById: (id) => apiRequest(`/api/v1/orders/${id}`),
  cancelOrder: (id, idempotencyKey) =>
    apiRequest(`/api/v1/orders/${id}`, {
      method: 'DELETE',
      idempotencyKey: idempotencyKey || `cancel-${id}`,
    }),
  getOrderTrades: (id) => apiRequest(`/api/v1/orders/${id}/trades`),
  getEventOrderbook: (eventId, categoryId) =>
    apiRequest(`/api/v1/events/${eventId}/orderbook?categoryId=${encodeURIComponent(categoryId)}`),
  getOrderbookDepth: (id) => apiRequest(`/api/v1/orderbook/${id}/depth`),
};

// ==========================================
// Trades & Settlement Endpoints
// ==========================================

export const tradesApi = {
  getMyTrades: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return apiRequest(`/api/v1/trades${query ? `?${query}` : ''}`);
  },
  getTradeById: (id) => apiRequest(`/api/v1/trades/${id}`),
  getEventTrades: (eventId, params = {}) => {
    const query = new URLSearchParams(params).toString();
    return apiRequest(`/api/v1/events/${eventId}/trades${query ? `?${query}` : ''}`);
  },
  getSettlementById: (id) => apiRequest(`/api/v1/settlements/${id}`),
  getEscrowById: (id) => apiRequest(`/api/v1/escrows/${id}`),
  retrySettlement: (id) => apiRequest(`/api/v1/settlements/${id}/retry`, { method: 'POST' }),
};

// ==========================================
// Wallet & Ledger Endpoints
// ==========================================

export const walletApi = {
  getWallet: () => apiRequest('/api/v1/wallet'),
  deposit: (amount, idempotencyKey, description) =>
    apiRequest('/api/v1/wallet/deposit', {
      method: 'POST',
      body: { amount, description },
      idempotencyKey: idempotencyKey || `dep-${Date.now()}`,
    }),
  withdraw: (amount, idempotencyKey, description) =>
    apiRequest('/api/v1/wallet/withdraw', {
      method: 'POST',
      body: { amount, description },
      idempotencyKey: idempotencyKey || `wth-${Date.now()}`,
    }),
  getTransactions: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return apiRequest(`/api/v1/wallet/transactions${query ? `?${query}` : ''}`);
  },
};

// ==========================================
// Market Data & Analytics Endpoints
// ==========================================

export const marketApi = {
  getMarketData: (eventId, categoryId) => apiRequest(`/api/v1/market/${eventId}/${categoryId}`),
  getMarketDepth: (eventId, categoryId, params = {}) => {
    const query = new URLSearchParams(params).toString();
    return apiRequest(`/api/v1/market/${eventId}/${categoryId}/depth${query ? `?${query}` : ''}`);
  },
  getRecentTrades: (eventId, categoryId, params = {}) => {
    const query = new URLSearchParams(params).toString();
    return apiRequest(`/api/v1/market/${eventId}/${categoryId}/trades${query ? `?${query}` : ''}`);
  },
  getMarketSummary: () => apiRequest('/api/v1/market/summary'),
};

// ==========================================
// Notifications & History Endpoints
// ==========================================

export const notificationsApi = {
  getNotifications: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return apiRequest(`/api/v1/notifications${query ? `?${query}` : ''}`);
  },
  markAsRead: (id) => apiRequest(`/api/v1/notifications/${id}/read`, { method: 'PATCH' }),
};

export const historyApi = {
  getTransactions: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return apiRequest(`/api/v1/history/transactions${query ? `?${query}` : ''}`);
  },
  getOrders: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return apiRequest(`/api/v1/history/orders${query ? `?${query}` : ''}`);
  },
  getTrades: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return apiRequest(`/api/v1/history/trades${query ? `?${query}` : ''}`);
  },
};

// ==========================================
// Dutch Auction Endpoints
// ==========================================

export const auctionsApi = {
  createAuction: (payload) => apiRequest('/api/v1/auctions', { method: 'POST', body: payload }),
  getAuction: (id) => apiRequest(`/api/v1/auctions/${id}`),
  getCurrentPrice: (id) => apiRequest(`/api/v1/auctions/${id}/price`),
  purchaseAuction: (id, idempotencyKey) =>
    apiRequest(`/api/v1/auctions/${id}/purchase`, {
      method: 'POST',
      idempotencyKey: idempotencyKey || `auc-${Date.now()}`,
    }),
};

// ==========================================
// ==========================================
// Solvency Endpoints
// ==========================================

export const solvencyApi = {
  verify: () => apiRequest('/api/v1/solvency/verify'),
  generateProof: (payload) => apiRequest('/api/v1/admin/solvency/generate', { method: 'POST', body: payload }),
};

// ==========================================
// Admin Console Endpoints
// ==========================================

export const adminApi = {
  getMetrics: () => apiRequest('/api/v1/admin/metrics'),
  getMonitoringHealth: () => apiRequest('/api/v1/admin/monitoring/health'),
  getMonitoringLogs: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return apiRequest(`/api/v1/admin/monitoring/logs${q ? `?${q}` : ''}`);
  },
  getReports: () => apiRequest('/api/v1/admin/reports'),
  getAuditLogs: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return apiRequest(`/api/v1/admin/audit-logs${q ? `?${q}` : ''}`);
  },
  getUsers: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return apiRequest(`/api/v1/admin/users${q ? `?${q}` : ''}`);
  },
  manageUser: (id, payload) => apiRequest(`/api/v1/admin/users/${id}`, { method: 'PATCH', body: payload }),
  verifyOrganizer: (id, payload) => apiRequest(`/api/v1/admin/organizers/${id}/verify`, { method: 'PATCH', body: payload }),
  getEvents: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return apiRequest(`/api/v1/admin/events${q ? `?${q}` : ''}`);
  },
  manageEvent: (id, payload) => apiRequest(`/api/v1/admin/events/${id}`, { method: 'PATCH', body: payload }),
  getReconciliation: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return apiRequest(`/api/v1/admin/reconciliation${q ? `?${q}` : ''}`);
  },
  runReconciliation: (payload = {}) => apiRequest('/api/v1/admin/reconciliation/run', { method: 'POST', body: payload }),
  generateSolvencyProof: (payload = {}) => apiRequest('/api/v1/admin/solvency/generate', { method: 'POST', body: payload }),
  getAntiScalpingRules: () => apiRequest('/api/v1/admin/rules/anti-scalping'),
  createAntiScalpingRule: (payload) => apiRequest('/api/v1/admin/rules/anti-scalping', { method: 'POST', body: payload }),
  updateAntiScalpingRule: (id, payload) => apiRequest(`/api/v1/admin/rules/anti-scalping/${id}`, { method: 'PUT', body: payload }),
  getAntiBotConfig: () => apiRequest('/api/v1/admin/rules/anti-bot'),
  updateAntiBotConfig: (payload) => apiRequest('/api/v1/admin/rules/anti-bot', { method: 'PUT', body: payload }),
  retrySettlement: (id) => apiRequest(`/api/v1/settlements/${id}/retry`, { method: 'POST' }),
};

// Export consolidated API
export const api = {
  checkBackendHealth,
  checkBackendReadiness,
  auth: authApi,
  events: eventsApi,
  tickets: ticketsApi,
  orders: ordersApi,
  trades: tradesApi,
  wallet: walletApi,
  market: marketApi,
  notifications: notificationsApi,
  history: historyApi,
  auctions: auctionsApi,
  solvency: solvencyApi,
  admin: adminApi,
};

export default api;
