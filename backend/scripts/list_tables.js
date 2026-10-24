import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const tables = await prisma.$queryRawUnsafe(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' 
    ORDER BY table_name;
  `);
  console.log('PUBLIC TABLES IN NEON DB:');
  for (const t of tables) {
    const cols = await prisma.$queryRawUnsafe(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = '${t.table_name}';
    `);
    console.log(`- ${t.table_name}: [${cols.map(c => c.column_name).join(', ')}]`);
  }
}

main().finally(() => prisma.$disconnect());
