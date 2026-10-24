// PassFlow Exchange Reference Data & State Initializers
// Aligned directly with real PostgreSQL database entities

export const INITIAL_USERS = [
  {
    id: 'usr_ali_001',
    name: 'Ali Khan',
    email: 'ali@passflow.com',
    phone: '+91 98765 43210',
    role: 'USER',
    kycStatus: 'VERIFIED',
    status: 'ACTIVE',
    avatar: 'AK',
  },
  {
    id: 'usr_livenation',
    name: 'Live Nation India',
    email: 'organizer@livenation.com',
    phone: '+91 98200 11223',
    role: 'ORGANIZER',
    kycStatus: 'VERIFIED',
    status: 'ACTIVE',
    avatar: 'LN',
  },
  {
    id: 'usr_admin',
    name: 'System Administrator',
    email: 'admin@passflow.com',
    phone: '+91 99999 00001',
    role: 'ADMIN',
    kycStatus: 'VERIFIED',
    status: 'ACTIVE',
    avatar: 'AD',
  },
  {
    id: 'usr_bcci',
    name: 'BCCI Ticketing Operations',
    email: 'ticketing@bcci.tv',
    phone: '+91 98200 44556',
    role: 'ORGANIZER',
    kycStatus: 'VERIFIED',
    status: 'ACTIVE',
    avatar: 'BC',
  },
];

export const INITIAL_EVENTS = [];

export const INITIAL_ORDER_BOOKS = {};

export const INITIAL_USER_TICKETS = [
  {
    id: 'TK-84920',
    eventId: 'coldplay-mumbai',
    eventName: 'Coldplay: Music of the Spheres World Tour',
    tier: 'Standing Floor (South Gate)',
    status: 'OWNED',
    pricePaid: 6500,
    faceValue: 6500,
    resaleCap: 7150,
    venue: 'DY Patil Stadium, Navi Mumbai',
    date: 'Dec 18, 2026',
    qrPayload: 'PASSFLOW-TICKET-COLDPLAY-TK-84920-VERIFIED-SECURE',
    ownershipChain: [
      { type: 'PRIMARY', user: 'Ali Khan', action: 'Bought from Live Nation, ₹6,500', date: 'Just now' },
    ],
  },
  {
    id: 'TK-59102',
    eventId: 'diljit-delhi',
    eventName: 'Diljit Dosanjh — Dil-Luminati Tour Arena Edition',
    tier: 'Gold Seated (Lower Bowl)',
    status: 'OWNED',
    pricePaid: 7000,
    faceValue: 7000,
    resaleCap: 7700,
    venue: 'Indira Gandhi Indoor Stadium, New Delhi',
    date: 'Nov 28, 2026',
    qrPayload: 'PASSFLOW-TICKET-DILJIT-TK-59102-VERIFIED-SECURE',
    ownershipChain: [
      { type: 'PRIMARY', user: 'Ali Khan', action: 'Bought from organizer, ₹7,000', date: 'Yesterday' },
    ],
  },
  {
    id: 'TK-33918',
    eventId: 'arijit-delhi',
    eventName: 'Arijit Singh Symphony Live 2026',
    tier: 'Gold Circle Standing',
    status: 'LISTED',
    listedPrice: 4800,
    pricePaid: 4500,
    faceValue: 4500,
    resaleCap: 4950,
    venue: 'Jawaharlal Nehru Stadium, New Delhi',
    date: 'Nov 15, 2026',
    qrPayload: 'PASSFLOW-TICKET-ARIJIT-TK-33918-LISTED-FOR-RESALE',
    ownershipChain: [
      { type: 'PRIMARY', user: 'Ali Khan', action: 'Bought from organizer, ₹4,500', date: 'Oct 20, 2026' },
      { type: 'RESALE', user: 'Ali Khan', action: 'Listed on PassFlow Exchange @ ₹4,800', date: 'Just now' },
    ],
  },
  {
    id: 'TK-12849',
    eventId: 'india-aus-kolkata',
    eventName: 'ICC T20 Championship: India vs Australia',
    tier: 'Lower Tier Pavilion',
    status: 'OWNED',
    pricePaid: 5000,
    faceValue: 5000,
    resaleCap: 5500,
    venue: 'Eden Gardens, Kolkata',
    date: 'Jan 10, 2027',
    qrPayload: 'PASSFLOW-TICKET-IND-AUS-TK-12849-VERIFIED-SECURE',
    ownershipChain: [
      { type: 'PRIMARY', user: 'Ali Khan', action: 'Bought from BCCI Official, ₹5,000', date: 'Oct 18, 2026' },
    ],
  },
];

