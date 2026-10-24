// PassFlow Zero-Mock Pure State Initializers
// All authoritative data is dynamically fetched from the PostgreSQL backend.

export const INITIAL_USERS = [];

export const INITIAL_EVENTS = [];

export const INITIAL_ORDER_BOOKS = {};

export const INITIAL_USER_TICKETS = [];

export const INITIAL_USER_ORDERS = [];

export const INITIAL_WALLET_STATE = {
  balance: 0,
  held: 0,
  available: 0,
  reservedBalance: 0,
  currency: 'INR',
  transactions: [],
};

export const INITIAL_NOTIFICATIONS = [];

export const INITIAL_ADMIN_DATA = {
  metrics: {
    ordersPerSecond: 0,
    avgLatencyMs: 0,
    openOrders: 0,
    failedSettlements: 0,
    totalVolume: 0,
    totalFees: 0,
  },
  health: {
    database: { status: 'CHECKING' },
    redis: { status: 'DISABLED' },
    websocket: { status: 'CONNECTING' },
    matchingEngine: { status: 'ONLINE' },
  },
  reconciliation: [],
  auditLogs: [],
  organizerApplications: [],
  failedSettlements: [],
  rules: [],
  botThreshold: 20,
  solvency: null,
  monitoringLogs: [],
};
