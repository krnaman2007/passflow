import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🚀 Seeding Coldplay orderbook with 10 BIDs, 10 ASKs, and candlestick history for ALL categories...');

  // 1. Fetch available traders
  const users = await prisma.user.findMany({
    where: {
      email: {
        in: [
          'aarav@passflow.com',
          'diya@passflow.com',
          'kabir@passflow.com',
          'ananya@passflow.com',
          'vikram@passflow.com',
          'neha@passflow.com',
          'ali@passflow.com',
          'priya@passflow.com',
          'rohit@passflow.com',
        ],
      },
    },
  });

  if (users.length === 0) {
    console.error('❌ No traders found. Please run seed_orderbook_and_chart.js first.');
    process.exit(1);
  }

  // 2. Fetch Coldplay Event
  const event = await prisma.event.findFirst({
    where: { name: { contains: 'Coldplay', mode: 'insensitive' } },
    include: { categories: true },
  });

  if (!event || !event.categories || event.categories.length === 0) {
    console.error('❌ Coldplay event not found.');
    process.exit(1);
  }

  console.log(`🎯 Event Found: "${event.name}" (${event.id}) with ${event.categories.length} categories`);

  for (const cat of event.categories) {
    const base = Number(cat.originalPrice) || 5000;
    console.log(`\n======================================================`);
    console.log(`📌 Seeding Category: "${cat.name}" (${cat.id}) | Base: ₹${base}`);
    console.log(`======================================================`);

    // Clean old OPEN orders for this category
    await prisma.order.updateMany({
      where: {
        eventId: event.id,
        ticketCategoryId: cat.id,
        status: { in: ['OPEN', 'PARTIALLY_FILLED'] },
      },
      data: {
        status: 'CANCELLED',
        remainingQuantity: 0,
      },
    });

    // 10 BIDs (Buy Orders descending from base * 0.99 to base * 0.91)
    const bidStep = Math.max(Math.round(base * 0.008), 10);
    const topBid = Math.round(base * 0.99);

    const bidsData = [];
    for (let i = 0; i < 10; i++) {
      const p = (topBid - i * bidStep) * 100; // in paise
      const q = [2, 3, 5, 4, 8, 6, 10, 7, 12, 15][i];
      const u = users[i % users.length];
      bidsData.push({
        userId: u.id,
        eventId: event.id,
        ticketCategoryId: cat.id,
        side: 'BID',
        orderType: 'LIMIT',
        status: 'OPEN',
        price: p,
        initialQuantity: q,
        remainingQuantity: q,
        createdAt: new Date(Date.now() - (10 - i) * 60000),
      });
      console.log(`  [BID #${i + 1}] ₹${p / 100} | Qty: ${q} | Trader: ${u.name}`);
    }

    // 10 ASKs (Sell Orders ascending from base * 1.01 to base * 1.09)
    const askStep = Math.max(Math.round(base * 0.008), 10);
    const bottomAsk = Math.round(base * 1.01);

    const asksData = [];
    for (let i = 0; i < 10; i++) {
      const p = (bottomAsk + i * askStep) * 100; // in paise
      const q = [2, 4, 3, 6, 5, 8, 7, 10, 14, 20][i];
      const u = users[(i + 3) % users.length];
      asksData.push({
        userId: u.id,
        eventId: event.id,
        ticketCategoryId: cat.id,
        side: 'ASK',
        orderType: 'LIMIT',
        status: 'OPEN',
        price: p,
        initialQuantity: q,
        remainingQuantity: q,
        createdAt: new Date(Date.now() - (10 - i) * 60000),
      });
      console.log(`  [ASK #${i + 1}] ₹${p / 100} | Qty: ${q} | Trader: ${u.name}`);
    }

    // Insert Bids and Asks
    for (const b of bidsData) {
      await prisma.order.create({ data: b });
    }
    for (const a of asksData) {
      await prisma.order.create({ data: a });
    }

    // Historical Trade Executions for OHLC Candlestick Chart (15 time buckets)
    console.log(`  📊 Feeding 15 historical trade candles for chart...`);
    const candleDeltas = [
      -0.03, -0.02, -0.015, -0.01, -0.005, 0.0, 0.01, 0.005,
      0.015, 0.02, 0.01, -0.005, 0.005, 0.002, 0.001
    ];

    for (let c = 0; c < candleDeltas.length; c++) {
      const hoursAgo = 24 - c * 1.5;
      const tradeTime = new Date(Date.now() - hoursAgo * 3600000);
      const tradePrice = Math.round(base * (1 + candleDeltas[c])) * 100; // paise
      const tradeQty = (c % 4) + 2;

      const buyer = users[c % users.length];
      const seller = users[(c + 1) % users.length];

      const buyO = await prisma.order.create({
        data: {
          userId: buyer.id,
          eventId: event.id,
          ticketCategoryId: cat.id,
          side: 'BID',
          orderType: 'LIMIT',
          status: 'FILLED',
          price: tradePrice,
          initialQuantity: tradeQty,
          remainingQuantity: 0,
          createdAt: tradeTime,
        },
      });

      const sellO = await prisma.order.create({
        data: {
          userId: seller.id,
          eventId: event.id,
          ticketCategoryId: cat.id,
          side: 'ASK',
          orderType: 'LIMIT',
          status: 'FILLED',
          price: tradePrice,
          initialQuantity: tradeQty,
          remainingQuantity: 0,
          createdAt: tradeTime,
        },
      });

      await prisma.execution.create({
        data: {
          incomingOrderId: buyO.id,
          restingOrderId: sellO.id,
          price: tradePrice,
          quantity: tradeQty,
          settlementStatus: 'SETTLED',
          executedAt: tradeTime,
        },
      });
    }
  }

  console.log('\n✅ All categories of Coldplay seeded with 10 BIDs, 10 ASKs, and 15 OHLC chart candles each!');
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
