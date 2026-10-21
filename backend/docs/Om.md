# PassFlow — Matching Engine Implementation Plan

## 1. Objective

Build a reliable, testable and efficient matching engine for PassFlow, a secondary marketplace for event tickets and passes.

The matching engine will accept validated buy and sell orders, maintain an order book for each event and ticket category, execute compatible orders using price-time priority, support partial fills and cancellations, and expose market data to the API and real-time dashboard.

### Initial Scope

- Limit and market orders
- Separate order books for each event and ticket category
- Price-time priority matching
- FIFO execution at each price level
- Partial and complete order fills
- Order cancellation
- Trade and order-status tracking
- Order-book snapshots and market depth
- REST API integration
- Real-time updates through Socket.IO
- PostgreSQL persistence through Prisma
- Automated correctness, concurrency and performance tests

### Excluded Initially

- User authentication and authorization
- Production payment gateway integration
- Complete wallet and financial settlement
- Primary ticket purchasing
- Full ticket ownership and transfer workflows
- Dutch auctions, escrow and proof of solvency

These are excluded only from the initial matching-engine development. The design must allow them to integrate later without rewriting the matching algorithm.

---

## 2. Existing Project Structure

We will use the existing `passflow/` repository and extend its current organization instead of creating a separate backend project.

```text
passflow/
├── frontend/
│   └── src/
│       ├── components/
│       ├── services/
│       ├── store/
│       ├── App.jsx
│       └── ...
│
└── backend/
    ├── docs/
    │   └── MATCHING_ENGINE_IMPLEMENTATION_PLAN.md
    ├── prisma/
    │   └── schema.prisma
    ├── scripts/
    ├── tests/
    │   ├── health.test.js
    │   ├── matching/
    │   ├── integration/
    │   ├── concurrency/
    │   └── load/
    │       └── k6.js
    ├── src/
    │   ├── config/
    │   ├── controllers/
    │   ├── db/
    │   ├── errorlogging/
    │   ├── middleware/
    │   ├── models/
    │   ├── routes/
    │   ├── schemas/
    │   ├── services/
    │   ├── utils/
    │   └── app.js
    ├── server.js
    └── package.json
```

### Proposed Matching-Engine Files

The following files will be added as implementation progresses:

```text
backend/
├── src/
│   ├── models/
│   │   ├── order.model.js
│   │   ├── trade.model.js
│   │   └── order-book-entry.model.js
│   ├── schemas/
│   │   └── order.schema.js
│   ├── services/
│   │   ├── matching/
│   │   │   ├── matching-engine.service.js
│   │   │   ├── order-book.service.js
│   │   │   ├── order-book-side.js
│   │   │   ├── price-level.js
│   │   │   ├── fifo-queue.js
│   │   │   ├── matching-strategy.js
│   │   │   ├── price-time-priority.js
│   │   │   └── matching-coordinator.js
│   │   ├── order.service.js
│   │   └── market-data.service.js
│   ├── controllers/
│   │   ├── order.controller.js
│   │   └── order-book.controller.js
│   ├── routes/
│   │   ├── order.routes.js
│   │   └── order-book.routes.js
│   └── schemas/
│       └── order.schema.js
└── tests/
    ├── matching/
    │   ├── fifo-queue.test.js
    │   ├── price-level.test.js
    │   ├── order-book.test.js
    │   ├── price-time-priority.test.js
    │   └── matching-engine.test.js
    ├── integration/
    │   └── order-api.test.js
    └── concurrency/
        └── matching-concurrency.test.js
```

Files may be consolidated or renamed to match existing conventions. We will avoid duplicating `order.schema.js` if it already exists.

---

## 3. Implementation Phases

### Phase 0 — Inspect and Prepare the Existing Backend

**Objective:** Understand the existing project before modifying it.

Tasks:

1. Inspect `package.json`, `schema.prisma`, `server.js` and `app.js`.
2. Verify ES Module configuration and the installed Node.js version.
3. Check the existing Prisma connection and PostgreSQL environment.
4. Verify that Express, Socket.IO, Zod and the test framework are configured correctly.
5. Run existing health tests and record the baseline.
6. Review existing models and API documentation to avoid conflicting definitions.
7. Establish a consistent error-response format and logging conventions.

