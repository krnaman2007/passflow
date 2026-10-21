import jwt from 'jsonwebtoken';
import config from '../config/index.js';
import prisma from '../db/prisma.js';
import { AppError } from './errorHandler.js';

/**
 * Middleware to authenticate requests using JWT Bearer token.
 * Populates req.user with the database user and their organizer profile.
 */
export const authenticateUser = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AppError('Authentication token is required', 401, 'UNAUTHORIZED');
    }

    const token = authHeader.split(' ')[1];
    let decoded;
    try {
      decoded = jwt.verify(token, config.jwtSecret);
    } catch (err) {
      throw new AppError('Invalid or expired authentication token', 401, 'INVALID_TOKEN');
    }

    const userId = decoded.userId || decoded.id;
    if (!userId) {
      throw new AppError('Token payload missing user identifier', 401, 'INVALID_TOKEN');
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { organizer: true },
    });

    if (!user) {
      throw new AppError('User account not found', 401, 'USER_NOT_FOUND');
    }

    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
};

/**
 * Middleware to restrict access to verified Organizers or Admins.
 */
export const requireOrganizer = (req, res, next) => {
  if (!req.user) {
    return next(new AppError('Authentication required', 401, 'UNAUTHORIZED'));
  }

  // Admin bypass
  if (req.user.role === 'ADMIN') {
    return next();
  }

  if (req.user.role !== 'ORGANIZER' || !req.user.organizer) {
    return next(new AppError('Organizer profile required for this action', 403, 'FORBIDDEN'));
  }

  next();
};

/**
 * Middleware to restrict access to Admins only.
 */
export const requireAdmin = (req, res, next) => {
  if (!req.user) {
    return next(new AppError('Authentication required', 401, 'UNAUTHORIZED'));
  }

  if (req.user.role !== 'ADMIN') {
    return next(new AppError('Administrator privileges required', 403, 'FORBIDDEN'));
  }

  next();
};
