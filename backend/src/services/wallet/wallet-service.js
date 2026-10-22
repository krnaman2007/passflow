/**
 * WalletService — Transactional Financial Mutation Engine
 *
 * Implements authoritative wallet mutations, balance projections, hold state management,
 * and immutable ledger records within strict PostgreSQL ACID transaction boundaries.
 *
 * Concurrency Strategy:
 * - Pessimistic row-level locking (SELECT * FROM "Wallet" WHERE ... FOR UPDATE) inside
 *   PostgreSQL read-committed transactions guarantees serial execution of mutations
 *   targeting the same wallet without CPU spin, optimistic retry storms, or deadlocks.
 * - Wallet.version is monotonically incremented on every balance mutation (version = version + 1n)
 *   to provide sequential audit chronology and support downstream event tracking.
 *
 * Financial Invariants:
 * - All amounts are strictly positive integer minor units (paise). 1 INR = 100 paise.
 * - availableBalance >= 0 and reservedBalance >= 0 enforced at both service and DB CHECK levels.
 * - Conservation of funds: reservations move available -> reserved; releases move reserved -> available.
 * - Ledger entries are strictly append-only; existing rows are never modified or deleted.
 * - Every balance projection mutation commits atomically with its ledger entry, hold, and operation.
 */

import { prisma as defaultPrisma } from '../../db/prisma.js';
import {
  WalletError,
  WalletNotFoundError,
  InsufficientFundsError,
  WalletValidationError,
  IdempotencyConflictError,
  HoldInvariantError,
} from './wallet-errors.js';

/** Maximum allowable monetary amount in minor units (90 trillion INR) */
export const MAX_PAISE = 9_000_000_000_000_000n;

/**
 * Validates and converts an amount into a strictly positive BigInt in minor currency units (paise).
 * Rejects floats, non-integers, negative amounts, zero, NaN, Infinity, and out-of-range values.
 *
 * @param {number|string|bigint} amount
 * @param {string} [fieldName='amount']
 * @returns {bigint}
 */
export function parseMonetaryAmount(amount, fieldName = 'amount') {
  if (amount === undefined || amount === null) {
    throw new WalletValidationError(`${fieldName} is required`);
  }

  let parsed;
  if (typeof amount === 'bigint') {
    parsed = amount;
  } else if (typeof amount === 'number') {
    if (!Number.isSafeInteger(amount)) {
      throw new WalletValidationError(`${fieldName} must be a safe integer (received ${amount})`);
    }
    parsed = BigInt(amount);
  } else if (typeof amount === 'string') {
    const trimmed = amount.trim();
    if (!/^\d+$/.test(trimmed)) {
      throw new WalletValidationError(`${fieldName} must contain only digits (received "${amount}")`);
    }
    try {
      parsed = BigInt(trimmed);
    } catch {
      throw new WalletValidationError(`${fieldName} cannot be parsed as a monetary integer`);
    }
  } else {
    throw new WalletValidationError(`${fieldName} must be an integer (received ${typeof amount})`);
  }

  if (parsed <= 0n) {
    throw new WalletValidationError(`${fieldName} must be strictly positive (greater than 0 paise)`);
  }

  if (parsed > MAX_PAISE) {
    throw new WalletValidationError(`${fieldName} exceeds maximum allowable monetary limit`);
  }

  return parsed;
}

/**
 * Safely serializes a Wallet row with stringified BigInts to prevent JSON serialization errors.
 *
 * @param {Object|null} wallet
 * @returns {Object|null}
 */
export function serializeWallet(wallet) {
  if (!wallet) return null;
  const available = BigInt(wallet.availableBalance);
  const reserved = BigInt(wallet.reservedBalance);
  return {
    id: wallet.id,
    userId: wallet.userId,
    currency: wallet.currency,
    availableBalance: available.toString(),
    reservedBalance: reserved.toString(),
    totalBalance: (available + reserved).toString(),
    version: BigInt(wallet.version).toString(),
    createdAt: wallet.createdAt instanceof Date ? wallet.createdAt.toISOString() : wallet.createdAt,
    updatedAt: wallet.updatedAt instanceof Date ? wallet.updatedAt.toISOString() : wallet.updatedAt,
  };
}

/**
 * Safely serializes a WalletHold row with stringified BigInts.
 *
 * @param {Object|null} hold
 * @returns {Object|null}
 */
export function serializeHold(hold) {
  if (!hold) return null;
  return {
    id: hold.id,
    walletId: hold.walletId,
    operationId: hold.operationId || null,
    orderId: hold.orderId || null,
    reason: hold.reason,
    status: hold.status,
    heldAmount: BigInt(hold.heldAmount).toString(),
    remainingAmount: BigInt(hold.remainingAmount).toString(),
    idempotencyKey: hold.idempotencyKey || null,
    createdAt: hold.createdAt instanceof Date ? hold.createdAt.toISOString() : hold.createdAt,
    updatedAt: hold.updatedAt instanceof Date ? hold.updatedAt.toISOString() : hold.updatedAt,
  };
}

/**
 * Safely serializes a WalletLedgerEntry row with stringified BigInts.
 *
 * @param {Object|null} entry
 * @returns {Object|null}
 */
