import { Router } from 'express';
import * as solvencyController from '../controllers/solvency.controller.js';

const router = Router();

/**
 * @route   GET /solvency/verify
 * @desc    Public verification of platform solvency.
 * @access  Public
 */
router.get('/verify', solvencyController.verifySolvency);

export default router;
