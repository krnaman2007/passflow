import { Router } from 'express';
import { authenticateUser } from '../middleware/auth.js';
import * as historyController from '../controllers/history.controller.js';

const router = Router();

// All history endpoints require authentication
router.use(authenticateUser);

/**
 * @route   GET /history/transactions
 * @desc    Get user's financial transaction history
 * @access  Private (User)
 */
router.get('/transactions', historyController.getTransactions);

/**
 * @route   GET /history/orders
 * @desc    Get user's past orders
 * @access  Private (User)
 */
router.get('/orders', historyController.getOrders);

/**
 * @route   GET /history/trades
 * @desc    Get user's executed trades
 * @access  Private (User)
 */
router.get('/trades', historyController.getTrades);

export default router;
