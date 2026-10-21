// PassFlow Exchange Mock Database & Static Reference
// Aligned with PassFlow Exchange Frontend Preview & Navigation Flow Guide

export const INITIAL_USERS = [
  {
    id: 'usr_ali',
    name: 'Ali K.',
    email: 'ali@example.com',
    phone: '+91 98765 43210',
    role: 'USER',
    kycStatus: 'PENDING', // PENDING, VERIFIED, REJECTED
    status: 'ACTIVE',
    avatar: 'A'
  },
  {
    id: 'usr_lumen',
    name: 'Lumen Events',
    email: 'contact@lumenevents.io',
    phone: '+1 415 555 0199',
    role: 'ORGANIZER',
    kycStatus: 'VERIFIED',
    status: 'ACTIVE',
    avatar: 'L'
  },
  {
    id: 'usr_admin',
    name: 'admin_01',
    email: 'admin01@passflow.io',
    phone: '+1 800 555 0100',
    role: 'ADMIN',
    kycStatus: 'VERIFIED',
    status: 'ACTIVE',
    avatar: 'AD'
  },
  {
    id: 'usr_3302',
    name: 'User #3302',
    email: 'bot_suspect@proxy.net',
    phone: '+44 20 7946 0912',
    role: 'USER',
    kycStatus: 'VERIFIED',
    status: 'SUSPENDED',
    avatar: 'U'
  }
];

export const INITIAL_EVENTS = [
  {
    id: 'nightfall',
    title: 'Nightfall Festival',
    tagline: 'Annual Electronic & Synthwave Showcase',
    date: 'Oct 31',
    fullDate: 'Oct 31, 7:00 pm',
    doors: 'Doors 6:00 pm',
    ageLimit: '18+ with ID',
    venue: 'Harbor Grounds, Pier 42',
    city: 'San Francisco, CA',
    category: 'Festival',
    gradient: 'from-amber-500/20 via-orange-600/30 to-rose-900/40',
    accentColor: '#f97316',
    primaryFrom: 45,
    resaleFrom: 108,
    bestBid: 105,
    bestAsk: 108,
    lastTrade: 106,
    volume24h: 312,
    tiers: [
      { id: 'vip', name: 'VIP', price: 150, left: 40, total: 200, held: 6, cap: 300 },
      { id: 'general', name: 'General', price: 45, left: 212, total: 1000, held: 14, cap: 120 },
      { id: 'early-bird', name: 'Early bird', price: 30, left: 0, total: 300, held: 0, soldOut: true, cap: 90 }
    ],
    status: 'PUBLISHED',
    organizer: 'Lumen Events'
  },
  {
    id: 'ember-ash',
    title: 'Ember & Ash Live',
    tagline: 'Atmospheric Indie Rock Tour',
    date: 'Nov 8',
    fullDate: 'Nov 8, 8:00 pm',
    doors: 'Doors 7:00 pm',
    ageLimit: 'All Ages',
    venue: 'Ironworks Hall',
    city: 'Seattle, WA',
    category: 'Concert',
    gradient: 'from-blue-600/20 via-indigo-700/30 to-purple-900/40',
    accentColor: '#6366f1',
    primaryFrom: 30,
    resaleFrom: 34,
    bestBid: 32,
    bestAsk: 34,
    lastTrade: 33,
    volume24h: 94,
    tiers: [
      { id: 'vip', name: 'VIP Lounge', price: 95, left: 8, total: 50, held: 2, cap: 160 },
      { id: 'general', name: 'General Admission', price: 30, left: 38, total: 400, held: 4, cap: 80 }
    ],
    status: 'PUBLISHED',
    organizer: 'Lumen Events'
  },
  {
    id: 'lantern-rooftop',
    title: 'Lantern Rooftop Sessions',
    tagline: 'Deep House Sunset Session',
    date: 'Nov 15',
    fullDate: 'Nov 15, 5:30 pm',
    doors: 'Doors 5:00 pm',
    ageLimit: '21+ with ID',
    venue: 'Skyline Deck',
    city: 'Chicago, IL',
    category: 'Festival',
    gradient: 'from-purple-600/20 via-pink-600/30 to-rose-900/40',
    accentColor: '#ec4899',
    primaryFrom: 25,
    resaleFrom: 41,
    bestBid: 38,
    bestAsk: 41,
    lastTrade: 40,
    volume24h: 185,
    tiers: [
      { id: 'general', name: 'General Rooftop', price: 25, left: 0, total: 350, held: 0, soldOut: true, cap: 75 }
    ],
    status: 'PUBLISHED',
    organizer: 'Pine Valley Co.'
  },
  {
    id: 'hollow-pines',
    title: 'Hollow Pines Weekend',
    tagline: '3-Day Acoustic Campfire Gathering',
    date: 'Dec 5 to 7',
    fullDate: 'Dec 5 - Dec 7, 2026',
    doors: 'Check-in 10:00 am',
    ageLimit: 'All Ages Camping',
    venue: 'Pine Valley Nature Reserve',
    city: 'Bend, OR',
    category: 'Festival',
    gradient: 'from-emerald-600/20 via-teal-700/30 to-cyan-900/40',
    accentColor: '#10b981',
    primaryFrom: 120,
    resaleFrom: 128,
    bestBid: 124,
    bestAsk: 128,
    lastTrade: 126,
    volume24h: 640,
    tiers: [
      { id: 'general', name: 'Weekend Pass', price: 120, left: 640, total: 1500, held: 35, cap: 240 },
      { id: 'camping-vip', name: 'Glamping + Pass', price: 280, left: 42, total: 100, held: 4, cap: 450 }
    ],
    status: 'PUBLISHED',
    organizer: 'Pine Valley Co.'
  },
  {
    id: 'winter-gala',
    title: 'Winter Gala',
    tagline: 'Black-tie winter night of classical symphonies',
    date: 'Dec 20',
    fullDate: 'Dec 20, 8:00 pm',
    doors: 'Doors 7:00 pm',
    ageLimit: 'Formal Dress Code',
    venue: 'Crystal Hall',
    city: 'New York, NY',
    category: 'Concert',
    gradient: 'from-amber-600/20 via-yellow-700/30 to-stone-900/40',
    accentColor: '#eab308',
    primaryFrom: 60,
    resaleFrom: 0,
    bestBid: 0,
    bestAsk: 0,
    lastTrade: 0,
    volume24h: 0,
    tiers: [
      { id: 'general', name: 'General Stalls', price: 60, left: 500, total: 500, held: 0, cap: 150 }
    ],
    status: 'DRAFT', // draft event from organizer flow
    organizer: 'Lumen Events'
  }
];

