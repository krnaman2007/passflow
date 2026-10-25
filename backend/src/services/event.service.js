import prisma from '../db/prisma.js';
import logger from '../errorlogging/logger.js';
import { AppError } from '../middleware/errorHandler.js';

/**
 * Service handling Event, TicketCategory, and TicketInventory business logic.
 */
export const eventService = {
  /**
   * Creates a new Event in DRAFT status.
   * @param {string} organizerId - ID of the Organizer creating the event.
   * @param {object} data - Event creation details.
   */
  async createEvent(organizerId, data) {
    const event = await prisma.event.create({
      data: {
        name: data.name,
        description: data.description,
        dateTime: new Date(data.dateTime),
        location: data.location,
        organizerId,
        status: 'DRAFT',
        originalPrice: data.originalPrice ? data.originalPrice.toString() : null,
      },
      include: {
        organizer: {
          select: { id: true, organizationName: true },
        },
      },
    });

    logger.info('Event created', { eventId: event.id, organizerId });
    return event;
  },

  /**
   * Retrieves a paginated list of events with optional filters.
   * @param {object} filters - Search, date, location, status, page, limit.
   */
  async listEvents({ search, date, location, status, page = 1, limit = 20 } = {}) {
    const take = Math.min(Math.max(Number(limit) || 20, 1), 100);
    const skip = (Math.max(Number(page) || 1, 1) - 1) * take;

    const where = {};

    if (search) {
      where.name = { contains: search, mode: 'insensitive' };
    }

    if (location) {
      where.location = { contains: location, mode: 'insensitive' };
    }

    if (status) {
      where.status = status;
    }

    if (date) {
      where.dateTime = { gte: new Date(date) };
    }

    const [events, total] = await Promise.all([
      prisma.event.findMany({
        where,
        skip,
        take,
        orderBy: { dateTime: 'asc' },
        include: {
          categories: {
            include: {
              inventory: true,
              dutchAuctions: {
                where: { status: 'ACTIVE' },
                orderBy: { createdAt: 'desc' },
                take: 1,
              },
            },
          },
          organizer: {
            select: { id: true, organizationName: true },
          },
        },
      }),
      prisma.event.count({ where }),
    ]);

    return {
      events,
      pagination: {
        total,
        page: Number(page) || 1,
        limit: take,
        totalPages: Math.ceil(total / take),
      },
    };
  },

  /**
   * Retrieves a single event by ID along with its categories and live inventory.
   * @param {string} id - Event UUID.
   */
  async getEventById(id) {
    const event = await prisma.event.findUnique({
      where: { id },
      include: {
        categories: {
          include: {
            inventory: true,
            dutchAuctions: {
              where: { status: 'ACTIVE' },
              orderBy: { createdAt: 'desc' },
              take: 1,
            },
          },
        },
        dutchAuctions: {
          where: { status: 'ACTIVE' },
          orderBy: { createdAt: 'desc' },
        },
        organizer: {
          select: { id: true, organizationName: true },
        },
      },
    });

    if (!event) {
      throw new AppError('Event not found', 404, 'NOT_FOUND');
    }

    return event;
  },

  /**
   * Updates event details. Restricted to the owning Organizer or Admin.
   * @param {string} eventId - ID of event to update.
   * @param {string} organizerId - ID of calling organizer.
   * @param {object} data - Fields to update.
   * @param {string} userRole - Calling user role.
   */
  async updateEvent(eventId, organizerId, data, userRole = 'USER') {
    const event = await prisma.event.findUnique({ where: { id: eventId } });

    if (!event) {
      throw new AppError('Event not found', 404, 'NOT_FOUND');
    }

    if (userRole !== 'ADMIN' && event.organizerId !== organizerId) {
      throw new AppError('You are not authorized to update this event', 403, 'FORBIDDEN');
    }

    const updated = await prisma.event.update({
      where: { id: eventId },
      data: {
        ...(data.name && { name: data.name }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.dateTime && { dateTime: new Date(data.dateTime) }),
        ...(data.location && { location: data.location }),
        ...(data.originalPrice !== undefined && {
          originalPrice: data.originalPrice ? data.originalPrice.toString() : null,
        }),
      },
      include: {
        categories: { include: { inventory: true } },
      },
    });

    logger.info('Event updated', { eventId, organizerId });
    return updated;
  },

  /**
   * Updates the lifecycle status of an event (PUBLISHED, CANCELLED, COMPLETED).
   * @param {string} eventId - ID of event.
   * @param {string} organizerId - ID of calling organizer.
   * @param {string} status - New status.
   * @param {string} userRole - Calling user role.
   */
  async updateEventStatus(eventId, organizerId, status, userRole = 'USER') {
    const event = await prisma.event.findUnique({ where: { id: eventId } });

    if (!event) {
      throw new AppError('Event not found', 404, 'NOT_FOUND');
    }

    if (userRole !== 'ADMIN' && event.organizerId !== organizerId) {
      throw new AppError('You are not authorized to change the status of this event', 403, 'FORBIDDEN');
    }

    const updated = await prisma.event.update({
      where: { id: eventId },
      data: { status },
    });

    logger.info('Event status changed', { eventId, status, organizerId });
    return updated;
  },

  /**
   * Adds a new ticket category and initializes its inventory in a single database transaction.
   * @param {string} eventId - Event UUID.
   * @param {string} organizerId - ID of calling organizer.
   * @param {object} categoryData - Name, price, and totalQuantity.
   * @param {string} userRole - Calling user role.
   */
  async addCategory(eventId, organizerId, categoryData, userRole = 'USER') {
    const event = await prisma.event.findUnique({ where: { id: eventId } });

    if (!event) {
      throw new AppError('Event not found', 404, 'NOT_FOUND');
    }

    if (userRole !== 'ADMIN' && event.organizerId !== organizerId) {
      throw new AppError('You are not authorized to add categories to this event', 403, 'FORBIDDEN');
    }

    const result = await prisma.$transaction(async (tx) => {
      const category = await tx.ticketCategory.create({
        data: {
          eventId,
          name: categoryData.name,
          originalPrice: categoryData.originalPrice.toString(),
          totalQuantity: categoryData.totalQuantity,
          availableQuantity: categoryData.totalQuantity,
          status: 'ACTIVE',
        },
      });

      const inventory = await tx.ticketInventory.create({
        data: {
          categoryId: category.id,
          totalQuantity: categoryData.totalQuantity,
          availableQuantity: categoryData.totalQuantity,
          reservedQuantity: 0,
        },
      });

      return { ...category, inventory };
    });

    logger.info('Ticket category added with inventory', { categoryId: result.id, eventId });
    return result;
  },

  /**
   * Lists all ticket categories and current available stock for an event.
   * @param {string} eventId - Event UUID.
   */
  async getCategories(eventId) {
    const event = await prisma.event.findUnique({ where: { id: eventId } });

    if (!event) {
      throw new AppError('Event not found', 404, 'NOT_FOUND');
    }

    return prisma.ticketCategory.findMany({
      where: { eventId },
      include: { inventory: true },
      orderBy: { originalPrice: 'asc' },
    });
  },

  /**
   * Updates category price or details.
   * @param {string} categoryId - Category UUID.
   * @param {string} organizerId - Calling organizer ID.
   * @param {object} data - Fields to update.
   * @param {string} userRole - Calling user role.
   */
  async updateCategory(categoryId, organizerId, data, userRole = 'USER') {
    const category = await prisma.ticketCategory.findUnique({
      where: { id: categoryId },
      include: { event: true },
    });

    if (!category) {
      throw new AppError('Category not found', 404, 'NOT_FOUND');
    }

    if (userRole !== 'ADMIN' && category.event.organizerId !== organizerId) {
      throw new AppError('You are not authorized to update this category', 403, 'FORBIDDEN');
    }

    const updated = await prisma.ticketCategory.update({
      where: { id: categoryId },
      data: {
        ...(data.name && { name: data.name }),
        ...(data.originalPrice !== undefined && { originalPrice: data.originalPrice.toString() }),
      },
      include: { inventory: true },
    });

    logger.info('Category updated', { categoryId, organizerId });
    return updated;
  },

  /**
   * Inspects category inventory (total, available, reserved, and sold quantities).
   * @param {string} categoryId - Category UUID.
   * @param {string} organizerId - Calling organizer ID.
   * @param {string} userRole - Calling user role.
   */
  async getCategoryInventory(categoryId, organizerId, userRole = 'USER') {
    const category = await prisma.ticketCategory.findUnique({
      where: { id: categoryId },
      include: { event: true, inventory: true },
    });

    if (!category || !category.inventory) {
      throw new AppError('Category inventory not found', 404, 'NOT_FOUND');
    }

    if (userRole !== 'ADMIN' && category.event.organizerId !== organizerId) {
      throw new AppError('You are not authorized to view inventory for this category', 403, 'FORBIDDEN');
    }

    const { totalQuantity, availableQuantity, reservedQuantity } = category.inventory;
    const soldCount = totalQuantity - (availableQuantity + reservedQuantity);

    return {
      categoryId: category.id,
      categoryName: category.name,
      eventId: category.eventId,
      totalQuantity,
      availableQuantity,
      reservedQuantity,
      soldCount,
    };
  },

  /**
   * Adjusts inventory stock for a category, strictly guarding against reducing total quantity
   * below the number of tickets already sold.
   *
   * @param {string} categoryId - Category UUID.
   * @param {string} organizerId - Calling organizer ID.
   * @param {number} newTotalQuantity - New total stock.
   * @param {string} userRole - Calling user role.
   */
  async updateCategoryInventory(categoryId, organizerId, newTotalQuantity, userRole = 'USER') {
    const category = await prisma.ticketCategory.findUnique({
      where: { id: categoryId },
      include: { event: true, inventory: true },
    });

    if (!category || !category.inventory) {
      throw new AppError('Category inventory not found', 404, 'NOT_FOUND');
    }

    if (userRole !== 'ADMIN' && category.event.organizerId !== organizerId) {
      throw new AppError('You are not authorized to adjust inventory for this category', 403, 'FORBIDDEN');
    }

    const { totalQuantity: oldTotal, availableQuantity: oldAvailable, reservedQuantity } = category.inventory;
    const soldCount = oldTotal - (oldAvailable + reservedQuantity);

    if (newTotalQuantity < soldCount) {
      throw new AppError(
        `Cannot reduce inventory to ${newTotalQuantity}. ${soldCount} tickets have already been sold.`,
        400,
        'INVALID_INVENTORY_ADJUSTMENT'
      );
    }

    const quantityDifference = newTotalQuantity - oldTotal;
    const newAvailable = oldAvailable + quantityDifference;
    const newStatus = newAvailable <= 0 ? 'SOLD_OUT' : 'ACTIVE';

    const updated = await prisma.$transaction(async (tx) => {
      const inventory = await tx.ticketInventory.update({
        where: { categoryId },
        data: {
          totalQuantity: newTotalQuantity,
          availableQuantity: newAvailable,
        },
      });

      await tx.ticketCategory.update({
        where: { id: categoryId },
        data: {
          totalQuantity: newTotalQuantity,
          availableQuantity: newAvailable,
          status: newStatus,
        },
      });

      return inventory;
    });

    logger.info('Category inventory adjusted', {
      categoryId,
      oldTotal,
      newTotalQuantity,
      soldCount,
      organizerId,
    });

    return {
      categoryId,
      totalQuantity: updated.totalQuantity,
      availableQuantity: updated.availableQuantity,
      reservedQuantity: updated.reservedQuantity,
      soldCount,
    };
  },
};

export default eventService;
