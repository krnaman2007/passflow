# PassFlow Matching Engine — OrderBook Specification

## 1. Overview & Purpose

`OrderBook` (`backend/src/services/matching/order-book.js`) represents the complete two-sided market for a specific event and ticket category tier in PassFlow.

It encapsulates exactly two `OrderBookSide` instances:
- **`BID` Side:** Resting buy orders prioritized by highest price first (descending).
- **`ASK` Side:** Resting sell orders prioritized by lowest price first (ascending).

The `OrderBook` coordinates market identity, enforces cross-side order ID uniqueness, prevents aggregate overflow, and exposes unified market data (spread, depth snapshots, order inspection, and statistics).

> **Important Scope Note:** `OrderBook` maintains resting orders and market state. It does **not** execute matches or generate trades. Crossing orders (where `bestBid >= bestAsk`) are permitted to coexist in the book at this stage; matching execution will be orchestrated by the matching strategy in Step 5.

---

## 2. Market Identity & Encapsulation

Every `OrderBook` instance is bound to a single market configuration:
- `eventId`: Non-empty string uniquely identifying the event.
- `ticketCategoryId`: Non-empty string uniquely identifying the ticket category tier.

Both identifiers are immutable (`Object.defineProperty` with `writable: false, configurable: false`). Separate events or ticket categories must be instantiated as independent `OrderBook` instances.

The internal sides (`_bids`, `_asks`) and the cross-side index (`_orderSides`) are fully encapsulated; callers interact exclusively through public methods.

---

## 3. Structural Architecture

```text
OrderBook (eventId + ticketCategoryId)
  ├── _orderSides: Map<orderId, 'BID' | 'ASK'>  [O(1) side routing & cross-side uniqueness]
  ├── _bids: OrderBookSide('BID')
  │     ├── _orderLocations: Map<orderId, { price, order }>
  │     ├── _levels: Map<price, PriceLevel>
  │     └── _prices: number[] (sorted descending)
  │           └── PriceLevel -> FIFOQueue -> QueueNode -> Order
  └── _asks: OrderBookSide('ASK')
        ├── _orderLocations: Map<orderId, { price, order }>
        ├── _levels: Map<price, PriceLevel>
        └── _prices: number[] (sorted ascending)
              └── PriceLevel -> FIFOQueue -> QueueNode -> Order
```

---

## 4. Spread and Market Depth

### Spread Calculation
$$\text{spread} = \text{bestAsk} - \text{bestBid}$$
- Returns `null` if either the BID or ASK side is empty.
- $\text{spread} > 0$: Normal positive spread (e.g., best bid ₹100, best ask ₹110 -> spread ₹10).
- $\text{spread} = 0$: Locked book (best bid equals best ask).
- $\text{spread} < 0$: Crossed book (best bid exceeds best ask).
*Locked and crossed books are permitted at this stage and will trigger executions once the matching strategy is connected in Step 5.*

### Market Depth Snapshots
`getDepth()` returns detached snapshot arrays of resting liquidity:
```json
{
  "bids": [
    { "price": 11000, "orderCount": 2, "totalQuantity": 15 },
    { "price": 10000, "orderCount": 1, "totalQuantity": 5 }
  ],
  "asks": [
    { "price": 12000, "orderCount": 1, "totalQuantity": 8 },
    { "price": 13000, "orderCount": 3, "totalQuantity": 25 }
  ]
}
```
Depth snapshots contain plain JavaScript objects and do not expose internal maps or linked-list nodes.

---

## 5. Public API and Return Shapes

