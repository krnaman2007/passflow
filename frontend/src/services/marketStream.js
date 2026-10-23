/**
 * MarketStreamService — Client-Side Secondary Market Streaming Manager
 *
 * Implements Step 9.17 frontend integration with the backend Step 9.16 Socket.IO service.
 *
 * Architecture & Guarantees:
 * 1. Strict Read-Only Boundary:
 *    - Never submits orders, cancellations, or wallet mutations over Socket.IO.
 * 2. Sequence Gap Detection & Self-Healing:
 *    - Sequence numbers are treated as strings on the wire and compared using BigInt.
 *    - Stale or duplicate sequence updates are safely discarded.
 *    - Sequence jumps trigger debounced `market:snapshot_request` resynchronization.
 * 3. Market Isolation:
 *    - Scoped by `eventId` and `ticketCategoryId`.
 *    - Unsubscribes and purges state when changing markets to prevent cross-market leakage.
 * 4. Deduplication:
 *    - Trades deduplicated by `tradeId`.
 *    - Order fills deduplicated by `${orderId}:${status}:${tradeId}`.
 * 5. Lifecycle & Reconnection:
 *    - Bounded exponential backoff with jitter.
 *    - Exposes statuses: CONNECTING, CONNECTED, RECONNECTING, DISCONNECTED.
 *    - Never logs or exposes authentication tokens.
 */

import { io } from 'socket.io-client';

export const CONNECTION_STATUS = {
  CONNECTING: 'CONNECTING',
  CONNECTED: 'CONNECTED',
  RECONNECTING: 'RECONNECTING',
  DISCONNECTED: 'DISCONNECTED',
};

export const ERROR_MESSAGES = {
  INVALID_PAYLOAD: 'Invalid market parameters provided.',
  MARKET_NOT_FOUND: 'The requested market does not exist or has ended.',
  UNAUTHORIZED: 'Session unauthorized or authentication expired.',
  SUBSCRIPTION_LIMIT_EXCEEDED: 'Maximum active market subscription limit reached.',
  RATE_LIMITED: 'Request limit exceeded. Please wait a moment.',
  FORBIDDEN_MUTATION: 'Mutations not permitted via WebSocket.',
  SNAPSHOT_ERROR: 'Unable to retrieve authoritative order book snapshot.',
  INTERNAL_ERROR: 'Server error retrieving market data.',
};

export class MarketStreamClient {
  /**
   * @param {Object} [options]
   * @param {string} [options.url] - Socket.IO backend URL
   * @param {Object} [options.socketOptions] - Custom socket.io-client options
   * @param {Function} [options.socketFactory] - Custom factory creating socket instance (for testing)
   */
  constructor({ url, socketOptions = {}, socketFactory = null } = {}) {
    this.url =
      url ||
      (typeof import.meta !== 'undefined' && import.meta.env?.VITE_BACKEND_URL) ||
      'http://localhost:5001';

    this.socketOptions = socketOptions;
    this.socketFactory = socketFactory;
    this.socket = null;
    this.authToken = null;
    this.status = CONNECTION_STATUS.DISCONNECTED;
    this.statusListeners = new Set();
    this.fillListeners = new Set();

    // Active market subscriptions: key -> { eventId, ticketCategoryId, callbacks, currentSequence, seenTrades, resyncTimer, resyncCount }
    this.subscriptions = new Map();

    // Seen fill notifications for deduplication: Set<string>
    this.seenFills = new Set();
  }

  /**
   * Initializes the Socket.IO instance if not already active.
   *
   * @returns {import('socket.io-client').Socket}
   */
  initSocket() {
    if (this.socket) {
      return this.socket;
    }

    this._setStatus(CONNECTION_STATUS.CONNECTING);

    const config = {
      autoConnect: true,
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
      randomizationFactor: 0.5,
      timeout: 10000,
      auth: (cb) => {
        cb(this.authToken ? { token: this.authToken } : {});
      },
      ...this.socketOptions,
    };

    this.socket = this.socketFactory
      ? this.socketFactory(this.url, config)
      : io(this.url, config);
    this._attachSocketListeners(this.socket);
    return this.socket;
  }

