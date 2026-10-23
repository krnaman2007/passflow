import { orderService as defaultOrderService } from '../services/order/index.js';
import { AppError } from '../middleware/errorHandler.js';
import { successResponse } from '../utils/response.js';

/**
 * Formats order placement outcome safely for HTTP clients:
 * - Omits internal database IDs such as holdId
 * - Safely converts BigInt values (e.g. sequenceNumber) to strings to prevent JSON serialization errors
 */
export const formatSafeOrder = (result) => {
  if (!result) return null;
  const initialQty = result.initialQuantity ?? result.originalQuantity;
  return {
    orderId: result.orderId,
    status: result.status,
    initialQuantity: initialQty,
    originalQuantity: initialQty,
    remainingQuantity: result.remainingQuantity,
    stoppedReason: result.stoppedReason,
    executions: (result.executions || []).map((exec) => ({
      id: exec.id,
      restingOrderId: exec.restingOrderId,
      price: exec.price,
      quantity: exec.quantity,
      sequenceNumber: exec.sequenceNumber !== undefined ? String(exec.sequenceNumber) : undefined,
      executedAt: exec.executedAt,
    })),
    ...(result.isDuplicate !== undefined ? { isDuplicate: result.isDuplicate } : {}),
  };
};

/**
 * Formats order cancellation outcome safely for HTTP clients:
 * - Returns only business cancellation facts
 * - Omits internal wallet hold details or balance records
 */
export const formatSafeCancelResult = (result) => {
  if (!result) return null;
  return {
    orderId: result.orderId,
    status: result.status,
    cancelledQuantity: result.cancelledQuantity,
    remainingQuantity: result.remainingQuantity,
    releasedReservation: result.releasedReservation,
    ...(result.isDuplicate !== undefined ? { isDuplicate: result.isDuplicate } : {}),
  };
};

/**
 * Maps domain and service errors to standardized AppError instances with appropriate HTTP status codes.
 */
export const mapOrderError = (err) => {
  if (err instanceof AppError) return err;

  const msg = err.message || 'An error occurred during order operation';
  const code = err.code || err.name;

  if (code === 'INSUFFICIENT_FUNDS' || err.name === 'InsufficientFundsError') {
    return new AppError(msg, 422, 'INSUFFICIENT_FUNDS');
  }
  if (code === 'INSUFFICIENT_INVENTORY' || err.name === 'InsufficientInventoryError') {
    return new AppError(msg, 422, 'INSUFFICIENT_INVENTORY');
  }
  if (
    code === 'IDEMPOTENCY_CONFLICT' ||
    code === 'IDEMPOTENCY_PAYLOAD_MISMATCH' ||
    err.name === 'IdempotencyConflictError' ||
    err.name === 'IdempotencyPayloadMismatchError'
  ) {
    return new AppError(msg, 409, 'IDEMPOTENCY_CONFLICT');
  }
  if (
    code === 'FORBIDDEN' ||
    msg.includes('Unauthorized: order does not belong to user') ||
    msg.includes('not authorized to view this order') ||
    msg.includes('not authorized to cancel this order') ||
    msg.includes('not authorized to access')
  ) {
    return new AppError(msg || 'You are not authorized to access this order', 403, 'FORBIDDEN');
  }
  if (code === 'ORDER_NOT_FOUND' || msg.includes('Order not found')) {
    return new AppError(msg, 404, 'ORDER_NOT_FOUND');
  }
  if (msg.includes('Event not found')) {
    return new AppError(msg, 404, 'EVENT_NOT_FOUND');
  }
  if (msg.includes('Ticket category not found') || msg.includes('does not belong to event')) {
    return new AppError(msg, 404, 'CATEGORY_NOT_FOUND');
  }
  if (err.name === 'OrderValidationError' || code === 'ORDER_VALIDATION_ERROR') {
    return new AppError(msg, 400, 'ORDER_VALIDATION_ERROR');
  }
  if (
    code === 'MARKET_NOT_READY' ||
    code === 'MARKET_NOT_SYNCHRONIZED' ||
    err.name === 'MarketNotSynchronizedError'
  ) {
    return new AppError('Market is temporarily unavailable for trading', 503, 'MARKET_UNAVAILABLE');
  }
  if (
    code === 'AMBIGUOUS_COMMIT_OUTCOME' ||
    err.name === 'AmbiguousCommitError' ||
    err.name === 'AmbiguousOrderOutcomeError'
  ) {
    return new AppError(
      'Order outcome could not be verified; reservations preserved',
      504,
      'GATEWAY_TIMEOUT'
    );
  }

  return err;
};

export class OrderController {
  constructor(orderService = defaultOrderService) {
    this.orderService = orderService;
  }

