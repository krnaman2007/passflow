import { describe, expect, jest, test } from '@jest/globals';
import {
  calculateSettlementAmounts,
  SettlementInvariantError,
  TradeSettlementService,
} from '../../src/services/settlement/trade-settlement-service.js';
import { OrderService } from '../../src/services/order/order-service.js';
import { WalletService } from '../../src/services/wallet/wallet-service.js';

describe('TradeSettlement accounting', () => {
  test('preserves the specified partial-fill accounting progression', () => {
    const result = calculateSettlementAmounts({ limitPricePaise: 100, executionPricePaise: 90, quantity: 4 });
    expect(result.executionCost).toBe(360n);
    expect(result.buyerReservedConsumed).toBe(400n);
    expect(result.priceImprovement).toBe(40n);
    // Initial (10,000 available, 1,000 unrelated reserved), then reserve 1,000,
    // cancel six (release 600), settle the four-ticket execution.
    expect(9_600n + result.priceImprovement).toBe(9_640n);
    expect(1_400n - result.buyerReservedConsumed).toBe(1_000n);
    expect((9_640n + 1_000n) - (10_000n + 1_000n)).toBe(-result.executionCost);
  });

  test('has no price-improvement movement at the buyer limit', () => {
    expect(calculateSettlementAmounts({ limitPricePaise: 100, executionPricePaise: 100, quantity: 2 }))
      .toEqual({ executionCost: 200n, buyerReservedConsumed: 200n, priceImprovement: 0n });
  });

  test('uses exact integer arithmetic for independent executions at different resting prices', () => {
    const first = calculateSettlementAmounts({ limitPricePaise: 101, executionPricePaise: 99, quantity: 3 });
    const second = calculateSettlementAmounts({ limitPricePaise: 101, executionPricePaise: 100, quantity: 2 });
    expect(first.executionCost + second.executionCost).toBe(497n);
    expect(first.buyerReservedConsumed + second.buyerReservedConsumed).toBe(505n);
    expect(first.priceImprovement + second.priceImprovement).toBe(8n);
  });

  test('rejects non-integer amounts and executions above the buyer limit', () => {
    expect(() => calculateSettlementAmounts({ limitPricePaise: 100.5, executionPricePaise: 90, quantity: 1 }))
      .toThrow(SettlementInvariantError);
    expect(() => calculateSettlementAmounts({ limitPricePaise: 100, executionPricePaise: 101, quantity: 1 }))
      .toThrow('Execution price exceeds buyer limit');
  });

  test('rejects settlement amounts outside the supported BigInt boundary', () => {
    expect(() => calculateSettlementAmounts({
      limitPricePaise: Number.MAX_SAFE_INTEGER,
      executionPricePaise: 1,
      quantity: 2,
    })).toThrow('Settlement amount exceeds supported monetary boundary');
  });

  test('rejects a corrupted durable settlement on idempotent replay', async () => {
    const service = new TradeSettlementService({ prismaClient: {} });
    const tx = { walletHold: { findUnique: jest.fn() } };
    const amounts = calculateSettlementAmounts({ limitPricePaise: 100, executionPricePaise: 90, quantity: 4 });
    await expect(service._assertExistingSettlement(tx, {
      existing: {
        id: 'settlement-1', buyerOrderId: 'buy', sellerOrderId: 'sell', buyerHoldId: 'hold',
        quantity: 4, executionPricePaise: 90, executionCostPaise: 361n,
        buyerReservedConsumed: 400n, priceImprovementPaise: 40n,
      },
      execution: { id: 'execution-1', quantity: 4, price: 90 },
      buyerOrder: { id: 'buy' }, sellerOrder: { id: 'sell' }, amounts,
    })).rejects.toThrow('Existing settlement is inconsistent');
    expect(tx.walletHold.findUnique).not.toHaveBeenCalled();
  });

  test('re-dispatches persisted executions from an idempotent order replay', async () => {
    const settleExecution = jest.fn().mockResolvedValue({ isIdempotentReplay: true });
    const service = new OrderService({
      prismaClient: {}, walletService: {}, matchingService: {}, orderRepository: {},
      settlementService: { settleExecution },
    });
    await service._settleExecutions([{ id: 'execution-1' }, { id: 'execution-2' }]);
    expect(settleExecution).toHaveBeenNthCalledWith(1, { executionId: 'execution-1' });
    expect(settleExecution).toHaveBeenNthCalledWith(2, { executionId: 'execution-2' });
  });

  test('locks a linked order before its wallet while reserving funds', async () => {
    const lockQueries = [];
    const wallet = {
      id: 'wallet-1', userId: 'buyer-1', currency: 'INR', availableBalance: 1_000n,
      reservedBalance: 0n, version: 0n,
    };
    const tx = {
      $queryRaw: async (strings) => {
        const sql = strings.join('');
        lockQueries.push(sql);
        return sql.includes('"Order"') ? [{ id: 'order-1' }] : [wallet];
      },
      financialOperation: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'operation-1', idempotencyKey: 'reserve-1', operationType: 'ORDER_ESCROW', status: 'COMPLETED' }),
      },
      walletHold: { create: jest.fn().mockResolvedValue({ id: 'hold-1', walletId: 'wallet-1', orderId: 'order-1', reason: 'ORDER_ESCROW', status: 'ACTIVE', heldAmount: 100n, remainingAmount: 100n, idempotencyKey: 'reserve-1' }) },
      walletLedgerEntry: { create: jest.fn().mockResolvedValue({ id: 'ledger-1', walletId: 'wallet-1', amount: 100n, availableDelta: -100n, reservedDelta: 100n, balanceAfterAvailable: 900n, balanceAfterReserved: 100n, entryType: 'ORDER_HOLD' }) },
      wallet: { update: jest.fn().mockResolvedValue({ ...wallet, availableBalance: 900n, reservedBalance: 100n, version: 1n }) },
    };
    await new WalletService({ prismaClient: {} }).reserveFunds({
      walletId: 'wallet-1', amount: 100n, orderId: 'order-1', idempotencyKey: 'reserve-1',
    }, tx);
    expect(lockQueries[0]).toContain('"Order"');
    expect(lockQueries[1]).toContain('"Wallet"');
  });

  describe('Transient conflict detection and bounded retries', () => {
    test('correctly identifies transient PostgreSQL and Prisma concurrency errors', async () => {
      const { isTransientSettlementConflict } = await import('../../src/services/settlement/trade-settlement-service.js');

      expect(isTransientSettlementConflict({ code: 'P2034' })).toBe(true);
      expect(isTransientSettlementConflict({ message: 'could not serialize access due to concurrent update (40001)' })).toBe(true);
      expect(isTransientSettlementConflict({ message: 'deadlock detected (40P01)' })).toBe(true);

      expect(isTransientSettlementConflict(new SettlementInvariantError('Invalid state'))).toBe(false);
      expect(isTransientSettlementConflict({ name: 'SettlementInvariantError', message: 'error' })).toBe(false);
      expect(isTransientSettlementConflict({ code: 'P2002', message: 'Unique constraint failed' })).toBe(false);
      expect(isTransientSettlementConflict(null)).toBe(false);
    });

    test('retries transient conflicts and succeeds within attempt limit', async () => {
      let callCount = 0;
      const fakePrisma = {
        $transaction: jest.fn().mockImplementation(async (callback) => {
          callCount++;
          if (callCount < 3) {
            const err = new Error('could not serialize access due to concurrent update (40001)');
            throw err;
          }
          return { settlement: { id: 'settled-1' }, isIdempotentReplay: false };
        }),
      };

      const service = new TradeSettlementService({ prismaClient: fakePrisma });
      const result = await service.settleExecution({ executionId: 'exec-retry-1', maxAttempts: 5 });

      expect(callCount).toBe(3);
      expect(result.settlement.id).toBe('settled-1');
    });

    test('does not retry business invariant errors', async () => {
      let callCount = 0;
      const fakePrisma = {
        $transaction: jest.fn().mockImplementation(async () => {
          callCount++;
          throw new SettlementInvariantError('Seller has insufficient inventory');
        }),
      };

      const service = new TradeSettlementService({ prismaClient: fakePrisma });
      await expect(
        service.settleExecution({ executionId: 'exec-invariant-1', maxAttempts: 5 })
      ).rejects.toThrow(SettlementInvariantError);

      expect(callCount).toBe(1);
    });

    test('throws when maximum retry attempts are exhausted', async () => {
      let callCount = 0;
      const fakePrisma = {
        $transaction: jest.fn().mockImplementation(async () => {
          callCount++;
          throw new Error('could not serialize access due to concurrent update (40001)');
        }),
      };

      const service = new TradeSettlementService({ prismaClient: fakePrisma });
      await expect(
        service.settleExecution({ executionId: 'exec-exhaust-1', maxAttempts: 3 })
      ).rejects.toThrow(/could not serialize access/);

      expect(callCount).toBe(3);
    });
  });
});