  /**
   * Binds connection lifecycle and global event dispatchers.
   *
   * @private
   * @param {import('socket.io-client').Socket} socket
   */
  _attachSocketListeners(socket) {
    socket.on('connect', () => {
      this._setStatus(CONNECTION_STATUS.CONNECTED);

      // Re-authenticate in-band if token was set while disconnected
      if (this.authToken) {
        socket.emit('authenticate', { token: this.authToken });
      }

      // Re-subscribe any existing registered markets after reconnecting
      for (const [key, sub] of this.subscriptions.entries()) {
        sub.currentSequence = null; // Reset sequence to re-anchor on snapshot
        socket.emit('market:subscribe', {
          eventId: sub.eventId,
          ticketCategoryId: sub.ticketCategoryId,
        });
      }
    });

    socket.on('disconnect', (reason) => {
      if (reason === 'io client disconnect') {
        this._setStatus(CONNECTION_STATUS.DISCONNECTED);
      } else {
        this._setStatus(CONNECTION_STATUS.RECONNECTING);
      }
    });

    socket.on('connect_error', () => {
      if (socket.active) {
        this._setStatus(CONNECTION_STATUS.RECONNECTING);
      } else {
        this._setStatus(CONNECTION_STATUS.DISCONNECTED);
      }
    });

    socket.on('reconnect_attempt', () => {
      this._setStatus(CONNECTION_STATUS.RECONNECTING);
    });

    socket.on('reconnect', () => {
      this._setStatus(CONNECTION_STATUS.CONNECTED);
    });

    socket.on('reconnect_failed', () => {
      this._setStatus(CONNECTION_STATUS.DISCONNECTED);
    });

    // 1. Authoritative Snapshot
    socket.on('market:snapshot', (snapshot) => {
      this._handleSnapshot(snapshot);
    });

    // 2. Order Book Depth Update
    socket.on('market:orderbook', (update) => {
      this._handleOrderBookUpdate(update);
    });

    // 3. Trade Execution Event
    socket.on('market:trade', (trade) => {
      this._handleTrade(trade);
    });

    // 4. Private Order-Fill Notification
    socket.on('order:fill', (fill) => {
      this._handleOrderFill(fill);
    });

    // 5. Market Error Notification
    socket.on('market:error', (error) => {
      this._handleMarketError(error);
    });
  }

  /**
   * Sets the connection status and notifies all registered listeners.
   *
   * @private
   * @param {string} nextStatus
   */
  _setStatus(nextStatus) {
    if (this.status !== nextStatus) {
      this.status = nextStatus;
      for (const listener of this.statusListeners) {
        try {
          listener(this.status);
        } catch {
          // Ignore listener errors
        }
      }
    }
  }

  /**
   * Registers a connection status change listener.
   *
   * @param {Function} callback
   * @returns {Function} Unsubscribe listener
   */
  onStatusChange(callback) {
    if (typeof callback === 'function') {
      this.statusListeners.add(callback);
      callback(this.status);
      return () => this.statusListeners.delete(callback);
    }
    return () => {};
  }

  /**
   * Sets or updates the verified session token for private event streams.
   * Never logs the token.
   *
   * @param {string|null} token
   */
  setAuthToken(token) {
    const clean = token && typeof token === 'string' ? token.trim() : null;
    this.authToken = clean;

    if (this.socket && this.socket.connected) {
      if (clean) {
        this.socket.emit('authenticate', { token: clean });
      } else {
        // Logged out: reconnect anonymously to purge private rooms on backend
        this.socket.disconnect();
        this.socket.connect();
      }
    }
  }

  /**
   * Clears authenticated session state and private room subscriptions.
   */
  clearAuthToken() {
    this.setAuthToken(null);
    this.seenFills.clear();
  }

