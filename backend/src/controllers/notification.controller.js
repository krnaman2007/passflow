import notificationService from '../services/notification.service.js';

/**
 * GET /notifications
 * Retrieve paginated notifications list for authenticated user.
 */
export const getNotifications = async (req, res, next) => {
  try {
    const result = await notificationService.getNotifications(req.user.id, req.query);
    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * PATCH /notifications/:id/read
 * Mark a specific notification as read.
 */
export const markAsRead = async (req, res, next) => {
  try {
    const { id } = req.params;
    const notification = await notificationService.markAsRead(req.user.id, id);
    res.status(200).json({
      success: true,
      message: 'Notification marked as read',
      data: notification,
    });
  } catch (err) {
    next(err);
  }
};

export default {
  getNotifications,
  markAsRead,
};
