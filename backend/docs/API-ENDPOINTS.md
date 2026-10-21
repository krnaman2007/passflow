# The Darkhold Exchange - API Reference

**REST endpoints:** 77 | **WebSocket events:** 8 | **Internal services:** 6

Base URL: `/api/v1`. All bodies are JSON. Protected routes need `Authorization: Bearer <token>`.

## Auth legend

| Label | Meaning |
|---|---|
| Public | No login needed |
| User | Any logged-in user (buyer / seller) |
| Organizer | User with a verified Organizer profile |
| Admin | Platform admin |

---

# Part 1 - REST API

## Authentication & Profile

| Method | Endpoint | Auth | Functionality |
|---|---|---|---|
| POST | `/auth/register` | Public | Create user (+ wallet). Body: name, email, password, phone. |
| POST | `/auth/login` | Public | Return access + refresh token. |
| POST | `/auth/refresh` | Public | Issue new access token from refresh token. |
| POST | `/auth/logout` | User | Revoke refresh token. |
| GET | `/users/me` | User | Current profile with role and wallet summary. |
| PUT | `/users/me` | User | Update profile (name, phone, profile). |
| PUT | `/users/me/password` | User | Change password. |
| POST | `/users/me/kyc` | User | Submit KYC details; sets kycStatus. |
| POST | `/organizers/apply` | User | Request organizer role (creates Organizer, status PENDING). |
| GET | `/organizers/me` | Organizer | Organizer profile and verification status. |
| GET | `/organizers/me/events` | Organizer | Events created by organizer. |

## Event & Category Management

| Method | Endpoint | Auth | Functionality |
|---|---|---|---|
| POST | `/events` | Organizer | Create event (DRAFT). |
| GET | `/events` | Public | List events; filters: search, date, location, status; pagination. |
| GET | `/events/:id` | Public | Event details with categories and availability. |
| PUT | `/events/:id` | Organizer | Edit event details. |
| PATCH | `/events/:id/status` | Organizer/Admin | Publish, cancel or complete event. |
| POST | `/events/:id/categories` | Organizer | Add ticket category: name, price, quantity. |
| GET | `/events/:id/categories` | Public | List categories with availableQuantity. |
| PUT | `/categories/:id` | Organizer | Update category price / details. |
| GET | `/categories/:id/inventory` | Organizer | Total, available, reserved quantities. |
| PUT | `/categories/:id/inventory` | Organizer | Adjust inventory (blocked below sold count). |

## Primary Ticket Purchase

| Method | Endpoint | Auth | Functionality |
|---|---|---|---|
| POST | `/events/:id/purchase` | User | Buy at original price. Body: categoryId, quantity. Reserve inventory -> debit wallet -> create Ticket + TicketOwnership in one DB transaction; release on failure. |
| GET | `/tickets/me` | User | Tickets owned by logged-in user (filter by status). |
| GET | `/tickets/:id` | User | Ticket details. |
| GET | `/tickets/:id/ownership` | User | Ownership history of the ticket. |
| POST | `/tickets/:id/transfer` | User | Direct (non-market) transfer to another user; creates TicketTransfer. |
| GET | `/transfers/:id` | User | Transfer status. |

## Orders & Order Book (Resale)

| Method | Endpoint | Auth | Functionality |
|---|---|---|---|
| POST | `/orders` | User | Place BUY / SELL order. Body: eventId, categoryId, side, type, quantity, price. Pipeline: auth -> ownership (SELL) -> funds hold (BUY) -> inventory -> anti-scalping -> anti-bot -> idempotency key -> matching engine. |
| GET | `/orders` | User | My orders; filters: status, event, side. |
| GET | `/orders/:id` | User | Order details with fills. |
| DELETE | `/orders/:id` | User | Cancel open / partial order; release hold or ticket lock. |
| GET | `/orders/:id/trades` | User | Trades produced by this order. |
| GET | `/events/:eventId/orderbook` | Public | Current book for event+category (query: categoryId). |
| GET | `/orderbook/:id/depth` | Public | Aggregated bid/ask levels. |

## Trades & Settlement