export function serializeLedgerEntry(entry) {
  if (!entry) return null;
  return {
    id: entry.id,
    walletId: entry.walletId,
    operationId: entry.operationId || null,
    sequenceNumber: entry.sequenceNumber ? entry.sequenceNumber.toString() : null,
    entryType: entry.entryType,
    amount: BigInt(entry.amount).toString(),
    availableDelta: BigInt(entry.availableDelta).toString(),
    reservedDelta: BigInt(entry.reservedDelta).toString(),
    balanceAfterAvailable: BigInt(entry.balanceAfterAvailable).toString(),
    balanceAfterReserved: BigInt(entry.balanceAfterReserved).toString(),
    holdId: entry.holdId || null,
    orderId: entry.orderId || null,
    executionId: entry.executionId || null,
    idempotencyKey: entry.idempotencyKey || null,
    description: entry.description || null,
    createdAt: entry.createdAt instanceof Date ? entry.createdAt.toISOString() : entry.createdAt,
  };
}

/**
 * Safely serializes a FinancialOperation row.
 *
 * @param {Object|null} op
 * @returns {Object|null}
 */
export function serializeOperation(op) {
  if (!op) return null;
  return {
    id: op.id,
    idempotencyKey: op.idempotencyKey,
    operationType: op.operationType,
    status: op.status,
    referenceType: op.referenceType || null,
    referenceId: op.referenceId || null,
    description: op.description || null,
    metadata: op.metadata || null,
    createdAt: op.createdAt instanceof Date ? op.createdAt.toISOString() : op.createdAt,
    updatedAt: op.updatedAt instanceof Date ? op.updatedAt.toISOString() : op.updatedAt,
  };
}

export class WalletService {
  /**
   * @param {Object} [options]
   * @param {import('@prisma/client').PrismaClient} [options.prismaClient]
   */
  constructor({ prismaClient = defaultPrisma } = {}) {
    this.prisma = prismaClient;
  }

  /**
   * Creates or retrieves a user's wallet idempotently.
   *
   * @param {Object} params
   * @param {string} params.userId - Unique user identifier
   * @param {string} [params.currency='INR'] - Standard currency code
   * @param {Object} [tx] - Optional transaction client
   * @returns {Promise<Object>} Serialized wallet
   */
  async getOrCreateWallet({ userId, currency = 'INR' }, tx = null) {
    if (!userId || typeof userId !== 'string' || !userId.trim()) {
      throw new WalletValidationError('userId must be a non-empty string');
    }

    if (currency !== 'INR') {
      throw new WalletValidationError(`Unsupported currency: ${currency}. Only 'INR' is supported.`);
    }

    const client = tx || this.prisma;

    // 1. Try to find existing wallet
    const existing = await client.wallet.findUnique({
      where: { userId },
    });
    if (existing) {
      if (existing.currency !== currency) {
        throw new WalletValidationError(
          `Wallet currency mismatch: existing wallet is ${existing.currency}, requested ${currency}`
        );
      }
      return serializeWallet(existing);
    }

    // 2. Attempt creation with graceful handling of concurrent creation races
    try {
      const created = await client.wallet.create({
        data: {
          userId,
          currency,
          availableBalance: 0n,
          reservedBalance: 0n,
          version: 0n,
        },
      });
      return serializeWallet(created);
    } catch (err) {
      if (err.code === 'P2002') {
        const raceWinner = await client.wallet.findUnique({
          where: { userId },
        });
        if (raceWinner) {
          return serializeWallet(raceWinner);
        }
      }
      throw err;
    }
  }

  /**
   * Retrieves a wallet's balances and optionally its active holds.
   *
   * @param {Object} params
   * @param {string} [params.walletId] - Wallet ID
   * @param {string} [params.userId] - User ID
   * @param {boolean} [params.includeHolds=false] - Whether to include active holds
   * @param {Object} [tx] - Optional transaction client
   * @returns {Promise<Object>}
   */
  async getWalletBalance({ walletId, userId, includeHolds = false }, tx = null) {
    if (!walletId && !userId) {
      throw new WalletValidationError('Either walletId or userId must be provided');
    }

    const client = tx || this.prisma;
    const wallet = await client.wallet.findUnique({
      where: walletId ? { id: walletId } : { userId },
      include: includeHolds
        ? {
            holds: {
              where: {
                status: { in: ['ACTIVE', 'PARTIALLY_RELEASED', 'PARTIALLY_SETTLED'] },
              },
              orderBy: { createdAt: 'desc' },
            },
          }
        : false,
    });

    if (!wallet) {
      throw new WalletNotFoundError(
        walletId ? `Wallet not found with id: ${walletId}` : `Wallet not found for userId: ${userId}`
      );
    }

    // Enforce ownership check: if both walletId and userId were supplied, ensure they match
    if (walletId && userId && wallet.userId !== userId) {
      throw new WalletNotFoundError(`Wallet ${walletId} does not belong to user ${userId}`);
    }

    const result = serializeWallet(wallet);
    if (includeHolds && wallet.holds) {
      result.activeHolds = wallet.holds.map(serializeHold);
    }
    return result;
  }

