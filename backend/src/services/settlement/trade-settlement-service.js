/**
 * Durable execution settlement.  Matching only persists executions; this service
 * performs the financial and inventory effects in one PostgreSQL transaction.
 *
 * Lock order for resources held simultaneously is: Execution, Order (id ASC),
 * Wallet (id ASC), WalletHold, UserTicketInventory (userId ASC).  The execution
 * row is the durable claim: another worker blocks before it can inspect or make
 * a non-idempotent mutation, then observes the committed TradeSettlement.
 */
import crypto from 'node:crypto';
import { prisma as defaultPrisma } from '../../db/prisma.js';
import { MAX_PAISE } from '../wallet/wallet-service.js';

export class SettlementInvariantError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'SettlementInvariantError';
    this.code = 'SETTLEMENT_INVARIANT';
    this.details = details;
  }
}

/** Exact paise arithmetic shared by settlement and focused regression tests. */
export function calculateSettlementAmounts({ limitPricePaise, executionPricePaise, quantity }) {
  for (const [name, value] of Object.entries({ limitPricePaise, executionPricePaise, quantity })) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new SettlementInvariantError(`${name} must be a positive safe integer`);
    }
  }
  if (executionPricePaise > limitPricePaise) {
    throw new SettlementInvariantError('Execution price exceeds buyer limit');
  }
  const quantityBigInt = BigInt(quantity);
  const buyerReservedConsumed = BigInt(limitPricePaise) * quantityBigInt;
  const executionCost = BigInt(executionPricePaise) * quantityBigInt;
  if (buyerReservedConsumed > MAX_PAISE || executionCost > MAX_PAISE) {
    throw new SettlementInvariantError('Settlement amount exceeds supported monetary boundary');
  }
  return { executionCost, buyerReservedConsumed, priceImprovement: buyerReservedConsumed - executionCost };
}

export function isTransientSettlementConflict(error) {
  if (!error || typeof error !== 'object') return false;
  if (error instanceof SettlementInvariantError) return false;
  if (error.name === 'SettlementInvariantError') return false;

  // Prisma write conflict / serialization code
  if (error.code === 'P2034') return true;

  const msg = typeof error.message === 'string' ? error.message : '';
  // PostgreSQL SQLSTATE 40001 (serialization failure)
  if (msg.includes('40001') || msg.includes('could not serialize access')) return true;
  // PostgreSQL SQLSTATE 40P01 (deadlock detected)
  if (msg.includes('40P01') || msg.includes('deadlock detected')) return true;

  return false;
}

export class TradeSettlementService {
  constructor({ prismaClient = defaultPrisma } = {}) {
    this.prisma = prismaClient;
  }

  async settleExecution({ executionId, maxAttempts = 5 } = {}) {
    if (!executionId || typeof executionId !== 'string' || !executionId.trim()) {
      throw new SettlementInvariantError('executionId must be a non-empty string');
    }
    const cleanId = executionId.trim();
    const attemptsLimit = Number.isSafeInteger(maxAttempts) && maxAttempts > 0 ? maxAttempts : 5;

    let attempt = 0;
    while (attempt < attemptsLimit) {
      attempt++;
      try {
        return await this.prisma.$transaction((tx) => this._settle(tx, cleanId), {
          isolationLevel: 'Serializable',
          maxWait: 5000,
          timeout: 15000,
        });
      } catch (error) {
        if (!isTransientSettlementConflict(error) || attempt >= attemptsLimit) {
          throw error;
        }
        // Bounded exponential backoff with jitter: 20ms * 2^(attempt - 1), capped at 200ms
        const baseDelay = Math.min(200, 20 * (2 ** (attempt - 1)));
        const jitter = Math.floor(Math.random() * 15);
        await new Promise((resolve) => setTimeout(resolve, baseDelay + jitter));
      }
    }
  }

