import prisma from './prisma.js';
import redis from './redis.js';
import logger from '../errorlogging/logger.js';

export const checkDatabaseConnections = async ({
  timeoutMs = 5000,
  throwOnError = false,
  prismaClient = prisma,
} = {}) => {
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('Database connectivity check timed out')), timeoutMs);
    if (timer.unref) timer.unref();
  });

  // Test PostgreSQL / Prisma via active query
  try {
    await Promise.race([
      prismaClient.$queryRaw`SELECT 1`,
      timeoutPromise,
    ]);
    logger.info('🐘 [Database] PostgreSQL (Prisma): Connected successfully');
    return true;
  } catch (err) {
    logger.warn('⚠️ [Database] PostgreSQL (Prisma): Disconnected (Check DATABASE_URL in .env)');
    if (throwOnError) {
      throw new Error(`Database connection check failed: ${err.message}`);
    }
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
};

export { prisma, default as prismaClient } from './prisma.js';
export { redis, default as redisClient } from './redis.js';
