import { Router } from 'express';
import { authenticateUser } from '../middleware/auth.js';
import * as dutchAuctionController from '../controllers/dutch-auction.controller.js';

const router = Router();

/**
 * @route   GET /auctions/:id
 * @desc    Dutch auction details
 * @access  Public
 */
router.get('/:id', dutchAuctionController.getAuction);

/**
 * @route   GET /auctions/:id/price
 * @desc    Current computed price
 * @access  Public
 */
router.get('/:id/price', dutchAuctionController.getCurrentPrice);

/**
 * @route   POST /auctions/:id/purchase
 * @desc    Buy at current price (locks price, debits wallet)
 * @access  Private (User)
 */
router.post('/:id/purchase', authenticateUser, dutchAuctionController.purchase);

export default router;
