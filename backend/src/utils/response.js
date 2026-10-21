/**
 * Formats a successful API response envelope.
 * @param {any} data - The payload to return.
 * @returns {{ success: true, data: any }}
 */
export const successResponse = (data = null) => ({
  success: true,
  data,
});

/**
 * Formats a standardized error response envelope.
 * @param {string} code - Machine-readable error code (e.g. 'UNAUTHORIZED', 'NOT_FOUND').
 * @param {string} message - Human-readable explanation.
 * @returns {{ success: false, error: { code: string, message: string } }}
 */
export const errorResponse = (code, message) => ({
  success: false,
  error: {
    code,
    message,
  },
});
