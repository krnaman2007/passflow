// Redis Setup (Temporarily commented out - uncomment when Redis is available)
/*
import Redis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

export const redis = new Redis(REDIS_URL, {
  lazyConnect: true,
  maxRetriesPerRequest: 1,
  retryStrategy: (times) => {
    if (times > 3) {
      return null;
    }
    return Math.min(times * 100, 3000);
  },
});

redis.on('connect', () => {
  console.log(' Connected to Redis successfully');
});

redis.on('error', (err) => {
  console.warn('⚠️ Redis connection error:', err.message);
});
*/

export const redis = null;
export default redis;
