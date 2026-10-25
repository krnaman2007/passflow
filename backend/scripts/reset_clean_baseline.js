import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🔄 Cleaning all current events, orders, trades, tickets, and non-admin data...');

  // 1. Disable custom immutability triggers on WalletLedgerEntry during reset
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "WalletLedgerEntry" DISABLE TRIGGER wallet_ledger_truncate_trigger;
  `).catch(() => {});
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "WalletLedgerEntry" DISABLE TRIGGER wallet_ledger_immutability_trigger;
  `).catch(() => {});

  // 2. Truncate all tables in public schema except migrations
  const tableRows = await prisma.$queryRawUnsafe(`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename != '_prisma_migrations';
  `);

  const tableNames = tableRows.map((t) => `"${t.tablename}"`).join(', ');
  if (tableNames.length > 0) {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tableNames} CASCADE;`);
  }

  // 3. Re-enable custom immutability triggers
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "WalletLedgerEntry" ENABLE TRIGGER wallet_ledger_truncate_trigger;
  `).catch(() => {});
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "WalletLedgerEntry" ENABLE TRIGGER wallet_ledger_immutability_trigger;
  `).catch(() => {});

  console.log('✓ All database tables completely wiped clean!');

  // Common password hash for test users
  const passwordHash = await bcrypt.hash('Password123!', 10);

  console.log('👤 Seeding baseline users for clean testing...');

  // 1. Platform Admin
  await prisma.user.create({
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
      wallet: {
        create: {
          availableBalance: 100000000n, // ₹10,00,000.00
          reservedBalance: 0n,
          currency: 'INR',
        },
      },
    },
  });
  console.log('  ✓ Admin created: admin@passflow.com (Password123!)');

  // 2. Verified Organizer (Live Nation)
  await prisma.user.create({
    data: {
      name: 'Live Nation India',
      email: 'organizer@livenation.com',
      passwordHash,
      role: 'ORGANIZER',
      phone: '+91 98200 11223',
      organizer: {
        create: {
          organizationName: 'Live Nation India',
          verificationStatus: 'VERIFIED',
        },
      },
      wallet: {
        create: {
          availableBalance: 50000000n, // ₹5,00,000.00
          reservedBalance: 0n,
          currency: 'INR',
        },
      },
    },
  });
  console.log('  ✓ Organizer created: organizer@livenation.com (Password123!)');

  // 3. Buyer / Trader: Ali Khan
  await prisma.user.create({
    data: {
      name: 'Ali Khan',
      email: 'ali@passflow.com',
      passwordHash,
      role: 'USER',
      phone: '+91 98765 43210',
      buyerSeller: {
        create: {
          kycStatus: 'VERIFIED',
        },
      },
      wallet: {
        create: {
          availableBalance: 5000000n, // ₹50,000.00 in paise
          reservedBalance: 0n,
          currency: 'INR',
        },
      },
    },
  });
  console.log('  ✓ Buyer/Trader created: ali@passflow.com (Password123!) [Balance: ₹50,000.00]');

  console.log('\n================================================================');
  console.log('🚀 CLEAN BASELINE READY:');
  console.log('- 0 Events');
  console.log('- 0 Orders');
  console.log('- 0 Trades');
  console.log('- 0 Tickets');
  console.log('- Baseline accounts available to login and test:');
  console.log('    1. Buyer:      ali@passflow.com / Password123!');
  console.log('    2. Organizer:  organizer@livenation.com / Password123!');
  console.log('    3. Admin:      admin@passflow.com / Password123!');
  console.log('================================================================\n');
}

main()
  .catch((e) => {
    console.error('❌ Reset failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