  /**
   * POST /api/v1/orders
   * Authenticated User: Places a limit order with automatic fund/inventory reservation and matching.
   */
  async placeOrder(req, res, next) {
    try {
      if (!req.user || !req.user.id) {
        throw new AppError('Authentication token is required', 401, 'UNAUTHORIZED');
      }

      const userId = req.user.id;
      const body = req.validatedBody || req.body;
      const { eventId, ticketCategoryId, price, quantity } = body;
      const side = body.side === 'BUY' ? 'BID' : body.side === 'SELL' ? 'ASK' : body.side;
      const orderType = body.type || 'LIMIT';

      const rawIdempotencyKey =
        body.idempotencyKey ||
        req.headers['idempotency-key'] ||
        req.headers['x-idempotency-key'];

      if (!rawIdempotencyKey || typeof rawIdempotencyKey !== 'string' || !rawIdempotencyKey.trim()) {
        throw new AppError('idempotencyKey is required (in body or Idempotency-Key header)', 400, 'VALIDATION_ERROR');
      }
      const idempotencyKey = String(rawIdempotencyKey).trim();

      const placementInput = {
        userId,
        eventId,
        ticketCategoryId,
        side,
        price,
        quantity,
        idempotencyKey,
        orderType,
      };
      const placementResult = orderType === 'MARKET'
        ? await this.orderService.placeMarketOrder(placementInput)
        : await this.orderService.placeLimitOrder(placementInput);

      const statusCode = placementResult.isDuplicate ? 200 : 201;
      res.status(statusCode).json(successResponse(formatSafeOrder(placementResult)));
    } catch (err) {
      next(mapOrderError(err));
    }
  }

  /**
   * DELETE /api/v1/orders/:id
   * Authenticated User: Cancels an open or partially filled order and releases remaining reservations.
   */
  async cancelOrder(req, res, next) {
    try {
      if (!req.user || !req.user.id) {
        throw new AppError('Authentication token is required', 401, 'UNAUTHORIZED');
      }

      const userId = req.user.id;
      const orderId = req.params.id;
      const idempotencyKey =
        req.headers['idempotency-key'] ||
        req.headers['x-idempotency-key'] ||
        req.body?.idempotencyKey ||
        req.query?.idempotencyKey ||
        `cancel:${orderId}`;

      const cancelResult = await this.orderService.cancelLimitOrder({
        userId,
        orderId,
        idempotencyKey: String(idempotencyKey).trim(),
      });

      res.status(200).json(successResponse(formatSafeCancelResult(cancelResult)));
    } catch (err) {
      next(mapOrderError(err));
    }
  }

  /**
   * GET /api/v1/orders
   * Authenticated User: Lists the authenticated user's orders with supported status, event, and side filters plus pagination.
   */
  async getOrders(req, res, next) {
    try {
      if (!req.user || !req.user.id) {
        throw new AppError('Authentication token is required', 401, 'UNAUTHORIZED');
      }

      const userId = req.user.id;
      const query = req.validatedQuery || req.query || {};

      const result = await this.orderService.getUserOrders({
        userId,
        status: query.status,
        side: query.side,
        eventId: query.eventId || query.event,
        ticketCategoryId: query.ticketCategoryId || query.categoryId,
        page: query.page,
        limit: query.limit,
      });

      res.status(200).json(successResponse(result));
    } catch (err) {
      next(mapOrderError(err));
    }
  }

  /**
   * GET /api/v1/orders/:id
   * Authenticated User: Returns order details and execution fills.
   * Strictly enforces ownership: 403 if order belongs to another user, 404 if nonexistent.
   */
  async getOrderById(req, res, next) {
    try {
      if (!req.user || !req.user.id) {
        throw new AppError('Authentication token is required', 401, 'UNAUTHORIZED');
      }

      const userId = req.user.id;
      const params = req.validatedParams || req.params || {};
      const orderId = params.id;

      const orderDetails = await this.orderService.getOrderDetails({
        orderId,
        userId,
      });

      res.status(200).json(successResponse(orderDetails));
    } catch (err) {
      next(mapOrderError(err));
    }
  }

  /**
   * GET /api/v1/orders/:id/trades
   * Authenticated User: Returns executions/trades associated with the specified order.
   * Strictly enforces ownership: 403 if order belongs to another user, 404 if nonexistent.
   */
  async getOrderTrades(req, res, next) {
    try {
      if (!req.user || !req.user.id) {
        throw new AppError('Authentication token is required', 401, 'UNAUTHORIZED');
      }

      const userId = req.user.id;
      const params = req.validatedParams || req.params || {};
      const orderId = params.id;

      const orderTrades = await this.orderService.getOrderTrades({
        orderId,
        userId,
      });

      res.status(200).json(successResponse(orderTrades));
    } catch (err) {
      next(mapOrderError(err));
    }
  }
}

export const orderController = new OrderController();
export default orderController;
