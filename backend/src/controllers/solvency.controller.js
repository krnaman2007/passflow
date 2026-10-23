import { successResponse } from '../utils/response.js';
import solvencyService from '../services/solvency.service.js';

/**
 * GET /solvency/verify
 * Public: Verify platform solvency against liabilities.
 */
export const verifySolvency = async (req, res, next) => {
  try {
    const result = await solvencyService.verify();
    res.status(200).json(successResponse(result));
  } catch (err) {
    next(err);
  }
};

export default {
  verifySolvency,
};
