import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🔄 Cleaning old database tables...');

  // Disable custom immutability triggers on WalletLedgerEntry during reset
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "WalletLedgerEntry" DISABLE TRIGGER wallet_ledger_truncate_trigger;
  `).catch(() => {});
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "WalletLedgerEntry" DISABLE TRIGGER wallet_ledger_immutability_trigger;
  `).catch(() => {});

  // Query all existing tables in public schema except migrations
  const tableRows = await prisma.$queryRawUnsafe(`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename != '_prisma_migrations';
  `);
  
  const tableNames = tableRows.map((t) => `"${t.tablename}"`).join(', ');
  if (tableNames.length > 0) {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tableNames} CASCADE;`);
  }

  // Re-enable custom immutability triggers
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "WalletLedgerEntry" ENABLE TRIGGER wallet_ledger_truncate_trigger;
  `).catch(() => {});
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "WalletLedgerEntry" ENABLE TRIGGER wallet_ledger_immutability_trigger;
  `).catch(() => {});




  console.log('✓ All previous tables cleaned successfully!');

  // Common password hash for test users
  const passwordHash = await bcrypt.hash('Password123!', 10);

  // 1. Create Core Users
  console.log('👤 Creating realistic users...');

  // Admin User
  const adminUser = await prisma.user.create({
    data: {
      name: 'System Administrator',
      email: 'admin@passflow.com',
      passwordHash,
      role: 'ADMIN',
      phone: '+91 99999 00001',
      admin: {
        create: {
          name: 'System Administrator',
          email: 'admin@passflow.com',
          role: 'ADMIN',
        },
      },
    },
  });


  // Organizers
  const liveNationUser = await prisma.user.create({
    data: {
      name: 'Live Nation India',
      email: 'organizer@livenation.com',
      passwordHash,
      role: 'ORGANIZER',
      phone: '+91 98200 11223',
      organizer: {
        create: {
          organizationName: 'Live Nation India & BookMyShow Live',
          verificationStatus: 'VERIFIED',
        },
      },
    },
    include: { organizer: true },
  });

  const bcciUser = await prisma.user.create({
    data: {
      name: 'BCCI Ticketing Operations',
      email: 'ticketing@bcci.tv',
      passwordHash,
      role: 'ORGANIZER',
      phone: '+91 98200 44556',
      organizer: {
        create: {
          organizationName: 'Board of Control for Cricket in India (BCCI)',
          verificationStatus: 'VERIFIED',
        },
      },
    },
    include: { organizer: true },
  });

  const omlUser = await prisma.user.create({
    data: {
      name: 'OML Entertainment Live',
      email: 'live@oml.in',
      passwordHash,
      role: 'ORGANIZER',
      phone: '+91 98200 77889',
      organizer: {
        create: {
          organizationName: 'OML Entertainment & Comedy Central Live',
          verificationStatus: 'VERIFIED',
        },
      },
    },
    include: { organizer: true },
  });

  // Regular Users / Traders
  const aliUser = await prisma.user.create({
    data: {
      id: 'usr_ali_001',
      name: 'Ali Khan',
      email: 'ali@passflow.com',
      passwordHash,
      role: 'USER',
      phone: '+91 98765 43210',
      wallet: {
        create: {
          availableBalance: 5000000n, // ₹50,000.00 (in paise)
          reservedBalance: 650000n,   // ₹6,500.00 held in order
        },
      },
    },
    include: { wallet: true },
  });

  const priyaUser = await prisma.user.create({
    data: {
      name: 'Priya Sharma',
      email: 'priya@passflow.com',
      passwordHash,
      role: 'USER',
      phone: '+91 98123 45678',
      wallet: {
        create: {
          availableBalance: 3500000n, // ₹35,000.00
          reservedBalance: 0n,
        },
      },
    },
    include: { wallet: true },
  });

  const rohitUser = await prisma.user.create({
    data: {
      name: 'Rohit Verma',
      email: 'rohit@passflow.com',
      passwordHash,
      role: 'USER',
      phone: '+91 99887 76655',
      wallet: {
        create: {
          availableBalance: 2500000n, // ₹25,000.00
          reservedBalance: 1200000n,  // ₹12,000.00
        },
      },
    },
    include: { wallet: true },
  });

  console.log('✓ Users & Wallets created successfully!');

  // 2. Seed Real High-Profile Events
  console.log('🎟️ Seeding real events and categories...');

  // Event 1: Coldplay
  const coldplayEvent = await prisma.event.create({
    data: {
      name: 'Coldplay: Music of the Spheres World Tour',
      description:
        'Live in Mumbai at DY Patil Stadium with full LED wristbands, sustainable kinetic stages, and guest performances.',
      dateTime: new Date('2026-12-18T19:00:00Z'),
      location: 'DY Patil Stadium, Navi Mumbai',
      organizerId: liveNationUser.organizer.id,
      status: 'PUBLISHED',
      originalPrice: 3500,
      categories: {
        create: [
          {
            name: 'Standing Floor (South Gate)',
            originalPrice: 6500,
            totalQuantity: 2500,
            availableQuantity: 140,
            status: 'ACTIVE',
            inventory: {
              create: {
                totalQuantity: 2500,
                availableQuantity: 140,
                reservedQuantity: 10,
              },
            },
          },
          {
            name: 'Lounge VIP Experience',
            originalPrice: 25000,
            totalQuantity: 200,
            availableQuantity: 18,
            status: 'ACTIVE',
            inventory: {
              create: {
                totalQuantity: 200,
                availableQuantity: 18,
                reservedQuantity: 2,
              },
            },
          },
          {
            name: 'Level 1 Seated (West Wing)',
            originalPrice: 9500,
            totalQuantity: 1500,
            availableQuantity: 85,
            status: 'ACTIVE',
            inventory: {
              create: {
                totalQuantity: 1500,
                availableQuantity: 85,
                reservedQuantity: 5,
              },
            },
          },
          {
            name: 'Level 3 General Stand',
            originalPrice: 3500,
            totalQuantity: 5000,
            availableQuantity: 410,
            status: 'ACTIVE',
            inventory: {
              create: {
                totalQuantity: 5000,
                availableQuantity: 410,
                reservedQuantity: 20,
              },
            },
          },
        ],
      },
    },
    include: { categories: true },
  });

  // Event 2: Diljit Dosanjh
  const diljitEvent = await prisma.event.create({
    data: {
      name: 'Diljit Dosanjh — Dil-Luminati Tour Arena Edition',
      description:
        'The historic stadium Punjabi tour bringing record-breaking stage production, Punjabi folk fusion, and pyrotechnics.',
      dateTime: new Date('2026-11-28T20:00:00Z'),
      location: 'Indira Gandhi Indoor Stadium, New Delhi',
      organizerId: liveNationUser.organizer.id,
      status: 'PUBLISHED',
      originalPrice: 3000,
      categories: {
        create: [
          {
            name: 'Fan Pit VIP (Front-Stage)',
            originalPrice: 16000,
            totalQuantity: 300,
            availableQuantity: 0, // SOLD OUT in primary!
            status: 'SOLD_OUT',
            inventory: {
              create: {
                totalQuantity: 300,
                availableQuantity: 0,
                reservedQuantity: 0,
              },
            },
          },
          {
            name: 'Gold Seated (Lower Bowl)',
            originalPrice: 7000,
            totalQuantity: 2500,
            availableQuantity: 68,
            status: 'ACTIVE',
            inventory: {
              create: {
                totalQuantity: 2500,
                availableQuantity: 68,
                reservedQuantity: 12,
              },
            },
          },
          {
            name: 'Silver Gallery',
            originalPrice: 3000,
            totalQuantity: 6000,
            availableQuantity: 180,
            status: 'ACTIVE',
            inventory: {
              create: {
                totalQuantity: 6000,
                availableQuantity: 180,
                reservedQuantity: 25,
              },
            },
          },
        ],
      },
    },
    include: { categories: true },
  });

  // Event 3: Arijit Singh Symphony
  const arijitEvent = await prisma.event.create({
    data: {
      name: 'Arijit Singh Symphony Live 2026',
      description:
        'A magical 45-piece international live orchestral symphony accompanying the soulful voice of Arijit Singh.',
      dateTime: new Date('2026-11-15T18:30:00Z'),
      location: 'Jawaharlal Nehru Stadium, New Delhi',
      organizerId: liveNationUser.organizer.id,
      status: 'PUBLISHED',
      originalPrice: 2200,
      categories: {
        create: [
          {
            name: 'Platinum Front Row',
            originalPrice: 12000,
            totalQuantity: 350,
            availableQuantity: 22,
            status: 'ACTIVE',
            inventory: {
              create: {
                totalQuantity: 350,
                availableQuantity: 22,
                reservedQuantity: 4,
              },
            },
          },
          {
            name: 'Gold Circle Standing',
            originalPrice: 4500,
            totalQuantity: 3000,
            availableQuantity: 210,
            status: 'ACTIVE',
            inventory: {
              create: {
                totalQuantity: 3000,
                availableQuantity: 210,
                reservedQuantity: 15,
              },
            },
          },
          {
            name: 'Silver Grandstand',
            originalPrice: 2200,
            totalQuantity: 4500,
            availableQuantity: 320,
            status: 'ACTIVE',
            inventory: {
              create: {
                totalQuantity: 4500,
                availableQuantity: 320,
                reservedQuantity: 30,
              },
            },
          },
        ],
      },
    },
    include: { categories: true },
  });

  // Event 4: India vs Australia Blockbuster
  const cricketEvent = await prisma.event.create({
    data: {
      name: 'ICC T20 Championship: India vs Australia',
      description:
        'High-voltage international cricket clash at the iconic Eden Gardens under world-class floodlights with 65,000 roaring fans.',
      dateTime: new Date('2027-01-10T19:00:00Z'),
      location: 'Eden Gardens, Kolkata',
      organizerId: bcciUser.organizer.id,
      status: 'PUBLISHED',
      originalPrice: 1800,
      categories: {
        create: [
          {
            name: 'Club House Premium Tier',
            originalPrice: 15000,
            totalQuantity: 400,
            availableQuantity: 12,
            status: 'ACTIVE',
            inventory: {
              create: {
                totalQuantity: 400,
                availableQuantity: 12,
                reservedQuantity: 2,
              },
            },
          },
          {
            name: 'Lower Tier Pavilion',
            originalPrice: 5000,
            totalQuantity: 4000,
            availableQuantity: 95,
            status: 'ACTIVE',
            inventory: {
              create: {
                totalQuantity: 4000,
                availableQuantity: 95,
                reservedQuantity: 15,
              },
            },
          },
          {
            name: 'Upper Gallery Tier B',
            originalPrice: 1800,
            totalQuantity: 12000,
            availableQuantity: 1250,
            status: 'ACTIVE',
            inventory: {
              create: {
                totalQuantity: 12000,
                availableQuantity: 1250,
                reservedQuantity: 50,
              },
            },
          },
        ],
      },
    },
    include: { categories: true },
  });

  // Event 5: Sunburn Goa
  const sunburnEvent = await prisma.event.create({
    data: {
      name: 'Sunburn Goa EDM Festival 2026 (3-Day Pass)',
      description:
        'Asia’s largest electronic music celebration across 4 mega stages with world #1 DJs, beach sunsets, and camping.',
      dateTime: new Date('2026-12-28T16:00:00Z'),
      location: 'Vagator Beach, North Goa',
      organizerId: liveNationUser.organizer.id,
      status: 'PUBLISHED',
      originalPrice: 4500,
      categories: {
        create: [
          {
            name: 'VIP 3-Day Arena Pass',
            originalPrice: 18000,
            totalQuantity: 500,
            availableQuantity: 45,
            status: 'ACTIVE',
            inventory: {
              create: {
                totalQuantity: 500,
                availableQuantity: 45,
                reservedQuantity: 5,
              },
            },
          },
          {
            name: 'General Admission 3-Day',
            originalPrice: 7500,
            totalQuantity: 8000,
            availableQuantity: 540,
            status: 'ACTIVE',
            inventory: {
              create: {
                totalQuantity: 8000,
                availableQuantity: 540,
                reservedQuantity: 25,
              },
            },
          },
          {
            name: 'Early Bird Student Pass',
            originalPrice: 4500,
            totalQuantity: 2000,
            availableQuantity: 0, // SOLD OUT!
            status: 'SOLD_OUT',
            inventory: {
              create: {
                totalQuantity: 2000,
                availableQuantity: 0,
                reservedQuantity: 0,
              },
            },
          },
        ],
      },
    },
    include: { categories: true },
  });

  // Event 6: Zakir Khan
  const zakirEvent = await prisma.event.create({
    data: {
      name: 'Zakir Khan Live — "Tathastu & Beyond" Tour',
      description:
        'An intimate, poignant and rib-tickling standup comedy experience by the master storyteller Zakir Khan.',
      dateTime: new Date('2026-11-20T20:00:00Z'),
      location: 'NCPA Tata Theatre, Nariman Point, Mumbai',
      organizerId: omlUser.organizer.id,
      status: 'PUBLISHED',
      originalPrice: 999,
      categories: {
        create: [
          {
            name: 'VIP Balcony',
            originalPrice: 2500,
            totalQuantity: 150,
            availableQuantity: 14,
            status: 'ACTIVE',
            inventory: {
              create: {
                totalQuantity: 150,
                availableQuantity: 14,
                reservedQuantity: 2,
              },
            },
          },
          {
            name: 'Orchestra Center',
            originalPrice: 1800,
            totalQuantity: 400,
            availableQuantity: 32,
            status: 'ACTIVE',
            inventory: {
              create: {
                totalQuantity: 400,
                availableQuantity: 32,
                reservedQuantity: 4,
              },
            },
          },
          {
            name: 'Upper Circle',
            originalPrice: 999,
            totalQuantity: 300,
            availableQuantity: 45,
            status: 'ACTIVE',
            inventory: {
              create: {
                totalQuantity: 300,
                availableQuantity: 45,
                reservedQuantity: 5,
              },
            },
          },
        ],
      },
    },
    include: { categories: true },
  });

  console.log('✓ 6 Live Events and Ticket Categories created!');

  // 3. Seed Realistic Active Resale Order Books & Trades
  console.log('📈 Seeding authentic Order Books and Executions...');

  // Target: Coldplay Standing Floor Category
  const coldplayStanding = coldplayEvent.categories.find(
    (c) => c.name.includes('Standing')
  );

  if (coldplayStanding) {
    // Resting BIDs (Buy orders in paise, e.g. ₹6,400 = 640000 paise)
    const bid1 = await prisma.order.create({
      data: {
        userId: rohitUser.id,
        eventId: coldplayEvent.id,
        ticketCategoryId: coldplayStanding.id,
        side: 'BID',
        status: 'OPEN',
        price: 640000, // ₹6,400.00
        initialQuantity: 2,
        remainingQuantity: 2,
      },
    });

    await prisma.order.create({
      data: {
        userId: priyaUser.id,
        eventId: coldplayEvent.id,
        ticketCategoryId: coldplayStanding.id,
        side: 'BID',
        status: 'OPEN',
        price: 630000, // ₹6,300.00
        initialQuantity: 4,
        remainingQuantity: 4,
      },
    });

    await prisma.order.create({
      data: {
        userId: rohitUser.id,
        eventId: coldplayEvent.id,
        ticketCategoryId: coldplayStanding.id,
        side: 'BID',
        status: 'OPEN',
        price: 615000, // ₹6,150.00
        initialQuantity: 6,
        remainingQuantity: 6,
      },
    });

    await prisma.order.create({
      data: {
        userId: priyaUser.id,
        eventId: coldplayEvent.id,
        ticketCategoryId: coldplayStanding.id,
        side: 'BID',
        status: 'OPEN',
        price: 600000, // ₹6,000.00
        initialQuantity: 10,
        remainingQuantity: 10,
      },
    });

    // Resting ASKs (Sell orders in paise, e.g. ₹6,600 = 660000 paise)
    const ask1 = await prisma.order.create({
      data: {
        userId: aliUser.id,
        eventId: coldplayEvent.id,
        ticketCategoryId: coldplayStanding.id,
        side: 'ASK',
        status: 'OPEN',
        price: 660000, // ₹6,600.00
        initialQuantity: 2,
        remainingQuantity: 2,
      },
    });

    await prisma.order.create({
      data: {
        userId: priyaUser.id,
        eventId: coldplayEvent.id,
        ticketCategoryId: coldplayStanding.id,
        side: 'ASK',
        status: 'OPEN',
        price: 675000, // ₹6,750.00
        initialQuantity: 4,
        remainingQuantity: 4,
      },
    });

    await prisma.order.create({
      data: {
        userId: rohitUser.id,
        eventId: coldplayEvent.id,
        ticketCategoryId: coldplayStanding.id,
        side: 'ASK',
        status: 'OPEN',
        price: 690000, // ₹6,900.00
        initialQuantity: 5,
        remainingQuantity: 5,
      },
    });

    await prisma.order.create({
      data: {
        userId: priyaUser.id,
        eventId: coldplayEvent.id,
        ticketCategoryId: coldplayStanding.id,
        side: 'ASK',
        status: 'OPEN',
        price: 710000, // ₹7,100.00
        initialQuantity: 8,
        remainingQuantity: 8,
      },
    });

    // Realistic Completed Executions / Public Trades
    await prisma.execution.create({
      data: {
        incomingOrderId: bid1.id,
        restingOrderId: ask1.id,
        price: 650000, // ₹6,500.00
        quantity: 2,
        settlementStatus: 'SETTLED',
        executedAt: new Date(Date.now() - 15 * 60 * 1000), // 15 mins ago
      },
    });

    await prisma.execution.create({
      data: {
        incomingOrderId: bid1.id,
        restingOrderId: ask1.id,
        price: 655000, // ₹6,550.00
        quantity: 4,
        settlementStatus: 'SETTLED',
        executedAt: new Date(Date.now() - 45 * 60 * 1000), // 45 mins ago
      },
    });

    await prisma.execution.create({
      data: {
        incomingOrderId: bid1.id,
        restingOrderId: ask1.id,
        price: 648000, // ₹6,480.00
        quantity: 1,
        settlementStatus: 'SETTLED',
        executedAt: new Date(Date.now() - 90 * 60 * 1000), // 1.5 hours ago
      },
    });
  }

  // Target: Diljit Fan Pit (Sold out tier with active secondary market)
  const diljitFanPit = diljitEvent.categories.find((c) =>
    c.name.includes('Fan Pit')
  );

  if (diljitFanPit) {
    // Resting BIDs
    const diljitBid = await prisma.order.create({
      data: {
        userId: aliUser.id,
        eventId: diljitEvent.id,
        ticketCategoryId: diljitFanPit.id,
        side: 'BID',
        status: 'OPEN',
        price: 1650000, // ₹16,500.00
        initialQuantity: 2,
        remainingQuantity: 2,
      },
    });

    await prisma.order.create({
      data: {
        userId: priyaUser.id,
        eventId: diljitEvent.id,
        ticketCategoryId: diljitFanPit.id,
        side: 'BID',
        status: 'OPEN',
        price: 1620000, // ₹16,200.00
        initialQuantity: 3,
        remainingQuantity: 3,
      },
    });

    // Resting ASKs
    const diljitAsk = await prisma.order.create({
      data: {
        userId: rohitUser.id,
        eventId: diljitEvent.id,
        ticketCategoryId: diljitFanPit.id,
        side: 'ASK',
        status: 'OPEN',
        price: 1720000, // ₹17,200.00
        initialQuantity: 1,
        remainingQuantity: 1,
      },
    });

    await prisma.order.create({
      data: {
        userId: rohitUser.id,
        eventId: diljitEvent.id,
        ticketCategoryId: diljitFanPit.id,
        side: 'ASK',
        status: 'OPEN',
        price: 1750000, // ₹17,500.00
        initialQuantity: 2,
        remainingQuantity: 2,
      },
    });


    // Executed Trade
    await prisma.execution.create({
      data: {
        incomingOrderId: diljitBid.id,
        restingOrderId: diljitAsk.id,
        price: 1680000, // ₹16,800.00
        quantity: 2,
        settlementStatus: 'SETTLED',
        executedAt: new Date(Date.now() - 30 * 60 * 1000),
      },
    });
  }

  // 4. Seed User Ali's Real Ticket Vault
  console.log('🎫 Issuing verified authentic tickets to Ali Khan...');

  const issuedTickets = [
    {
      eventId: coldplayEvent.id,
      categoryId: coldplayStanding.id,
      faceValue: 6500,
      status: 'OWNED',
    },
    {
      eventId: diljitEvent.id,
      categoryId: diljitEvent.categories[1].id, // Gold Seated
      faceValue: 7000,
      status: 'OWNED',
    },
    {
      eventId: arijitEvent.id,
      categoryId: arijitEvent.categories[1].id, // Gold Circle
      faceValue: 4500,
      status: 'OWNED',
    },
    {
      eventId: cricketEvent.id,
      categoryId: cricketEvent.categories[1].id, // Lower Pavilion
      faceValue: 5000,
      status: 'OWNED',
    },
  ];

  for (let i = 0; i < issuedTickets.length; i++) {
    const item = issuedTickets[i];

    const ticket = await prisma.ticket.create({
      data: {
        eventId: item.eventId,
        categoryId: item.categoryId,
        ownerId: aliUser.id,
        faceValue: item.faceValue,
        currentPrice: item.faceValue,
        status: item.status,
      },
    });

    await prisma.$executeRawUnsafe(
      `INSERT INTO "TicketOwnership" ("id", "ticketId", "ownerId", "acquiredAt", "source") VALUES (gen_random_uuid(), '${ticket.id}', '${aliUser.id}', NOW(), 'PRIMARY');`
    );
  }



  console.log('========================================================');
  console.log('✅ DATABASE SUCCESSFULLY SEEDED WITH ULTRA-REALISTIC DATA!');
  console.log('========================================================');
  console.log('Events Created:');
  console.log(' 1. Coldplay: Music of the Spheres World Tour (Mumbai)');
  console.log(' 2. Diljit Dosanjh — Dil-Luminati Tour Arena Edition (New Delhi)');
  console.log(' 3. Arijit Singh Symphony Live 2026 (New Delhi)');
  console.log(' 4. ICC T20 Championship: India vs Australia (Eden Gardens, Kolkata)');
  console.log(' 5. Sunburn Goa EDM Festival 2026 (3-Day Pass)');
  console.log(' 6. Zakir Khan Live — Tathastu & Beyond Tour (Mumbai)');
  console.log('');
  console.log('Login credentials for testing:');
  console.log(' - User: ali@passflow.com / Password123! (Balance: ₹50,000)');
  console.log(' - Organizer: organizer@livenation.com / Password123!');
  console.log(' - Admin: admin@passflow.com / Password123!');
  console.log('========================================================');
}

main()
  .catch((e) => {
    console.error('❌ Error seeding database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
