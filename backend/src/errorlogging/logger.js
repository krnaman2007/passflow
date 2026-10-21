/**
 * Centralized Error & Event Logger
 * Useful in development and production for tracking errors, requests, and exceptions.
 */

export const logger = {
  info: (message, meta = {}) => {
    console.log(`ℹ️ [INFO] [${new Date().toISOString()}]: ${message}`, Object.keys(meta).length ? meta : '');
  },
  warn: (message, meta = {}) => {
    console.warn(`⚠️ [WARN] [${new Date().toISOString()}]: ${message}`, Object.keys(meta).length ? meta : '');
  },
  error: (message, error = null) => {
    console.error(`❌ [ERROR] [${new Date().toISOString()}]: ${message}`);
    if (error && error.stack) {
      console.error(error.stack);
    } else if (error) {
      console.error(error);
    }
  },
};

export default logger;
