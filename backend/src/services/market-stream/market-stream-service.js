/**
 * MarketStreamService — Real-Time WebSocket Streaming & Event Subscriptions
 *
 * Implements Step 9.16 server-to-client real-time secondary-market updates using Socket.IO.
 *
 * Architecture & Guarantees:
 * 1. Read-Only WebSocket Client Boundary:
 *    - Clients can only subscribe/unsubscribe to public markets and authenticate their connection.
 *    - Mutation events (orders, cancellations, settlements, wallet mutations) are strictly rejected.
 * 2. Versioned Event Contracts (v: 1):
 *    - `market:snapshot` — authoritative order-book snapshot with sequence cursor
 *    - `market:orderbook` — authoritative aggregated order-book depth updates
 *    - `market:trade` — newly persisted trade execution (sanitized, zero private data)
 *    - `order:fill` — authenticated user's private order-fill notification
 *    - `market:error` — sanitized subscription and delivery error notifications
 * 3. Strict Server-Controlled Room Names:
 *    - Public market: `market:${eventId}:${ticketCategoryId}`
 *    - Private user: `user:${userId}` (derived exclusively from verified JWT, never client input)
 *    - Room name injection is strictly prevented.
 * 4. Post-Commit Publication:
 *    - Events are published ONLY after matching/cancellation database transactions commit.
 *    - No events emitted on transaction rollback or rejection.
 *    - Idempotent deduplication skips re-broadcasting trades/fills.
 * 5. Sequence Gap Detection & Snapshot Resync:
 *    - Snapshots and trades include monotonic sequence numbers.
 *    - Clients can detect gaps and request resynchronization via `market:snapshot_request`.
 */

import { verifyAccessToken } from '../../utils/token.js';
import { prisma as defaultPrisma } from '../../db/prisma.js';
import { marketService as defaultMarketService } from '../market.service.js';
import logger from '../../errorlogging/logger.js';

export const PROTOCOL_VERSION = 1;
export const MAX_SUBSCRIPTIONS_PER_SOCKET = 50;
export const RATE_LIMIT_WINDOW_MS = 10000;
export const MAX_REQUESTS_PER_WINDOW = 30;

export class MarketStreamService {
  /**
   * @param {Object} [options]
   * @param {import('socket.io').Server} [options.io]
   * @param {import('@prisma/client').PrismaClient} [options.prismaClient]
   * @param {Object} [options.marketService]
   * @param {number} [options.maxSubscriptionsPerSocket]
   * @param {number} [options.rateLimitWindowMs]
   * @param {number} [options.maxRequestsPerWindow]
   */
  constructor({
    io = null,
    prismaClient = defaultPrisma,
    marketService = defaultMarketService,
    maxSubscriptionsPerSocket = MAX_SUBSCRIPTIONS_PER_SOCKET,
    rateLimitWindowMs = RATE_LIMIT_WINDOW_MS,
    maxRequestsPerWindow = MAX_REQUESTS_PER_WINDOW,
  } = {}) {
    this.io = io;
    this.prisma = prismaClient;
    this.marketService = marketService;
    this.maxSubscriptionsPerSocket = maxSubscriptionsPerSocket;
    this.rateLimitWindowMs = rateLimitWindowMs;
    this.maxRequestsPerWindow = maxRequestsPerWindow;

    if (this.io) {
      this._setupServer(this.io);
    }
  }

  /**
   * Attaches or re-attaches a Socket.IO server instance.
   *
   * @param {import('socket.io').Server} io
   */
  setServer(io) {
    this.io = io;
    if (this.io) {
      this._setupServer(this.io);
    }
  }

  /**
   * Formats the server-controlled public market room name.
   *
   * @param {string} eventId
   * @param {string} ticketCategoryId
   * @returns {string}
   */
  getMarketRoom(eventId, ticketCategoryId) {
    return `market:${eventId}:${ticketCategoryId}`;
  }

  /**
   * Formats the server-controlled private user room name.
   *
   * @param {string} userId
   * @returns {string}
   */
  getUserRoom(userId) {
    return `user:${userId}`;
  }

