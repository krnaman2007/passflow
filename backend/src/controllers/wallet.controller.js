import { walletService as defaultWalletService } from '../services/wallet/index.js';
import { historyService as defaultHistoryService } from '../services/history.service.js';
import { marketStreamService } from '../services/market-stream/index.js';
import { AppError } from '../middleware/errorHandler.js';
import { successResponse } from '../utils/response.js';

/**
 * Formats a wallet row safely for HTTP clients:
 * - Ensures all monetary BigInt balances are converted to strings.
 * - Provides both Darkhold models (balance, reservedBalance, available)
 *   and PassFlow convention (availableBalance, reservedBalance, totalBalance).
 */
export const formatSafeWallet = (wallet) => {
  if (!wallet) return null;
  const available = wallet.availableBalance ? wallet.availableBalance.toString() : '0';
  const reserved = wallet.reservedBalance ? wallet.reservedBalance.toString() : '0';
  const total = wallet.totalBalance
    ? wallet.totalBalance.toString()
    : (BigInt(available) + BigInt(reserved)).toString();

  return {
    id: wallet.id,
    userId: wallet.userId,
    currency: wallet.currency || 'INR',
    availableBalance: available,
    reservedBalance: reserved,
    totalBalance: total,
    balance: total,
    available,
    version: wallet.version ? wallet.version.toString() : '0',
    ...(wallet.activeHolds ? { activeHolds: wallet.activeHolds } : {}),
    createdAt: wallet.createdAt instanceof Date ? wallet.createdAt.toISOString() : wallet.createdAt,
    updatedAt: wallet.updatedAt instanceof Date ? wallet.updatedAt.toISOString() : wallet.updatedAt,
  };
};

/**
 * Formats a wallet mutation result safely for HTTP clients.
 */
export const formatSafeMutationResult = (result) => {
  if (!result) return null;
  return {
    isIdempotentReplay: Boolean(result.isIdempotentReplay),
    wallet: formatSafeWallet(result.wallet),
    operation: result.operation
      ? {
          id: result.operation.id,
          idempotencyKey: result.operation.idempotencyKey,
          operationType: result.operation.operationType,
          status: result.operation.status,
          referenceType: result.operation.referenceType,
          referenceId: result.operation.referenceId,
          description: result.operation.description,
          createdAt:
            result.operation.createdAt instanceof Date
              ? result.operation.createdAt.toISOString()
              : result.operation.createdAt,
        }
      : null,
    ledgerEntry: result.ledgerEntry
      ? {
          id: result.ledgerEntry.id,
          sequenceNumber: result.ledgerEntry.sequenceNumber
            ? result.ledgerEntry.sequenceNumber.toString()
            : null,
          entryType: result.ledgerEntry.entryType,
          amount: result.ledgerEntry.amount ? result.ledgerEntry.amount.toString() : null,
          availableDelta: result.ledgerEntry.availableDelta
            ? result.ledgerEntry.availableDelta.toString()
            : '0',
          reservedDelta: result.ledgerEntry.reservedDelta
            ? result.ledgerEntry.reservedDelta.toString()
            : '0',
          balanceAfterAvailable: result.ledgerEntry.balanceAfterAvailable
            ? result.ledgerEntry.balanceAfterAvailable.toString()
            : null,
          balanceAfterReserved: result.ledgerEntry.balanceAfterReserved
            ? result.ledgerEntry.balanceAfterReserved.toString()
            : null,
          description: result.ledgerEntry.description,
          createdAt:
            result.ledgerEntry.createdAt instanceof Date
              ? result.ledgerEntry.createdAt.toISOString()
              : result.ledgerEntry.createdAt,
        }
      : null,
  };
};

/**
 * Maps domain errors to standardized AppError instances with appropriate HTTP status codes.
 */
export const mapWalletError = (err) => {
  if (err instanceof AppError) return err;

  const msg = err.message || 'An error occurred during wallet operation';
  const code = err.code || err.name;

  if (code === 'INSUFFICIENT_FUNDS' || err.name === 'InsufficientFundsError') {
    return new AppError(msg, 422, 'INSUFFICIENT_FUNDS');
  }
  if (code === 'IDEMPOTENCY_CONFLICT' || err.name === 'IdempotencyConflictError') {
    return new AppError(msg, 409, 'IDEMPOTENCY_CONFLICT');
  }
  if (code === 'WALLET_NOT_FOUND' || err.name === 'WalletNotFoundError') {
    return new AppError(msg, 404, 'WALLET_NOT_FOUND');
  }
  if (code === 'WALLET_VALIDATION_ERROR' || err.name === 'WalletValidationError') {
    return new AppError(msg, 400, 'VALIDATION_ERROR');
  }

  return err;
};

export class WalletController {
  constructor(walletService = defaultWalletService, historyService = defaultHistoryService) {
    this.walletService = walletService;
    this.historyService = historyService;
  }

