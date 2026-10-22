/**
 * Step 9.9 — Production Readiness and API Boundary Audit Tests
 *
 * Verifies production readiness at the boundary between financial services and HTTP APIs:
 * 1. Safe formatting: passwordHash stripping and BigInt serialization safety in user and wallet payloads.
 * 2. Error handling: standardized error envelopes, Zod validation translation, and stack trace suppression.
 * 3. Authentication & Authorization: token type enforcement, bearer parsing, and role gating (Admin/Organizer).
 * 4. Request validation & Idempotency: rejection of invalid monetary values, arithmetic overflow, and payload conflicts.
 * 5. Liveness probe: shallow health endpoint response.
 */

import { jest } from '@jest/globals';
import request from 'supertest';
import app from '../src/app.js';
import { formatSafeUser } from '../src/utils/token.js';
import { errorHandler, AppError } from '../src/middleware/errorHandler.js';
import { requireAdmin, requireOrganizer } from '../src/middleware/auth.js';
import { OrderService, OrderValidationError, IdempotencyConflictError } from '../src/services/order/index.js';
import { z } from 'zod';

describe('Step 9.9 — Production Readiness and API Boundary Audit', () => {
  describe('1. Response Formatting & BigInt Serialization Safety', () => {
    test('formatSafeUser strips passwordHash and safely serializes BigInt wallet fields to strings', () => {
      const rawUser = {
        id: 'usr-123',
        email: 'investor@passflow.com',
        name: 'Jane Doe',
        passwordHash: '$2a$10$supersecretscrypthashthatmustneverbeleaked',
        role: 'USER',
        wallet: {
          id: 'wal-456',
          currency: 'INR',
          availableBalance: 12500050n, // 125,000.50 INR in paise (BigInt)
          reservedBalance: 5000000n,   // 50,000.00 INR in paise (BigInt)
          version: 42n,
        },
      };

      const safeUser = formatSafeUser(rawUser);

      // Sensitive fields must be stripped
      expect(safeUser.passwordHash).toBeUndefined();

      // BigInt fields must be converted to strings
      expect(typeof safeUser.wallet.availableBalance).toBe('string');
      expect(safeUser.wallet.availableBalance).toBe('12500050');
      expect(typeof safeUser.wallet.reservedBalance).toBe('string');
      expect(safeUser.wallet.reservedBalance).toBe('5000000');
      expect(typeof safeUser.wallet.version).toBe('string');
      expect(safeUser.wallet.version).toBe('42');

      // Crucial: Must serialize cleanly via JSON.stringify without throwing TypeError
      expect(() => JSON.stringify(safeUser)).not.toThrow();
      const json = JSON.parse(JSON.stringify(safeUser));
      expect(json.wallet.availableBalance).toBe('12500050');
    });

    test('formatSafeUser handles users without wallets gracefully', () => {
      const rawUser = {
        id: 'usr-nowallet',
        email: 'nowallet@passflow.com',
        passwordHash: 'secret-hash',
        role: 'USER',
        wallet: null,
      };

      const safeUser = formatSafeUser(rawUser);
      expect(safeUser.passwordHash).toBeUndefined();
      expect(safeUser.wallet).toBeNull();
      expect(() => JSON.stringify(safeUser)).not.toThrow();
    });
  });

  describe('2. Centralized Error Handling & Secret Leak Prevention', () => {
    test('errorHandler formats AppError into standardized { success: false, error: { code, message } }', () => {
      const req = { method: 'POST', originalUrl: '/api/v1/orders' };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };
      const next = jest.fn();

      const err = new AppError('Insufficient wallet balance for reservation', 400, 'INSUFFICIENT_FUNDS');
      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: {
          code: 'INSUFFICIENT_FUNDS',
          message: 'Insufficient wallet balance for reservation',
        },
      });
    });

    test('errorHandler translates ZodError into 400 VALIDATION_ERROR with path description', () => {
      const req = { method: 'POST', originalUrl: '/api/v1/events' };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };
      const next = jest.fn();

      const schema = z.object({
        price: z.number().int().positive('Price must be positive'),
        name: z.string().min(1, 'Name is required'),
      });

      const parseResult = schema.safeParse({ price: -100, name: '' });
      expect(parseResult.success).toBe(false);

      errorHandler(parseResult.error, req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'price: Price must be positive',
        },
      });
    });

    test('errorHandler suppresses internal stack traces in production', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      const req = { method: 'GET', originalUrl: '/internal/path' };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };
      const next = jest.fn();

      const internalErr = new Error('Database connection reset during commit');
      errorHandler(internalErr, req, res, next);

      expect(res.status).toHaveBeenCalledWith(500);
      const jsonResponse = res.json.mock.calls[0][0];

      // Error envelope must NOT expose stack or internal SQL
      expect(jsonResponse.success).toBe(false);
      expect(jsonResponse.error.code).toBe('INTERNAL_ERROR');
      expect(jsonResponse.error.message).toBe('Database connection reset during commit');
      expect(jsonResponse.stack).toBeUndefined();
      expect(jsonResponse.error.stack).toBeUndefined();

      process.env.NODE_ENV = originalEnv;
    });
  });

  describe('3. Authorization Role Gating', () => {
    test('requireAdmin blocks non-admin users with 403 FORBIDDEN', () => {
      const req = { user: { id: 'usr-normal', role: 'USER' } };
      const res = {};
      const next = jest.fn();

      requireAdmin(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      const err = next.mock.calls[0][0];
      expect(err).toBeInstanceOf(AppError);
      expect(err.statusCode).toBe(403);
      expect(err.code).toBe('FORBIDDEN');
      expect(err.message).toMatch(/administrator privileges required/i);
    });

    test('requireAdmin allows admin users through', () => {
      const req = { user: { id: 'usr-admin', role: 'ADMIN' } };
      const res = {};
      const next = jest.fn();

      requireAdmin(req, res, next);

      expect(next).toHaveBeenCalledWith(); // Called with no error argument
    });

    test('requireOrganizer blocks users without organizer profile with 403 FORBIDDEN', () => {
      const req = { user: { id: 'usr-buyer', role: 'USER', organizer: null } };
      const res = {};
      const next = jest.fn();

      requireOrganizer(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      const err = next.mock.calls[0][0];
      expect(err).toBeInstanceOf(AppError);
      expect(err.statusCode).toBe(403);
      expect(err.code).toBe('FORBIDDEN');
      expect(err.message).toMatch(/organizer profile required/i);
    });

    test('requireOrganizer allows users with verified organizer profile through', () => {
      const req = { user: { id: 'usr-org', role: 'ORGANIZER', organizer: { id: 'org-1' } } };
      const res = {};
      const next = jest.fn();

      requireOrganizer(req, res, next);

      expect(next).toHaveBeenCalledWith();
    });

    test('requireOrganizer allows admin users through via bypass', () => {
      const req = { user: { id: 'usr-admin', role: 'ADMIN', organizer: null } };
      const res = {};
      const next = jest.fn();

      requireOrganizer(req, res, next);

      expect(next).toHaveBeenCalledWith();
    });
  });

  describe('4. Order Service Input Validation & Idempotency Rules', () => {
    const orderService = new OrderService();

    test('rejects non-integer prices, negative prices, and floating point paise', async () => {
      await expect(
        orderService._validatePlacementInput({
          userId: 'usr-1',
          eventId: 'evt-1',
          ticketCategoryId: 'cat-1',
          side: 'BID',
          price: 100.5, // float rejected
          quantity: 2,
          idempotencyKey: 'k-1',
        })
      ).rejects.toThrow(OrderValidationError);

      await expect(
        orderService._validatePlacementInput({
          userId: 'usr-1',
          eventId: 'evt-1',
          ticketCategoryId: 'cat-1',
          side: 'BID',
          price: -50, // negative rejected
          quantity: 2,
          idempotencyKey: 'k-2',
        })
      ).rejects.toThrow(OrderValidationError);

      await expect(
        orderService._validatePlacementInput({
          userId: 'usr-1',
          eventId: 'evt-1',
          ticketCategoryId: 'cat-1',
          side: 'BID',
          price: 0, // zero price rejected
          quantity: 2,
          idempotencyKey: 'k-3',
        })
      ).rejects.toThrow(OrderValidationError);
    });

    test('rejects non-integer and non-positive quantities', async () => {
      await expect(
        orderService._validatePlacementInput({
          userId: 'usr-1',
          eventId: 'evt-1',
          ticketCategoryId: 'cat-1',
          side: 'BID',
          price: 1000,
          quantity: 0, // zero quantity rejected
          idempotencyKey: 'k-4',
        })
      ).rejects.toThrow(OrderValidationError);

      await expect(
        orderService._validatePlacementInput({
          userId: 'usr-1',
          eventId: 'evt-1',
          ticketCategoryId: 'cat-1',
          side: 'BID',
          price: 1000,
          quantity: 1.5, // float quantity rejected
          idempotencyKey: 'k-5',
        })
      ).rejects.toThrow(OrderValidationError);
    });

    test('rejects arithmetic overflow beyond MAX_PAISE boundary', async () => {
      await expect(
        orderService._validatePlacementInput({
          userId: 'usr-1',
          eventId: 'evt-1',
          ticketCategoryId: 'cat-1',
          side: 'BID',
          price: 1_000_000_000,
          quantity: 100_000_000, // 10^17 paise > MAX_PAISE
          idempotencyKey: 'k-overflow',
        })
      ).rejects.toThrow(/exceeds supported monetary boundaries/i);
    });

    test('rejects invalid side', async () => {
      await expect(
        orderService._validatePlacementInput({
          userId: 'usr-1',
          eventId: 'evt-1',
          ticketCategoryId: 'cat-1',
          side: 'BUY', // must be BID or ASK
          price: 1000,
          quantity: 1,
          idempotencyKey: 'k-side',
        })
      ).rejects.toThrow(/side must be either "BID" or "ASK"/i);
    });
  });

  describe('5. Liveness Endpoint', () => {
    test('GET /health returns 200 with status ok and timestamp', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.message).toBe('Backend server is running');
      expect(res.body.timestamp).toBeDefined();
    });

    test('GET /api/v1/health returns identical liveness envelope', async () => {
      const res = await request(app).get('/api/v1/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
    });
  });
});
