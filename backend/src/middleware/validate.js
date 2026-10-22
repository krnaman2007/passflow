import { AppError } from './errorHandler.js';

/**
 * Generic request validation middleware using Zod schemas.
 * Validates req.body, req.query, or req.params based on schema configuration.
 *
 * @param {import('zod').ZodSchema} schema - Zod schema to validate against.
 * @param {'body' | 'query' | 'params'} source - Request property to validate (default: 'body').
 */
export const validate = (schema, source = 'body') => (req, res, next) => {
  try {
    const parsed = schema.safeParse(req[source]);
    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0];
      const field = firstIssue.path.length > 0 ? firstIssue.path.join('.') : source;
      return next(new AppError(`${field}: ${firstIssue.message}`, 400, 'VALIDATION_ERROR'));
    }
    // Replace with parsed/sanitized data (coerced types, trimmed strings, etc.)
    try {
      req[source] = parsed.data;
    } catch {
      // In Express 5, req.query is a getter-only property; attach to req.validatedQuery
      req[`validated${source.charAt(0).toUpperCase() + source.slice(1)}`] = parsed.data;
    }
    next();
  } catch (err) {
    next(err);
  }
};

export default validate;
