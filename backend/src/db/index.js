import prisma from './prisma.js';
import redis from './redis.js';
import logger from '../errorlogging/logger.js';

export const checkDatabaseConnections = async () => {
  // Test PostgreSQL / Prisma
  try {
    await prisma.$connect();
    logger.info('🐘 [Database] PostgreSQL (Prisma): Connected successfully');
  } catch (err) {
    logger.warn('⚠️ [Database] PostgreSQL (Prisma): Disconnected (Check DATABASE_URL in .env)');
  }

  // Redis test (Commented out until Redis is configured)
  /*
  if (redis) {
    try {
      const pong = await redis.ping();
      if (pong === 'PONG') {
        logger.info('⚡ [Cache] Redis: Connected successfully');
      }
    } catch (err) {
      logger.warn('⚠️ [Cache] Redis: Not connected (continuing without cache)');
    }
  }
  */
};

export { prisma, default as prismaClient } from './prisma.js';
export { redis, default as redisClient } from './redis.js';
