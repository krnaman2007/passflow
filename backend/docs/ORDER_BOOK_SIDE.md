# PassFlow Matching Engine — OrderBookSide Specification

## 1. Overview & Purpose

`OrderBookSide` (`backend/src/services/matching/order-book-side.js`) represents exactly one half of an order book for a specific event tier:
- **`BID` Side:** Manages buy orders where buyers want the lowest price, but market priority awards the **highest bid** first (descending price ordering).
- **`ASK` Side:** Manages sell orders where sellers want the highest price, but market priority awards the **lowest ask** first (ascending price ordering).

`OrderBookSide` coordinates multiple `PriceLevel` instances to enforce **Price-Time Priority**:
1. **Price Priority:** Governed by `OrderBookSide`, placing the most competitive prices at the front of the book.
2. **Time Priority:** Governed by `PriceLevel` and `FIFOQueue`, executing resting orders at the same price in strict arrival order (FIFO).

---

## 2. Structural Hierarchy

```text
OrderBookSide (BID or ASK)
  ├── _orderLocations: Map<orderId, { price, order }> [O(1) order lookup]
  ├── _levels: Map<price, PriceLevel>                 [O(1) level lookup]
  ├── _prices: number[]                               [Priority-ordered price array]
  └── PriceLevel (Price Tick)
        └── FIFOQueue (Doubly Linked List)
              └── QueueNode -> Order
```

---

## 3. Price-Level Storage Strategy & Trade-Offs

`OrderBookSide` combines a hash map with a sorted price array maintained via binary search:

- **`_levels` (`Map<number, PriceLevel>`):** Allows $O(1)$ direct access to any `PriceLevel` by price tick.
- **`_prices` (`number[]`):** Maintained in priority order (BID: descending; ASK: ascending) using binary search insertion.
- **Why this design was selected:**
  - In secondary ticket markets, the number of distinct active price levels $L$ is bounded (typically tens to hundreds of tiers per ticket category).
  - Array binary search ($O(\log L)$) + splice ($O(L)$) on level creation/eviction provides optimal cache locality and zero third-party dependencies.
  - Crucially, adding, filling, or cancelling orders within an **already existing** price level does **not** mutate `_prices`, executing in $O(1)$ level lookup time.
  - Best price and best level are accessed in instantaneous $O(1)$ time at index 0.

---

## 4. Public API

### Constructor
- `new OrderBookSide(side)`: Accepts `'BID'` or `'ASK'`. Property `side` is frozen and immutable.

### Order Operations
- `addOrder(order)`: Validates order contract, rejects duplicate IDs across the entire side, routes order to `PriceLevel` (creating one if new), updates aggregate counters, and returns updated order count.
- `cancelOrder(orderId)`: Locates order in $O(1)$, cancels it in `PriceLevel`, decreases aggregate quantity and count, and removes the `PriceLevel` if it becomes empty. Returns the cancelled order or `null`.
- `reduceOrderQuantity(orderId, quantity)`: Delegates fill reduction to `PriceLevel`. Decreases side aggregate quantity. If fully filled, evicts the order from ID index and removes the price level if empty. Returns `{ order, fullyFilled: boolean, remainingQuantity: number }`.
- `removeBestOrder()`: Removes the oldest order resting at the best price level without executing a trade. Evicts the level if empty. Returns the removed order or `null`.

### Inspection & Market Depth
- `getBestPrice()`: Returns highest price for BID, lowest for ASK, or `null` if empty ($O(1)$).
- `getBestLevel()`: Returns `PriceLevel` at best price ($O(1)$).
- `getLevel(price)`: Returns `PriceLevel` for a specific price tick ($O(1)$).
- `totalQuantity()`: Returns aggregate remaining quantity across all levels ($O(1)$).
- `size()`: Returns total count of resting orders ($O(1)$).
- `levelCount()`: Returns number of active, non-empty price levels ($O(1)$).
- `isEmpty()`: Returns boolean indicating if side has 0 orders ($O(1)$).
- `getDepth()`: Returns a detached snapshot array of `{ price, orderCount, totalQuantity }` in priority order ($O(L)$).
- `getOrders()`: Returns an array of all resting orders in price-time priority ($O(N)$).
- `[Symbol.iterator]()`: Generator yielding resting orders in price-time priority ($O(N)$).

