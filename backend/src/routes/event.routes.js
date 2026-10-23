import express from 'express';
import eventController from '../controllers/event.controller.js';
import ticketController from '../controllers/ticket.controller.js';
import { authenticateUser, requireOrganizer } from '../middleware/auth.js';
import validate from '../middleware/validate.js';
import { purchaseTicketSchema } from '../schemas/ticket.schema.js';
import {
  createEventSchema,
  updateEventSchema,
  updateEventStatusSchema,
  createCategorySchema,
  updateCategorySchema,
  updateInventorySchema,
} from '../schemas/event.schema.js';
import {
  priceHistoryParamsSchema,
  queryPriceHistorySchema,
} from '../schemas/market.schema.js';
import {
  eventTradesParamsSchema,
  queryEventTradesSchema,
} from '../schemas/trade.schema.js';
import {
  eventOrderbookParamsSchema,
  eventOrderbookQuerySchema,
} from '../schemas/orderbook.schema.js';

const router = express.Router();

// ==========================================
// Event Endpoints
// ==========================================

// POST /events - Create event (DRAFT, Organizer only)
router.post(
  '/events',
  authenticateUser,
  requireOrganizer,
  validate(createEventSchema),
  eventController.createEvent
);

// GET /events - List events with filters & pagination (Public)
router.get('/events', eventController.listEvents);

// GET /events/:id - Event details with categories & stock (Public)
router.get('/events/:id', eventController.getEventById);

// PUT /events/:id - Edit event details (Organizer only)
router.put(
  '/events/:id',
  authenticateUser,
  requireOrganizer,
  validate(updateEventSchema),
  eventController.updateEvent
);

// PATCH /events/:id/status - Publish, cancel, or complete (Organizer / Admin)
router.patch(
  '/events/:id/status',
  authenticateUser,
  requireOrganizer,
  validate(updateEventStatusSchema),
  eventController.updateEventStatus
);

// POST /events/:id/purchase - Buy at original face value (User only)
router.post(
  '/events/:id/purchase',
  authenticateUser,
  validate(purchaseTicketSchema),
  ticketController.purchaseTickets
);

// GET /events/:id/price-history - OHLC / price history for charts (Public)
router.get(
  '/events/:id/price-history',
  validate(priceHistoryParamsSchema, 'params'),
  validate(queryPriceHistorySchema, 'query'),
  eventController.getPriceHistory
);

// GET /events/:id/trades - Public recent executed trades for an event (Public)
router.get(
  '/events/:id/trades',
  validate(eventTradesParamsSchema, 'params'),
  validate(queryEventTradesSchema, 'query'),
  eventController.getEventTrades
);

// GET /events/:eventId/orderbook - Public current resting orderbook for event tier (Public)
router.get(
  '/events/:eventId/orderbook',
  validate(eventOrderbookParamsSchema, 'params'),
  validate(eventOrderbookQuerySchema, 'query'),
  eventController.getEventOrderbook
);

// ==========================================
// Category & Inventory Endpoints
// ==========================================

// POST /events/:id/categories - Add ticket category (Organizer only)
router.post(
  '/events/:id/categories',
  authenticateUser,
  requireOrganizer,
  validate(createCategorySchema),
  eventController.addCategory
);

// GET /events/:id/categories - List categories with availableQuantity (Public)
router.get('/events/:id/categories', eventController.getCategories);

// PUT /categories/:id - Update category price / details (Organizer only)
router.put(
  '/categories/:id',
  authenticateUser,
  requireOrganizer,
  validate(updateCategorySchema),
  eventController.updateCategory
);

// GET /categories/:id/inventory - Total, available, reserved quantities (Organizer only)
router.get(
  '/categories/:id/inventory',
  authenticateUser,
  requireOrganizer,
  eventController.getCategoryInventory
);

// PUT /categories/:id/inventory - Adjust inventory (blocked below sold count)
router.put(
  '/categories/:id/inventory',
  authenticateUser,
  requireOrganizer,
  validate(updateInventorySchema),
  eventController.updateCategoryInventory
);

export default router;
