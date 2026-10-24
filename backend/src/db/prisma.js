import '../config/index.js';
import { PrismaClient } from '@prisma/client';

// Fail-safe guard: ensure PrismaClient never connects to shared Neon DB during tests
if (process.env.NODE_ENV === 'test') {
  const dbUrl = process.env.DATABASE_URL || '';
  if (dbUrl.includes('neon.tech') || dbUrl.includes('ep-cold-scene')) {
    throw new Error(
      '❌ [SAFETY GUARD]: PrismaClient cannot connect to shared/production Neon database during test execution!'
    );
  }
}

const globalForPrisma = globalThis;

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export default prisma;
