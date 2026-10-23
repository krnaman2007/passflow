import { jest } from '@jest/globals';
import crypto from 'node:crypto';
import prisma from '../src/db/prisma.js';
import { ticketService } from '../src/services/ticket.service.js';
import { orderService } from '../src/services/order/index.js';
import { tradeSettlementService, SettlementInvariantError } from '../src/services/settlement/trade-settlement-service.js';
import { walletService } from '../src/services/wallet/index.js';
import { InsufficientInventoryError } from '../src/services/order/order-service.js';
import { OrderBook } from '../src/services/matching/order-book.js';

describe('Step B — Unified Ticket Ownership, Resale Inventory, and Settlement Integration Tests', () => {
  jest.setTimeout(60000);

  const timestamp = Date.now();
  let organizerUser = null;
  let organizer = null;
  let testEvent = null;
  let testCategory = null;

  beforeAll(async () => {
    // Safety guard: ensure running against dedicated local PostgreSQL
    const [dbInfo] = await prisma.$queryRaw`
      SELECT current_database(), current_user, inet_server_port()
    `;
    expect(dbInfo.inet_server_port).toBe(55432);

    // Create organizer and event
    organizerUser = await prisma.user.create({
      data: {
        email: `step_b_org_${timestamp}@passflow.test`,
        passwordHash: '$2a$10$abcdefghijklmnopqrstuu',
        name: 'Step B Organizer',
        role: 'ORGANIZER',
      },
    });

    organizer = await prisma.organizer.create({
      data: {
        userId: organizerUser.id,
        organizationName: `Step B Org ${timestamp}`,
        verificationStatus: 'VERIFIED',
      },
    });

    testEvent = await prisma.event.create({
      data: {
        organizerId: organizer.id,
        name: `Step B Unified Concert ${timestamp}`,
        description: 'Testing unified ticket ownership',
        location: 'Bangalore Arena',
        dateTime: new Date(Date.now() + 86400000 * 10),
        status: 'PUBLISHED',
        originalPrice: 100,
      },
    });

    testCategory = await prisma.ticketCategory.create({
      data: {
        eventId: testEvent.id,
        name: 'VIP Pavilion',
        originalPrice: 100,
        totalQuantity: 1000,
        availableQuantity: 1000,
        status: 'ACTIVE',
      },
    });

    await prisma.ticketInventory.create({
      data: {
        categoryId: testCategory.id,
        totalQuantity: 1000,
        availableQuantity: 1000,
        reservedQuantity: 0,
      },
    });

    // Register and certify synchronized market book in PersistentMatchingService
    const book = new OrderBook({
      eventId: testEvent.id,
      ticketCategoryId: testCategory.id,
    });
    const marketKey = orderService.matchingService.registerMarketBook(
      { eventId: testEvent.id, ticketCategoryId: testCategory.id },
      book,
      { synchronized: true }
    );
    orderService.matchingService.stateManager.transition(marketKey, 'READY');
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // Helper to create funded user
  async function createFundedUser(prefix, initialDepositPaise = 5000000n) {
    const user = await prisma.user.create({
      data: {
        email: `${prefix}_${crypto.randomUUID().slice(0, 8)}@passflow.test`,
        passwordHash: '$2a$10$abcdefghijklmnopqrstuu',
        name: `${prefix} User`,
        role: 'USER',
      },
    });

    const wallet = await prisma.wallet.create({
      data: {
        userId: user.id,
        availableBalance: initialDepositPaise,
        reservedBalance: 0n,
        currency: 'INR',
      },
    });

    return { user, wallet };
  }

  // Helper to create isolated ticket category with registered matching book
  async function createTestCategory(nameSuffix) {
    const category = await prisma.ticketCategory.create({
      data: {
        eventId: testEvent.id,
        name: `Cat_${nameSuffix}_${crypto.randomUUID().slice(0, 8)}`,
        originalPrice: 100,
        totalQuantity: 1000,
        availableQuantity: 1000,
        status: 'ACTIVE',
      },
    });

    await prisma.ticketInventory.create({
      data: {
        categoryId: category.id,
        totalQuantity: 1000,
        availableQuantity: 1000,
        reservedQuantity: 0,
      },
    });

    const book = new OrderBook({
      eventId: testEvent.id,
      ticketCategoryId: category.id,
    });
    const marketKey = orderService.matchingService.registerMarketBook(
      { eventId: testEvent.id, ticketCategoryId: category.id },
      book,
      { synchronized: true }
    );
    orderService.matchingService.stateManager.transition(marketKey, 'READY');

    return category;
  }

  // =========================================================================
  // 1 & 2: Primary Purchase & Idempotent Replay
  // =========================================================================
  describe('1. Primary Purchase & Ticket Issuance Invariants', () => {
    it('1. Primary purchase creates individual tickets, ownership history, and matching aggregate inventory (quantity: 4)', async () => {
      const { user } = await createFundedUser('buyer_primary');
      const idempKey = `test-primary-${crypto.randomUUID()}`;

      const purchaseResult = await ticketService.purchaseTickets({
        userId: user.id,
        eventId: testEvent.id,
        categoryId: testCategory.id,
        quantity: 4,
        idempotencyKey: idempKey,
      });

      expect(purchaseResult.tickets).toHaveLength(4);
      expect(purchaseResult.transactionId).toBeDefined();

      // Check individual tickets
      const ticketsInDb = await prisma.ticket.findMany({
        where: {
          ownerId: user.id,
          categoryId: testCategory.id,
        },
      });
      expect(ticketsInDb).toHaveLength(4);
      for (const t of ticketsInDb) {
        expect(t.status).toBe('OWNED');
        expect(t.orderId).toBeNull();
        expect(t.eventId).toBe(testEvent.id);
        expect(Number(t.faceValue)).toBe(100);
      }

      // Check ownership history
      const ownershipRecords = await prisma.ticketOwnership.findMany({
        where: { ownerId: user.id },
      });
      expect(ownershipRecords).toHaveLength(4);
      for (const o of ownershipRecords) {
        expect(o.source).toBe('PRIMARY');
        expect(o.transactionId).toBe(purchaseResult.transactionId);
      }

      // Check aggregate UserTicketInventory
      const inventory = await orderService.getUserTicketInventory({
        userId: user.id,
        ticketCategoryId: testCategory.id,
      });
      expect(inventory).toBeDefined();
      expect(inventory.totalQuantity).toBe(4);
      expect(inventory.availableQuantity).toBe(4);
      expect(inventory.reservedQuantity).toBe(0);

      // Reconcile
      const rec = await orderService.reconcileTicketOwnershipAndInventory({
        userId: user.id,
        ticketCategoryId: testCategory.id,
      });
      expect(rec.isConsistent).toBe(true);
      expect(rec.discrepancies).toHaveLength(0);
      expect(rec.tickets.total).toBe(4);
      expect(rec.tickets.available).toBe(4);
      expect(rec.tickets.reserved).toBe(0);
    });

    it('2. Replaying the same purchase does not issue duplicate tickets', async () => {
      const { user } = await createFundedUser('buyer_replay');
      const idempKey = `test-replay-${crypto.randomUUID()}`;

      const firstPurchase = await ticketService.purchaseTickets({
        userId: user.id,
        eventId: testEvent.id,
        categoryId: testCategory.id,
        quantity: 3,
        idempotencyKey: idempKey,
      });
      expect(firstPurchase.tickets).toHaveLength(3);

      // Replay with identical key
      const replayPurchase = await ticketService.purchaseTickets({
        userId: user.id,
        eventId: testEvent.id,
        categoryId: testCategory.id,
        quantity: 3,
        idempotencyKey: idempKey,
      });
      expect(replayPurchase.isDuplicate).toBe(true);
      expect(replayPurchase.tickets).toHaveLength(3);

      // Verify no duplicates created
      const allTickets = await prisma.ticket.findMany({
        where: { ownerId: user.id, categoryId: testCategory.id },
      });
      expect(allTickets).toHaveLength(3);

      const inventory = await orderService.getUserTicketInventory({
        userId: user.id,
        ticketCategoryId: testCategory.id,
      });
      expect(inventory.totalQuantity).toBe(3);
      expect(inventory.availableQuantity).toBe(3);
    });
  });

  // =========================================================================
  // 3, 4 & 5: Sell-Order Reservations and Ownership Guards
  // =========================================================================
  describe('2. Sell-Order Reservations and Allocation Guards', () => {
    it("3. A sell order cannot reserve another user's ticket", async () => {
      const { user: legitimateOwner } = await createFundedUser('owner_a');
      const { user: unauthorizedUser } = await createFundedUser('owner_b');

      // Legitimate owner purchases 2 tickets
      await ticketService.purchaseTickets({
        userId: legitimateOwner.id,
        eventId: testEvent.id,
        categoryId: testCategory.id,
        quantity: 2,
      });

      // Unauthorized user tries to place a SELL order
      await expect(
        orderService.placeLimitOrder({
          userId: unauthorizedUser.id,
          eventId: testEvent.id,
          ticketCategoryId: testCategory.id,
          side: 'ASK',
          price: 15000,
          quantity: 2,
          idempotencyKey: `unauth-sell-${crypto.randomUUID()}`,
        })
      ).rejects.toThrow(InsufficientInventoryError);

      // Legitimate owner's tickets remain unreserved
      const ownerTickets = await prisma.ticket.findMany({
        where: { ownerId: legitimateOwner.id },
      });
      expect(ownerTickets).toHaveLength(2);
      for (const t of ownerTickets) {
        expect(t.status).toBe('OWNED');
        expect(t.orderId).toBeNull();
      }
    });

    it('4. Two sell orders cannot reserve the same ticket', async () => {
      const { user: seller } = await createFundedUser('seller_contention');

      // Seller owns 3 tickets
      await ticketService.purchaseTickets({
        userId: seller.id,
        eventId: testEvent.id,
        categoryId: testCategory.id,
        quantity: 3,
      });

      // Place Sell Order 1 for 2 tickets
      const sellOrder1 = await orderService.placeLimitOrder({
        userId: seller.id,
        eventId: testEvent.id,
        ticketCategoryId: testCategory.id,
        side: 'ASK',
        price: 20000,
        quantity: 2,
        idempotencyKey: `sell-1-${crypto.randomUUID()}`,
      });
      expect(sellOrder1.orderId).toBeDefined();

      // Seller only has 1 available ticket left; attempting to sell 2 more must fail
      await expect(
        orderService.placeLimitOrder({
          userId: seller.id,
          eventId: testEvent.id,
          ticketCategoryId: testCategory.id,
          side: 'ASK',
          price: 20000,
          quantity: 2,
          idempotencyKey: `sell-2-${crypto.randomUUID()}`,
        })
      ).rejects.toThrow(InsufficientInventoryError);

      // Verify Sell Order 1 holds its 2 allocated tickets exclusively
      const reservedTickets = await prisma.ticket.findMany({
        where: { orderId: sellOrder1.orderId },
      });
      expect(reservedTickets).toHaveLength(2);
      for (const t of reservedTickets) {
        expect(t.status).toBe('LISTED');
      }

      // Reconcile
      const rec = await orderService.reconcileTicketOwnershipAndInventory({
        userId: seller.id,
        ticketCategoryId: testCategory.id,
      });
      expect(rec.isConsistent).toBe(true);
      expect(rec.tickets.available).toBe(1);
      expect(rec.tickets.reserved).toBe(2);
    });

    it('5. Sell-order reservation records identify the actual allocated tickets', async () => {
      const { user: seller } = await createFundedUser('seller_allocated');

      await ticketService.purchaseTickets({
        userId: seller.id,
        eventId: testEvent.id,
        categoryId: testCategory.id,
        quantity: 3,
      });

      const sellOrder = await orderService.placeLimitOrder({
        userId: seller.id,
        eventId: testEvent.id,
        ticketCategoryId: testCategory.id,
        side: 'ASK',
        price: 18000,
        quantity: 2,
        idempotencyKey: `sell-alloc-${crypto.randomUUID()}`,
      });

      const allocated = await prisma.ticket.findMany({
        where: {
          orderId: sellOrder.orderId,
          status: 'LISTED',
        },
      });
      expect(allocated).toHaveLength(2);
      expect(allocated.every((t) => t.ownerId === seller.id)).toBe(true);
      expect(allocated.every((t) => t.categoryId === testCategory.id)).toBe(true);
    });
  });

  // =========================================================================
  // 6, 7, 8, 9 & 10: Trade Settlement and Ownership Transfers
  // =========================================================================
  describe('3. Matching, Partial Fills, Settlement and Ownership Transfer', () => {
    it('6, 7, 8, 9 & 10: Partial fill (2 of 3) then full fill transfers ownership, appends history, and preserves consistency', async () => {
      const { user: seller } = await createFundedUser('seller_trade');
      const { user: buyer1 } = await createFundedUser('buyer_trade_1');
      const { user: buyer2 } = await createFundedUser('buyer_trade_2');

      // 1. Seller buys 3 tickets
      await ticketService.purchaseTickets({
        userId: seller.id,
        eventId: testEvent.id,
        categoryId: testCategory.id,
        quantity: 3,
      });

      // 2. Seller places ASK for 3 tickets @ 150 paise (1.50 INR)
      const sellOrder = await orderService.placeLimitOrder({
        userId: seller.id,
        eventId: testEvent.id,
        ticketCategoryId: testCategory.id,
        side: 'ASK',
        price: 15000,
        quantity: 3,
        idempotencyKey: `sell-3qty-${crypto.randomUUID()}`,
      });

      // 3. Buyer 1 places BID for 2 tickets @ 15000 paise -> triggers partial fill (2 of 3)
      const buyOrder1 = await orderService.placeLimitOrder({
        userId: buyer1.id,
        eventId: testEvent.id,
        ticketCategoryId: testCategory.id,
        side: 'BID',
        price: 15000,
        quantity: 2,
        idempotencyKey: `buy-2qty-${crypto.randomUUID()}`,
      });

      expect(buyOrder1.executions).toHaveLength(1);
      expect(buyOrder1.executions[0].quantity).toBe(2);

      // Verify 6: exactly 2 tickets were transferred to Buyer 1
      const buyer1Tickets = await prisma.ticket.findMany({
        where: { ownerId: buyer1.id, categoryId: testCategory.id },
      });
      expect(buyer1Tickets).toHaveLength(2);
      for (const t of buyer1Tickets) {
        expect(t.status).toBe('OWNED');
        expect(t.orderId).toBeNull();
      }

      // Verify 1 ticket remains reserved for Seller under sellOrder
      const sellerRemainingReserved = await prisma.ticket.findMany({
        where: {
          ownerId: seller.id,
          orderId: sellOrder.orderId,
          status: 'LISTED',
        },
      });
      expect(sellerRemainingReserved).toHaveLength(1);

      // Verify 8 & 9: Ownership history on transferred tickets has PRIMARY then RESALE
      for (const t of buyer1Tickets) {
        const history = await prisma.ticketOwnership.findMany({
          where: { ticketId: t.id },
          orderBy: { acquiredAt: 'asc' },
        });
        expect(history).toHaveLength(2);
        expect(history[0].ownerId).toBe(seller.id);
        expect(history[0].source).toBe('PRIMARY');
        expect(history[1].ownerId).toBe(buyer1.id);
        expect(history[1].source).toBe('RESALE');

        // Check TicketTransfer record
        const transfers = await prisma.ticketTransfer.findMany({
          where: { ticketId: t.id },
        });
        expect(transfers).toHaveLength(1);
        expect(transfers[0].fromUserId).toBe(seller.id);
        expect(transfers[0].toUserId).toBe(buyer1.id);
        expect(transfers[0].status).toBe('COMPLETED');
      }

      // 4. Buyer 2 places BID for remaining 1 ticket @ 15000 paise -> full fill
      const buyOrder2 = await orderService.placeLimitOrder({
        userId: buyer2.id,
        eventId: testEvent.id,
        ticketCategoryId: testCategory.id,
        side: 'BID',
        price: 15000,
        quantity: 1,
        idempotencyKey: `buy-1qty-${crypto.randomUUID()}`,
      });

      expect(buyOrder2.executions).toHaveLength(1);
      expect(buyOrder2.executions[0].quantity).toBe(1);

      // Verify 7: Full fill transferred every ticket; 0 tickets left under sellOrder
      const zeroReserved = await prisma.ticket.findMany({
        where: { orderId: sellOrder.orderId },
      });
      expect(zeroReserved).toHaveLength(0);

      const buyer2Tickets = await prisma.ticket.findMany({
        where: { ownerId: buyer2.id, categoryId: testCategory.id },
      });
      expect(buyer2Tickets).toHaveLength(1);
      expect(buyer2Tickets[0].status).toBe('OWNED');
      expect(buyer2Tickets[0].orderId).toBeNull();

      // Verify 10: Aggregate inventory matches actual ticket ownership after settlement
      const recSeller = await orderService.reconcileTicketOwnershipAndInventory({
        userId: seller.id,
        ticketCategoryId: testCategory.id,
      });
      expect(recSeller.isConsistent).toBe(true);
      expect(recSeller.aggregate.totalQuantity).toBe(0);
      expect(recSeller.aggregate.availableQuantity).toBe(0);
      expect(recSeller.aggregate.reservedQuantity).toBe(0);

      const recBuyer1 = await orderService.reconcileTicketOwnershipAndInventory({
        userId: buyer1.id,
        ticketCategoryId: testCategory.id,
      });
      expect(recBuyer1.isConsistent).toBe(true);
      expect(recBuyer1.aggregate.totalQuantity).toBe(2);
      expect(recBuyer1.aggregate.availableQuantity).toBe(2);

      const recBuyer2 = await orderService.reconcileTicketOwnershipAndInventory({
        userId: buyer2.id,
        ticketCategoryId: testCategory.id,
      });
      expect(recBuyer2.isConsistent).toBe(true);
      expect(recBuyer2.aggregate.totalQuantity).toBe(1);
      expect(recBuyer2.aggregate.availableQuantity).toBe(1);
    });
  });

  // =========================================================================
  // 11 & 12: Cancellations and Unfilled Ticket Releases
  // =========================================================================
  describe('4. Order Cancellations and Safe Reservation Releases', () => {
    it('11. Cancelling an unfilled sell order releases all its reserved tickets (quantity: 4)', async () => {
      const { user: seller } = await createFundedUser('seller_cancel_all');

      await ticketService.purchaseTickets({
        userId: seller.id,
        eventId: testEvent.id,
        categoryId: testCategory.id,
        quantity: 4,
      });

      const sellOrder = await orderService.placeLimitOrder({
        userId: seller.id,
        eventId: testEvent.id,
        ticketCategoryId: testCategory.id,
        side: 'ASK',
        price: 25000,
        quantity: 4,
        idempotencyKey: `sell-cancel-4-${crypto.randomUUID()}`,
      });

      // Verify 4 tickets were LISTED
      const listedBefore = await prisma.ticket.findMany({
        where: { orderId: sellOrder.orderId, status: 'LISTED' },
      });
      expect(listedBefore).toHaveLength(4);

      // Cancel the order
      const cancelResult = await orderService.cancelLimitOrder({
        userId: seller.id,
        orderId: sellOrder.orderId,
        idempotencyKey: `cancel-${sellOrder.orderId}`,
      });
      expect(cancelResult.cancelledQuantity).toBe(4);

      // Verify all 4 tickets released to OWNED with orderId = null
      const ticketsAfter = await prisma.ticket.findMany({
        where: { ownerId: seller.id, categoryId: testCategory.id },
      });
      expect(ticketsAfter).toHaveLength(4);
      for (const t of ticketsAfter) {
        expect(t.status).toBe('OWNED');
        expect(t.orderId).toBeNull();
      }

      // Reconcile
      const rec = await orderService.reconcileTicketOwnershipAndInventory({
        userId: seller.id,
        ticketCategoryId: testCategory.id,
      });
      expect(rec.isConsistent).toBe(true);
      expect(rec.tickets.available).toBe(4);
      expect(rec.tickets.reserved).toBe(0);
    });

    it('12. Cancelling a partially filled order releases only its remaining unfilled tickets', async () => {
      const category = await createTestCategory('cancel_part');
      const { user: seller } = await createFundedUser('seller_cancel_partial');
      const { user: buyer } = await createFundedUser('buyer_cancel_partial');

      // Seller purchases 5 tickets
      await ticketService.purchaseTickets({
        userId: seller.id,
        eventId: testEvent.id,
        categoryId: category.id,
        quantity: 5,
      });

      // Seller lists all 5 tickets @ 30000 paise
      const sellOrder = await orderService.placeLimitOrder({
        userId: seller.id,
        eventId: testEvent.id,
        ticketCategoryId: category.id,
        side: 'ASK',
        price: 30000,
        quantity: 5,
        idempotencyKey: `sell-5qty-${crypto.randomUUID()}`,
      });

      // Buyer buys 2 tickets -> partial fill
      await orderService.placeLimitOrder({
        userId: buyer.id,
        eventId: testEvent.id,
        ticketCategoryId: category.id,
        side: 'BID',
        price: 30000,
        quantity: 2,
        idempotencyKey: `buy-2partial-${crypto.randomUUID()}`,
      });

      // Seller cancels the remaining order (remaining quantity: 3)
      const cancelResult = await orderService.cancelLimitOrder({
        userId: seller.id,
        orderId: sellOrder.orderId,
        idempotencyKey: `cancel-part-${sellOrder.orderId}`,
      });
      expect(cancelResult.cancelledQuantity).toBe(3);

      // Verify the 2 tickets transferred to buyer remain owned by buyer
      const buyerTickets = await prisma.ticket.findMany({
        where: { ownerId: buyer.id, categoryId: category.id },
      });
      expect(buyerTickets).toHaveLength(2);
      expect(buyerTickets.every((t) => t.status === 'OWNED' && t.orderId === null)).toBe(true);

      // Verify seller has 3 released tickets in OWNED status with orderId = null
      const sellerTickets = await prisma.ticket.findMany({
        where: { ownerId: seller.id, categoryId: category.id },
      });
      expect(sellerTickets).toHaveLength(3);
      expect(sellerTickets.every((t) => t.status === 'OWNED' && t.orderId === null)).toBe(true);

      // Reconcile both accounts
      const recSeller = await orderService.reconcileTicketOwnershipAndInventory({
        userId: seller.id,
        ticketCategoryId: category.id,
      });
      expect(recSeller.isConsistent).toBe(true);
      expect(recSeller.tickets.available).toBe(3);
      expect(recSeller.tickets.reserved).toBe(0);

      const recBuyer = await orderService.reconcileTicketOwnershipAndInventory({
        userId: buyer.id,
        ticketCategoryId: category.id,
      });
      expect(recBuyer.isConsistent).toBe(true);
      expect(recBuyer.tickets.available).toBe(2);
      expect(recBuyer.tickets.reserved).toBe(0);
    });
  });

  // =========================================================================
  // 13, 14 & 15: Settlement Rollbacks, Idempotency, and Recovery
  // =========================================================================
  describe('5. Settlement Atomicity, Rollbacks, and Recovery', () => {
    it('13. A rolled-back settlement changes neither ticket ownership nor aggregate inventory', async () => {
      const { user: seller } = await createFundedUser('seller_rollback');
      const { user: buyer } = await createFundedUser('buyer_rollback');

      await ticketService.purchaseTickets({
        userId: seller.id,
        eventId: testEvent.id,
        categoryId: testCategory.id,
        quantity: 2,
      });

      const sellOrder = await orderService.placeLimitOrder({
        userId: seller.id,
        eventId: testEvent.id,
        ticketCategoryId: testCategory.id,
        side: 'ASK',
        price: 12000,
        quantity: 2,
        idempotencyKey: `sell-rb-${crypto.randomUUID()}`,
      });

      // Directly create an execution without settlement to simulate mid-transaction failure
      const execution = await prisma.execution.create({
        data: {
          incomingOrderId: sellOrder.orderId,
          restingOrderId: sellOrder.orderId, // will fail invariant in _settle
          price: 12000,
          quantity: 2,
          settlementStatus: 'PENDING',
        },
      });

      // Calling settlement with invalid execution triggers invariant failure and rollback
      await expect(
        tradeSettlementService.settleExecution({ executionId: execution.id })
      ).rejects.toThrow();

      // Verify tickets remain listed under seller with zero ownership changes
      const sellerTickets = await prisma.ticket.findMany({
        where: { orderId: sellOrder.orderId },
      });
      expect(sellerTickets).toHaveLength(2);
      for (const t of sellerTickets) {
        expect(t.ownerId).toBe(seller.id);
        expect(t.status).toBe('LISTED');
      }

      // Buyer owns 0 tickets
      const buyerTickets = await prisma.ticket.findMany({
        where: { ownerId: buyer.id },
      });
      expect(buyerTickets).toHaveLength(0);
    });

    it('14. Replaying settlement does not duplicate ticket transfers or history', async () => {
      const { user: seller } = await createFundedUser('seller_replay_settle');
      const { user: buyer } = await createFundedUser('buyer_replay_settle');

      await ticketService.purchaseTickets({
        userId: seller.id,
        eventId: testEvent.id,
        categoryId: testCategory.id,
        quantity: 2,
      });

      await orderService.placeLimitOrder({
        userId: seller.id,
        eventId: testEvent.id,
        ticketCategoryId: testCategory.id,
        side: 'ASK',
        price: 10000,
        quantity: 2,
        idempotencyKey: `sell-repsettle-${crypto.randomUUID()}`,
      });

      const buyOrder = await orderService.placeLimitOrder({
        userId: buyer.id,
        eventId: testEvent.id,
        ticketCategoryId: testCategory.id,
        side: 'BID',
        price: 10000,
        quantity: 2,
        idempotencyKey: `buy-repsettle-${crypto.randomUUID()}`,
      });

      const executionId = buyOrder.executions[0].id;

      // Replay settlement
      const replayOutcome = await tradeSettlementService.settleExecution({ executionId });
      expect(replayOutcome.isIdempotentReplay).toBe(true);

      // Verify exactly 2 tickets owned by buyer
      const buyerTickets = await prisma.ticket.findMany({
        where: { ownerId: buyer.id },
      });
      expect(buyerTickets).toHaveLength(2);

      // Verify exactly 1 RESALE ownership record per ticket
      for (const t of buyerTickets) {
        const resaleOwnerships = await prisma.ticketOwnership.findMany({
          where: { ticketId: t.id, source: 'RESALE' },
        });
        expect(resaleOwnerships).toHaveLength(1);

        const transfers = await prisma.ticketTransfer.findMany({
          where: { ticketId: t.id },
        });
        expect(transfers).toHaveLength(1);
      }
    });

    it('15. Recovery after a simulated failure preserves ownership and financial consistency', async () => {
      const category = await createTestCategory('recov');
      const { user: seller } = await createFundedUser('seller_recov');
      const { user: buyer, wallet: buyerWallet } = await createFundedUser('buyer_recov');

      const purchaseResult = await ticketService.purchaseTickets({
        userId: seller.id,
        eventId: testEvent.id,
        categoryId: category.id,
        quantity: 2,
      });

      // Create sell order and list seller's tickets
      const sellOrder = await prisma.order.create({
        data: {
          userId: seller.id,
          eventId: testEvent.id,
          ticketCategoryId: category.id,
          side: 'ASK',
          price: 11000,
          initialQuantity: 2,
          remainingQuantity: 0,
          status: 'FILLED',
          idempotencyKey: `sell-recov-${crypto.randomUUID()}`,
        },
      });

      await prisma.ticket.updateMany({
        where: { id: { in: purchaseResult.tickets.map((t) => t.id) } },
        data: { status: 'LISTED', orderId: sellOrder.id },
      });

      await prisma.userTicketInventory.update({
        where: {
          userId_ticketCategoryId: {
            userId: seller.id,
            ticketCategoryId: category.id,
          },
        },
        data: {
          availableQuantity: 0,
          reservedQuantity: 2,
        },
      });

      // Create buy order and hold
      const buyOrder = await prisma.order.create({
        data: {
          userId: buyer.id,
          eventId: testEvent.id,
          ticketCategoryId: category.id,
          side: 'BID',
          price: 11000,
          initialQuantity: 2,
          remainingQuantity: 0,
          status: 'FILLED',
          idempotencyKey: `buy-recov-${crypto.randomUUID()}`,
        },
      });

      const buyerHoldPaise = BigInt(11000) * 2n;
      await walletService.reserveFunds({
        walletId: buyerWallet.id,
        userId: buyer.id,
        amount: buyerHoldPaise,
        orderId: buyOrder.id,
        idempotencyKey: `hold-recov-${crypto.randomUUID()}`,
        referenceType: 'ORDER',
        referenceId: buyOrder.id,
      });

      // Create unsettled Execution (simulating crash before settlement)
      const execution = await prisma.execution.create({
        data: {
          incomingOrderId: buyOrder.id,
          restingOrderId: sellOrder.id,
          price: 11000,
          quantity: 2,
          settlementStatus: 'PENDING',
          retryCount: 0,
          nextRetryAt: null,
        },
      });

      // Run settlement recovery
      const recoveryResults = await tradeSettlementService.recoverUnsettled({
        batchSize: 10,
        afterSequenceNumber: BigInt(execution.sequenceNumber) - 1n,
        now: new Date(),
      });

      const executionResult = recoveryResults.find((r) => r.executionId === execution.id);
      expect(executionResult).toBeDefined();
      expect(executionResult.settled).toBe(true);

      // Verify tickets transferred and ownership reconciled
      const buyerTickets = await prisma.ticket.findMany({
        where: { ownerId: buyer.id, categoryId: category.id },
      });
      expect(buyerTickets).toHaveLength(2);
      for (const t of buyerTickets) {
        expect(t.status).toBe('OWNED');
        expect(t.orderId).toBeNull();
      }

      const recBuyer = await orderService.reconcileTicketOwnershipAndInventory({
        userId: buyer.id,
        ticketCategoryId: category.id,
      });
      expect(recBuyer.isConsistent).toBe(true);
      expect(recBuyer.tickets.available).toBe(2);
    });
  });
});
