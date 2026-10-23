import { Router } from 'express';
import settlementController from '../controllers/settlement.controller.js';
import { authenticateUser } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { getEscrowParamsSchema } from '../schemas/settlement.schema.js';

const router = Router();

// Base protection: All escrow endpoints require an authenticated session
router.use(authenticateUser);

/**
 * @route   GET /escrows/:id (and /api/v1/escrows/:id)
 * @desc    Retrieve the persisted escrow or equivalent hold/reservation status
 * @access  Hold Owner or Admin
 */
router.get(
  '/:id',
  validate(getEscrowParamsSchema, 'params'),
  (req, res, next) => settlementController.getEscrow(req, res, next)
);

export default router;
