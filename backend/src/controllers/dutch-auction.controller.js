import dutchAuctionService from '../services/dutch-auction.service.js';

/**
 * POST /auctions
 * Create a new Dutch auction (Organizer only).
 */
export const createAuction = async (req, res, next) => {
  try {
    const organizerId = req.user?.organizer?.id;
    const auction = await dutchAuctionService.createAuction(req.body, organizerId, req.user?.role);
    res.status(201).json({
      success: true,
      message: 'Dutch auction created successfully',
      data: auction,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /auctions/:id
 * Retrieve Dutch auction details with current dynamic price.
 */
export const getAuction = async (req, res, next) => {
  try {
    const { id } = req.params;
    const auction = await dutchAuctionService.getAuctionById(id);
    res.status(200).json({
      success: true,
      data: auction,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /auctions/:id/price
 * Compute and retrieve current Dutch auction price at current timestamp.
 */
export const getCurrentPrice = async (req, res, next) => {
  try {
    const { id } = req.params;
    const priceInfo = await dutchAuctionService.getCurrentPrice(id);
    res.status(200).json({
      success: true,
      data: priceInfo,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /auctions/:id/purchase
 * Buy ticket from Dutch auction at current price.
 */
export const purchase = async (req, res, next) => {
  try {
    const { id } = req.params;
    const quantity = parseInt(req.body?.quantity, 10) || 1;
    const idempotencyKey = req.headers['idempotency-key'] || req.body?.idempotencyKey || null;
    const result = await dutchAuctionService.purchase(id, req.user.id, quantity, idempotencyKey);
    res.status(200).json({
      success: true,
      message: 'Dutch auction purchase successful',
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

export default {
  createAuction,
  getAuction,
  getCurrentPrice,
  purchase,
};

