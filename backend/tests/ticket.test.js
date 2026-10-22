import { jest } from '@jest/globals';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../src/app.js';
import config from '../src/config/index.js';
import prisma from '../src/db/prisma.js';
import ticketService from '../src/services/ticket.service.js';

describe('Primary Ticket Purchase, Ownership & Transfer Tests', () => {
  const buyerUser = {
    id: 'user-buyer-101',
    email: 'buyer1@passflow.com',
    role: 'USER',
    name: 'Alice Buyer',
    walletId: 'wallet-buyer-101',
  };

  const recipientUser = {
    id: 'user-recipient-202',
    email: 'recipient@passflow.com',
    role: 'USER',
    name: 'Bob Recipient',
    walletId: 'wallet-recipient-202',
  };

  const buyerToken = jwt.sign(
    { userId: buyerUser.id, role: buyerUser.role },
    config.jwtSecret
  );

  const recipientToken = jwt.sign(
    { userId: recipientUser.id, role: recipientUser.role },
    config.jwtSecret
  );

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.spyOn(prisma.user, 'findUnique').mockImplementation(async ({ where }) => {
      if (where.id === buyerUser.id) return buyerUser;
      if (where.id === recipientUser.id) return recipientUser;
      if (where.email === recipientUser.email) return recipientUser;
      return null;
    });
  });

  // =========================================================================
  // Ticket Service Unit Logic
  // =========================================================================
  describe('ticketService Core Logic', () => {
    const eventId = 'event-uuid-001';
    const categoryId = '123e4567-e89b-12d3-a456-426614174000';

    describe('purchaseTickets()', () => {
      it('should throw 404 if event is not found', async () => {
        jest.spyOn(prisma.event, 'findUnique').mockResolvedValue(null);

        await expect(
          ticketService.purchaseTickets({
            userId: buyerUser.id,
            eventId: 'non-existent',
            categoryId,
            quantity: 2,
          })
        ).rejects.toThrow('Event not found');
      });

      it('should throw 400 if event is not PUBLISHED', async () => {
        jest.spyOn(prisma.event, 'findUnique').mockResolvedValue({
          id: eventId,
          status: 'DRAFT',
          categories: [{ id: categoryId, originalPrice: 100 }],
        });

        await expect(
          ticketService.purchaseTickets({
            userId: buyerUser.id,
            eventId,
            categoryId,
            quantity: 1,
          })
        ).rejects.toThrow(/Event must be PUBLISHED/);
      });

      it('should throw 400 if inventory availableQuantity is less than requested quantity', async () => {
        jest.spyOn(prisma.event, 'findUnique').mockResolvedValue({
          id: eventId,
          name: 'Summer Concert',
          status: 'PUBLISHED',
          categories: [{ id: categoryId, originalPrice: 50 }],
        });

        jest.spyOn(prisma, '$transaction').mockImplementation(async (callback) => {
          const tx = {
            ticketInventory: {
              findUnique: jest.fn().mockResolvedValue({
                categoryId,
                availableQuantity: 1, // Only 1 available, requesting 5
              }),
            },
          };
          return callback(tx);
        });

        await expect(
          ticketService.purchaseTickets({
            userId: buyerUser.id,
            eventId,
            categoryId,
            quantity: 5,
          })
        ).rejects.toThrow(/Not enough tickets available/);
      });

      it('should throw 400 if user wallet has insufficient funds', async () => {
        jest.spyOn(prisma.event, 'findUnique').mockResolvedValue({
          id: eventId,
          name: 'Summer Concert',
          status: 'PUBLISHED',
          categories: [{ id: categoryId, originalPrice: 100 }],
        });

        jest.spyOn(prisma, '$transaction').mockImplementation(async (callback) => {
          const tx = {
            ticketInventory: {
              findUnique: jest.fn().mockResolvedValue({
                categoryId,
                availableQuantity: 10,
              }),
              update: jest.fn(),
            },
            ticketCategory: { update: jest.fn() },
            wallet: {
              findUnique: jest.fn().mockResolvedValue({
                id: 'wallet-1',
                userId: buyerUser.id,
                availableBalance: 5000n, // 50.00 INR in paise, but 1 ticket = 10000 paise (100 INR)
                reservedBalance: 0n,
                version: 1n,
              }),
            },
          };
          return callback(tx);
        });

        await expect(
          ticketService.purchaseTickets({
            userId: buyerUser.id,
            eventId,
            categoryId,
            quantity: 1,
          })
        ).rejects.toThrow(/Insufficient wallet balance/);
      });

      it('should successfully debit wallet, update inventory, and create Ticket + TicketOwnership in one transaction', async () => {
        jest.spyOn(prisma.event, 'findUnique').mockResolvedValue({
          id: eventId,
          name: 'Summer Concert',
          status: 'PUBLISHED',
          categories: [{ id: categoryId, name: 'VIP', originalPrice: 150 }],
        });

        const mockCreatedTicket = {
          id: 'ticket-created-999',
          eventId,
          categoryId,
          ownerId: buyerUser.id,
          faceValue: 150,
          currentPrice: 150,
          status: 'OWNED',
        };

        jest.spyOn(prisma, '$transaction').mockImplementation(async (callback) => {
          const tx = {
            ticketInventory: {
              findUnique: jest.fn().mockResolvedValue({
                categoryId,
                availableQuantity: 10,
              }),
              update: jest.fn().mockResolvedValue({
                categoryId,
                availableQuantity: 9,
              }),
            },
            ticketCategory: { update: jest.fn() },
            wallet: {
              findUnique: jest.fn().mockResolvedValue({
                id: 'wallet-1',
                userId: buyerUser.id,
                availableBalance: 50000n, // 500.00 INR
                reservedBalance: 0n,
                version: 1n,
              }),
              update: jest.fn().mockResolvedValue({
                id: 'wallet-1',
                availableBalance: 35000n,
                version: 2n,
              }),
            },
            transaction: {
              create: jest.fn().mockResolvedValue({
                id: 'tx-purch-001',
                amount: -15000n,
                type: 'PURCHASE',
                status: 'COMPLETED',
              }),
            },
            walletLedgerEntry: {
              create: jest.fn().mockResolvedValue({ id: 'ledger-001' }),
            },
            ticket: {
              create: jest.fn().mockResolvedValue(mockCreatedTicket),
            },
            ticketOwnership: {
              create: jest.fn().mockResolvedValue({
                id: 'ownership-001',
                ticketId: mockCreatedTicket.id,
                ownerId: buyerUser.id,
                source: 'PRIMARY',
              }),
            },
          };
          return callback(tx);
        });

        const purchase = await ticketService.purchaseTickets({
          userId: buyerUser.id,
          eventId,
          categoryId,
          quantity: 1,
        });

        expect(purchase.tickets).toHaveLength(1);
        expect(purchase.tickets[0].id).toBe('ticket-created-999');
        expect(purchase.amountDebited).toBe('150.00');
        expect(purchase.newWalletBalance).toBe('350.00');
        expect(purchase.transactionId).toBe('tx-purch-001');
      });
    });

    describe('transferTicket()', () => {
      const ticketId = 'ticket-transfer-001';

      it('should reject transfer if caller is not the ticket owner (403)', async () => {
        jest.spyOn(prisma.ticket, 'findUnique').mockResolvedValue({
          id: ticketId,
          ownerId: 'someone-else',
          status: 'OWNED',
        });

        await expect(
          ticketService.transferTicket({
            ticketId,
            fromUserId: buyerUser.id,
            toUserId: recipientUser.id,
          })
        ).rejects.toThrow(/Only the current owner can initiate a transfer/);
      });

      it('should reject transfer if ticket is not in OWNED status (e.g. LISTED or USED)', async () => {
        jest.spyOn(prisma.ticket, 'findUnique').mockResolvedValue({
          id: ticketId,
          ownerId: buyerUser.id,
          status: 'LISTED',
        });

        await expect(
          ticketService.transferTicket({
            ticketId,
            fromUserId: buyerUser.id,
            toUserId: recipientUser.id,
          })
        ).rejects.toThrow(/Must be in 'OWNED' status/);
      });

      it('should reject transfer if trying to transfer to self', async () => {
        jest.spyOn(prisma.ticket, 'findUnique').mockResolvedValue({
          id: ticketId,
          ownerId: buyerUser.id,
          status: 'OWNED',
        });

        let error;
        try {
          await ticketService.transferTicket({
            ticketId,
            fromUserId: buyerUser.id,
            toUserId: buyerUser.id,
          });
        } catch (err) {
          error = err;
        }

        expect(error).toBeDefined();
        expect(error.statusCode).toBe(400);
        expect(error.code).toBe('SELF_TRANSFER_DISALLOWED');
        expect(error.message).toMatch(/cannot transfer a ticket to yourself/i);
      });

      it('should successfully complete transfer, reassign owner, and create TicketTransfer + TicketOwnership', async () => {
        jest.spyOn(prisma.ticket, 'findUnique').mockResolvedValue({
          id: ticketId,
          ownerId: buyerUser.id,
          status: 'OWNED',
        });

        jest.spyOn(prisma, '$transaction').mockImplementation(async (callback) => {
          const tx = {
            ticketTransfer: {
              create: jest.fn().mockResolvedValue({
                id: 'transfer-rec-777',
                ticketId,
                fromUserId: buyerUser.id,
                toUserId: recipientUser.id,
                status: 'COMPLETED',
              }),
            },
            ticket: {
              update: jest.fn().mockResolvedValue({
                id: ticketId,
                ownerId: recipientUser.id,
                status: 'OWNED',
              }),
            },
            ticketOwnership: {
              create: jest.fn().mockResolvedValue({
                id: 'ownership-rec-888',
                ticketId,
                ownerId: recipientUser.id,
                source: 'TRANSFER',
              }),
            },
          };
          return callback(tx);
        });

        const result = await ticketService.transferTicket({
          ticketId,
          fromUserId: buyerUser.id,
          recipientEmail: recipientUser.email,
        });

        expect(result.status).toBe('COMPLETED');
        expect(result.transferId).toBe('transfer-rec-777');
        expect(result.toUser.email).toBe(recipientUser.email);
      });
    });
  });

  // =========================================================================
  // HTTP REST API Integration Tests
  // =========================================================================
  describe('HTTP REST Routes', () => {
    const validCategoryId = '123e4567-e89b-12d3-a456-426614174000';
    const sampleTicket = {
      id: 'ticket-http-001',
      eventId: 'event-http-001',
      categoryId: validCategoryId,
      ownerId: buyerUser.id,
      faceValue: '100.00',
      currentPrice: '100.00',
      status: 'OWNED',
      createdAt: new Date().toISOString(),
      event: { id: 'event-http-001', name: 'Gala Night' },
      category: { id: validCategoryId, name: 'General Admission' },
    };

    describe('POST /events/:id/purchase', () => {
      it('should reject unauthenticated requests with 401', async () => {
        const res = await request(app)
          .post('/events/event-001/purchase')
          .send({ categoryId: validCategoryId, quantity: 2 });

        expect(res.statusCode).toBe(401);
        expect(res.body.success).toBe(false);
      });

      it('should reject invalid body with 400 (missing categoryId or non-positive quantity)', async () => {
        const res = await request(app)
          .post('/events/event-001/purchase')
          .set('Authorization', `Bearer ${buyerToken}`)
          .send({ quantity: -1 });

        expect(res.statusCode).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
      });

      it('should return 201 on successful purchase', async () => {
        jest.spyOn(ticketService, 'purchaseTickets').mockResolvedValue({
          tickets: [sampleTicket],
          transactionId: 'tx-123',
          amountDebited: '100.00',
          newWalletBalance: '900.00',
        });

        const res = await request(app)
          .post('/events/event-http-001/purchase')
          .set('Authorization', `Bearer ${buyerToken}`)
          .send({ categoryId: validCategoryId, quantity: 1 });

        expect(res.statusCode).toBe(201);
        expect(res.body.success).toBe(true);
        expect(res.body.data.tickets).toHaveLength(1);
        expect(res.body.data.amountDebited).toBe('100.00');
      });
    });

    describe('GET /tickets/me', () => {
      it('should return 200 with tickets list for authenticated user', async () => {
        jest.spyOn(ticketService, 'getMyTickets').mockResolvedValue({
          tickets: [sampleTicket],
          pagination: { total: 1, page: 1, limit: 20, totalPages: 1 },
        });

        const res = await request(app)
          .get('/tickets/me')
          .set('Authorization', `Bearer ${buyerToken}`);

        expect(res.statusCode).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.tickets).toHaveLength(1);
      });
    });

    describe('GET /tickets/:id', () => {
      it('should return 200 with ticket details', async () => {
        jest.spyOn(ticketService, 'getTicketById').mockResolvedValue(sampleTicket);

        const res = await request(app)
          .get(`/tickets/${sampleTicket.id}`)
          .set('Authorization', `Bearer ${buyerToken}`);

        expect(res.statusCode).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.id).toBe(sampleTicket.id);
      });
    });

    describe('GET /tickets/:id/ownership', () => {
      it('should return 200 with complete ownership audit trail', async () => {
        const mockHistory = {
          ticketId: sampleTicket.id,
          currentOwnerId: buyerUser.id,
          totalTransfers: 0,
          history: [
            {
              id: 'own-1',
              ticketId: sampleTicket.id,
              ownerId: buyerUser.id,
              source: 'PRIMARY',
              acquiredAt: new Date().toISOString(),
            },
          ],
        };

        jest.spyOn(ticketService, 'getTicketOwnershipHistory').mockResolvedValue(mockHistory);

        const res = await request(app)
          .get(`/tickets/${sampleTicket.id}/ownership`)
          .set('Authorization', `Bearer ${buyerToken}`);

        expect(res.statusCode).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.history).toHaveLength(1);
        expect(res.body.data.history[0].source).toBe('PRIMARY');
      });
    });

    describe('POST /tickets/:id/transfer', () => {
      it('should reject unauthenticated requests with 401', async () => {
        const res = await request(app)
          .post(`/tickets/${sampleTicket.id}/transfer`)
          .send({ recipientEmail: 'bob@example.com' });

        expect(res.statusCode).toBe(401);
      });

      it('should reject if neither toUserId nor recipientEmail is provided', async () => {
        const res = await request(app)
          .post(`/tickets/${sampleTicket.id}/transfer`)
          .set('Authorization', `Bearer ${buyerToken}`)
          .send({});

        expect(res.statusCode).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
      });

      it('should return 200 with transfer outcome when valid', async () => {
        jest.spyOn(ticketService, 'transferTicket').mockResolvedValue({
          message: 'Ticket transferred successfully',
          transferId: 'tr-999',
          ticketId: sampleTicket.id,
          status: 'COMPLETED',
        });

        const res = await request(app)
          .post(`/tickets/${sampleTicket.id}/transfer`)
          .set('Authorization', `Bearer ${buyerToken}`)
          .send({ recipientEmail: 'bob@example.com' });

        expect(res.statusCode).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.transferId).toBe('tr-999');
      });
    });

    describe('GET /transfers/:id', () => {
      it('should return 200 with transfer status and participants', async () => {
        const mockTransfer = {
          id: 'transfer-123',
          ticketId: sampleTicket.id,
          fromUserId: buyerUser.id,
          toUserId: recipientUser.id,
          status: 'COMPLETED',
        };

        jest.spyOn(ticketService, 'getTransferById').mockResolvedValue(mockTransfer);

        const res = await request(app)
          .get('/transfers/transfer-123')
          .set('Authorization', `Bearer ${buyerToken}`);

        expect(res.statusCode).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.id).toBe('transfer-123');
        expect(res.body.data.status).toBe('COMPLETED');
      });
    });
  });
});
