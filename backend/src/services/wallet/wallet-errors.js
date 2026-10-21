/**
 * Wallet Domain Errors
 *
 * Dedicated error types for financial invariants, insufficient funds,
 * idempotency conflicts, and input validation.
 */

import { AppError } from '../../middleware/errorHandler.js';

export class WalletError extends AppError {
  constructor(message, statusCode = 500, code = 'WALLET_ERROR', details = {}) {
    super(message, statusCode, code);
    this.name = this.constructor.name;
    this.details = details;
  }
}

export class WalletNotFoundError extends WalletError {
  constructor(message = 'Wallet not found', details = {}) {
    super(message, 404, 'WALLET_NOT_FOUND', details);
  }
}

export class InsufficientFundsError extends WalletError {
  constructor(message = 'Insufficient available balance', details = {}) {
    super(message, 422, 'INSUFFICIENT_FUNDS', details);
  }
}

export class WalletValidationError extends WalletError {
  constructor(message = 'Invalid wallet operation parameter', details = {}) {
    super(message, 400, 'WALLET_VALIDATION_ERROR', details);
  }
}

export class IdempotencyConflictError extends WalletError {
  constructor(message = 'Idempotency key reused with different payload', details = {}) {
    super(message, 409, 'IDEMPOTENCY_CONFLICT', details);
  }
}

export class HoldInvariantError extends WalletError {
  constructor(message = 'Wallet hold invariant violation', details = {}) {
    super(message, 422, 'HOLD_INVARIANT_ERROR', details);
  }
}
