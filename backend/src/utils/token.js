import jwt from 'jsonwebtoken';
import config from '../config/index.js';

/**
 * Parses duration strings like '15m', '7d', '24h' into milliseconds.
 * Defaults to 7 days if unparseable.
 */
export const parseDurationToMs = (durationStr = '7d') => {
  const match = /^(\d+)([smhd])$/.exec(durationStr);
  if (!match) return 7 * 24 * 60 * 60 * 1000;
  const val = parseInt(match[1], 10);
  const unit = match[2];
  switch (unit) {
    case 's': return val * 1000;
    case 'm': return val * 60 * 1000;
    case 'h': return val * 60 * 60 * 1000;
    case 'd': return val * 24 * 60 * 60 * 1000;
    default: return 7 * 24 * 60 * 60 * 1000;
  }
};

/**
 * Generates an Access Token for a user.
 * @param {object} user - User object with id and role.
 * @returns {string} Signed JWT.
 */
export const generateAccessToken = (user) => {
  return jwt.sign(
    {
      userId: user.id,
      role: user.role,
      type: 'access',
    },
    config.jwtSecret,
    { expiresIn: config.jwtAccessExpiry }
  );
};

/**
 * Generates a Refresh Token for a user.
 * @param {object} user - User object with id.
 * @returns {string} Signed JWT.
 */
export const generateRefreshToken = (user) => {
  return jwt.sign(
    {
      userId: user.id,
      type: 'refresh',
    },
    config.jwtRefreshSecret,
    { expiresIn: config.jwtRefreshExpiry }
  );
};

/**
 * Verifies an Access Token.
 * @param {string} token
 * @returns {object} Decoded payload
 */
export const verifyAccessToken = (token) => {
  return jwt.verify(token, config.jwtSecret);
};

/**
 * Verifies a Refresh Token.
 * @param {string} token
 * @returns {object} Decoded payload
 */
export const verifyRefreshToken = (token) => {
  return jwt.verify(token, config.jwtRefreshSecret);
};

/**
 * Formats a user model safely for public/authenticated responses
 * by omitting sensitive hashes and converting BigInt fields.
 * @param {object} user
 * @returns {object}
 */
export const formatSafeUser = (user) => {
  if (!user) return null;

  const { passwordHash, ...safeUser } = user;

  if (safeUser.wallet) {
    safeUser.wallet = {
      ...safeUser.wallet,
      availableBalance: safeUser.wallet.availableBalance !== undefined ? safeUser.wallet.availableBalance.toString() : '0',
      reservedBalance: safeUser.wallet.reservedBalance !== undefined ? safeUser.wallet.reservedBalance.toString() : '0',
      version: safeUser.wallet.version !== undefined ? safeUser.wallet.version.toString() : '0',
    };
  }

  return safeUser;
};
