import express from 'express';
import ticketController from '../controllers/ticket.controller.js';
import { authenticateUser } from '../middleware/auth.js';
import validate from '../middleware/validate.js';
import {
  purchaseTicketSchema,
  transferTicketSchema,
  listMyTicketsQuerySchema,
} from '../schemas/ticket.schema.js';

const router = express.Router();

// ==========================================
// Primary Ticket Purchase Endpoint
// ==========================================

// POST /events/:id/purchase - Buy at original face value (User only)
router.post(
  '/events/:id/purchase',
  authenticateUser,
  validate(purchaseTicketSchema),
  ticketController.purchaseTickets
);

// ==========================================
// User Ticket Portfolio & Details Endpoints
// ==========================================

// GET /tickets/me - Tickets owned by logged-in user (supports status filter)
router.get(
  '/tickets/me',
  authenticateUser,
  validate(listMyTicketsQuerySchema, 'query'),
  ticketController.getMyTickets
);

// GET /tickets/:id - Ticket details
router.get(
  '/tickets/:id',
  authenticateUser,
  ticketController.getTicketById
);

// GET /tickets/:id/ownership - Ownership history audit trail of the ticket
router.get(
  '/tickets/:id/ownership',
  authenticateUser,
  ticketController.getTicketOwnershipHistory
);

// ==========================================
// Direct Peer-to-Peer Transfer Endpoints
// ==========================================

// POST /tickets/:id/transfer - Direct (non-market) transfer to another user
router.post(
  '/tickets/:id/transfer',
  authenticateUser,
  validate(transferTicketSchema),
  ticketController.transferTicket
);

// GET /transfers/:id - Transfer status and details
router.get(
  '/transfers/:id',
  authenticateUser,
  ticketController.getTransferById
);

export default router;