export const INITIAL_ORDER_BOOKS = {
  'nightfall:general': {
    spread: '3.00',
    asks: [
      { price: '118.00', qty: 4, total: '472.00', depth: 20 },
      { price: '115.00', qty: 2, total: '230.00', depth: 16 },
      { price: '112.00', qty: 6, total: '672.00', depth: 14 },
      { price: '110.00', qty: 3, total: '330.00', depth: 8 },
      { price: '108.00', qty: 5, total: '540.00', depth: 5 }
    ],
    bids: [
      { price: '105.00', qty: 5, total: '525.00', depth: 5 },
      { price: '103.00', qty: 3, total: '309.00', depth: 8 },
      { price: '100.00', qty: 8, total: '800.00', depth: 16 },
      { price: '98.00', qty: 2, total: '196.00', depth: 18 },
      { price: '95.00', qty: 6, total: '570.00', depth: 24 }
    ],
    trades: [
      { price: '106.00', qty: 2, time: '12:04', side: 'buy' },
      { price: '107.00', qty: 1, time: '11:58', side: 'sell' },
      { price: '105.00', qty: 3, time: '11:41', side: 'buy' },
      { price: '105.00', qty: 4, time: '11:20', side: 'buy' },
      { price: '104.00', qty: 2, time: '10:55', side: 'sell' }
    ]
  },
  'nightfall:vip': {
    spread: '5.00',
    asks: [
      { price: '280.00', qty: 2, total: '560.00', depth: 6 },
      { price: '275.00', qty: 1, total: '275.00', depth: 4 },
      { price: '270.00', qty: 3, total: '810.00', depth: 3 }
    ],
    bids: [
      { price: '265.00', qty: 2, total: '530.00', depth: 2 },
      { price: '260.00', qty: 4, total: '1040.00', depth: 6 },
      { price: '250.00', qty: 1, total: '250.00', depth: 7 }
    ],
    trades: [
      { price: '268.00', qty: 1, time: '11:30', side: 'buy' },
      { price: '265.00', qty: 2, time: '10:14', side: 'sell' }
    ]
  },
  'nightfall:early-bird': {
    spread: '4.00',
    asks: [
      { price: '78.00', qty: 3, total: '234.00', depth: 6 },
      { price: '75.00', qty: 2, total: '150.00', depth: 3 },
      { price: '72.00', qty: 1, total: '72.00', depth: 1 }
    ],
    bids: [
      { price: '68.00', qty: 2, total: '136.00', depth: 2 },
      { price: '65.00', qty: 5, total: '325.00', depth: 7 }
    ],
    trades: [
      { price: '70.00', qty: 1, time: '09:42', side: 'buy' },
      { price: '69.00', qty: 2, time: '08:15', side: 'sell' }
    ]
  }
};