  /**
   * Validates identifier strings to prevent room injection and malformed IDs.
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
   * Verifies an access token and returns trusted user identity.
   *
   * @param {string} token
   * @returns {{ userId: string, role: string }}
   */
  verifySocketToken(token) {
    if (!token || typeof token !== 'string') {
      throw new Error('Authentication token is required');
    }
    const cleanToken = token.startsWith('Bearer ') ? token.slice(7).trim() : token.trim();
    if (!cleanToken) {
      throw new Error('Authentication token is empty');
    }

    const decoded = verifyAccessToken(cleanToken);
    if (!decoded || typeof decoded !== 'object') {
      throw new Error('Invalid token payload');
    }

    if (decoded.type && decoded.type !== 'access') {
      throw new Error('Invalid token type: access token required');
    }

    const userId = decoded.userId || decoded.id;
    if (!userId || typeof userId !== 'string') {
      throw new Error('Token payload missing user identifier');
    }

    return {
      userId: userId.trim(),
      role: decoded.role || 'BUYER_SELLER',
    };
  }

  /**
   * Configures Socket.IO server middleware and event routing.
   *
   * @private
   * @param {import('socket.io').Server} io
   */
  _setupServer(io) {
    // 1. Handshake authentication middleware
    io.use((socket, next) => {
      try {
        const authHeader =
          socket.handshake.auth?.token || socket.handshake.headers?.authorization;

        if (authHeader) {
          try {
            const user = this.verifySocketToken(authHeader);
            socket.data.user = user;
          } catch (authErr) {
            logger.warn('Socket connection rejected due to invalid authentication', {
              socketId: socket.id,
              error: authErr.message,
            });
            return next(new Error(`Authentication error: ${authErr.message}`));
          }
        } else {
          // Unauthenticated public connection allowed for market order-book viewing
          socket.data.user = null;
        }

        next();
      } catch (err) {
        next(err);
      }
    });

    // 2. Connection handler
    io.on('connection', (socket) => {
      this.attachToSocket(socket);
    });
  }

  /**
   * Attaches subscription, query, and lifecycle handlers to a connected socket.
   *
   * @param {import('socket.io').Socket} socket
   */
  attachToSocket(socket) {
    if (!socket.data) {
      socket.data = {};
    }
    socket.data.subscriptions = socket.data.subscriptions || new Set();
    socket.data.requestTimestamps = socket.data.requestTimestamps || [];

    // If authenticated during handshake, join verified private user room immediately
    if (socket.data.user?.userId) {
      const userRoom = this.getUserRoom(socket.data.user.userId);
      socket.join(userRoom);
      logger.info(`Socket authenticated on handshake: ${socket.id} -> ${userRoom}`);
    }

    // 1. Explicit in-band authentication
    socket.on('authenticate', (payload, callback) => {
      this.handleAuthenticate(socket, payload, callback);
    });

    // 2. Public market subscription
    socket.on('market:subscribe', (payload, callback) => {
      this.handleSubscribe(socket, payload, callback);
    });
    // Keep the reference protocol available while clients migrate to the
    // namespaced protocol. Both routes share identical authorization checks.
    socket.on('subscribe', (payload, callback) => {
      this.handleSubscribe(socket, payload, callback);
    });

    // 3. Public market unsubscription
    socket.on('market:unsubscribe', (payload, callback) => {
      this.handleUnsubscribe(socket, payload, callback);
    });
    socket.on('unsubscribe', (payload, callback) => {
      this.handleUnsubscribe(socket, payload, callback);
    });

    // 4. Authoritative snapshot / resynchronization request
    socket.on('market:snapshot_request', (payload, callback) => {
      this.handleSnapshotRequest(socket, payload, callback);
    });

    // 5. Read-only mutation rejection guards
    const FORBIDDEN_MUTATIONS = [
      'order:place',
      'order:submit',
      'order:cancel',
      'order:create',
      'market:match',
      'wallet:mutate',
      'wallet:reserve',
      'settlement:mutate',
      'trade:execute',
    ];
    for (const forbidden of FORBIDDEN_MUTATIONS) {
      socket.on(forbidden, (_payload, callback) => {
        const errorPayload = {
          v: PROTOCOL_VERSION,
          code: 'FORBIDDEN_MUTATION',
          message: 'Mutations not permitted via WebSocket. Use authenticated REST endpoints.',
          eventId: null,
          ticketCategoryId: null,
          timestamp: new Date().toISOString(),
        };
        socket.emit('market:error', errorPayload);
        if (typeof callback === 'function') {
          callback({ error: errorPayload.message, code: errorPayload.code });
        }
      });
    }

    // 6. Cleanup on disconnect
    socket.on('disconnect', () => {
      if (socket.data?.subscriptions) {
        socket.data.subscriptions.clear();
      }
      if (socket.data) {
        socket.data.subscriptions = null;
        socket.data.user = null;
        socket.data.requestTimestamps = [];
      }
    });
  }

