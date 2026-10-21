# The Darkhold Exchange - Models

Event ticket marketplace: primary purchase + resale order book. Built from the class diagram and the 9-step process flow.

**Total models / classes:** 36

## Notes on the diagram

- **Persist in DB (24):** User, Organizer, BuyerSeller, Event, TicketCategory, TicketInventory, Ticket, TicketOwnership, TicketTransfer, Order, OrderBookEntry, Trade, Wallet, Transaction, Settlement, Escrow, Admin, AuditLog, Reconciliation, Notification, AntiScalpingRule, AntiBotRule, DutchAuction, SolvencyProof.
- **In-memory / derived (rebuild from DB on restart):** OrderBook, MatchingEngine, MatchingStrategy, MarketData, MarketDepth, TradeFeed, WebSocketService, Monitoring, PerformanceMetrics, TransactionHistory (a view over Transaction).
- In the Escrow box the diagram shows `helpouts()` / `rellback()`; these read as `holdAssets()` / `rollback()`.
- The diagram has Admin as its own class, but the User `role` field also lists ADMIN. Use **one** approach: either a User with role `ADMIN`, or a separate Admin table.

---

## 1. User & Authentication

### User
Base account for every person on the platform (organizer or buyer/seller).

**Fields:** `id`, `name`, `email` (unique), `passwordHash`, `phone`, `profile`, `walletId`, `role` (ORGANIZER | USER | ADMIN), `createdAt`, `updatedAt`

**Methods:**
- `register()` - Create account, hash password, auto-create a Wallet.
- `login()` / `logout()` - Verify credentials and issue JWT + refresh token / revoke token.
- `updateProfile()` - Edit name, phone, profile details.
- `changePassword()` - Verify old password, store new hash, invalidate old sessions.

### Organizer
Extra profile for users who create events (1 User : 0..1 Organizer).

**Fields:** `id`, `userId`, `organizationName`, `verificationStatus` (PENDING | VERIFIED | REJECTED), `createdAt`

**Methods:**
- `createEvent()` - Create a new event with its categories.
- `manageEvent()` - Edit, publish, cancel own events.
- `getOrganizerEvents()` - List all events owned by the organizer.

### BuyerSeller
Extra profile for trading users (1 User : 1 BuyerSeller).

**Fields:** `id`, `userId`, `kycStatus`, `isActive`

**Methods:**
- `buyTicket()` - Primary purchase or place a BUY order.
- `listForResale()` - Place a SELL order for an owned ticket.
- `manageOrders()` - View / cancel own orders.

---

## 2. Event Management

### Event
A festival / concert / show that sells tickets.

**Fields:** `id`, `name`, `description`, `dateTime`, `location`, `organizerId`, `status` (DRAFT | PUBLISHED | CANCELLED | COMPLETED), `originalPrice`, `createdAt`

**Methods:**
- `updateEvent()` - Edit event details (only owner organizer).
- `getAvailableTickets()` - Remaining tickets across categories.
- `getEventDetails()` - Full event info with categories.

### TicketCategory
Tier of an event (VIP, General, Early Bird). 1 Event : 1..* Category.

**Fields:** `id`, `eventId`, `name`, `originalPrice`, `totalQuantity`, `availableQuantity`, `status` (ACTIVE | SOLD_OUT | CLOSED)

**Methods:**
- `updatePrice()` - Change base price.
- `updateInventory()` - Adjust quantities.

### TicketInventory
Stock counter per category (composition of TicketCategory). Prevents overselling.

**Fields:** `id`, `categoryId`, `totalQuantity`, `availableQuantity`, `reservedQuantity`

**Methods:**
- `reserve()` - Lock N tickets atomically during checkout.
- `release()` - Free reserved tickets on failure / timeout.
- `getAvailability()` - Available = total - reserved - sold.

### OrderBook
One order book per event + category (resale market). Held in memory, backed by DB.

**Fields:** `id`, `eventId`, `categoryId`, `type`, `bids: List<Order>`, `asks: List<Order>`

**Methods:**
- `addOrder()` - Insert order into bids/asks in sorted position.
- `cancelOrder()` - Remove an open order.
- `getMarketDepth()` - Aggregated price levels for bids and asks.

---

## 3. Ticket & Inventory

### Ticket
A single physical/digital ticket unit.

**Fields:** `id`, `eventId`, `categoryId`, `ownerId`, `faceValue`, `currentPrice`, `status` (AVAILABLE | OWNED | LISTED | USED | TRANSFERRED), `createdAt`