  /**
   * Credits available balance for a trusted internal financial operation (e.g. deposit, refund, or adjustment).
   * Atomically writes:
   * 1. FinancialOperation record (status: COMPLETED)
   * 2. Immutable WalletLedgerEntry with positive availableDelta and snapshot balances
   * 3. Wallet availableBalance projection update and version increment
   *
   * @param {Object} params
   * @param {string} [params.walletId]
   * @param {string} [params.userId]
   * @param {number|string|bigint} params.amount - Strictly positive integer paise
   * @param {string} params.idempotencyKey - Required stable deduplication key
   * @param {string} [params.entryType='DEPOSIT'] - LedgerEntryType enum value
   * @param {string} [params.operationType='DEPOSIT'] - FinancialOperationType enum value
   * @param {string} [params.referenceType] - e.g. 'PAYMENT_INTENT'
   * @param {string} [params.referenceId] - e.g. payment gateway transaction id
   * @param {string} [params.description]
   * @param {Object} [params.metadata]
   * @param {Object} [externalTx] - Optional caller transaction client
   * @returns {Promise<{ isIdempotentReplay: boolean, wallet: Object, operation: Object, ledgerEntry: Object, hold: null }>}
   */
  async creditAvailable(
    {
      walletId,
      userId,
      amount,
      idempotencyKey,
      entryType = 'DEPOSIT',
      operationType = 'DEPOSIT',
      referenceType = null,
      referenceId = null,
      description = null,
      metadata = null,
    },
    externalTx = null
  ) {
    const amountBigInt = parseMonetaryAmount(amount, 'amount');
    this._validateIdempotencyKey(idempotencyKey);

    const allowedEntryTypes = ['DEPOSIT', 'COMPENSATING_ADJUSTMENT', 'TRADE_SETTLEMENT_CREDIT'];
    if (!allowedEntryTypes.includes(entryType)) {
      throw new WalletValidationError(
        `Invalid entryType for credit: ${entryType}. Must be one of: ${allowedEntryTypes.join(', ')}`
      );
    }

    const allowedOperationTypes = ['DEPOSIT', 'COMPENSATING_ADJUSTMENT', 'TRADE_SETTLEMENT', 'REFUND'];
    if (!allowedOperationTypes.includes(operationType)) {
      throw new WalletValidationError(
        `Invalid operationType for credit: ${operationType}. Must be one of: ${allowedOperationTypes.join(', ')}`
      );
    }

    const execute = async (tx) => {
      // 1. Acquire exclusive pessimistic row lock on the target Wallet
      const wallet = await this._lockWallet(tx, { walletId, userId });

      // 2. Define canonical expected payload for idempotency verification
      const expectedPayload = {
        walletId: wallet.id,
        operationType,
        amount: amountBigInt.toString(),
        referenceType: referenceType || null,
        referenceId: referenceId || null,
        holdId: null,
      };

      // 3. Check for existing operation by idempotencyKey
      const existingOp = await tx.financialOperation.findUnique({
        where: { idempotencyKey },
        include: {
          ledgerEntries: true,
          holds: true,
        },
      });

      if (existingOp) {
        this._verifyIdempotentOperation(existingOp, expectedPayload, idempotencyKey);
        return {
          isIdempotentReplay: true,
          wallet: serializeWallet(wallet),
          operation: serializeOperation(existingOp),
          ledgerEntry: existingOp.ledgerEntries[0] ? serializeLedgerEntry(existingOp.ledgerEntries[0]) : null,
          hold: null,
        };
      }

      // 4. Calculate new balances and version
      const currentAvailable = BigInt(wallet.availableBalance);
      const currentReserved = BigInt(wallet.reservedBalance);
      const currentVersion = BigInt(wallet.version);

      const newAvailable = currentAvailable + amountBigInt;
      const newReserved = currentReserved;
      const newVersion = currentVersion + 1n;

      // 5. Create FinancialOperation
      const op = await tx.financialOperation.create({
        data: {
          idempotencyKey,
          operationType,
          status: 'COMPLETED',
          referenceType: referenceType || null,
          referenceId: referenceId || null,
          description: description || null,
          metadata: {
            ...expectedPayload,
            ...(metadata || {}),
          },
        },
      });

      // 6. Create immutable WalletLedgerEntry
      const ledger = await tx.walletLedgerEntry.create({
        data: {
          walletId: wallet.id,
          operationId: op.id,
          entryType,
          amount: amountBigInt,
          availableDelta: amountBigInt,
          reservedDelta: 0n,
          balanceAfterAvailable: newAvailable,
          balanceAfterReserved: newReserved,
          idempotencyKey,
          description: description || null,
        },
      });

      // 7. Update Wallet projection atomically
      const updatedWallet = await tx.wallet.update({
        where: { id: wallet.id },
        data: {
          availableBalance: newAvailable,
          reservedBalance: newReserved,
          version: newVersion,
        },
      });

      return {
        isIdempotentReplay: false,
        wallet: serializeWallet(updatedWallet),
        operation: serializeOperation(op),
        ledgerEntry: serializeLedgerEntry(ledger),
        hold: null,
      };
    };

    if (externalTx) {
      return execute(externalTx);
    }
    return this._runInTransaction(execute, idempotencyKey, {
      walletId: walletId || null,
      userId: userId || null,
      amount: amountBigInt.toString(),
      operationType,
      referenceType,
      referenceId,
    });
  }

