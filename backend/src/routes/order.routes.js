import { Router } from 'express';
import { orderController } from '../controllers/order.controller.js';
import { authenticateUser } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import {
  placeLimitOrderSchema,
  cancelOrderParamsSchema,
} from '../schemas/order.schema.js';

const router = Router();

// Base protection: All order operations require authenticated user session
router.use(authenticateUser);

/**
 * @route   POST /orders (and /api/v1/orders)
 * @desc    Place a limit order (BID or ASK) with authoritative fund/inventory reservations
 * @access  User (Authenticated)
 */
router.post(
  '/',
  validate(placeLimitOrderSchema, 'body'),
  (req, res, next) => orderController.placeOrder(req, res, next)
);

/**
 * @route   DELETE /orders/:id (and /api/v1/orders/:id)
 * @desc    Cancel an open or partially filled order and release remaining unfilled reservation
 * @access  User (Authenticated, Order Owner)
 */
router.delete(
  '/:id',
  validate(cancelOrderParamsSchema, 'params'),
  (req, res, next) => orderController.cancelOrder(req, res, next)
);

export default router;