  /**
   * Validates identifier strings to match backend constraints.
   *
   * @param {string} id
   * @returns {boolean}
   */
  isValidIdentifier(id) {
    return (
      typeof id === 'string' &&
      id.trim().length > 0 &&
      id.trim().length <= 128 &&
      !id.includes(':') &&
      /^[a-zA-Z0-9_-]+$/.test(id.trim())
    );
  }

  /**
   * Formats a subscription key.
   *
   * @param {string} eventId
   * @param {string} ticketCategoryId
   * @returns {string}
   */
  getMarketKey(eventId, ticketCategoryId) {
    return `${eventId}:${ticketCategoryId}`;
  }

  /**
   * Subscribes to real-time market updates for an event category.
   *
   * @param {Object} params
   * @param {string} params.eventId
   * @param {string} params.ticketCategoryId
   * @param {Function} [params.onSnapshot]
   * @param {Function} [params.onOrderBook]
   * @param {Function} [params.onTrade]
   * @param {Function} [params.onError]
   * @param {Function} [params.onResyncing]
   * @returns {Function} Unsubscribe function
   */
  subscribeMarket({
    eventId,
    ticketCategoryId,
    onSnapshot,
    onOrderBook,
    onTrade,
    onError,
    onResyncing,
  }) {
    if (!this.isValidIdentifier(eventId) || !this.isValidIdentifier(ticketCategoryId)) {
      const err = {
        code: 'INVALID_PAYLOAD',
        message: 'Invalid market identifiers provided.',
        eventId,
        ticketCategoryId,
      };
      if (typeof onError === 'function') {
        onError(err);
      }
      return () => {};
    }

    const marketKey = this.getMarketKey(eventId, ticketCategoryId);

    // Clean up previous subscription for this key if re-subscribing
    if (this.subscriptions.has(marketKey)) {
      const existing = this.subscriptions.get(marketKey);
      if (existing.resyncTimer) clearTimeout(existing.resyncTimer);
    }

    const sub = {
      eventId,
      ticketCategoryId,
      callbacks: { onSnapshot, onOrderBook, onTrade, onError, onResyncing },
      currentSequence: null,
      seenTrades: new Set(),
      resyncTimer: null,
      resyncCount: 0,
      lastResyncAt: 0,
    };
    this.subscriptions.set(marketKey, sub);

    const socket = this.initSocket();
    if (socket.connected) {
      socket.emit('market:subscribe', { eventId, ticketCategoryId });
    }

    // Return cleanup unsubscription
    return () => {
      this.unsubscribeMarket(eventId, ticketCategoryId);
    };
  }

  /**
   * Unsubscribes from a market room and frees all listeners and caches.
   *
   * @param {string} eventId
   * @param {string} ticketCategoryId
   */
  unsubscribeMarket(eventId, ticketCategoryId) {
    const marketKey = this.getMarketKey(eventId, ticketCategoryId);
    const sub = this.subscriptions.get(marketKey);
    if (!sub) return;

    if (sub.resyncTimer) {
      clearTimeout(sub.resyncTimer);
      sub.resyncTimer = null;
    }
    sub.seenTrades.clear();
    this.subscriptions.delete(marketKey);

    if (this.socket && this.socket.connected) {
      this.socket.emit('market:unsubscribe', { eventId, ticketCategoryId });
    }
  }

