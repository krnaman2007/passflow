# PassFlow API Routes Specification

This document tracks active API routes and planned route additions as the PassFlow backend and matching engine develop.

---

## 1. Active HTTP Routes

### System & Health

| Method | Endpoint | Description | Auth Required | Request Body | Response Format | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/health` | Backend server health check and uptime ping | No | None | `{"status": "ok", "message": "Backend server is running", "timestamp": "..."}` | Active |

### Authentication & Session Management

| Method | Endpoint | Description | Auth Required | Request Body | Response Format | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `POST` | `/auth/register` *(also `/api/v1/auth/register`)* | Create user (+ wallet). Body: name, email, password, phone | Public | `{"name": "...", "email": "...", "password": "...", "phone": "..."}` | `{"success": true, "data": {"user": {...}, "tokens": {"accessToken": "...", "refreshToken": "...", "tokenType": "Bearer", "expiresIn": "15m"}}}` | Active |
| `POST` | `/auth/login` *(also `/api/v1/auth/login`)* | Return access + refresh token | Public | `{"email": "...", "password": "..."}` | `{"success": true, "data": {"user": {...}, "tokens": {"accessToken": "...", "refreshToken": "...", "tokenType": "Bearer", "expiresIn": "15m"}}}` | Active |
| `POST` | `/auth/refresh` *(also `/api/v1/auth/refresh`)* | Issue new access token from refresh token | Public | `{"refreshToken": "..."}` | `{"success": true, "data": {"accessToken": "...", "refreshToken": "...", "tokenType": "Bearer", "expiresIn": "15m"}}` | Active |
| `POST` | `/auth/logout` *(also `/api/v1/auth/logout`)* | Revoke refresh token | User | `{"refreshToken": "..."}` *(optional)* | `{"success": true, "data": {"message": "Logged out successfully; refresh token revoked"}}` | Active |

### User Profile & KYC Management

| Method | Endpoint | Description | Auth Required | Request Body | Response Format | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `GET` | `/users/me` *(also `/api/v1/users/me`)* | Current profile with role and wallet summary | User | None | `{"success": true, "data": {"id": "...", "name": "...", "email": "...", "role": "USER", "wallet": {"availableBalance": "0", "reservedBalance": "0", "currency": "INR"}, "buyerSeller": {...}}}` | Active |
| `PUT` | `/users/me` *(also `/api/v1/users/me`)* | Update profile (name, phone, profile) | User | `{"name": "...", "phone": "...", "profile": "..."}` | `{"success": true, "data": {"id": "...", "name": "...", "phone": "...", "profile": "...", "wallet": {...}}}` | Active |
| `PUT` | `/users/me/password` *(also `/api/v1/users/me/password`)* | Change password | User | `{"oldPassword": "...", "newPassword": "..."}` | `{"success": true, "data": {"message": "Password changed successfully. Please log in again with your new credentials."}}` | Active |
| `POST` | `/users/me/kyc` *(also `/api/v1/users/me/kyc`)* | Submit KYC details; sets kycStatus | User | `{"documentType": "...", "documentNumber": "..."}` | `{"success": true, "data": {"message": "KYC details submitted successfully; status set to PENDING verification", "buyerSeller": {"kycStatus": "PENDING", ...}}}` | Active |

### Organizer Management

| Method | Endpoint | Description | Auth Required | Request Body | Response Format | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `POST` | `/organizers/apply` *(also `/api/v1/organizers/apply`)* | Request organizer role (creates Organizer, status PENDING) | User | `{"organizationName": "..."}` | `{"success": true, "data": {"message": "Organizer application submitted successfully", "organizer": {"id": "...", "organizationName": "...", "verificationStatus": "PENDING"}}}` | Active |
| `GET` | `/organizers/me` *(also `/api/v1/organizers/me`)* | Organizer profile and verification status | Organizer | None | `{"success": true, "data": {"id": "...", "organizationName": "...", "verificationStatus": "PENDING", "user": {...}}}` | Active |
| `GET` | `/organizers/me/events` *(also `/api/v1/organizers/me/events`)* | Events created by organizer | Organizer | None | `{"success": true, "data": {"events": [...], "total": 0}}` | Active |


### Event, Category & Inventory Management

| Method | Endpoint | Description | Auth Required | Request Body | Response Format | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/events` | Create a new event in DRAFT status | Organizer / Admin | `{"name": "...", "description": "...", "dateTime": "ISO8601", "location": "...", "originalPrice": 100}` | `{"success": true, "data": {"id": "...", "status": "DRAFT", ...}}` | Active |
| `GET` | `/api/v1/events` | List events with filters (search, date, location, status) and pagination | Public | None (Query: `search`, `date`, `location`, `status`, `page`, `limit`) | `{"success": true, "data": {"events": [...], "pagination": {...}}}` | Active |
| `GET` | `/api/v1/events/:id` | Retrieve event details with categories and live availability | Public | None | `{"success": true, "data": {"id": "...", "name": "...", "categories": [...]}}` | Active |
| `PUT` | `/api/v1/events/:id` | Edit event details (name, description, dateTime, location, originalPrice) | Organizer (Owner) / Admin | `{"name": "...", "description": "...", "dateTime": "ISO8601", "location": "...", "originalPrice": 100}` | `{"success": true, "data": {"id": "...", ...}}` | Active |
| `PATCH` | `/api/v1/events/:id/status` | Transition event status to PUBLISHED, CANCELLED, or COMPLETED | Organizer (Owner) / Admin | `{"status": "PUBLISHED" \| "CANCELLED" \| "COMPLETED"}` | `{"success": true, "data": {"id": "...", "status": "PUBLISHED"}}` | Active |
| `POST` | `/api/v1/events/:id/categories` | Add a ticket category and atomically initialize its inventory | Organizer (Owner) / Admin | `{"name": "VIP", "originalPrice": 150, "totalQuantity": 100}` | `{"success": true, "data": {"id": "...", "name": "VIP", "inventory": {...}}}` | Active |
| `GET` | `/api/v1/events/:id/categories` | List ticket tiers for an event with availableQuantity | Public | None | `{"success": true, "data": [{"id": "...", "name": "VIP", "availableQuantity": 100, ...}]}` | Active |
| `PUT` | `/api/v1/categories/:id` | Update ticket category pricing or name | Organizer (Owner) / Admin | `{"name": "VIP Gold", "originalPrice": 175}` | `{"success": true, "data": {"id": "...", "name": "VIP Gold", ...}}` | Active |
| `GET` | `/api/v1/categories/:id/inventory` | Inspect total, available, reserved, and sold ticket counts | Organizer (Owner) / Admin | None | `{"success": true, "data": {"categoryId": "...", "totalQuantity": 100, "availableQuantity": 80, "reservedQuantity": 5, "soldCount": 15}}` | Active |
| `PUT` | `/api/v1/categories/:id/inventory` | Adjust total inventory (strictly blocked below sold count) | Organizer (Owner) / Admin | `{"totalQuantity": 150}` | `{"success": true, "data": {"categoryId": "...", "totalQuantity": 150, "availableQuantity": 130, "reservedQuantity": 5, "soldCount": 15}}` | Active |

### Platform Administration & Moderation

| Method | Endpoint | Description | Auth Required | Request Body | Response Format | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `GET` | `/admin/users` *(also `/api/v1/admin/users`)* | List / search users with query filters (`search`, `role`, `kycStatus`, `isActive`, `page`, `limit`) | Admin | None (Query: `search`, `role`, `kycStatus`, `isActive`, `page`, `limit`) | `{"success": true, "data": {"users": [...], "total": 1, "pagination": {"total": 1, "page": 1, "limit": 20, "totalPages": 1}}}` | Active |
| `PATCH` | `/admin/users/:id` *(also `/api/v1/admin/users/:id`)* | Suspend / activate (`isActive`), change role (`role`), approve/reject KYC (`kycStatus`) | Admin | `{"role": "ORGANIZER", "isActive": true, "kycStatus": "VERIFIED"}` *(optional fields)* | `{"success": true, "data": {"message": "User updated successfully", "user": {...}}}` | Active |
| `PATCH` | `/admin/organizers/:id/verify` *(also `/api/v1/admin/organizers/:id/verify`)* | Verify or reject organizer application (elevates user role to ORGANIZER when VERIFIED) | Admin | `{"verificationStatus": "VERIFIED" \| "REJECTED" \| "PENDING"}` | `{"success": true, "data": {"message": "Organizer verification status updated to VERIFIED", "organizer": {...}}}` | Active |
| `GET` | `/admin/events` *(also `/api/v1/admin/events`)* | All events including drafts with optional search, status, and pagination | Admin | None (Query: `search`, `status`, `organizerId`, `page`, `limit`) | `{"success": true, "data": {"events": [...], "total": 1, "pagination": {"total": 1, "page": 1, "limit": 20, "totalPages": 1}}}` | Active |
| `PATCH` | `/admin/events/:id` *(also `/api/v1/admin/events/:id`)* | Approve / cancel / update event lifecycle status | Admin | `{"status": "PUBLISHED" \| "CANCELLED" \| "DRAFT" \| "COMPLETED"}` | `{"success": true, "data": {"message": "Event status updated to PUBLISHED", "event": {...}}}` | Active |
| `GET` | `/admin/rules/anti-scalping` *(also `/api/v1/admin/rules/anti-scalping`)* | List anti-scalping price-cap rules | Admin | None (Query: `eventId`, `categoryId`, `enabled`) | `{"success": true, "data": {"rules": [...], "total": 2}}` | Active |
| `POST` | `/admin/rules/anti-scalping` *(also `/api/v1/admin/rules/anti-scalping`)* | Create price-cap rule (maxResalePrice per category/event) | Admin | `{"name": "...", "eventId": "...", "tier": "VIP", "maxResalePrice": 250, "enabled": true}` | `{"success": true, "data": {"message": "Anti-scalping rule created successfully", "rule": {...}}}` | Active |
| `PUT` | `/admin/rules/anti-scalping/:id` *(also `/api/v1/admin/rules/anti-scalping/:id`)* | Update / deactivate anti-scalping price-cap rule | Admin | `{"name": "...", "maxResalePrice": 300, "enabled": false}` | `{"success": true, "data": {"message": "Anti-scalping rule updated successfully", "rule": {...}}}` | Active |
| `GET` | `/admin/rules/anti-bot` *(also `/api/v1/admin/rules/anti-bot`)* | View global bot rate limits and throttles | Admin | None | `{"success": true, "data": {"ordersPerMinute": 20, "maxRequestsPerMinute": 100, "burstLimit": 30, "enabled": true}}` | Active |
| `PUT` | `/admin/rules/anti-bot` *(also `/api/v1/admin/rules/anti-bot`)* | View / change global bot rate limits | Admin | `{"ordersPerMinute": 30, "maxRequestsPerMinute": 150, "burstLimit": 50, "enabled": true}` | `{"success": true, "data": {"message": "Anti-bot rate limits updated successfully", "config": {...}}}` | Active |
| `GET` | `/admin/reports` *(also `/api/v1/admin/reports`)* | Platform summary reports (volume, revenue, fees, user stats, events) | Admin | None | `{"success": true, "data": {"summary": {...}, "users": {...}, "events": {...}}}` | Active |
| `GET` | `/admin/audit-logs` *(also `/api/v1/admin/audit-logs`)* | Immutable administrative audit trail with filtering and pagination | Admin | None (Query: `adminId`, `action`, `startDate`, `endDate`, `page`, `limit`) | `{"success": true, "data": {"logs": [...], "total": 1, "pagination": {...}}}` | Active |
| `POST` | `/admin/reconciliation/run` *(also `/api/v1/admin/reconciliation/run`)* | Trigger automated reconciliation run comparing ledger vs settlements | Admin | `{"date": "2026-10-22T00:00:00.000Z"}` *(optional)* | `{"success": true, "data": {"message": "Reconciliation report generated successfully", "report": {...}}}` | Active |
| `GET` | `/admin/reconciliation` *(also `/api/v1/admin/reconciliation`)* | Retrieve paginated reconciliation reports and discrepancy logs | Admin | None (Query: `status`, `startDate`, `endDate`, `page`, `limit`) | `{"success": true, "data": {"reports": [...], "total": 1, "pagination": {...}}}` | Active |

---

## 2. Active Real-Time / WebSocket Events

Server: Socket.IO mounted on the Express HTTP server (`server.js`).

| Event Name | Direction | Payload | Description |
| :--- | :--- | :--- | :--- |
| `connection` | Client -> Server | Handshake headers | Establishes WebSocket / polling session |
| `ping-server` | Client -> Server | Arbitrary ping data | Health ping from frontend |
| `pong-client` | Server -> Client | `{"message": "Socket connection healthy!", "received": data, "timestamp": "..."}` | Health confirmation |
| `disconnect` | Client -> Server | None | Cleans up socket connection |

---

## 3. Matching Engine Service Status (Steps 1–8.3: FIFO Queue, PriceLevel, OrderBookSide, OrderBook, PriceTimePriority, MatchingCoordinator, Market Isolation Audit, Corrected Persistence Architecture, Schema Foundation, Market Execution Queue & Persistent Matching Service)

