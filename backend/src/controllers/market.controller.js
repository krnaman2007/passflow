import { successResponse } from '../utils/response.js';
import marketService from '../services/market.service.js';

/**
 * GET /market/:eventId/:categoryId
 * Public: MarketData: best bid/ask, last price, volume.
 */
export const getMarketData = async (req, res, next) => {
  try {
    const params = req.validatedParams || req.params;
    const { eventId, categoryId } = params;

    const data = await marketService.getMarketData(eventId, categoryId);

    res.status(200).json(successResponse(data));
  } catch (err) {
    next(err);
  }
};

export default {
  getMarketData,
};
