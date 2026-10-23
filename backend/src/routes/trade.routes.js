import { Router } from 'express';
import tradeController from '../controllers/trade.controller.js';
import { authenticateUser } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import {
  getTradeParamsSchema,
  queryTradesSchema,
} from '../schemas/trade.schema.js';

const router = Router();

// Base protection: All trade endpoints require authenticated user session
router.use(authenticateUser);

/**
 * @route   GET /trades (and /api/v1/trades)
 * @desc    Get authenticated user's executed trades with filtering & pagination
 * @access  User (Authenticated)
 */
router.get(
  '/',
  validate(queryTradesSchema, 'query'),
  (req, res, next) => tradeController.getTrades(req, res, next)
);

/**
 * @route   GET /trades/:id (and /api/v1/trades/:id)
 * @desc    Get trade/execution details and persisted settlement status
 * @access  User (Authenticated Participant)
 */
router.get(
  '/:id',
  validate(getTradeParamsSchema, 'params'),
  (req, res, next) => tradeController.getTradeById(req, res, next)
);

export default router;
