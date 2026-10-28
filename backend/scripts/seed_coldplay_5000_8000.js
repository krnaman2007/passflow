import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🚀 Resetting and seeding Coldplay with prices in ₹5,000 - ₹8,000 range...');

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
    console.error('❌ No traders found.');
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

  console.log(`🎯 Event: "${event.name}" (${event.id})`);

  // Update Event original price to 6500 (in ₹5,000 - ₹8,000 range)
  await prisma.event.update({
    where: { id: event.id },
    data: { originalPrice: 6500 },
  });

  // 3. Complete cleanup of previous Coldplay executions and orders
  console.log('🧹 Cleaning up previous orders, executions, and settlements for Coldplay...');
  const coldplayOrders = await prisma.order.findMany({
    where: { eventId: event.id },
    select: { id: true },
  });
  const orderIds = coldplayOrders.map((o) => o.id);

  if (orderIds.length > 0) {
    const executions = await prisma.execution.findMany({
      where: {
        OR: [
          { incomingOrderId: { in: orderIds } },
          { restingOrderId: { in: orderIds } },
        ],
      },
      select: { id: true },
    });
    const executionIds = executions.map((e) => e.id);

    if (executionIds.length > 0) {
      await prisma.tradeSettlement.deleteMany({
        where: { executionId: { in: executionIds } },
      });
      await prisma.walletLedgerEntry.deleteMany({
        where: { executionId: { in: executionIds } },
      });
      await prisma.execution.deleteMany({
        where: { id: { in: executionIds } },
      });
      console.log(`  Deleted ${executionIds.length} previous executions and settlements.`);
    }

    await prisma.walletHold.deleteMany({
      where: { orderId: { in: orderIds } },
    });
    await prisma.walletLedgerEntry.deleteMany({
      where: { orderId: { in: orderIds } },
    });
    await prisma.order.deleteMany({
      where: { id: { in: orderIds } },
    });
    console.log(`  Deleted ${orderIds.length} previous orders.`);
  }

  // 4. Category pricing config within ₹5,000 - ₹8,000
  // Categories:
  // Lounge VIP Experience -> Base ₹7,500 (Range ₹7,000 - ₹8,000)
  // Standing Floor (South Gate) -> Base ₹6,500 (Range ₹5,800 - ₹7,200)
  // Level 1 Seated (West Wing) -> Base ₹6,000 (Range ₹5,400 - ₹6,600)
  // Level 3 General Stand -> Base ₹5,300 (Range ₹5,000 - ₹5,700)
  const categoryConfigs = {
    'Lounge VIP Experience': {
      basePrice: 7500,
      bids: [7450, 7400, 7350, 7300, 7250, 7200, 7150, 7100, 7050, 7000],
      asks: [7550, 7600, 7650, 7700, 7750, 7800, 7850, 7900, 7950, 8000],
      candlePrices: [7400, 7420, 7450, 7480, 7500, 7520, 7550, 7580, 7600, 7650, 7620, 7580, 7540, 7510, 7500],
    },
    'Standing Floor (South Gate)': {
      basePrice: 6500,
      bids: [6450, 6400, 6350, 6300, 6250, 6200, 6150, 6100, 6050, 6000],
      asks: [6550, 6600, 6650, 6700, 6750, 6800, 6850, 6900, 6950, 7000],
      candlePrices: [6350, 6380, 6400, 6420, 6450, 6480, 6500, 6520, 6550, 6580, 6600, 6580, 6540, 6510, 6500],
    },
    'Level 1 Seated (West Wing)': {
      basePrice: 6000,
      bids: [5950, 5900, 5850, 5800, 5750, 5700, 5650, 5600, 5550, 5500],
      asks: [6050, 6100, 6150, 6200, 6250, 6300, 6350, 6400, 6450, 6500],
      candlePrices: [5850, 5880, 5900, 5920, 5950, 5980, 6000, 6020, 6050, 6080, 6100, 6080, 6040, 6010, 6000],
    },
    'Level 3 General Stand': {
      basePrice: 5300,
      bids: [5280, 5250, 5220, 5190, 5160, 5130, 5100, 5070, 5040, 5000],
      asks: [5320, 5350, 5380, 5420, 5460, 5500, 5550, 5600, 5650, 5700],
      candlePrices: [5150, 5180, 5200, 5220, 5250, 5280, 5300, 5320, 5350, 5380, 5400, 5380, 5340, 5310, 5300],
    },
  };

  const quantities = [2, 3, 5, 4, 8, 6, 10, 7, 12, 15];

  for (const cat of event.categories) {
    const config = categoryConfigs[cat.name] || {
      basePrice: 6500,
      bids: [6450, 6400, 6350, 6300, 6250, 6200, 6150, 6100, 6050, 6000],
      asks: [6550, 6600, 6650, 6700, 6750, 6800, 6850, 6900, 6950, 7000],
      candlePrices: [6350, 6380, 6400, 6420, 6450, 6480, 6500, 6520, 6550, 6580, 6600, 6580, 6540, 6510, 6500],
    };

    // Update category originalPrice in database so UI matches
    await prisma.ticketCategory.update({
      where: { id: cat.id },
      data: { originalPrice: config.basePrice },
    });

    console.log(`\n======================================================`);
    console.log(`📌 Seeding: "${cat.name}" | Base: ₹${config.basePrice} (Range: ₹${config.bids[9]} - ₹${config.asks[9]})`);
    console.log(`======================================================`);

    // 10 BIDs
    for (let i = 0; i < 10; i++) {
      const p = config.bids[i] * 100; // in paise
      const q = quantities[i];
      const u = users[i % users.length];

      await prisma.order.create({
        data: {
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
        },
      });
      console.log(`  [BID #${i + 1}] ₹${p / 100} | Qty: ${q} | Trader: ${u.name}`);
    }

    // 10 ASKs
    for (let i = 0; i < 10; i++) {
      const p = config.asks[i] * 100; // in paise
      const q = quantities[i];
      const u = users[(i + 3) % users.length];

      await prisma.order.create({
        data: {
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
        },
      });
      console.log(`  [ASK #${i + 1}] ₹${p / 100} | Qty: ${q} | Trader: ${u.name}`);
    }

    // 15 Historical Candlestick Executions strictly in ₹5,000 - ₹8,000
    console.log(`  📊 Feeding 15 historical trade candles for chart...`);
    for (let c = 0; c < config.candlePrices.length; c++) {
      const hoursAgo = 24 - c * 1.5;
      const tradeTime = new Date(Date.now() - hoursAgo * 3600000);
      const tradePrice = config.candlePrices[c] * 100; // in paise
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
      console.log(`    [Candle #${c + 1}/15] ₹${tradePrice / 100} @ ${tradeTime.toISOString().slice(11, 19)}`);
    }
  }

  console.log('\n🎉 Successfully wiped old data and reseeded all Coldplay categories in the ₹5,000 - ₹8,000 range!');
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
