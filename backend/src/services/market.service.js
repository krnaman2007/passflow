import prisma from '../db/prisma.js';
import { AppError } from '../middleware/errorHandler.js';

/**
 * Service for querying market data, depth, and order book state.
 */
export const marketService = {
  /**
   * Retrieves MarketData snapshot (best bid/ask, last price, volume) for an event tier.
   *
   * @param {string} eventId - Target event UUID.
   * @param {string} categoryId - Target ticket category UUID.
   * @returns {Promise<object>} MarketData snapshot.
   */
  async getMarketData(eventId, categoryId) {
    // 1. Verify existence of event
    const event = await prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true, name: true, status: true },
    });

    if (!event) {
      throw new AppError('Event not found', 404, 'EVENT_NOT_FOUND');
    }

    // 2. Verify existence of ticket category belonging to the event
    const category = await prisma.ticketCategory.findFirst({
      where: { id: categoryId, eventId },
      select: {
        id: true,
        name: true,
        originalPrice: true,
        availableQuantity: true,
        totalQuantity: true,
      },
    });

    if (!category) {
      throw new AppError('Ticket category not found for event', 404, 'CATEGORY_NOT_FOUND');
    }

    // 3. Query best active bid (highest price resting buy order)
    const bestBidOrder = await prisma.order.findFirst({
      where: {
        eventId,
        ticketCategoryId: categoryId,
        side: 'BID',
        status: { in: ['OPEN', 'PARTIALLY_FILLED'] },
        remainingQuantity: { gt: 0 },
      },
      orderBy: [{ price: 'desc' }, { sequenceNumber: 'asc' }],
      select: { price: true },
    });

    // 4. Query best active ask (lowest price resting sell order)
    const bestAskOrder = await prisma.order.findFirst({
      where: {
        eventId,
        ticketCategoryId: categoryId,
        side: 'ASK',
        status: { in: ['OPEN', 'PARTIALLY_FILLED'] },
        remainingQuantity: { gt: 0 },
      },
      orderBy: [{ price: 'asc' }, { sequenceNumber: 'asc' }],
      select: { price: true },
    });

    // 5. Query last traded execution price
    const lastExecution = await prisma.execution.findFirst({
      where: {
        incomingOrder: {
          eventId,
          ticketCategoryId: categoryId,
        },
      },
      orderBy: [{ sequenceNumber: 'desc' }, { executedAt: 'desc' }],
      select: { price: true, executedAt: true },
    });

    // 6. Calculate total traded volume
    const executions = await prisma.execution.findMany({
      where: {
        incomingOrder: {
          eventId,
          ticketCategoryId: categoryId,
        },
      },
      select: { quantity: true, price: true },
    });

    let totalVolume = 0;
    let totalVolumePaise = 0n;
    for (const exec of executions) {
      totalVolume += exec.quantity;
      totalVolumePaise += BigInt(exec.price) * BigInt(exec.quantity);
    }

    const bestBid = bestBidOrder ? bestBidOrder.price : null;
    const bestAsk = bestAskOrder ? bestAskOrder.price : null;
    const lastPrice = lastExecution
      ? lastExecution.price
      : category.originalPrice ? Number(category.originalPrice) : null;
    const spread =
      bestBid !== null && bestAsk !== null ? bestAsk - bestBid : null;

    return {
      id: `${eventId}:${categoryId}`,
      eventId,
      categoryId,
      eventName: event.name,
      categoryName: category.name,
      bestBid,
      bestAsk,
      lastPrice,
      volume: totalVolume,
      volumePaise: Number(totalVolumePaise),
      spread,
      updatedAt: new Date().toISOString(),
    };
  },
};

export default marketService;