export const INITIAL_USER_ORDERS = [
  {
    id: 'ORD-7721',
    eventId: 'coldplay-mumbai',
    eventName: 'Coldplay: Music of the Spheres World Tour',
    tier: 'Standing Floor (South Gate)',
    side: 'BUY',
    type: 'LIMIT',
    qty: 1,
    price: 6400,
    filled: 0,
    status: 'OPEN',
    heldAmount: 6400,
    date: 'Today, 09:30 AM',
  },
  {
    id: 'ORD-6210',
    eventId: 'arijit-delhi',
    eventName: 'Arijit Singh Symphony Live 2026',
    tier: 'Gold Circle Standing',
    side: 'SELL',
    type: 'LIMIT',
    qty: 1,
    price: 4800,
    filled: 0,
    status: 'OPEN',
    ticketId: 'TK-33918',
    date: 'Today, 08:45 AM',
  },
];

export const INITIAL_WALLET_STATE = {
  balance: 56400.00,
  held: 6400.00,
  available: 50000.00,
  transactions: [
    { id: 'tx_5', type: 'HOLD', amount: 6400.00, status: 'Held', date: 'Today', note: 'Buy 1 @ ₹6,400 (Coldplay Standing Floor)' },
    { id: 'tx_4', type: 'DEPOSIT', amount: 25000.00, status: 'Done', date: 'Yesterday', note: 'UPI Transfer (HDFC Bank)' },
    { id: 'tx_3', type: 'PURCHASE', amount: -6500.00, status: 'Done', date: 'Oct 22', note: 'Coldplay Standing Floor (1x Primary)' },
    { id: 'tx_2', type: 'PURCHASE', amount: -7000.00, status: 'Done', date: 'Oct 20', note: 'Diljit Dosanjh Lower Bowl (1x Primary)' },
    { id: 'tx_1', type: 'DEPOSIT', amount: 44900.00, status: 'Done', date: 'Oct 15', note: 'NetBanking IMPS Deposit' },
  ],
};

export const INITIAL_NOTIFICATIONS = [
  {
    id: 'notif_1',
    title: 'Coldplay Tickets Added to Vault',
    body: 'Your 1x Standing Floor ticket for Coldplay: Music of the Spheres World Tour (Mumbai) is confirmed and cryptographically verified.',
    time: '20m ago',
    unread: true,
    type: 'PURCHASE',
  },
  {
    id: 'notif_2',
    title: 'Resale Order Resting in Book',
    body: 'Your buy limit order for 1x Standing Floor @ ₹6,400 is active on the live order book.',
    time: '1h ago',
    unread: true,
    type: 'ORDER',
  },
  {
    id: 'notif_3',
    title: 'Diljit Dosanjh Fan Pit Sold Out',
    body: 'Primary inventory has exhausted. Secondary resale market is now open under 110% anti-scalping price caps.',
    time: '3h ago',
    unread: false,
    type: 'MARKET',
  },
];

export const INITIAL_ADMIN_DATA = {
  rules: [
    { id: 'rule_1', eventId: 'coldplay-mumbai', tier: 'Standing Floor (South Gate)', maxPrice: 7150, enabled: true },
    { id: 'rule_2', eventId: 'diljit-delhi', tier: 'Fan Pit VIP (Front-Stage)', maxPrice: 17600, enabled: true },
    { id: 'rule_3', eventId: 'arijit-delhi', tier: 'Gold Circle Standing', maxPrice: 4950, enabled: true },
    { id: 'rule_4', eventId: 'india-aus-kolkata', tier: 'Lower Tier Pavilion', maxPrice: 5500, enabled: true },
  ],
  botThreshold: 10,
  disputes: [
    { id: 'dsp_101', tradeId: 'T-9810', buyer: 'Ali Khan', seller: 'Rohit Verma', reason: 'Delayed settlement escrow check', status: 'PENDING' },
  ],
  solvencyProof: {
    hash: '0x7e8b91c0f4492da3e819b5c219f8a3d4e6c1a89f2140',
    verifiedAt: '2026-10-24 10:00 UTC',
    ratio: 1.15,
    status: 'SOLVENT',
    liabilities: '₹2,45,000.00',
    assets: '₹2,81,750.00',
  },
};
