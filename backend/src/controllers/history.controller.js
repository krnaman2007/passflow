import historyService from '../services/history.service.js';

/**
 * GET /history/transactions
 * Retrieve paginated financial transaction history.
 */
export const getTransactions = async (req, res, next) => {
  try {
    const result = await historyService.getTransactions(req.user.id, req.query);
    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /history/orders
 * Retrieve past orders for authenticated user.
 */
export const getOrders = async (req, res, next) => {
  try {
    const result = await historyService.getOrders(req.user.id, req.query);
    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /history/trades
 * Retrieve past trade executions for authenticated user.
 */
export const getTrades = async (req, res, next) => {
  try {
    const result = await historyService.getTrades(req.user.id, req.query);
    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

export default {
  getTransactions,
  getOrders,
  getTrades,
};
