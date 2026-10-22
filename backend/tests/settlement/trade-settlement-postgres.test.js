/**
 * Step 9.4I — Isolated PostgreSQL Regression Tests for Settlement Deadlock & Serialization Retry
 *
 * Real PostgreSQL integration tests against isolated disposable database (127.0.0.1:55432):
 * 1. Two concurrent settlement attempts for the same execution produce exactly one settlement via built-in bounded retries.
 * 2. Replaying a settled execution idempotently returns isIdempotentReplay: true with zero duplicate ledger rows.
 * 3. Atomic rollback on partial failure (insufficient inventory) leaves zero persistent mutations.
 * 4. Cross-market settlements with overlapping wallets serialize cleanly without circular deadlock.
 * 5. Concurrent cancellation hold release vs settlement: lock-order inversion is eliminated (both acquire Order -> Wallet -> Hold), preventing 40P01 deadlock.
 * 6. Execution/order foreign keys with ON DELETE RESTRICT prevent deletion of referenced history.
 * 7. Ledger immutability triggers (UPDATE/DELETE/TRUNCATE) and check constraints enforced by database.
 * 8. Exact Step 9.4E documented price-improvement accounting scenario matches persisted database rows.
 * 9. Retry exhaustion handling: when maxAttempts is exceeded, controlled failure is returned and zero partial mutations commit.
 * 10. Re-running cancellation and settlement idempotently after concurrent execution preserves state.
 */

import { describe, expect, beforeAll, afterAll, test, jest } from '@jest/globals';
import crypto from 'node:crypto';
import { prisma as livePrisma } from '../../src/db/prisma.js';
import {
  TradeSettlementService,
  SettlementInvariantError,
} from '../../src/services/settlement/trade-settlement-service.js';
import { SettlementRecoveryWorker } from '../../src/services/settlement/settlement-recovery-worker.js';
import { WalletService } from '../../src/services/wallet/index.js';

