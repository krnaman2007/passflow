import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🚀 Seeding users, 10 BIDs, 10 ASKs, and candlestick trade history for orderbook & chart...');

  const passwordHash = await bcrypt.hash('Password123!', 10);

  // 1. Create or ensure realistic traders exist with funded wallets
  const newTraders = [
    { name: 'Aarav Patel', email: 'aarav@passflow.com' },
    { name: 'Diya Mehta', email: 'diya@passflow.com' },
    { name: 'Kabir Sen', email: 'kabir@passflow.com' },
    { name: 'Ananya Roy', email: 'ananya@passflow.com' },
    { name: 'Vikram Malhotra', email: 'vikram@passflow.com' },
    { name: 'Neha Kapoor', email: 'neha@passflow.com' },
  ];

  const users = [];
  for (const t of newTraders) {
    let u = await prisma.user.findUnique({ where: { email: t.email } });
    if (!u) {
      u = await prisma.user.create({
        data: {
          name: t.name,
          email: t.email,
          passwordHash,
          role: 'USER',
        },
      });
      console.log(` Created user: ${t.name} (${t.email})`);
    }

    // Ensure wallet exists with ample balance (₹10,00,000 = 100000000 paise)
    await prisma.wallet.upsert({
      where: { userId: u.id },
      update: {
        availableBalance: 100000000n,
      },
      create: {
        userId: u.id,
        availableBalance: 100000000n,
        reservedBalance: 0n,
        currency: 'INR',
      },
    });

    users.push(u);
  }

  // Also include any existing users
  const existingUsers = await prisma.user.findMany({
    where: { email: { in: ['ali@passflow.com', 'priya@passflow.com', 'rohit@passflow.com'] } },
  });
  users.push(...existingUsers);

  // 2. Identify target event and category (Default: Coldplay Standing Floor)
  let event = await prisma.event.findFirst({
    where: { name: { contains: 'Coldplay', mode: 'insensitive' } },
    include: { categories: true },
  });

  if (!event) {
    event = await prisma.event.findFirst({
      include: { categories: true },
    });
  }

  if (!event || !event.categories || event.categories.length === 0) {
    console.error('❌ No event found to seed orders into. Please run seed_clean_real_data.js first.');
    process.exit(1);
  }

  const category = event.categories.find((c) => c.name.toLowerCase().includes('standing')) || event.categories[0];

  console.log(`🎯 Target Event: "${event.name}" (${event.id})`);
  console.log(`🎯 Target Category: "${category.name}" (${category.id}) - Base Price: ₹${category.originalPrice}`);

  // 3. Mark previous OPEN orders as CANCELLED so they don't clutter the orderbook
  const cancelledOld = await prisma.order.updateMany({
    where: {
      eventId: event.id,
      ticketCategoryId: category.id,
      status: { in: ['OPEN', 'PARTIALLY_FILLED'] },
    },
    data: {
      status: 'CANCELLED',
      remainingQuantity: 0,
    },
  });
  console.log(`🧹 Cancelled ${cancelledOld.count} previous open orders for this category`);

  // 4. Feed 10 BIDs (Buy Orders) descending below market price
  // Amounts in minor units (paise: 1 INR = 100 paise)
  const bidPresets = [
    { price: 648000, qty: 3, userIdx: 0 }, // ₹6,480.00
    { price: 645000, qty: 5, userIdx: 1 }, // ₹6,450.00
    { price: 640000, qty: 4, userIdx: 2 }, // ₹6,400.00
    { price: 635000, qty: 8, userIdx: 3 }, // ₹6,350.00
    { price: 630000, qty: 6, userIdx: 4 }, // ₹6,300.00
    { price: 625000, qty: 10, userIdx: 5 }, // ₹6,250.00
    { price: 620000, qty: 7, userIdx: 0 }, // ₹6,200.00
    { price: 615000, qty: 12, userIdx: 1 }, // ₹6,150.00
    { price: 610000, qty: 9, userIdx: 2 }, // ₹6,100.00
    { price: 605000, qty: 15, userIdx: 3 }, // ₹6,050.00
  ];

  console.log('📈 Feeding 10 BIDs (Buy Orders)...');
  for (let i = 0; i < bidPresets.length; i++) {
    const b = bidPresets[i];
    const u = users[b.userIdx % users.length];
    await prisma.order.create({
      data: {
        userId: u.id,
        eventId: event.id,
        ticketCategoryId: category.id,
        side: 'BID',
        orderType: 'LIMIT',
        status: 'OPEN',
        price: b.price,
        initialQuantity: b.qty,
        remainingQuantity: b.qty,
        createdAt: new Date(Date.now() - (bidPresets.length - i) * 120000), // staggered timestamps
      },
    });
    console.log(`  [BID #${i + 1}] ₹${(b.price / 100).toFixed(2)} | Qty: ${b.qty} | Trader: ${u.name}`);
  }

  // 5. Feed 10 ASKs (Sell Orders) ascending above market price
  const askPresets = [
    { price: 652000, qty: 2, userIdx: 4 }, // ₹6,520.00
    { price: 655000, qty: 4, userIdx: 5 }, // ₹6,550.00
    { price: 660000, qty: 6, userIdx: 0 }, // ₹6,600.00
    { price: 665000, qty: 5, userIdx: 1 }, // ₹6,650.00
    { price: 670000, qty: 8, userIdx: 2 }, // ₹6,700.00
    { price: 675000, qty: 7, userIdx: 3 }, // ₹6,750.00
    { price: 680000, qty: 10, userIdx: 4 }, // ₹6,800.00
    { price: 685000, qty: 9, userIdx: 5 }, // ₹6,850.00
    { price: 690000, qty: 14, userIdx: 0 }, // ₹6,900.00
    { price: 695000, qty: 20, userIdx: 1 }, // ₹6,950.00
  ];

  console.log('📉 Feeding 10 ASKs (Sell Orders)...');
  for (let i = 0; i < askPresets.length; i++) {
    const a = askPresets[i];
    const u = users[a.userIdx % users.length];
    await prisma.order.create({
      data: {
        userId: u.id,
        eventId: event.id,
        ticketCategoryId: category.id,
        side: 'ASK',
        orderType: 'LIMIT',
        status: 'OPEN',
        price: a.price,
        initialQuantity: a.qty,
        remainingQuantity: a.qty,
        createdAt: new Date(Date.now() - (askPresets.length - i) * 120000),
      },
    });
    console.log(`  [ASK #${i + 1}] ₹${(a.price / 100).toFixed(2)} | Qty: ${a.qty} | Trader: ${u.name}`);
  }

  // 6. Feed Historical Trade Executions across time buckets so TradingChart renders real candles
  console.log('📊 Feeding Historical Executions across time intervals for OHLC Chart...');
  const candleHistory = [
    { hoursAgo: 24, price: 635000, qty: 2 },
    { hoursAgo: 22, price: 638000, qty: 3 },
    { hoursAgo: 20, price: 641000, qty: 4 },
    { hoursAgo: 18, price: 640000, qty: 1 },
    { hoursAgo: 16, price: 644000, qty: 5 },
    { hoursAgo: 14, price: 647000, qty: 2 },
    { hoursAgo: 12, price: 650000, qty: 6 },
    { hoursAgo: 10, price: 648000, qty: 3 },
    { hoursAgo: 8,  price: 652000, qty: 4 },
    { hoursAgo: 6,  price: 655000, qty: 7 },
    { hoursAgo: 4,  price: 653000, qty: 5 },
    { hoursAgo: 3,  price: 650000, qty: 2 },
    { hoursAgo: 2,  price: 649000, qty: 4 },
    { hoursAgo: 1,  price: 651000, qty: 3 },
    { hoursAgo: 0.5, price: 650000, qty: 6 },
  ];

  for (let i = 0; i < candleHistory.length; i++) {
    const ch = candleHistory[i];
    const tradeTime = new Date(Date.now() - ch.hoursAgo * 60 * 60 * 1000);
    const buyer = users[i % users.length];
    const seller = users[(i + 1) % users.length];

    // Create completed pair orders
    const buyOrder = await prisma.order.create({
      data: {
        userId: buyer.id,
        eventId: event.id,
        ticketCategoryId: category.id,
        side: 'BID',
        orderType: 'LIMIT',
        status: 'FILLED',
        price: ch.price,
        initialQuantity: ch.qty,
        remainingQuantity: 0,
        createdAt: tradeTime,
      },
    });

    const sellOrder = await prisma.order.create({
      data: {
        userId: seller.id,
        eventId: event.id,
        ticketCategoryId: category.id,
        side: 'ASK',
        orderType: 'LIMIT',
        status: 'FILLED',
        price: ch.price,
        initialQuantity: ch.qty,
        remainingQuantity: 0,
        createdAt: tradeTime,
      },
    });

    // Create execution record
    await prisma.execution.create({
      data: {
        incomingOrderId: buyOrder.id,
        restingOrderId: sellOrder.id,
        price: ch.price,
        quantity: ch.qty,
        settlementStatus: 'SETTLED',
        executedAt: tradeTime,
      },
    });
  }

  console.log(` Created ${candleHistory.length} historical execution records spanning the last 24 hours.`);
  console.log('✅ Successfully seeded 10 BIDs, 10 ASKs, and full chart candle history!');
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
