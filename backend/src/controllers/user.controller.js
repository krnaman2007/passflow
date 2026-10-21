import bcrypt from 'bcryptjs';
import prisma from '../db/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { successResponse } from '../utils/response.js';
import { formatSafeUser } from '../utils/token.js';

/**
 * GET /users/me
 * User: Retrieve current user profile with role, wallet summary, and sub-profiles.
 */
export const getProfile = async (req, res, next) => {
  try {
    const userId = req.user.id;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        wallet: true,
        buyerSeller: true,
        organizer: true,
      },
    });

    if (!user) {
      throw new AppError('User profile not found', 404, 'USER_NOT_FOUND');
    }

    res.status(200).json(successResponse(formatSafeUser(user)));
  } catch (err) {
    next(err);
  }
};

/**
 * PUT /users/me
 * User: Update profile fields (name, phone, profile).
 */
export const updateProfile = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { name, phone, profile } = req.body;

    const updateData = {};
    if (name !== undefined) updateData.name = name ? name.trim() : null;
    if (phone !== undefined) updateData.phone = phone ? phone.trim() : null;
    if (profile !== undefined) updateData.profile = profile ? profile.trim() : null;

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: updateData,
      include: {
        wallet: true,
        buyerSeller: true,
        organizer: true,
      },
    });

    res.status(200).json(successResponse(formatSafeUser(updatedUser)));
  } catch (err) {
    next(err);
  }
};

/**
 * PUT /users/me/password
 * User: Change password after verifying old password.
 */
export const changePassword = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { oldPassword, newPassword } = req.body;

    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new AppError('User account not found', 404, 'USER_NOT_FOUND');
    }

    // Verify existing password
    const isOldPasswordValid = await bcrypt.compare(oldPassword, user.passwordHash);
    if (!isOldPasswordValid) {
      throw new AppError('Current password does not match', 400, 'INVALID_PASSWORD');
    }

    // Hash new password
    const newPasswordHash = await bcrypt.hash(newPassword, 10);

    // Update password hash and revoke active refresh tokens to enforce re-login across sessions
    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash: newPasswordHash },
    });

    await prisma.refreshToken.updateMany({
      where: { userId, revoked: false },
      data: { revoked: true },
    });

    res.status(200).json(
      successResponse({
        message: 'Password changed successfully. Please log in again with your new credentials.',
      })
    );
  } catch (err) {
    next(err);
  }
};

/**
 * POST /users/me/kyc
 * User: Submit KYC details; updates / sets kycStatus to PENDING.
 */
export const submitKyc = async (req, res, next) => {
  try {
    const userId = req.user.id;

    // Upsert BuyerSeller profile with status PENDING
    const buyerSeller = await prisma.buyerSeller.upsert({
      where: { userId },
      create: {
        userId,
        kycStatus: 'PENDING',
        isActive: true,
      },
      update: {
        kycStatus: 'PENDING',
      },
    });

    res.status(200).json(
      successResponse({
        message: 'KYC details submitted successfully; status set to PENDING verification',
        buyerSeller,
      })
    );
  } catch (err) {
    next(err);
  }
};

export default {
  getProfile,
  updateProfile,
  changePassword,
  submitKyc,
};