  /**
   * Requests an authoritative snapshot for gap recovery with debouncing and bounded retries.
   *
   * @param {string} eventId
   * @param {string} ticketCategoryId
   */
  requestSnapshotResync(eventId, ticketCategoryId) {
    const marketKey = this.getMarketKey(eventId, ticketCategoryId);
    const sub = this.subscriptions.get(marketKey);
    if (!sub) return;

    const now = Date.now();
    const COOLDOWN_MS = 1200;
    const MAX_RETRIES = 3;

    if (sub.resyncCount >= MAX_RETRIES) {
      if (typeof sub.callbacks.onError === 'function') {
        sub.callbacks.onError({
          code: 'SNAPSHOT_ERROR',
          message: 'Repeated sequence gaps detected. Unable to stabilize order book.',
          eventId,
          ticketCategoryId,
        });
      }
      return;
    }

    if (sub.resyncTimer) {
      return; // Already debounced request pending
    }

    const timeSinceLast = now - sub.lastResyncAt;
    const delay = timeSinceLast < COOLDOWN_MS ? COOLDOWN_MS - timeSinceLast : 0;

    sub.resyncTimer = setTimeout(() => {
      sub.resyncTimer = null;
      sub.lastResyncAt = Date.now();
      sub.resyncCount += 1;

      if (typeof sub.callbacks.onResyncing === 'function') {
        sub.callbacks.onResyncing(true);
      }

      if (this.socket && this.socket.connected) {
        this.socket.emit('market:snapshot_request', { eventId, ticketCategoryId });
      }
    }, delay);
  }

  /**
   * Handles incoming `market:snapshot` events.
   *
   * @private
   * @param {Object} snapshot
   */
  _handleSnapshot(snapshot) {
    if (!snapshot || !snapshot.eventId || !snapshot.ticketCategoryId) return;
    const marketKey = this.getMarketKey(snapshot.eventId, snapshot.ticketCategoryId);
    const sub = this.subscriptions.get(marketKey);
    if (!sub) return; // Discard snapshot for unsubscribed / old market

    // Re-anchor sequence state using BigInt
    try {
      sub.currentSequence = BigInt(snapshot.sequenceNumber || '0');
    } catch {
      sub.currentSequence = 0n;
    }

    // Reset resync state on successful snapshot
    sub.resyncCount = 0;
    if (sub.resyncTimer) {
      clearTimeout(sub.resyncTimer);
      sub.resyncTimer = null;
    }

    if (typeof sub.callbacks.onResyncing === 'function') {
      sub.callbacks.onResyncing(false);
    }

    if (typeof sub.callbacks.onSnapshot === 'function') {
      sub.callbacks.onSnapshot(snapshot);
    }
  }

  /**
   * Handles incoming `market:orderbook` depth updates.
   *
   * @private
   * @param {Object} update
   */
  _handleOrderBookUpdate(update) {
    if (!update || !update.eventId || !update.ticketCategoryId) return;
    const marketKey = this.getMarketKey(update.eventId, update.ticketCategoryId);
    const sub = this.subscriptions.get(marketKey);
    if (!sub) return; // Strict market isolation: discard updates from different markets

    const updateSeqStr = update.sequenceNumber != null ? String(update.sequenceNumber) : '0';

    // In Step 9.16 backend, ORDER_CANCEL carries sequenceNumber '0'.
    // Non-execution level updates do not advance execution sequence.
    if (updateSeqStr === '0') {
      if (typeof sub.callbacks.onOrderBook === 'function') {
        sub.callbacks.onOrderBook(update);
      }
      return;
    }

    let updateSeq;
    try {
      updateSeq = BigInt(updateSeqStr);
    } catch {
      return;
    }

    // If sequence is not initialized yet (waiting for snapshot), discard intermediate update
    if (sub.currentSequence === null) {
      return;
    }

    // 1. Stale or duplicate update
    if (updateSeq <= sub.currentSequence) {
      return;
    }

    // 2. Next expected sequential update
    if (updateSeq === sub.currentSequence + 1n) {
      sub.currentSequence = updateSeq;
      if (typeof sub.callbacks.onOrderBook === 'function') {
        sub.callbacks.onOrderBook(update);
      }
      return;
    }

    // 3. Sequence gap detected (updateSeq > currentSequence + 1n)
    this.requestSnapshotResync(sub.eventId, sub.ticketCategoryId);
  }

