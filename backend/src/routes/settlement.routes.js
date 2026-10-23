import { Router } from 'express';
import settlementController from '../controllers/settlement.controller.js';
import { authenticateUser, requireAdmin } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import {
  getSettlementParamsSchema,
  retrySettlementParamsSchema,
} from '../schemas/settlement.schema.js';

const router = Router();

// Base protection: All settlement endpoints require an authenticated session
router.use(authenticateUser);

/**
 * @route   POST /settlements/:id/retry (and /api/v1/settlements/:id/retry)
 * @desc    Allow an authorized administrator to request a safe retry of a failed or recoverable settlement
 * @access  Admin
 */
router.post(
  '/:id/retry',
  requireAdmin,
  validate(retrySettlementParamsSchema, 'params'),
  (req, res, next) => settlementController.retrySettlement(req, res, next)
);

/**
 * @route   GET /settlements/:id (and /api/v1/settlements/:id)
 * @desc    Retrieve settlement status and available persisted settlement receipt details
 * @access  Participant or Admin
 */
router.get(
  '/:id',
  validate(getSettlementParamsSchema, 'params'),
  (req, res, next) => settlementController.getSettlement(req, res, next)
);

export default router;
