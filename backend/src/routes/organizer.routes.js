import { Router } from 'express';
import * as organizerController from '../controllers/organizer.controller.js';
import { authenticateUser, requireOrganizer } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { applyOrganizerSchema } from '../schemas/organizer.schema.js';

const router = Router();

// Base protection: All organizer endpoints require user authentication
router.use(authenticateUser);

/**
 * @route   POST /organizers/apply
 * @desc    Request organizer role (creates Organizer, status PENDING).
 * @access  User
 */
router.post('/apply', validate(applyOrganizerSchema), organizerController.apply);

/**
 * @route   GET /organizers/me
 * @desc    Organizer profile and verification status.
 * @access  Organizer
 */
router.get('/me', requireOrganizer, organizerController.getProfile);

/**
 * @route   GET /organizers/me/events
 * @desc    Events created by organizer.
 * @access  Organizer
 */
router.get('/me/events', requireOrganizer, organizerController.getOrganizerEvents);

export default router;
