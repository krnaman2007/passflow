import { Router } from 'express';
import * as authController from '../controllers/auth.controller.js';
import { validate } from '../middleware/validate.js';
import { authenticateUser } from '../middleware/auth.js';
import {
  registerUserSchema,
  loginUserSchema,
  refreshTokenSchema,
  logoutSchema,
} from '../schemas/auth.schema.js';

const router = Router();

/**
 * @route   POST /auth/register
 * @desc    Create user (+ wallet). Body: name, email, password, phone.
 * @access  Public
 */
router.post('/register', validate(registerUserSchema), authController.register);

/**
 * @route   POST /auth/login
 * @desc    Return access + refresh token.
 * @access  Public
 */
router.post('/login', validate(loginUserSchema), authController.login);

/**
 * @route   POST /auth/refresh
 * @desc    Issue new access token from refresh token.
 * @access  Public
 */
router.post('/refresh', validate(refreshTokenSchema), authController.refresh);

/**
 * @route   POST /auth/logout
 * @desc    Revoke refresh token.
 * @access  User (Authenticated)
 */
router.post('/logout', authenticateUser, validate(logoutSchema), authController.logout);

export default router;
