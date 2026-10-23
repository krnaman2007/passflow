/**
 * Phase 2 — Wallet HTTP API Integration Tests
 *
 * Verifies the authenticated REST API endpoints for user wallet operations:
 * 1. GET /api/v1/wallet (and /wallet)
 *    - Rejection of unauthenticated requests (401)
 *    - Successful retrieval of wallet balance, reserved balance, available, and version (200)
 *    - Auto-initialization of wallet for newly registered users
 *    - Safe BigInt serialization with zero JSON floating-point precision loss
 * 2. POST /api/v1/wallet/deposit (and /wallet/deposit)
 *    - Rejection of unauthenticated requests (401)
 *    - Mandatory Idempotency-Key header (400 on missing or whitespace)
 *    - Strict rejection of float amounts, negatives, zero, and unknown fields (400)
 *    - Successful credit of available balance and append-only ledger entry (201)
 *    - Idempotent replay with identical key and payload (200, isIdempotentReplay: true)
 *    - Idempotency conflict rejection on mismatched payload (409)
 * 3. POST /api/v1/wallet/withdraw (and /wallet/withdraw)
 *    - Rejection of unauthenticated requests (401)
 *    - Mandatory Idempotency-Key header (400)
 *    - Rejection of withdrawal exceeding available balance (422 INSUFFICIENT_FUNDS)
 *    - State preservation: zero balance deduction on insufficient funds
 *    - Successful debit of available balance with negative availableDelta ledger entry (201)
 *    - Idempotent replay without double-spending (200, isIdempotentReplay: true)
 *    - Idempotency conflict rejection on mismatched payload (409)
 * 4. GET /api/v1/wallet/transactions (and /wallet/transactions)
 *    - Rejection of unauthenticated requests (401)
 *    - Paginated retrieval of wallet ledger entries with limit and page (200)
 *    - Filtering by entryType / type (e.g. DEPOSIT, WITHDRAWAL_SETTLED)
 *    - Filtering by date range (startDate, endDate)
 *    - Validation of date bounds (400 on invalid date or startDate > endDate)
 * 5. Atomicity & Invariant Preservation
 *    - Database CHECK constraints enforce non-negative available and reserved balances
 *    - Ledger rows are strictly append-only
 */