export const INITIAL_USER_TICKETS = [
  {
    id: 'TK-20931',
    eventId: 'nightfall',
    eventName: 'Nightfall Festival',
    tier: 'General',
    status: 'OWNED', // OWNED, LISTED, TRANSFER_PENDING, USED
    pricePaid: 45,
    faceValue: 45,
    resaleCap: 120,
    qrPayload: 'PASSFLOW-TICKET-NIGHTFALL-TK-20931-AUTH-VERIFIED',
    ownershipChain: [
      { type: 'PRIMARY', user: 'Ali K.', action: 'Bought from organizer, $45', date: 'Oct 18, 2026' },
      { type: 'RESALE', user: 'Sara M.', action: 'Matched on market, $52', date: 'Oct 19, 2026' },
      { type: 'TRANSFER', user: 'Ravi P.', action: 'Sent directly, no payment', date: 'Oct 20, 2026' }
    ]
  },
  {
    id: 'TK-18842',
    eventId: 'ember-ash',
    eventName: 'Ember & Ash Live',
    tier: 'VIP',
    status: 'LISTED',
    listedPrice: 140,
    pricePaid: 95,
    faceValue: 95,
    resaleCap: 160,
    qrPayload: 'PASSFLOW-TICKET-EMBER-TK-18842-LISTED',
    ownershipChain: [
      { type: 'PRIMARY', user: 'Ali K.', action: 'Bought from organizer, $95', date: 'Oct 15, 2026' }
    ]
  },
  {
    id: 'TK-17110',
    eventId: 'hollow-pines',
    eventName: 'Hollow Pines Weekend',
    tier: 'General',
    status: 'TRANSFER_PENDING',
    pricePaid: 120,
    faceValue: 120,
    resaleCap: 240,
    transferTo: 'ravi@example.com',
    qrPayload: 'PASSFLOW-TICKET-HOLLOW-TK-17110-TRANSFER-LOCKED',
    ownershipChain: [
      { type: 'PRIMARY', user: 'Ali K.', action: 'Bought from organizer, $120', date: 'Oct 10, 2026' }
    ]
  },
  {
    id: 'TK-09321',
    eventId: 'lantern-rooftop',
    eventName: 'Lantern Rooftop Sessions',
    tier: 'General',
    status: 'USED',
    pricePaid: 25,
    faceValue: 25,
    resaleCap: 75,
    usedAt: 'Oct 16, 2026, 6:15 pm (Pier Deck Scanner #2)',
    qrPayload: 'PASSFLOW-TICKET-LANTERN-TK-09321-REDEEMED',
    ownershipChain: [
      { type: 'PRIMARY', user: 'Ali K.', action: 'Bought from organizer, $25', date: 'Oct 02, 2026' }
    ]
  }
];

export const INITIAL_USER_ORDERS = [
  {
    id: 'ORD-8821',
    eventId: 'nightfall',
    eventName: 'Nightfall Festival',
    tier: 'General',
    side: 'BUY',
    type: 'LIMIT',
    qty: 2,
    price: 106,
    filled: 0,
    status: 'OPEN',
    heldAmount: 212,
    date: 'Oct 20, 11:45'
  },
  {
    id: 'ORD-8819',
    eventId: 'nightfall',
    eventName: 'Nightfall Festival',
    tier: 'General',
    side: 'SELL',
    type: 'LIMIT',
    qty: 3,
    price: 112,
    filled: 1,
    status: 'PARTIAL',
    ticketId: 'TK-20931',
    date: 'Oct 20, 10:12'
  },
  {
    id: 'ORD-8790',
    eventId: 'nightfall',
    eventName: 'Nightfall Festival',
    tier: 'General',
    side: 'BUY',
    type: 'LIMIT',
    qty: 1,
    price: 52,
    filled: 1,
    status: 'FILLED',
    date: 'Oct 19, 14:22'
  }
];

export const INITIAL_WALLET_STATE = {
  balance: 1240.00,
  held: 212.00,
  available: 1028.00,
  transactions: [
    { id: 'tx_5', type: 'HOLD', amount: 212.00, status: 'Held', date: 'Oct 20', note: 'Buy 2 at $106 (Nightfall)' },
    { id: 'tx_4', type: 'DEPOSIT', amount: 500.00, status: 'Done', date: 'Oct 19', note: 'Mock Card Gateway #9411' },
    { id: 'tx_3', type: 'PURCHASE', amount: -345.00, status: 'Done', date: 'Oct 18', note: 'Nightfall Festival (2x VIP, 1x Gen)' },
    { id: 'tx_2', type: 'TRADE_CREDIT', amount: 156.00, status: 'Done', date: 'Oct 17', note: 'Resale fill 3x General' },
    { id: 'tx_1', type: 'WITHDRAW', amount: -100.00, status: 'Done', date: 'Oct 15', note: 'Direct ACH Transfer' }
  ]
};

