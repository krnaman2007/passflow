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

## 3. Matching Engine Service Status (Steps 1–8.1: FIFO Queue, PriceLevel, OrderBookSide, OrderBook, PriceTimePriority, MatchingCoordinator, Market Isolation Audit, Corrected Persistence Architecture & Schema Foundation)

- **Step 1 Implementation:** `src/services/matching/fifo-queue.js` (Doubly linked FIFO queue)
- **Step 2 Implementation:** `src/services/matching/price-level.js` (Price level aggregation & time priority)
- **Step 3 Implementation:** `src/services/matching/order-book-side.js` (Side-level price-time priority & depth)
- **Step 4 Implementation:** `src/services/matching/order-book.js` (Complete two-sided market order book)
- **Step 5 Implementation:** `src/services/matching/price-time-priority.js` (Pure price-time matching strategy & execution plan calculation)
- **Step 6 Implementation:** `src/services/matching/matching-coordinator.js` (In-memory matching coordinator & order lifecycle management)
- **Step 7 Audit & Tests:** `docs/MARKET_ISOLATION_AND_CONCURRENCY.md` & `tests/matching/market-isolation.test.js` (Market isolation and single-writer concurrency audit)
- **Step 8A Review & Corrections:** `docs/routes.md` Section 5 (Corrected Persistence Architecture, Serialization Boundaries, Ambiguous Outcomes & Fenced Market Ownership)
- **Step 8.1 Implementation:** `prisma/schema.prisma` and `prisma/migrations/20261021161148_add_order_and_execution_models` (Persistent Order and Execution models, integer types, indexes, and applied migration)
- **Route Additions in Steps 1–8.1:** **None** (per architectural scope control, these are isolated in-memory matching engine data structures, domain coordinators, design audits, and database schema foundations without external REST dependencies).

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

