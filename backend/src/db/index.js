import prisma from './prisma.js';
import redis from './redis.js';
import logger from '../errorlogging/logger.js';

export const checkDatabaseConnections = async ({
  timeoutMs = Number(process.env.DB_CONNECT_TIMEOUT_MS) || 15000,
  retries = 1,
  retryDelayMs = 1500,
  throwOnError = false,
  prismaClient = prisma,
} = {}) => {
  let lastError = null;

  for (let attempt = 1; attempt <= retries; attempt++) {
    let timer;
    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Database connectivity check timed out')), timeoutMs);
      if (timer.unref) timer.unref();
    });

    try {
      await Promise.race([
        prismaClient.$queryRaw`SELECT 1`,
        timeoutPromise,
      ]);
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
    } finally {
      if (timer) clearTimeout(timer);
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
