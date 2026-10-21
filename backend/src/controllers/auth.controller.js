import { randomUUID } from 'crypto';
import bcrypt from 'bcryptjs';
import prisma from '../db/prisma.js';
import config from '../config/index.js';
import { AppError } from '../middleware/errorHandler.js';
import { successResponse } from '../utils/response.js';
import {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
  formatSafeUser,
  parseDurationToMs,
} from '../utils/token.js';

/**
 * POST /auth/register
 * Public: Register a new user, auto-create wallet (+ buyerSeller profile), and issue tokens.
 */
export const register = async (req, res, next) => {
  try {
    const { name, email, password, phone, role } = req.body;
    const normalizedEmail = email.toLowerCase().trim();

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (existingUser) {
      throw new AppError('An account with this email already exists', 409, 'EMAIL_EXISTS');
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);
    const assignedRole = role || 'USER';
    const walletId = randomUUID();

    // Atomic nested creation of User + 1:1 Wallet + BuyerSeller profile
    const newUser = await prisma.user.create({
      data: {
        name: name ? name.trim() : null,
        email: normalizedEmail,
        passwordHash,
        phone: phone ? phone.trim() : null,
        role: assignedRole,
        walletId,
        wallet: {
          create: {
            id: walletId,
            currency: 'INR',
            availableBalance: 0n,
            reservedBalance: 0n,
          },
        },
        buyerSeller: {
          create: {
            kycStatus: 'PENDING',
            isActive: true,
          },
        },
        ...(assignedRole === 'ORGANIZER' && {
          organizer: {
            create: {
              organizationName: name ? `${name.trim()}'s Organization` : 'My Organization',
              verificationStatus: 'PENDING',
            },
          },
        }),
      },
      include: {
        wallet: true,
        buyerSeller: true,
        organizer: true,
      },
    });

    // Generate tokens
    const accessToken = generateAccessToken(newUser);
    const refreshToken = generateRefreshToken(newUser);

    // Persist refresh token in database
    const refreshExpiryMs = parseDurationToMs(config.jwtRefreshExpiry);
    await prisma.refreshToken.create({
      data: {
        token: refreshToken,
        userId: newUser.id,
        expiresAt: new Date(Date.now() + refreshExpiryMs),
      },
    });

    res.status(201).json(
      successResponse({
        user: formatSafeUser(newUser),
        tokens: {
          accessToken,
          refreshToken,
          tokenType: 'Bearer',
          expiresIn: config.jwtAccessExpiry,
        },
      })
    );
  } catch (err) {
    next(err);
  }
};

/**
 * POST /auth/login
 * Public: Validate credentials and return access + refresh tokens.
 */
export const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const normalizedEmail = email.toLowerCase().trim();

    // Fetch user with relations
    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      include: {
        wallet: true,
        organizer: true,
        buyerSeller: true,
      },
    });

    if (!user) {
      throw new AppError('Invalid email or password', 401, 'INVALID_CREDENTIALS');
    }

    // Verify password hash
    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      throw new AppError('Invalid email or password', 401, 'INVALID_CREDENTIALS');
    }

    // Generate tokens
    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    // Persist refresh token in DB
    const refreshExpiryMs = parseDurationToMs(config.jwtRefreshExpiry);
    await prisma.refreshToken.create({
      data: {
        token: refreshToken,
        userId: user.id,
        expiresAt: new Date(Date.now() + refreshExpiryMs),
      },
    });

    res.status(200).json(
      successResponse({
        user: formatSafeUser(user),
        tokens: {
          accessToken,
          refreshToken,
          tokenType: 'Bearer',
          expiresIn: config.jwtAccessExpiry,
        },
      })
    );
  } catch (err) {
    next(err);
  }
};

/**
 * POST /auth/refresh
 * Public: Issue a new access token from a valid, unrevoked refresh token.
 */
export const refresh = async (req, res, next) => {
  try {
    const refreshToken = req.body.refreshToken || req.headers['x-refresh-token'];
    if (!refreshToken) {
      throw new AppError('Refresh token is required', 400, 'REFRESH_TOKEN_REQUIRED');
    }

    // Verify JWT cryptographic signature
    let decoded;
    try {
      decoded = verifyRefreshToken(refreshToken);
    } catch (err) {
      throw new AppError('Invalid or expired refresh token', 401, 'INVALID_REFRESH_TOKEN');
    }

    if (!decoded.userId || decoded.type !== 'refresh') {
      throw new AppError('Invalid refresh token payload', 401, 'INVALID_REFRESH_TOKEN');
    }

    // Check DB for token validity and revocation status
    const storedToken = await prisma.refreshToken.findUnique({
      where: { token: refreshToken },
      include: { user: true },
    });

    if (!storedToken || storedToken.revoked || storedToken.expiresAt < new Date()) {
      throw new AppError('Refresh token has expired or been revoked', 401, 'INVALID_REFRESH_TOKEN');
    }

    const user = storedToken.user;
    if (!user) {
      throw new AppError('User not found', 401, 'USER_NOT_FOUND');
    }

    // Issue new access token
    const newAccessToken = generateAccessToken(user);

    res.status(200).json(
      successResponse({
        accessToken: newAccessToken,
        refreshToken,
        tokenType: 'Bearer',
        expiresIn: config.jwtAccessExpiry,
      })
    );
  } catch (err) {
    next(err);
  }
};

/**
 * POST /auth/logout
 * User: Revoke active refresh token(s) for the authenticated user.
 */
export const logout = async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    const userId = req.user.id;

    if (refreshToken) {
      // Revoke specific refresh token
      await prisma.refreshToken.updateMany({
        where: {
          token: refreshToken,
          userId,
        },
        data: {
          revoked: true,
        },
      });
    } else {
      // If no specific token supplied, revoke all active refresh tokens for this user
      await prisma.refreshToken.updateMany({
        where: {
          userId,
          revoked: false,
        },
        data: {
          revoked: true,
        },
      });
    }

    res.status(200).json(
      successResponse({
        message: 'Logged out successfully; refresh token revoked',
      })
    );
  } catch (err) {
    next(err);
  }
};

export default {
  register,
  login,
  refresh,
  logout,
};
