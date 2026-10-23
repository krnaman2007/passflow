import historyService from '../services/history.service.js';
import { successResponse } from '../utils/response.js';
import { AppError } from '../middleware/errorHandler.js';

/**
 * Maps domain and service errors to standardized AppError instances with appropriate HTTP status codes.
 */
export const mapTradeError = (err) => {
  if (err instanceof AppError) return err;

  const msg = err.message || 'An error occurred during trade operation';
  const code = err.code || err.name;

  if (
    code === 'FORBIDDEN' ||
    msg.includes('not authorized to view this trade') ||
    msg.includes('Unauthorized')
  ) {
    return new AppError(msg || 'You are not authorized to view this trade', 403, 'FORBIDDEN');
  }
  if (
    code === 'TRADE_NOT_FOUND' ||
    code === 'EXECUTION_NOT_FOUND' ||
    msg.includes('Trade not found') ||
    msg.includes('Execution not found')
  ) {
    return new AppError(msg, 404, 'TRADE_NOT_FOUND');
  }
  if (code === 'EVENT_NOT_FOUND' || msg.includes('Event not found')) {
    return new AppError(msg, 404, 'EVENT_NOT_FOUND');
  }
  if (code === 'CATEGORY_NOT_FOUND' || msg.includes('Ticket category not found')) {
    return new AppError(msg, 404, 'CATEGORY_NOT_FOUND');
  }
  if (code === 'VALIDATION_ERROR' || err.name === 'ValidationError') {
    return new AppError(msg, 400, 'VALIDATION_ERROR');
  }

  return err;
};

export class TradeController {
  constructor(service = historyService) {
    this.historyService = service;
    this.getTrades = this.getTrades.bind(this);
    this.getTradeById = this.getTradeById.bind(this);
  }

  /**
   * GET /api/v1/trades (and /trades)
   * Authenticated User: List authenticated user's executed trades with filters & pagination.
   */
  async getTrades(req, res, next) {
    try {
      if (!req.user || !req.user.id) {
        throw new AppError('Authentication token is required', 401, 'UNAUTHORIZED');
      }

      const userId = req.user.id;
      const query = req.validatedQuery || req.query || {};

      const result = await this.historyService.getTrades(userId, query);
      res.status(200).json(successResponse(result));
    } catch (err) {
      next(mapTradeError(err));
    }
  }

  /**
   * GET /api/v1/trades/:id (and /trades/:id)
   * Authenticated User (Participant): Retrieve trade/execution details with persisted settlement status.
   */
  async getTradeById(req, res, next) {
    try {
      if (!req.user || !req.user.id) {
        throw new AppError('Authentication token is required', 401, 'UNAUTHORIZED');
      }

      const userId = req.user.id;
      const params = req.validatedParams || req.params || {};
      const tradeId = params.id;

      const result = await this.historyService.getTradeById({ tradeId, userId });
      res.status(200).json(successResponse(result));
    } catch (err) {
      next(mapTradeError(err));
    }
  }
}

export const tradeController = new TradeController();
export default tradeController;
