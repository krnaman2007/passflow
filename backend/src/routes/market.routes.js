import { Router } from 'express';
import * as marketController from '../controllers/market.controller.js';
import { validate } from '../middleware/validate.js';
import { marketParamsSchema } from '../schemas/market.schema.js';

const router = Router();

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
