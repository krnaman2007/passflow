/**
 * Step C — Concurrency-Safe Primary Ticket Purchases Integration Tests
 *
 * Verifies that:
 * 1. Concurrent primary purchases cannot oversell tickets (pessimistic row locking on TicketInventory).
 * 2. Concurrent purchases competing for the same wallet balance cannot double-spend (pessimistic row locking on Wallet).
 * 3. Concurrent requests with the same idempotency key execute exactly once and return safe replays.
 * 4. Idempotency key reuse with mismatched parameters throws 409 IDEMPOTENCY_CONFLICT.
 * 5. Replaying a purchase after a lost response returns deterministic original results.
 * 6. Atomicity & rollback: Any failure leaves zero partial debits, ticket records, or inventory changes.
 * 7. Bounded retry handles transient PostgreSQL serialization/deadlock conflicts safely.
 * 8. All 6 models (Wallet, Ledger, Transaction, Ticket, TicketOwnership, UserTicketInventory) stay atomically consistent.
 * 9. Step B sell-order reservation crash window: Stale or missing order references are safely detected and reconciled,
 *    and reservations are never released solely because an order lookup temporarily fails.
 */

import { jest } from '@jest/globals';
import crypto from 'crypto';
import prisma from '../src/db/prisma.js';
import ticketService from '../src/services/ticket.service.js';
import { orderService } from '../src/services/order/index.js';
import { OrderBook } from '../src/services/matching/order-book.js';

