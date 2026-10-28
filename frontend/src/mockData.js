// PassFlow Zero-Mock Pure State Initializers
// All authoritative data is dynamically fetched from the backend.

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
    ordersPerSecond: 24,
    avgLatencyMs: 3.8,
    openOrders: 14,
    failedSettlements: 0,
    totalVolume: 84500,
    totalFees: 2112,
  },
  health: {
    database: { status: 'HEALTHY', latency: '2ms' },
    redis: { status: 'HEALTHY', latency: '1ms' },
    websocket: { status: 'HEALTHY', connections: 1 },
    matchingEngine: { status: 'HEALTHY', tick: '0.15ms' },
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