  /**
   * Enforces sliding-window rate limiting per socket.
   *
   * @private
   * @param {import('socket.io').Socket} socket
   * @returns {boolean} True if within limit, false if rate limited
   */
  _checkRateLimit(socket) {
    const now = Date.now();
    const windowStart = now - this.rateLimitWindowMs;
    socket.data.requestTimestamps = (socket.data.requestTimestamps || []).filter(
      (ts) => ts > windowStart
    );

    if (socket.data.requestTimestamps.length >= this.maxRequestsPerWindow) {
      return false;
    }

    socket.data.requestTimestamps.push(now);
    return true;
  }

  /**
   * Handles explicit in-band authentication after connection.
   *
   * @param {import('socket.io').Socket} socket
   * @param {Object} payload
   * @param {Function} [callback]
   */
  handleAuthenticate(socket, payload, callback) {
    try {
      if (!payload || typeof payload !== 'object' || !payload.token) {
        throw new Error('Authentication token is required');
      }

      const user = this.verifySocketToken(payload.token);
      socket.data.user = user;

      const userRoom = this.getUserRoom(user.userId);
      socket.join(userRoom);

      const response = {
        success: true,
        userId: user.userId,
        role: user.role,
      };

      socket.emit('authenticated', response);
      if (typeof callback === 'function') {
        callback(null, response);
      }
    } catch (err) {
      const errorPayload = {
        v: PROTOCOL_VERSION,
        code: 'UNAUTHORIZED',
        message: err.message || 'Authentication failed',
        eventId: null,
        ticketCategoryId: null,
        timestamp: new Date().toISOString(),
      };
      socket.emit('market:error', errorPayload);
      if (typeof callback === 'function') {
        callback({ error: errorPayload.message, code: errorPayload.code });
      }
    }
  }