**Methods:**
- `transfer()` - Move ownership to another user.
- `getOwner()` - Return current owner.
- `getDetails()` - Ticket + event + category info.

### TicketOwnership
Ownership history record (audit trail of who held the ticket).

**Fields:** `id`, `ticketId`, `ownerId`, `acquiredAt`, `source` (PRIMARY | RESALE | TRANSFER)

**Methods:**
- `getOwnerDetails()` - Current and past owners.
- `transferOwnership()` - Close current record, open a new one.

### TicketTransfer
Tracks an ownership transfer tied to a trade (idempotent).

**Fields:** `id`, `ticketId`, `fromUserId`, `toUserId`, `status` (PENDING | COMPLETED | FAILED), `createdAt`

**Methods:**
- `initiateTransfer()` - Create transfer, lock ticket.
- `completeTransfer()` - Finalize ownership change.
- `getStatus()` - Check progress.

---

## 4. Orders & Trading

### Order
A buy or sell order in the resale market.

**Fields:** `id`, `userId`, `eventId`, `categoryId`, `type` (LIMIT | MARKET), `side` (BUY | SELL), `quantity`, `price`, `status` (OPEN | PARTIAL | FILLED | CANCELLED | REJECTED), `createdAt`

**Methods:**
- `placeOrder()` - Validate and submit to matching engine.
- `cancelOrder()` - Cancel open or partial order, release funds/ticket lock.
- `updateStatus()` - Change status after matches.

### OrderBookEntry
Queue entry inside the order book (Order 1 : * entries).

**Fields:** `id`, `orderId`, `price`, `quantity` (remaining), `timestamp`

**Methods:**
- `match()` - Try matching this entry.
- `reduceQuantity()` - Lower remaining qty after a partial fill.

### Trade
Executed match between a buy and a sell order.

**Fields:** `id`, `buyOrderId`, `sellOrderId`, `eventId`, `categoryId`, `price`, `quantity`, `executedAt`

**Methods:**
- `settleTrade()` - Trigger settlement (wallet + ownership).
- `getDetails()` - Return trade info.

---

## 5. Matching Engine (in-memory service)

### MatchingEngine
Core service that pairs compatible buy and sell orders.

**Fields:** `id`, `eventId`, `categoryId`, `orderBook`, `type` (MatchingType), `status` (RUNNING | PAUSED)

**Methods:**
- `matchOrders()` - Loop: best bid >= best ask -> create Trade.
- `processOrder()` - Entry point for each new order; supports partial fills.
- `cancelOrder()` - Remove order from the book.
- `getMarketDepth()` - Snapshot of the book.

### MatchingStrategy (interface)
Strategy pattern: pluggable matching rule.

**Fields:** -

**Methods:**
- `match(buy, sell)` - Decide if two orders match and at what price.
- `getPriority()` - Ordering rule for the queue.

### PriceTimePriority
Implements MatchingStrategy: best price first, then earliest time (default strategy).

**Fields:** -

**Methods:** `match()` / `getPriority()`

### FIFOQueue
Implements MatchingStrategy: strictly first-in-first-out (alternative strategy).

**Fields:** -

**Methods:** `match()` / `getPriority()`

---

## 6. Wallet & Financial Settlement

### Wallet
Per-user balance ledger (1 User : 1 Wallet).

**Fields:** `id`, `userId`, `balance`, `reservedBalance`, `createdAt`

**Methods:**
- `addFunds()` / `deductFunds()` - Credit / debit balance.
- `holdFunds()` / `releaseFunds()` - Reserve money for open buy orders and release it.
- `getBalance()` - Available = balance - reserved.

### Transaction
Immutable ledger entry (1 Wallet : * Transactions).

**Fields:** `id`, `walletId`, `type` (DEPOSIT | WITHDRAW | HOLD | RELEASE | TRADE_DEBIT | TRADE_CREDIT | PURCHASE), `amount`, `status`, `createdAt`

**Methods:**
- `process()` - Apply ledger change.
- `getDetails()` - Fetch entry.

### Settlement
Finalizes money + ticket movement for a Trade (1 Trade : 1 Settlement).

**Fields:** `id`, `tradeId`, `buyerId`, `sellerId`, `amount`, `status` (PENDING | COMPLETED | FAILED | ROLLED_BACK)