---

## 5. Time and Space Complexity

| Method | Time Complexity | Space Complexity | Notes |
| :--- | :--- | :--- | :--- |
| `constructor(side)` | $O(1)$ | $O(1)$ | Initializes maps and counters |
| `getBestPrice()` | $O(1)$ | $O(1)$ | Direct read of `_prices[0]` |
| `getBestLevel()` | $O(1)$ | $O(1)$ | `_levels.get(_prices[0])` |
| `getLevel(price)` | $O(1)$ | $O(1)$ | Direct Map lookup |
| `totalQuantity()` | $O(1)$ | $O(1)$ | Cached integer return |
| `size()` | $O(1)$ | $O(1)$ | Cached integer return |
| `levelCount()` | $O(1)$ | $O(1)$ | Reads `_prices.length` |
| `isEmpty()` | $O(1)$ | $O(1)$ | Evaluates `_orderCount === 0` |
| `addOrder(order)` (existing level) | $O(1)$ avg | $O(1)$ | Map lookups + `FIFOQueue` tail append |
| `addOrder(order)` (new level) | $O(\log L)$ search + $O(L)$ insert | $O(1)$ | Binary search insertion into `_prices` array |
| `cancelOrder(orderId)` | $O(1)$ map + $O(n_p)$ queue + $O(L)$ if empty | $O(1)$ | $O(1)$ ID lookup; $O(n_p)$ unlinking in `PriceLevel`; $O(L)$ array splice only if level emptied |
| `reduceOrderQuantity` (partial fill) | $O(1)$ | $O(1)$ | In-place reduction of order and aggregate counters |
| `reduceOrderQuantity` (full fill) | $O(1)$ map + $O(n_p)$ queue + $O(L)$ if empty | $O(1)$ | Unlinks order from level; splices `_prices` only if level emptied |
| `removeBestOrder()` | $O(1)$ order dequeue + $O(L)$ if empty | $O(1)$ | Dequeues head of best level; splices `_prices` only if level emptied |
| `getDepth()` | $O(L)$ | $O(L)$ | Traverses active price levels to build depth snapshot |
| `getOrders()` | $O(N)$ | $O(N)$ | Traverses all resting orders across all levels |
| `[Symbol.iterator]()` | $O(N)$ | $O(1)$ | Generator yielding orders sequentially |

*Notation: $L$ = number of price levels; $N$ = total resting orders on side; $n_p$ = orders resting at that specific price level.*

---

## 6. Required Invariants

1. **Aggregate Quantity Invariant:** `totalQuantity()` strictly equals $\sum \text{order.remainingQuantity}$ for all resting orders.
2. **Order Count Invariant:** `size()` strictly equals the total number of resting orders across all price levels.
3. **Level Count Invariant:** `levelCount()` strictly equals the number of non-empty price levels.
4. **Single Membership:** Every resting order exists in exactly one `PriceLevel`.
5. **No Orphan Levels:** Empty price levels are evicted immediately when their final order is cancelled or filled.
6. **Strict Monotonicity:** `getDepth()` prices are strictly descending for BID, strictly ascending for ASK.
7. **Time Priority Preservation:** Orders within each price level preserve arrival order (FIFO) under all additions and partial fills.
8. **Fault Isolation:** Operations that fail validation abort before mutating internal state or counters.

---

## 7. Implementation Roadmap Status

- [x] **Step 1:** `FIFOQueue` (`src/services/matching/fifo-queue.js`)
- [x] **Step 2:** `PriceLevel` (`src/services/matching/price-level.js`)
- [x] **Step 3:** `OrderBookSide` (`src/services/matching/order-book-side.js`)
- [ ] **Step 4 (Planned):** Full `OrderBook` combining BID and ASK sides with spread and market depth calculations
- [ ] **Step 5 (Planned):** `PriceTimePriority` Matching Engine Strategy and Trade Execution
- [ ] **Step 6 (Planned):** REST APIs, WebSocket feeds, and PostgreSQL persistence
