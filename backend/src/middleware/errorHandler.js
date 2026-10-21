import logger from '../errorlogging/logger.js';
import { errorResponse } from '../utils/response.js';

/**
 * Custom application operational error with HTTP status code and error code.
 */
export class AppError extends Error {
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

/**
 * Centralized Express error-handling middleware.
 */
export const errorHandler = (err, req, res, next) => {
  let statusCode = err.statusCode || 500;
  let code = err.code || 'INTERNAL_ERROR';
  let message = err.message || 'An unexpected error occurred';

  // Handle Zod validation errors
  if (err.name === 'ZodError' && err.issues && err.issues.length > 0) {
    statusCode = 400;
    code = 'VALIDATION_ERROR';
    const firstIssue = err.issues[0];
    const path = firstIssue.path.length > 0 ? firstIssue.path.join('.') : 'field';
    message = `${path}: ${firstIssue.message}`;
  }

  // Log unexpected server errors (500) with diagnostic info, without leaking secrets
  if (statusCode >= 500) {
    logger.error(`[${req.method} ${req.originalUrl}] Server Error: ${message}`, {
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    });
  } else {
    logger.warn(`[${req.method} ${req.originalUrl}] Request Error: ${code} - ${message}`);
  }

  res.status(statusCode).json(errorResponse(code, message));
};

export default errorHandler;