| Method | Endpoint | Auth | Functionality |
|---|---|---|---|
| GET | `/trades` | User | My executed trades. |
| GET | `/trades/:id` | User | Trade details with settlement status. |
| GET | `/events/:id/trades` | Public | Recent public trades for an event. |
| GET | `/settlements/:id` | User/Admin | Settlement state: PENDING, COMPLETED, FAILED, ROLLED_BACK. |
| GET | `/escrows/:id` | User/Admin | Escrow status for a trade. |
| POST | `/settlements/:id/retry` | Admin | Retry failed settlement (idempotent). |

## Wallet

| Method | Endpoint | Auth | Functionality |
|---|---|---|---|
| GET | `/wallet` | User | Balance, reservedBalance, available. |
| POST | `/wallet/deposit` | User | Add funds (mock payment gateway). Idempotency key required. |
| POST | `/wallet/withdraw` | User | Withdraw available funds. |
| GET | `/wallet/transactions` | User | Ledger entries; filter by type, date; pagination. |

## Market Data & Analytics

| Method | Endpoint | Auth | Functionality |
|---|---|---|---|
| GET | `/market/:eventId/:categoryId` | Public | MarketData: best bid/ask, last price, volume. |
| GET | `/market/:eventId/:categoryId/depth` | Public | MarketDepth levels. |
| GET | `/market/:eventId/:categoryId/trades` | Public | TradeFeed (last N trades). |
| GET | `/market/summary` | Public | Top events by volume / price movement. |
| GET | `/events/:id/price-history` | Public | OHLC / price history for charts. |

## Dutch Auction (Supporting)

| Method | Endpoint | Auth | Functionality |
|---|---|---|---|
| POST | `/auctions` | Organizer | Create auction: startPrice, minPrice, start/end time. |
| GET | `/auctions/:id` | Public | Auction details. |
| GET | `/auctions/:id/price` | Public | Current computed price. |
| POST | `/auctions/:id/purchase` | User | Buy at current price (locks price, debits wallet). |

## History & Notifications

| Method | Endpoint | Auth | Functionality |
|---|---|---|---|
| GET | `/history/transactions` | User | Financial history (TransactionHistory). |
| GET | `/history/orders` | User | Past orders. |
| GET | `/history/trades` | User | Past trades. |
| GET | `/notifications` | User | Notifications list. |
| PATCH | `/notifications/:id/read` | User | Mark as read. |

## Admin, Rules & Monitoring

| Method | Endpoint | Auth | Functionality |
|---|---|---|---|
| GET | `/admin/users` | Admin | List / search users. |
| PATCH | `/admin/users/:id` | Admin | Suspend / activate / change role / approve KYC. |
| PATCH | `/admin/organizers/:id/verify` | Admin | Verify or reject organizer. |
| GET | `/admin/events` | Admin | All events including drafts. |
| PATCH | `/admin/events/:id` | Admin | Approve / cancel event. |
| GET | `/admin/rules/anti-scalping` | Admin | List price-cap rules. |
| POST | `/admin/rules/anti-scalping` | Admin | Create rule (maxResalePrice per category). |
| PUT | `/admin/rules/anti-scalping/:id` | Admin | Update / deactivate rule. |
| GET / PUT | `/admin/rules/anti-bot` | Admin | View / change rate limits. |
| GET | `/admin/reports` | Admin | Volume, revenue, fees, user stats. |
| GET | `/admin/audit-logs` | Admin | Audit trail; filter by admin, action, date. |
| POST | `/admin/reconciliation/run` | Admin | Generate reconciliation report. |
| GET | `/admin/reconciliation` | Admin | Reports and discrepancies. |
| GET | `/admin/monitoring/health` | Admin | DB, Redis, WebSocket, engine status. |
| GET | `/admin/monitoring/logs` | Admin | System logs. |
| GET | `/admin/metrics` | Admin | PerformanceMetrics: orders/sec, latency, errors. |
| POST | `/admin/solvency/generate` | Admin | Create SolvencyProof. |
| GET | `/solvency/verify` | Public | Verify platform solvency. |
| GET | `/health` | Public | Liveness check for deployment. |

---

# Part 2 - Real-time and Internal Services

