import { successResponse } from '../utils/response.js';
import marketService from '../services/market.service.js';

/**
 * GET /events/:eventId/orderbook?categoryId=... (and /api/v1/events/:eventId/orderbook)
 * Public: returns resting active orders in price-time priority and aggregated depth.
 */
export const getEventOrderbook = async (req, res, next) => {
  try {
    const params = req.validatedParams || req.params;
    const query = req.validatedQuery || req.query;

    const eventId = params.eventId || params.id;
    const categoryId = query.categoryId || query.ticketCategoryId;
    const limit = query.limit;

    const data = await marketService.getOrderbook(eventId, categoryId, { limit });

    res.status(200).json(successResponse(data));
  } catch (err) {
    next(err);
  }
};

/**
 * GET /orderbook/:id/depth (and /api/v1/orderbook/:id/depth)
 * Public: aggregated bid/ask depth levels resolved by:
 * - composite orderbook ID `eventId:categoryId`
 * - ticketCategory ID
 * - order ID
 */
export const getOrderbookDepth = async (req, res, next) => {
  try {
    const params = req.validatedParams || req.params;
    const query = req.validatedQuery || req.query;

    const id = params.id;
    const limit = query.limit;

    const data = await marketService.resolveOrderbookDepth(id, { limit });

    res.status(200).json(successResponse(data));
  } catch (err) {
    next(err);
  }
};

/**
 * GET /orderbook/:eventId/:categoryId
 * Public: compatibility route for direct event & category orderbook lookup.
 */
export const getOrderbookByEventAndCategory = async (req, res, next) => {
  try {
    const params = req.validatedParams || req.params;
    const query = req.validatedQuery || req.query;

    const { eventId, categoryId } = params;
    const limit = query.limit;

    const data = await marketService.getOrderbook(eventId, categoryId, { limit });

    res.status(200).json(successResponse(data));
  } catch (err) {
    next(err);
  }
};

export default {
  getEventOrderbook,
  getOrderbookDepth,
  getOrderbookByEventAndCategory,
};