export const INITIAL_NOTIFICATIONS = [
  {
    id: 'notif_1',
    title: 'Trade partially filled',
    body: 'Trade filled: 2 x General @ $106 on Nightfall Festival',
    time: '5m ago',
    unread: true,
    type: 'TRADE'
  },
  {
    id: 'notif_2',
    title: 'Order status update',
    body: 'Order #8821 placed: 2 x General @ $106 held $212.00',
    time: '2h ago',
    unread: true,
    type: 'ORDER'
  },
  {
    id: 'notif_3',
    title: 'Transfer dispatched',
    body: 'Transfer completed: #TK-17110 sent to ravi@example.com',
    time: '1d ago',
    unread: false,
    type: 'TRANSFER'
  },
  {
    id: 'notif_4',
    title: 'KYC Verification',
    body: 'Your identity document submission is currently being reviewed by compliance.',
    time: '2d ago',
    unread: false,
    type: 'KYC'
  }
];

export const INITIAL_ADMIN_DATA = {
  metrics: {
    ordersPerSecond: 184,
    avgLatencyMs: 12,
    openOrders: 1946,
    failedSettlements: 0
  },
  health: {
    database: { status: 'HEALTHY', latency: '2.1ms', message: 'PostgreSQL connection pool ready' },
    redis: { status: 'HEALTHY', latency: '0.8ms', message: 'In-memory cache & pub/sub connected' },
    websocket: { status: 'HEALTHY', connections: 482, message: 'Socket.IO rooms active' },
    matchingEngine: { status: 'HEALTHY', tick: '4ms', message: 'Price-time priority queue optimal' }
  },
  reconciliation: [
    { date: 'Oct 19', status: 'MATCHED', discrepancies: 0, checkedTrades: 1284, ledgerSum: '$142,500.00' },
    { date: 'Oct 18', status: 'REVIEW', discrepancies: 2, checkedTrades: 940, ledgerSum: '$98,420.00' }
  ],
  auditLogs: [
    { id: 'log_3', admin: 'admin_01', action: 'Approved organizer Lumen Events', time: '10:42', date: 'Today', status: 'SUCCESS' },
    { id: 'log_2', admin: 'admin_02', action: 'Retried settlement #8821', time: '10:15', date: 'Today', status: 'SUCCESS' },
    { id: 'log_1', admin: 'admin_01', action: 'Suspended user #3302', time: '09:58', date: 'Today', status: 'WARNING' }
  ],
  rules: [
    { id: 'rule_1', name: 'Nightfall General', eventId: 'nightfall', tier: 'General', maxPrice: 120, enabled: true },
    { id: 'rule_2', name: 'Nightfall VIP', eventId: 'nightfall', tier: 'VIP', maxPrice: 300, enabled: true },
    { id: 'rule_3', name: 'Global Bot Rate Limit', type: 'RATE_LIMIT', value: '20 orders / min / user', enabled: true }
  ],
  solvency: {
    assets: 482100,
    liabilities: 463870,
    ratio: 103.93,
    verifiedDate: 'Oct 20, 2026',
    merkleRoot: '0x8f4d92a11b65e92c4f810293da88e147cf99120409a471cb32'
  },
  organizerApplications: [
    { id: 'org_app_1', name: 'Lumen Events', email: 'contact@lumenevents.io', status: 'VERIFIED', volume: '$100k+/mo', appliedAt: 'Oct 15' },
    { id: 'org_app_2', name: 'Pine Valley Co.', email: 'admin@pinevalley.org', status: 'VERIFIED', volume: '$50k/mo', appliedAt: 'Oct 12' },
    { id: 'org_app_3', name: 'Bass Drop Productions', email: 'hello@bassdrop.live', status: 'PENDING', volume: '$30k/mo', appliedAt: 'Oct 21' }
  ],
  failedSettlements: [
    { id: '8821', tradeId: 'T-5530', eventName: 'Nightfall Festival', amount: 212.00, reason: 'Escrow lock timeout at bank gateway', status: 'FAILED' }
  ],
  monitoringLogs: [
    { time: '01:42:10', type: 'MATCHING_ENGINE', status: 'HEALTHY', message: 'Tick 4ms: 12 orders matched for Nightfall:General' },
    { time: '01:41:55', type: 'DB_POOL', status: 'HEALTHY', message: 'Active connections 8/20, query response 1.9ms avg' },
    { time: '01:40:12', type: 'REDIS', status: 'HEALTHY', message: 'Depth stream ping 0.4ms, 482 subscribers listening' },
    { time: '01:38:00', type: 'RECONCILIATION', status: 'INFO', message: 'Daily ledger verification batch completed' }
  ]
};