describe('Step 9.4I — Trade Settlement Deadlock & Serialization Retry Integration Tests', () => {
  jest.setTimeout(120000);

  const testRunId = Math.random().toString(36).substring(2, 9);
  const settlementService = new TradeSettlementService({ prismaClient: livePrisma });
  const walletService = new WalletService({ prismaClient: livePrisma });

  let testEvent;
  let testCategory;
  let testEvent2;
  let testCategory2;

  beforeAll(async () => {
    // Verify connection to the isolated PostgreSQL database
    const [dbInfo] = await livePrisma.$queryRaw`
      SELECT current_database(), current_user, inet_server_addr()::text, inet_server_port()
    `;
    expect(dbInfo.current_database).toBe('passflow_isolated_validation');
    expect(dbInfo.inet_server_port).toBe(55432);

    // Create base organizer and events
    const organizerUser = await livePrisma.user.create({
      data: {
        email: `org-${testRunId}@test.passflow.com`,
        passwordHash: 'dummy-hash',
        name: 'Test Organizer',
      },
    });

    const organizer = await livePrisma.organizer.create({
      data: {
        userId: organizerUser.id,
        organizationName: `Test Org ${testRunId}`,
      },
    });

    testEvent = await livePrisma.event.create({
      data: {
        organizerId: organizer.id,
        name: `Settlement Event 1 ${testRunId}`,
        dateTime: new Date(Date.now() + 86400000 * 5),
        location: 'Mumbai Tech Park',
      },
    });

    testCategory = await livePrisma.ticketCategory.create({
      data: {
        eventId: testEvent.id,
        name: 'General Admission',
        originalPrice: 100.0,
        totalQuantity: 1000,
        availableQuantity: 1000,
      },
    });

    testEvent2 = await livePrisma.event.create({
      data: {
        organizerId: organizer.id,
        name: `Settlement Event 2 ${testRunId}`,
        dateTime: new Date(Date.now() + 86400000 * 6),
        location: 'Bengaluru Tech Arena',
      },
    });

    testCategory2 = await livePrisma.ticketCategory.create({
      data: {
        eventId: testEvent2.id,
        name: 'VIP Category',
        originalPrice: 200.0,
        totalQuantity: 500,
        availableQuantity: 500,
      },
    });
  });

  afterAll(async () => {
    await livePrisma.$disconnect();
  });

  /**
   * Helper: create user with wallet and specified balances
   */
  async function createUserWithWallet(tag, availablePaise = 0n, reservedPaise = 0n) {
    const id = crypto.randomUUID();
    const user = await livePrisma.user.create({
      data: {
        id,
        email: `${tag}-${id.substring(0, 8)}@test.passflow.com`,
        passwordHash: 'dummy-hash',
        name: `${tag} User`,
      },
    });

    const wallet = await livePrisma.wallet.create({
      data: {
        userId: user.id,
        availableBalance: availablePaise,
        reservedBalance: reservedPaise,
        version: 0n,
      },
    });

    return { user, wallet };
  }

  /**
   * Helper: seed a matched trade ready for settlement
   */
  async function seedMatchedTrade({
    buyer,
    seller,
    category,
    event,
    buyerLimitPrice,
    sellerAskPrice,
    executionPrice,
    quantity,
    sellerReservedInventory = quantity,
  }) {
    const buyerHoldPaise = BigInt(buyerLimitPrice) * BigInt(quantity);

    // Create buy order
    const buyOrder = await livePrisma.order.create({
      data: {
        userId: buyer.user.id,
        eventId: event.id,
        ticketCategoryId: category.id,
        side: 'BID',
        price: buyerLimitPrice,
        initialQuantity: quantity,
        remainingQuantity: 0,
        status: 'FILLED',
        idempotencyKey: `buy-order-${crypto.randomUUID()}`,
      },
    });

    // Create sell order
    const sellOrder = await livePrisma.order.create({
      data: {
        userId: seller.user.id,
        eventId: event.id,
        ticketCategoryId: category.id,
        side: 'ASK',
        price: sellerAskPrice,
        initialQuantity: quantity,
        remainingQuantity: 0,
        status: 'FILLED',
        idempotencyKey: `sell-order-${crypto.randomUUID()}`,
      },
    });

    // Create wallet hold linked to buy order
    const buyerHold = await livePrisma.walletHold.create({
      data: {
        walletId: buyer.wallet.id,
        orderId: buyOrder.id,
        reason: 'ORDER_ESCROW',
        status: 'ACTIVE',
        heldAmount: buyerHoldPaise,
        remainingAmount: buyerHoldPaise,
        idempotencyKey: `hold-${crypto.randomUUID()}`,
      },
    });

    // Seed seller inventory
    await livePrisma.userTicketInventory.upsert({
      where: {
        userId_ticketCategoryId: {
          userId: seller.user.id,
          ticketCategoryId: category.id,
        },
      },
      update: {
        totalQuantity: sellerReservedInventory,
        reservedQuantity: sellerReservedInventory,
        availableQuantity: 0,
      },
      create: {
        userId: seller.user.id,
        ticketCategoryId: category.id,
        totalQuantity: sellerReservedInventory,
        reservedQuantity: sellerReservedInventory,
        availableQuantity: 0,
      },
    });

    // Create Execution record
    const execution = await livePrisma.execution.create({
      data: {
        incomingOrderId: buyOrder.id,
        restingOrderId: sellOrder.id,
        price: executionPrice,
        quantity,
      },
    });

    return { buyOrder, sellOrder, buyerHold, execution };
  }

  // --------------------------------------------------------------------------
  // 1. Concurrent Settlement with Built-in Retries
  // --------------------------------------------------------------------------
  test('1. Two concurrent settlement attempts for the same execution produce exactly one financial settlement via built-in retries', async () => {
    const buyer = await createUserWithWallet('conc-buy', 10000n, 400n);
    const seller = await createUserWithWallet('conc-sell', 5000n, 0n);

    const { execution } = await seedMatchedTrade({
      buyer,
      seller,
      category: testCategory,
      event: testEvent,
      buyerLimitPrice: 100,
      sellerAskPrice: 90,
      executionPrice: 90,
      quantity: 4,
    });

    // Launch two settlement attempts concurrently using native settleExecution (no external retry helper!)
    const [result1, result2] = await Promise.all([
      settlementService.settleExecution({ executionId: execution.id }),
      settlementService.settleExecution({ executionId: execution.id }),
    ]);

    // One attempt must be authoritative; the other an idempotent replay caught by retry
    const settlements = [result1, result2];
    const initialSettlement = settlements.find((r) => r.isIdempotentReplay === false);
    const replaySettlement = settlements.find((r) => r.isIdempotentReplay === true);

    expect(initialSettlement).toBeDefined();
    expect(replaySettlement).toBeDefined();
    expect(initialSettlement.settlement.id).toBe(replaySettlement.settlement.id);

    // Verify exactly ONE TradeSettlement row persisted in PostgreSQL
    const persistedSettlements = await livePrisma.tradeSettlement.findMany({
      where: { executionId: execution.id },
    });
    expect(persistedSettlements.length).toBe(1);
    expect(persistedSettlements[0].executionCostPaise).toBe(360n);
    expect(persistedSettlements[0].buyerReservedConsumed).toBe(400n);
    expect(persistedSettlements[0].priceImprovementPaise).toBe(40n);

    // Verify exactly TWO ledger entries (1 debit, 1 credit) in the entire database
    const ledgerEntries = await livePrisma.walletLedgerEntry.findMany({
      where: { executionId: execution.id },
    });
    expect(ledgerEntries.length).toBe(2);

    const debitEntry = ledgerEntries.find((e) => e.entryType === 'TRADE_SETTLEMENT_DEBIT');
    const creditEntry = ledgerEntries.find((e) => e.entryType === 'TRADE_SETTLEMENT_CREDIT');

    expect(debitEntry.walletId).toBe(buyer.wallet.id);
    expect(debitEntry.amount).toBe(360n);
    expect(debitEntry.availableDelta).toBe(40n);
    expect(debitEntry.reservedDelta).toBe(-400n);

    expect(creditEntry.walletId).toBe(seller.wallet.id);
    expect(creditEntry.amount).toBe(360n);
    expect(creditEntry.availableDelta).toBe(360n);
    expect(creditEntry.reservedDelta).toBe(0n);

    // Verify inventory moved exactly once (4 tickets)
    const buyerInv = await livePrisma.userTicketInventory.findUnique({
      where: {
        userId_ticketCategoryId: {
          userId: buyer.user.id,
          ticketCategoryId: testCategory.id,
        },
      },
    });
    expect(buyerInv.totalQuantity).toBe(4);
    expect(buyerInv.availableQuantity).toBe(4);

    const sellerInv = await livePrisma.userTicketInventory.findUnique({
      where: {
        userId_ticketCategoryId: {
          userId: seller.user.id,
          ticketCategoryId: testCategory.id,
        },
      },
    });
    expect(sellerInv.totalQuantity).toBe(0);
    expect(sellerInv.reservedQuantity).toBe(0);
  });

  // --------------------------------------------------------------------------
  // 2. Replaying a Settled Execution
  // --------------------------------------------------------------------------
  test('2. Replaying a settled execution does not duplicate ledger entries or inventory transfers', async () => {
    const buyer = await createUserWithWallet('replay-buy', 5000n, 200n);
    const seller = await createUserWithWallet('replay-sell', 1000n, 0n);

    const { execution } = await seedMatchedTrade({
      buyer,
      seller,
      category: testCategory,
      event: testEvent,
      buyerLimitPrice: 100,
      sellerAskPrice: 100,
      executionPrice: 100,
      quantity: 2,
    });

    // 1st call: initial settlement
    const firstCall = await settlementService.settleExecution({ executionId: execution.id });
    expect(firstCall.isIdempotentReplay).toBe(false);

    // 2nd call: sequential replay
    const secondCall = await settlementService.settleExecution({ executionId: execution.id });
    expect(secondCall.isIdempotentReplay).toBe(true);
    expect(secondCall.settlement.id).toBe(firstCall.settlement.id);

    // 3rd call: repeated replay
    const thirdCall = await settlementService.settleExecution({ executionId: execution.id });
    expect(thirdCall.isIdempotentReplay).toBe(true);

    // Ensure ledger entry count is still exactly 2
    const ledgerCount = await livePrisma.walletLedgerEntry.count({
      where: { executionId: execution.id },
    });
    expect(ledgerCount).toBe(2);

    // Ensure seller balance increased by only 200n (1000n -> 1200n), never double credited
    const finalSellerWallet = await livePrisma.wallet.findUnique({ where: { id: seller.wallet.id } });
    expect(finalSellerWallet.availableBalance).toBe(1200n);
  });

  // --------------------------------------------------------------------------
  // 3. Rollback on Failure Partway Through Settlement
  // --------------------------------------------------------------------------
  test('3. A failure partway through settlement rolls back every database change', async () => {
    const buyer = await createUserWithWallet('fail-buy', 10000n, 500n);
    const seller = await createUserWithWallet('fail-sell', 5000n, 0n);

    // Intentionally configure seller with INSUFFICIENT reserved inventory (1 ticket instead of 5)
    const { execution, buyerHold } = await seedMatchedTrade({
      buyer,
      seller,
      category: testCategory,
      event: testEvent,
      buyerLimitPrice: 100,
      sellerAskPrice: 90,
      executionPrice: 90,
      quantity: 5,
      sellerReservedInventory: 1, // Insufficient!
    });

    await expect(
      settlementService.settleExecution({ executionId: execution.id })
    ).rejects.toThrow(SettlementInvariantError);

    // Invariants verified in PostgreSQL: ZERO persistent side effects
    const settlements = await livePrisma.tradeSettlement.findMany({ where: { executionId: execution.id } });
    expect(settlements.length).toBe(0);

    const ledgerEntries = await livePrisma.walletLedgerEntry.findMany({ where: { executionId: execution.id } });
    expect(ledgerEntries.length).toBe(0);

    const unmutatedHold = await livePrisma.walletHold.findUnique({ where: { id: buyerHold.id } });
    expect(unmutatedHold.remainingAmount).toBe(500n);
    expect(unmutatedHold.status).toBe('ACTIVE');

    const unmutatedBuyerWallet = await livePrisma.wallet.findUnique({ where: { id: buyer.wallet.id } });
    expect(unmutatedBuyerWallet.availableBalance).toBe(10000n);
    expect(unmutatedBuyerWallet.reservedBalance).toBe(500n);

    const unmutatedSellerInv = await livePrisma.userTicketInventory.findUnique({
      where: { userId_ticketCategoryId: { userId: seller.user.id, ticketCategoryId: testCategory.id } },
    });
    expect(unmutatedSellerInv.reservedQuantity).toBe(1);
  });

  // --------------------------------------------------------------------------
  // 4. Cross-Market Settlements with Overlapping Wallets
  // --------------------------------------------------------------------------
  test('4. Cross-market transactions involving overlapping wallets serialize cleanly without circular deadlock', async () => {
    // User A and User B participate simultaneously in opposite roles in two different markets
    const userA = await createUserWithWallet('cross-A', 20000n, 500n);
    const userB = await createUserWithWallet('cross-B', 20000n, 800n);

    // Market 1: User A is Buyer, User B is Seller (quantity 5 at 100 paise)
    const trade1 = await seedMatchedTrade({
      buyer: userA,
      seller: userB,
      category: testCategory,
      event: testEvent,
      buyerLimitPrice: 100,
      sellerAskPrice: 100,
      executionPrice: 100,
      quantity: 5,
    });

    // Market 2: User B is Buyer, User A is Seller (quantity 4 at 200 paise)
    const trade2 = await seedMatchedTrade({
      buyer: userB,
      seller: userA,
      category: testCategory2,
      event: testEvent2,
      buyerLimitPrice: 200,
      sellerAskPrice: 200,
      executionPrice: 200,
      quantity: 4,
    });

    // Execute concurrent settlements across markets with overlapping wallets
    const results = await Promise.all([
      settlementService.settleExecution({ executionId: trade1.execution.id }),
      settlementService.settleExecution({ executionId: trade2.execution.id }),
    ]);

    expect(results[0].isIdempotentReplay).toBe(false);
    expect(results[1].isIdempotentReplay).toBe(false);

    // Both settlements must exist
    const settlement1 = await livePrisma.tradeSettlement.findUnique({ where: { executionId: trade1.execution.id } });
    const settlement2 = await livePrisma.tradeSettlement.findUnique({ where: { executionId: trade2.execution.id } });
    expect(settlement1).not.toBeNull();
    expect(settlement2).not.toBeNull();

    // Verify User A wallet:
    // Initial: 20,000 available, 500 reserved.
    // Market 1 debit: -500 reserved.
    // Market 2 credit: +800 available.
    // Final: 20,800 available, 0 reserved.
    const walletA = await livePrisma.wallet.findUnique({ where: { id: userA.wallet.id } });
    expect(walletA.availableBalance).toBe(20800n);
    expect(walletA.reservedBalance).toBe(0n);

    // Verify User B wallet:
    // Initial: 20,000 available, 800 reserved.
    // Market 2 debit: -800 reserved.
    // Market 1 credit: +500 available.
    // Final: 20,500 available, 0 reserved.
    const walletB = await livePrisma.wallet.findUnique({ where: { id: userB.wallet.id } });
    expect(walletB.availableBalance).toBe(20500n);
    expect(walletB.reservedBalance).toBe(0n);
  });

  // --------------------------------------------------------------------------
  // 5. Settlement and Cancellation Races (Lock Inversion 40P01 Elimination)
  // --------------------------------------------------------------------------
  test('5. Settlement and cancellation races acquire locks in uniform hierarchy without 40P01 deadlock', async () => {
    const buyer = await createUserWithWallet('race-buy', 10000n, 1000n);
    const seller = await createUserWithWallet('race-sell', 5000n, 0n);

    // Initial buy order for 10 tickets at 100 paise (1,000 paise held)
    // 4 tickets execute at 90 paise.
    const buyerHold = await livePrisma.walletHold.create({
      data: {
        walletId: buyer.wallet.id,
        reason: 'ORDER_ESCROW',
        status: 'ACTIVE',
        heldAmount: 1000n,
        remainingAmount: 1000n,
        idempotencyKey: `race-hold-${crypto.randomUUID()}`,
      },
    });

    const buyOrder = await livePrisma.order.create({
      data: {
        userId: buyer.user.id,
        eventId: testEvent.id,
        ticketCategoryId: testCategory.id,
        side: 'BID',
        price: 100,
        initialQuantity: 10,
        remainingQuantity: 6,
        status: 'PARTIALLY_FILLED',
        idempotencyKey: `race-buy-order-${crypto.randomUUID()}`,
      },
    });

    await livePrisma.walletHold.update({
      where: { id: buyerHold.id },
      data: { orderId: buyOrder.id },
    });

    const sellOrder = await livePrisma.order.create({
      data: {
        userId: seller.user.id,
        eventId: testEvent.id,
        ticketCategoryId: testCategory.id,
        side: 'ASK',
        price: 90,
        initialQuantity: 4,
        remainingQuantity: 0,
        status: 'FILLED',
        idempotencyKey: `race-sell-order-${crypto.randomUUID()}`,
      },
    });

    await livePrisma.userTicketInventory.create({
      data: {
        userId: seller.user.id,
        ticketCategoryId: testCategory.id,
        totalQuantity: 4,
        reservedQuantity: 4,
        availableQuantity: 0,
      },
    });

    const execution = await livePrisma.execution.create({
      data: {
        incomingOrderId: buyOrder.id,
        restingOrderId: sellOrder.id,
        price: 90,
        quantity: 4,
      },
    });

    // Concurrently trigger cancellation release of 600 paise and settlement of the 4 tickets.
    // Because releaseHold now locks Order BEFORE Wallet (matching settlement's hierarchy),
    // no cyclical wait can form. Both resolve cleanly without 40P01 deadlock!
    const cancelOperation = walletService.releaseHold({
      holdId: buyerHold.id,
      amount: 600n,
      idempotencyKey: `race-cancel-${crypto.randomUUID()}`,
      referenceType: 'ORDER',
      referenceId: buyOrder.id,
      description: 'Cancellation release of unfilled 6 tickets',
    });

    const settlementOperation = settlementService.settleExecution({ executionId: execution.id });

    // Must resolve successfully without deadlock
    await Promise.all([cancelOperation, settlementOperation]);

    // Check invariants after both commit:
    const finalHold = await livePrisma.walletHold.findUnique({ where: { id: buyerHold.id } });
    expect(finalHold.remainingAmount).toBe(0n);
    expect(finalHold.status).toBe('SETTLED');

    const finalBuyerWallet = await livePrisma.wallet.findUnique({ where: { id: buyer.wallet.id } });
    // Started with: 10,000 available, 1,000 reserved (total 11,000)
    // Cancellation released 600 reserved -> available (available: 10,600, reserved: 400)
    // Settlement consumed 400 reserved, refunded 40 price improvement (available: 10,640, reserved: 0)
    // Net total balance change: 11,000 - 360 = 10,640.
    expect(finalBuyerWallet.availableBalance).toBe(10640n);
    expect(finalBuyerWallet.reservedBalance).toBe(0n);
  });

  // --------------------------------------------------------------------------
  // 6. Execution/Order Foreign Keys Prevent History Deletion
  // --------------------------------------------------------------------------
  test('6. Execution/order foreign keys prevent deletion of referenced execution history', async () => {
    const buyer = await createUserWithWallet('fk-buy', 5000n, 200n);
    const seller = await createUserWithWallet('fk-sell', 5000n, 0n);

    const { execution, buyOrder } = await seedMatchedTrade({
      buyer,
      seller,
      category: testCategory,
      event: testEvent,
      buyerLimitPrice: 100,
      sellerAskPrice: 100,
      executionPrice: 100,
      quantity: 2,
    });

    // Attempting to delete the Order while an Execution references it MUST fail
    await expect(
      livePrisma.order.delete({ where: { id: buyOrder.id } })
    ).rejects.toThrow();

    // Settle the execution to create TradeSettlement and WalletLedgerEntry linkages
    await settlementService.settleExecution({ executionId: execution.id });

    // Attempting to delete the Execution while TradeSettlement or WalletLedgerEntry references it MUST fail
    await expect(
      livePrisma.execution.delete({ where: { id: execution.id } })
    ).rejects.toThrow();
  });

  // --------------------------------------------------------------------------
  // 7. Ledger Immutability Triggers and Balance/Inventory CHECK Constraints
  // --------------------------------------------------------------------------
  test('7. Ledger UPDATE/DELETE/TRUNCATE protections and balance constraints behave as expected', async () => {
    const buyer = await createUserWithWallet('immut-buy', 5000n, 200n);
    const seller = await createUserWithWallet('immut-sell', 5000n, 0n);

    const { execution } = await seedMatchedTrade({
      buyer,
      seller,
      category: testCategory,
      event: testEvent,
      buyerLimitPrice: 100,
      sellerAskPrice: 100,
      executionPrice: 100,
      quantity: 2,
    });

    await settlementService.settleExecution({ executionId: execution.id });

    const [entry] = await livePrisma.walletLedgerEntry.findMany({
      where: { executionId: execution.id },
      take: 1,
    });

    // 1. Direct UPDATE on ledger entry must be blocked by trigger
    await expect(
      livePrisma.$executeRaw`UPDATE "WalletLedgerEntry" SET amount = 9999 WHERE id = ${entry.id}`
    ).rejects.toThrow(/WalletLedgerEntry.*immutable/);

    // 2. Direct DELETE on ledger entry must be blocked by trigger
    await expect(
      livePrisma.$executeRaw`DELETE FROM "WalletLedgerEntry" WHERE id = ${entry.id}`
    ).rejects.toThrow(/WalletLedgerEntry.*immutable/);

    // 3. TRUNCATE on WalletLedgerEntry must be blocked by trigger
    await expect(
      livePrisma.$executeRaw`TRUNCATE TABLE "WalletLedgerEntry"`
    ).rejects.toThrow(/WalletLedgerEntry.*immutable/);

    // 4. Negative availableBalance check constraint
    await expect(
      livePrisma.$executeRaw`UPDATE "Wallet" SET "availableBalance" = -1 WHERE id = ${buyer.wallet.id}`
    ).rejects.toThrow(/wallet_available_balance_non_negative/);

    // 5. Negative reservedBalance check constraint
    await expect(
      livePrisma.$executeRaw`UPDATE "Wallet" SET "reservedBalance" = -1 WHERE id = ${buyer.wallet.id}`
    ).rejects.toThrow(/wallet_reserved_balance_non_negative/);

    // 6. Inventory conservation check constraint: (available + reserved <= total)
    const inv = await livePrisma.userTicketInventory.findFirst({
      where: { userId: seller.user.id },
    });
    if (inv) {
      await expect(
        livePrisma.$executeRaw`
          UPDATE "UserTicketInventory"
          SET "availableQuantity" = 5, "reservedQuantity" = 5, "totalQuantity" = 8
          WHERE id = ${inv.id}
        `
      ).rejects.toThrow(/check_user_ticket_inventory_conservation/);
    }
  });

  // --------------------------------------------------------------------------
  // 8. Documented Partial-Fill, Cancellation, and Price-Improvement Scenario
  // --------------------------------------------------------------------------
  test('8. The documented partial-fill, cancellation, and price-improvement accounting scenario matches actual persisted rows', async () => {
    // Step 9.4E exact scenario:
    // Initial available balance: 10,000 paise
    // Initial reserved balance: 1,000 paise (from prior unrelated activity)
    // Total wallet balance: 11,000 paise
    const buyer = await createUserWithWallet('scenario-buy', 10000n, 1000n);
    const seller = await createUserWithWallet('scenario-sell', 5000n, 0n);

    // 1. Initial reservation: buy order 10 tickets at 100 paise each -> 1,000 paise held
    const holdPaise = 1000n;
    const hold = await livePrisma.walletHold.create({
      data: {
        walletId: buyer.wallet.id,
        reason: 'ORDER_ESCROW',
        status: 'ACTIVE',
        heldAmount: holdPaise,
        remainingAmount: holdPaise,
        idempotencyKey: `scenario-hold-${crypto.randomUUID()}`,
      },
    });

    // Update buyer wallet balances to reflect hold creation
    await livePrisma.wallet.update({
      where: { id: buyer.wallet.id },
      data: {
        availableBalance: 9000n,
        reservedBalance: 2000n, // 1000 prior + 1000 hold
      },
    });

    const buyOrder = await livePrisma.order.create({
      data: {
        userId: buyer.user.id,
        eventId: testEvent.id,
        ticketCategoryId: testCategory.id,
        side: 'BID',
        price: 100,
        initialQuantity: 10,
        remainingQuantity: 6, // 4 executed
        status: 'PARTIALLY_FILLED',
        idempotencyKey: `scenario-buy-${crypto.randomUUID()}`,
      },
    });

    await livePrisma.walletHold.update({
      where: { id: hold.id },
      data: { orderId: buyOrder.id },
    });

    const sellOrder = await livePrisma.order.create({
      data: {
        userId: seller.user.id,
        eventId: testEvent.id,
        ticketCategoryId: testCategory.id,
        side: 'ASK',
        price: 90,
        initialQuantity: 4,
        remainingQuantity: 0,
        status: 'FILLED',
        idempotencyKey: `scenario-sell-${crypto.randomUUID()}`,
      },
    });

    await livePrisma.userTicketInventory.create({
      data: {
        userId: seller.user.id,
        ticketCategoryId: testCategory.id,
        totalQuantity: 4,
        reservedQuantity: 4,
        availableQuantity: 0,
      },
    });

    // Four tickets execute at 90 paise each
    const execution = await livePrisma.execution.create({
      data: {
        incomingOrderId: buyOrder.id,
        restingOrderId: sellOrder.id,
        price: 90,
        quantity: 4,
      },
    });

    // 2. Cancellation of six unfilled tickets before settlement
    // Release 6 * 100 = 600 paise
    await walletService.releaseHold({
      holdId: hold.id,
      amount: 600n,
      idempotencyKey: `scenario-cancel-${crypto.randomUUID()}`,
      referenceType: 'ORDER',
      referenceId: buyOrder.id,
      description: 'Cancellation release of 6 unfilled tickets',
    });

    // Inspect intermediate state before settlement:
    const preHold = await livePrisma.walletHold.findUnique({ where: { id: hold.id } });
    expect(preHold.remainingAmount).toBe(400n);
    expect(preHold.status).toBe('PARTIALLY_RELEASED');

    const preBuyerWallet = await livePrisma.wallet.findUnique({ where: { id: buyer.wallet.id } });
    expect(preBuyerWallet.availableBalance).toBe(9600n);
    expect(preBuyerWallet.reservedBalance).toBe(1400n); // 1000 unrelated + 400 hold remaining
    expect(preBuyerWallet.availableBalance + preBuyerWallet.reservedBalance).toBe(11000n);

    // 3. Settle the execution for the 4 tickets
    const settlementResult = await settlementService.settleExecution({ executionId: execution.id });
    expect(settlementResult.isIdempotentReplay).toBe(false);

    // 4. Verify exact persisted database rows:
    // a. TradeSettlement table
    const settlementRow = await livePrisma.tradeSettlement.findUnique({
      where: { executionId: execution.id },
    });
    expect(settlementRow.quantity).toBe(4);
    expect(settlementRow.executionPricePaise).toBe(90);
    expect(settlementRow.executionCostPaise).toBe(360n);
    expect(settlementRow.buyerReservedConsumed).toBe(400n);
    expect(settlementRow.priceImprovementPaise).toBe(40n);

    // b. WalletHold row: completely settled
    const postHold = await livePrisma.walletHold.findUnique({ where: { id: hold.id } });
    expect(postHold.remainingAmount).toBe(0n);
    expect(postHold.status).toBe('SETTLED');

    // c. WalletLedgerEntry rows: exactly 2 entries
    const ledgerEntries = await livePrisma.walletLedgerEntry.findMany({
      where: { executionId: execution.id },
      orderBy: { sequenceNumber: 'asc' },
    });
    expect(ledgerEntries.length).toBe(2);

    const buyerDebit = ledgerEntries.find((e) => e.walletId === buyer.wallet.id);
    expect(buyerDebit.entryType).toBe('TRADE_SETTLEMENT_DEBIT');
    expect(buyerDebit.amount).toBe(360n);
    expect(buyerDebit.availableDelta).toBe(40n);
    expect(buyerDebit.reservedDelta).toBe(-400n);
    expect(buyerDebit.balanceAfterAvailable).toBe(9640n);
    expect(buyerDebit.balanceAfterReserved).toBe(1000n);

    const sellerCredit = ledgerEntries.find((e) => e.walletId === seller.wallet.id);
    expect(sellerCredit.entryType).toBe('TRADE_SETTLEMENT_CREDIT');
    expect(sellerCredit.amount).toBe(360n);
    expect(sellerCredit.availableDelta).toBe(360n);
    expect(sellerCredit.reservedDelta).toBe(0n);
    expect(sellerCredit.balanceAfterAvailable).toBe(5360n);

    // d. Final Wallet balances:
    const postBuyerWallet = await livePrisma.wallet.findUnique({ where: { id: buyer.wallet.id } });
    expect(postBuyerWallet.availableBalance).toBe(9640n);
    expect(postBuyerWallet.reservedBalance).toBe(1000n);
    const postTotalBuyerBalance = postBuyerWallet.availableBalance + postBuyerWallet.reservedBalance;
    expect(postTotalBuyerBalance).toBe(10640n);
    // Net change in total balance is exactly -360 paise (the trade cost)!
    expect(postTotalBuyerBalance - 11000n).toBe(-360n);

    const postSellerWallet = await livePrisma.wallet.findUnique({ where: { id: seller.wallet.id } });
    expect(postSellerWallet.availableBalance).toBe(5360n);

    // e. Final Inventories:
    const buyerInventory = await livePrisma.userTicketInventory.findUnique({
      where: {
        userId_ticketCategoryId: {
          userId: buyer.user.id,
          ticketCategoryId: testCategory.id,
        },
      },
    });
    expect(buyerInventory.totalQuantity).toBe(4);
    expect(buyerInventory.availableQuantity).toBe(4);
    expect(buyerInventory.reservedQuantity).toBe(0);

    const sellerInventory = await livePrisma.userTicketInventory.findUnique({
      where: {
        userId_ticketCategoryId: {
          userId: seller.user.id,
          ticketCategoryId: testCategory.id,
        },
      },
    });
    expect(sellerInventory.totalQuantity).toBe(0);
    expect(sellerInventory.reservedQuantity).toBe(0);
    expect(sellerInventory.availableQuantity).toBe(0);
  });

  // --------------------------------------------------------------------------
  // 9. Retry Exhaustion Leaves Zero Partial Writes
  // --------------------------------------------------------------------------
  test('9. Retry exhaustion with maxAttempts=1 under artificial transaction abort preserves atomic rollback', async () => {
    const buyer = await createUserWithWallet('exhaust-buy', 5000n, 200n);
    const seller = await createUserWithWallet('exhaust-sell', 5000n, 0n);

    const { execution } = await seedMatchedTrade({
      buyer,
      seller,
      category: testCategory,
      event: testEvent,
      buyerLimitPrice: 100,
      sellerAskPrice: 100,
      executionPrice: 100,
      quantity: 2,
    });

    // Mock transient failure on first attempt with maxAttempts=1
    const serviceWithLimitedRetry = new TradeSettlementService({
      prismaClient: {
        ...livePrisma,
        $transaction: async (fn, opts) => {
          throw new Error('could not serialize access due to concurrent update (40001)');
        },
      },
    });

    await expect(
      serviceWithLimitedRetry.settleExecution({ executionId: execution.id, maxAttempts: 1 })
    ).rejects.toThrow(/could not serialize access/);

    // Verify ZERO mutations were committed to real database
    const settlementCount = await livePrisma.tradeSettlement.count({
      where: { executionId: execution.id },
    });
    expect(settlementCount).toBe(0);

    const ledgerCount = await livePrisma.walletLedgerEntry.count({
      where: { executionId: execution.id },
    });
    expect(ledgerCount).toBe(0);
  });

  // --------------------------------------------------------------------------
  // 10. Re-running Cancellation and Settlement Idempotently
  // --------------------------------------------------------------------------
  test('10. Re-running cancellation and settlement idempotently after completion preserves state', async () => {
    // 500n reserved for execution + 300n reserved for cancellation hold = 800n total reserved
    const buyer = await createUserWithWallet('idem-run-buy', 10000n, 800n);
    const seller = await createUserWithWallet('idem-run-sell', 5000n, 0n);

    const { execution, buyerHold, buyOrder } = await seedMatchedTrade({
      buyer,
      seller,
      category: testCategory,
      event: testEvent,
      buyerLimitPrice: 100,
      sellerAskPrice: 100,
      executionPrice: 100,
      quantity: 5,
    });

    // 1. Initial settlement
    const settlementResult = await settlementService.settleExecution({ executionId: execution.id });
    expect(settlementResult.isIdempotentReplay).toBe(false);

    // 2. Replay settlement with exact same executionId
    const replayResult = await settlementService.settleExecution({ executionId: execution.id });
    expect(replayResult.isIdempotentReplay).toBe(true);
    expect(replayResult.settlement.id).toBe(settlementResult.settlement.id);

    // 3. Test idempotent replay on a separate cancellation release operation
    const idempKey = `idem-cancel-${crypto.randomUUID()}`;
    const testHold = await livePrisma.walletHold.create({
      data: {
        walletId: buyer.wallet.id,
        orderId: buyOrder.id,
        reason: 'ORDER_ESCROW',
        status: 'ACTIVE',
        heldAmount: 300n,
        remainingAmount: 300n,
        idempotencyKey: `hold-for-cancel-${crypto.randomUUID()}`,
      },
    });

    // First cancellation release of 100 paise
    const op1 = await walletService.releaseHold({
      holdId: testHold.id,
      amount: 100n,
      idempotencyKey: idempKey,
      referenceType: 'ORDER',
      referenceId: buyOrder.id,
    });
    expect(op1.isIdempotentReplay).toBe(false);

    // Second call with same idempotencyKey returns idempotent replay
    const op2 = await walletService.releaseHold({
      holdId: testHold.id,
      amount: 100n,
      idempotencyKey: idempKey,
      referenceType: 'ORDER',
      referenceId: buyOrder.id,
    });
    expect(op2.isIdempotentReplay).toBe(true);

    // Verify database state remains completely consistent
    const settlements = await livePrisma.tradeSettlement.findMany({ where: { executionId: execution.id } });
    expect(settlements.length).toBe(1);

    const finalSeller = await livePrisma.wallet.findUnique({ where: { id: seller.wallet.id } });
    expect(finalSeller.availableBalance).toBe(5500n);
  });

  // --------------------------------------------------------------------------
  // 11. Recurring Settlement Recovery Worker Integration (Real PostgreSQL)
  // --------------------------------------------------------------------------
  test('11. SettlementRecoveryWorker processes pending executions and avoids duplicate financial effects', async () => {
    const buyer = await createUserWithWallet('worker-buy', 5000n, 300n);
    const seller = await createUserWithWallet('worker-sell', 5000n, 0n);

    // Seed matched trade without settling it yet
    const { execution } = await seedMatchedTrade({
      buyer,
      seller,
      category: testCategory,
      event: testEvent,
      buyerLimitPrice: 100,
      sellerAskPrice: 100,
      executionPrice: 100,
      quantity: 3,
    });

    // Verify initially unsettled
    const initialSettlement = await livePrisma.tradeSettlement.findUnique({
      where: { executionId: execution.id },
    });
    expect(initialSettlement).toBeNull();

    const worker = new SettlementRecoveryWorker({
      settlementService,
      intervalMs: 1000,
      batchSize: 500,
      loggerInstance: { info: () => {}, warn: () => {}, error: () => {} },
    });

    // Run a single recovery tick
    worker.isRunning = true;
    const tickResults = await worker.tick();
    const settledExecution = tickResults.find((r) => r.settlement?.executionId === execution.id);
    expect(settledExecution).toBeDefined();
    expect(settledExecution.isIdempotentReplay).toBe(false);

    // Verify trade settlement row exists in PostgreSQL
    const createdSettlement = await livePrisma.tradeSettlement.findUnique({
      where: { executionId: execution.id },
    });
    expect(createdSettlement).not.toBeNull();
    expect(createdSettlement.quantity).toBe(3);

    // Verify seller wallet credited by 300 paise
    const updatedSeller = await livePrisma.wallet.findUnique({ where: { id: seller.wallet.id } });
    expect(updatedSeller.availableBalance).toBe(5300n);

    // Run second recovery tick on the same database
    await worker.tick();

    // Settle attempt directly on settled execution returns idempotent replay
    const directReplay = await settlementService.settleExecution({ executionId: execution.id });
    expect(directReplay.isIdempotentReplay).toBe(true);

    // Verify exactly 1 settlement and 2 ledger entries exist
    const settlementsCount = await livePrisma.tradeSettlement.count({
      where: { executionId: execution.id },
    });
    expect(settlementsCount).toBe(1);

    const ledgerEntriesCount = await livePrisma.walletLedgerEntry.count({
      where: { executionId: execution.id },
    });
    expect(ledgerEntriesCount).toBe(2);

    await worker.stop();
  });

  // --------------------------------------------------------------------------
  // 12. Starvation Prevention: Keyset pagination advances past failing executions
  // --------------------------------------------------------------------------
  test('12. Keyset pagination prevents older failing executions from starving newer executions in PostgreSQL', async () => {
    // Execution 1: Failing trade (insufficient seller inventory)
    const buyer1 = await createUserWithWallet('starve-buy-1', 5000n, 500n);
    const seller1 = await createUserWithWallet('starve-sell-1', 5000n, 0n);
    const { execution: failingExecution } = await seedMatchedTrade({
      buyer: buyer1,
      seller: seller1,
      category: testCategory,
      event: testEvent,
      buyerLimitPrice: 100,
      sellerAskPrice: 100,
      executionPrice: 100,
      quantity: 5,
      sellerReservedInventory: 1, // Insufficient! Will fail invariant check
    });

    // Execution 2: Valid trade created AFTER failingExecution
    const buyer2 = await createUserWithWallet('starve-buy-2', 5000n, 400n);
    const seller2 = await createUserWithWallet('starve-sell-2', 5000n, 0n);
    const { execution: validExecution } = await seedMatchedTrade({
      buyer: buyer2,
      seller: seller2,
      category: testCategory2,
      event: testEvent2,
      buyerLimitPrice: 200,
      sellerAskPrice: 200,
      executionPrice: 200,
      quantity: 2, // 2 * 200 = 400 paise
      sellerReservedInventory: 2, // Sufficient!
    });

    expect(BigInt(validExecution.sequenceNumber) > BigInt(failingExecution.sequenceNumber)).toBe(true);

    const worker = new SettlementRecoveryWorker({
      settlementService,
      batchSize: 1, // Restrict batch size to 1 to force keyset pagination across ticks
      intervalMs: 1000,
      loggerInstance: { info: () => {}, warn: () => {}, error: () => {} },
    });

    worker.isRunning = true;
    worker.lastSeenSequenceNumber = BigInt(failingExecution.sequenceNumber) - 1n; // Point cursor right before failing execution

    // Tick 1: picks up failingExecution (batchSize 1). Fails settlement without throwing unhandled error.
    const tick1Results = await worker.tick();
    expect(tick1Results).toHaveLength(1);
    expect(tick1Results[0].executionId).toBe(failingExecution.id);
    expect(tick1Results[0].settled).toBe(false);
    expect(worker.lastSeenSequenceNumber).toBe(BigInt(failingExecution.sequenceNumber));

    // Verify failingExecution is NOT settled in PostgreSQL
    const failingSettlement = await livePrisma.tradeSettlement.findUnique({
      where: { executionId: failingExecution.id },
    });
    expect(failingSettlement).toBeNull();

    // Tick 2: without starvation prevention, batchSize 1 would re-select failingExecution indefinitely.
    // WITH keyset pagination (gt: failingExecution.sequenceNumber), it advances to validExecution!
    const tick2Results = await worker.tick();
    expect(tick2Results).toHaveLength(1);
    expect(tick2Results[0].executionId).toBe(validExecution.id);
    expect(tick2Results[0].settlement).toBeDefined();
    expect(tick2Results[0].isIdempotentReplay).toBe(false);
    expect(worker.lastSeenSequenceNumber).toBe(BigInt(validExecution.sequenceNumber));

    // Verify validExecution IS settled in PostgreSQL
    const validSettlement = await livePrisma.tradeSettlement.findUnique({
      where: { executionId: validExecution.id },
    });
    expect(validSettlement).not.toBeNull();
    expect(validSettlement.quantity).toBe(2);

    // Verify seller2 received 400 paise
    const updatedSeller2 = await livePrisma.wallet.findUnique({ where: { id: seller2.wallet.id } });
    expect(updatedSeller2.availableBalance).toBe(5400n);

    // Tick 3: reaches tail or wraps around
    const tick3Results = await worker.tick();
    if (tick3Results.length === 0) {
      expect(worker.lastSeenSequenceNumber).toBeNull();
    }

    await worker.stop();
  });

  // --------------------------------------------------------------------------
  // 13. Concurrent Recovery Workers: Two independent workers race on the same execution
  // --------------------------------------------------------------------------
  test('13. Concurrent recovery workers race on the same execution without double settlement or ledger duplication', async () => {
    const buyer = await createUserWithWallet('race-w-buy', 5000n, 300n);
    const seller = await createUserWithWallet('race-w-sell', 5000n, 0n);

    const { execution } = await seedMatchedTrade({
      buyer,
      seller,
      category: testCategory,
      event: testEvent,
      buyerLimitPrice: 100,
      sellerAskPrice: 100,
      executionPrice: 100,
      quantity: 3,
    });

    // Create two independent SettlementRecoveryWorker instances
    const worker1 = new SettlementRecoveryWorker({
      settlementService,
      batchSize: 500,
      loggerInstance: { info: () => {}, warn: () => {}, error: () => {} },
    });

    const worker2 = new SettlementRecoveryWorker({
      settlementService,
      batchSize: 500,
      loggerInstance: { info: () => {}, warn: () => {}, error: () => {} },
    });

    worker1.isRunning = true;
    worker2.isRunning = true;

    // Both workers tick simultaneously against the same PostgreSQL database
    const [results1, results2] = await Promise.all([worker1.tick(), worker2.tick()]);

    const item1 = results1.find((r) => r.executionId === execution.id || r.settlement?.executionId === execution.id);
    const item2 = results2.find((r) => r.executionId === execution.id || r.settlement?.executionId === execution.id);

    // At least one worker must have processed the execution
    expect(item1 || item2).toBeDefined();

    // Verify database state: EXACTLY 1 settlement and 2 ledger entries exist in PostgreSQL
    const settlementsCount = await livePrisma.tradeSettlement.count({
      where: { executionId: execution.id },
    });
    expect(settlementsCount).toBe(1);

    const ledgerEntries = await livePrisma.walletLedgerEntry.findMany({
      where: { executionId: execution.id },
    });
    expect(ledgerEntries).toHaveLength(2);

    // Verify seller credited exactly once (+300 paise, not +600 paise)
    const finalSellerWallet = await livePrisma.wallet.findUnique({ where: { id: seller.wallet.id } });
    expect(finalSellerWallet.availableBalance).toBe(5300n);

    // Verify buyer reserved deducted exactly once (300n -> 0n)
    const finalBuyerWallet = await livePrisma.wallet.findUnique({ where: { id: buyer.wallet.id } });
    expect(finalBuyerWallet.reservedBalance).toBe(0n);

    await Promise.all([worker1.stop(), worker2.stop()]);
  });
});
