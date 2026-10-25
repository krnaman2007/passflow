import '../config/index.js';
import { PrismaClient } from '@prisma/client';
import logger from '../errorlogging/logger.js';

// Fail-safe guard: ensure PrismaClient never connects to shared Neon DB during tests
if (process.env.NODE_ENV === 'test') {
  const dbUrl = process.env.DATABASE_URL || '';
  if (dbUrl.includes('neon.tech') || dbUrl.includes('ep-cold-scene')) {
    throw new Error(
      '❌ [SAFETY GUARD]: PrismaClient cannot connect to shared/production Neon database during test execution!'
    );
  }
}

const RETRYABLE_CODES = new Set(['P1001', 'P1002', 'P1008', 'P1017', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE']);

function isTransientNetworkError(err) {
  if (!err) return false;
  if (err.code && RETRYABLE_CODES.has(err.code)) return true;
  const msg = typeof err.message === 'string' ? err.message : '';
  return (
    msg.includes("Can't reach database server") ||
    msg.includes('connection pool') ||
    msg.includes('Connection terminated unexpectedly') ||
    msg.includes('Connection reset') ||
    msg.includes('socket hang up') ||
    msg.includes('ETIMEDOUT') ||
    msg.includes('ECONNRESET')
  );
}

const globalForPrisma = globalThis;

function createResilientPrismaClient() {
  const basePrisma = new PrismaClient({
    transactionOptions: {
      maxWait: 15000,
      timeout: 45000,
    },
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  });

  return basePrisma.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          let attempts = 0;
          const maxAttempts = 5;
          while (attempts < maxAttempts) {
            try {
              return await query(args);
            } catch (error) {
              attempts++;
              if (attempts < maxAttempts && isTransientNetworkError(error)) {
                const backoffMs = Math.min(attempts * 2000, 6000);
                logger.warn(
                  `⚠️ [Database Retry] ${model}.${operation} failed transiently (${error.message?.slice(0, 80)}...). Retrying attempt ${attempts + 1}/${maxAttempts} in ${backoffMs}ms...`
                );
                await new Promise((resolve) => setTimeout(resolve, backoffMs));
                continue;
              }
              throw error;
            }
          }
        },
      },
    },
  });
}

export const prisma = globalForPrisma.prisma || createResilientPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

// Background keep-alive to keep Neon serverless compute awake during development
if (process.env.NODE_ENV !== 'test') {
  const keepAlive = setInterval(async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      // Ignore background keep-alive ping error
    }
  }, 2 * 60 * 1000); // 2 minutes (Neon suspends after 5m)
  if (keepAlive.unref) keepAlive.unref();
}

export default prisma;