- **Step 1 Implementation:** `src/services/matching/fifo-queue.js` (Doubly linked FIFO queue)
- **Step 2 Implementation:** `src/services/matching/price-level.js` (Price level aggregation & time priority)
- **Step 3 Implementation:** `src/services/matching/order-book-side.js` (Side-level price-time priority & depth)
- **Step 4 Implementation:** `src/services/matching/order-book.js` (Complete two-sided market order book)
- **Step 5 Implementation:** `src/services/matching/price-time-priority.js` (Pure price-time matching strategy & execution plan calculation)
- **Step 6 Implementation:** `src/services/matching/matching-coordinator.js` (In-memory matching coordinator & order lifecycle management)
- **Step 7 Audit & Tests:** `docs/MARKET_ISOLATION_AND_CONCURRENCY.md` & `tests/matching/market-isolation.test.js` (Market isolation and single-writer concurrency audit)
- **Step 8A Review & Corrections:** `docs/routes.md` Section 5 (Corrected Persistence Architecture, Serialization Boundaries, Ambiguous Outcomes & Fenced Market Ownership)
- **Step 8.1 Implementation:** `prisma/schema.prisma` and `prisma/migrations/20261021161148_add_order_and_execution_models` (Persistent Order and Execution models, integer types, indexes, and applied migration)
- **Step 8.2 Implementation:** `src/services/matching/market-state.js` & `src/services/matching/market-execution-queue.js` (Per-market async FIFO serialization queue, market lifecycle state gating, and deterministic barrier tests)
- **Step 8.3 Implementation:** `src/services/matching/order-repository.js` & `src/services/matching/persistent-matching-service.js` (Persistent limit order matching, atomic Prisma transaction bridge, post-commit mutation, and idempotency recovery)
- **Route Additions in Steps 1–8.3:** **None** (per architectural scope control, these are isolated in-memory matching engine data structures, domain coordinators, design audits, database schema foundations, process-local serialization queues, and atomic transaction bridges without external REST dependencies).

---

## 4. Planned Matching Engine Routes (Upcoming Phases)

As outlined in the implementation plan (`docs/Om.md`), the following REST endpoints will be introduced in subsequent phases once `PriceLevel`, `OrderBook`, and the `MatchingEngine` services are complete:

### Orders API (`/api/orders`)

| Method | Endpoint | Description | Planned Phase |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/orders` | Submit a limit or market order to the matching engine | Phase 5 |
| `GET` | `/api/orders/:orderId` | Retrieve order status and execution state | Phase 5 |
| `DELETE` | `/api/orders/:orderId` | Cancel an open or partially filled order | Phase 5 |
| `GET` | `/api/orders/user/:userId` | List active and historical orders for a user | Phase 5 |

### Order Book & Market Data API (`/api/order-book`)

| Method | Endpoint | Description | Planned Phase |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/order-book/:eventId/:ticketCategoryId/depth` | Fetch current aggregated order-book depth | Phase 5 |
| `GET` | `/api/order-book/:eventId/:ticketCategoryId/snapshot` | Full snapshot of bids and asks for an event tier | Phase 5 |

---

## 5. Step 8A Architecture Review: Persistence, Serialization & Transactional Boundaries

### 5.1 Existing Database Architecture Findings
- **Prisma Schema (`prisma/schema.prisma`)**: Currently defines `User`, `Organizer`, `Event`, `TicketCategory`, and `TicketInventory`.
- **Missing Models for Trading**: Neither `Order` nor `Execution` (Trade) models exist in `schema.prisma`. There are no enums for `OrderSide` (`BID`, `ASK`) or `OrderStatus`.
- **Existing Migrations (`prisma/migrations/`)**: Only a single baseline migration exists (`20261021112254`), which creates only the initial `User` table. The `Organizer`, `Event`, and `TicketCategory` models present in `schema.prisma` have not yet been migrated into SQL.
- **Client & Runtime Usage**: Prisma is initialized in `src/db/prisma.js` as a global singleton. Only `src/db/index.js` (health check) and `src/middleware/auth.js` (JWT user lookup) currently access the database. The matching engine is 100% in-memory and decoupled from Prisma.
- **Monetary Types**: Existing event prices use `Decimal(12, 2)`. Persistent order and trade tables must use integer minor units (cents / ticks) to prevent floating-point discrepancies.

### 5.2 Persistent Order and Trade Lifecycle
- **Market Identity**: Composite foreign keys `(eventId, ticketCategoryId)` referencing `Event.id` and `TicketCategory.id`.
- **Order Model (`Order`)**:
  - `id String @id`: Unique identifier (UUID/CUID).
  - `userId String`: Owner identifier.
  - `eventId String`, `ticketCategoryId String`: Market identifiers.
  - `side OrderSide`: `BID` or `ASK`.
  - `price Int`: Positive integer in ticks / minor currency units.
  - `initialQuantity Int`: Original requested size.
  - `remainingQuantity Int`: Current unfilled quantity (0 when filled).
  - `status OrderStatus`: `OPEN`, `PARTIALLY_FILLED`, `FILLED`, `CANCELLED`, `REJECTED`.
  - `idempotencyKey String?`: Client-provided deduplication token (`@@unique([userId, idempotencyKey])`).
  - `stoppedReason String?`: Reason for termination (e.g. `SELF_TRADE_PREVENTION`).
  - `createdAt DateTime @default(now())`, `updatedAt DateTime @updatedAt`.
- **Execution Model (`Execution`)**:
  - `id String @id @default(uuid())`.
  - `eventId String`, `ticketCategoryId String`.
  - `incomingOrderId String` (FK -> `Order`), `restingOrderId String` (FK -> `Order`).
  - `takerUserId String?`, `makerUserId String?`.
  - `price Int`: Fill price (passive resting order price).
  - `quantity Int`: Matched quantity.
  - `sequenceNumber BigInt`: Monotonically increasing execution sequence for deterministic audit and replay.
  - `executedAt DateTime @default(now())`.
- **Lifecycle Status Transitions**:
  - `OPEN`: 0 matched, rests full quantity in book.
  - `PARTIALLY_FILLED`: 1+ matches applied, remaining quantity rests in book.
  - `FILLED`: Fully executed, `remainingQuantity: 0`, does not rest.
  - `CANCELLED`: User-requested cancellation OR remainder cancelled by Self-Trade Prevention (`stoppedReason: 'SELF_TRADE_PREVENTION'`).

### 5.3 Concurrent Matching & The Serialization Boundary (Issue 1 Correction)
- **The Core Fallacy of Naive In-Memory Matching with Async DB Persistence**:
  In a Node.js event-loop environment, synchronous execution guarantees atomicity **only until the first `await` keyword**. If an order matches in RAM and then awaits `prisma.$transaction(...)`, the event loop yields control. During that network I/O window:
  - If the in-memory book was already mutated, a concurrent request for the same market calculates matches against uncommitted RAM state. If the first request's DB transaction subsequently fails, the second request has matched against *phantom state*.
  - If the in-memory book was *not* mutated, a concurrent request calculates matches against the *same resting orders*, leading to double-matching and database constraint conflicts.
  - **Cache eviction alone does NOT solve this race**: evicting the cache after a failed DB transaction cannot undo matches that concurrent requests already executed against the corrupted cache while the transaction was in flight.
- **The Strict Serialization Boundary per Market (`MarketExecutionQueue`)**:
  To guarantee serial execution across asynchronous persistence boundaries, all mutating operations for a given market `(eventId, ticketCategoryId)` must be queued and executed sequentially through an explicit per-market serialization pipeline.
- **Scope of the Serialization Boundary**:
  Each operation queued for a market encompasses the entire 6-step lifecycle without interleaving:
  1. *Command Acceptance & Deduplication*: Check `idempotencyKey` against committed database records. If already committed, return the existing result.
  2. *Market State Gate*: Verify market is in `READY` status (not `RECOVERING`, `RECONCILING`, or `PAUSED`).
  3. *Plan Calculation*: Calculate pure matching plan using `PriceTimePriority.calculate(book, incomingOrder)`.
  4. *Atomic Database Transaction*: Execute `prisma.$transaction([ ... ])` writing incoming `Order`, updating resting `Order` records, and inserting `Execution` records.
  5. *Confirmed Commit*: Await successful commit confirmation from PostgreSQL.
  6. *Post-Commit In-Memory Book Mutation*: Apply resting order reductions and add the unfilled remainder to the in-memory `OrderBook` **only after the DB transaction has committed**. If the DB transaction fails, the in-memory book is completely untouched.
  7. *Queue Release*: Advance to the next queued operation for this market. Operations for different markets execute concurrently without blocking each other.

### 5.4 Comparison of Practical Transaction Strategies (Issue 2 Correction)
- **Strategy A: Database-Authoritative Matching with Market-Level Locks**:
  - *Mechanism*: Acquire an exclusive row or advisory transaction lock (`SELECT id FROM "TicketCategory" WHERE id = :catId FOR UPDATE` or `pg_advisory_xact_lock(...)`), fetch active resting orders from PostgreSQL, calculate matches, write updates, and commit within a single database transaction.
  - *Guarantees*: ACID atomicity at the database engine level. Works across multiple processes natively without custom routing.
  - *Trade-offs*: Substantial latency penalty (15–50ms network round-trip to Neon per order) and serialized database contention limiting peak throughput per market to ~20–50 orders/sec.
- **Strategy B: In-Memory Matching with Durable Command Logging (Event Journal / WAL)**:
  - *Mechanism*: Commands are appended to a durable WAL table with sequence numbers before dispatch. A single-writer worker matches orders in RAM and emits executions asynchronously. Restarts replay the WAL.
  - *Guarantees*: Maximum matching throughput (<10 µs in RAM), deterministic replayability.
  - *Trade-offs*: High architectural complexity (event sourcing, CQRS read-model synchronization, log compaction).
- **Strategy C: Market-Queued In-Memory Matching with Post-Commit State Mutation (Recommended)**:
  - *Mechanism*: Combines in-memory matching calculation with per-market serialization queues and atomic PostgreSQL persistence. Crucially, in-memory order book mutations are deferred until **after** the PostgreSQL transaction confirms commit.
  - *Guarantees*:
    - Eliminates the Async Yield Gap: the per-market queue prevents concurrent requests from calculating against in-flight state.
    - Zero phantom state in RAM: if the DB transaction aborts, the in-memory book was never modified.
    - Eliminates row-level query latency during plan calculation (performed against memory data structures).
  - *Recommendation*: **Strategy C is recommended** for the current architecture. It preserves the clean in-memory engine from Steps 1–7, avoids complex CQRS/WAL event streaming, and eliminates the data corruption hazards of un-serialized async matching.

### 5.5 Ambiguous Database Outcomes & Reconciliation Protocol (Issue 3 Correction)
- **The Problem of Ambiguous DB Outcomes**:
  When a database connection drops, resets (`ECONNRESET`), or times out during the `COMMIT` phase of `prisma.$transaction`, the client and application cannot determine whether PostgreSQL committed the transaction before disconnecting or rolled it back.
- **Strict Rule: Never Blindly Re-Execute**:
  Blindly resubmitting or calculating a new match risks double-execution, duplicate trade records, and corrupted quantities.
- **Market Quarantine Protocol (`RECONCILING` State)**:
  1. If an ambiguous database error occurs during commit, the market execution queue is **immediately paused**.
  2. The market status transitions from `READY` to `RECONCILING`.
  3. Inbound requests for this market are rejected with `503 Service Unavailable (Market Reconciling)`.
- **Deterministic Reconciliation via Idempotency Key**:
  4. The background reconciliation routine queries PostgreSQL using the unique `(userId, idempotencyKey)` of the ambiguous command:
     - *Case A (Order Exists in DB)*: The transaction committed prior to the network drop. The reconciliation routine reads the committed `Order` and its `Execution` records, applies the corresponding mutations to the in-memory `OrderBook`, records the cached response for client retry, and transitions the market back to `READY`.
     - *Case B (Order Absent in DB)*: The transaction was aborted by PostgreSQL. Because the engine follows post-commit mutation, the in-memory `OrderBook` was never modified. The market status transitions back to `READY`, and the client is returned a `504 Gateway Timeout` indicating the order was not committed.
     - *Case C (Database Unreachable)*: The market remains in `RECONCILING` / `UNAVAILABLE` state until database connectivity is restored.

### 5.6 Enforceable Single-Writer Market Ownership (Issue 4 Correction)
- **Why API Gateway Routing Alone Fails**:
  Consistent hashing at the load balancer routes requests by market key, but **cannot guarantee safety during failover, deployments, or network partitions**. If Instance A experiences a garbage collection pause or network glitch, the gateway may deem Instance A dead and route Market 1 to Instance B. Once Instance A recovers, it processes its in-flight backlog. If both Instance A and Instance B believe they own Market 1, they both execute orders against independent memory state, resulting in catastrophic **dual-master split-brain and ticket double-selling**.
- **Enforcing Single-Writer Ownership via Database Fencing**:
  To guarantee mutual exclusion across instances without relying on unverified external clustering tools, single-writer ownership must be enforced at the database level:
  1. *PostgreSQL Advisory Lock / Market Lease*:
     Before an instance initializes an in-memory `OrderBook` for a market, it must acquire an exclusive database-level lease:
     ```sql
     SELECT pg_try_advisory_lock(hashtext(:marketKey));
     ```
     Alternatively, an explicit `MarketLease` table storing `(marketKey, ownerInstanceId, leaseExpiresAt, fencingToken)`.
  2. *Fencing on Commit*:
     Every database transaction modifying a market must include a fencing check:
     ```sql
     UPDATE "MarketLease" SET fencingToken = fencingToken + 1 
     WHERE marketKey = :marketKey AND ownerInstanceId = :instanceId;
     ```
     If an instance lost its lease (e.g. during a partition or pause), PostgreSQL aborts the transaction immediately. The stale instance is prevented from writing corrupt trades.
- **Current Single-Instance Requirement**:
  Until database-backed lease fencing is implemented, PassFlow must strictly run as a **single-instance service**. Horizontal scaling across multiple processes without database fencing is explicitly unsafe.

### 5.7 Corrected Implementation Sequence (Issue 5 Correction)
The implementation roadmap is restructured so serialization, transactions, and failure handling are established before integrating `MatchingCoordinator` with Prisma:

