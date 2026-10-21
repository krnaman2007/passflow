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

## 3. Matching Engine Service Status (Steps 1, 2, 3, 4 & 5: FIFO Queue, PriceLevel, OrderBookSide, OrderBook & PriceTimePriority)

- **Step 1 Implementation:** `src/services/matching/fifo-queue.js` (Doubly linked FIFO queue)
- **Step 2 Implementation:** `src/services/matching/price-level.js` (Price level aggregation & time priority)
- **Step 3 Implementation:** `src/services/matching/order-book-side.js` (Side-level price-time priority & depth)
- **Step 4 Implementation:** `src/services/matching/order-book.js` (Complete two-sided market order book)
- **Step 5 Implementation:** `src/services/matching/price-time-priority.js` (Pure price-time matching strategy & execution plan calculation)
- **Route Additions in Steps 1, 2, 3, 4 & 5:** **None** (per architectural scope control, these are isolated in-memory matching engine data structures without external REST dependencies).

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
