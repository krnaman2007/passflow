import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  await prisma.$executeRawUnsafe('ALTER TABLE "TicketOwnership" ADD COLUMN IF NOT EXISTS "transactionId" TEXT;');
  console.log('ALTER TABLE TicketOwnership SUCCESSFUL');
}

main().finally(() => prisma.$disconnect());