  /**
   * Debits available balance for a trusted internal financial operation (e.g. withdrawal or fee).
   * Rejects immediately if availableBalance < amount (insufficient funds).
   *
   * @param {Object} params
   * @param {string} [params.walletId]
   * @param {string} [params.userId]
   * @param {number|string|bigint} params.amount - Strictly positive integer paise
   * @param {string} params.idempotencyKey
   * @param {string} [params.entryType='FEE_DEBIT']
   * @param {string} [params.operationType='WITHDRAWAL']
   * @param {string} [params.referenceType]
   * @param {string} [params.referenceId]
   * @param {string} [params.description]
   * @param {Object} [params.metadata]
   * @param {Object} [externalTx]
   * @returns {Promise<{ isIdempotentReplay: boolean, wallet: Object, operation: Object, ledgerEntry: Object, hold: null }>}
   */
  async debitAvailable(
    {
      walletId,
      userId,
      amount,
      idempotencyKey,
      entryType = 'FEE_DEBIT',
      operationType = 'WITHDRAWAL',
      referenceType = null,
      referenceId = null,
      description = null,
      metadata = null,
    },
    externalTx = null
  ) {
    const amountBigInt = parseMonetaryAmount(amount, 'amount');
    this._validateIdempotencyKey(idempotencyKey);

    const allowedEntryTypes = ['FEE_DEBIT', 'WITHDRAWAL_LOCK', 'TRADE_SETTLEMENT_DEBIT', 'COMPENSATING_ADJUSTMENT'];
    if (!allowedEntryTypes.includes(entryType)) {
      throw new WalletValidationError(
        `Invalid entryType for debit: ${entryType}. Must be one of: ${allowedEntryTypes.join(', ')}`
      );
    }

    const allowedOperationTypes = ['WITHDRAWAL', 'TRADE_SETTLEMENT', 'COMPENSATING_ADJUSTMENT'];
    if (!allowedOperationTypes.includes(operationType)) {
      throw new WalletValidationError(
        `Invalid operationType for debit: ${operationType}. Must be one of: ${allowedOperationTypes.join(', ')}`
      );
    }

    const execute = async (tx) => {
      // 1. Lock wallet row
      const wallet = await this._lockWallet(tx, { walletId, userId });

      // 2. Define expected payload
      const expectedPayload = {
        walletId: wallet.id,
        operationType,
        amount: amountBigInt.toString(),
        referenceType: referenceType || null,
        referenceId: referenceId || null,
        holdId: null,
      };

      // 3. Check for existing operation
      const existingOp = await tx.financialOperation.findUnique({
        where: { idempotencyKey },
        include: {
          ledgerEntries: true,
          holds: true,
        },
      });

      if (existingOp) {
        this._verifyIdempotentOperation(existingOp, expectedPayload, idempotencyKey);
        return {
          isIdempotentReplay: true,
          wallet: serializeWallet(wallet),
          operation: serializeOperation(existingOp),
          ledgerEntry: existingOp.ledgerEntries[0] ? serializeLedgerEntry(existingOp.ledgerEntries[0]) : null,
          hold: null,
        };
      }

      // 4. Check available balance sufficiency
      const currentAvailable = BigInt(wallet.availableBalance);
      if (currentAvailable < amountBigInt) {
        throw new InsufficientFundsError(
          `Insufficient available balance: requested ${amountBigInt.toString()} paise, available ${currentAvailable.toString()} paise`,
          {
            requestedAmount: amountBigInt.toString(),
            availableBalance: currentAvailable.toString(),
            walletId: wallet.id,
          }
        );
      }

      // 5. Balance calculations
      const currentReserved = BigInt(wallet.reservedBalance);
      const currentVersion = BigInt(wallet.version);

      const newAvailable = currentAvailable - amountBigInt;
      const newReserved = currentReserved;
      const newVersion = currentVersion + 1n;

      // 6. Create FinancialOperation
      const op = await tx.financialOperation.create({
        data: {
          idempotencyKey,
          operationType,
          status: 'COMPLETED',
          referenceType: referenceType || null,
          referenceId: referenceId || null,
          description: description || null,
          metadata: {
            ...expectedPayload,
            ...(metadata || {}),
          },
        },
      });

      // 7. Create immutable WalletLedgerEntry with negative availableDelta
      const ledger = await tx.walletLedgerEntry.create({
        data: {
          walletId: wallet.id,
          operationId: op.id,
          entryType,
          amount: amountBigInt,
          availableDelta: -amountBigInt,
          reservedDelta: 0n,
          balanceAfterAvailable: newAvailable,
          balanceAfterReserved: newReserved,
          idempotencyKey,
          description: description || null,
        },
      });

      // 8. Update Wallet
      const updatedWallet = await tx.wallet.update({
        where: { id: wallet.id },
        data: {
          availableBalance: newAvailable,
          reservedBalance: newReserved,
          version: newVersion,
        },
      });

      return {
        isIdempotentReplay: false,
        wallet: serializeWallet(updatedWallet),
        operation: serializeOperation(op),
        ledgerEntry: serializeLedgerEntry(ledger),
        hold: null,
      };
    };

    if (externalTx) {
      return execute(externalTx);
    }
    return this._runInTransaction(execute, idempotencyKey, {
      walletId: walletId || null,
      userId: userId || null,
      amount: amountBigInt.toString(),
      operationType,
      referenceType,
      referenceId,
    });
  }