**Deliverable:** A working backend with a verified database connection and a documented baseline.

**Completion criteria:** Existing functionality and tests continue to work before matching-engine code is added.

### Phase 1 — Define Domain Models and Matching Rules

**Objective:** Establish the data contracts and rules that every component must follow.

Define the following concepts:

- `Order`: submitted order, side, type, price, quantity, remaining quantity and status.
- `Trade`: execution between a buy order and a sell order.
- `OrderBook`: active orders for one event and ticket category.
- `OrderBookEntry`: the matching engine's representation of an active order.
- `PriceLevel`: orders grouped at one price.
- `MatchingStrategy`: an interface or base contract for the matching policy.
- `PriceTimePriority`: the initial matching implementation.

Define the initial order states:

- `OPEN`
- `PARTIALLY_FILLED`
- `FILLED`
- `CANCELLED`
- `REJECTED`

Define the initial matching rules:

1. Highest-priced buy orders receive priority.
2. Lowest-priced sell orders receive priority.
3. At the same price, older eligible orders execute first.
4. Orders match only within the same event and ticket category.
5. A match requires the best bid to equal or exceed the best ask.
6. Partial fills update remaining quantities.
7. A filled order cannot be matched again.
8. Cancellation removes only the unfilled quantity.
9. A market order consumes available compatible liquidity and cancels its unfilled remainder.
10. Self-trading is rejected or prevented by the order workflow.
11. Invalid quantities and prices are rejected before matching.
12. Resale price ceilings apply to both limit and market orders.

**Important:** Use exact monetary representations. Do not perform financial calculations using ordinary JavaScript floating-point numbers. Prices may be represented as integer minor units or validated integer ticks, depending on the supported currency and market rules.

**Deliverable:** Matching-engine interfaces, state definitions and documented invariants.

**Completion criteria:** The team agrees on the contracts and expected outcomes for the main matching scenarios.

### Phase 2 — Implement the FIFO Queue and Price Level

**Objective:** Build the smallest reusable data structures needed by the order book.

Implement `FIFOQueue` to support:

- Append an order.
- Read the oldest order.
- Remove the oldest order.
- Remove a specific order for cancellation.
- Track queue size and emptiness.

Implement `PriceLevel` to represent a single price and the orders resting at that price.

A price level should:

- Hold orders in time-priority order.
- Track its aggregate remaining quantity.
- Add and remove orders.
- Update aggregate quantity after partial fills.
- Remove itself when no active orders remain.

**Testing:**

- FIFO insertion and removal.
- Removal from the middle of a queue.
- Empty-queue behavior.
- Correct aggregate quantity after additions, fills and cancellations.
- Preservation of time priority.

**Deliverable:** Independently tested queue and price-level classes.

**Completion criteria:** All queue and price-level tests pass.

### Phase 3 — Implement the Order Book

**Objective:** Maintain buy and sell orders efficiently for each market.

Implement `OrderBookSide` for each side of a market.

- Buy side: best price is the highest bid.
- Sell side: best price is the lowest ask.

Use an ordered price-level representation and a hash-based order index. Select the price index after comparing implementation complexity and expected workload; do not use repeated full-book scans as the final design.

Implement `OrderBook` with:

- Separate bid and ask sides.
- An order-ID lookup map.
- Add, find and cancel operations.
- Best bid and best ask.
- Spread calculation.
- Aggregated market depth.
- Order-book snapshots.
- Removal of empty price levels.

Each order book must be isolated by event ID and ticket-category ID.

**Testing:**

- Multiple prices on both sides.
- Correct best bid and ask.
- Correct price-level ordering.
- FIFO ordering at equal prices.
- Cancellation by order ID.
- Correct depth after updates.
- No cross-market order leakage.

**Deliverable:** An order book that can accept, index, retrieve and remove active orders.

**Completion criteria:** The book maintains all invariants under repeated insertions, fills and cancellations.

### Phase 4 — Implement the Matching Strategy

**Objective:** Implement the price-time priority algorithm independently of Express and PostgreSQL.

