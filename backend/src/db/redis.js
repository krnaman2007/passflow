import Redis from 'ioredis';
import logger from '../errorlogging/logger.js';

let REDIS_URL = process.env.LOCAL_REDIS_URL || process.env.REDIS_URL;

// URL Sanitizer: handles cases where CLI commands were copied or TLS scheme was missing
if (REDIS_URL && typeof REDIS_URL === 'string') {
  REDIS_URL = REDIS_URL.trim();
  // Strip redis-cli flags if user copied the terminal command
  if (REDIS_URL.includes('redis-cli')) {
    const match = REDIS_URL.match(/redis[s]?:\/\/[^\s"']+/);
    if (match) REDIS_URL = match[0];
  }
  // Upstash requires rediss:// (TLS)
  if (REDIS_URL.includes('upstash.io') && REDIS_URL.startsWith('redis://')) {
    REDIS_URL = REDIS_URL.replace('redis://', 'rediss://');
  }
}

let redisClient = null;

if (REDIS_URL && (REDIS_URL.startsWith('redis://') || REDIS_URL.startsWith('rediss://'))) {
  try {
    redisClient = new Redis(REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 2,
      enableReadyCheck: true,
      retryStrategy: (times) => {
        if (times > 5) return null; // Stop retrying if Upstash is unreachable
        return Math.min(times * 150, 3000);
      },
    });

    redisClient.on('connect', () => {
      logger.info('🟥 [Redis] Connected to Upstash Redis successfully');
    });

    redisClient.on('ready', () => {
      logger.info('🟥 [Redis] Client ready for commands');
    });

    redisClient.on('error', (err) => {
      logger.warn(`⚠️ [Redis] Connection notice: ${err.message}`);
    });

    // In development/production, initiate background connection
    if (process.env.NODE_ENV !== 'test') {
      redisClient.connect().catch((err) => {
        logger.warn(`⚠️ [Redis] Background connect notice: ${err.message}`);
      });
    }
  } catch (err) {
    logger.warn(`⚠️ [Redis] Initialization failed: ${err.message}`);
    redisClient = null;
  }
}

export const redis = redisClient;
export default redis;