  /**
   * Reserves funds by moving an amount from availableBalance to reservedBalance and creating a WalletHold.
   * Total balance (available + reserved) is conserved.
   *
   * @param {Object} params
   * @param {string} [params.walletId]
   * @param {string} [params.userId]
   * @param {number|string|bigint} params.amount
   * @param {string} params.idempotencyKey
   * @param {string} [params.reason='ORDER_ESCROW'] - HoldReason enum
   * @param {string} [params.orderId] - Optional referencing order ID
   * @param {string} [params.referenceType]
   * @param {string} [params.referenceId]
   * @param {string} [params.description]
   * @param {Object} [params.metadata]
   * @param {Object} [externalTx]
   * @returns {Promise<{ isIdempotentReplay: boolean, wallet: Object, hold: Object, ledgerEntry: Object, operation: Object }>}
   */
  async reserveFunds(
    {
      walletId,
      userId,
      amount,
      idempotencyKey,
      reason = 'ORDER_ESCROW',
      orderId = null,
      referenceType = null,
      referenceId = null,
      description = null,
      metadata = null,
    },
    externalTx = null
  ) {
    const amountBigInt = parseMonetaryAmount(amount, 'amount');
    this._validateIdempotencyKey(idempotencyKey);

    const allowedReasons = ['ORDER_ESCROW', 'WITHDRAWAL_ESCROW', 'ADMINISTRATIVE_HOLD'];
    if (!allowedReasons.includes(reason)) {
      throw new WalletValidationError(
        `Invalid hold reason: ${reason}. Must be one of: ${allowedReasons.join(', ')}`
      );
    }

    const opType = reason === 'WITHDRAWAL_ESCROW' ? 'WITHDRAWAL' : 'ORDER_ESCROW';
    const entryType = reason === 'WITHDRAWAL_ESCROW' ? 'WITHDRAWAL_LOCK' : 'ORDER_HOLD';

    const execute = async (tx) => {
      // 1. A linked order must be locked before its wallet.  Settlement uses
      // Order -> Wallet -> Hold, and the WalletHold insert below acquires an
      // implicit foreign-key lock on Order.  Taking Wallet first here would
      // create a real inversion for callers that supply orderId.
      if (orderId) {
        await tx.$queryRaw`
          SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE
        `;
      }

      // 2. Lock wallet row
      const wallet = await this._lockWallet(tx, { walletId, userId });

      // 3. Define expected payload
      const expectedPayload = {
        walletId: wallet.id,
        operationType: opType,
        amount: amountBigInt.toString(),
        referenceType: referenceType || (orderId ? 'ORDER' : null),
        referenceId: referenceId || orderId || null,
        holdId: null,
      };

      // 4. Check existing operation
      const existingOp = await tx.financialOperation.findUnique({
        where: { idempotencyKey },
        include: {
          ledgerEntries: true,
          holds: true,
        },
      });

      if (existingOp) {
        this._verifyIdempotentOperation(existingOp, expectedPayload, idempotencyKey);
        return {
          isIdempotentReplay: true,
          wallet: serializeWallet(wallet),
          operation: serializeOperation(existingOp),
          ledgerEntry: existingOp.ledgerEntries[0] ? serializeLedgerEntry(existingOp.ledgerEntries[0]) : null,
          hold: existingOp.holds[0] ? serializeHold(existingOp.holds[0]) : null,
        };
      }

      // 5. Verify sufficiency
      const currentAvailable = BigInt(wallet.availableBalance);
      if (currentAvailable < amountBigInt) {
        throw new InsufficientFundsError(
          `Insufficient available balance to reserve: requested ${amountBigInt.toString()} paise, available ${currentAvailable.toString()} paise`,
          {
            requestedAmount: amountBigInt.toString(),
            availableBalance: currentAvailable.toString(),
            walletId: wallet.id,
          }
        );
      }

      // 6. Invariant calculations: available reduces by amount, reserved increases by amount
      const currentReserved = BigInt(wallet.reservedBalance);
      const currentVersion = BigInt(wallet.version);

      const newAvailable = currentAvailable - amountBigInt;
      const newReserved = currentReserved + amountBigInt;
      const newVersion = currentVersion + 1n;

      // 7. Create FinancialOperation
      const op = await tx.financialOperation.create({
        data: {
          idempotencyKey,
          operationType: opType,
          status: 'COMPLETED',
          referenceType: expectedPayload.referenceType,
          referenceId: expectedPayload.referenceId,
          description: description || null,
          metadata: {
            ...expectedPayload,
            reason,
            orderId: orderId || null,
            ...(metadata || {}),
          },
        },
      });

      // 8. Create WalletHold
      const hold = await tx.walletHold.create({
        data: {
          walletId: wallet.id,
          operationId: op.id,
          orderId: orderId || null,
          reason,
          status: 'ACTIVE',
          heldAmount: amountBigInt,
          remainingAmount: amountBigInt,
          idempotencyKey,
        },
      });

      // 9. Create immutable WalletLedgerEntry
      const ledger = await tx.walletLedgerEntry.create({
        data: {
          walletId: wallet.id,
          operationId: op.id,
          holdId: hold.id,
          orderId: orderId || null,
          entryType,
          amount: amountBigInt,
          availableDelta: -amountBigInt,
          reservedDelta: amountBigInt,
          balanceAfterAvailable: newAvailable,
          balanceAfterReserved: newReserved,
          idempotencyKey,
          description: description || null,
        },
      });

      // 10. Update Wallet projection
      const updatedWallet = await tx.wallet.update({
        where: { id: wallet.id },
        data: {
          availableBalance: newAvailable,
          reservedBalance: newReserved,
          version: newVersion,
        },
      });

      return {
        isIdempotentReplay: false,
        wallet: serializeWallet(updatedWallet),
        hold: serializeHold(hold),
        ledgerEntry: serializeLedgerEntry(ledger),
        operation: serializeOperation(op),
      };
    };

    if (externalTx) {
      return execute(externalTx);
    }
    return this._runInTransaction(execute, idempotencyKey, {
      walletId: walletId || null,
      userId: userId || null,
      amount: amountBigInt.toString(),
      operationType: opType,
      referenceType: referenceType || (orderId ? 'ORDER' : null),
      referenceId: referenceId || orderId || null,
    });
  }