**Methods:**
- `execute()` - Debit buyer, credit seller, transfer ticket - inside one DB transaction.
- `rollback()` - Reverse everything if any step fails.

### Escrow
Holds buyer funds and seller ticket until settlement completes.

**Fields:** `id`, `tradeId`, `buyerId`, `sellerId`, `amount`, `status` (HELD | RELEASED | REFUNDED)

**Methods:**
- `holdAssets()` / `releaseAssets()` - Lock and unlock funds + ticket.
- `rollback()` - Return assets to original owners.

---

## 7. Real-time Market & Analytics

### MarketData
Latest market snapshot per event + category.

**Fields:** `id`, `eventId`, `categoryId`, `bestBid`, `bestAsk`, `lastPrice`, `volume`, `updatedAt`

**Methods:**
- `getOrderBook()` - Current book.
- `getTrades()` - Recent trades.
- `getMarketDepth()` - Depth levels.

### MarketDepth
Aggregated price levels (price -> total qty).

**Fields:** `id`, `eventId`, `categoryId`, `bids: List<Level>`, `asks: List<Level>`, `timestamp`

**Methods:**
- `getDepth()` - Return levels.

### TradeFeed
Stream of recently executed trades.

**Fields:** `id`, `eventId`, `tradeId`, `price`, `quantity`, `timestamp`

**Methods:**
- `getRecentTrades()` - Last N trades.

### WebSocketService
Manages live client connections (Socket.IO).

**Fields:** `id`, `userId`, `connectionId`, `status`

**Methods:**
- `connect()` / `disconnect()` - Authenticated connection lifecycle.
- `broadcast()` - Push to a channel (event room).
- `sendMessage()` - Push to one user.

---

## 8. Admin & Monitoring

### Admin
Platform operator.

**Fields:** `id`, `name`, `email`, `role`

**Methods:**
- `manageUsers()` - Suspend / activate / verify users.
- `manageEvents()` - Approve / cancel events.
- `viewReports()` - Platform and finance reports.

### AuditLog
Append-only record of sensitive actions (Admin 1 : * logs).

**Fields:** `id`, `adminId`, `action`, `details`, `timestamp`

**Methods:**
- `logAction()` - Write an entry.

### Reconciliation
Compares ledger vs settlements to find mismatches.

**Fields:** `id`, `date`, `status`, `reportUrl`

**Methods:**
- `generateReport()` - Build daily reconciliation report.
- `getDiscrepancies()` - List mismatched records.

### Monitoring
System health and log tracking.

**Fields:** `id`, `type`, `details`, `status`, `createdAt`

**Methods:**
- `getLogs()` - Retrieve logs.
- `checkSystemHealth()` - DB, Redis, WebSocket, engine status.

---

## 9. Supporting Modules

### AntiScalpingRule
Caps resale price per category.

**Fields:** `id`, `eventId`, `categoryId`, `maxResalePrice`, `isActive`

**Methods:**
- `validatePrice()` - Reject orders priced above the cap.

### AntiBotRule
Rate limits / bot protection.

**Fields:** `id`, `userId`, `ruleType`, `limit`, `status`

**Methods:**
- `check()` - Throttle users exceeding the limit.

### Notification
User alerts (trade filled, order cancelled, etc.).

**Fields:** `id`, `userId`, `type`, `message`, `status`, `createdAt`

**Methods:**
- `send()` - Create + push notification via WebSocket.

### TransactionHistory
Read model of a user's financial history (a view over Transaction).

**Fields:** `id`, `userId`, `type`, `amount`, `status`, `createdAt`

**Methods:**
- `getHistory()` - Paginated history.

### DutchAuction
Price drops over time until someone buys.

**Fields:** `id`, `eventId`, `categoryId`, `startPrice`, `minPrice`, `currentPrice`, `startTime`, `endTime`, `status`

**Methods:**
- `getCurrentPrice()` - Compute price at current time.
- `purchase()` - Buy at current price.

### PerformanceMetrics
Engine / API performance figures.

**Fields:** `id`, `ordersPerSec`, `avgLatency`, `throughput`, `errorRate`, `createdAt`

**Methods:**
- `recordMetrics()` - Store sample.
- `getReport()` - Summary.

### SolvencyProof
Proves platform funds cover user balances.

**Fields:** `id`, `userId`, `liabilities`, `escrowBalance`, `backingAssets`, `verifiedAt`

**Methods:**
- `generateProof()` - Compute totals.
- `verify()` - Check liabilities <= assets.