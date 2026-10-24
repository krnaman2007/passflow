import { config } from './index.js';

/**
 * Checks if the request origin is permitted.
 * Supports:
 * - Direct match with configured frontend URL(s) (comma-separated support)
 * - Localhost and 127.0.0.1 on any port in development/test
 * - Server-to-server or requests without origin headers
 */
export const isOriginAllowed = (origin) => {
  if (!origin) return true;

  const configured = Array.isArray(config.allowedOrigins)
    ? config.allowedOrigins
    : [config.frontendUrl];

  if (configured.includes(origin)) {
    return true;
  }

  // In development and test modes, permit any localhost or 127.0.0.1 port (e.g. 5173, 5174, etc.)
  if (config.nodeEnv === 'development' || !config.nodeEnv || config.nodeEnv === 'test') {
    if (/^https?:\/\/(localhost|127\.0\.0\.1)(:[0-9]+)?$/.test(origin)) {
      return true;
    }
  }

  return false;
};

export const corsOptions = {
  origin: (origin, callback) => {
    if (isOriginAllowed(origin)) {
      callback(null, true);
    } else {
      callback(null, false);
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    'Idempotency-Key',
    'idempotency-key',
    'X-Idempotency-Key',
    'x-idempotency-key',
    'Accept'
  ],
};

export default corsOptions;