| Method | Parameters | Return Type | Description |
| :--- | :--- | :--- | :--- |
| `constructor(config)` | `{ eventId, ticketCategoryId }` | `OrderBook` | Initializes immutable market book with BID and ASK sides. |
| `addOrder(side, order)` | `'BID' \| 'ASK'`, `Order` | `number` | Adds order to side; returns updated total order count. |
| `cancelOrder(orderId)` | `string` | `{ order, side } \| null` | Cancels order from whichever side it rests on. |
| `reduceOrderQuantity(id, qty)`| `string`, `number` | `FillResult \| null` | Reduces order quantity; includes `side` in result. |
| `getBestBid()` | — | `number \| null` | Highest bid price. |
| `getBestAsk()` | — | `number \| null` | Lowest ask price. |
| `getBestBidLevel()` | — | `PriceLevel \| null` | Best bid PriceLevel reference. |
| `getBestAskLevel()` | — | `PriceLevel \| null` | Best ask PriceLevel reference. |
| `getSpread()` | — | `number \| null` | `bestAsk - bestBid` or `null`. |
| `getDepth()` | — | `MarketDepth` | Snapshot of bid (descending) and ask (ascending) depth. |
| `getOrder(orderId)` | `string` | `{ order, side } \| null` | Finds order and its side in $O(1)$. |
| `getOrders(side)` | `'BID' \| 'ASK'` | `Order[]` | Orders on side in price-time priority. |
| `getSideStats(side)` | `'BID' \| 'ASK'` | `SideStats` | Order count, total quantity, and level count for side. |
| `getStats()` | — | `MarketStats` | Comprehensive statistics for both sides and spread. |
| `size()` | — | `number` | Total resting orders across both sides ($O(1)$). |
| `totalQuantity()` | — | `number` | Aggregate remaining quantity across both sides ($O(1)$). |
| `isSideEmpty(side)` | `'BID' \| 'ASK'` | `boolean` | Checks if specific side has 0 orders. |
| `isEmpty()` | — | `boolean` | Checks if entire book has 0 orders. |

---

## 6. Time and Space Complexity

| Method | Time Complexity | Space Complexity | Description |
| :--- | :--- | :--- | :--- |
| `addOrder(side, order)` | $O(1)$ avg / $O(\log L + L)$ new level | $O(1)$ auxiliary | Cross-side duplicate check ($O(1)$) + delegation to side |
| `cancelOrder(orderId)` | $O(1) + O(n_p) + O(L)^*$ | $O(1)$ | $O(1)$ side routing + `OrderBookSide.cancelOrder()` |
| `reduceOrderQuantity(...)` | $O(1)$ partial / $O(n_p) + O(L)^*$ full | $O(1)$ | $O(1)$ side routing + `OrderBookSide.reduceOrderQuantity()` |
| `getOrder(orderId)` | $O(1)$ | $O(1)$ | $O(1)$ routing map + $O(1)$ side order index |
| `getBestBid()` / `getBestAsk()` | $O(1)$ | $O(1)$ | Direct read of `_prices[0]` on the respective side |
| `getSpread()` | $O(1)$ | $O(1)$ | Arithmetic difference between best prices |
| `size()` / `totalQuantity()` | $O(1)$ | $O(1)$ | Sum of cached side counters |
| `isEmpty()` / `isSideEmpty()` | $O(1)$ | $O(1)$ | Evaluates side emptiness |
| `getDepth()` | $O(L)$ | $O(L)$ | Combines bid and ask depth snapshots |
| `getOrders(side)` | $O(N_{\text{side}})$ | $O(N_{\text{side}})$ | Collects orders in price-time sequence for side |
| `getStats()` | $O(1)$ | $O(1)$ | Aggregates cached stats and best prices |

*Notation: $L$ = total active price levels across both sides; $N$ = total resting orders; $n_p$ = orders resting at that specific price level; $^*$array splice only if price level is completely drained.*

---

## 7. Required Invariants

1. **Order Count Invariant:** `size() === bids.size() + asks.size()`.
2. **Quantity Invariant:** `totalQuantity() === bids.totalQuantity() + asks.totalQuantity()`.
3. **Cross-Side Uniqueness:** An order ID cannot exist on both BID and ASK sides of the same `OrderBook`.
4. **Market Isolation:** Separate `OrderBook` instances (for different events or categories) are isolated and may use independent order IDs.
5. **Spread Consistency:** `getSpread() === bestAsk - bestBid` whenever both sides are non-empty; `null` otherwise.
6. **Depth Strictness:** BID depth prices are strictly descending; ASK depth prices are strictly ascending.
7. **No Empty Levels:** Empty price levels are evicted on the respective side as soon as their final order is cancelled or filled.
8. **Index Parity:** `_orderSides` maps only to actively resting orders and is cleaned immediately upon cancellation or full fill.

---

## 8. Implementation Roadmap Status

- [x] **Step 1:** `FIFOQueue` (`src/services/matching/fifo-queue.js`)
- [x] **Step 2:** `PriceLevel` (`src/services/matching/price-level.js`)
- [x] **Step 3:** `OrderBookSide` (`src/services/matching/order-book-side.js`)
- [x] **Step 4:** `OrderBook` (`src/services/matching/order-book.js`)
- [ ] **Step 5 (Planned):** `PriceTimePriority` Matching Engine Strategy & Trade Execution
- [ ] **Step 6 (Planned):** REST APIs, WebSocket feeds, and PostgreSQL persistence
