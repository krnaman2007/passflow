import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function check() {
  const tables = await prisma.$queryRaw`
    SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;
  `;
  console.log('Tables in DB:', tables.map(t => t.table_name));
}

check().catch(console.error).finally(() => prisma.$disconnect());
