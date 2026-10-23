import eventService from '../services/event.service.js';
import marketService from '../services/market.service.js';
import { successResponse } from '../utils/response.js';

/**
 * Controller handling HTTP requests for Events, Categories, and Inventory.
 */
export const eventController = {
  /**
   * POST /events - Create a new event (DRAFT)
   */
  async createEvent(req, res, next) {
    try {
      const organizerId = req.user.organizer?.id;
      const event = await eventService.createEvent(organizerId, req.body);
      res.status(201).json(successResponse(event));
    } catch (err) {
      next(err);
    }
  },

  /**
   * GET /events - List events with optional filters & pagination
   */
  async listEvents(req, res, next) {
    try {
      const result = await eventService.listEvents(req.query);
      res.status(200).json(successResponse(result));
    } catch (err) {
      next(err);
    }
  },

  /**
   * GET /events/:id - Get event details with categories and stock
   */
  async getEventById(req, res, next) {
    try {
      const event = await eventService.getEventById(req.params.id);
      res.status(200).json(successResponse(event));
    } catch (err) {
      next(err);
    }
  },

  /**
   * PUT /events/:id - Edit event details (Organizer only)
   */
  async updateEvent(req, res, next) {
    try {
      const organizerId = req.user.organizer?.id;
      const updated = await eventService.updateEvent(
        req.params.id,
        organizerId,
        req.body,
        req.user.role
      );
      res.status(200).json(successResponse(updated));
    } catch (err) {
      next(err);
    }
  },

  /**
   * PATCH /events/:id/status - Publish, cancel, or complete event
   */
  async updateEventStatus(req, res, next) {
    try {
      const organizerId = req.user.organizer?.id;
      const updated = await eventService.updateEventStatus(
        req.params.id,
        organizerId,
        req.body.status,
        req.user.role
      );
      res.status(200).json(successResponse(updated));
    } catch (err) {
      next(err);
    }
  },

  /**
   * POST /events/:id/categories - Add ticket category
   */
  async addCategory(req, res, next) {
    try {
      const organizerId = req.user.organizer?.id;
      const category = await eventService.addCategory(
        req.params.id,
        organizerId,
        req.body,
        req.user.role
      );
      res.status(201).json(successResponse(category));
    } catch (err) {
      next(err);
    }
  },

  /**
   * GET /events/:id/categories - List categories with availableQuantity
   */
  async getCategories(req, res, next) {
    try {
      const categories = await eventService.getCategories(req.params.id);
      res.status(200).json(successResponse(categories));
    } catch (err) {
      next(err);
    }
  },

  /**
   * PUT /categories/:id - Update category price / details
   */
  async updateCategory(req, res, next) {
    try {
      const organizerId = req.user.organizer?.id;
      const updated = await eventService.updateCategory(
        req.params.id,
        organizerId,
        req.body,
        req.user.role
      );
      res.status(200).json(successResponse(updated));
    } catch (err) {
      next(err);
    }
  },

  /**
   * GET /categories/:id/inventory - Total, available, reserved quantities
   */
  async getCategoryInventory(req, res, next) {
    try {
      const organizerId = req.user.organizer?.id;
      const inventory = await eventService.getCategoryInventory(
        req.params.id,
        organizerId,
        req.user.role
      );
      res.status(200).json(successResponse(inventory));
    } catch (err) {
      next(err);
    }
  },

  /**
   * PUT /categories/:id/inventory - Adjust inventory (blocked below sold count)
   */
  async updateCategoryInventory(req, res, next) {
    try {
      const organizerId = req.user.organizer?.id;
      const updated = await eventService.updateCategoryInventory(
        req.params.id,
        organizerId,
        req.body.totalQuantity,
        req.user.role
      );
      res.status(200).json(successResponse(updated));
    } catch (err) {
      next(err);
    }
  },

  /**
   * GET /events/:id/price-history - OHLC / price history for charts (Public)
   */
  async getPriceHistory(req, res, next) {
    try {
      const eventId = req.params.id;
      const query = req.validatedQuery || req.query;
      const data = await marketService.getPriceHistory(eventId, query);
      res.status(200).json(successResponse(data));
    } catch (err) {
      next(err);
    }
  },

  /**
   * GET /events/:id/trades - Public recent executions for an event (optional category filter)
   */
  async getEventTrades(req, res, next) {
    try {
      const eventId = req.params.id;
      const query = req.validatedQuery || req.query;
      const data = await marketService.getEventTrades(eventId, query);
      res.status(200).json(successResponse(data));
    } catch (err) {
      next(err);
    }
  },
};

export default eventController;