  /**
   * Releases the remaining (or specified partial) amount of an active hold back to available balance.
   * Decreases reservedBalance and increases availableBalance by releaseAmount.
   * Rejects if hold is already closed or if requested releaseAmount > remainingAmount.
   *
   * @param {Object} params
   * @param {string} params.holdId - ID of WalletHold to release
   * @param {string} params.idempotencyKey - Required stable deduplication key
   * @param {number|string|bigint} [params.amount=null] - Optional partial release amount; defaults to full remainingAmount
   * @param {string} [params.referenceType]
   * @param {string} [params.referenceId]
   * @param {string} [params.description]
   * @param {Object} [params.metadata]
   * @param {Object} [externalTx]
   * @returns {Promise<{ isIdempotentReplay: boolean, wallet: Object, hold: Object, ledgerEntry: Object, operation: Object }>}
   */
  async releaseHold(
    {
      holdId,
      idempotencyKey,
      amount = null,
      referenceType = null,
      referenceId = null,
      description = null,
      metadata = null,
    },
    externalTx = null
  ) {
    if (!holdId || typeof holdId !== 'string' || !holdId.trim()) {
      throw new WalletValidationError('holdId must be a non-empty string');
    }
    this._validateIdempotencyKey(idempotencyKey);

    const execute = async (tx) => {
      // 1. Fetch the target hold
      const initialHold = await tx.walletHold.findUnique({
        where: { id: holdId },
      });
      if (!initialHold) {
        throw new WalletNotFoundError(`Wallet hold not found with id: ${holdId}`);
      }

      // 1b. Enforce global lock hierarchy (Order -> Wallet -> WalletHold):
      // When the hold is linked to an Order (either via hold.orderId or referenceType === 'ORDER'),
      // acquire the Order row lock BEFORE acquiring the Wallet lock.
      // This eliminates lock-order inversion deadlocks (40P01) against TradeSettlementService.
      const linkedOrderId = initialHold.orderId || (referenceType === 'ORDER' ? referenceId : null);
      if (linkedOrderId) {
        await tx.$queryRaw`
          SELECT id FROM "Order" WHERE id = ${linkedOrderId} FOR UPDATE
        `;
      }

      // 2. Lock the parent wallet row
      const walletRows = await tx.$queryRaw`
        SELECT * FROM "Wallet" WHERE id = ${initialHold.walletId} FOR UPDATE
      `;
      if (!walletRows || walletRows.length === 0) {
        throw new WalletNotFoundError(`Parent wallet not found for hold: ${holdId}`);
      }
      const wallet = walletRows[0];

      // 3. Re-read hold under lock to ensure authoritative state
      const holdRows = await tx.$queryRaw`
        SELECT * FROM "WalletHold" WHERE id = ${holdId} FOR UPDATE
      `;
      if (!holdRows || holdRows.length === 0) {
        throw new WalletNotFoundError(`Wallet hold not found with id: ${holdId}`);
      }
      const hold = holdRows[0];

      // 4. Validate hold active state
      const currentRemaining = BigInt(hold.remainingAmount);
      if (hold.status === 'RELEASED' || hold.status === 'SETTLED' || currentRemaining === 0n) {
        throw new HoldInvariantError(
          `Hold ${holdId} is already closed (status: ${hold.status}, remaining: ${currentRemaining.toString()})`
        );
      }

      // 5. Determine release amount (defaults to full remaining amount if not specified)
      const releaseAmountBigInt =
        amount !== null && amount !== undefined
          ? parseMonetaryAmount(amount, 'amount')
          : currentRemaining;

      // 6. Enforce invariant: releaseAmount <= remainingAmount
      if (releaseAmountBigInt > currentRemaining) {
        throw new HoldInvariantError(
          `Cannot release ${releaseAmountBigInt.toString()} paise from hold ${holdId} with only ${currentRemaining.toString()} paise remaining`
        );
      }

      const currentReserved = BigInt(wallet.reservedBalance);
      if (releaseAmountBigInt > currentReserved) {
        throw new HoldInvariantError(
          `Corrupted state: release amount ${releaseAmountBigInt.toString()} exceeds wallet reserved balance ${currentReserved.toString()}`
        );
      }

      const opType = hold.reason === 'WITHDRAWAL_ESCROW' ? 'REFUND' : 'ORDER_RELEASE';
      const entryType = hold.reason === 'WITHDRAWAL_ESCROW' ? 'WITHDRAWAL_REFUNDED' : 'ORDER_RELEASE';

      // 7. Check idempotency
      const expectedPayload = {
        walletId: wallet.id,
        operationType: opType,
        amount: releaseAmountBigInt.toString(),
        referenceType: referenceType || (hold.orderId ? 'ORDER' : null),
        referenceId: referenceId || hold.orderId || null,
        holdId: hold.id,
      };

      const existingOp = await tx.financialOperation.findUnique({
        where: { idempotencyKey },
        include: {
          ledgerEntries: true,
          holds: true,
        },
      });

      if (existingOp) {
        this._verifyIdempotentOperation(existingOp, expectedPayload, idempotencyKey);
        return {
          isIdempotentReplay: true,
          wallet: serializeWallet(wallet),
          operation: serializeOperation(existingOp),
          ledgerEntry: existingOp.ledgerEntries[0] ? serializeLedgerEntry(existingOp.ledgerEntries[0]) : null,
          hold: serializeHold(hold),
        };
      }

      // 8. Calculate new hold remaining and state
      const newRemaining = currentRemaining - releaseAmountBigInt;
      const newHoldStatus = newRemaining === 0n ? 'RELEASED' : 'PARTIALLY_RELEASED';

      // 9. Calculate new balances: reserved decreases, available increases
      const currentAvailable = BigInt(wallet.availableBalance);
      const currentVersion = BigInt(wallet.version);

      const newAvailable = currentAvailable + releaseAmountBigInt;
      const newReserved = currentReserved - releaseAmountBigInt;
      const newVersion = currentVersion + 1n;

      // 10. Create FinancialOperation
      const op = await tx.financialOperation.create({
        data: {
          idempotencyKey,
          operationType: opType,
          status: 'COMPLETED',
          referenceType: expectedPayload.referenceType,
          referenceId: expectedPayload.referenceId,
          description: description || null,
          metadata: {
            ...expectedPayload,
            ...(metadata || {}),
          },
        },
      });

      // 11. Update WalletHold
      const updatedHold = await tx.walletHold.update({
        where: { id: hold.id },
        data: {
          remainingAmount: newRemaining,
          status: newHoldStatus,
        },
      });

      // 12. Create immutable WalletLedgerEntry
      const ledger = await tx.walletLedgerEntry.create({
        data: {
          walletId: wallet.id,
          operationId: op.id,
          holdId: hold.id,
          orderId: hold.orderId || null,
          entryType,
          amount: releaseAmountBigInt,
          availableDelta: releaseAmountBigInt,
          reservedDelta: -releaseAmountBigInt,
          balanceAfterAvailable: newAvailable,
          balanceAfterReserved: newReserved,
          idempotencyKey,
          description: description || null,
        },
      });

      // 13. Update Wallet projection
      const updatedWallet = await tx.wallet.update({
        where: { id: wallet.id },
        data: {
          availableBalance: newAvailable,
          reservedBalance: newReserved,
          version: newVersion,
        },
      });

      return {
        isIdempotentReplay: false,
        wallet: serializeWallet(updatedWallet),
        hold: serializeHold(updatedHold),
        ledgerEntry: serializeLedgerEntry(ledger),
        operation: serializeOperation(op),
      };
    };

    if (externalTx) {
      return execute(externalTx);
    }
    return this._runInTransaction(execute, idempotencyKey, {
      holdId,
      amount: amount !== null && amount !== undefined ? parseMonetaryAmount(amount, 'amount').toString() : null,
      referenceType: referenceType || null,
      referenceId: referenceId || null,
    });
  }

