# Market Isolation and Concurrency Design Audit

## 1. Executive Summary

This document formalizes the market isolation guarantees, event-loop execution characteristics, and concurrency design of the PassFlow / The Darkhold Exchange matching engine as of Step 7.

The matching engine currently operates as a pure, synchronous in-memory domain service composed of:
- [`FIFOQueue`](file:///Users/om_upadhyay/OM/workspace/Projects/passflow/backend/src/services/matching/fifo-queue.js)
- [`PriceLevel`](file:///Users/om_upadhyay/OM/workspace/Projects/passflow/backend/src/services/matching/price-level.js)
- [`OrderBookSide`](file:///Users/om_upadhyay/OM/workspace/Projects/passflow/backend/src/services/matching/order-book-side.js)
- [`OrderBook`](file:///Users/om_upadhyay/OM/workspace/Projects/passflow/backend/src/services/matching/order-book.js)
- [`PriceTimePriority`](file:///Users/om_upadhyay/OM/workspace/Projects/passflow/backend/src/services/matching/price-time-priority.js)
- [`MatchingCoordinator`](file:///Users/om_upadhyay/OM/workspace/Projects/passflow/backend/src/services/matching/matching-coordinator.js)

Before introducing database persistence (PostgreSQL/Prisma via Neon), asynchronous route handlers, or multi-instance clustering, this audit details what the current synchronous implementation guarantees, where future concurrency risks will emerge, and why a strict single-writer architecture is required for horizontal scale.

---

## 2. Market Identity Representation & Isolation (Current State)

### 2.1 Compound Market Identity
A market in PassFlow is uniquely identified by the 2-tuple:
$$\text{Market} = (\text{eventId}, \text{ticketCategoryId})$$

In [`OrderBook`](file:///Users/om_upadhyay/OM/workspace/Projects/passflow/backend/src/services/matching/order-book.js), these identifiers are validated at construction and sealed as immutable, non-configurable, non-writable properties:
```javascript
Object.defineProperty(this, 'eventId', {
  value: eventId,
  writable: false,
  enumerable: true,
  configurable: false,
});
Object.defineProperty(this, 'ticketCategoryId', {
  value: ticketCategoryId,
  writable: false,
  enumerable: true,
  configurable: false,
});
```

### 2.2 Instance-Level State Encapsulation
Every `OrderBook` instance is fully self-contained:
- Encapsulates its own `_bids` and `_asks` [`OrderBookSide`](file:///Users/om_upadhyay/OM/workspace/Projects/passflow/backend/src/services/matching/order-book-side.js) instances.
- Maintains its own internal `_orderSides` index (`Map<string, Side>`).
- Does **not** share state across instances; there are zero static or module-level shared registries, variables, or caches in the matching engine domain layer.

### 2.3 Cross-Market Isolation Invariants
As verified by the focused test suite [`backend/tests/matching/market-isolation.test.js`](file:///Users/om_upadhyay/OM/workspace/Projects/passflow/backend/tests/matching/market-isolation.test.js):
1. **Event Market Separation**: Resting orders for Event A (e.g. Coldplay) and incoming orders for Event B (e.g. Oasis) never match, even at identical prices and category identifiers.
2. **Category Market Separation**: Resting orders for VIP tickets and incoming orders for General Admission tickets within the same event never match or cross.
3. **Order ID Namespace Independence**: Separate `OrderBook` instances maintain independent order ID namespaces. Reusing an order ID (`ord-1`) across separate books does not produce collisions, state corruption, or cross-market leakage.
4. **Target Market Validation**: [`MatchingCoordinator._validateIncomingOrder`](file:///Users/om_upadhyay/OM/workspace/Projects/passflow/backend/src/services/matching/matching-coordinator.js#L156-L170) explicitly enforces market integrity:
   - If `order.eventId` is provided, it must strictly match `book.eventId`.
   - If `order.ticketCategoryId` is provided, it must strictly match `book.ticketCategoryId`.
   - Any mismatch immediately throws a `RangeError` before plan calculation or mutation.
5. **Mutation Isolation**: Cancellation (`book.cancelOrder`) and quantity reduction (`book.reduceOrderQuantity`) target only the internal data structures of the specific `OrderBook` invoked.

---

## 3. Concurrency Audit: Current Guarantees & Non-Guarantees

### 3.1 Node.js Event Loop Run-to-Completion Semantics
In Node.js, JavaScript executes on a single event-loop thread. Under V8 run-to-completion semantics, a synchronous function executes from start to finish without yielding control.

In the current implementation:
```javascript
coordinator.submitLimitOrder(book, incomingOrder);
```
contains **zero asynchronous yield points** (`await`, `Promise.then`, `process.nextTick`, timers, or I/O callbacks).

The execution lifecycle:
1. `_validateBook(book)` — $O(1)$ synchronous checks.
2. `_validateIncomingOrder(book, incomingOrder)` — $O(1)$ synchronous checks.
3. `strategy.calculate(book, incomingOrder)` — synchronous pure calculation loop.
4. `_validatePlan(book, incomingOrder, plan)` — synchronous integrity verification.
5. `book.reduceOrderQuantity(...)` loop — synchronous in-memory mutations.
6. `book.addOrder(...)` for resting remainder — synchronous in-memory insertion.
7. Return `SubmissionResult` — synchronous return.

### 3.2 What Is Currently Guaranteed (Single Process)
- **Zero In-Memory Interleaving**: Within a single Node.js process, two concurrent calls to `submitLimitOrder` cannot interleave in memory. If two HTTP requests arrive concurrently, Express dispatches them sequentially on the event loop; the first call runs to complete in-memory commitment before the second call begins.
- **Race-Free State Mutations**: The state of `book` cannot be observed in a partially matched or intermediate state by any other JavaScript code running on that event loop thread.
- **No In-Memory Locks Needed**: Adding a Mutex, Promise queue, or semaphore around `submitLimitOrder` in the current single-process synchronous codebase is completely redundant and would add latency and complexity without improving correctness.

### 3.3 What Is NOT Guaranteed
1. **Zero Crash Durability**: All order book state resides strictly in Node.js process heap memory. An unhandled exception, SIGKILL, power outage, or OOM crash immediately destroys all resting orders, depth, and queue positions.
2. **Multi-Process / Multi-Instance Concurrency**: Run-to-completion guarantees apply **only within a single V8 thread**. If two Node.js processes run concurrently (e.g. cluster mode, horizontal container scaling), their heaps are completely isolated:
   - Process 1 and Process 2 maintain independent `OrderBook` instances.
   - If Process 1 and Process 2 receive matching orders for the same market, both will attempt to match against their own stale copies of resting orders, causing **double-selling and conflicting trade executions**.
   - Process-local synchronization mechanisms cannot protect cross-process shared state.

---

## 4. Concurrency Risks When Database Persistence & Async Operations Are Introduced

When database persistence (Prisma/Neon) is introduced in subsequent phases, the matching engine will interface with asynchronous operations (`await`). This introduces critical concurrency hazards:

### 4.1 Hazard 1: The "Async Yield Gap" (Stale Plan Hazard)
If the coordinator is refactored to perform asynchronous database operations between calculation and application:
```javascript
// ANTI-PATTERN: Async Yield Gap
async function submitOrderFaulty(book, order) {
  const plan = strategy.calculate(book, order);
  
  // ASYNC YIELD POINT: Event loop yields control!
  await prisma.order.create({ data: order }); 
  
  // By the time execution resumes, another request has run submitOrderFaulty
  // and mutated the book! `plan` is now stale, resting orders are gone or modified.
  coordinator.applyPlan(book, plan); // DATA CORRUPTION / CRASH!
}
```

### 4.2 Hazard 2: Dual-State Divergence (RAM vs. Database Inconsistency)
If matching is applied in RAM first and then committed to the database:
```javascript
// ANTI-PATTERN: RAM/DB Divergence
async function submitOrderDivergence(book, order) {
  const result = coordinator.submitLimitOrder(book, order); // RAM mutated
  
  try {
    // If DB times out, loses connection, or encounters a constraint failure:
    await prisma.$transaction(async (tx) => {
      await tx.trade.createMany({ data: result.executions });
    });
  } catch (err) {
    // RAM state reflects trades that do NOT exist in the database!
    // In-memory book and persistent ledger are permanently diverged.
  }
}
```

---

## 5. Architectural Requirements: Single-Writer / Market-Ownership Strategy

To scale PassFlow horizontally while preserving microsecond-tier in-memory matching and transactional database integrity, the architecture must adopt a strict **Single-Writer / Market-Ownership** model.

```
                            [ API Gateway / Router ]
                                      |
                     Consistent Hash on (eventId, ticketCategoryId)
                                      |
            +-------------------------+-------------------------+
            |                                                   |
     [ Worker Node 1 ]                                   [ Worker Node 2 ]
  Single-Writer for Market A                          Single-Writer for Market B
  +-----------------------+                           +-----------------------+
  | In-Memory OrderBook A |                           | In-Memory OrderBook B |
  | Sync Matching Engine  |                           | Sync Matching Engine  |
  +-----------------------+                           +-----------------------+
            |                                                   |
   Write-Ahead Log (WAL)                               Write-Ahead Log (WAL)
            |                                                   |
            +-------------------------+-------------------------+
                                      |
                           [ Neon / PostgreSQL ]
                             Persistent Ledger
```

### 5.1 Core Architectural Principles
1. **Partitioned Market Ownership**:
   - Each market $(\text{eventId}, \text{ticketCategoryId})$ is assigned to **exactly one** authoritative active writer process at any time.
   - Routing is enforced at the API gateway or load-balancer level using consistent hashing or sticky worker assignment.
   - No two processes ever attempt to match or mutate the same `OrderBook` simultaneously.

2. **Deterministic Write-Ahead Logging (WAL)**:
   - Before applying an order to the in-memory book, the order event is appended to a durable log (e.g. database sequence or Kafka/Redis stream).
   - In the event of a worker crash, the replacement worker rehydrates the in-memory `OrderBook` deterministically by replaying the confirmed log events from the last snapshot.

3. **Asynchronous Ledger Persistence**:
   - The authoritative single-writer process matches orders synchronously in RAM, emits confirmed execution events, and batches trade persistence to PostgreSQL asynchronously without blocking the matching loop.

### 5.2 Why Distributed Locks (e.g. Redlock) Are Not Recommended
Casual addition of distributed locks (e.g. acquiring a Redis lock per order submission) is strongly discouraged:
- **Extreme Latency Penalty**: Increases order placement latency from microseconds ($< 10\ \mu\text{s}$ in RAM) to tens of milliseconds ($20\text{--}50\ \text{ms}$ network round-trips to Redis).
- **Split-Brain Risk**: Distributed locks do not solve state cache invalidation across processes; Process B's in-memory book remains stale even if it acquires a lock after Process A mutates its own book.
- **Deadlock and Timeout Hazards**: Network partitions or slow queries cause lock expiry, leading to dual-master split-brain matching.

---

## 6. Verified Current Behavior vs. Proposed Future Architecture

| Dimension | Current Implementation (Step 7) | Future Multi-Instance Architecture |
| :--- | :--- | :--- |
| **Market Identity** | Sealed `(eventId, ticketCategoryId)` per instance | Partitioned hash key routed to market owner |
| **Execution Paradigm** | Synchronous, non-blocking in-memory execution | Synchronous in-memory matching + async WAL / ledger sync |
| **Concurrency Scope** | Process-local event loop run-to-completion | Partitioned single-writer per market |
| **Durability** | Ephemeral process heap (lost on restart) | Durable Write-Ahead Log + PostgreSQL ledger |
| **State Synchronization** | None (independent heap per process) | Deterministic snapshot + log replay |
| **Cross-Market Contamination** | Strictly zero (verified by unit/integration tests) | Strictly zero (enforced by gateway routing + worker checks) |
| **Locking Primitives** | None (unnecessary in single-threaded event loop) | Partitioned single-writer worker assignment |

---

## 7. Conclusions & Next Steps

1. **Market Isolation**: The existing implementation provides 100% market isolation. Separate `OrderBook` instances maintain completely independent price levels, FIFO queues, side counters, spreads, depths, and order ID indexes.
2. **Concurrency Safety**: Within a single Node.js process, synchronous matching is inherently race-free. No mutexes or async queues should be introduced in the in-memory engine.
3. **Preparedness for Step 8**: When designing persistence and API routes in subsequent phases, matching must remain synchronous, and persistence must be designed with explicit transactional boundaries and write-ahead coordination.