  async recoverUnsettled({ batchSize = 100 } = {}) {
    if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 500) {
      throw new SettlementInvariantError('batchSize must be an integer from 1 to 500');
    }
    const executions = await this.prisma.execution.findMany({
      where: { settlement: null },
      select: { id: true },
      orderBy: { sequenceNumber: 'asc' },
      take: batchSize,
    });
    const results = [];
    for (const execution of executions) {
      try {
        results.push(await this.settleExecution({ executionId: execution.id }));
      } catch (error) {
        // A later recovery pass retries only transient failures.  Integrity errors
        // are returned to the caller instead of being hidden or auto-compensated.
        results.push({ executionId: execution.id, settled: false, error });
      }
    }
    return results;
  }

  async _settle(tx, executionId) {
    const executionRows = await tx.$queryRaw`
      SELECT * FROM "Execution" WHERE id = ${executionId} FOR UPDATE
    `;
    if (!executionRows?.length) throw new SettlementInvariantError('Execution not found', { executionId });

    const execution = await tx.execution.findUnique({
      where: { id: executionId },
      include: { incomingOrder: true, restingOrder: true },
    });
    const orders = [execution.incomingOrder, execution.restingOrder];
    if (orders[0].side === orders[1].side) {
      throw new SettlementInvariantError('Execution does not join one BID and one ASK order', { executionId });
    }
    const buyerOrder = orders.find((order) => order.side === 'BID');
    const sellerOrder = orders.find((order) => order.side === 'ASK');
    if (buyerOrder.eventId !== sellerOrder.eventId || buyerOrder.ticketCategoryId !== sellerOrder.ticketCategoryId) {
      throw new SettlementInvariantError('Execution orders belong to different markets', { executionId });
    }
    if (execution.price > buyerOrder.price || execution.quantity <= 0 || execution.price <= 0) {
      throw new SettlementInvariantError('Execution violates buyer limit or has invalid value', { executionId });
    }
    const amounts = calculateSettlementAmounts({
      limitPricePaise: buyerOrder.price,
      executionPricePaise: execution.price,
      quantity: execution.quantity,
    });
    const existing = await tx.tradeSettlement.findUnique({ where: { executionId } });
    if (existing) {
      await this._assertExistingSettlement(tx, { existing, execution, buyerOrder, sellerOrder, amounts });
      return { settlement: existing, isIdempotentReplay: true };
    }

    for (const order of [...orders].sort((a, b) => a.id.localeCompare(b.id))) {
      await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${order.id} FOR UPDATE`;
    }

    const buyerWallet = await tx.wallet.findUnique({ where: { userId: buyerOrder.userId } });
    const sellerWallet = await tx.wallet.findUnique({ where: { userId: sellerOrder.userId } });
    if (!buyerWallet || !sellerWallet || buyerWallet.id === sellerWallet.id || buyerOrder.userId === sellerOrder.userId) {
      throw new SettlementInvariantError('Distinct buyer and seller wallets are required', { executionId });
    }
    const wallets = [buyerWallet, sellerWallet].sort((a, b) => a.id.localeCompare(b.id));
    const lockedWallets = new Map();
    for (const wallet of wallets) {
      const rows = await tx.$queryRaw`SELECT * FROM "Wallet" WHERE id = ${wallet.id} FOR UPDATE`;
      lockedWallets.set(wallet.id, rows[0]);
    }
    const lockedBuyerWallet = lockedWallets.get(buyerWallet.id);
    const lockedSellerWallet = lockedWallets.get(sellerWallet.id);

    const holdRows = await tx.$queryRaw`
      SELECT * FROM "WalletHold"
      WHERE "orderId" = ${buyerOrder.id} AND reason = 'ORDER_ESCROW'
      FOR UPDATE
    `;
    if (holdRows.length !== 1) {
      throw new SettlementInvariantError('Buy order must have exactly one linked escrow hold', { executionId, buyerOrderId: buyerOrder.id });
    }
    const hold = holdRows[0];
    if (hold.walletId !== buyerWallet.id || !['ACTIVE', 'PARTIALLY_RELEASED', 'PARTIALLY_SETTLED'].includes(hold.status)) {
      throw new SettlementInvariantError('Buy escrow hold is not active for this wallet', { executionId, holdId: hold.id });
    }

    const { executionCost: cost, buyerReservedConsumed: consumed, priceImprovement: improvement } = amounts;
    if (improvement < 0n || BigInt(hold.remainingAmount) < consumed || BigInt(lockedBuyerWallet.reservedBalance) < consumed) {
      throw new SettlementInvariantError('Insufficient buyer reservation for execution', { executionId });
    }

    const inventoryRows = new Map();
    const inventoryUsers = [buyerOrder.userId, sellerOrder.userId].sort();
    for (const userId of inventoryUsers) {
      if (userId === buyerOrder.userId) {
        await tx.$executeRaw`
          INSERT INTO "UserTicketInventory" ("id", "userId", "ticketCategoryId", "totalQuantity", "availableQuantity", "reservedQuantity", "createdAt", "updatedAt")
          VALUES (${crypto.randomUUID()}, ${userId}, ${buyerOrder.ticketCategoryId}, 0, 0, 0, NOW(), NOW())
          ON CONFLICT ("userId", "ticketCategoryId") DO NOTHING
        `;
      }
      const rows = await tx.$queryRaw`
        SELECT * FROM "UserTicketInventory"
        WHERE "userId" = ${userId} AND "ticketCategoryId" = ${buyerOrder.ticketCategoryId} FOR UPDATE
      `;
      inventoryRows.set(userId, rows[0]);
    }
    const sellerInventory = inventoryRows.get(sellerOrder.userId);
    if (!sellerInventory || sellerInventory.reservedQuantity < execution.quantity || sellerInventory.totalQuantity < execution.quantity) {
      throw new SettlementInvariantError('Seller has insufficient reserved inventory', { executionId });
    }

    const buyerAvailable = BigInt(lockedBuyerWallet.availableBalance) + improvement;
    const buyerReserved = BigInt(lockedBuyerWallet.reservedBalance) - consumed;
    const sellerAvailable = BigInt(lockedSellerWallet.availableBalance) + cost;
    const buyerHoldRemaining = BigInt(hold.remainingAmount) - consumed;
    const holdStatus = buyerHoldRemaining === 0n ? 'SETTLED' : 'PARTIALLY_SETTLED';
    const prefix = `settlement:${executionId}`;

    const debitOp = await tx.financialOperation.create({ data: { idempotencyKey: `${prefix}:debit`, operationType: 'TRADE_SETTLEMENT', status: 'COMPLETED', referenceType: 'EXECUTION', referenceId: executionId } });
    await tx.walletLedgerEntry.create({ data: { walletId: buyerWallet.id, operationId: debitOp.id, holdId: hold.id, orderId: buyerOrder.id, executionId, entryType: 'TRADE_SETTLEMENT_DEBIT', amount: cost, availableDelta: improvement, reservedDelta: -consumed, balanceAfterAvailable: buyerAvailable, balanceAfterReserved: buyerReserved, idempotencyKey: `${prefix}:debit`, description: 'Execution settlement debit and price improvement release' } });
    const creditOp = await tx.financialOperation.create({ data: { idempotencyKey: `${prefix}:credit`, operationType: 'TRADE_SETTLEMENT', status: 'COMPLETED', referenceType: 'EXECUTION', referenceId: executionId } });
    await tx.walletLedgerEntry.create({ data: { walletId: sellerWallet.id, operationId: creditOp.id, orderId: sellerOrder.id, executionId, entryType: 'TRADE_SETTLEMENT_CREDIT', amount: cost, availableDelta: cost, reservedDelta: 0n, balanceAfterAvailable: sellerAvailable, balanceAfterReserved: BigInt(lockedSellerWallet.reservedBalance), idempotencyKey: `${prefix}:credit`, description: 'Execution settlement seller credit' } });
    await tx.wallet.update({ where: { id: buyerWallet.id }, data: { availableBalance: buyerAvailable, reservedBalance: buyerReserved, version: BigInt(lockedBuyerWallet.version) + 1n } });
    await tx.wallet.update({ where: { id: sellerWallet.id }, data: { availableBalance: sellerAvailable, version: BigInt(lockedSellerWallet.version) + 1n } });
    await tx.walletHold.update({ where: { id: hold.id }, data: { remainingAmount: buyerHoldRemaining, status: holdStatus } });
    await tx.userTicketInventory.update({ where: { userId_ticketCategoryId: { userId: sellerOrder.userId, ticketCategoryId: buyerOrder.ticketCategoryId } }, data: { totalQuantity: { decrement: execution.quantity }, reservedQuantity: { decrement: execution.quantity } } });
    await tx.userTicketInventory.update({ where: { userId_ticketCategoryId: { userId: buyerOrder.userId, ticketCategoryId: buyerOrder.ticketCategoryId } }, data: { totalQuantity: { increment: execution.quantity }, availableQuantity: { increment: execution.quantity } } });
    const settlement = await tx.tradeSettlement.create({ data: { executionId, buyerOrderId: buyerOrder.id, sellerOrderId: sellerOrder.id, buyerHoldId: hold.id, quantity: execution.quantity, executionPricePaise: execution.price, executionCostPaise: cost, buyerReservedConsumed: consumed, priceImprovementPaise: improvement } });
    return { settlement, isIdempotentReplay: false };
  }

  async _assertExistingSettlement(tx, { existing, execution, buyerOrder, sellerOrder, amounts }) {
    const valid =
      existing.buyerOrderId === buyerOrder.id &&
      existing.sellerOrderId === sellerOrder.id &&
      existing.quantity === execution.quantity &&
      existing.executionPricePaise === execution.price &&
      BigInt(existing.executionCostPaise) === amounts.executionCost &&
      BigInt(existing.buyerReservedConsumed) === amounts.buyerReservedConsumed &&
      BigInt(existing.priceImprovementPaise) === amounts.priceImprovement;
    const hold = valid
      ? await tx.walletHold.findUnique({ where: { id: existing.buyerHoldId } })
      : null;
    if (!valid || !hold || hold.orderId !== buyerOrder.id) {
      throw new SettlementInvariantError('Existing settlement is inconsistent with its execution', {
        executionId: execution.id,
        settlementId: existing.id,
      });
    }
  }
}

export const tradeSettlementService = new TradeSettlementService();
export default tradeSettlementService;