  /**
   * GET /api/v1/wallet (and /wallet)
   * Authenticated User: Retrieve wallet balance, reserved balance, and available funds.
   */
  async getWallet(req, res, next) {
    try {
      if (!req.user || !req.user.id) {
        throw new AppError('Authentication token is required', 401, 'UNAUTHORIZED');
      }

      const userId = req.user.id;
      const wallet = await this.walletService.getOrCreateWallet({ userId });
      const balanceDetails = await this.walletService.getWalletBalance({
        walletId: wallet.id,
        userId,
        includeHolds: true,
      });

      res.status(200).json(successResponse(formatSafeWallet(balanceDetails)));
    } catch (err) {
      next(mapWalletError(err));
    }
  }

  /**
   * POST /api/v1/wallet/deposit (and /wallet/deposit)
   * Authenticated User: Add funds via simulated payment gateway (requires Idempotency-Key).
   */
  async deposit(req, res, next) {
    try {
      if (!req.user || !req.user.id) {
        throw new AppError('Authentication token is required', 401, 'UNAUTHORIZED');
      }

      const userId = req.user.id;
      const body = req.validatedBody || req.body || {};
      const { amount, description } = body;

      const rawIdempotencyKey =
        body.idempotencyKey ||
        req.headers['idempotency-key'] ||
        req.headers['x-idempotency-key'];

      if (!rawIdempotencyKey || typeof rawIdempotencyKey !== 'string' || !rawIdempotencyKey.trim()) {
        throw new AppError('Idempotency-Key header is required', 400, 'VALIDATION_ERROR');
      }
      const idempotencyKey = String(rawIdempotencyKey).trim();

      // Ensure wallet exists for user prior to credit
      await this.walletService.getOrCreateWallet({ userId });

      const result = await this.walletService.creditAvailable({
        userId,
        amount,
        idempotencyKey,
        entryType: 'DEPOSIT',
        operationType: 'DEPOSIT',
        referenceType: 'MOCK_GATEWAY',
        description: description || 'Simulated deposit via mock payment gateway',
      });

      if (result?.wallet) {
        marketStreamService.publishWalletUpdate({ userId, wallet: result.wallet });
      }

      const statusCode = result.isIdempotentReplay ? 200 : 201;
      res.status(statusCode).json(successResponse(formatSafeMutationResult(result)));
    } catch (err) {
      next(mapWalletError(err));
    }
  }

  /**
   * POST /api/v1/wallet/withdraw (and /wallet/withdraw)
   * Authenticated User: Withdraw available funds (requires Idempotency-Key).
   */
  async withdraw(req, res, next) {
    try {
      if (!req.user || !req.user.id) {
        throw new AppError('Authentication token is required', 401, 'UNAUTHORIZED');
      }

      const userId = req.user.id;
      const body = req.validatedBody || req.body || {};
      const { amount, description } = body;

      const rawIdempotencyKey =
        body.idempotencyKey ||
        req.headers['idempotency-key'] ||
        req.headers['x-idempotency-key'];

      if (!rawIdempotencyKey || typeof rawIdempotencyKey !== 'string' || !rawIdempotencyKey.trim()) {
        throw new AppError('Idempotency-Key header is required', 400, 'VALIDATION_ERROR');
      }
      const idempotencyKey = String(rawIdempotencyKey).trim();

      // Ensure wallet exists for user prior to debit
      await this.walletService.getOrCreateWallet({ userId });

      const result = await this.walletService.debitAvailable({
        userId,
        amount,
        idempotencyKey,
        entryType: 'WITHDRAWAL_SETTLED',
        operationType: 'WITHDRAWAL',
        referenceType: 'MOCK_WITHDRAWAL',
        description: description || 'Withdrawal of available funds',
      });

      if (result?.wallet) {
        marketStreamService.publishWalletUpdate({ userId, wallet: result.wallet });
      }

      const statusCode = result.isIdempotentReplay ? 200 : 201;
      res.status(statusCode).json(successResponse(formatSafeMutationResult(result)));
    } catch (err) {
      next(mapWalletError(err));
    }
  }

  /**
   * GET /api/v1/wallet/transactions (and /wallet/transactions)
   * Authenticated User: Retrieve paginated wallet ledger entries with type and date filters.
   */
  async getTransactions(req, res, next) {
    try {
      if (!req.user || !req.user.id) {
        throw new AppError('Authentication token is required', 401, 'UNAUTHORIZED');
      }

      const userId = req.user.id;
      const query = req.validatedQuery || req.query || {};

      const result = await this.historyService.getTransactions(userId, {
        ...query,
        source: 'ledger',
      });

      res.status(200).json(successResponse(result));
    } catch (err) {
      next(mapWalletError(err));
    }
  }
}

export const walletController = new WalletController();
export default walletController;