The strategy will:

1. Inspect the best available order on the opposite side.
2. Determine whether the incoming order is compatible with that price.
3. Calculate the executable quantity.
4. Generate a trade result.
5. Update remaining quantities.
6. Remove fully filled orders.
7. Continue while the incoming order has remaining quantity and compatible liquidity exists.
8. Rest the remaining quantity of an eligible limit order on the book.
9. Cancel any unfilled remainder of a market order.

Use the resting order's price as the initial execution-price policy.

**Testing:**

- No-crossing orders.
- Exact-price matches.
- Multiple price-level matches.
- Partial fills.
- Multiple fills against one incoming order.
- Price priority.
- Time priority.
- Market orders with sufficient and insufficient liquidity.
- Price-collar rejection.
- Self-trade prevention.
- Empty-book behavior.

**Deliverable:** A pure matching strategy that consumes orders and produces deterministic execution results.

**Completion criteria:** All matching tests pass without requiring a running API or database.

### Phase 5 — Build the Matching Engine Coordinator

**Objective:** Connect the order book and matching strategy into one consistent service.

Implement `MatchingEngine` with methods such as:

- `submitOrder(order)`
- `cancelOrder(orderId)`
- `getOrderBook(eventId, categoryId)`
- `getMarketDepth(eventId, categoryId)`
- `getBestBidAsk(eventId, categoryId)`

Implement `MatchingCoordinator` to serialize mutations to the same market.

Initially, use a single logical writer per market within the Node.js process. Asynchronous operations must not allow two requests to interleave conflicting order-book mutations.

If the backend later runs multiple processes or instances, process-local coordination is insufficient. We will then add a distributed ownership or routing mechanism, or move matching to a dedicated single-writer service per market partition.

**Deliverable:** A callable matching service independent of the HTTP layer.

**Completion criteria:** Sequential and concurrent submissions preserve matching invariants in the supported deployment configuration.

### Phase 6 — Design Database Persistence and Recovery

**Objective:** Persist orders and trades without treating in-memory state as the permanent source of truth.

Use Prisma and PostgreSQL for durable records.

Persist:

- Orders and their states.
- Submitted and remaining quantities.
- Trade executions.
- Market identifiers.
- Timestamps and relevant audit metadata.

Use database constraints and transactions where appropriate. Give each execution a stable unique identifier and make settlement operations idempotent.

**Critical failure case:** The process must not lose track of an execution if it crashes between matching and database persistence.

We will define a recoverable execution protocol before production integration. This may use durable execution intents, persisted matching commands or another explicitly designed commit protocol. The chosen approach must ensure that the same order quantity cannot be executed twice after recovery.

At startup:

1. Load the authoritative active orders and required execution state.
2. Reconstruct the in-memory order books.
3. Validate order quantities and statuses.
4. Reconcile persisted trades and interrupted executions.
5. Enable order processing only after recovery succeeds.

**Deliverable:** Persistent order/trade storage and a documented recovery procedure.

**Completion criteria:** Restart and failure-injection tests recover consistent order and trade state.

### Phase 7 — Integrate the REST API

**Objective:** Expose the matching functionality through the existing Express application.

Initial endpoints:

- `POST /api/v1/orders` — submit an order.
- `DELETE /api/v1/orders/:id` — cancel an order.
- `GET /api/v1/events/:eventId/orderbook?categoryId=...` — retrieve the order book.
- `GET /api/v1/orderbook/:id/depth` — retrieve market depth, if this route matches the existing API contract.
- `GET /api/v1/orders/:id/trades` — retrieve trades for an order.

Use Zod to validate request bodies and parameters. Controllers should remain thin and delegate business logic to services.

Authentication is excluded initially, but we will keep an explicit boundary for the future authenticated user ID. For local testing, use a clearly marked development-only user identifier; never treat client-supplied ownership as trustworthy in production.

**Deliverable:** Working REST endpoints connected to the matching service.

**Completion criteria:** Integration tests cover valid requests, invalid payloads, matching outcomes, cancellations and error responses.

### Phase 8 — Add Real-Time Market Updates

**Objective:** Synchronize the React dashboard with committed market state.

