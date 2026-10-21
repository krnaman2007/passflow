# PassFlow Matching Engine — PriceTimePriority Strategy Specification

## 1. Overview & Purpose

`PriceTimePriority` (`backend/src/services/matching/price-time-priority.js`) implements the core matching policy for the PassFlow secondary ticket marketplace.

Given an active `OrderBook` and an incoming limit order, the strategy calculates a deterministic, pure **MatchingPlan** describing proposed trade executions without mutating the live order book, resting orders, or the incoming order.

---

## 2. Matching Rules

### Incoming BID
- Aggresses against the **ASK** side of the `OrderBook`.
- Evaluates resting asks in strict price-time priority: lowest price first, FIFO within each price level.
- Executes against resting orders as long as $\text{restingOrder.price} \le \text{incomingOrder.price}$.
- Stops matching when the lowest available ask exceeds the incoming bid limit price (`LIMIT_PRICE_REACHED`) or when all liquidity is consumed (`NO_MORE_LIQUIDITY`).

### Incoming ASK
- Aggresses against the **BID** side of the `OrderBook`.
- Evaluates resting bids in strict price-time priority: highest price first, FIFO within each price level.
- Executes against resting orders as long as $\text{restingOrder.price} \ge \text{incomingOrder.price}$.
- Stops matching when the highest available bid falls below the incoming ask limit price (`LIMIT_PRICE_REACHED`) or when all liquidity is consumed (`NO_MORE_LIQUIDITY`).

---

## 3. Execution Price & Quantity Allocation

### Price Policy (Price Improvement)
Executions occur at the **passive resting order's price**.
- If a buyer submits a BID at ₹10,000 and the best resting ask is ₹9,000, execution occurs at **₹9,000** (giving price improvement to the aggressive buyer).
- If a seller submits an ASK at ₹8,000 and the best resting bid is ₹9,500, execution occurs at **₹9,500** (giving price improvement to the aggressive seller).

### Quantity Allocation
For each candidate resting order:
$$\text{executionQuantity} = \min(\text{simulatedIncomingRemaining}, \text{restingOrder.remainingQuantity})$$
- If $\text{simulatedIncomingRemaining} = 0$, matching terminates with `stoppedReason = 'FILLED'`.
- Supports single-order partial fills, multi-level sweeps, and resting order partial fills.

---

## 4. Self-Trade Prevention (STP)

PassFlow enforces an explicit, fair Self-Trade Prevention policy:
- If an incoming order and an eligible resting order share the identical non-empty `userId`, matching **stops immediately** (`stoppedReason = 'SELF_TRADE_PREVENTION'`).
- **No Queue Skipping:** The strategy does **not** bypass the same-user resting order to match with later orders at the same or worse price levels. Skipping ahead would violate the fundamental time priority of the FIFO queue.
- Unfilled quantity from an STP-aborted incoming order does **not** rest (`wouldRest = false`), preventing crossed self-orders in the book.
- If either order lacks a `userId` (unauthenticated or guest context), self-trade checks are bypassed.

---

## 5. Result Schema: `MatchingPlan`

The calculation returns a detached, serializable execution plan:

```json
{
  "executions": [
    {
      "incomingOrderId": "bid-101",
      "restingOrderId": "ask-205",
      "price": 9500,
      "quantity": 2,
      "restingOrderRemainingAfterExecution": 3,
      "incomingUserId": "user-buyer",
      "restingUserId": "user-seller"
    }
  ],
  "matchedQuantity": 2,
  "remainingQuantity": 0,
  "fullyFilled": true,
  "wouldRest": false,
  "stoppedReason": "FILLED"
}
```

### Stopped Reasons
- `'FILLED'`: The incoming order was completely filled ($\text{remainingQuantity} = 0$).
- `'LIMIT_PRICE_REACHED'`: Next resting order's price is outside the incoming order's acceptable limit.
- `'NO_MORE_LIQUIDITY'`: Opposite side has no (or no more) resting orders.
- `'SELF_TRADE_PREVENTION'`: Matching encountered an eligible resting order owned by the same `userId`.

---

## 6. Pure Simulation & Separation of Concerns

### Proposed Executions vs. Committed Trades
The `PriceTimePriority` strategy produces **proposed executions**, not committed trades:
1. **Zero State Mutation:** The strategy does not call `orderBook.reduceOrderQuantity()` or `orderBook.cancelOrder()`.
2. **Idempotence & Safety:** Calling `calculate()` multiple times with identical arguments returns identical results without altering the book.
3. **Downstream Orchestration:** In Step 6, a `MatchingCoordinator` will take this `MatchingPlan`, apply it transactionally to the `OrderBook`, persist trade records in PostgreSQL via Prisma, update user balances, and notify clients via Socket.IO.

---

## 7. Time and Space Complexity

| Operation | Time Complexity | Space Complexity | Description |
| :--- | :--- | :--- | :--- |
| `calculate(book, order)` | $O(K)$ | $O(K)$ | $K$ = number of inspected candidate orders until fill, limit barrier, or STP stop. |
| Duplicate ID Check | $O(1)$ | $O(1)$ | `book.getOrder(order.id)` lookup. |
| Candidate Order Traversal | $O(K)$ | $O(N_{\text{opp}})$ | Traverses `book.getOrders(oppositeSide)` until matching terminates. |

*Worst-case time occurs when a large incoming order sweeps the entire opposing side ($K = N_{\text{opp}}$).*

---

## 8. Implementation Roadmap Status

- [x] **Step 1:** `FIFOQueue` (`src/services/matching/fifo-queue.js`)
- [x] **Step 2:** `PriceLevel` (`src/services/matching/price-level.js`)
- [x] **Step 3:** `OrderBookSide` (`src/services/matching/order-book-side.js`)
- [x] **Step 4:** `OrderBook` (`src/services/matching/order-book.js`)
- [x] **Step 5:** `PriceTimePriority` (`src/services/matching/price-time-priority.js`)
- [ ] **Step 6 (Planned):** `MatchingCoordinator` / `MatchingEngine` applying plans, handling market orders, resale price collars, trade persistence, and WebSocket dispatch.