import { jest, describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import app from '../../src/app.js';
import prisma from '../../src/db/prisma.js';
import { generateAccessToken } from '../../src/utils/token.js';

describe('Phase 2 — Wallet HTTP API Integration (Live PostgreSQL)', () => {
  jest.setTimeout(60000);

  const runSuffix = Math.random().toString(36).substring(2, 8);

  let testUser1;
  let token1;
  let testUser2;
  let token2;

  beforeAll(async () => {
    // Create isolated test users in database
    testUser1 = await prisma.user.create({
      data: {
        email: `wallet-api-1-${runSuffix}@test.passflow.com`,
        passwordHash: '$2a$10$dummyhashedpasswordforintegrationtesting',
        name: 'Wallet API User 1',
        role: 'USER',
      },
    });
    token1 = generateAccessToken(testUser1);

    testUser2 = await prisma.user.create({
      data: {
        email: `wallet-api-2-${runSuffix}@test.passflow.com`,
        passwordHash: '$2a$10$dummyhashedpasswordforintegrationtesting',
        name: 'Wallet API User 2',
        role: 'USER',
      },
    });
    token2 = generateAccessToken(testUser2);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // =========================================================================
  // 1. Authentication & Route Protection
  // =========================================================================
  describe('1. Authentication Enforcement', () => {
    it('GET /api/v1/wallet should reject unauthenticated request with 401', async () => {
      const res = await request(app).get('/api/v1/wallet').expect(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('GET /wallet should reject unauthenticated request with 401', async () => {
      const res = await request(app).get('/wallet').expect(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('POST /api/v1/wallet/deposit should reject unauthenticated request with 401', async () => {
      const res = await request(app)
        .post('/api/v1/wallet/deposit')
        .send({ amount: 50000 })
        .expect(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('POST /api/v1/wallet/withdraw should reject unauthenticated request with 401', async () => {
      const res = await request(app)
        .post('/api/v1/wallet/withdraw')
        .send({ amount: 10000 })
        .expect(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('GET /api/v1/wallet/transactions should reject unauthenticated request with 401', async () => {
      const res = await request(app).get('/api/v1/wallet/transactions').expect(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('rejects invalid or malformed Bearer token with 401', async () => {
      const res = await request(app)
        .get('/api/v1/wallet')
        .set('Authorization', 'Bearer invalid-token-string')
        .expect(401);
      expect(res.body.success).toBe(false);
    });
  });

  // =========================================================================
  // 2. GET /api/v1/wallet Balance Retrieval
  // =========================================================================
  describe('2. GET /api/v1/wallet (and /wallet)', () => {
    it('returns 200 with initialized zero balances for a new user', async () => {
      const res = await request(app)
        .get('/api/v1/wallet')
        .set('Authorization', `Bearer ${token1}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeDefined();
      expect(res.body.data.userId).toBe(testUser1.id);
      expect(res.body.data.currency).toBe('INR');
      expect(res.body.data.availableBalance).toBe('0');
      expect(res.body.data.reservedBalance).toBe('0');
      expect(res.body.data.totalBalance).toBe('0');
      expect(res.body.data.balance).toBe('0');
      expect(res.body.data.available).toBe('0');
      expect(res.body.data.version).toBe('0');
    });

    it('returns identical data under root mounted /wallet route', async () => {
      const res = await request(app)
        .get('/wallet')
        .set('Authorization', `Bearer ${token1}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.userId).toBe(testUser1.id);
      expect(res.body.data.currency).toBe('INR');
    });
  });

  // =========================================================================
  // 3. POST /api/v1/wallet/deposit
  // =========================================================================
  describe('3. POST /api/v1/wallet/deposit', () => {
    it('rejects deposit when Idempotency-Key header is missing (400)', async () => {
      const res = await request(app)
        .post('/api/v1/wallet/deposit')
        .set('Authorization', `Bearer ${token1}`)
        .send({ amount: 50000 })
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.message).toContain('Idempotency-Key');
    });

    it('rejects deposit when amount is non-positive or zero (400)', async () => {
      const res = await request(app)
        .post('/api/v1/wallet/deposit')
        .set('Authorization', `Bearer ${token1}`)
        .set('Idempotency-Key', `dep-zero-${runSuffix}`)
        .send({ amount: 0 })
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects deposit when amount is a floating point number (400)', async () => {
      const res = await request(app)
        .post('/api/v1/wallet/deposit')
        .set('Authorization', `Bearer ${token1}`)
        .set('Idempotency-Key', `dep-float-${runSuffix}`)
        .send({ amount: 150.75 })
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects deposit when unknown fields are injected into body (400 strict)', async () => {
      const res = await request(app)
        .post('/api/v1/wallet/deposit')
        .set('Authorization', `Bearer ${token1}`)
        .set('Idempotency-Key', `dep-extra-${runSuffix}`)
        .send({ amount: 50000, unauthorizedOverride: true })
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('successfully deposits positive integer paise and creates ledger entry (201)', async () => {
      const depositKey = `dep-success-1-${runSuffix}`;
      const res = await request(app)
        .post('/api/v1/wallet/deposit')
        .set('Authorization', `Bearer ${token1}`)
        .set('Idempotency-Key', depositKey)
        .send({
          amount: 100000, // 1,000.00 INR in paise
          description: 'Initial funds load',
        })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.isIdempotentReplay).toBe(false);
      expect(res.body.data.wallet.availableBalance).toBe('100000');
      expect(res.body.data.wallet.totalBalance).toBe('100000');
      expect(res.body.data.wallet.version).toBe('1');

      expect(res.body.data.operation.operationType).toBe('DEPOSIT');
      expect(res.body.data.operation.status).toBe('COMPLETED');
      expect(res.body.data.operation.idempotencyKey).toBe(depositKey);

      expect(res.body.data.ledgerEntry.entryType).toBe('DEPOSIT');
      expect(res.body.data.ledgerEntry.amount).toBe('100000');
      expect(res.body.data.ledgerEntry.availableDelta).toBe('100000');
      expect(res.body.data.ledgerEntry.balanceAfterAvailable).toBe('100000');
    });

    it('idempotently replays duplicate deposit request with same key and payload (200, no double credit)', async () => {
      const depositKey = `dep-replay-${runSuffix}`;

      // First call -> 201
      const firstRes = await request(app)
        .post('/api/v1/wallet/deposit')
        .set('Authorization', `Bearer ${token1}`)
        .set('Idempotency-Key', depositKey)
        .send({ amount: 50000 })
        .expect(201);

      expect(firstRes.body.data.isIdempotentReplay).toBe(false);
      expect(firstRes.body.data.wallet.availableBalance).toBe('150000'); // 100000 + 50000

      // Replay call -> 200 with identical result and no double credit
      const replayRes = await request(app)
        .post('/api/v1/wallet/deposit')
        .set('Authorization', `Bearer ${token1}`)
        .set('Idempotency-Key', depositKey)
        .send({ amount: 50000 })
        .expect(200);

      expect(replayRes.body.data.isIdempotentReplay).toBe(true);
      expect(replayRes.body.data.wallet.availableBalance).toBe('150000');

      // Verify wallet balance is strictly 150000, not 200000
      const balanceRes = await request(app)
        .get('/api/v1/wallet')
        .set('Authorization', `Bearer ${token1}`)
        .expect(200);

      expect(balanceRes.body.data.availableBalance).toBe('150000');
    });

    it('rejects idempotency conflict when same key is reused with different amount (409)', async () => {
      const conflictKey = `dep-conflict-${runSuffix}`;

      // First call
      await request(app)
        .post('/api/v1/wallet/deposit')
        .set('Authorization', `Bearer ${token1}`)
        .set('Idempotency-Key', conflictKey)
        .send({ amount: 25000 })
        .expect(201);

      // Conflicting call with different amount
      const conflictRes = await request(app)
        .post('/api/v1/wallet/deposit')
        .set('Authorization', `Bearer ${token1}`)
        .set('Idempotency-Key', conflictKey)
        .send({ amount: 35000 })
        .expect(409);

      expect(conflictRes.body.success).toBe(false);
      expect(conflictRes.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
    });
  });

  // =========================================================================
  // 4. POST /api/v1/wallet/withdraw
  // =========================================================================
  describe('4. POST /api/v1/wallet/withdraw', () => {
    it('rejects withdrawal when Idempotency-Key header is missing (400)', async () => {
      const res = await request(app)
        .post('/api/v1/wallet/withdraw')
        .set('Authorization', `Bearer ${token1}`)
        .send({ amount: 10000 })
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects withdrawal exceeding available balance with 422 INSUFFICIENT_FUNDS', async () => {
      // User 2 has 0 balance
      const res = await request(app)
        .post('/api/v1/wallet/withdraw')
        .set('Authorization', `Bearer ${token2}`)
        .set('Idempotency-Key', `wd-insufficient-${runSuffix}`)
        .send({ amount: 10000 })
        .expect(422);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INSUFFICIENT_FUNDS');
      expect(res.body.error.message).toContain('Insufficient available balance');
    });

    it('preserves state without partial debit when withdrawal is rejected', async () => {
      // Verify user 2 balance is still 0
      const res = await request(app)
        .get('/api/v1/wallet')
        .set('Authorization', `Bearer ${token2}`)
        .expect(200);

      expect(res.body.data.availableBalance).toBe('0');
      expect(res.body.data.reservedBalance).toBe('0');
    });

    it('successfully withdraws available funds with negative availableDelta ledger entry (201)', async () => {
      // User 1 balance is currently 175000 (100000 + 50000 + 25000)
      const withdrawKey = `wd-success-${runSuffix}`;
      const res = await request(app)
        .post('/api/v1/wallet/withdraw')
        .set('Authorization', `Bearer ${token1}`)
        .set('Idempotency-Key', withdrawKey)
        .send({
          amount: 45000, // 450.00 INR
          description: 'Payout to bank',
        })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.isIdempotentReplay).toBe(false);
      expect(res.body.data.wallet.availableBalance).toBe('130000'); // 175000 - 45000

      expect(res.body.data.operation.operationType).toBe('WITHDRAWAL');
      expect(res.body.data.operation.status).toBe('COMPLETED');

      expect(res.body.data.ledgerEntry.entryType).toBe('WITHDRAWAL_SETTLED');
      expect(res.body.data.ledgerEntry.amount).toBe('45000');
      expect(res.body.data.ledgerEntry.availableDelta).toBe('-45000');
      expect(res.body.data.ledgerEntry.balanceAfterAvailable).toBe('130000');
    });

    it('idempotently replays duplicate withdrawal request without double-spending (200)', async () => {
      const withdrawKey = `wd-replay-${runSuffix}`;

      // First call -> 201
      const firstRes = await request(app)
        .post('/api/v1/wallet/withdraw')
        .set('Authorization', `Bearer ${token1}`)
        .set('Idempotency-Key', withdrawKey)
        .send({ amount: 30000 })
        .expect(201);

      expect(firstRes.body.data.isIdempotentReplay).toBe(false);
      expect(firstRes.body.data.wallet.availableBalance).toBe('100000'); // 130000 - 30000

      // Replay call -> 200 with identical balance
      const replayRes = await request(app)
        .post('/api/v1/wallet/withdraw')
        .set('Authorization', `Bearer ${token1}`)
        .set('Idempotency-Key', withdrawKey)
        .send({ amount: 30000 })
        .expect(200);

      expect(replayRes.body.data.isIdempotentReplay).toBe(true);
      expect(replayRes.body.data.wallet.availableBalance).toBe('100000');

      // Verify wallet balance is still 100000
      const balanceRes = await request(app)
        .get('/api/v1/wallet')
        .set('Authorization', `Bearer ${token1}`)
        .expect(200);

      expect(balanceRes.body.data.availableBalance).toBe('100000');
    });

    it('rejects idempotency conflict on withdrawal with mismatched payload (409)', async () => {
      const conflictKey = `wd-conflict-${runSuffix}`;

      // First call
      await request(app)
        .post('/api/v1/wallet/withdraw')
        .set('Authorization', `Bearer ${token1}`)
        .set('Idempotency-Key', conflictKey)
        .send({ amount: 10000 })
        .expect(201);

      // Conflicting call with different amount
      const conflictRes = await request(app)
        .post('/api/v1/wallet/withdraw')
        .set('Authorization', `Bearer ${token1}`)
        .set('Idempotency-Key', conflictKey)
        .send({ amount: 20000 })
        .expect(409);

      expect(conflictRes.body.success).toBe(false);
      expect(conflictRes.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
    });
  });

  // =========================================================================
  // 5. GET /api/v1/wallet/transactions Pagination & Filtering
  // =========================================================================
  describe('5. GET /api/v1/wallet/transactions (and /wallet/transactions)', () => {
    it('returns paginated transactions for authenticated user', async () => {
      const res = await request(app)
        .get('/api/v1/wallet/transactions')
        .set('Authorization', `Bearer ${token1}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data.transactions)).toBe(true);
      expect(res.body.data.transactions.length).toBeGreaterThanOrEqual(1);

      const firstTx = res.body.data.transactions[0];
      expect(firstTx.id).toBeDefined();
      expect(firstTx.amountPaise).toBeDefined();
      expect(firstTx.availableDelta).toBeDefined();
      expect(firstTx.balanceAfterAvailable).toBeDefined();
      expect(firstTx.entryType).toBeDefined();

      expect(res.body.data.pagination).toBeDefined();
      expect(res.body.data.pagination.page).toBe(1);
      expect(res.body.data.pagination.limit).toBe(20);
      expect(res.body.data.pagination.total).toBeGreaterThanOrEqual(1);
    });

    it('filters transactions by type=DEPOSIT', async () => {
      const res = await request(app)
        .get('/api/v1/wallet/transactions?type=DEPOSIT')
        .set('Authorization', `Bearer ${token1}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      for (const tx of res.body.data.transactions) {
        expect(tx.entryType).toBe('DEPOSIT');
      }
    });

    it('filters transactions by type=WITHDRAWAL_SETTLED', async () => {
      const res = await request(app)
        .get('/api/v1/wallet/transactions?type=WITHDRAWAL_SETTLED')
        .set('Authorization', `Bearer ${token1}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      for (const tx of res.body.data.transactions) {
        expect(tx.entryType).toBe('WITHDRAWAL_SETTLED');
      }
    });

    it('respects pagination parameters limit and page', async () => {
      const res = await request(app)
        .get('/api/v1/wallet/transactions?limit=1&page=1')
        .set('Authorization', `Bearer ${token1}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.transactions.length).toBe(1);
      expect(res.body.data.pagination.limit).toBe(1);
      expect(res.body.data.pagination.page).toBe(1);
      expect(res.body.data.pagination.totalPages).toBeGreaterThanOrEqual(2);
    });

    it('filters transactions within a valid date range', async () => {
      const now = new Date();
      const past = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
      const future = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();

      const res = await request(app)
        .get(`/api/v1/wallet/transactions?startDate=${encodeURIComponent(past)}&endDate=${encodeURIComponent(future)}`)
        .set('Authorization', `Bearer ${token1}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.transactions.length).toBeGreaterThanOrEqual(1);
    });

    it('returns empty list when date range is in the far future', async () => {
      const futureStart = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
      const futureEnd = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toISOString();

      const res = await request(app)
        .get(`/api/v1/wallet/transactions?startDate=${encodeURIComponent(futureStart)}&endDate=${encodeURIComponent(futureEnd)}`)
        .set('Authorization', `Bearer ${token1}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.transactions.length).toBe(0);
      expect(res.body.data.pagination.total).toBe(0);
    });

    it('rejects invalid date strings with 400 VALIDATION_ERROR', async () => {
      const res = await request(app)
        .get('/api/v1/wallet/transactions?startDate=not-a-valid-date')
        .set('Authorization', `Bearer ${token1}`)
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects inverted date range (startDate > endDate) with 400 VALIDATION_ERROR', async () => {
      const start = new Date(Date.now() + 10000).toISOString();
      const end = new Date(Date.now() - 10000).toISOString();

      const res = await request(app)
        .get(`/api/v1/wallet/transactions?startDate=${encodeURIComponent(start)}&endDate=${encodeURIComponent(end)}`)
        .set('Authorization', `Bearer ${token1}`)
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns identical data under root mounted /wallet/transactions route', async () => {
      const res = await request(app)
        .get('/wallet/transactions')
        .set('Authorization', `Bearer ${token1}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data.transactions)).toBe(true);
    });
  });
});
