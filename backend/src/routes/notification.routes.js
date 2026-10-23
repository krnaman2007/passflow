import { Router } from 'express';
import { authenticateUser } from '../middleware/auth.js';
import * as notificationController from '../controllers/notification.controller.js';

const router = Router();

// All notification endpoints require authenticated user
router.use(authenticateUser);

/**
 * @route   GET /notifications
 * @desc    Get user's notifications list
 * @access  Private (User)
 */
router.get('/', notificationController.getNotifications);

/**
 * @route   PATCH /notifications/:id/read
 * @desc    Mark notification as read
 * @access  Private (User)
 */
router.patch('/:id/read', notificationController.markAsRead);

export default router;