Use the existing Socket.IO setup to publish events such as:

- `orderbook:update`
- `trade:executed`
- `order:updated`
- `order:cancelled`

Clients should subscribe to the appropriate event and ticket category.

Publish updates only after the relevant state transition has been accepted by the execution workflow. Use snapshots or versioned synchronization so clients can recover after disconnects and avoid relying on every event being delivered exactly once.

**Deliverable:** Live order-book, trade-feed and order-status updates.

**Completion criteria:** A client can disconnect, reconnect and recover the current market state.

### Phase 9 — Concurrency, Correctness and Performance Testing

**Objective:** Verify correctness under load before optimizing the implementation.

Use the existing test setup and extend it with:

- Unit tests for every matching rule.
- Integration tests for order APIs and persistence.
- Concurrent order-placement and cancellation tests.
- Duplicate-request and retry tests.
- Crash/restart and recovery tests.
- Market-isolation tests.
- Load tests with k6.

Measure:

- Successful orders processed per second.
- Average and p95/p99 latency.
- Error and rejection rates.
- Duplicate executions.
- Remaining-quantity consistency.
- Recovery time and reconciliation failures.

Target **1,000+ simulated order submissions per second** as a benchmark objective, not an assumed capability. Report the test environment, order mix, concurrency level and results.

**Deliverable:** Automated test suites and a reproducible performance report.

**Completion criteria:** Matching invariants remain satisfied under the tested load, and performance limitations are documented.

---

## 4. Integration Boundaries

### Teammate 1 — Authentication

Authentication is not part of the initial implementation. The API must leave a clean integration point for authenticated user identity and authorization.

### Teammate 3 — Event, Ticket and Primary Purchase Management

The event/ticket module provides valid event and category identifiers, ticket eligibility, inventory state and ownership information.

The matching engine must not independently assume that a sell order has valid tickets. The integrated order workflow must validate and reserve eligible inventory before the order becomes executable.

### Matching Engine

The matching engine is responsible for:

- Order-book operations.
- Matching rules.
- Price-time priority.
- Partial fills.
- Cancellation of remaining quantities.
- Execution proposals.
- Market-depth calculation.

The matching engine does not independently debit wallets, transfer ticket ownership or declare financial settlement complete.

### Settlement Integration

The settlement workflow is responsible for durable trade recording, ledger updates, fund and inventory reservation changes, ticket ownership transfer and recovery of interrupted executions.

---

## 5. Engineering Invariants

The following invariants must remain true throughout implementation:

1. An order's remaining quantity must never be negative or exceed its original quantity.
2. A fully filled order cannot execute again.
3. Each execution must reference valid buy and sell orders from the same market.
4. The execution price must follow the defined price policy and satisfy applicable price limits.
5. Price-time priority must be preserved.
6. Cancelling an order must not reverse previously executed trades.
7. Each ticket category must have an independent order book.
8. Repeated requests must not create duplicate execution or settlement effects.
9. The persisted order and trade records must support deterministic recovery.
10. Real-time events must not be treated as proof that a financial transaction committed.
11. Authentication and ownership checks must be added before production use.
12. Performance optimizations must not weaken matching or settlement correctness.

---

## 6. Implementation Order Summary

| Step | Work | Main deliverable |
|---|---|---|
| 0 | Inspect current backend | Verified baseline |
| 1 | Define models and invariants | Matching contracts |
| 2 | Build FIFO queue and price levels | Tested data structures |
| 3 | Build order book | Efficient bid/ask books |
| 4 | Implement matching strategy | Correct matching algorithm |
| 5 | Build coordinator | Consistent order processing |
| 6 | Persistence and recovery | Durable execution workflow |
| 7 | REST API integration | Functional endpoints |
| 8 | Socket.IO integration | Live market data |
| 9 | Load and failure testing | Verified correctness and benchmark report |

## 7. Initial Development Rule

We will implement and test one layer at a time. First, we will inspect the existing backend and agree on the order/trade contracts. Next, we will build the FIFO queue, price level and order book as independently testable JavaScript modules. Only after those data structures are correct will we implement the matching algorithm and connect it to persistence and APIs.
