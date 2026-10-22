import { Router } from 'express';
import * as adminController from '../controllers/admin.controller.js';
import { authenticateUser, requireAdmin } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import {
  adminManageUserSchema,
  adminVerifyOrganizerSchema,
  adminGetUsersQuerySchema,
  adminGetEventsQuerySchema,
  adminManageEventSchema,
} from '../schemas/admin.schema.js';

const router = Router();

// All admin routes require an authenticated user with ADMIN role
router.use(authenticateUser);
router.use(requireAdmin);

/**
 * @route   GET /admin/users
 * @desc    List / search users.
 * @access  Admin
 */
router.get('/users', validate(adminGetUsersQuerySchema, 'query'), adminController.getUsers);

/**
 * @route   PATCH /admin/users/:id
 * @desc    Suspend / activate / change role / approve KYC.
 * @access  Admin
 */
router.patch('/users/:id', validate(adminManageUserSchema), adminController.manageUser);

/**
 * @route   PATCH /admin/organizers/:id/verify
 * @desc    Verify or reject organizer.
 * @access  Admin
 */
router.patch('/organizers/:id/verify', validate(adminVerifyOrganizerSchema), adminController.verifyOrganizer);

/**
 * @route   GET /admin/events
 * @desc    All events including drafts.
 * @access  Admin
 */
router.get('/events', validate(adminGetEventsQuerySchema, 'query'), adminController.getEvents);

/**
 * @route   PATCH /admin/events/:id
 * @desc    Approve / cancel event.
 * @access  Admin
 */
router.patch('/events/:id', validate(adminManageEventSchema), adminController.manageEvent);

export default router;
