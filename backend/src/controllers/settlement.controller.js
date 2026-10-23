import { settlementApiService as defaultSettlementService } from '../services/settlement/settlement-api.service.js';
import { successResponse } from '../utils/response.js';
import { AppError } from '../middleware/errorHandler.js';

export const mapSettlementError = (err) => {
  if (err instanceof AppError) return err;

  const msg = err.message || 'An error occurred during settlement operation';
  const code = err.code || err.name;

  if (code === 'SettlementInvariantError' || err.name === 'SettlementInvariantError') {
    return new AppError(msg, 422, 'SETTLEMENT_INVARIANT_ERROR');
  }
  if (code === 'SETTLEMENT_ALREADY_SETTLED' || msg.includes('already been settled')) {
    return new AppError(msg, 409, 'SETTLEMENT_ALREADY_SETTLED');
  }
  if (code === 'SETTLEMENT_MANUAL_REVIEW_REQUIRED' || msg.includes('manual review')) {
    return new AppError(msg, 409, 'SETTLEMENT_MANUAL_REVIEW_REQUIRED');
  }
  if (code === 'SETTLEMENT_INELIGIBLE') {
    return new AppError(msg, 409, 'SETTLEMENT_INELIGIBLE');
  }
  if (code === 'SETTLEMENT_NOT_FOUND' || msg.includes('Settlement not found')) {
    return new AppError(msg, 404, 'SETTLEMENT_NOT_FOUND');
  }
  if (code === 'ESCROW_NOT_FOUND' || msg.includes('Escrow hold not found')) {
    return new AppError(msg, 404, 'ESCROW_NOT_FOUND');
  }
  if (code === 'EXECUTION_NOT_FOUND' || msg.includes('Execution not found')) {
    return new AppError(msg, 404, 'EXECUTION_NOT_FOUND');
  }
  if (
    code === 'FORBIDDEN' ||
    msg.includes('not authorized') ||
    msg.includes('Administrator privileges required')
  ) {
    return new AppError(msg || 'You are not authorized for this operation', 403, 'FORBIDDEN');
  }
  if (code === 'UNAUTHORIZED' || msg.includes('Authentication required')) {
    return new AppError(msg || 'Authentication token is required', 401, 'UNAUTHORIZED');
  }
  if (code === 'VALIDATION_ERROR' || err.name === 'ValidationError') {
    return new AppError(msg, 400, 'VALIDATION_ERROR');
  }

  return err;
};

export class SettlementController {
  constructor(service = defaultSettlementService) {
    this.settlementService = service;
    this.getSettlement = this.getSettlement.bind(this);
    this.getEscrow = this.getEscrow.bind(this);
    this.retrySettlement = this.retrySettlement.bind(this);
  }

  /**
   * GET /api/v1/settlements/:id (and /settlements/:id)
   * Authenticated Participant or Admin: Retrieve settlement status and receipt facts.
   */
  async getSettlement(req, res, next) {
    try {
      if (!req.user || !req.user.id) {
        throw new AppError('Authentication token is required', 401, 'UNAUTHORIZED');
      }

      const params = req.validatedParams || req.params || {};
      const id = params.id;

      const result = await this.settlementService.getSettlementById({
        id,
        user: req.user,
      });

      res.status(200).json(successResponse(result));
    } catch (err) {
      next(mapSettlementError(err));
    }
  }

  /**
   * GET /api/v1/escrows/:id (and /escrows/:id)
   * Authenticated Owner or Admin: Retrieve persisted escrow hold status and amounts.
   */
  async getEscrow(req, res, next) {
    try {
      if (!req.user || !req.user.id) {
        throw new AppError('Authentication token is required', 401, 'UNAUTHORIZED');
      }

      const params = req.validatedParams || req.params || {};
      const id = params.id;

      const result = await this.settlementService.getEscrowById({
        id,
        user: req.user,
      });

      res.status(200).json(successResponse(result));
    } catch (err) {
      next(mapSettlementError(err));
    }
  }

  /**
   * POST /api/v1/settlements/:id/retry (and /settlements/:id/retry)
   * Authorized Administrator: Request safe retry of an eligible pending settlement.
   */
  async retrySettlement(req, res, next) {
    try {
      if (!req.user || !req.user.id) {
        throw new AppError('Authentication token is required', 401, 'UNAUTHORIZED');
      }

      if (req.user.role !== 'ADMIN') {
        throw new AppError('Administrator privileges required', 403, 'FORBIDDEN');
      }

      const params = req.validatedParams || req.params || {};
      const id = params.id;

      const result = await this.settlementService.retrySettlement({
        id,
        adminUser: req.user,
      });

      res.status(200).json(successResponse(result));
    } catch (err) {
      next(mapSettlementError(err));
    }
  }
}

export const settlementController = new SettlementController();
export default settlementController;
