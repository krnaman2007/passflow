import ticketService from '../services/ticket.service.js';
import { successResponse } from '../utils/response.js';

/**
 * Controller handling HTTP requests for Primary Ticket Purchases,
 * User Ticket Portfolios, Ticket Ownership Audit Trails, and Direct Transfers.
 */
export const ticketController = {
  /**
   * POST /events/:id/purchase - Buy tickets at original face value
   */
  async purchaseTickets(req, res, next) {
    try {
      const eventId = req.params.id;
      const userId = req.user.id;
      const { categoryId, quantity } = req.body;
      const idempotencyKey = req.headers['idempotency-key'] || null;

      const result = await ticketService.purchaseTickets({
        userId,
        eventId,
        categoryId,
        quantity,
        idempotencyKey,
      });

      res.status(201).json(successResponse(result));
    } catch (err) {
      next(err);
    }
  },

  /**
   * GET /tickets/me - Retrieve tickets owned by the authenticated user
   */
  async getMyTickets(req, res, next) {
    try {
      const userId = req.user.id;
      const query = req.validatedQuery || req.query;

      const result = await ticketService.getMyTickets(userId, query);
      res.status(200).json(successResponse(result));
    } catch (err) {
      next(err);
    }
  },

  /**
   * GET /tickets/:id - Retrieve ticket details
   */
  async getTicketById(req, res, next) {
    try {
      const ticketId = req.params.id;
      const ticket = await ticketService.getTicketById(ticketId);
      res.status(200).json(successResponse(ticket));
    } catch (err) {
      next(err);
    }
  },

  /**
   * GET /tickets/:id/ownership - Retrieve ticket ownership audit trail
   */
  async getTicketOwnershipHistory(req, res, next) {
    try {
      const ticketId = req.params.id;
      const history = await ticketService.getTicketOwnershipHistory(ticketId);
      res.status(200).json(successResponse(history));
    } catch (err) {
      next(err);
    }
  },

  /**
   * POST /tickets/:id/transfer - Direct (non-market) peer-to-peer transfer
   */
  async transferTicket(req, res, next) {
    try {
      const ticketId = req.params.id;
      const fromUserId = req.user.id;
      const { toUserId, recipientEmail } = req.body;

      const result = await ticketService.transferTicket({
        ticketId,
        fromUserId,
        toUserId,
        recipientEmail,
      });

      res.status(200).json(successResponse(result));
    } catch (err) {
      next(err);
    }
  },

  /**
   * GET /transfers/:id - Check transfer status and details
   */
  async getTransferById(req, res, next) {
    try {
      const transferId = req.params.id;
      const userId = req.user.id;
      const userRole = req.user.role;

      const transfer = await ticketService.getTransferById(transferId, userId, userRole);
      res.status(200).json(successResponse(transfer));
    } catch (err) {
      next(err);
    }
  },
};

export default ticketController;
