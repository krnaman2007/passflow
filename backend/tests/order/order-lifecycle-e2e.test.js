/**
 * Step 9.8 — End-to-End Financial Lifecycle Integration Tests (Real Isolated PostgreSQL)
 *
 * Verifies the complete order-to-settlement lifecycle across OrderService, PersistentMatchingService,
 * WalletService, TradeSettlementService, and SettlementRecoveryWorker:
 * 1. Full lifecycle: placement, matching with price improvement, settlement, and cancellation of unfilled quantity.
 * 2. Partial fill followed by cancellation: verifies PARTIALLY_SETTLED holds release unfilled funds cleanly.
 * 3. Concurrent fund competition: two buy orders racing for insufficient wallet funds.
 * 4. Concurrent inventory competition: two sell orders racing for insufficient ticket inventory.
 * 5. Process restart & recovery: recovering interrupted post-match executions via SettlementRecoveryWorker.
 * 6. Reconciliation: verifying whole-system financial and inventory consistency.
 */

import { jest } from '@jest/globals';
import crypto from 'node:crypto';
import { prisma as livePrisma } from '../../src/db/prisma.js';
import {
  OrderService,
  InsufficientInventoryError,
  OrderValidationError,
} from '../../src/services/order/index.js';
import { WalletService } from '../../src/services/wallet/index.js';
import { PersistentMatchingService } from '../../src/services/matching/persistent-matching-service.js';
import { OrderRepository } from '../../src/services/matching/order-repository.js';
import { OrderBook } from '../../src/services/matching/order-book.js';
import { TradeSettlementService, SettlementRecoveryWorker } from '../../src/services/settlement/index.js';
import { InsufficientFundsError } from '../../src/services/wallet/wallet-errors.js';

