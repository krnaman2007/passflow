import jwt from 'jsonwebtoken';
import config from '../config/index.js';
import prisma from '../db/prisma.js';
import { AppError } from './errorHandler.js';

// High-Concurrency In-Memory User Auth Cache (TTL: 60s) to prevent PostgreSQL connection pool exhaustion
const userAuthCache = new Map();
const USER_CACHE_TTL_MS = 60 * 1000;

export const clearUserAuthCache = (userId) => {
  if (userId) userAuthCache.delete(userId);
  else userAuthCache.clear();
};

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

    // Ensure access token is used, not refresh token
    if (decoded.type && decoded.type !== 'access') {
      throw new AppError('Invalid token type: access token required', 401, 'INVALID_TOKEN');
    }

    let user;
    const cached = userAuthCache.get(userId);
    if (cached && Date.now() - cached.cachedAt < USER_CACHE_TTL_MS) {
      user = cached.user;
    } else {
      user = await prisma.user.findUnique({
        where: { id: userId },
        include: {
          organizer: true,
          buyerSeller: true,
          wallet: true,
        },
      });

      if (!user) {
        throw new AppError('User account not found', 401, 'USER_NOT_FOUND');
      }

      userAuthCache.set(userId, { user, cachedAt: Date.now() });
      if (userAuthCache.size > 5000) {
        const oldestKey = userAuthCache.keys().next().value;
        userAuthCache.delete(oldestKey);
      }
    }

    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
};

/**
 * Middleware to restrict access to users with an Organizer profile (or Admins).
 */
export const requireOrganizer = (req, res, next) => {
  if (!req.user) {
    return next(new AppError('Authentication required', 401, 'UNAUTHORIZED'));
  }

  // Admin bypass
  if (req.user.role === 'ADMIN') {
    return next();
  }

  if (!req.user.organizer) {
    return next(new AppError('Organizer profile required for this action', 403, 'FORBIDDEN'));
  }

  next();
};

/**
 * Middleware to restrict access to VERIFIED Organizers (or Admins).
 */
export const requireVerifiedOrganizer = (req, res, next) => {
  if (!req.user) {
    return next(new AppError('Authentication required', 401, 'UNAUTHORIZED'));
  }

  // Admin bypass
  if (req.user.role === 'ADMIN') {
    return next();
  }

  if (!req.user.organizer) {
    return next(new AppError('Organizer profile required for this action', 403, 'FORBIDDEN'));
  }

  if (req.user.organizer.verificationStatus !== 'VERIFIED') {
    return next(
      new AppError(
        'A verified organizer profile is required for this action',
        403,
        'ORGANIZER_NOT_VERIFIED'
      )
    );
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
