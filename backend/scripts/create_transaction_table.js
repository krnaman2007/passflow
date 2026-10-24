import '../src/config/index.js';
import prisma from '../src/db/prisma.js';

async function main() {
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      console.log(`Attempt ${attempt} to connect to Neon DB...`);
      await prisma.$executeRawUnsafe(`
        DO $$ BEGIN
          CREATE TYPE "TransactionType" AS ENUM ('DEPOSIT', 'WITHDRAW', 'HOLD', 'RELEASE', 'TRADE_DEBIT', 'TRADE_CREDIT', 'PURCHASE');
        EXCEPTION
          WHEN duplicate_object THEN null;
        END $$;
      `);

      await prisma.$executeRawUnsafe(`
        DO $$ BEGIN
          CREATE TYPE "TransactionStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');
        EXCEPTION
          WHEN duplicate_object THEN null;
        END $$;
      `);

      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "Transaction" (
          "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
          "walletId" TEXT NOT NULL,
          "amount" BIGINT NOT NULL,
          "type" "TransactionType" NOT NULL,
          "status" "TransactionStatus" NOT NULL DEFAULT 'COMPLETED',
          "description" TEXT,
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT "Transaction_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE
        );
      `);

      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS "Transaction_walletId_idx" ON "Transaction"("walletId");
      `);

      console.log('Transaction table created successfully in PostgreSQL');
      return;
    } catch (err) {
      console.warn(`Attempt ${attempt} failed: ${err.message}. Retrying in 2s...`);
      await new Promise(r => setTimeout(r, 2000));
    }
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
