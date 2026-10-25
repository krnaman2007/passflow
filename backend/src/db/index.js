import prisma from './prisma.js';
import redis from './redis.js';
import logger from '../errorlogging/logger.js';

export const checkDatabaseConnections = async ({
  retries = 3,
  retryDelayMs = 2000,
  throwOnError = false,
  prismaClient = prisma,
} = {}) => {
  let lastError = null;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await prismaClient.$queryRaw`SELECT 1`;
      logger.info('🐘 [Database] PostgreSQL (Prisma): Connected successfully');

      if (redis && process.env.NODE_ENV !== 'test') {
        try {
          if (redis.status === 'wait') {
            await redis.connect();
          }
          await redis.ping();
          logger.info('🟥 [Database] Redis (Upstash): Connected successfully');
        } catch (rErr) {
          logger.warn(`⚠️ [Database] Redis connection notice: ${rErr.message}`);
        }
      }

      return true;
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        logger.warn(
          `⚠️ [Database] Connection attempt ${attempt}/${retries} failed (${err.message}). Retrying in ${retryDelayMs}ms...`
        );
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      }
    }
  }

  logger.warn('⚠️ [Database] PostgreSQL (Prisma): Disconnected (Check DATABASE_URL in .env)');
  if (throwOnError) {
    throw new Error(`Database connection check failed: ${lastError?.message || 'Unknown error'}`);
  }
  return false;
};

export { prisma, default as prismaClient } from './prisma.js';
export { redis, default as redisClient } from './redis.js';
