import { Router } from 'express';
import * as marketController from '../controllers/market.controller.js';
import { validate } from '../middleware/validate.js';
import {
  marketParamsSchema,
  queryMarketDepthSchema,
  queryTradeFeedSchema,
  queryMarketSummarySchema,
} from '../schemas/market.schema.js';

const router = Router();

/**
 * @route   GET /market/summary
 * @desc    Top events by volume / price movement.
 * @access  Public
 */
router.get(
  '/summary',
  validate(queryMarketSummarySchema, 'query'),
  marketController.getMarketSummary
);

/**
 * @route   GET /market/:eventId/:categoryId/depth
 * @desc    MarketDepth levels.
 * @access  Public
 */
router.get(
  '/:eventId/:categoryId/depth',
  validate(marketParamsSchema, 'params'),
  validate(queryMarketDepthSchema, 'query'),
  marketController.getMarketDepth
);

/**
 * @route   GET /market/:eventId/:categoryId/trades
 * @desc    TradeFeed (last N trades).
 * @access  Public
 */
router.get(
  '/:eventId/:categoryId/trades',
  validate(marketParamsSchema, 'params'),
  validate(queryTradeFeedSchema, 'query'),
  marketController.getRecentTrades
);

/**
 * @route   GET /market/:eventId/:categoryId
 * @desc    MarketData: best bid/ask, last price, volume.
 * @access  Public
 */
router.get(
  '/:eventId/:categoryId',
  validate(marketParamsSchema, 'params'),
  marketController.getMarketData
);

export default router;
