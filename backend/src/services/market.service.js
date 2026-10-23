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

  /**
   * Retrieves aggregated MarketDepth price levels (bids descending, asks ascending).
   *
   * @param {string} eventId - Target event UUID.
   * @param {string} categoryId - Target ticket category UUID.
   * @param {object} [options] - Pagination limit.
   * @returns {Promise<object>} MarketDepth snapshot.
   */
  async getMarketDepth(eventId, categoryId, { limit = 50 } = {}) {
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 100);

    // 1. Verify event exists
    const event = await prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true, name: true },
    });
    if (!event) {
      throw new AppError('Event not found', 404, 'EVENT_NOT_FOUND');
    }

    // 2. Verify category exists
    const category = await prisma.ticketCategory.findFirst({
      where: { id: categoryId, eventId },
      select: { id: true, name: true },
    });
    if (!category) {
      throw new AppError('Ticket category not found for event', 404, 'CATEGORY_NOT_FOUND');
    }

    // 3. Query resting BIDs
    const bidOrders = await prisma.order.findMany({
      where: {
        eventId,
        ticketCategoryId: categoryId,
        side: 'BID',
        status: { in: ['OPEN', 'PARTIALLY_FILLED'] },
        remainingQuantity: { gt: 0 },
      },
      orderBy: [{ price: 'desc' }, { sequenceNumber: 'asc' }],
      select: { price: true, remainingQuantity: true },
    });

    const bidMap = new Map();
    for (const o of bidOrders) {
      if (!bidMap.has(o.price)) {
        bidMap.set(o.price, { price: o.price, totalQuantity: 0, orderCount: 0 });
      }
      const lvl = bidMap.get(o.price);
      lvl.totalQuantity += o.remainingQuantity;
      lvl.orderCount += 1;
    }
    const bids = Array.from(bidMap.values()).slice(0, limitNum);

    // 4. Query resting ASKs
    const askOrders = await prisma.order.findMany({
      where: {
        eventId,
        ticketCategoryId: categoryId,
        side: 'ASK',
        status: { in: ['OPEN', 'PARTIALLY_FILLED'] },
        remainingQuantity: { gt: 0 },
      },
      orderBy: [{ price: 'asc' }, { sequenceNumber: 'asc' }],
      select: { price: true, remainingQuantity: true },
    });

    const askMap = new Map();
    for (const o of askOrders) {
      if (!askMap.has(o.price)) {
        askMap.set(o.price, { price: o.price, totalQuantity: 0, orderCount: 0 });
      }
      const lvl = askMap.get(o.price);
      lvl.totalQuantity += o.remainingQuantity;
      lvl.orderCount += 1;
    }
    const asks = Array.from(askMap.values()).slice(0, limitNum);

    return {
      id: `${eventId}:${categoryId}`,
      eventId,
      categoryId,
      eventName: event.name,
      categoryName: category.name,
      bids,
      asks,
      timestamp: new Date().toISOString(),
    };
  },

  /**
   * Retrieves recent executed trades for the TradeFeed.
   *
   * @param {string} eventId - Target event UUID.
   * @param {string} categoryId - Target ticket category UUID.
   * @param {object} [options] - Limit of recent trades.
   * @returns {Promise<object>} Recent trades list.
   */
  async getRecentTrades(eventId, categoryId, { limit = 50 } = {}) {
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 100);

    // 1. Verify event exists
    const event = await prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true, name: true },
    });
    if (!event) {
      throw new AppError('Event not found', 404, 'EVENT_NOT_FOUND');
    }

    // 2. Verify category exists
    const category = await prisma.ticketCategory.findFirst({
      where: { id: categoryId, eventId },
      select: { id: true, name: true },
    });
    if (!category) {
      throw new AppError('Ticket category not found for event', 404, 'CATEGORY_NOT_FOUND');
    }

    // 3. Query executions for this event and category
    const executions = await prisma.execution.findMany({
      where: {
        incomingOrder: {
          eventId,
          ticketCategoryId: categoryId,
        },
      },
      take: limitNum,
      orderBy: [{ sequenceNumber: 'desc' }, { executedAt: 'desc' }],
      select: {
        id: true,
        price: true,
        quantity: true,
        executedAt: true,
        sequenceNumber: true,
      },
    });

    const trades = executions.map((e) => ({
      id: e.id,
      tradeId: e.id,
      eventId,
      categoryId,
      price: e.price,
      quantity: e.quantity,
      sequenceNumber: e.sequenceNumber ? e.sequenceNumber.toString() : undefined,
      timestamp: e.executedAt.toISOString(),
    }));

    return {
      eventId,
      categoryId,
      eventName: event.name,
      categoryName: category.name,
      trades,
      total: trades.length,
    };
  },

  /**
   * Public recent executions for an event, with optional ticket category filtering and pagination.
   * Exposes only approved public execution fields; omits all internal user, order, hold, or counterparty IDs.
   *
   * @param {string} eventId - Target event UUID.
   * @param {object} [query] - { categoryId, ticketCategoryId, page, limit }
   * @returns {Promise<object>} Public recent executions list.
   */
  async getEventTrades(eventId, query = {}) {
    const page = Math.max(1, parseInt(query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 50));
    const skip = (page - 1) * limit;

    const categoryId = query.categoryId || query.ticketCategoryId || null;

    // 1. Verify event exists
    const event = await prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true, name: true, location: true, dateTime: true },
    });
    if (!event) {
      throw new AppError('Event not found', 404, 'EVENT_NOT_FOUND');
    }

    // 2. If category is supplied, verify it exists for this event
    let category = null;
    if (categoryId) {
      category = await prisma.ticketCategory.findFirst({
        where: { id: categoryId, eventId },
        select: { id: true, name: true },
      });
      if (!category) {
        throw new AppError('Ticket category not found for event', 404, 'CATEGORY_NOT_FOUND');
      }
    }

    // 3. Query executions for this event (and optional category)
    const where = {
      incomingOrder: {
        eventId,
        ...(categoryId ? { ticketCategoryId: categoryId } : {}),
      },
    };

    const [total, executions] = await Promise.all([
      prisma.execution.count({ where }),
      prisma.execution.findMany({
        where,
        take: limit,
        skip,
        orderBy: [{ sequenceNumber: 'desc' }, { executedAt: 'desc' }],
        select: {
          id: true,
          price: true,
          quantity: true,
          sequenceNumber: true,
          executedAt: true,
          incomingOrder: {
            select: {
              ticketCategoryId: true,
            },
          },
        },
      }),
    ]);

    const trades = executions.map((e) => ({
      id: e.id,
      tradeId: e.id,
      eventId,
      categoryId: e.incomingOrder.ticketCategoryId,
      ticketCategoryId: e.incomingOrder.ticketCategoryId,
      price: e.price,
      quantity: e.quantity,
      sequenceNumber: e.sequenceNumber != null ? String(e.sequenceNumber) : null,
      timestamp: e.executedAt instanceof Date ? e.executedAt.toISOString() : e.executedAt,
      executedAt: e.executedAt instanceof Date ? e.executedAt.toISOString() : e.executedAt,
    }));

    return {
      eventId,
      eventName: event.name,
      ...(categoryId ? { categoryId, categoryName: category?.name } : {}),
      trades,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  },

  /**
   * Retrieves summary of top events by volume and price movement.
   *
   * @param {object} [options] - limit, sortBy ('volume' | 'priceMovement' | 'trades'), timeframe
   * @returns {Promise<object>} Summary report of top events.
   */
  async getMarketSummary(options = {}) {
    const limit = Math.min(Math.max(parseInt(options.limit, 10) || 10, 1), 50);
    const sortBy = options.sortBy || 'volume';

    // 1. Fetch published/active events with their categories
    const events = await prisma.event.findMany({
      where: {
        status: { in: ['PUBLISHED', 'COMPLETED', 'DRAFT'] },
      },
      include: {
        categories: {
          select: {
            id: true,
            name: true,
            originalPrice: true,
          },
        },
      },
    });

    // 2. Fetch executions for each event to calculate volume and price metrics
    const eventSummaries = await Promise.all(
      events.map(async (event) => {
        const executions = await prisma.execution.findMany({
          where: {
            incomingOrder: {
              eventId: event.id,
            },
          },
          orderBy: [{ sequenceNumber: 'asc' }, { executedAt: 'asc' }],
          select: {
            price: true,
            quantity: true,
            executedAt: true,
          },
        });

        let totalVolume = 0;
        let totalVolumePaise = 0n;
        let highPrice = null;
        let lowPrice = null;
        let openPrice = null;
        let lastPrice = null;

        if (executions.length > 0) {
          openPrice = executions[0].price;
          lastPrice = executions[executions.length - 1].price;
          highPrice = executions[0].price;
          lowPrice = executions[0].price;

          for (const exec of executions) {
            totalVolume += exec.quantity;
            totalVolumePaise += BigInt(exec.price) * BigInt(exec.quantity);
            if (exec.price > highPrice) highPrice = exec.price;
            if (exec.price < lowPrice) lowPrice = exec.price;
          }
        } else if (event.originalPrice) {
          const basePrice = Number(event.originalPrice);
          openPrice = basePrice;
          lastPrice = basePrice;
          highPrice = basePrice;
          lowPrice = basePrice;
        }

        const priceChange =
          openPrice !== null && lastPrice !== null ? lastPrice - openPrice : 0;
        const priceChangePercent =
          openPrice && openPrice > 0
            ? Math.round((priceChange / openPrice) * 10000) / 100
            : 0;

        return {
          eventId: event.id,
          eventName: event.name,
          location: event.location,
          dateTime: event.dateTime,
          status: event.status,
          volume: totalVolume,
          volumePaise: Number(totalVolumePaise),
          tradeCount: executions.length,
          lastPrice,
          openPrice,
          highPrice,
          lowPrice,
          priceChange,
          priceChangePercent,
          categoriesCount: event.categories.length,
        };
      })
    );

    // 3. Sort based on criteria
    if (sortBy === 'priceMovement') {
      eventSummaries.sort(
        (a, b) => Math.abs(b.priceChangePercent) - Math.abs(a.priceChangePercent)
      );
    } else if (sortBy === 'trades') {
      eventSummaries.sort((a, b) => b.tradeCount - a.tradeCount);
    } else {
      // Default: volume
      eventSummaries.sort((a, b) => b.volume - a.volume);
    }

    const topEvents = eventSummaries.slice(0, limit);

    return {
      summary: topEvents,
      events: topEvents,
      totalEvents: topEvents.length,
      sortBy,
      updatedAt: new Date().toISOString(),
    };
  },

  /**
   * Retrieves OHLC candlestick price history for an event.
   *
   * @param {string} eventId - Event UUID.
   * @param {object} [options] - categoryId, interval ('1m'|'5m'|'15m'|'1h'|'1d'), limit
   * @returns {Promise<object>} OHLC candles and price history summary.
   */
  async getPriceHistory(eventId, options = {}) {
    const { categoryId, interval = '1h', limit = 100 } = options;
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 500);

    // 1. Verify event existence
    const event = await prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true, name: true, originalPrice: true, createdAt: true },
    });

    if (!event) {
      throw new AppError('Event not found', 404, 'EVENT_NOT_FOUND');
    }

    // 2. If categoryId provided, verify it belongs to this event
    let category = null;
    if (categoryId) {
      category = await prisma.ticketCategory.findFirst({
        where: { id: categoryId, eventId },
        select: { id: true, name: true, originalPrice: true },
      });
      if (!category) {
        throw new AppError('Ticket category not found for event', 404, 'CATEGORY_NOT_FOUND');
      }
    }

    // 3. Query executions chronologically
    const where = {
      incomingOrder: {
        eventId,
        ...(categoryId && { ticketCategoryId: categoryId }),
      },
    };

    const executions = await prisma.execution.findMany({
      where,
      orderBy: [{ executedAt: 'asc' }, { sequenceNumber: 'asc' }],
      select: {
        id: true,
        price: true,
        quantity: true,
        executedAt: true,
      },
    });

    // Determine interval in ms
    const intervalMsMap = {
      '1m': 60 * 1000,
      '5m': 5 * 60 * 1000,
      '15m': 15 * 60 * 1000,
      '1h': 60 * 60 * 1000,
      '1d': 24 * 60 * 60 * 1000,
    };
    const bucketMs = intervalMsMap[interval] || intervalMsMap['1h'];

    let candles = [];

    if (executions.length > 0) {
      // Group executions into time buckets
      const buckets = new Map();

      for (const exec of executions) {
        const time = new Date(exec.executedAt).getTime();
        const bucketKey = Math.floor(time / bucketMs) * bucketMs;

        if (!buckets.has(bucketKey)) {
          buckets.set(bucketKey, {
            timestamp: new Date(bucketKey).toISOString(),
            open: exec.price,
            high: exec.price,
            low: exec.price,
            close: exec.price,
            volume: 0,
            trades: 0,
          });
        }

        const b = buckets.get(bucketKey);
        if (exec.price > b.high) b.high = exec.price;
        if (exec.price < b.low) b.low = exec.price;
        b.close = exec.price;
        b.volume += exec.quantity;
        b.trades += 1;
      }

      candles = Array.from(buckets.values()).slice(-limitNum);
    } else {
      // Baseline candle based on event or category originalPrice
      const baselinePrice = category?.originalPrice
        ? Number(category.originalPrice)
        : event.originalPrice ? Number(event.originalPrice) : 1000;

      candles = [
        {
          timestamp: new Date().toISOString(),
          open: baselinePrice,
          high: baselinePrice,
          low: baselinePrice,
          close: baselinePrice,
          volume: 0,
          trades: 0,
        },
      ];
    }

    const firstCandle = candles[0];
    const lastCandle = candles[candles.length - 1];
    const currentPrice = lastCandle.close;
    const openPrice = firstCandle.open;
    const highPrice = Math.max(...candles.map((c) => c.high));
    const lowPrice = Math.min(...candles.map((c) => c.low));
    const totalVolume = candles.reduce((acc, c) => acc + c.volume, 0);
    const priceChange = currentPrice - openPrice;
    const priceChangePercent =
      openPrice > 0 ? Math.round((priceChange / openPrice) * 10000) / 100 : 0;

    return {
      eventId: event.id,
      eventName: event.name,
      ...(categoryId && { categoryId: category.id, categoryName: category.name }),
      interval,
      candles,
      summary: {
        currentPrice,
        openPrice,
        highPrice,
        lowPrice,
        totalVolume,
        priceChange,
        priceChangePercent,
      },
    };
  },
};

export default marketService;
