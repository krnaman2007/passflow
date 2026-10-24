import dotenv from 'dotenv';

dotenv.config();

const parseAllowedOrigins = (raw) => {
  if (!raw) return ['http://localhost:5173', 'http://localhost:5174'];
  return raw
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
};

export const config = {
  port: process.env.PORT || 5001,
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
  allowedOrigins: parseAllowedOrigins(process.env.FRONTEND_URL),
  databaseUrl: process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/passflow?schema=public',
  dbConnectTimeoutMs: Number(process.env.DB_CONNECT_TIMEOUT_MS) || 15000,
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  jwtSecret: process.env.JWT_SECRET || 'dev_jwt_secret_key',
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || (process.env.JWT_SECRET ? `${process.env.JWT_SECRET}_refresh` : 'dev_jwt_refresh_secret_key'),
  jwtAccessExpiry: process.env.JWT_ACCESS_EXPIRY || '15m',
  jwtRefreshExpiry: process.env.JWT_REFRESH_EXPIRY || '7d',
  nodeEnv: process.env.NODE_ENV || 'development',
  enableDistributedMarketLeases: process.env.ENABLE_DISTRIBUTED_MARKET_LEASES === 'true' || process.env.REQUIRE_MARKET_LEASE === 'true',
};

export default config;