1. **Phase 8.1 — Prisma Schema & Migrations**:
   - Add `Order` and `Execution` models, `OrderSide`, and `OrderStatus` enums to `prisma/schema.prisma`.
   - Add composite unique index `@@unique([userId, idempotencyKey])`.
   - Align price fields to integer minor units (cents / ticks).
   - Generate and apply a clean Prisma migration.
2. **Phase 8.2 — Per-Market Serialization Queue (`MarketExecutionQueue`) & State Gating**:
   - Implement in-process queue ensuring strictly serialized, non-interleaving execution per market across `await` boundaries.
   - Implement market state transitions (`INITIALIZING`, `READY`, `RECONCILING`, `PAUSED`).
   - Add unit tests verifying sequential execution and state gating under concurrent async load.
3. **Phase 8.3 — Repository Layer & Atomic Transaction Bridge**:
   - Implement `OrderRepository` and `ExecutionRepository` encapsulating idempotent creation and batch status updates.
   - Implement `PersistentMatchingService` connecting `MatchingCoordinator` with `prisma.$transaction`.
   - Enforce **post-commit in-memory mutation**: calculate match -> commit DB transaction -> mutate in-memory book only upon confirmed commit.
4. **Phase 8.4 — Ambiguous Outcome Reconciliation & Order Book Recovery**:
   - Implement reconciliation routine resolving ambiguous commit timeouts via `(userId, idempotencyKey)` lookup and market quarantine.
   - Implement startup recovery querying active resting orders (`status IN ('OPEN', 'PARTIALLY_FILLED')`) and deterministically rebuilding the in-memory `OrderBook`.
5. **Phase 8.5 — Failure Injection & Concurrency Verification Test Suite**:
   - Comprehensive test suite validating:
     - Concurrent submissions to the same market running in strict serial order without stale matches.
     - Cancellation racing against limit order execution.
     - Simulated database transaction rollback leaving in-memory book unmutated.
     - Simulated commit timeout triggering market quarantine and idempotency reconciliation.
     - Restart recovery verifying identical order book depth and queue priority.

---

### 5.8 Step 8.1 Implementation: Persistent Order and Execution Schema Foundation

#### 5.8.1 Schema Models and Relation Design
In Step 8.1, the persistence foundation was added to `backend/prisma/schema.prisma` without altering the in-memory matching engine:

- **`Order` Model**:
  - `id String @id @default(uuid())`: Unique primary key.
  - `userId String`: Foreign key referencing `User(id)` with `onDelete: Cascade`.
  - `eventId String`: Foreign key referencing `Event(id)` with `onDelete: Cascade`.
  - `ticketCategoryId String`: Foreign key referencing `TicketCategory(id)` with `onDelete: Cascade`.
  - `side OrderSide`: Enum (`BID`, `ASK`).
  - `status OrderStatus @default(OPEN)`: Enum (`OPEN`, `PARTIALLY_FILLED`, `FILLED`, `CANCELLED`, `REJECTED`).
  - `price Int`: Matching price in minor currency units (cents / ticks).
  - `initialQuantity Int`: Original requested contract/ticket quantity.
  - `remainingQuantity Int`: Current unfilled quantity resting in the book.
  - `idempotencyKey String?`: Client-provided deduplication key.
  - `stoppedReason String?`: Reason matching halted (e.g., `'SELF_TRADE_PREVENTION'`).
  - `createdAt DateTime @default(now())`, `updatedAt DateTime @updatedAt`.
  - Dual relations to `Execution`:
    - `incomingExecutions Execution[] @relation("IncomingOrderExecutions")`: Executions where this order was the aggressive/incoming taker.
    - `restingExecutions Execution[] @relation("RestingOrderExecutions")`: Executions where this order was the passive resting maker.
  - Indexes:
    - `@@unique([userId, idempotencyKey])`: Strict per-user submission idempotency.
    - `@@index([eventId, ticketCategoryId, status, price, createdAt])`: Supports market depth lookups, active resting order queries, and price-time recovery ordering.
    - `@@index([userId, createdAt])`: Efficient retrieval of user order history.

- **`Execution` Model**:
  - `id String @id @default(uuid())`: Unique trade identifier.
  - `incomingOrderId String`: Foreign key referencing `Order(id)` (`@relation("IncomingOrderExecutions")`, `onDelete: Cascade`).
  - `restingOrderId String`: Foreign key referencing `Order(id)` (`@relation("RestingOrderExecutions")`, `onDelete: Cascade`).
  - `price Int`: Execution fill price (passive resting order price in ticks/cents).
  - `quantity Int`: Executed quantity.
  - `sequenceNumber BigInt @default(autoincrement())`: Monotonically increasing 64-bit sequence (`BIGSERIAL`) for deterministic global audit and replay ordering.
  - `executedAt DateTime @default(now())`.
  - Indexes:
    - `@@index([incomingOrderId])`: Fast lookup of fills generated by an incoming submission.
    - `@@index([restingOrderId])`: Fast lookup of passive counterparty fills.
    - `@@index([sequenceNumber])`: Sequential trade feed and replay scans.

#### 5.8.2 Integer Type Selection (`Int` vs `BigInt`) and Serialization Implications
- **Prices and Quantities (`Int`)**:
  - PostgreSQL `INTEGER` (32-bit signed: -2,147,483,648 to 2,147,483,647) was selected for `price`, `initialQuantity`, and `remainingQuantity`.
  - *Capacity Verification*: For ticket markets, prices in minor units (e.g., cents) allow up to $21,474,836.47 per ticket, and quantities up to 2.14 billion tickets per order. This comfortably accommodates all foreseeable marketplace activity.
  - *Serialization Safety*: JavaScript `Number` safely represents integers up to `Number.MAX_SAFE_INTEGER` ($2^{53} - 1 \approx 9 \times 10^{15}$). Using `Int` guarantees that order prices and quantities serialize natively via `JSON.stringify()` in Express HTTP responses and WebSocket events without triggering `TypeError: Do not know how to serialize a BigInt`.
- **Global Sequence Number (`BigInt`)**:
  - PostgreSQL `BIGSERIAL` / Prisma `BigInt` was selected for `Execution.sequenceNumber`.
  - *Capacity Verification*: Global execution counts across all events and markets over months and years can exceed 2.14 billion. A 64-bit integer prevents overflow.
  - *Serialization Handling*: When returned in REST or WebSocket payloads, repository and route layers must serialize `sequenceNumber` as a string (`seq.toString()`) to maintain precision and avoid Node.js JSON serialization crashes.

#### 5.8.3 Idempotency Scope and Submission Outcome Recovery
- **Idempotency Scope (`@@unique([userId, idempotencyKey])`)**:
  - The uniqueness constraint is scoped per user. Scoping to `userId` ensures clients generating simple UUIDs or client sequence numbers do not conflict with other users, while preventing network retries from creating duplicate orders for the same user.
- **Original Submission Outcome Recovery**:
  - A unique constraint alone only detects duplicate insertion attempts; it does not reconstruct the original execution outcome.
  - In PassFlow, when an idempotent retry arrives with a known `(userId, idempotencyKey)`:
    1. The order record already contains the terminal or resting status (`status`, `remainingQuantity`, and `stoppedReason`).
    2. Any fills generated on submission are durably stored in `Execution` where `incomingOrderId = order.id`.
    3. Querying `Order` with its related `incomingExecutions` (ordered by `sequenceNumber ASC`) allows `PersistentMatchingService` (Step 8.3) to completely reconstruct the exact `SubmissionResult` object:
       ```javascript
       {
         orderId: order.id,
         status: order.status,
         originalQuantity: order.initialQuantity,
         remainingQuantity: order.remainingQuantity,
         stoppedReason: order.stoppedReason,
         executions: order.incomingExecutions.map(e => ({
           restingOrderId: e.restingOrderId,
           price: e.price,
           quantity: e.quantity,
           sequenceNumber: e.sequenceNumber.toString()
         }))
       }
       ```
    4. This completely avoids re-running the matching algorithm or returning partial or ambiguous state on retries.

#### 5.8.4 Schema Drift Discovery and Safe Non-Destructive Migration
- **Drift Discovery**:
  - Inspection of the live Neon database and migration directory revealed that the database had 2 previously applied migrations: `20261021112254` (initial User) and `20261021151519_add_user_model` (Organizer, Event, TicketCategory, TicketInventory).
  - However, git commit `7c69299` had added `model BuyerSeller` and `enum KycStatus` to `prisma/schema.prisma` without generating a migration.
- **Safe Resolution**:
  - Rather than resetting or using destructive commands, `npx prisma migrate dev --create-only --name add_order_and_execution_models` was executed to generate migration `20261021161148_add_order_and_execution_models`.
  - The generated SQL safely bundled `BuyerSeller`, `KycStatus`, `OrderSide`, `OrderStatus`, `Order`, `Execution`, and their constraints in an additive, non-destructive migration.
  - The migration was reviewed and applied via `npx prisma migrate deploy`. `npx prisma migrate status` confirms 3 migrations applied and database schema up to date.

#### 5.8.5 Validation and Known Limitations
- **Validation**:
  - `npx prisma validate`: Schema is valid.
  - `npx prisma generate`: Generated Prisma Client v6.19.3.
  - `npm test`: 153 tests passed across 8 suites (100% pass rate).
- **Known Limitations & Scope Boundaries**:
  - *No matching engine coupling*: As required by Step 8.1, `src/services/matching/` was not touched. `MatchingCoordinator` remains pure and in-memory.
  - *Prerequisites before DB integration*: `MarketExecutionQueue` (Step 8.2) and `PersistentMatchingService` (Step 8.3) must be implemented before any live orders can be routed through this schema.

---

### 5.9 Step 8.2 Implementation: MarketExecutionQueue & Market State Gating

