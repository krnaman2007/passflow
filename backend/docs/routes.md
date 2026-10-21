# PassFlow API Routes Specification

This document tracks active API routes and planned route additions as the PassFlow backend and matching engine develop.

---

## 1. Active HTTP Routes

### System & Health

| Method | Endpoint | Description | Auth Required | Request Body | Response Format | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/health` | Backend server health check and uptime ping | No | None | `{"status": "ok", "message": "Backend server is running", "timestamp": "..."}` | Active |

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

## 3. Matching Engine Service Status (Steps 1–8: FIFO Queue, PriceLevel, OrderBookSide, OrderBook, PriceTimePriority, MatchingCoordinator, Market Isolation Audit & Persistence Boundary Design)

- **Step 1 Implementation:** `src/services/matching/fifo-queue.js` (Doubly linked FIFO queue)
- **Step 2 Implementation:** `src/services/matching/price-level.js` (Price level aggregation & time priority)
- **Step 3 Implementation:** `src/services/matching/order-book-side.js` (Side-level price-time priority & depth)
- **Step 4 Implementation:** `src/services/matching/order-book.js` (Complete two-sided market order book)
- **Step 5 Implementation:** `src/services/matching/price-time-priority.js` (Pure price-time matching strategy & execution plan calculation)
- **Step 6 Implementation:** `src/services/matching/matching-coordinator.js` (In-memory matching coordinator & order lifecycle management)
- **Step 7 Audit & Tests:** `docs/MARKET_ISOLATION_AND_CONCURRENCY.md` & `tests/matching/market-isolation.test.js` (Market isolation and single-writer concurrency audit)
- **Step 8 Design:** `docs/routes.md` Section 5 (Persistence & Transactional Boundary Architecture Design)
- **Route Additions in Steps 1–8:** **None** (per architectural scope control, these are isolated in-memory matching engine data structures, domain coordinators, and design audits without external REST dependencies).

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

## 5. Step 8 Architecture Design: Persistence & Transactional Boundaries

### 5.1 Existing Database Architecture Findings
- **Prisma Schema (`prisma/schema.prisma`)**: Currently defines `User`, `Organizer`, `Event`, `TicketCategory`, and `TicketInventory`.
- **Missing Models for Trading**: Neither `Order` nor `Execution` (Trade) models exist in `schema.prisma`. There are no enums for `OrderSide` (`BID`, `ASK`) or `OrderStatus`.
- **Existing Migrations (`prisma/migrations/`)**: Only a single baseline migration exists (`20261021112254`), which creates only the initial `User` table. The `Organizer`, `Event`, and `TicketCategory` models present in `schema.prisma` have not yet been migrated into SQL.
- **Client & Runtime Usage**: Prisma is initialized in `src/db/prisma.js` as a global singleton. Only `src/db/index.js` (health check) and `src/middleware/auth.js` (JWT user lookup) currently access the database. The matching engine is 100% in-memory and decoupled from Prisma.
- **Monetary Types**: Existing event prices use `Decimal(12, 2)`. Persistent order and trade tables must use integer minor units (cents / ticks) to prevent floating-point discrepancies.

### 5.2 Recommended Persistence Architecture & Order/Trade Lifecycle
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

### 5.3 Transaction Boundaries, Approaches & Failure Handling
- **Approach Evaluation**:
  - *Approach A (Database-Authoritative Matching)*: Serializes matching inside PostgreSQL transactions with row locks (`SELECT ... FOR UPDATE`). Guarantee: ACID atomicity. Trade-off: Severe latency penalty (20–100ms cloud DB round-trip per order) destroying high-throughput matching performance.
  - *Approach B (Durable Event Journal / CQRS)*: Append-only command log before in-memory dispatch with async ledger persistence. Guarantee: Strict crash safety and replayability. Trade-off: High operational complexity (event sourcing, dual-write management).
  - *Approach C (Recommended: Authoritative In-Memory Matching + Atomic DB Flush with Cache Eviction)*:
    1. Filter idempotency via `Order.findUnique({ where: { userId_idempotencyKey } })`.
    2. Execute match synchronously in memory via `MatchingCoordinator.submitLimitOrder(book, incomingOrder)` ($< 10\ \mu\text{s}$).
    3. Commit the resulting `SubmissionResult` atomically inside `prisma.$transaction([ ... ])`: insert `Order`, create `Execution` records, update resting orders' `remainingQuantity` and `status`.
    4. If DB transaction succeeds: Return HTTP response to client.
    5. If DB transaction fails: The in-memory book state has diverged. **Evict the market `OrderBook` from RAM and trigger a deterministic rehydration from the database.**
- **Failure Scenario Handling**:
  1. *Crash before DB transaction*: Zero records written; client retry with same idempotency key is processed cleanly.
  2. *DB transaction fails (e.g. constraint/timeout)*: Postgres rolls back completely. RAM cache is evicted and rehydrated from DB. Client receives error.
  3. *DB commits, but crash before HTTP return*: DB has committed truth. On restart, book rehydrates from DB. Client retry with idempotency key returns committed order without re-matching.
  4. *RAM mutated, DB fails*: Evict RAM book immediately and reload from DB ledger.
  5. *Client retry after timeout*: Idempotency filter detects existing record and returns saved result.
  6. *Cancellation races with limit order*: Processed sequentially on single-writer event loop. If match occurs first, cancellation finds order filled; if cancellation occurs first, match cannot pair against it.

### 5.4 Recovery and Concurrency Requirements (Single-Writer Model)
- **Authoritative Source of Truth**: The PostgreSQL database is the permanent source of truth; in-memory `OrderBook` instances are ephemeral matching caches.
- **Reconstruction on Restart / Eviction**:
  - Query: `SELECT * FROM "Order" WHERE "eventId" = :eventId AND "ticketCategoryId" = :catId AND "status" IN ('OPEN', 'PARTIALLY_FILLED') AND "remainingQuantity" > 0 ORDER BY "price" ASC, "createdAt" ASC`.
  - Rebuild `OrderBook` by sequentially calling `book.addOrder(side, { id, price, remainingQuantity, userId })`.
  - Historical `Execution` records are trade receipts and are **not** re-executed during restart.
- **Market Readiness Gate**: Market status is flagged `RECOVERING` during rebuild; incoming requests receive `503 Service Unavailable` until the book is fully populated and transitions to `READY`.
- **Single-Writer Enforcement**: Until multi-instance horizontal scaling is introduced, a single Node.js instance serves as the exclusive authoritative writer for all markets. For future multi-instance deployments, partition market ownership via consistent hashing at the API gateway so that only one worker process holds the in-memory book for a given `(eventId, ticketCategoryId)`.

### 5.5 Proposed Implementation Sequence
1. **Phase 8.1 — Prisma Schema & Migrations**: Add `Order`, `Execution`, `OrderSide`, and `OrderStatus` to `schema.prisma`. Generate clean migration.
2. **Phase 8.2 — Repository Layer (`order-repository.js`, `execution-repository.js`)**: Encapsulate Prisma queries, idempotency checks, and batch updates.
3. **Phase 8.3 — Persistent Matching Bridge (`persistent-matching-service.js`)**: Connect synchronous `MatchingCoordinator` with atomic Prisma transaction and failure cache eviction.
4. **Phase 8.4 — Order Book Recovery Service (`order-book-recovery-service.js`)**: Implement market startup rehydration and readiness state gating.
5. **Phase 8.5 — Failure Injection & Concurrency Tests**: Test idempotency deduplication, simulated DB disconnect recovery, and concurrent race resolution.