## WebSocket events (Socket.IO)

| Event | Direction | Purpose |
|---|---|---|
| `connect` | Client -> Server | Handshake with JWT; joins personal room `user:{id}`. |
| `subscribe` / `unsubscribe` | Client -> Server | Join `event:{eventId}:{categoryId}` room for live market data. |
| `market:update` | Server -> Client | Best bid, best ask, last price, volume. |
| `depth:update` | Server -> Client | Changed price levels of the order book. |
| `trade:new` | Server -> Client | New executed trade (TradeFeed). |
| `order:status` | Server -> Client | Own order status: OPEN, PARTIAL, FILLED, CANCELLED. |
| `wallet:update` | Server -> Client | Balance / hold changes after trade or deposit. |
| `notification` | Server -> Client | New notification. |

## Internal services (not exposed as routes)

| Service | Responsibility |
|---|---|
| InventoryService | `reserve()`, `release()`, `confirm()` with row locks - prevents overselling. |
| WalletService | `holdFunds()`, `releaseFunds()`, `deductFunds()`, `addFunds()` - atomic DB transactions. |
| MatchingEngine | In-memory book per event+category; called by `POST /orders`; emits Trade events. |
| SettlementService | On Trade: escrow -> debit buyer -> credit seller -> transfer ticket; rollback on failure; unique tradeId prevents duplicates. |
| ValidationService | Ownership, funds, inventory, AntiScalpingRule, AntiBotRule checks. |
| BroadcastService | Publishes engine/settlement events to WebSocketService. |

---

# Part 3 - Workflow to API Mapping

| Workflow step | APIs / components |
|---|---|
| 1. Event creation | `POST /organizers/apply`, `POST /events`, `POST /events/:id/categories`, `PUT /categories/:id/inventory` |
| 2. Authentication | `POST /auth/register`, `/auth/login`, `GET /users/me`, `GET /wallet` |
| 3. Primary purchase | `GET /events`, `GET /events/:id`, `POST /events/:id/purchase`, `GET /tickets/me` |
| 4. Resale order placement | `POST /orders` (SELL / BUY), `GET /orders`, `DELETE /orders/:id` |
| 5. Order validation | ValidationService inside `POST /orders`; AntiScalpingRule + AntiBotRule |
| 6. Matching | MatchingEngine (PriceTimePriority / FIFOQueue), partial fills, cancel |
| 7. Settlement | SettlementService + Escrow + TicketTransfer; `GET /settlements/:id` |
| 8. Real-time updates | WebSocket: `market:update`, `depth:update`, `trade:new`, `order:status`, `wallet:update` |
| 9. History & monitoring | `GET /history/*`, `GET /admin/audit-logs`, `/admin/reconciliation`, `/admin/monitoring/*` |

---

# Part 4 - Conventions and Build Order

## API conventions

- Response shape: `{ success, data, error: { code, message } }`; use proper HTTP codes (400, 401, 403, 404, 409, 422).
- `Idempotency-Key` header on `POST /orders`, `/events/:id/purchase`, `/wallet/deposit`, `/wallet/withdraw` to stop duplicate transactions.
- Pagination: `?page=&limit=`; sorting: `?sort=createdAt:desc`.
- Money as DECIMAL (never float). All balance, inventory and settlement changes run inside DB transactions with row locks.
- Validate every body (Zod / Joi). Rate-limit auth and order endpoints (AntiBotRule).
- Write an AuditLog row for every admin action and every settlement rollback.

## Suggested build order

1. Auth + User + Wallet (register creates wallet, deposit/withdraw, ledger).
2. Event, TicketCategory, TicketInventory (organizer flows).
3. Primary purchase: Ticket + TicketOwnership + inventory reserve/release.
4. Order + OrderBook + MatchingEngine (price-time priority, partial fills, cancel).
5. Trade + Settlement + Escrow + TicketTransfer with rollback.
6. AntiScalpingRule / AntiBotRule validation in the order pipeline.
7. WebSocket: market data, depth, trade feed, order status.
8. Admin, AuditLog, Reconciliation, Monitoring, Notification, SolvencyProof.
9. DutchAuction and PerformanceMetrics (optional extras).