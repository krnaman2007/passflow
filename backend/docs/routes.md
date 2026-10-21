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



