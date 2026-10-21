import { Router } from 'express';
import * as userController from '../controllers/user.controller.js';
import { authenticateUser } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { updateProfileSchema, changePasswordSchema } from '../schemas/user.schema.js';
import { submitKycSchema } from '../schemas/buyer-seller.schema.js';

const router = Router();

// All user management routes require authenticated session
router.use(authenticateUser);

/**
 * @route   GET /users/me
 * @desc    Current profile with role and wallet summary.
 * @access  User
 */
router.get('/me', userController.getProfile);

/**
 * @route   PUT /users/me
 * @desc    Update profile (name, phone, profile).
 * @access  User
 */
router.put('/me', validate(updateProfileSchema), userController.updateProfile);

/**
 * @route   PUT /users/me/password
 * @desc    Change password.
 * @access  User
 */
router.put('/me/password', validate(changePasswordSchema), userController.changePassword);

/**
 * @route   POST /users/me/kyc
 * @desc    Submit KYC details; sets kycStatus.
 * @access  User
 */
router.post('/me/kyc', validate(submitKycSchema), userController.submitKyc);

export default router;