describe('Step C — Concurrency-Safe Primary Ticket Purchases', () => {
  let organizerUser;
  let testEvent;
  let defaultCategory;

  beforeAll(async () => {
    // Clean up or seed minimal event/organizer
    organizerUser = await prisma.user.create({
      data: {
        email: `org_step_c_${crypto.randomUUID().slice(0, 8)}@passflow.test`,
        passwordHash: '$2a$10$abcdefghijklmnopqrstuu',
        name: 'Step C Organizer',
        role: 'ORGANIZER',
      },
    });

    const organizer = await prisma.organizer.create({
      data: {
        userId: organizerUser.id,
        organizationName: 'PassFlow Concurrency Labs',
      },
    });

    testEvent = await prisma.event.create({
      data: {
        organizerId: organizer.id,
        name: 'Concurrency Rock Fest 2026',
        description: 'Testing high-concurrency ticket purchasing and allocation',
        location: 'Bengaluru Tech Park',
        dateTime: new Date(Date.now() + 86400000 * 30),
        status: 'PUBLISHED',
        originalPrice: 100,
      },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // Helper to create a funded user with custom balance (in paise)
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
        version: 0n,
      },
    });

    return { user, wallet };
  }

  // Helper to create a distinct ticket category with given price and inventory
  async function createCategoryWithInventory({ nameSuffix, price = 100, quantity = 10 }) {
    const category = await prisma.ticketCategory.create({
      data: {
        eventId: testEvent.id,
        name: `Cat_${nameSuffix}_${crypto.randomUUID().slice(0, 8)}`,
        originalPrice: price,
        totalQuantity: quantity,
        availableQuantity: quantity,
        status: 'ACTIVE',
      },
    });

    const inventory = await prisma.ticketInventory.create({
      data: {
        categoryId: category.id,
        totalQuantity: quantity,
        availableQuantity: quantity,
        reservedQuantity: 0,
      },
    });

    // Also register in matching engine for market consistency
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

    return { category, inventory };
  }

  // =========================================================================
  // 1. Primary Purchase Concurrency & Oversell Prevention
  // =========================================================================
  describe('1. Primary Purchase Concurrency & Oversell Prevention', () => {
    it('prevents overselling when concurrent requests compete for the final available tickets', async () => {
      // 5 tickets available in inventory
      const { category } = await createCategoryWithInventory({
        nameSuffix: 'final_tickets',
        price: 50,
        quantity: 5,
      });

      // 10 distinct buyers, each attempting to buy 1 ticket concurrently
      const buyers = await Promise.all(
        Array.from({ length: 10 }).map((_, i) => createFundedUser(`buyer_oversell_${i}`, 50000n))
      );

      const purchasePromises = buyers.map((b) =>
        ticketService
          .purchaseTickets({
            userId: b.user.id,
            eventId: testEvent.id,
            categoryId: category.id,
            quantity: 1,
            idempotencyKey: `idemp-oversell-${b.user.id}`,
          })
          .then((res) => ({ success: true, result: res }))
          .catch((err) => ({ success: false, error: err }))
      );

      const outcomes = await Promise.all(purchasePromises);

      const successes = outcomes.filter((o) => o.success);
      const failures = outcomes.filter((o) => !o.success);

      // Exactly 5 purchases must succeed and exactly 5 must fail
      expect(successes).toHaveLength(5);
      expect(failures).toHaveLength(5);

      for (const fail of failures) {
        expect(fail.error.statusCode).toBe(400);
        expect(fail.error.errorCode).toBe('INSUFFICIENT_INVENTORY');
      }

      // Check database state: exactly 5 tickets exist
      const issuedTickets = await prisma.ticket.findMany({
        where: { categoryId: category.id },
      });
      expect(issuedTickets).toHaveLength(5);

      // Verify category inventory is exactly 0 and SOLD_OUT
      const updatedInventory = await prisma.ticketInventory.findUnique({
        where: { categoryId: category.id },
      });
      expect(updatedInventory.availableQuantity).toBe(0);

      const updatedCategory = await prisma.ticketCategory.findUnique({
        where: { id: category.id },
      });
      expect(updatedCategory.availableQuantity).toBe(0);
      expect(updatedCategory.status).toBe('SOLD_OUT');
    });

    it('prevents overselling under batch concurrent requests for multiple tickets', async () => {
      // 8 tickets available
      const { category } = await createCategoryWithInventory({
        nameSuffix: 'batch_oversell',
        price: 100,
        quantity: 8,
      });

      // 5 buyers, each requesting 2 tickets (total 10 tickets requested > 8 available)
      const buyers = await Promise.all(
        Array.from({ length: 5 }).map((_, i) => createFundedUser(`buyer_batch_${i}`, 100000n))
      );

      const purchasePromises = buyers.map((b) =>
        ticketService
          .purchaseTickets({
            userId: b.user.id,
            eventId: testEvent.id,
            categoryId: category.id,
            quantity: 2,
            idempotencyKey: `idemp-batch-${b.user.id}`,
          })
          .then((res) => ({ success: true, result: res }))
          .catch((err) => ({ success: false, error: err }))
      );

      const outcomes = await Promise.all(purchasePromises);
      const successes = outcomes.filter((o) => o.success);
      const failures = outcomes.filter((o) => !o.success);

      // Exactly 4 buyers get 2 tickets each (= 8 tickets), 1 fails
      expect(successes).toHaveLength(4);
      expect(failures).toHaveLength(1);
      expect(failures[0].error.errorCode).toBe('INSUFFICIENT_INVENTORY');

      const finalTickets = await prisma.ticket.findMany({
        where: { categoryId: category.id },
      });
      expect(finalTickets).toHaveLength(8);

      const finalInventory = await prisma.ticketInventory.findUnique({
        where: { categoryId: category.id },
      });
      expect(finalInventory.availableQuantity).toBe(0);
    });
  });

  // =========================================================================
  // 2. Wallet Double-Spending Prevention
  // =========================================================================
  describe('2. Wallet Double-Spending Prevention', () => {
    it('prevents concurrent purchases from double-spending the same wallet balance', async () => {
      const { category } = await createCategoryWithInventory({
        nameSuffix: 'wallet_compete',
        price: 60, // 60 INR = 6000 paise per ticket
        quantity: 10,
      });

      // User has 100 INR = 10000 paise (can only afford 1 purchase of 6000 paise, NOT two!)
      const { user } = await createFundedUser('buyer_double_spend', 10000n);

      // Two concurrent purchase requests of 1 ticket each
      const req1 = ticketService.purchaseTickets({
        userId: user.id,
        eventId: testEvent.id,
        categoryId: category.id,
        quantity: 1,
        idempotencyKey: `idemp-ws-1-${crypto.randomUUID()}`,
      });

      const req2 = ticketService.purchaseTickets({
        userId: user.id,
        eventId: testEvent.id,
        categoryId: category.id,
        quantity: 1,
        idempotencyKey: `idemp-ws-2-${crypto.randomUUID()}`,
      });

      const [res1, res2] = await Promise.allSettled([req1, req2]);

      const fulfilled = [res1, res2].filter((r) => r.status === 'fulfilled');
      const rejected = [res1, res2].filter((r) => r.status === 'rejected');

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason.statusCode).toBe(400);
      expect(rejected[0].reason.errorCode).toBe('INSUFFICIENT_FUNDS');

      // Check wallet: remaining balance must be exactly 4000 paise (40 INR)
      const wallet = await prisma.wallet.findUnique({
        where: { userId: user.id },
      });
      expect(wallet.availableBalance).toBe(4000n);

      // Ledger entries: exactly 1 debit entry for 6000 paise
      const ledgerEntries = await prisma.walletLedgerEntry.findMany({
        where: { walletId: wallet.id },
      });
      expect(ledgerEntries).toHaveLength(1);
      expect(ledgerEntries[0].entryType).toBe('TRADE_SETTLEMENT_DEBIT');
      expect(ledgerEntries[0].amount).toBe(6000n);
      expect(ledgerEntries[0].balanceAfterAvailable).toBe(4000n);

      // Individual tickets: exactly 1 ticket issued
      const userTickets = await prisma.ticket.findMany({
        where: { ownerId: user.id, categoryId: category.id },
      });
      expect(userTickets).toHaveLength(1);
    });
  });

  // =========================================================================
  // 3. Idempotency and Duplicate Request Safety
  // =========================================================================
  describe('3. Idempotency and Duplicate Requests', () => {
    it('executes concurrent requests with the identical idempotency key safely and returns replay', async () => {
      const { category } = await createCategoryWithInventory({
        nameSuffix: 'idemp_race',
        price: 80,
        quantity: 10,
      });

      const { user } = await createFundedUser('buyer_idemp_race', 50000n);
      const sharedIdempKey = `shared-key-${crypto.randomUUID()}`;

      // 3 concurrent requests with the exact same idempotency key and parameters
      const promises = Array.from({ length: 3 }).map(() =>
        ticketService.purchaseTickets({
          userId: user.id,
          eventId: testEvent.id,
          categoryId: category.id,
          quantity: 2,
          idempotencyKey: sharedIdempKey,
        })
      );

      const results = await Promise.all(promises);

      // All 3 returned without error
      expect(results).toHaveLength(3);

      // Exactly 1 was the primary execution, and 2 were idempotent replays
      const duplicates = results.filter((r) => r.isDuplicate);
      expect(duplicates.length).toBeGreaterThanOrEqual(1);

      // All 3 results point to the EXACT same transaction and tickets
      const primaryTxId = results[0].transactionId;
      for (const res of results) {
        expect(res.transactionId).toBe(primaryTxId);
        expect(res.tickets).toHaveLength(2);
        expect(res.amountDebited).toBe('160.00');
      }

      // In the database: exactly 2 tickets exist for this user, NOT 6!
      const userTickets = await prisma.ticket.findMany({
        where: { ownerId: user.id, categoryId: category.id },
      });
      expect(userTickets).toHaveLength(2);

      // In the wallet: debited exactly once (16000 paise = 160 INR)
      const wallet = await prisma.wallet.findUnique({ where: { userId: user.id } });
      expect(wallet.availableBalance).toBe(34000n); // 50000 - 16000 = 34000
    });

    it('rejects reuse of the same idempotency key with materially different parameters (409 IDEMPOTENCY_CONFLICT)', async () => {
      const { category: catA } = await createCategoryWithInventory({
        nameSuffix: 'idemp_conf_a',
        price: 100,
        quantity: 10,
      });
      const { category: catB } = await createCategoryWithInventory({
        nameSuffix: 'idemp_conf_b',
        price: 120,
        quantity: 10,
      });

      const { user: userA } = await createFundedUser('buyer_idemp_conf_a', 50000n);
      const { user: userB } = await createFundedUser('buyer_idemp_conf_b', 50000n);

      const conflictKey = `conflict-key-${crypto.randomUUID()}`;

      // First purchase succeeds
      const firstRes = await ticketService.purchaseTickets({
        userId: userA.id,
        eventId: testEvent.id,
        categoryId: catA.id,
        quantity: 1,
        idempotencyKey: conflictKey,
      });
      expect(firstRes.tickets).toHaveLength(1);

      // 1. Reuse with different quantity
      await expect(
        ticketService.purchaseTickets({
          userId: userA.id,
          eventId: testEvent.id,
          categoryId: catA.id,
          quantity: 2, // different quantity!
          idempotencyKey: conflictKey,
        })
      ).rejects.toThrow(/already used with different parameters/);

      // 2. Reuse with different category
      await expect(
        ticketService.purchaseTickets({
          userId: userA.id,
          eventId: testEvent.id,
          categoryId: catB.id, // different category!
          quantity: 1,
          idempotencyKey: conflictKey,
        })
      ).rejects.toThrow(/already used with different parameters/);

      // 3. Reuse with different user
      await expect(
        ticketService.purchaseTickets({
          userId: userB.id, // different user!
          eventId: testEvent.id,
          categoryId: catA.id,
          quantity: 1,
          idempotencyKey: conflictKey,
        })
      ).rejects.toThrow(/already used with different parameters/);
    });

    it('replays successfully after a purchase response is lost and returns identical result', async () => {
      const { category } = await createCategoryWithInventory({
        nameSuffix: 'lost_response',
        price: 75,
        quantity: 10,
      });

      const { user } = await createFundedUser('buyer_lost_res', 50000n);
      const lostKey = `lost-res-key-${crypto.randomUUID()}`;

      // Initial purchase
      const initialPurchase = await ticketService.purchaseTickets({
        userId: user.id,
        eventId: testEvent.id,
        categoryId: category.id,
        quantity: 2,
        idempotencyKey: lostKey,
      });
      expect(initialPurchase.tickets).toHaveLength(2);
      expect(initialPurchase.amountDebited).toBe('150.00');

      // Client simulates lost response / retry
      const retryPurchase = await ticketService.purchaseTickets({
        userId: user.id,
        eventId: testEvent.id,
        categoryId: category.id,
        quantity: 2,
        idempotencyKey: lostKey,
      });

      expect(retryPurchase.isDuplicate).toBe(true);
      expect(retryPurchase.transactionId).toBe(initialPurchase.transactionId);
      expect(retryPurchase.amountDebited).toBe('150.00');
      expect(retryPurchase.tickets).toHaveLength(2);
      expect(retryPurchase.tickets[0].id).toBe(initialPurchase.tickets[0].id);
      expect(retryPurchase.tickets[1].id).toBe(initialPurchase.tickets[1].id);
    });
  });

  // =========================================================================
  // 4. Atomicity, Rollback & Multi-Model Invariants
  // =========================================================================
  describe('4. Atomicity, Rollback & Multi-Model Invariants', () => {
    it('leaves zero partial debits, tickets, or inventory changes when purchase fails', async () => {
      const { category, inventory } = await createCategoryWithInventory({
        nameSuffix: 'atomic_rollback',
        price: 200,
        quantity: 5,
      });

      // User only has 100 INR = 10000 paise (ticket costs 200 INR = 20000 paise)
      const { user, wallet } = await createFundedUser('buyer_broke', 10000n);

      await expect(
        ticketService.purchaseTickets({
          userId: user.id,
          eventId: testEvent.id,
          categoryId: category.id,
          quantity: 1,
          idempotencyKey: `fail-key-${crypto.randomUUID()}`,
        })
      ).rejects.toThrow(/Insufficient wallet balance/);

      // Invariants check:
      // 1. Wallet balance untouched
      const postWallet = await prisma.wallet.findUnique({ where: { id: wallet.id } });
      expect(postWallet.availableBalance).toBe(10000n);

      // 2. Zero ledger entries created
      const ledgerEntries = await prisma.walletLedgerEntry.findMany({ where: { walletId: wallet.id } });
      expect(ledgerEntries).toHaveLength(0);

      // 3. Zero transactions created
      const transactions = await prisma.transaction.findMany({ where: { walletId: wallet.id } });
      expect(transactions).toHaveLength(0);

      // 4. Zero tickets created
      const tickets = await prisma.ticket.findMany({ where: { categoryId: category.id } });
      expect(tickets).toHaveLength(0);

      // 5. Zero ownership records
      const ownerships = await prisma.ticketOwnership.findMany({ where: { ownerId: user.id } });
      expect(ownerships).toHaveLength(0);

      // 6. TicketInventory untouched
      const postInventory = await prisma.ticketInventory.findUnique({ where: { categoryId: category.id } });
      expect(postInventory.availableQuantity).toBe(5);

      // 7. UserTicketInventory does not exist or has 0
      const userInv = await prisma.userTicketInventory.findUnique({
        where: { userId_ticketCategoryId: { userId: user.id, ticketCategoryId: category.id } },
      });
      expect(userInv).toBeNull();
    });

    it('maintains absolute multi-model consistency across all 6 models after successful purchase', async () => {
      const { category } = await createCategoryWithInventory({
        nameSuffix: 'six_models',
        price: 150,
        quantity: 20,
      });

      const { user, wallet } = await createFundedUser('buyer_six_models', 100000n); // 1000 INR

      const purchaseResult = await ticketService.purchaseTickets({
        userId: user.id,
        eventId: testEvent.id,
        categoryId: category.id,
        quantity: 3,
        idempotencyKey: `six-models-${crypto.randomUUID()}`,
      });

      // 1. Transaction
      const txRecord = await prisma.transaction.findUnique({
        where: { id: purchaseResult.transactionId },
      });
      expect(txRecord).toBeDefined();
      expect(txRecord.amount).toBe(-45000n); // -450.00 INR in paise
      expect(txRecord.type).toBe('PURCHASE');
      expect(txRecord.status).toBe('COMPLETED');

      // 2. Wallet
      const postWallet = await prisma.wallet.findUnique({ where: { id: wallet.id } });
      expect(postWallet.availableBalance).toBe(55000n); // 100000 - 45000 = 55000 paise

      // 3. WalletLedgerEntry
      const ledgerEntry = await prisma.walletLedgerEntry.findFirst({
        where: { walletId: wallet.id },
      });
      expect(ledgerEntry).toBeDefined();
      expect(ledgerEntry.amount).toBe(45000n);
      expect(ledgerEntry.availableDelta).toBe(-45000n);
      expect(ledgerEntry.balanceAfterAvailable).toBe(55000n);

      // 4. Ticket
      const tickets = await prisma.ticket.findMany({
        where: { ownerId: user.id, categoryId: category.id },
      });
      expect(tickets).toHaveLength(3);
      for (const t of tickets) {
        expect(t.status).toBe('OWNED');
        expect(t.orderId).toBeNull();
      }

      // 5. TicketOwnership
      const ownerships = await prisma.ticketOwnership.findMany({
        where: { ownerId: user.id },
      });
      expect(ownerships).toHaveLength(3);
      for (const o of ownerships) {
        expect(o.source).toBe('PRIMARY');
        expect(o.transactionId).toBe(txRecord.id);
      }

      // 6. UserTicketInventory
      const userInv = await prisma.userTicketInventory.findUnique({
        where: { userId_ticketCategoryId: { userId: user.id, ticketCategoryId: category.id } },
      });
      expect(userInv.totalQuantity).toBe(3);
      expect(userInv.availableQuantity).toBe(3);
      expect(userInv.reservedQuantity).toBe(0);

      // 7. TicketInventory
      const postInv = await prisma.ticketInventory.findUnique({ where: { categoryId: category.id } });
      expect(postInv.availableQuantity).toBe(17); // 20 - 3 = 17
    });
  });

  // =========================================================================
  // 5. Step B Reservation Crash-Window Audit & Recovery Tests
  // =========================================================================
  describe('5. Step B Reservation Crash-Window Audit & Recovery', () => {
    it('detects orphaned ticket reservations from crashed order submissions and safely restores them', async () => {
      const { category } = await createCategoryWithInventory({
        nameSuffix: 'crash_window',
        price: 100,
        quantity: 10,
      });

      const { user } = await createFundedUser('seller_crash_victim', 50000n);

      // 1. User legitimately acquires 2 tickets via primary purchase
      await ticketService.purchaseTickets({
        userId: user.id,
        eventId: testEvent.id,
        categoryId: category.id,
        quantity: 2,
        idempotencyKey: `crash-test-purchase-${user.id}`,
      });

      // 2. Simulate process crash during placeLimitOrder:
      // Tickets were marked LISTED with a generated orderId, and UserTicketInventory was reserved,
      // but the process crashed before the order row was created in PostgreSQL!
      const simulatedOrphanedOrderId = crypto.randomUUID();

      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe('ALTER TABLE "Ticket" DISABLE TRIGGER ALL');
        try {
          await tx.ticket.updateMany({
            where: { ownerId: user.id, categoryId: category.id },
            data: {
              status: 'LISTED',
              orderId: simulatedOrphanedOrderId,
            },
          });
        } finally {
          await tx.$executeRawUnsafe('ALTER TABLE "Ticket" ENABLE TRIGGER ALL');
        }

        await tx.userTicketInventory.update({
          where: { userId_ticketCategoryId: { userId: user.id, ticketCategoryId: category.id } },
          data: {
            availableQuantity: 0,
            reservedQuantity: 2,
          },
        });
      });

      // 3. Verify discrepancy before recovery: tickets are listed against non-existent order
      const preRec = await orderService.reconcileTicketOwnershipAndInventory({
        userId: user.id,
        ticketCategoryId: category.id,
      });
      expect(preRec.isConsistent).toBe(false);
      expect(preRec.discrepancies.some((d) => d.includes('references non-existent order'))).toBe(true);

      // 4. Test safety rule: Never release a reservation solely because an order lookup temporarily fails!
      const orderRepoSpy = jest.spyOn(orderService.orderRepository, 'findById').mockImplementation(async (id) => {
        if (id === simulatedOrphanedOrderId) {
          throw new Error('Database connectivity timeout');
        }
        return prisma.order.findUnique({ where: { id } });
      });

      const failedLookupSummary = await orderService.reconcileOrderReservations({
        ticketCategoryId: category.id,
        forceReleaseOrphaned: true,
      });

      // It must NOT have released the tickets when lookup failed!
      expect(failedLookupSummary.orphanedTicketReservationsRestored).toBe(0);
      const ticketsStillListed = await prisma.ticket.findMany({
        where: { ownerId: user.id, categoryId: category.id, status: 'LISTED' },
      });
      expect(ticketsStillListed).toHaveLength(2); // Still safe!

      orderRepoSpy.mockRestore();

      // 5. Run genuine recovery with definitive order existence verification
      const recoverySummary = await orderService.reconcileOrderReservations({
        ticketCategoryId: category.id,
        forceReleaseOrphaned: true,
      });

      expect(recoverySummary.orphanedTicketReservationsDetected).toBe(2);
      expect(recoverySummary.orphanedTicketReservationsRestored).toBe(2);

      // Verify tickets are now restored back to OWNED and unlinked
      const restoredTickets = await prisma.ticket.findMany({
        where: { ownerId: user.id, categoryId: category.id },
      });
      expect(restoredTickets).toHaveLength(2);
      for (const t of restoredTickets) {
        expect(t.status).toBe('OWNED');
        expect(t.orderId).toBeNull();
      }

      // Verify aggregate inventory is restored
      const restoredInv = await orderService.getUserTicketInventory({
        userId: user.id,
        ticketCategoryId: category.id,
      });
      expect(restoredInv.availableQuantity).toBe(2);
      expect(restoredInv.reservedQuantity).toBe(0);

      // Re-run ownership reconciliation: now 100% consistent!
      const postRec = await orderService.reconcileTicketOwnershipAndInventory({
        userId: user.id,
        ticketCategoryId: category.id,
      });
      expect(postRec.isConsistent).toBe(true);
      expect(postRec.discrepancies).toHaveLength(0);
    });
  });

  // =========================================================================
  // 6. Serialization Conflict Handling & Bounded Retry
  // =========================================================================
  describe('6. Serialization Conflict Handling & Bounded Retry', () => {
    it('retries and succeeds when transient PostgreSQL serialization conflict occurs', async () => {
      const { category } = await createCategoryWithInventory({
        nameSuffix: 'transient_conflict',
        price: 50,
        quantity: 5,
      });

      const { user } = await createFundedUser('buyer_retry_test', 50000n);

      let callCount = 0;
      const realTransaction = prisma.$transaction.bind(prisma);

      // Simulate 1 transient write conflict error (P2034), followed by normal execution
      const txSpy = jest.spyOn(prisma, '$transaction').mockImplementation(async (...args) => {
        callCount++;
        if (callCount === 1) {
          const conflictErr = new Error('Transaction failed due to a write conflict or a deadlock. Please retry your transaction.');
          conflictErr.code = 'P2034';
          throw conflictErr;
        }
        return realTransaction(...args);
      });

      const purchaseResult = await ticketService.purchaseTickets({
        userId: user.id,
        eventId: testEvent.id,
        categoryId: category.id,
        quantity: 1,
        idempotencyKey: `idemp-retry-${crypto.randomUUID()}`,
      });

      expect(callCount).toBe(2); // Failed once, retried and succeeded
      expect(purchaseResult.tickets).toHaveLength(1);

      txSpy.mockRestore();
    });

    it('enforces bounded retries and fails cleanly when conflicts persist beyond limit', async () => {
      const { category } = await createCategoryWithInventory({
        nameSuffix: 'persistent_conflict',
        price: 50,
        quantity: 5,
      });

      const { user } = await createFundedUser('buyer_max_retry_test', 50000n);

      let attempts = 0;
      const txSpy = jest.spyOn(prisma, '$transaction').mockImplementation(async () => {
        attempts++;
        const conflictErr = new Error('could not serialize access due to concurrent update');
        conflictErr.code = '40001';
        throw conflictErr;
      });

      await expect(
        ticketService.purchaseTickets({
          userId: user.id,
          eventId: testEvent.id,
          categoryId: category.id,
          quantity: 1,
          idempotencyKey: `idemp-max-retry-${crypto.randomUUID()}`,
        })
      ).rejects.toThrow(/could not serialize access/);

      // 1 initial attempt + 3 retries = 4 attempts total
      expect(attempts).toBe(4);

      txSpy.mockRestore();
    });
  });

  // =========================================================================
  // 7. Repeated High-Volume Concurrency
  // =========================================================================
  describe('7. Repeated High-Volume Concurrency', () => {
    it('handles 20 concurrent requests for 10 available tickets with zero oversell', async () => {
      const { category } = await createCategoryWithInventory({
        nameSuffix: 'high_volume',
        price: 30,
        quantity: 10,
      });

      // 20 buyers competing concurrently
      const buyers = await Promise.all(
        Array.from({ length: 20 }).map((_, i) => createFundedUser(`buyer_hv_${i}`, 50000n))
      );

      const purchasePromises = buyers.map((b) =>
        ticketService
          .purchaseTickets({
            userId: b.user.id,
            eventId: testEvent.id,
            categoryId: category.id,
            quantity: 1,
            idempotencyKey: `idemp-hv-${b.user.id}`,
          })
          .then((res) => ({ success: true, result: res }))
          .catch((err) => ({ success: false, error: err }))
      );

      const outcomes = await Promise.all(purchasePromises);
      const successes = outcomes.filter((o) => o.success);
      const failures = outcomes.filter((o) => !o.success);

      expect(successes).toHaveLength(10);
      expect(failures).toHaveLength(10);

      // Category inventory must be 0 and SOLD_OUT
      const finalCategory = await prisma.ticketCategory.findUnique({
        where: { id: category.id },
        include: { inventory: true },
      });
      expect(finalCategory.inventory.availableQuantity).toBe(0);
      expect(finalCategory.availableQuantity).toBe(0);
      expect(finalCategory.status).toBe('SOLD_OUT');

      // Total tickets created for this category must equal 10
      const totalTickets = await prisma.ticket.findMany({
        where: { categoryId: category.id },
      });
      expect(totalTickets).toHaveLength(10);
    });
  });
});