#### 5.9.1 Overview & Architecture
Step 8.2 implements an in-process, asynchronous FIFO execution queue and market lifecycle state manager under `backend/src/services/matching/`:
- [`market-state.js`](file:///Users/om_upadhyay/OM/workspace/Projects/passflow/backend/src/services/matching/market-state.js): Market lifecycle states, state transitions, collision-free key encoding, and typed error hierarchy.
- [`market-execution-queue.js`](file:///Users/om_upadhyay/OM/workspace/Projects/passflow/backend/src/services/matching/market-execution-queue.js): Per-market async serialization queue, state gating, and diagnostics.
- [`tests/matching/market-execution-queue.test.js`](file:///Users/om_upadhyay/OM/workspace/Projects/passflow/backend/tests/matching/market-execution-queue.test.js): 17 deterministic promise/barrier-based concurrency and failure tests (totaling 170 passing tests across 9 suites).

#### 5.9.2 Collision-Proof Market Key Encoding
Markets are identified by the tuple `(eventId, ticketCategoryId)`. To prevent accidental collisions between different ID pairs (e.g., `eventId: "evt:1", catId: "cat"` vs `eventId: "evt", catId: "1:cat"`):
- **Encoding**: Length-prefixed string `${eventId.length}:${eventId}:${ticketCategoryId.length}:${ticketCategoryId}` via `formatMarketKey(eventId, ticketCategoryId)`.
- **Properties**: Strictly injective (1-to-1 bijection), preserves full fidelity of arbitrary UTF-8 characters, colons, slashes, or whitespace without ambiguity.
- **Decoding**: `parseMarketKey(marketKey)` validates length prefixes and reconstructs `{ eventId, ticketCategoryId }`.
- **Polymorphism**: Accepts separate strings, `{ eventId, ticketCategoryId }` objects, or [`OrderBook`](file:///Users/om_upadhyay/OM/workspace/Projects/passflow/backend/src/services/matching/order-book.js) instances directly.

#### 5.9.3 Market Lifecycle States & Transition Table
Markets are governed by explicit lifecycle states (`MarketState`):
- `INITIALIZING`: Default state upon startup or registration. Unavailable for mutations.
- `READY`: Market is active, healthy, and accepting mutations/matching commands.
- `RECONCILING`: Ambiguous database commit outcome or network disruption detected. Inbound mutations are quarantined and rejected.
- `PAUSED`: Market temporarily suspended by administrative action, circuit breaker, or event maintenance. Mutations rejected.

##### Permitted State Transitions Table
| Current State | Permitted Target States | Description / Trigger |
| :--- | :--- | :--- |
| `INITIALIZING` | `READY`, `PAUSED` | Startup recovery completed, or initialized into suspended state |
| `READY` | `PAUSED`, `RECONCILING` | Admin halt / circuit breaker, or ambiguous DB outcome detected |
| `PAUSED` | `READY`, `RECONCILING` | Admin resume, or background reconciliation initiated while paused |
| `RECONCILING` | `READY`, `PAUSED` | Reconciliation verified and completed, or failed requiring manual inspection |

*Rules*: Self-transitions (e.g., `READY` -> `READY`) and transitions back to `INITIALIZING` are disallowed and throw `InvalidMarketStateTransitionError` (`code: 'INVALID_MARKET_STATE_TRANSITION'`).

#### 5.9.4 Two-Phase State Gating
To eliminate race windows between readiness inspection and mutation execution:
1. **Front Gate (Enqueue Time)**:
   When `queue.execute(marketKey, taskFn)` is invoked with `{ checkState: true }` (default), the queue asserts that the market is in `READY` state. If not, it rejects immediately with `MarketNotReadyError` (`code: MARKET_${currentState}`) without adding the task to memory.
2. **Execution Gate (Head of Queue)**:
   When a task reaches the front of the queue, the queue re-checks `isReady(marketKey)` right before invoking `taskFn`. If the market transitioned to `PAUSED` or `RECONCILING` while the task was waiting behind an in-flight operation, the task is rejected with `MarketNotReadyError` and `taskFn` is **never executed**.

#### 5.9.5 FIFO Ordering, Concurrency & Failure Guarantees
- **Strict FIFO Serialization**: Tasks queued for the same market execute in the exact order enqueued. No two asynchronous operations on the same market ever run concurrently, even when operations await promises or database I/O.
- **Cross-Market Concurrency**: Queues for different markets are completely isolated. Tasks for Market A and Market B execute concurrently without contention.
- **Fault Isolation**: If a task throws an exception or rejects, that error is forwarded strictly to that task's caller. The queue runner catches the error, marks diagnostic failure counters, and immediately advances to the next pending item in the queue.
- **Memory Hygiene**: As soon as a market queue finishes its last task and has no pending tasks, it is safely deleted from internal maps. Idle markets consume zero memory.

#### 5.9.6 State Transition Ordering Semantics
Two complementary coordination modes are supported:
1. **Immediate State Transition (`transitionMarket`)**:
   Immediately transitions the state manager. In-flight operations finish, but any currently waiting tasks in the queue are rejected at the head-of-queue gate without executing.
2. **Queued State Transition (`enqueueTransition`)**:
   Enqueues the state transition as an administrative task (`{ checkState: false }`). Prior queued tasks complete while the market is `READY`. Once the transition executes, subsequent tasks encounter the new state.

#### 5.9.7 Diagnostic & Inspection API
`MarketExecutionQueue` exposes non-intrusive diagnostic methods:
- `getPendingCount(marketKey)`: Number of queued tasks waiting to run.
- `isProcessing(marketKey)`: Boolean indicating whether an async task is actively executing.
- `getActiveMarketKeys()`: Array of market keys currently holding active or pending tasks.
- `getStats(marketKey)`: `{ totalEnqueued, totalProcessed, totalFailed, pendingCount, isProcessing }`.
- `size()`: Number of currently active market queues.

#### 5.9.8 Known Limitations & Boundaries
- **Process-Local Only**: `MarketExecutionQueue` enforces mutual exclusion within a single Node.js process. It does not provide distributed locking across multiple cluster nodes or containers. Distributed safety across multiple instances requires database-level advisory locking / lease fencing (as designed in Section 5.6).
- **Decoupled from Persistence**: In accordance with the Step 8.2 boundary, `MarketExecutionQueue` was initially implemented decoupled from database persistence; Step 8.3 integrates it with `PersistentMatchingService`.

---

### 5.10 Step 8.3 Implementation: Persistent Matching Service & Atomic Transaction Bridge

#### 5.10.1 Overview & Architecture
Step 8.3 establishes the persistence boundary and transactional bridge between the in-memory matching engine and PostgreSQL via Prisma:
- [`order-repository.js`](file:///Users/om_upadhyay/OM/workspace/Projects/passflow/backend/src/services/matching/order-repository.js): Database read and write operations, optimistic resting order quantity verification, and atomic `prisma.$transaction` persistence.
- [`persistent-matching-service.js`](file:///Users/om_upadhyay/OM/workspace/Projects/passflow/backend/src/services/matching/persistent-matching-service.js): Orchestrates the 10-step submission lifecycle under per-market `MarketExecutionQueue` serialization, post-commit state mutation, and deterministic outcome recovery.
- [`matching-coordinator.js`](file:///Users/om_upadhyay/OM/workspace/Projects/passflow/backend/src/services/matching/matching-coordinator.js): Refactored to expose `calculatePlan(book, incomingOrder)` (pure plan calculation without mutation) and `applyPlan(book, incomingOrder, plan)` (post-commit book mutation), while preserving existing `submitLimitOrder` API.
- [`tests/matching/persistent-matching-service.test.js`](file:///Users/om_upadhyay/OM/workspace/Projects/passflow/backend/tests/matching/persistent-matching-service.test.js): 14 deterministic tests with mock failure injection plus live Neon PostgreSQL end-to-end integration tests (184 total passed tests across 10 suites).

#### 5.10.2 The 10-Step Submission Lifecycle
Every limit order submission follows a strict, non-interleaved 10-step pipeline:
1. **Contract Validation**: Validates `eventId`, `ticketCategoryId`, `userId`, `side`, integer `price > 0`, integer `quantity > 0`, and non-empty `idempotencyKey` before touching the queue or database.
2. **Queue Entry**: Enters `MarketExecutionQueue` for the relevant `(eventId, ticketCategoryId)` market key, ensuring strict single-writer FIFO serialization.
3. **Serialized Readiness Gate**: Asserts that the market is in `READY` state and has an initialized in-memory `OrderBook`.
4. **Idempotency Lookup**: Queries PostgreSQL for an existing `(userId, idempotencyKey)` submission. If found, returns the stored outcome without calculating matches again.
5. **Synchronization Verification**: Asserts that the market book is valid and matches the incoming market parameters.
6. **Pure Plan Calculation**: Computes the matching plan via `coordinator.calculatePlan(book, incomingOrder)` without mutating the live in-memory order book.
7. **Atomic Prisma Transaction**: In a single `prisma.$transaction`:
   - Persists the incoming `Order` record with appropriate initial status (`OPEN`, `PARTIALLY_FILLED`, `FILLED`, or `CANCELLED` on STP).
   - Optimistically updates each resting `Order` record with `WHERE id = :id AND remainingQuantity = :expectedRemaining`.
   - Persists all `Execution` records linking the taker and maker orders.
8. **Post-Commit In-Memory Mutation**: Calls `coordinator.applyPlan(book, incomingOrder, plan)` to mutate the live `OrderBook` **only after** PostgreSQL confirms successful commit.
9. **Queue Release**: The market queue remains held through the entire lifecycle until post-commit in-memory mutation completes.
10. **Result Dispatch**: Returns a detached, JSON-serializable `SubmissionResult` consistent with persisted database records.

#### 5.10.3 Transaction Boundary & Optimistic Concurrency Protection
To prevent stale matching calculations from silently overwriting newer database state:
- When updating resting orders inside `prisma.$transaction`, `OrderRepository` uses:
  ```javascript
  const updateResult = await tx.order.updateMany({
    where: { id: restingId, remainingQuantity: expectedRemaining },
    data: { remainingQuantity: newRemaining, status: newStatus },
  });
  if (updateResult.count === 0) {
    throw new MarketStateDivergenceError(...);
  }
  ```
- If the remaining quantity in PostgreSQL diverges from the in-memory book state, the transaction immediately rolls back and throws `MarketStateDivergenceError`.
- The service catches this divergence, quarantines the market by transitioning it into `RECONCILING`, and rejects subsequent operations until reconciled.

#### 5.10.4 Post-Commit Mutation & Zero Phantom State Invariant
- **The Invariant**: In-memory `OrderBook` state is **never modified before confirmed database commit**.
- If a database transaction aborts or rolls back (due to constraint violations, disk errors, or rollbacks), the live `OrderBook` remains 100% unmutated.
- Concurrent requests waiting in queue will never calculate matches against phantom or uncommitted state.

#### 5.10.5 Idempotency Scope, Outcome Reconstruction & BigInt Safety
- **Scope**: `@@unique([userId, idempotencyKey])` strictly enforces per-user idempotency.
- **Outcome Recovery**: When an idempotent retry arrives:
  1. The existing `Order` and its related `incomingExecutions` are read from PostgreSQL (ordered by `sequenceNumber ASC`).
  2. The exact `SubmissionResult` object (order ID, status, filled quantity, remaining quantity, stopped reason, and executions) is deterministically reconstructed.
  3. `isDuplicate: true` is set on the response to inform the client.
- **`BigInt` Serialization Safety**: `Execution.sequenceNumber` is cast via `.toString()` before returning. All returned payloads are guaranteed to serialize cleanly via `JSON.stringify()`.

#### 5.10.6 Failure Classification & Ambiguous Commit Quarantine
The service distinguishes definitive rollbacks from ambiguous commit timeouts:
- **Definitive Rollbacks** (e.g. `P2003` foreign key violation, validation error):
  - Database was rolled back; book was never touched.
  - Market remains in `READY` state. Error is rethrown.
- **Ambiguous Outcomes** (`ECONNRESET`, `ETIMEDOUT`, `P2024`, `P2028` during commit):
  - Impossible to determine whether PostgreSQL committed the transaction before disconnecting.
  - In-memory book is **not mutated**.
  - Market is immediately quarantined: transitioned into `RECONCILING`.
  - Throws `AmbiguousCommitError`. Subsequent mutating operations are rejected by `MarketExecutionQueue`.

#### 5.10.7 Pause Behavior & Asynchronous Coordination
- If an administrative pause (`queue.transitionMarket(key, MarketState.PAUSED)`) occurs while a database transaction is in flight:
  - The in-flight transaction completes and commits, and its post-commit in-memory update is applied. A committed financial order is never falsely labeled as aborted.
  - Any subsequent tasks waiting in queue behind it reach the head-of-queue gate, detect `PAUSED`, and are cleanly rejected with `MarketNotReadyError` without ever entering the database.

#### 5.10.8 Financial and Ownership Boundaries
Step 8.3 strictly records order and execution data only:
- **No Wallets**: No user balances or wallet funds are debited or credited.
- **No Ledger / Escrow**: Ledger entries and trade escrow are not implemented.
- **No Ticket Transfers**: Ticket inventory ownership is not transferred.
- **No Distributed Locks**: Multi-instance clustering is not supported; PassFlow must run as a single backend instance until database lease fencing is implemented.

#### 5.10.9 Validation & Test Results
- Full Jest test suite: **184 passing tests across 10 test suites** (0 failures).
- Deterministic mock failure injection tests: 13 tests in [`tests/matching/persistent-matching-service.test.js`](file:///Users/om_upadhyay/OM/workspace/Projects/passflow/backend/tests/matching/persistent-matching-service.test.js).
- Live PostgreSQL integration test: Connected to live Neon database, seeded User/Event/Category parent records, executed limit order persistence, matching trade creation, `BIGSERIAL` sequence verification, idempotent outcome recovery, and cascade cleanup.

---

### 5.11 Step 8.3A Audit: Post-Commit Safety and Market Readiness

#### 5.11.1 Market Readiness & Synchronization Verification
- **Problem**: In Step 8.3, registering an empty `OrderBook` immediately placed the market into `INITIALIZING`, allowing transition to `READY`. If PostgreSQL already held resting orders from previous runs or crashes, matching incoming orders against an empty book would cross trades incorrectly or skip valid fills.
- **Solution & Invariants**:
  - `registerMarketBook(marketKey, book, { synchronized = false })`: By default, newly registered markets are marked unsynchronized.
  - `PersistentMatchingService._assertMarketSynchronized()`: Before matching any submission, the service verifies synchronization. If the book is empty, it queries PostgreSQL via `OrderRepository.findActiveOrdersByMarket(eventId, ticketCategoryId)`. If active resting orders exist in PostgreSQL that are missing from memory, it immediately rejects the submission with `MarketNotSynchronizedError`.
  - **Prerequisites for enabling a market to `READY`**:
    1. An `OrderBook` instance must be registered with `registerMarketBook`.
    2. Active resting orders in PostgreSQL must be replayed/reconstructed into the in-memory book in sequence (to be implemented in Step 8.4 reconstruction worker).
    3. The market book must be explicitly certified via `markMarketSynchronized(marketKey)`.
    4. Only then may `stateManager.transition(marketKey, MarketState.READY)` be invoked.

#### 5.11.2 Post-Commit `applyPlan()` Failure Isolation & Quarantine
- **Problem**: If `coordinator.applyPlan()` throws an unhandled error *after* `persistMatchingTransaction()` has already committed to PostgreSQL:
  - The transaction cannot be rolled back (it is committed in PostgreSQL).
  - The in-memory book could be in a partially mutated or inconsistent state.
- **Solution & Invariants**:
  - The committed transaction is **never** treated as rolled back or automatically resubmitted.
  - The market is marked corrupted (`_corruptedMarkets.add(marketKey)`) and desynchronized.
  - The market state is transitioned immediately to `RECONCILING`.
  - The per-market queue remains held until quarantine handling completes.
  - Throws `PostCommitMutationError`, attaching `{ originalError, marketKey, orderId, persistedOrder, persistedExecutions }` so the exact committed state can be recovered without financial data loss.
  - All subsequent submissions to this market are rejected by the queue's `READY` gate (or by `_assertMarketSynchronized` with `MarketStateDivergenceError`).

#### 5.11.3 Matching Result Contract & Stop Reason Audit
- **Contract Clarification**: Final order `status` and matching strategy `stoppedReason` are distinct domain concepts:
  - `status`: Lifecycle state of the order entity (`OPEN`, `PARTIALLY_FILLED`, `FILLED`, `CANCELLED`).
  - `stoppedReason`: The operational rule that terminated the matching loop (`FILLED`, `LIMIT_PRICE_REACHED`, `NO_MORE_LIQUIDITY`, `SELF_TRADE_PREVENTION`).
- **Contract Guarantee**:
  - `FILLED` is strictly returned as `stoppedReason` only when the incoming order's remaining quantity is zero.
  - When an order rests with no opposing liquidity, `stoppedReason` is `NO_MORE_LIQUIDITY` and `status` is `OPEN` (or `PARTIALLY_FILLED` if prior fills occurred).
  - When an order halts due to price limits, `stoppedReason` is `LIMIT_PRICE_REACHED`.
  - When self-trade prevention triggers, `status` is `CANCELLED` and `stoppedReason` is `SELF_TRADE_PREVENTION`.
  - First-time submissions and idempotent retries produce 100% identical `status` and `stoppedReason` across all outcome paths.

#### 5.11.4 Idempotency Uniqueness Conflicts & Payload Mismatch Protection
- **Constraint Target Inspection**:
  - Prisma error `P2002` metadata is inspected specifically for `target = ['userId', 'idempotencyKey']`.
  - Unrelated unique violations (e.g. primary key collisions on `Order.id`) are immediately rethrown rather than mistaken for successful idempotent retries.
- **Payload Mismatch Detection**:
  - When an existing order matches `(userId, idempotencyKey)`, the service validates that the incoming request payload matches the stored order parameters (`eventId`, `ticketCategoryId`, `side`, `price`, `initialQuantity`).
  - If any parameter differs (including attempts to submit across different markets with the same idempotency key), the request is rejected with `IdempotencyPayloadMismatchError`.

#### 5.11.5 Execution-History Deletion Integrity & Foreign Key Audit
- **Audit Finding**: In `backend/prisma/schema.prisma` (lines 172 & 174), relations on `Execution` define:
  ```prisma
  incomingOrder Order @relation("IncomingOrderExecutions", fields: [incomingOrderId], references: [id], onDelete: Cascade)
  restingOrder  Order @relation("RestingOrderExecutions", fields: [restingOrderId], references: [id], onDelete: Cascade)
  ```
  If an `Order` record were physically deleted (`DELETE FROM "Order"`), PostgreSQL would cascade-delete associated `Execution` records, destroying immutable financial audit history.
- **Mitigation & Policy**:
  1. *Application-Level Prohibition*: Physical deletion of orders is strictly prohibited. `OrderRepository` provides no delete methods. Order cancellations must only update `status = 'CANCELLED'`.
  2. *Proposed Non-Destructive Migration*: In a scheduled migration window, execute:
     ```sql
     ALTER TABLE "Execution" DROP CONSTRAINT "Execution_incomingOrderId_fkey";
     ALTER TABLE "Execution" ADD CONSTRAINT "Execution_incomingOrderId_fkey" FOREIGN KEY ("incomingOrderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
     ALTER TABLE "Execution" DROP CONSTRAINT "Execution_restingOrderId_fkey";
     ALTER TABLE "Execution" ADD CONSTRAINT "Execution_restingOrderId_fkey" FOREIGN KEY ("restingOrderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
     ```
     This will be bundled safely in an upcoming migration without data loss or reset.

#### 5.11.6 Test Suite Results
- Full Jest test suite: **193 passing tests across 10 test suites** (0 failures).
- Mock failure injection tests: 22 unit tests covering all edge cases and failure modes.
- Live Neon PostgreSQL integration test: Verified against real database tables.

---

### 5.12 Step 8.4 Implementation: Startup Order-Book Reconstruction & Market Reconciliation

#### 5.12.1 Overview & Architecture
Step 8.4 implements deterministic startup order-book reconstruction, post-commit failure recovery, ambiguous commit reconciliation, and market synchronization certification:
- [`persistent-matching-service.js`](file:///Users/om_upadhyay/OM/workspace/Projects/passflow/backend/src/services/matching/persistent-matching-service.js): Implements `reconstructMarket`, `reconcileMarket`, `initializeAndSynchronizeMarket`, `_reconstructBookUnderQueue`, and `_quarantineCorruptedMarket`.
- [`order-repository.js`](file:///Users/om_upadhyay/OM/workspace/Projects/passflow/backend/src/services/matching/order-repository.js): Added deterministic `findActiveOrdersByMarket(eventId, ticketCategoryId)` and `countActiveOrdersByMarket(eventId, ticketCategoryId)` sorted by `createdAt ASC, id ASC`.
- [`market-state.js`](file:///Users/om_upadhyay/OM/workspace/Projects/passflow/backend/src/services/matching/market-state.js): Added `hasMarket(marketKey)` helper.
- [`tests/matching/market-reconstruction.test.js`](file:///Users/om_upadhyay/OM/workspace/Projects/passflow/backend/tests/matching/market-reconstruction.test.js): 17 comprehensive deterministic failure, recovery, and live Neon PostgreSQL integration tests.

#### 5.12.2 Deterministic Startup Reconstruction & Ordering Rule
- **Query Strategy**: Loads all active resting orders from PostgreSQL using:
  ```javascript
  where: {
    eventId,
    ticketCategoryId,
    status: { in: ['OPEN', 'PARTIALLY_FILLED'] },
  },
  orderBy: [
    { createdAt: 'asc' },
    { id: 'asc' },
  ]
  ```
- **Why FIFO is Preserved**:
  - `OrderBookSide` enforces price priority via its internal comparator (`_comparator`).
  - Within each price level, `PriceLevel` maintains an internal `FIFOQueue`. Orders are replayed in `createdAt ASC, id ASC` order.
  - Earlier resting orders enter the FIFO queue first, guaranteeing that orders at the same price level match in their exact historical arrival sequence.
- **Analysis of `createdAt` and Proposed Invariant**:
  - `createdAt TIMESTAMP(3)` provides millisecond-resolution timestamps. Under single-writer queue serialization (`MarketExecutionQueue`), orders execute sequentially, producing distinct timestamps.
  - `{ id: 'asc' }` serves as a strict secondary tie-breaker ensuring 100% deterministic, reproducible replay across restarts.
  - *Proposed Additive Migration*: To guarantee sub-millisecond arrival ordering without relying on timestamps, an additive `sequenceNumber BIGSERIAL` on `Order` is recommended for future high-frequency multi-partition deployments.

#### 5.12.3 Strict Order Validation & Zero Silent Skipping
- During reconstruction, every loaded active order is strictly validated:
  - `id` and `userId` are non-empty strings.
  - `eventId` and `ticketCategoryId` match the market.
  - `side` is `'BID'` or `'ASK'`.
  - `price` is a positive safe integer minor tick unit (`cents > 0`).
  - `remainingQuantity` is a positive safe integer (`> 0`) and does not exceed `initialQuantity`.
  - `status` is strictly `'OPEN'` or `'PARTIALLY_FILLED'`.
- **Zero Silent Skipping**: If any order record in PostgreSQL is invalid or corrupted (e.g. `remainingQuantity <= 0` on an `OPEN` order), it is **never** silently ignored. The reconstruction routine invokes `_quarantineCorruptedMarket(marketKey)`, removes synchronization flags, and throws `MarketReconstructionError`.

#### 5.12.4 Synchronization Certification
- A market can only become `READY` through an enforced service-level path:
  1. Market book is registered.
  2. Active resting orders are retrieved from PostgreSQL.
  3. Fresh in-memory `OrderBook` is instantiated and populated.
  4. Snapshot invariants are verified: `newBook.size() === activeOrders.length` and `newBook.totalQuantity() === sum of remainingQuantity`.
  5. The verified book is atomically stored, corrupted flags cleared, and `_synchronizedMarkets.add(marketKey)` is set.
- `markMarketSynchronized()` asserts that `book.size() === activeOrders.length` against PostgreSQL before certifying synchronization; unverified manual marking is prohibited.

#### 5.12.5 Ambiguous Commit & Post-Commit Failure Reconciliation
- When a market is quarantined in `RECONCILING` (due to connection reset during commit or post-commit in-memory mutation throw):
  - `reconcileMarket(marketKey, { ambiguousSubmission })` queries PostgreSQL via `repository.findByIdempotencyKey(userId, idempotencyKey)`.
  - If found, it confirms the order committed (`committed: true`) and returns the exact execution outcome without rematching.
  - If absent, it authoritatively confirms the order rolled back (`committed: false`).
  - If PostgreSQL is unreachable, it throws `MarketReconciliationError` and keeps the market quarantined in `RECONCILING`.
  - Reconstructs a fresh `OrderBook` from PostgreSQL, clearing any corrupted or partial in-memory state.
  - Transitions the market from `RECONCILING` to `READY` (unless administratively `PAUSED`).

#### 5.12.6 Market Lifecycle State Dynamics
- `INITIALIZING`: Initial cold-start state. Mutating submissions rejected. `initializeAndSynchronizeMarket()` reconstructs the book and transitions to `READY`.
- `READY`: Market active and accepting orders. Reconstructing a live market serializes via `MarketExecutionQueue.execute(..., { checkState: false })`, ensuring submissions queue behind reconstruction without interleaving or race conditions.
- `RECONCILING`: Quarantined state. Mutating submissions rejected. `reconcileMarket()` authoritatively resolves ambiguous outcomes, reconstructs the book, and transitions to `READY`.
- `PAUSED`: Administratively paused market. Mutating submissions rejected. Reconstruction updates the in-memory book and marks it synchronized, but strictly preserves the `PAUSED` state without unpausing.

#### 5.12.7 Test Suite Results
- Full Jest test suite: **210 passing tests across 11 test suites** (0 failures).
- Mock failure injection tests: 16 deterministic unit tests in `market-reconstruction.test.js`.
- Live Neon PostgreSQL integration test: Verified end-to-end on live database (startup reconstruction of resting orders, taker matching against reconstructed book, maker quantity reduction, and cleanup).

---

### 5.13 Step 8.4A — FIFO Arrival Ordering and Reconstruction Integrity Audit

#### 5.13.1 True Price-Time Priority via Monotonic Order Sequence
- **Problem Statement**:
  - The previous reconstruction query relied on `ORDER BY createdAt ASC, id ASC`.
  - Under high-frequency order placement or batch imports, orders sharing identical millisecond timestamps (`createdAt`) relied on `id ASC` (UUID) as a tie-breaker.
  - While UUID tie-breaking is deterministic across replays, it does not prove historical arrival order when timestamps tie.
- **Additive Monotonic Sequence Migration**:
  - Created and applied non-destructive migration `20261021174645_add_order_sequence_number`.
  - Added `sequenceNumber BigInt @default(autoincrement())` to the `Order` model in `schema.prisma`.
  - Backfill Methodology: Existing rows were backfilled deterministically using:
    ```sql
    WITH numbered AS (
      SELECT id, ROW_NUMBER() OVER (ORDER BY "createdAt" ASC, "id" ASC) as rn
      FROM "Order"
    )
    UPDATE "Order" o
    SET "sequenceNumber" = n.rn
    FROM numbered n
    WHERE o.id = n.id;
    ```
  - **Historical Uncertainty Disclosure**: True sub-millisecond arrival order for legacy records prior to migration `20261021174645_add_order_sequence_number` cannot be recovered if it was never recorded in the original system. Their assigned sequence numbers reflect deterministic `(createdAt ASC, id ASC)` ordering.
  - Sequence Synchronization: Set `Order_sequenceNumber_seq` to `COALESCE(MAX("sequenceNumber"), 0) + 1` to guarantee subsequent inserts receive contiguous monotonic values.
  - Performance Indexes: Added `@@index([eventId, ticketCategoryId, status, price, sequenceNumber])` and `@@index([sequenceNumber])`.
  - Replay Ordering: `OrderRepository.findActiveOrdersByMarket()` now queries:
    ```javascript
    orderBy: [
      { sequenceNumber: 'asc' },
    ]
    ```
- **Monotonicity & Commit Ordering**:
  - In PostgreSQL, `nextval()` allocates monotonically increasing integers.
  - Under PassFlow's single-backend instance and `MarketExecutionQueue` per market, order submissions are processed strictly sequentially.
  - Sequence allocation order is guaranteed during order insertion within the transaction. Sequence gaps (e.g. from aborted non-matching orders or rolled-back transactions) are acceptable and do not compromise relative ordering of committed resting orders.
  - *Distinction*: Sequence allocation order reflects order creation order; in a multi-writer environment it would not guarantee transaction commit order, but under PassFlow's serialized single-writer queue, orders for a given market enter the database sequentially.

#### 5.13.2 Strengthened Deep Snapshot Verification
- **Vulnerability**: Relying solely on `book.size() === activeOrders.length` and total quantity could permit a corrupted book (e.g., swapped order IDs, reversed FIFO priority, or inverted prices) to be certified as synchronized.
- **Deep Verification Invariants**:
  - `PersistentMatchingService._verifyBookMatchesDatabaseSnapshot(book, activeOrders, context)` executes comprehensive assertions before certifying synchronization:
    1. **Exact Total Size & Quantity**: `book.size() === activeOrders.length` and `book.totalQuantity() === sum(remainingQuantity)`.
    2. **Market Identity Parity**: Verifies `book.eventId === eventId` and `book.ticketCategoryId === ticketCategoryId`.
    3. **Order Field Parity**: For every order in the PostgreSQL active snapshot:
       - Order ID exists in the book (`book.getOrder(order.id)`).
       - Side matches (`lookup.side === order.side`).
       - Price matches (`bookOrder.price === order.price`).
       - Remaining quantity matches (`bookOrder.remainingQuantity === order.remainingQuantity`).
       - User ID matches (`bookOrder.userId === order.userId`).
       - Market IDs match (`bookOrder.eventId === eventId` and `bookOrder.ticketCategoryId === ticketCategoryId`).
    4. **True FIFO Queue Ordering**: For every `(side, price)` level:
       - Extracts book orders via `book.getOrders(side).filter(o => o.price === price)`.
       - Compares the array of order IDs against the database snapshot's sequence ordered by `sequenceNumber: 'asc'`.
       - Rejects any discrepancy at position `i` with `FIFO_ORDERING_MISMATCH`.
    5. **Zero Phantom Orders**: Asserts that no resting orders exist in the book that are absent from the PostgreSQL active snapshot.
- **Enforced Synchronization**:
  - `markMarketSynchronized()` cannot certify a book simply by checking order count. It must execute full snapshot verification against PostgreSQL. If verification fails, the market is quarantined and throws `MarketNotSynchronizedError`.

#### 5.13.3 Market State Dynamics & Race Safety
- **Administrative Pause Integrity**:
  - If a market is in `MarketState.PAUSED`, reconstruction or reconciliation refreshes the in-memory order book and verifies snapshot parity, but strictly preserves `MarketState.PAUSED`.
  - An administrative pause cannot be overwritten by transitions to `READY`.
- **Interleaving Prevention**:
  - Reconstruction and reconciliation run inside `queue.execute(marketKey, ..., { checkState: false })`.
  - While reconstruction executes, any concurrent submission for that market queues behind it and executes only after reconstruction completes and verifies the book.
- **Failure Quarantine**:
  - If database loading or snapshot verification encounters corrupted data or network failure, the market is quarantined into `PAUSED` / `RECONCILING` and marked desynchronized (`_corruptedMarkets.add(marketKey)`).
  - All subsequent submissions are blocked with `MarketNotReadyError`.

#### 5.13.4 Audit Test Verification
- Deterministic audit tests in `backend/tests/matching/market-reconstruction.test.js`:
  1. Multiple same-price orders sharing identical `createdAt` timestamps preserve true FIFO priority via `sequenceNumber`.
  2. FIFO preservation across process reconstruction and subsequent multi-fill taker match.
  3. Rejection when book size and total quantity match but order IDs differ (`ORDER_MISSING_FROM_BOOK`).
  4. Rejection when order ID matches but price, side, or remaining quantity differs.
  5. Rejection when market identifiers (eventId / ticketCategoryId) mismatch.
  6. Rejection when FIFO queue ordering at the same price level is inverted (`FIFO_ORDERING_MISMATCH`).
  7. Rejection when a phantom order exists in the order book (`PHANTOM_ORDER_IN_BOOK`).
  8. Quarantine on invalid persisted order attributes (e.g. `remainingQuantity > initialQuantity`).
  9. Preserved `PAUSED` state across reconstruction leaving order submissions blocked.
  10. Deterministic replay and ordering for backfilled orders with sequence numbers.
- **Full Test Suite Results**:
  - **235 passing tests across 12 test suites** (0 failures).
  - 100% test pass rate across all matching engine components, queue concurrency, persistence boundary, reconstruction, and live Neon PostgreSQL integration.

---

### 5.14 Step 9.1 — Wallet and Immutable Ledger Schema

#### 5.14.1 Financial Invariants & Currency Representation
- **Monetary Unit**:
  - All monetary values are strictly represented in integer minor currency units: **paise** (1 INR = 100 paise) using PostgreSQL `BIGINT` / JavaScript `BigInt`.
  - Floating-point representations for money are strictly prohibited to prevent decimal rounding discrepancies.
- **Available vs. Reserved Balance**:
  - A wallet maintains two distinct balance buckets:
    1. `availableBalance`: Funds immediately available for new order commitments, withdrawals, or transfers.
    2. `reservedBalance`: Funds held in escrow for open limit buy orders or pending withdrawal requests.
  - *Core Invariant*: Reserving funds is **not** spending them. A reservation transitions funds between buckets without creating or destroying money:
    $$\text{availableDelta} = -\text{amount}, \quad \text{reservedDelta} = +\text{amount}$$
    $$\text{availableDelta} + \text{reservedDelta} = 0$$
- **Materialized Projection & Ledger Invariant**:
  - `Wallet.availableBalance` and `Wallet.reservedBalance` are transactionally maintained materialized projections backed by the immutable ledger. They are not independently authoritative:
    $$\text{Wallet.availableBalance} = \sum_{\text{all ledger entries}} \text{availableDelta}$$
    $$\text{Wallet.reservedBalance} = \sum_{\text{all ledger entries}} \text{reservedDelta}$$
    $$\text{Wallet.totalBalance} = \text{availableBalance} + \text{reservedBalance}$$
- **Hold Reconciliation Invariant**:
  - Active reservation integrity requires that the reserved balance matches the aggregate unconsumed amount of all active holds:
    $$\text{Wallet.reservedBalance} = \sum_{\text{active / partially\_settled holds}} \text{WalletHold.remainingAmount}$$
- **Non-Negativity Constraint**:
  - Invariant: $\text{availableBalance} \ge 0$ and $\text{reservedBalance} \ge 0$ at all times. Negative balances are rejected at the persistence boundary.
- **Append-Only Immutability**:
  - Ledger entries are strictly append-only. Existing entries cannot be updated (`UPDATE`) or deleted (`DELETE`).
  - Accounting corrections must be posted as new `COMPENSATING_ADJUSTMENT` entries referencing the prior sequence and operational context.

#### 5.14.2 Schema Models Added
1. **`Wallet`**:
   - Represents the account balance state for a user (`1 User : 1 Wallet`).
   - Fields: `id` (UUID PK), `userId` (`String @unique`), `currency` (`String @default("INR")`), `availableBalance` (`BigInt @default(0)`), `reservedBalance` (`BigInt @default(0)`), `version` (`BigInt @default(0)`), `createdAt`, `updatedAt`.
   - Relation: `user User @relation(fields: [userId], references: [id], onDelete: Restrict)`.
2. **`FinancialOperation`**:
   - Idempotent business operation registry grouping financial movements.
   - Fields: `id` (UUID PK), `idempotencyKey` (`String @unique`), `operationType` (`FinancialOperationType`), `status` (`FinancialOperationStatus @default(PENDING)`), `referenceType` (`String?`), `referenceId` (`String?`), `description` (`String?`), `metadata` (`Json?`), `createdAt`, `updatedAt`.
   - Prevents duplicate posting of financial actions upon client retries.
3. **`WalletHold`**:
   - Explicit tracking of ongoing fund reservations for orders or withdrawal escrows.
   - Fields: `id` (UUID PK), `walletId` (`String`), `operationId` (`String?`), `orderId` (`String?`), `reason` (`HoldReason @default(ORDER_ESCROW)`), `status` (`HoldStatus @default(ACTIVE)`), `heldAmount` (`BigInt`), `remainingAmount` (`BigInt`), `idempotencyKey` (`String?`), `createdAt`, `updatedAt`.
   - Uniqueness: `@@unique([walletId, idempotencyKey])`.
4. **`WalletLedgerEntry`**:
   - Immutable audit trail of every balance mutation.
   - Fields: `id` (UUID PK), `walletId` (`String`), `operationId` (`String?`), `sequenceNumber` (`BigInt @unique @default(autoincrement())`), `entryType` (`LedgerEntryType`), `amount` (`BigInt > 0`), `availableDelta` (`BigInt`), `reservedDelta` (`BigInt`), `balanceAfterAvailable` (`BigInt`), `balanceAfterReserved` (`BigInt`), `holdId` (`String?`), `orderId` (`String?`), `executionId` (`String?`), `idempotencyKey` (`String?`), `description` (`String?`), `createdAt`.
   - Uniqueness: `@@unique([walletId, idempotencyKey])` and `@@unique([sequenceNumber])`.

#### 5.14.3 Database-Level Uniqueness on Order.sequenceNumber
- Verified that `Order.sequenceNumber` had zero duplicate values in the database.
- Upgraded `Order.sequenceNumber` from a standard non-unique index to a database-level unique constraint (`CREATE UNIQUE INDEX "Order_sequenceNumber_key" ON "Order"("sequenceNumber")`).
- Updated `schema.prisma` to declare `sequenceNumber BigInt @unique @default(autoincrement())`.

#### 5.14.4 Referential Integrity & Anti-Cascade Deletion
- Financial history cannot be silently erased through cascading deletions. `onDelete: Restrict` is strictly enforced:
  - `User -> Wallet`: Cannot delete a User if an associated Wallet exists.
  - `Wallet -> WalletLedgerEntry`: Cannot delete a Wallet if ledger records exist.
  - `Wallet -> WalletHold`: Cannot delete a Wallet if holds exist.
  - `Order -> WalletHold`: Cannot delete an Order if financial holds reference it.
  - `Order -> WalletLedgerEntry`: Cannot delete an Order if financial ledger entries reference it.
  - `Execution -> WalletLedgerEntry`: Cannot delete an Execution if ledger entries reference it.
  - `FinancialOperation -> WalletLedgerEntry`: Cannot delete a financial operation if ledger entries reference it.

#### 5.14.5 Migration Details & Status
- **Migration Name**: `20261021181500_add_wallet_and_ledger_schema`
- **Type**: Additive, non-destructive migration.
- **Application**: Applied successfully to live Neon PostgreSQL database (`neondb` on AWS us-east-2).
- **Prisma Status**: `npx prisma migrate status` confirms:
  ```
  5 migrations found in prisma/migrations
  Database schema is up to date!
  ```
- **Prisma Client**: Re-generated (`v6.19.3`).

#### 5.14.6 Scope Boundaries & Unimplemented Systems
- Step 9.1 strictly implements the database schema foundation.
- The following systems remain **unimplemented** per scope boundaries:
  - Wallet service methods, balance modification endpoints, deposit/withdrawal controllers.
  - Payment gateway webhooks or external integrations.
  - Order-entry wallet reservations or pre-trade checks.
  - Automatic balance debits or credits from matching-engine events.
  - Trade settlement or seller payout pipelines.
  - Ticket inventory ownership assignment or transfers.
  - Redis or distributed locks.
- The matching engine continues to run as a pure matching coordinator without asserting that funds have been transferred or settled.

#### 5.14.7 Test Coverage
- **New Integration Test Suite**: `backend/tests/wallet/wallet-ledger-schema.test.js`
  - 12 integration tests run against live Neon PostgreSQL:
    1. Wallet creation with 0 paise available and reserved balances.
    2. 1:1 `User` <-> `Wallet` uniqueness constraint (`P2002`).
    3. `FinancialOperation.idempotencyKey` uniqueness constraint.
    4. `WalletHold` creation and `walletId_idempotencyKey` uniqueness.
    5. `WalletLedgerEntry` auto-incrementing monotonic sequence number (`entry3 > entry2 > entry1`).
    6. Conservation of funds invariant on reservation (`availableDelta + reservedDelta === 0`).
    7. Mathematical balance reconstruction invariant from sum of ledger deltas.
    8. `WalletLedgerEntry.walletId_idempotencyKey` uniqueness.
    9. Referential integrity preventing User deletion when Wallet exists (`onDelete: Restrict`).
    10. Referential integrity preventing Wallet deletion when LedgerEntries exist.
    11. Referential integrity preventing Order deletion when referenced by Hold or LedgerEntry.
    12. Database-level uniqueness enforcement on `Order.sequenceNumber`.
- **Full Backend Test Suite Results**:
  - **247 passing tests across 13 test suites** (0 failures).

---

### 5.14A Step 9.1A — Wallet Schema Integrity and Ledger Immutability Audit

#### 5.14A.1 Database-Enforced Ledger Immutability (PostgreSQL Triggers)
- **Problem Statement**:
  - While Step 9.1 established `onDelete: Restrict` on foreign keys, foreign key constraints only protect parent rows from deletion.
  - Foreign keys do **not** prevent direct `UPDATE` or `DELETE` statements on `WalletLedgerEntry` rows.
- **Trigger-Level Immutability Enforcement**:
  - Created and applied migration `20261021184500_enforce_ledger_immutability_and_balance_checks`.
  - Added PL/pgSQL function `prevent_wallet_ledger_mutation()`:
    ```sql
    CREATE OR REPLACE FUNCTION prevent_wallet_ledger_mutation()
    RETURNS TRIGGER AS $$
    BEGIN
      IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION 'WalletLedgerEntry records are immutable: UPDATE operations are strictly prohibited. Use COMPENSATING_ADJUSTMENT entries instead.';
      ELSIF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'WalletLedgerEntry records are immutable: DELETE operations are strictly prohibited.';
      END IF;
      RETURN NULL;
    END;
    $$ LANGUAGE plpgsql;
    ```
  - Attached row-level trigger `wallet_ledger_immutability_trigger` (`BEFORE UPDATE OR DELETE ON "WalletLedgerEntry" FOR EACH ROW`).
  - Attached statement-level trigger `wallet_ledger_truncate_trigger` (`BEFORE TRUNCATE ON "WalletLedgerEntry" FOR EACH STATEMENT`).
  - **Compensating Entries Allowed**: Normal `INSERT` operations remain fully permitted. Legitimate accounting corrections are strictly recorded as new `COMPENSATING_ADJUSTMENT` entries referencing prior sequences.
- **Database Role & Privileged-Administrator Limitations**:
  - The triggers enforce immutability for all DML operations executed by the application database role.
  - *Limitation*: PostgreSQL triggers can be bypassed by users with `SUPERUSER` or table ownership privileges (`ALTER TABLE "WalletLedgerEntry" DISABLE TRIGGER ...` or `DROP TRIGGER ...`). In production deployments, application connections must use an unprivileged role without table DDL or trigger modification rights. Zero-trust tamper-proofing against root database administrators requires external append-only audit replication (e.g. AWS QLDB or WORM storage).

#### 5.14A.2 Database-Enforced Balance CHECK Constraints
- **CHECK Constraints Added**:
  1. `Wallet`:
     - `"wallet_available_balance_non_negative"`: `CHECK ("availableBalance" >= 0)`
     - `"wallet_reserved_balance_non_negative"`: `CHECK ("reservedBalance" >= 0)`
     - `"wallet_version_non_negative"`: `CHECK ("version" >= 0)`
  2. `WalletHold`:
     - `"wallet_hold_held_amount_positive"`: `CHECK ("heldAmount" > 0)`
     - `"wallet_hold_remaining_amount_non_negative"`: `CHECK ("remainingAmount" >= 0)`
     - `"wallet_hold_remaining_lte_held"`: `CHECK ("remainingAmount" <= "heldAmount")`
  3. `WalletLedgerEntry`:
     - `"wallet_ledger_amount_positive"`: `CHECK ("amount" > 0)`
     - `"wallet_ledger_snapshot_available_non_negative"`: `CHECK ("balanceAfterAvailable" >= 0)`
     - `"wallet_ledger_snapshot_reserved_non_negative"`: `CHECK ("balanceAfterReserved" >= 0)`
- **Locally Enforceable vs. Cross-Row Invariants**:
  - *Locally Enforceable*: Single-row invariants (non-negative balances, positive amounts, remaining $\le$ held) are verified atomically by PostgreSQL upon every insert and update.
  - *Cross-Row Invariants*: PostgreSQL CHECK constraints cannot evaluate aggregate sums across multiple rows (e.g. `Wallet.availableBalance == SUM(WalletLedgerEntry.availableDelta)` or `Wallet.reservedBalance == SUM(WalletHold.remainingAmount)`). These invariants require transactional service boundaries and reconciliation audits.

#### 5.14A.3 Transactional Boundary for Future Wallet Operations
- All future balance-mutating operations in Step 9.2 must execute within a strict, single PostgreSQL transaction (`prisma.$transaction`):
  1. Acquire pessimistic row lock (`SELECT ... FOR UPDATE`) or verify optimistic version lock (`version = version + 1`).
  2. Update `Wallet` balance projection (`availableBalance`, `reservedBalance`).
  3. Insert corresponding `WalletLedgerEntry` recording signed deltas and post-mutation balance snapshots.
  4. Update or insert relevant `WalletHold` or `FinancialOperation`.
  5. Commit all changes atomically.
- A failure at any step rolls back the transaction, guaranteeing zero partial writes or orphaned ledger entries.

#### 5.14A.4 Idempotency & Sequence Semantics
- **Uniqueness Semantics on Nullable Keys**:
  - In PostgreSQL standard btree indexing, `NULL` values are treated as distinct (`NULL != NULL`).
  - Therefore, `WalletLedgerEntry` and `WalletHold` allow multiple rows with `idempotencyKey = NULL` for internal or system-generated transactions.
  - When an `idempotencyKey` is non-null, `@@unique([walletId, idempotencyKey])` strictly rejects duplicate submissions for that wallet.
- **Payload Mismatch Invariant**:
  - Database uniqueness prevents duplicate inserts on retries.
  - The future wallet service must verify that a matching idempotency key shares identical parameters (amount, operation type, wallet ID). If payloads mismatch, the service must throw `IdempotencyPayloadMismatchError`.
- **Sequence Semantics**:
  - `WalletLedgerEntry.sequenceNumber` and `Order.sequenceNumber` are allocated monotonically via `nextval()`.
  - Monotonic sequence allocation order does not guarantee transaction commit order if concurrent transactions commit out of order.
  - Sequence gaps (from aborted transactions) are expected and acceptable.

#### 5.14A.5 Migration Details & Status
- **Migration**: `20261021184500_enforce_ledger_immutability_and_balance_checks`
- **Application**: Applied cleanly to Neon PostgreSQL (`neondb` on AWS us-east-2).
- **Status**: `6 migrations found in prisma/migrations. Database schema is up to date!`

#### 5.14A.6 Integration Test Results
- **Suite**: `backend/tests/wallet/wallet-ledger-schema.test.js`
  - **25 integration tests** executed against live Neon PostgreSQL (100% pass):
    - Immutability trigger rejects `UPDATE` with exact trigger error message.
    - Immutability trigger rejects `DELETE` with exact trigger error message.
    - Immutability trigger rejects `TRUNCATE` with exact trigger error message.
    - Normal `INSERT` on `WalletLedgerEntry` continues to succeed.
    - CHECK constraint rejects negative `availableBalance` on `Wallet`.
    - CHECK constraint rejects negative `reservedBalance` on `Wallet`.
    - CHECK constraint rejects negative `version` on `Wallet`.
    - CHECK constraint rejects `heldAmount <= 0` on `WalletHold`.
    - CHECK constraint rejects `remainingAmount < 0` on `WalletHold`.
    - CHECK constraint rejects `remainingAmount > heldAmount` on `WalletHold`.
    - CHECK constraint rejects `amount <= 0` on `WalletLedgerEntry`.
    - Multiple `NULL` idempotency keys permitted; duplicate non-null keys rejected.
- **Full Backend Suite**: **260 passing tests across 13 test suites** (0 failures).
### 5.14B Step 9.2 — Transactional Wallet Operations and Idempotency Architecture

#### 5.14B.1 Architectural Role: Per-Wallet Audit Ledger vs. Double-Entry
- **Per-Wallet Immutable Audit Ledger**:
  - In Step 9.2, `WalletLedgerEntry` functions strictly as a per-wallet immutable audit ledger.
  - Every row belongs to a single `walletId` and records `amount`, signed deltas (`availableDelta`, `reservedDelta`), and balance snapshots (`balanceAfterAvailable`, `balanceAfterReserved`).
  - Balanced cross-party settlement (e.g. buyer debit balanced against seller credit) is **not** implemented in Step 9.2.
- **Future Evolution to Double-Entry**:
  - The schema is designed to bridge to double-entry settlement in Step 9.3 via shared `operationId` on `FinancialOperation`.
  - When trade settlement is implemented, a single `FinancialOperation` will link the buyer's debit ledger entry, seller's credit ledger entry, and exchange fee ledger entry, enforcing zero-sum cross-party balance ($\sum \text{deltas} = 0$).

#### 5.14B.2 Concurrency Strategy: Pessimistic Row-Level Locking
- **Locking Mechanism**:
  - Every mutation begins by acquiring an exclusive row-level lock within a PostgreSQL transaction (`SELECT * FROM "Wallet" WHERE id = $1 FOR UPDATE`).
  - Concurrent operations targeting the same wallet queue deterministically inside PostgreSQL.
- **Advantages over Optimistic Retry Loops**:
  - Under high concurrency on a single wallet (e.g. rapid order reservations), optimistic compare-and-swap on `version` triggers repeated conflicts and CPU spin.
  - Pessimistic locking eliminates transaction retry storms, guarantees strict serialization, and ensures that when the second transaction unblocks, it reads the freshly committed balance and version.
- **Monotonic Version Sequence**:
  - `Wallet.version` is incremented on every balance mutation (`version = version + 1n`).
  - This provides sequential audit chronology for downstream audit logs and event sourcing.
- **Transaction Settings**:
  - Isolation level: `ReadCommitted`.
  - `maxWait: 20000ms`, `timeout: 30000ms` with transient connection contention retry handling to prevent Prisma transaction pool queue timeouts across WAN database roundtrips.

#### 5.14B.3 Transactional Boundaries & Operations Contract
All balance mutations run inside a single atomic database transaction (`prisma.$transaction`):
1. **`getOrCreateWallet({ userId, currency = 'INR' })`**:
   - Idempotently creates or returns the user's wallet.
   - Handles concurrent creation races by catching `P2002` and returning the winner's wallet.
2. **`getWalletBalance({ walletId, userId, includeHolds = false })`**:
   - Reads wallet balance projection.
   - If `includeHolds: true`, returns active and partially settled holds.
3. **`creditAvailable({ walletId, userId, amount, idempotencyKey, entryType, operationType, referenceType, referenceId, description, metadata })`**:
   - Enforces `amount > 0` in integer paise.
   - Locks wallet row.
   - Evaluates idempotency; if key exists with identical payload, returns replay.
   - Atomically updates:
     - `FinancialOperation` (`status = 'COMPLETED'`)
     - `WalletLedgerEntry` (`availableDelta = +amount`, `reservedDelta = 0`, snapshots)
     - `Wallet` (`availableBalance = availableBalance + amount`, `version = version + 1n`)
4. **`debitAvailable({ walletId, userId, amount, idempotencyKey, entryType, operationType, referenceType, referenceId, description, metadata })`**:
   - Validates `amount > 0`. Locks wallet row.
   - Evaluates sufficiency: if `availableBalance < amount`, throws `InsufficientFundsError`.
   - Atomically updates:
     - `FinancialOperation` (`status = 'COMPLETED'`)
     - `WalletLedgerEntry` (`availableDelta = -amount`, `reservedDelta = 0`, snapshots)
     - `Wallet` (`availableBalance = availableBalance - amount`, `version = version + 1n`)
5. **`reserveFunds({ walletId, userId, amount, idempotencyKey, reason, orderId, referenceType, referenceId, description, metadata })`**:
   - Validates `amount > 0`. Locks wallet row.
   - Evaluates sufficiency: if `availableBalance < amount`, throws `InsufficientFundsError`.
   - Conserves total balance: moves funds from available to reserved balance.
   - Atomically updates:
     - `FinancialOperation` (`operationType = 'ORDER_ESCROW' | 'WITHDRAWAL'`, `status = 'COMPLETED'`)
     - `WalletHold` (`heldAmount = amount`, `remainingAmount = amount`, `status = 'ACTIVE'`, `reason`)
     - `WalletLedgerEntry` (`availableDelta = -amount`, `reservedDelta = +amount`, `holdId = hold.id`)
     - `Wallet` (`availableBalance -= amount`, `reservedBalance += amount`, `version += 1n`)
6. **`releaseHold({ holdId, idempotencyKey, amount = null, referenceType, referenceId, description, metadata })`**:
   - Fetches hold and locks parent wallet (`SELECT * FROM "Wallet" WHERE id = hold.walletId FOR UPDATE`).
   - Verifies hold is active; rejects closed holds (`RELEASED` / `SETTLED`).
   - Determines release amount: full remaining amount if `amount` is omitted, or specified partial amount.
   - Invariant check: `releaseAmount <= remainingAmount`.
   - Calculates new remaining amount:
     - If `remainingAmount == 0`: hold status transitions to `RELEASED`.
     - If `remainingAmount > 0`: hold status transitions to `PARTIALLY_SETTLED`.
   - Moves funds: `availableBalance += releaseAmount`, `reservedBalance -= releaseAmount`.
   - Atomically updates:
     - `FinancialOperation` (`operationType = 'ORDER_RELEASE' | 'REFUND'`, `status = 'COMPLETED'`)
     - `WalletHold` (`remainingAmount`, `status`)
     - `WalletLedgerEntry` (`availableDelta = +releaseAmount`, `reservedDelta = -releaseAmount`)
     - `Wallet` (`availableBalance`, `reservedBalance`, `version += 1n`)

#### 5.14B.4 Idempotency Semantics & Conflict Detection
- **Idempotency Scope & Storage**:
  - `FinancialOperation.idempotencyKey` enforces database-level uniqueness across the system.
  - Normal business payload parameters (`walletId`, `amount`, `operationType`, `referenceType`, `referenceId`, `holdId`) are recorded in `metadata`.
- **Duplicate Request Handling**:
  - **Same Key + Same Payload**: Returns the original operation and wallet state with `isIdempotentReplay: true`. No duplicate ledger entries or balance mutations occur.
  - **Same Key + Different Payload**: Throws `IdempotencyConflictError` (HTTP 409 Conflict) detailing existing vs. requested payload differences.
- **Concurrent Race Handling**:
  - If two requests with the same idempotency key arrive concurrently, PostgreSQL row locking serializes them on the wallet row.
  - If they target different wallets, the PostgreSQL unique index on `FinancialOperation.idempotencyKey` triggers `P2002` on the second transaction, which detects the conflict and safely rejects it.
- **Non-Consuming Failures**:
  - Insufficient-funds rejections fail *before* creating the operation record or touching the ledger. The user may deposit funds and retry with the same key.

#### 5.14B.5 Invariant Auditing & Test Verification
- **Integration Test Suite**: `backend/tests/wallet/wallet-service.test.js`
- **27 Live PostgreSQL Integration Tests** (100% passing):
  - Wallet creation and idempotent retrieval.
  - Valid credits, debits, and compensating adjustments.
  - Insufficient funds rejection with zero state change.
  - Monetary input validation, safe integer boundaries, and float/negative/zero rejections.
  - Fund reservation and full/partial hold releases with status transitions.
  - Repeated idempotent requests returning original outcomes.
  - Conflict detection on payload mismatch (amount, wallet, operation type).
  - Concurrent duplicate requests producing exactly one ledger posting.
  - Concurrent spending under contention serializing cleanly without overdrafts.
  - Rollback atomicity: zero partial projection or ledger updates on error.
  - Exact audit reconciliation:
    $$\text{Wallet.availableBalance} = \sum \text{WalletLedgerEntry.availableDelta}$$
    $$\text{Wallet.reservedBalance} = \sum \text{WalletLedgerEntry.reservedDelta}$$
    $$\text{Wallet.reservedBalance} = \sum_{\text{active holds}} \text{WalletHold.remainingAmount}$$

### 5.14C Step 9.2A — Wallet Transaction, Hold-State, and Idempotency Audit

#### 5.14C.1 Hold Lifecycle Semantics: Separation of Release from Settlement
- **Semantic Defect in Prior Implementation**:
  - The previous design transitioned partially released holds to `HoldStatus.PARTIALLY_SETTLED`.
  - In financial systems, a **release** returns unconsumed reserved funds back to the user's available balance (e.g. order cancellation, expired reservation, unused escrow). A **settlement** permanently debits or transfers funds to an exchange counterparty upon trade execution.
  - Calling a partial release `PARTIALLY_SETTLED` conflated two orthogonal financial state machines, misleading auditing systems into reporting that funds had been paid out or trades had been executed.
- **Additive Schema Migration (`20261022120000_add_partially_released_hold_status`)**:
  - Added `PARTIALLY_RELEASED` to the PostgreSQL `HoldStatus` enum:
    ```sql
    ALTER TYPE "HoldStatus" ADD VALUE 'PARTIALLY_RELEASED';
    ```
  - Preserved all existing enum values (`ACTIVE`, `PARTIALLY_SETTLED`, `SETTLED`, `RELEASED`) and existing database records without table locks or data loss.
- **Strictly Separated State Machines**:
  - **Hold Release Lifecycle**:
    - `ACTIVE` $\xrightarrow{\text{partial release}}$ `PARTIALLY_RELEASED`
    - `PARTIALLY_RELEASED` $\xrightarrow{\text{partial release}}$ `PARTIALLY_RELEASED` (monotonic decrease in `remainingAmount`)
    - `PARTIALLY_RELEASED` or `ACTIVE` $\xrightarrow{\text{exact/final release}}$ `RELEASED`
  - **Settlement Lifecycle (reserved for future trade execution)**:
    - `ACTIVE` $\xrightarrow{\text{partial fill settlement}}$ `PARTIALLY_SETTLED`
    - `PARTIALLY_SETTLED` $\xrightarrow{\text{complete fill settlement}}$ `SETTLED`
  - **Terminal States**:
    - `RELEASED` and `SETTLED` are terminal. Any attempt to call `releaseHold()` on a hold in these states throws `WalletValidationError('Cannot release hold with closed status: ...')`.
- **Remaining Amount Invariant**:
  - `remainingAmount` decreases monotonically upon release. Releases where `releaseAmount > remainingAmount` are rejected with `WalletValidationError`.
  - `remainingAmount` never increases during release.
  - When `remainingAmount == 0`, status becomes `RELEASED`.

#### 5.14C.2 Idempotency Under Concurrency and Ambiguous Outcomes
- **Canonical Business Payload Verification**:
  - Idempotent deduplication compares the full normalized business payload: `walletId`, `amount`, `operationType`, `referenceType`, `referenceId`, and `holdId`.
  - Resolves `walletId` from `userId` prior to comparison so that caller requests passing either identifier match canonical stored metadata.
- **Exhaustive Concurrency & Retry Behavior**:
  1. **Concurrent Identical Requests (Same Key, Same Payload)**:
     - Serialized on PostgreSQL wallet row lock (`SELECT FOR UPDATE`). The first request executes and commits `FinancialOperation`. The second request unblocks, evaluates the stored operation, and returns the committed outcome with `isIdempotentReplay: true`. Zero duplicate ledger entries.
     - If both requests hit a uniqueness race (`P2002`), the catch block retrieves the committed record, validates the full payload, and returns the identical replay.
  2. **Concurrent Conflicting Requests (Same Key, Different Amount/Wallet/Operation)**:
     - The second request discovers payload differences and throws `IdempotencyConflictError` (HTTP 409 Conflict). It never overwrites the existing record or applies balance mutations.
  3. **Retry After Committed Outcome with Lost Response**:
     - Safely returns original committed result and snapshot balances with `isIdempotentReplay: true`.
  4. **Retry After Definitive Rollback**:
     - Because `FinancialOperation` is created inside the same atomic database transaction as the ledger entry and wallet projection, a rolled-back transaction writes nothing to disk. A retry with the same idempotency key executes freshly and cleanly without false conflict or replay errors.
  5. **Transient Failure / Ambiguous Commit Outcome**:
     - If PostgreSQL disconnects or times out ambiguously, Prisma transaction errors are never swallowed. The service throws a recoverable `DatabaseConnectionError`. It never blindly re-executes or treats arbitrary `P2002` errors as success without validating the payload against the committed database record.
- **Idempotency Key Matrix: Safe vs. Fresh Key Requirements**:
  | Outcome / Error Condition | Idempotency Key Reusability | Action Required |
  | :--- | :--- | :--- |
  | **Success (Committed)** | Same key safely replayable | Returns committed result (`isIdempotentReplay: true`) |
  | **Pre-validation Error** (invalid amount, negative, float, non-INR) | Safe to retry | User fixes input and retries |
  | **Insufficient Funds** (`InsufficientFundsError`) | Same key safely reusable | User adds funds and retries with same key |
  | **Payload Conflict** (`IdempotencyConflictError`) | Must use fresh key | Request parameters differed; requires fresh key |
  | **Transaction Rollback** (database constraint or transient fail) | Same key safely reusable | Re-attempt original transaction with same key |
  | **Database Connection Error** (`DatabaseConnectionError`) | Same key safely reusable | Retry once connectivity is restored |

#### 5.14C.3 FinancialOperation Lifecycle & Transactional Consistency
- **Status Semantics**:
  - `PENDING`: Reserved for asynchronous, multi-phase external workflows (e.g. payment gateway webhooks, external bank transfers, distributed two-phase commit).
  - `COMPLETED`: Mutation has successfully committed to the database alongside its ledger entry and wallet balance updates.
  - `FAILED`: Explicit terminal state for multi-phase operations that aborted permanently.
- **Single-Transaction Pattern**:
  - In `WalletService`, every internal credit, debit, reservation, and hold release executes within a single atomic PostgreSQL transaction (`prisma.$transaction`).
  - `FinancialOperation` is inserted with status `COMPLETED` alongside the append-only `WalletLedgerEntry` and the updated `Wallet` projection.
  - This design guarantees that a rollback can never leave an orphaned or false `COMPLETED` record, and eliminates inconsistent intermediate states.

#### 5.14C.4 Balance, Hold, and Ledger Invariants
- **Non-Negative Balances**: Guaranteed by both application pre-checks and PostgreSQL database constraints (`CHECK (available_balance >= 0)` and `CHECK (reserved_balance >= 0)`).
- **Monotonic Version Sequence**: Incremented by exactly $1$ on every mutation modifying balances (`version = version + 1n`).
- **Audit Ledger Conservation**:
  $$\text{Wallet.availableBalance} = \sum_{e \in \text{Ledger}} e\text{.availableDelta}$$
  $$\text{Wallet.reservedBalance} = \sum_{e \in \text{Ledger}} e\text{.reservedDelta}$$
- **Active Hold Reconciliation**:
  $$\text{Wallet.reservedBalance} = \sum_{h \in \text{ActiveHolds}} h\text{.remainingAmount}$$
  Where $\text{ActiveHolds} = \{ h \mid h\text{.status} \in [\text{'ACTIVE'}, \text{'PARTIALLY\_RELEASED'}, \text{'PARTIALLY\_SETTLED'}] \}$.
- **Currency Enforcement**:
  - `getOrCreateWallet` strictly enforces `currency === 'INR'`. All other currencies are rejected with `WalletValidationError`.
- **Tenant Ownership Enforcement**:
  - `getWalletBalance({ walletId, userId })` and `_lockWallet({ walletId, userId })` explicitly verify that the fetched wallet's `userId` matches the caller's `userId`. Mismatches throw `WalletValidationError('Unauthorized: wallet does not belong to user')`.

#### 5.14C.5 Money Precision & Serialization
- All monetary amounts are verified by `parseMonetaryAmount()` as positive integer paise ($1 \text{ INR} = 100 \text{ paise}$).
- Floats, fractional paise, `NaN`, `Infinity`, negative amounts, zero, and values exceeding JavaScript `Number.MAX_SAFE_INTEGER` ($9,007,199,254,740,991$ paise) are rejected with `WalletValidationError`.
- `serializeWallet()`, `serializeHold()`, and `serializeLedgerEntry()` serialize `BigInt` balances and sequence numbers to strings for API responses, preventing IEEE-754 precision loss.

### 5.15 Step 9.3 — Order Lifecycle, Buy-Fund Reservations, and Sell-Inventory Reservations

#### 5.15.1 Architectural Scope & Core Invariants
- **Separation of Matching & Reservation from Settlement**:
  - In Step 9.3, `OrderService` validates orders, secures pre-matching financial escrow holds for buyers, locks secondary ticket inventory for sellers, and integrates with `PersistentMatchingService` and `MarketExecutionQueue`.
  - **Matching is NOT settlement**: When an order crosses and matches opposing orders, `Execution` records are created and resting quantities are reduced, but:
    - Buyer wallet balance is **not** debited for trade settlement.
    - Seller wallet balance is **not** credited.
    - Ticket inventory is **not** transferred to the buyer.
    - Reserved funds and reserved inventory are held in escrow awaiting authoritative multi-party settlement in Step 9.4.
  - Zero public HTTP controllers or routes were added in this step.

#### 5.15.2 Secondary Ticket Inventory Architecture (`UserTicketInventory`)
- **Fungible Secondary Inventory Model (Proposal 1 Confirmed)**:
  - Tickets in PassFlow's secondary exchange are represented as fungible quantities within a ticket category rather than individual seat barcodes.
  - Added model `UserTicketInventory` (`backend/prisma/schema.prisma`):
    - `id`: UUID primary key.
    - `userId`: Foreign key to `User` (seller identity).
    - `ticketCategoryId`: Foreign key to `TicketCategory`.
    - `totalQuantity`: Non-negative integer of total tickets owned.
    - `availableQuantity`: Non-negative integer of unlisted tickets eligible to be sold.
    - `reservedQuantity`: Non-negative integer of tickets locked in active `ASK` orders.
    - `@@unique([userId, ticketCategoryId])`: Strictly one inventory account per user per category.
- **Database CHECK Constraints (Additive Migration `20261022130000_add_user_ticket_inventory`)**:
  - PostgreSQL database-level constraints enforce mathematical invariants:
    - `CHECK ("totalQuantity" >= 0)`
    - `CHECK ("availableQuantity" >= 0)`
    - `CHECK ("reservedQuantity" >= 0)`
    - `CHECK ("availableQuantity" + "reservedQuantity" <= "totalQuantity")`
- **Distinction from Primary `TicketInventory`**:
  - Primary `TicketInventory` belongs to the event Organizer (`categoryId @unique`) and tracks primary event ticket sales. Secondary sellers cannot list or reserve from `TicketInventory`.
  - Secondary sellers can only list tickets they own in `UserTicketInventory`.

#### 5.15.3 Pre-Matching Buy Reservation Engine (BID Orders)
- **Maximum Financial Exposure Invariant**:
  - For a buy limit order of size $Q$ at price $P$ paise, the maximum possible obligation is:
    $$\text{holdAmount} = P \times Q \text{ paise}$$
  - The service executes `WalletService.reserveFunds` **before** the order enters matching eligibility.
  - Atomically locks the buyer's wallet row (`SELECT FOR UPDATE`), verifies $\text{availableBalance} \ge \text{holdAmount}$, decrements $\text{availableBalance} -= \text{holdAmount}$, increments $\text{reservedBalance} += \text{holdAmount}$, and creates an active `WalletHold` record (`reason = 'ORDER_ESCROW'`).
  - Available balance never becomes negative. Insufficient funds requests are rejected immediately without creating an order.

#### 5.15.4 Pre-Matching Sell Inventory Reservation Engine (ASK Orders)
- **Authoritative Inventory Lock**:
  - For a sell limit order of size $Q$, the seller must own eligible unreserved tickets.
  - Inside a PostgreSQL transaction, the service locks the seller's inventory row:
    ```sql
    SELECT * FROM "UserTicketInventory"
    WHERE "userId" = $1 AND "ticketCategoryId" = $2
    FOR UPDATE
    ```
  - Verifies $\text{availableQuantity} \ge Q$.
  - Atomically updates:
    - $\text{availableQuantity} = \text{availableQuantity} - Q$
    - $\text{reservedQuantity} = \text{reservedQuantity} + Q$
  - If no inventory record exists or $\text{availableQuantity} < Q$, throws `InsufficientInventoryError` (HTTP 422). Zero orders or holds are created.

#### 5.15.5 Matching Engine Integration & Compensating Rollback
- **Coordination under `MarketExecutionQueue`**:
  - All matching submissions and cancellations for a market serialize through `MarketExecutionQueue.execute(marketKey, ...)`.
  - The order book is synchronized from PostgreSQL; market readiness gate (`READY`) is strictly enforced.
- **Compensating Atomicity**:
  - If `PersistentMatchingService.submitLimitOrder()` throws (e.g. market quarantined, self-trade stopped, transient database error):
    - For BUY: An immediate compensating transaction calls `WalletService.releaseHold()` to restore the buyer's available balance.
    - For SELL: An immediate compensating transaction decrements $\text{reservedQuantity}$ and increments $\text{availableQuantity}$.
    - Zero orphaned holds or locked inventory remain in the system.

#### 5.15.6 Cancellation Semantics & Reservation Conservation
- **Strict Matching / Cancellation Serialization**:
  - Cancellation executes through `MarketExecutionQueue.execute(marketKey, ...)`, making it physically impossible for matching and cancellation to race within the market.
- **Ownership & Status Verification**:
  - Enforces `order.userId === userId`.
  - Rejects cancellation of `FILLED` or `REJECTED` orders.
  - Transitions order status to `CANCELLED` and sets $\text{remainingQuantity} = 0$ in DB.
  - Mutates in-memory `OrderBook` via `book.cancelOrder(orderId)`.
- **Exact Reservation Conservation**:
  - When an order is cancelled, **only the unfilled, still-resting portion** is released:
    - For BUY: Releases $\text{unfilledPaise} = \text{price} \times \text{cancelledQuantity}$ paise back to $\text{availableBalance}$. Funds corresponding to filled trades ($\text{price} \times (\text{initialQuantity} - \text{cancelledQuantity})$) remain reserved in the hold awaiting Step 9.4 settlement.
    - For SELL: Restores $\text{cancelledQuantity}$ tickets back to $\text{availableQuantity}$. Inventory corresponding to filled trades remains in $\text{reservedQuantity}$ awaiting Step 9.4 settlement transfer.
- **Idempotent Replay**:
  - Repeated cancellation calls on an already cancelled order return the original outcome with `isDuplicate: true` and $\text{cancelledQuantity} = 0$, guaranteeing zero double refunds.

#### 5.15.7 Primary-Purchase Integration Status & Dependency
- **Current State**: Primary ticket purchase (`POST /events/:id/purchase`) is not yet implemented (assigned to Teammate 3 in `docs/Om.md`).
- **Clean Integration Point**:
  - `OrderService.creditUserTicketInventory({ userId, ticketCategoryId, quantity, tx })` is provided as the authoritative domain entrypoint.
  - When Teammate 3 completes primary ticket checkout, primary purchase will call this method within its completion transaction to credit real user ownership.