  /**
   * Handles incoming `market:trade` public execution broadcasts.
   *
   * @private
   * @param {Object} trade
   */
  _handleTrade(trade) {
    if (!trade || !trade.eventId || !trade.ticketCategoryId || !trade.tradeId) return;
    const marketKey = this.getMarketKey(trade.eventId, trade.ticketCategoryId);
    const sub = this.subscriptions.get(marketKey);
    if (!sub) return; // Discard trade for unsubscribed market

    // Deduplicate trade by stable tradeId
    if (sub.seenTrades.has(trade.tradeId)) {
      return;
    }

    const tradeSeqStr = trade.sequenceNumber != null ? String(trade.sequenceNumber) : '0';

    if (tradeSeqStr !== '0' && sub.currentSequence !== null) {
      let tradeSeq;
      try {
        tradeSeq = BigInt(tradeSeqStr);
      } catch {
        return;
      }

      if (tradeSeq <= sub.currentSequence) {
        // Stale trade event already represented in sequence
        return;
      }

      if (tradeSeq === sub.currentSequence + 1n) {
        sub.currentSequence = tradeSeq;
      } else if (tradeSeq > sub.currentSequence + 1n) {
        // Sequence gap detected on trade
        this.requestSnapshotResync(sub.eventId, sub.ticketCategoryId);
      }
    }

    sub.seenTrades.add(trade.tradeId);

    // Keep seenTrades bounded
    if (sub.seenTrades.size > 500) {
      const firstEntry = sub.seenTrades.values().next().value;
      sub.seenTrades.delete(firstEntry);
    }

    if (typeof sub.callbacks.onTrade === 'function') {
      sub.callbacks.onTrade(trade);
    }
  }

  /**
   * Registers a callback for authenticated user order-fill notifications.
   *
   * @param {Function} callback
   * @returns {Function} Unregister listener
   */
  onOrderFill(callback) {
    if (typeof callback === 'function') {
      this.fillListeners.add(callback);
      return () => this.fillListeners.delete(callback);
    }
    return () => {};
  }

  /**
   * Handles incoming authenticated `order:fill` notifications.
   *
   * @private
   * @param {Object} fill
   */
  _handleOrderFill(fill) {
    if (!fill || !fill.orderId) return;

    // Deduplicate fills using stable composite identifier
    const fillKey = `${fill.orderId}:${fill.status || ''}:${fill.tradeId || ''}`;
    if (this.seenFills.has(fillKey)) {
      return;
    }
    this.seenFills.add(fillKey);

    // Keep seenFills bounded
    if (this.seenFills.size > 200) {
      const first = this.seenFills.values().next().value;
      this.seenFills.delete(first);
    }

    for (const listener of this.fillListeners) {
      try {
        listener(fill);
      } catch {
        // Ignore listener exceptions
      }
    }
  }

  /**
   * Handles incoming `market:error` notifications.
   *
   * @private
   * @param {Object} error
   */
  _handleMarketError(error) {
    if (!error) return;

    const friendlyMessage =
      ERROR_MESSAGES[error.code] || error.message || 'An error occurred on the market stream.';

    const sanitizedError = {
      ...error,
      friendlyMessage,
    };

    if (error.eventId && error.ticketCategoryId) {
      const marketKey = this.getMarketKey(error.eventId, error.ticketCategoryId);
      const sub = this.subscriptions.get(marketKey);
      if (sub && typeof sub.callbacks.onError === 'function') {
        sub.callbacks.onError(sanitizedError);
        return;
      }
    }

    // Broadcast to all active subscriptions if not market-specific
    for (const sub of this.subscriptions.values()) {
      if (typeof sub.callbacks.onError === 'function') {
        sub.callbacks.onError(sanitizedError);
      }
    }
  }

  /**
   * Disconnects the socket and purges all active subscriptions and listeners.
   */
  disconnect() {
    for (const sub of this.subscriptions.values()) {
      if (sub.resyncTimer) clearTimeout(sub.resyncTimer);
      sub.seenTrades.clear();
    }
    this.subscriptions.clear();
    this.fillListeners.clear();
    this.statusListeners.clear();
    this.seenFills.clear();

    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    this._setStatus(CONNECTION_STATUS.DISCONNECTED);
  }
}

// Global default singleton instance
export const marketStream = new MarketStreamClient();
export default marketStream;