describe('Step 9.8 — End-to-End Financial Lifecycle Integration Tests (Live PostgreSQL)', () => {
  jest.setTimeout(120000);

  const testRunId = Math.random().toString(36).substring(2, 8);
  const walletService = new WalletService({ prismaClient: livePrisma });
  const orderRepository = new OrderRepository({ prismaClient: livePrisma });
  const matchingService = new PersistentMatchingService({ repository: orderRepository });
  const settlementService = new TradeSettlementService({ prismaClient: livePrisma });
  const orderService = new OrderService({
    prismaClient: livePrisma,
    walletService,
    matchingService,
    orderRepository,
    settlementService,
  });

  let organizerUser;
  let organizer;
  let testEvent;
  let testCategory;

  beforeAll(async () => {
    organizerUser = await livePrisma.user.create({
      data: {
        email: `e2e-org-${testRunId}@test.passflow.com`,
        passwordHash: 'dummy-hash',
        name: 'E2E Organizer',
      },
    });

    organizer = await livePrisma.organizer.create({
      data: {
        userId: organizerUser.id,
        organizationName: `E2E Org ${testRunId}`,
        verificationStatus: 'VERIFIED',
      },
    });

    testEvent = await livePrisma.event.create({
      data: {
        name: `E2E Financial Concert ${testRunId}`,
        description: 'E2E test event',
        location: 'Financial Tech Arena',
        dateTime: new Date(Date.now() + 86400000 * 10),
        status: 'PUBLISHED',
        organizerId: organizer.id,
      },
    });

    testCategory = await livePrisma.ticketCategory.create({
      data: {
        eventId: testEvent.id,
        name: 'General Admission',
        originalPrice: 100.0,
        totalQuantity: 1000,
        availableQuantity: 1000,
        status: 'ACTIVE',
      },
    });

    // Certify synchronized in-memory order book
    const book = new OrderBook({
      eventId: testEvent.id,
      ticketCategoryId: testCategory.id,
    });
    const marketKey = matchingService.registerMarketBook(
      { eventId: testEvent.id, ticketCategoryId: testCategory.id },
      book,
      { synchronized: true }
    );
    matchingService.stateManager.transition(marketKey, 'READY');
  });

  afterAll(async () => {
    await livePrisma.$disconnect();
  });

  async function createUserWithWallet(tag, initialPaise = 0n) {
    const id = crypto.randomUUID();
    const user = await livePrisma.user.create({
      data: {
        id,
        email: `${tag}-${id.substring(0, 8)}@test.passflow.com`,
        passwordHash: 'dummy-hash',
        name: `${tag} User`,
      },
    });

    const wallet = await walletService.getOrCreateWallet({ userId: user.id });
    if (initialPaise > 0n) {
      await walletService.creditAvailable({
        walletId: wallet.id,
        userId: user.id,
        amount: initialPaise,
        idempotencyKey: `credit-${tag}-${crypto.randomUUID()}`,
        description: `Initial credit for ${tag}`,
      });
    }

    return { user, wallet: await livePrisma.wallet.findUnique({ where: { id: wallet.id } }) };
  }

  // --------------------------------------------------------------------------
  // 1. Full Lifecycle: Placement, Price Improvement, Settlement, and Cancellation
  // --------------------------------------------------------------------------
  test('1. Full Lifecycle: Buy placement with price improvement, partial match, settlement, and cancellation preserves conservation', async () => {
    // Buyer has 20,000 paise (₹200.00). Seller has 0 paise, but owns 10 tickets.
    const buyer = await createUserWithWallet('full-buy', 20000n);
    const seller = await createUserWithWallet('full-sell', 0n);

    // Credit seller with 10 tickets
    await orderService.creditUserTicketInventory({
      userId: seller.user.id,
      ticketCategoryId: testCategory.id,
      quantity: 10,
      idempotencyKey: `credit-seller-${crypto.randomUUID()}`,
    });

    // 1. Seller lists 10 tickets at 100 paise each
    const sellResult = await orderService.placeLimitOrder({
      userId: seller.user.id,
      eventId: testEvent.id,
      ticketCategoryId: testCategory.id,
      side: 'ASK',
      price: 100,
      quantity: 10,
      idempotencyKey: `sell-order-${crypto.randomUUID()}`,
    });
    expect(sellResult.status).toBe('OPEN');
    expect(sellResult.remainingQuantity).toBe(10);

    // Verify seller inventory reserved
    const postSellInv = await orderService.getUserTicketInventory({
      userId: seller.user.id,
      ticketCategoryId: testCategory.id,
    });
    expect(postSellInv.availableQuantity).toBe(0);
    expect(postSellInv.reservedQuantity).toBe(10);
    expect(postSellInv.totalQuantity).toBe(10);

    // 2. Buyer bids for 6 tickets at 110 paise each (limit 110 > ask 100 -> price improvement of 10 paise/ticket)
    const buyResult = await orderService.placeLimitOrder({
      userId: buyer.user.id,
      eventId: testEvent.id,
      ticketCategoryId: testCategory.id,
      side: 'BID',
      price: 110,
      quantity: 6,
      idempotencyKey: `buy-order-${crypto.randomUUID()}`,
    });

    // Fully filled against resting ask at 100 paise
    expect(buyResult.status).toBe('FILLED');
    expect(buyResult.remainingQuantity).toBe(0);
    expect(buyResult.executions).toHaveLength(1);
    expect(buyResult.executions[0].price).toBe(100);
    expect(buyResult.executions[0].quantity).toBe(6);

    // 3. Verify settlement committed automatically
    const executionId = buyResult.executions[0].id;
    const settlement = await livePrisma.tradeSettlement.findUnique({
      where: { executionId },
    });
    expect(settlement).not.toBeNull();
    expect(settlement.quantity).toBe(6);
    expect(settlement.executionPricePaise).toBe(100);
    expect(settlement.executionCostPaise).toBe(600n);
    expect(settlement.buyerReservedConsumed).toBe(660n); // 6 * 110
    expect(settlement.priceImprovementPaise).toBe(60n); // 660 - 600

    // 4. Verify Buyer wallet:
    // Started with 20,000 paise.
    // Reserved 660 paise.
    // Settlement consumed 600 paise, released 60 paise price improvement.
    // Final available: 20,000 - 600 = 19,400 paise. Reserved: 0 paise.
    const finalBuyerWallet = await livePrisma.wallet.findUnique({ where: { id: buyer.wallet.id } });
    expect(finalBuyerWallet.availableBalance).toBe(19400n);
    expect(finalBuyerWallet.reservedBalance).toBe(0n);

    // 5. Verify Seller wallet:
    // Credited with 600 paise available.
    const finalSellerWallet = await livePrisma.wallet.findUnique({ where: { id: seller.wallet.id } });
    expect(finalSellerWallet.availableBalance).toBe(600n);
    expect(finalSellerWallet.reservedBalance).toBe(0n);

    // 6. Verify Buyer inventory: owns 6 tickets
    const finalBuyerInv = await orderService.getUserTicketInventory({
      userId: buyer.user.id,
      ticketCategoryId: testCategory.id,
    });
    expect(finalBuyerInv.totalQuantity).toBe(6);
    expect(finalBuyerInv.availableQuantity).toBe(6);
    expect(finalBuyerInv.reservedQuantity).toBe(0);

    // 7. Seller cancels remaining 4 tickets of resting ASK order
    const cancelResult = await orderService.cancelLimitOrder({
      userId: seller.user.id,
      orderId: sellResult.orderId,
      idempotencyKey: `cancel-seller-${crypto.randomUUID()}`,
    });
    expect(cancelResult.status).toBe('CANCELLED');
    expect(cancelResult.cancelledQuantity).toBe(4);
    expect(cancelResult.releasedReservation).toBe(4);

    // Verify Seller inventory after cancellation:
    // 4 remaining tickets restored to availableQuantity. Total = 4.
    const finalSellerInv = await orderService.getUserTicketInventory({
      userId: seller.user.id,
      ticketCategoryId: testCategory.id,
    });
    expect(finalSellerInv.totalQuantity).toBe(4);
    expect(finalSellerInv.availableQuantity).toBe(4);
    expect(finalSellerInv.reservedQuantity).toBe(0);

    // 8. Whole-system conservation audit:
    // Money: 19,400 + 600 = 20,000 paise. (Initial = 20,000 paise).
    expect(finalBuyerWallet.availableBalance + finalSellerWallet.availableBalance).toBe(20000n);
    // Tickets: 6 + 4 = 10 tickets. (Initial = 10 tickets).
    expect(finalBuyerInv.totalQuantity + finalSellerInv.totalQuantity).toBe(10);
  });

  // --------------------------------------------------------------------------
  // 2. Partial Settlement Followed by Cancellation (PARTIALLY_SETTLED Hold Release)
  // --------------------------------------------------------------------------
  test('2. Cancelling an order with a PARTIALLY_SETTLED hold releases the remaining unexecuted funds cleanly', async () => {
    const buyer = await createUserWithWallet('part-buy', 10000n);
    const seller = await createUserWithWallet('part-sell', 0n);

    await orderService.creditUserTicketInventory({
      userId: seller.user.id,
      ticketCategoryId: testCategory.id,
      quantity: 4,
      idempotencyKey: `credit-part-seller-${crypto.randomUUID()}`,
    });

    // Seller lists 4 tickets at 100 paise
    await orderService.placeLimitOrder({
      userId: seller.user.id,
      eventId: testEvent.id,
      ticketCategoryId: testCategory.id,
      side: 'ASK',
      price: 100,
      quantity: 4,
      idempotencyKey: `part-sell-${crypto.randomUUID()}`,
    });

    // Buyer places order for 10 tickets at 100 paise (1,000 paise held)
    const buyResult = await orderService.placeLimitOrder({
      userId: buyer.user.id,
      eventId: testEvent.id,
      ticketCategoryId: testCategory.id,
      side: 'BID',
      price: 100,
      quantity: 10,
      idempotencyKey: `part-buy-${crypto.randomUUID()}`,
    });

    // Partially filled: 4 executed, 6 remaining
    expect(buyResult.status).toBe('PARTIALLY_FILLED');
    expect(buyResult.remainingQuantity).toBe(6);
    expect(buyResult.executions).toHaveLength(1);
    expect(buyResult.executions[0].quantity).toBe(4);

    // Inspect hold state: status is PARTIALLY_SETTLED, remainingAmount is 600n
    const midHold = await livePrisma.walletHold.findFirst({
      where: { orderId: buyResult.orderId },
    });
    expect(midHold.status).toBe('PARTIALLY_SETTLED');
    expect(midHold.remainingAmount).toBe(600n);

    // Buyer wallet intermediate state:
    // Available: 9,000, Reserved: 600
    const midBuyerWallet = await livePrisma.wallet.findUnique({ where: { id: buyer.wallet.id } });
    expect(midBuyerWallet.availableBalance).toBe(9000n);
    expect(midBuyerWallet.reservedBalance).toBe(600n);

    // Buyer cancels the remaining 6 unfilled tickets
    const cancelResult = await orderService.cancelLimitOrder({
      userId: buyer.user.id,
      orderId: buyResult.orderId,
      idempotencyKey: `part-cancel-${crypto.randomUUID()}`,
    });

    expect(cancelResult.status).toBe('CANCELLED');
    expect(cancelResult.cancelledQuantity).toBe(6);
    expect(cancelResult.releasedReservation).toBe(600);

    // Hold must now be RELEASED with remainingAmount = 0
    const finalHold = await livePrisma.walletHold.findUnique({ where: { id: midHold.id } });
    expect(finalHold.remainingAmount).toBe(0n);
    expect(finalHold.status).toBe('RELEASED');

    // Buyer wallet final state:
    // Available: 9,600 (9,000 + 600 refunded), Reserved: 0
    const finalBuyerWallet = await livePrisma.wallet.findUnique({ where: { id: buyer.wallet.id } });
    expect(finalBuyerWallet.availableBalance).toBe(9600n);
    expect(finalBuyerWallet.reservedBalance).toBe(0n);

    // Net balance change is exactly the 400 paise spent on the 4 tickets
    expect(finalBuyerWallet.availableBalance - 10000n).toBe(-400n);
  });

  // --------------------------------------------------------------------------
  // 3. Concurrent Wallet Fund Competition
  // --------------------------------------------------------------------------
  test('3. Two concurrent buy orders competing for the same wallet funds serialize without negative balances', async () => {
    // Buyer has only 1,000 paise available
    const buyer = await createUserWithWallet('comp-fund-buy', 1000n);

    // Two concurrent buy orders, each requiring 700 paise (7 * 100)
    const order1Promise = orderService.placeLimitOrder({
      userId: buyer.user.id,
      eventId: testEvent.id,
      ticketCategoryId: testCategory.id,
      side: 'BID',
      price: 100,
      quantity: 7,
      idempotencyKey: `comp-order-1-${crypto.randomUUID()}`,
    });

    const order2Promise = orderService.placeLimitOrder({
      userId: buyer.user.id,
      eventId: testEvent.id,
      ticketCategoryId: testCategory.id,
      side: 'BID',
      price: 100,
      quantity: 7,
      idempotencyKey: `comp-order-2-${crypto.randomUUID()}`,
    });

    const results = await Promise.allSettled([order1Promise, order2Promise]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    // Exactly one must succeed, and one must fail with InsufficientFundsError
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(InsufficientFundsError);

    // Buyer wallet balances: available 300, reserved 700 (NEVER negative)
    const postBuyerWallet = await livePrisma.wallet.findUnique({ where: { id: buyer.wallet.id } });
    expect(postBuyerWallet.availableBalance).toBe(300n);
    expect(postBuyerWallet.reservedBalance).toBe(700n);
  });

  // --------------------------------------------------------------------------
  // 4. Concurrent Inventory Competition
  // --------------------------------------------------------------------------
  test('4. Two concurrent sell orders competing for the same inventory serialize without overselling', async () => {
    const isolatedCategory = await livePrisma.ticketCategory.create({
      data: {
        eventId: testEvent.id,
        name: 'Isolated GA Category',
        originalPrice: 100.0,
        totalQuantity: 1000,
        availableQuantity: 1000,
        status: 'ACTIVE',
      },
    });
    const isolatedBook = new OrderBook({
      eventId: testEvent.id,
      ticketCategoryId: isolatedCategory.id,
    });
    const marketKey = matchingService.registerMarketBook(
      { eventId: testEvent.id, ticketCategoryId: isolatedCategory.id },
      isolatedBook,
      { synchronized: true }
    );
    matchingService.stateManager.transition(marketKey, 'READY');

    const seller = await createUserWithWallet('comp-inv-sell', 0n);

    // Seller has 5 tickets available
    await orderService.creditUserTicketInventory({
      userId: seller.user.id,
      ticketCategoryId: isolatedCategory.id,
      quantity: 5,
      idempotencyKey: `comp-inv-${crypto.randomUUID()}`,
    });

    // Two concurrent sell orders, each requesting 4 tickets (4 + 4 > 5)
    const sell1Promise = orderService.placeLimitOrder({
      userId: seller.user.id,
      eventId: testEvent.id,
      ticketCategoryId: isolatedCategory.id,
      side: 'ASK',
      price: 100,
      quantity: 4,
      idempotencyKey: `comp-sell-1-${crypto.randomUUID()}`,
    });

    const sell2Promise = orderService.placeLimitOrder({
      userId: seller.user.id,
      eventId: testEvent.id,
      ticketCategoryId: isolatedCategory.id,
      side: 'ASK',
      price: 100,
      quantity: 4,
      idempotencyKey: `comp-sell-2-${crypto.randomUUID()}`,
    });

    const results = await Promise.allSettled([sell1Promise, sell2Promise]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    // Exactly one must succeed, one must fail with InsufficientInventoryError
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(InsufficientInventoryError);

    // Seller inventory: available 1, reserved 4, total 5 (NEVER negative or over-reserved)
    const postSellerInv = await orderService.getUserTicketInventory({
      userId: seller.user.id,
      ticketCategoryId: isolatedCategory.id,
    });
    expect(postSellerInv.availableQuantity).toBe(1);
    expect(postSellerInv.reservedQuantity).toBe(4);
    expect(postSellerInv.totalQuantity).toBe(5);
  });

  // --------------------------------------------------------------------------
  // 5. Process Restart & Recovery Integration
  // --------------------------------------------------------------------------
  test('5. Process restart & recovery settles unhandled executions without duplicate financial mutations', async () => {
    const buyer = await createUserWithWallet('rec-e2e-buy', 5000n);
    const seller = await createUserWithWallet('rec-e2e-sell', 0n);

    await orderService.creditUserTicketInventory({
      userId: seller.user.id,
      ticketCategoryId: testCategory.id,
      quantity: 3,
      idempotencyKey: `credit-rec-${crypto.randomUUID()}`,
    });

    // Seed execution directly to simulate a crash immediately after matching persistence
    const buyOrder = await livePrisma.order.create({
      data: {
        userId: buyer.user.id,
        eventId: testEvent.id,
        ticketCategoryId: testCategory.id,
        side: 'BID',
        price: 100,
        initialQuantity: 3,
        remainingQuantity: 0,
        status: 'FILLED',
        idempotencyKey: `rec-order-buy-${crypto.randomUUID()}`,
      },
    });

    const sellOrder = await livePrisma.order.create({
      data: {
        userId: seller.user.id,
        eventId: testEvent.id,
        ticketCategoryId: testCategory.id,
        side: 'ASK',
        price: 100,
        initialQuantity: 3,
        remainingQuantity: 0,
        status: 'FILLED',
        idempotencyKey: `rec-order-sell-${crypto.randomUUID()}`,
      },
    });

    await livePrisma.walletHold.create({
      data: {
        walletId: buyer.wallet.id,
        orderId: buyOrder.id,
        reason: 'ORDER_ESCROW',
        status: 'ACTIVE',
        heldAmount: 300n,
        remainingAmount: 300n,
        idempotencyKey: `rec-hold-${crypto.randomUUID()}`,
      },
    });

    await livePrisma.wallet.update({
      where: { id: buyer.wallet.id },
      data: { availableBalance: 4700n, reservedBalance: 300n },
    });

    await livePrisma.userTicketInventory.update({
      where: { userId_ticketCategoryId: { userId: seller.user.id, ticketCategoryId: testCategory.id } },
      data: { availableQuantity: 0, reservedQuantity: 3 },
    });

    await livePrisma.ticket.updateMany({
      where: { ownerId: seller.user.id, categoryId: testCategory.id },
      data: { status: 'LISTED', orderId: sellOrder.id },
    });

    const execution = await livePrisma.execution.create({
      data: {
        incomingOrderId: buyOrder.id,
        restingOrderId: sellOrder.id,
        price: 100,
        quantity: 3,
      },
    });

    // Verify unsettled initially
    expect(await livePrisma.tradeSettlement.findUnique({ where: { executionId: execution.id } })).toBeNull();

    // Run recovery worker
    const worker = new SettlementRecoveryWorker({
      settlementService,
      batchSize: 500,
      loggerInstance: { info: () => {}, warn: () => {}, error: () => {} },
    });

    worker.isRunning = true;
    const tickResults = await worker.tick();
    const settledItem = tickResults.find((r) => r.executionId === execution.id || r.settlement?.executionId === execution.id);
    expect(settledItem).toBeDefined();

    // Settlement persisted
    const settlement = await livePrisma.tradeSettlement.findUnique({ where: { executionId: execution.id } });
    expect(settlement).not.toBeNull();
    expect(settlement.quantity).toBe(3);

    // Seller credited
    const postSeller = await livePrisma.wallet.findUnique({ where: { id: seller.wallet.id } });
    expect(postSeller.availableBalance).toBe(300n);

    // Second recovery tick is completely idempotent
    await worker.tick();
    const settlementsCount = await livePrisma.tradeSettlement.count({ where: { executionId: execution.id } });
    expect(settlementsCount).toBe(1);

    await worker.stop();
  });

  // --------------------------------------------------------------------------
  // 6. Reconciliation Consistency Audit
  // --------------------------------------------------------------------------
  test('6. ReconcileOrderReservations reports consistent state on clean markets', async () => {
    const reconSummary = await orderService.reconcileOrderReservations({
      eventId: testEvent.id,
      ticketCategoryId: testCategory.id,
      dryRun: true,
    });

    expect(reconSummary.underfundedOrders).toHaveLength(0);
    expect(reconSummary.orphanedInventoryDetected).toBe(0);
  });
});