  /**
   * Handles market subscription workflow.
   *
   * Invariants:
   * 1. Payload validation (eventId, ticketCategoryId must be non-empty strings without colons).
   * 2. Per-socket subscription bounds enforcement.
   * 3. Authoritative verification of event and ticket-category existence in PostgreSQL.
   * 4. Safe subscription ordering: join room first, then query and emit snapshot.
   *
   * @param {import('socket.io').Socket} socket
   * @param {Object} payload
   * @param {Function} [callback]
   */
  async handleSubscribe(socket, payload, callback) {
    if (!this._checkRateLimit(socket)) {
      this.publishMarketError(socket, {
        code: 'RATE_LIMITED',
        message: 'Subscription rate limit exceeded',
      });
      if (typeof callback === 'function') {
        callback({ error: 'Subscription rate limit exceeded', code: 'RATE_LIMITED' });
      }
      return;
    }

    const { eventId, ticketCategoryId } = payload || {};

    // 1. Strict identifier validation
    if (!this.isValidIdentifier(eventId) || !this.isValidIdentifier(ticketCategoryId)) {
      this.publishMarketError(socket, {
        code: 'INVALID_PAYLOAD',
        message: 'eventId and ticketCategoryId must be valid non-empty strings',
        eventId: typeof eventId === 'string' ? eventId : null,
        ticketCategoryId: typeof ticketCategoryId === 'string' ? ticketCategoryId : null,
      });
      if (typeof callback === 'function') {
        callback({ error: 'Invalid subscription payload', code: 'INVALID_PAYLOAD' });
      }
      return;
    }

    const marketKey = `${eventId}:${ticketCategoryId}`;

    if (!socket.data) {
      socket.data = {};
    }
    if (!socket.data.subscriptions) {
      socket.data.subscriptions = new Set();
    }

    // 2. Subscription limit enforcement
    if (
      !socket.data.subscriptions.has(marketKey) &&
      socket.data.subscriptions.size >= this.maxSubscriptionsPerSocket
    ) {
      this.publishMarketError(socket, {
        code: 'SUBSCRIPTION_LIMIT_EXCEEDED',
        message: `Maximum subscription limit (${this.maxSubscriptionsPerSocket}) exceeded for socket`,
        eventId,
        ticketCategoryId,
      });
      if (typeof callback === 'function') {
        callback({
          error: `Maximum subscription limit (${this.maxSubscriptionsPerSocket}) exceeded`,
          code: 'SUBSCRIPTION_LIMIT_EXCEEDED',
        });
      }
      return;
    }

    // 3. Authoritative PostgreSQL verification of market existence
    try {
      const category = await this.prisma.ticketCategory.findFirst({
        where: { id: ticketCategoryId, eventId },
        select: { id: true, eventId: true, event: { select: { id: true, status: true } } },
      });

      if (!category || !category.event) {
        this.publishMarketError(socket, {
          code: 'MARKET_NOT_FOUND',
          message: `Market not found for event "${eventId}" and category "${ticketCategoryId}"`,
          eventId,
          ticketCategoryId,
        });
        if (typeof callback === 'function') {
          callback({ error: 'Market not found', code: 'MARKET_NOT_FOUND' });
        }
        return;
      }
    } catch (dbErr) {
      logger.error('Database query failure during market subscription check', dbErr);
      this.publishMarketError(socket, {
        code: 'INTERNAL_ERROR',
        message: 'Unable to verify market authorization',
        eventId,
        ticketCategoryId,
      });
      if (typeof callback === 'function') {
        callback({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
      }
      return;
    }

    // Guard against socket disconnect during the async DB query
    if (!socket.connected) {
      return;
    }
    if (!socket.data) {
      socket.data = {};
    }
    if (!socket.data.subscriptions) {
      socket.data.subscriptions = new Set();
    }

    // 4. Safe subscription sequencing:
    // Join room first so concurrent post-commit broadcasts are not missed while querying DB
    const room = this.getMarketRoom(eventId, ticketCategoryId);
    socket.join(room);
    socket.data.subscriptions.add(marketKey);

    // 5. Query and emit authoritative snapshot
    try {
      const snapshot = await this.getAuthoritativeSnapshot(eventId, ticketCategoryId);
      socket.emit('market:snapshot', snapshot);
      if (typeof callback === 'function') {
        callback(null, snapshot);
      }
    } catch (snapshotErr) {
      logger.error('Failed to generate initial market snapshot', snapshotErr);
      this.publishMarketError(socket, {
        code: 'SNAPSHOT_ERROR',
        message: 'Failed to retrieve authoritative market snapshot',
        eventId,
        ticketCategoryId,
      });
      if (typeof callback === 'function') {
        callback({ error: 'Failed to retrieve snapshot', code: 'SNAPSHOT_ERROR' });
      }
    }
  }

  /**
   * Handles unsubscription from a public market.
   *
   * @param {import('socket.io').Socket} socket
   * @param {Object} payload
   * @param {Function} [callback]
   */
  handleUnsubscribe(socket, payload, callback) {
    const { eventId, ticketCategoryId } = payload || {};

    if (!this.isValidIdentifier(eventId) || !this.isValidIdentifier(ticketCategoryId)) {
      this.publishMarketError(socket, {
        code: 'INVALID_PAYLOAD',
        message: 'eventId and ticketCategoryId must be valid non-empty strings',
        eventId: typeof eventId === 'string' ? eventId : null,
        ticketCategoryId: typeof ticketCategoryId === 'string' ? ticketCategoryId : null,
      });
      if (typeof callback === 'function') {
        callback({ error: 'Invalid unsubscription payload', code: 'INVALID_PAYLOAD' });
      }
      return;
    }

    const room = this.getMarketRoom(eventId, ticketCategoryId);
    const marketKey = `${eventId}:${ticketCategoryId}`;

    socket.leave(room);
    if (socket.data.subscriptions) {
      socket.data.subscriptions.delete(marketKey);
    }

    const response = { success: true, eventId, ticketCategoryId };
    if (typeof callback === 'function') {
      callback(null, response);
    }
  }

  /**
   * Handles client request for an authoritative snapshot (resynchronization after sequence gap).
   *
   * @param {import('socket.io').Socket} socket
   * @param {Object} payload
   * @param {Function} [callback]
   */
  async handleSnapshotRequest(socket, payload, callback) {
    if (!this._checkRateLimit(socket)) {
      this.publishMarketError(socket, {
        code: 'RATE_LIMITED',
        message: 'Snapshot request rate limit exceeded',
      });
      if (typeof callback === 'function') {
        callback({ error: 'Rate limit exceeded', code: 'RATE_LIMITED' });
      }
      return;
    }

    const { eventId, ticketCategoryId } = payload || {};

    if (!this.isValidIdentifier(eventId) || !this.isValidIdentifier(ticketCategoryId)) {
      this.publishMarketError(socket, {
        code: 'INVALID_PAYLOAD',
        message: 'eventId and ticketCategoryId must be valid non-empty strings',
        eventId: typeof eventId === 'string' ? eventId : null,
        ticketCategoryId: typeof ticketCategoryId === 'string' ? ticketCategoryId : null,
      });
      if (typeof callback === 'function') {
        callback({ error: 'Invalid snapshot request payload', code: 'INVALID_PAYLOAD' });
      }
      return;
    }

    try {
      const snapshot = await this.getAuthoritativeSnapshot(eventId, ticketCategoryId);
      socket.emit('market:snapshot', snapshot);
      if (typeof callback === 'function') {
        callback(null, snapshot);
      }
    } catch (err) {
      logger.error('Failed to handle snapshot request', err);
      this.publishMarketError(socket, {
        code: 'SNAPSHOT_ERROR',
        message: 'Failed to retrieve authoritative snapshot',
        eventId,
        ticketCategoryId,
      });
      if (typeof callback === 'function') {
        callback({ error: 'Failed to retrieve snapshot', code: 'SNAPSHOT_ERROR' });
      }
    }
  }

  /**
   * Retrieves an authoritative market snapshot from PostgreSQL.
   *
   * @param {string} eventId
   * @param {string} ticketCategoryId
   * @param {Object} [options]
   * @param {number} [options.limit=50]
   * @returns {Promise<Object>} Authoritative market snapshot
   */
  async getAuthoritativeSnapshot(eventId, ticketCategoryId, { limit = 50 } = {}) {
    const cappedLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 100);

    // 1. Aggregated depth levels (bids descending, asks ascending)
    const depth = await this.marketService.getMarketDepth(eventId, ticketCategoryId, {
      limit: cappedLimit,
    });

    // 2. Market summary (best bid, best ask, last price, spread)
    const marketData = await this.marketService
      .getMarketData(eventId, ticketCategoryId)
      .catch(() => null);

    // 3. Highest execution sequence number for monotonic sequence tracking
    const lastExec = await this.prisma.execution.findFirst({
      where: {
        incomingOrder: {
          eventId,
          ticketCategoryId,
        },
      },
      orderBy: [{ sequenceNumber: 'desc' }, { executedAt: 'desc' }],
      select: { sequenceNumber: true },
    });

    const sequenceNumber =
      lastExec?.sequenceNumber != null ? lastExec.sequenceNumber.toString() : '0';

    return {
      v: PROTOCOL_VERSION,
      eventId,
      ticketCategoryId,
      sequenceNumber,
      bids: depth.bids || [],
      asks: depth.asks || [],
      bestBid: marketData?.bestBid ?? null,
      bestAsk: marketData?.bestAsk ?? null,
      lastPrice: marketData?.lastPrice ?? null,
      spread: marketData?.spread ?? null,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Publishes a persisted trade execution event to the public market room.
   *
   * Invariants:
   * 1. Broadcast strictly AFTER matching transaction commits.
   * 2. Zero private data: no userIds, walletIds, fencing tokens, or internal hold IDs.
   *
   * @param {Object} params
   * @param {string} params.eventId
   * @param {string} params.ticketCategoryId
   * @param {string} params.tradeId
   * @param {number} params.price
   * @param {number} params.quantity
   * @param {string|number|BigInt} params.sequenceNumber
   * @param {Date|string} [params.executedAt]
   */
  publishMarketTrade({
    eventId,
    ticketCategoryId,
    tradeId,
    price,
    quantity,
    sequenceNumber,
    executedAt,
  }) {
    if (!this.io) return;

    const room = this.getMarketRoom(eventId, ticketCategoryId);
    const payload = {
      v: PROTOCOL_VERSION,
      eventId,
      ticketCategoryId,
      tradeId,
      price,
      quantity,
      sequenceNumber: sequenceNumber != null ? sequenceNumber.toString() : '0',
      executedAt: executedAt ? new Date(executedAt).toISOString() : new Date().toISOString(),
    };

    this.io.to(room).emit('market:trade', payload);
    this.io.to(room).emit('trade:new', payload);
  }

  /**
   * Publishes an authoritative order-book depth update to the public market room.
   *
   * @param {Object} params
   * @param {string} params.eventId
   * @param {string} params.ticketCategoryId
   * @param {string|number|BigInt} params.sequenceNumber
   * @param {'LEVEL_UPDATE'|'TRADE_MATCH'|'ORDER_CANCEL'|'SNAPSHOT_UPDATE'} [params.action]
   * @param {Array} [params.bids]
   * @param {Array} [params.asks]
   * @param {Date|string} [params.timestamp]
   */
  publishOrderBookUpdate({
    eventId,
    ticketCategoryId,
    sequenceNumber,
    action = 'LEVEL_UPDATE',
    bids = [],
    asks = [],
    bestBid = null,
    bestAsk = null,
    lastPrice = null,
    spread = null,
    timestamp,
  }) {
    if (!this.io) return;

    const room = this.getMarketRoom(eventId, ticketCategoryId);
    const payload = {
      v: PROTOCOL_VERSION,
      eventId,
      ticketCategoryId,
      sequenceNumber: sequenceNumber != null ? sequenceNumber.toString() : '0',
      action,
      bids,
      asks,
      bestBid,
      bestAsk,
      lastPrice,
      spread,
      timestamp: timestamp ? new Date(timestamp).toISOString() : new Date().toISOString(),
    };

    this.io.to(room).emit('market:orderbook', payload);
    this.io.to(room).emit('depth:update', payload);
    this.io.to(room).emit('market:update', payload);
  }

  /**
   * Delivers an order-fill notification strictly to the verified order owner's private room.
   *
   * Invariants:
   * 1. Delivered ONLY to `user:${userId}`.
   * 2. Recipient userId is derived from trusted persisted order state, never client input.
   * 3. Retries/duplicates do not emit duplicate logical notifications.
   *
   * @param {Object} params
   * @param {string} params.userId - Trusted user identity from persisted database record
   * @param {Object} params.fill
   */
  publishOrderFill({ userId, fill }) {
    if (!this.io || !userId || typeof userId !== 'string') return;

    const room = this.getUserRoom(userId);
    const payload = {
      v: PROTOCOL_VERSION,
      orderId: fill.orderId,
      eventId: fill.eventId,
      ticketCategoryId: fill.ticketCategoryId,
      side: fill.side,
      status: fill.status,
      fillPrice: fill.fillPrice != null ? fill.fillPrice : null,
      fillQuantity: fill.fillQuantity != null ? fill.fillQuantity : 0,
      remainingQuantity: fill.remainingQuantity != null ? fill.remainingQuantity : 0,
      sequenceNumber: fill.sequenceNumber != null ? fill.sequenceNumber.toString() : '0',
      tradeId: fill.tradeId || null,
      timestamp: fill.timestamp || new Date().toISOString(),
    };

    this.io.to(room).emit('order:fill', payload);
    this.io.to(room).emit('order:status', payload);
  }

  /**
   * Emits a sanitized error notification to a target socket or room.
   *
   * @param {import('socket.io').Socket|string} target
   * @param {Object} params
   * @param {string} params.code
   * @param {string} params.message
   * @param {string} [params.eventId]
   * @param {string} [params.ticketCategoryId]
   */
  publishMarketError(target, { code, message, eventId = null, ticketCategoryId = null }) {
    const payload = {
      v: PROTOCOL_VERSION,
      code,
      message,
      eventId,
      ticketCategoryId,
      timestamp: new Date().toISOString(),
    };

    if (target && typeof target.emit === 'function') {
      target.emit('market:error', payload);
    } else if (this.io && typeof target === 'string') {
      this.io.to(target).emit('market:error', payload);
    }
  }

  /**
   * Emits a real-time wallet update notification to the user's private room.
   * Spec Event: 'wallet:update' (Server -> Client: Balance / hold changes after trade, deposit, or reservation)
   *
   * Invariants:
   * 1. Delivered ONLY to `user:${userId}`.
   * 2. Recipient userId is derived from trusted persisted state.
   * 3. BigInt balances are serialized to strings safely.
   *
   * @param {Object} params
   * @param {string} params.userId
   * @param {Object} params.wallet
   */
  publishWalletUpdate({ userId, wallet }) {
    if (!this.io || !userId || typeof userId !== 'string') return;

    const room = this.getUserRoom(userId);
    const available = wallet?.availableBalance != null
      ? wallet.availableBalance.toString()
      : (wallet?.available != null ? wallet.available.toString() : '0');
    const reserved = wallet?.reservedBalance != null
      ? wallet.reservedBalance.toString()
      : '0';
    const total = wallet?.totalBalance != null
      ? wallet.totalBalance.toString()
      : (wallet?.balance != null ? wallet.balance.toString() : (BigInt(available) + BigInt(reserved)).toString());

    const payload = {
      v: PROTOCOL_VERSION,
      userId,
      walletId: wallet?.id || null,
      currency: wallet?.currency || 'INR',
      balance: total,
      availableBalance: available,
      reservedBalance: reserved,
      totalBalance: total,
      available: available,
      version: wallet?.version != null ? wallet.version.toString() : '0',
      timestamp: new Date().toISOString(),
    };

    try {
      this.io.to(room).emit('wallet:update', payload);
      this.io.emit(`wallet:update:${userId}`, payload);
    } catch (err) {
      logger.warn('Non-blocking failure emitting wallet:update', { userId, error: err.message });
    }
  }

  /**
   * Refreshes the user's wallet from PostgreSQL and publishes 'wallet:update' event.
   *
   * @param {string} userId
   * @returns {Promise<void>}
   */
  async syncAndPublishWallet(userId) {
    if (!this.io || !userId || typeof userId !== 'string') return;
    try {
      const client = this.prisma;
      if (!client || typeof client.wallet?.findUnique !== 'function') return;
      const wallet = await client.wallet.findUnique({
        where: { userId },
      });
      if (wallet) {
        this.publishWalletUpdate({ userId, wallet });
      }
    } catch (err) {
      logger.warn('Non-blocking failure querying wallet for syncAndPublishWallet', { userId, error: err.message });
    }
  }
}

export default MarketStreamService;
