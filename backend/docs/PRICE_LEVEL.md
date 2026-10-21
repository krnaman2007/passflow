# PassFlow Matching Engine — PriceLevel Specification

## 1. Overview & Role in Matching Engine

`PriceLevel` (`backend/src/services/matching/price-level.js`) represents all resting limit orders grouped at a single, discrete price tick (e.g., ticket price of $150.00 represented in minor units as `15000`).

In PassFlow's Price-Time Priority matching engine, an `OrderBookSide` (bids or asks) organizes liquidity across multiple price levels. Within each individual `PriceLevel`, time priority governs execution: older resting orders execute strictly before newer ones.

`PriceLevel` wraps the doubly linked `FIFOQueue` to enforce time priority and maintains an $O(1)$ aggregate remaining quantity tracking all resting liquidity at this price.

---

## 2. Order Data Contract

Every order submitted to `PriceLevel` must satisfy the following contract:

| Field | Type | Constraint | Description |
| :--- | :--- | :--- | :--- |
| `id` | `string` | Non-empty, trimmed | Unique order identifier within the price level |
| `price` | `number` | Positive safe integer (`Number.isSafeInteger(p) && p > 0`) | Price tick in minor units; must strictly equal the level's immutable price |
| `remainingQuantity` | `number` | Positive safe integer (`Number.isSafeInteger(q) && q > 0`) | Currently unfilled quantity; do not substitute with `quantity` |

**Validation Rules:**
- Non-object, `null`, or array orders throw `TypeError`.
- Missing or invalid types throw `TypeError`.
- Non-positive numbers, empty string IDs, or price mismatches throw `RangeError`.
- Duplicate order IDs within the same `PriceLevel` throw `Error`.
- Additions causing aggregate quantity to exceed `Number.MAX_SAFE_INTEGER` throw `RangeError`.

---

## 3. FIFO Semantics & Time Priority

- Orders are appended to the queue tail via `addOrder(order)`.
- Incoming executions inspect the oldest resting order via `peek()`.
- Crossing orders fill the oldest resting orders first via `removeOldest()` or `reduceOrderQuantity()`.
- Partial fills reduce an order's `remainingQuantity` in-place, preserving its original position in the queue.
- Completely filled orders (`remainingQuantity === 0`) are immediately unlinked from the queue and deleted from the ID index.

---

## 4. Aggregate Quantity Invariant

The `PriceLevel` maintains the strict invariant:

$$\text{totalQuantity} = \sum_{\text{order} \in \text{restingOrders}} \text{order.remainingQuantity}$$

- `totalQuantity()` returns this value in $O(1)$ time.
- State is modified safely: any operation that fails validation or overflows is aborted before mutating internal state.
- Guards prevent `totalQuantity` from dropping below 0.

---

## 5. Operations & Time Complexity

| Operation | Time Complexity | Space Complexity | Description |
| :--- | :--- | :--- | :--- |
| `constructor(price)` | $O(1)$ | $O(1)$ | Initializes immutable price, queue, and index. |
| `peek()` | $O(1)$ | $O(1)$ | Reads oldest order at queue head without removing. |
| `removeOldest()` | $O(1)$ | $O(1)$ | Dequeues oldest order, decreases aggregate quantity, removes from index. |
| `totalQuantity()` | $O(1)$ | $O(1)$ | Reads cached aggregate quantity integer. |
| `size()` | $O(1)$ | $O(1)$ | Reads active order count from queue. |
| `isEmpty()` | $O(1)$ | $O(1)$ | Checks if size is 0. |
| `addOrder(order)` | $O(1)$ avg | $O(1)$ auxiliary | Validates contract, verifies uniqueness via Map, enqueues to tail. |
| `cancelOrder(orderId)` | $O(1)$ lookup + $O(n)$ queue scan | $O(1)$ | $O(1)$ Map presence check; $O(n)$ doubly linked list unlinking by reference. |
| `reduceOrderQuantity(orderId, qty)` | $O(1)$ lookup + $O(1)$ partial fill / $O(n)$ full fill | $O(1)$ | $O(1)$ Map lookup. If partial fill: $O(1)$ in-place update. If full fill: $O(n)$ unlinking from queue. |
| `toArray()` | $O(n)$ | $O(n)$ | Returns a shallow array copy of orders in FIFO order. |
| `[Symbol.iterator]()` | $O(n)$ | $O(1)$ | Generator yielding orders in FIFO sequence. |

---

## 6. In-Memory Limitations & Caller Mutation Rules

1. **Object References:**
   - Orders are stored by reference so that quantity reductions during matching are visible on the caller's order instance.
   - **CRITICAL:** Callers must **never directly mutate** `remainingQuantity` on a resting order object outside of `reduceOrderQuantity()`. Direct mutation violates the aggregate quantity invariant.
2. **Cancellation Scan:**
   - While the ID map allows $O(1)$ lookup, unlinking a node from `FIFOQueue` requires an $O(n)$ queue traversal. If single price levels hold very large order depths ($>10,000$ orders), higher-level indexing or direct node-reference caching can be introduced in the OrderBook layer.
3. **In-Memory Volatility:**
   - State resides entirely in Node.js process memory. Durability, database synchronization, and event journaling will be integrated in subsequent phases.

---

## 7. Implementation Roadmap Status

- [x] **Step 1:** `FIFOQueue` (`src/services/matching/fifo-queue.js`)
- [x] **Step 2:** `PriceLevel` (`src/services/matching/price-level.js`)
- [ ] **Step 3 (Planned):** `OrderBookSide` & `OrderBook` (`src/services/matching/order-book.service.js`)
- [ ] **Step 4 (Planned):** `PriceTimePriority` Matching Strategy
- [ ] **Step 5 (Planned):** Matching Engine REST APIs, WebSocket feeds, and persistence
