import { describe, expect, jest, test } from '@jest/globals';
import {
  calculateSettlementAmounts,
  SettlementInvariantError,
  TradeSettlementService,
} from '../../src/services/settlement/trade-settlement-service.js';
import { OrderService } from '../../src/services/order/order-service.js';

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
});
