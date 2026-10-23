import { Router } from 'express';
import * as orderbookController from '../controllers/orderbook.controller.js';
import * as marketController from '../controllers/market.controller.js';
import { validate } from '../middleware/validate.js';
import {
  orderbookDepthParamsSchema,
  orderbookDepthQuerySchema,
  eventOrderbookQuerySchema,
} from '../schemas/orderbook.schema.js';
import {
  marketParamsSchema,
  queryMarketDepthSchema,
} from '../schemas/market.schema.js';

const router = Router();

/**
 * @route   GET /orderbook/:eventId/:categoryId/depth
 * @desc    Aggregated bid/ask levels for an explicit event & category.
 * @access  Public
 */
router.get(
  '/:eventId/:categoryId/depth',
  validate(marketParamsSchema, 'params'),
  validate(queryMarketDepthSchema, 'query'),
  marketController.getMarketDepth
);

/**
 * @route   GET /orderbook/:id/depth
 * @desc    Aggregated bid/ask levels resolved by orderbook ID, category ID, or order ID.
 * @access  Public
 */
router.get(
  '/:id/depth',
  validate(orderbookDepthParamsSchema, 'params'),
  validate(orderbookDepthQuerySchema, 'query'),
  orderbookController.getOrderbookDepth
);

/**
 * @route   GET /orderbook/:eventId/:categoryId
 * @desc    Orderbook snapshot for an explicit event & category.
 * @access  Public
 */
router.get(
  '/:eventId/:categoryId',
  validate(marketParamsSchema, 'params'),
  orderbookController.getOrderbookByEventAndCategory
);

/**
 * @route   GET /orderbook
 * @desc    Orderbook query via eventId & categoryId query params.
 * @access  Public
 */
router.get(
  '/',
  validate(eventOrderbookQuerySchema, 'query'),
  orderbookController.getEventOrderbook
);

export default router;
