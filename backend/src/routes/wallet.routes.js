import { Router } from 'express';
import { walletController } from '../controllers/wallet.controller.js';
import { authenticateUser } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import {
  depositWalletSchema,
  withdrawWalletSchema,
  queryWalletTransactionsSchema,
} from '../schemas/wallet.schema.js';

const router = Router();

// Base protection: All wallet operations require an authenticated user session
router.use(authenticateUser);

/**
 * @route   GET /wallet (and /api/v1/wallet)
 * @desc    Retrieve user's wallet balances (available, reserved, total)
 * @access  User (Authenticated)
 */
router.get('/', (req, res, next) => walletController.getWallet(req, res, next));

/**
 * @route   POST /wallet/deposit (and /api/v1/wallet/deposit)
 * @desc    Add funds via simulated payment gateway (requires Idempotency-Key)
 * @access  User (Authenticated)
 */
router.post(
  '/deposit',
  validate(depositWalletSchema, 'body'),
  (req, res, next) => walletController.deposit(req, res, next)
);

/**
 * @route   POST /wallet/withdraw (and /api/v1/wallet/withdraw)
 * @desc    Withdraw available funds from wallet (requires Idempotency-Key)
 * @access  User (Authenticated)
 */
router.post(
  '/withdraw',
  validate(withdrawWalletSchema, 'body'),
  (req, res, next) => walletController.withdraw(req, res, next)
);

/**
 * @route   GET /wallet/transactions (and /api/v1/wallet/transactions)
 * @desc    Retrieve paginated wallet ledger transaction history with type and date filters
 * @access  User (Authenticated)
 */
router.get(
  '/transactions',
  validate(queryWalletTransactionsSchema, 'query'),
  (req, res, next) => walletController.getTransactions(req, res, next)
);

export default router;
