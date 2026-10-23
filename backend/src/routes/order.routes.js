import { Router } from 'express';
import { orderController } from '../controllers/order.controller.js';
import { authenticateUser } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import {
  placeLimitOrderSchema,
  cancelOrderParamsSchema,
  getOrderParamsSchema,
  queryOrdersSchema,
} from '../schemas/order.schema.js';

const router = Router();

// Base protection: All order operations require authenticated user session
router.use(authenticateUser);

/**
 * @route   GET /orders (and /api/v1/orders)
 * @desc    List authenticated user's orders with optional status, side, event filters and pagination
 * @access  User (Authenticated)
 */
router.get(
  '/',
  validate(queryOrdersSchema, 'query'),
  (req, res, next) => orderController.getOrders(req, res, next)
);

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
 * @route   GET /orders/:id/trades (and /api/v1/orders/:id/trades)
 * @desc    Return executions associated with the specified order
 * @access  User (Authenticated, Order Owner)
 */
router.get(
  '/:id/trades',
  validate(getOrderParamsSchema, 'params'),
  (req, res, next) => orderController.getOrderTrades(req, res, next)
);

/**
 * @route   GET /orders/:id (and /api/v1/orders/:id)
 * @desc    Return order details and execution fills
 * @access  User (Authenticated, Order Owner)
 */
router.get(
  '/:id',
  validate(getOrderParamsSchema, 'params'),
  (req, res, next) => orderController.getOrderById(req, res, next)
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