  // =========================================================================
  // Private Helpers
  // =========================================================================

  /**
   * Acquires an exclusive row lock on the target Wallet in PostgreSQL.
   *
   * @private
   * @param {Object} tx
   * @param {Object} selector
   * @param {string} [selector.walletId]
   * @param {string} [selector.userId]
   * @returns {Promise<Object>} The raw locked wallet row
   */
  async _lockWallet(tx, { walletId, userId }) {
    let rows;
    if (walletId && userId) {
      rows = await tx.$queryRaw`SELECT * FROM "Wallet" WHERE id = ${walletId} FOR UPDATE`;
      if (rows && rows.length > 0 && rows[0].userId !== userId) {
        throw new WalletNotFoundError(`Wallet ${walletId} does not belong to user ${userId}`);
      }
    } else if (walletId) {
      rows = await tx.$queryRaw`SELECT * FROM "Wallet" WHERE id = ${walletId} FOR UPDATE`;
    } else if (userId) {
      rows = await tx.$queryRaw`SELECT * FROM "Wallet" WHERE "userId" = ${userId} FOR UPDATE`;
    } else {
      throw new WalletValidationError('Either walletId or userId must be provided');
    }

    if (!rows || rows.length === 0) {
      throw new WalletNotFoundError(
        walletId ? `Wallet not found with id: ${walletId}` : `Wallet not found for userId: ${userId}`
      );
    }
    return rows[0];
  }

  /**
   * Validates idempotency key format.
   *
   * @private
   * @param {string} key
   */
  _validateIdempotencyKey(key) {
    if (!key || typeof key !== 'string' || !key.trim()) {
      throw new WalletValidationError('idempotencyKey must be a non-empty string');
    }
  }

  /**
   * Verifies that an existing FinancialOperation matches the expected business payload.
   * Rejects duplicate key reuse with a different payload.
   *
   * @private
   * @param {Object} existingOp
   * @param {Object} expectedPayload
   * @param {string} idempotencyKey
   */
  _verifyIdempotentOperation(existingOp, expectedPayload, idempotencyKey) {
    const meta = existingOp.metadata || {};

    const isAmountMatch =
      expectedPayload.amount === null || expectedPayload.amount === undefined
        ? true
        : meta.amount === expectedPayload.amount;

    const isWalletMatch =
      !expectedPayload.walletId || meta.walletId === expectedPayload.walletId;

    const isOpTypeMatch =
      !expectedPayload.operationType || existingOp.operationType === expectedPayload.operationType;

    const isHoldMatch =
      (meta.holdId || null) === (expectedPayload.holdId || null);

    const isRefTypeMatch =
      expectedPayload.referenceType === undefined
        ? true
        : (existingOp.referenceType || null) === (expectedPayload.referenceType || null);

    const isRefIdMatch =
      expectedPayload.referenceId === undefined
        ? true
        : (existingOp.referenceId || null) === (expectedPayload.referenceId || null);

    const isMatch =
      isAmountMatch &&
      isWalletMatch &&
      isOpTypeMatch &&
      isHoldMatch &&
      isRefTypeMatch &&
      isRefIdMatch;

    if (!isMatch) {
      throw new IdempotencyConflictError(
        `Idempotency key '${idempotencyKey}' was already used with a different business payload`,
        {
          idempotencyKey,
          existingPayload: {
            walletId: meta.walletId,
            operationType: existingOp.operationType,
            amount: meta.amount,
            referenceType: existingOp.referenceType,
            referenceId: existingOp.referenceId,
            holdId: meta.holdId || null,
          },
          requestedPayload: expectedPayload,
        }
      );
    }
  }

  /**
   * Runs an operation within a Prisma PostgreSQL transaction, handling race conditions gracefully.
   *
   * @private
   * @param {Function} fn
   * @param {string} [idempotencyKey]
   * @param {Object} [expectedSummary]
   * @returns {Promise<*>}
   */
  /**
   * Runs an operation within a Prisma PostgreSQL transaction, handling race conditions gracefully.
   *
   * @private
   * @param {Function} fn
   * @param {string} [idempotencyKey]
   * @param {Object} [expectedSummary]
   * @param {number} [retryCount=0]
   * @returns {Promise<*>}
   */
  async _runInTransaction(fn, idempotencyKey = null, expectedSummary = {}, retryCount = 0) {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          return await fn(tx);
        },
        {
          isolationLevel: 'ReadCommitted',
          maxWait: 20000,
          timeout: 30000,
        }
      );
    } catch (err) {
      // 1. NEVER intercept domain errors thrown intentionally by business logic
      if (err instanceof WalletError) {
        throw err;
      }

      // 2. If idempotencyKey is provided, check if another concurrent thread committed the operation
      if (idempotencyKey) {
        const existingOp = await this.prisma.financialOperation.findUnique({
          where: { idempotencyKey },
          include: {
            ledgerEntries: true,
            holds: true,
          },
        });
        if (existingOp) {
          const meta = existingOp.metadata || {};
          let targetWalletId = expectedSummary.walletId;
          if (!targetWalletId && expectedSummary.userId) {
            const w = await this.prisma.wallet.findUnique({
              where: { userId: expectedSummary.userId },
            });
            targetWalletId = w ? w.id : null;
          }

          const fullExpected = {
            walletId: targetWalletId,
            amount: expectedSummary.amount,
            operationType: expectedSummary.operationType,
            referenceType: expectedSummary.referenceType || null,
            referenceId: expectedSummary.referenceId || null,
            holdId: expectedSummary.holdId || null,
          };

          this._verifyIdempotentOperation(existingOp, fullExpected, idempotencyKey);

          const wallet = await this.prisma.wallet.findUnique({
            where: { id: meta.walletId },
          });
          return {
            isIdempotentReplay: true,
            wallet: serializeWallet(wallet),
            operation: serializeOperation(existingOp),
            ledgerEntry: existingOp.ledgerEntries[0] ? serializeLedgerEntry(existingOp.ledgerEntries[0]) : null,
            hold: existingOp.holds[0] ? serializeHold(existingOp.holds[0]) : null,
          };
        }
      }

      // 3. Retry on transient transaction queue timeout (e.g. pool contention under heavy concurrency)
      if (
        retryCount < 3 &&
        (err.message?.includes('Unable to start a transaction in the given time') ||
          err.message?.includes('Transaction already closed'))
      ) {
        await new Promise((r) => setTimeout(r, 150 * (retryCount + 1)));
        return this._runInTransaction(fn, idempotencyKey, expectedSummary, retryCount + 1);
      }

      throw err;
    }
  }
}

export const walletService = new WalletService();
export default walletService;
