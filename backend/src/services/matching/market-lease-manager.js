/**
 * MarketLeaseManager
 *
 * Implements database-backed distributed market leases with monotonic fencing tokens
 * for PassFlow's persistent matching engine.
 *
 * Core Guarantees:
 * 1. Mutual Exclusion: At most one backend instance actively owns a market (eventId, ticketCategoryId).
 * 2. Monotonic Fencing: Every lease acquisition/takeover increments a durable fencingToken.
 * 3. Database Time: Expiration and validity checks rely on PostgreSQL NOW(), avoiding local clock skew.
 * 4. Stale-Owner Fencing: Writes by former owners are rejected by the database transaction boundary.
 * 5. Safe Takeover: Expired leases can be taken over atomically by competing instances.
 * 6. Autonomous Renewal: Active owners automatically renew leases periodically before expiration.
 * 7. Fast Relinquishment: Owners release leases upon graceful shutdown to enable immediate takeover.
 */

import crypto from 'node:crypto';
import { prisma as defaultPrisma } from '../../db/prisma.js';
import { formatMarketKey, parseMarketKey } from './market-state.js';

export const DEFAULT_LEASE_DURATION_MS = 10000; // 10 seconds
export const DEFAULT_RENEWAL_RATIO = 0.33; // Renew every 1/3 of lease duration (~3.3s for 10s)

/**
 * Thrown when market ownership cannot be acquired or maintained.
 */
export class MarketOwnershipError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'MarketOwnershipError';
    this.code = details.code || 'MARKET_OWNERSHIP_ERROR';
    this.details = details;
  }
}

/**
 * Thrown when a mutation violates fencing rules (stale owner, token mismatch, or expired lease).
 */
export class FencingViolationError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'FencingViolationError';
    this.code = details.code || 'FENCING_VIOLATION';
    this.details = details;
  }
}

/**
 * Verifies that the writer still holds an active, unexpired lease with the expected fencing token
 * inside the executing PostgreSQL transaction.
 *
 * MUST be executed inside an active Prisma interactive transaction client (`tx`).
 *
 * @param {Object} tx - Active transaction client
 * @param {Object} params
 * @param {string} params.eventId
 * @param {string} params.ticketCategoryId
 * @param {string} params.ownerId
 * @param {bigint|string|number} params.fencingToken
 * @throws {FencingViolationError} If validation fails
 */
export async function verifyFencingToken(tx, { eventId, ticketCategoryId, ownerId, fencingToken }) {
  if (!tx || typeof tx.$queryRaw !== 'function') {
    throw new TypeError('verifyFencingToken requires an interactive Prisma transaction client with $queryRaw');
  }

  const rows = await tx.$queryRaw`
    SELECT id, "ownerId", "fencingToken", "expiresAt", ("expiresAt" <= NOW()) as "isExpired"
    FROM "MarketLease"
    WHERE "eventId" = ${eventId} AND "ticketCategoryId" = ${ticketCategoryId}
    FOR UPDATE
  `;

  if (!rows || rows.length === 0) {
    throw new FencingViolationError(
      `No active market lease found in database for market (${eventId}, ${ticketCategoryId})`,
      { code: 'NO_ACTIVE_LEASE', eventId, ticketCategoryId }
    );
  }

  const lease = rows[0];

  // 1. Owner match check
  if (lease.ownerId !== ownerId) {
    throw new FencingViolationError(
      `Market lease owned by instance "${lease.ownerId}", but expected "${ownerId}"`,
      {
        code: 'STALE_OWNER',
        eventId,
        ticketCategoryId,
        actualOwnerId: lease.ownerId,
        expectedOwnerId: ownerId,
      }
    );
  }

  // 2. Monotonic fencing token match check
  const actualToken = BigInt(lease.fencingToken);
  const expectedToken = BigInt(fencingToken);
  if (actualToken !== expectedToken) {
    throw new FencingViolationError(
      `Fencing token mismatch: expected token ${expectedToken}, but database holds token ${actualToken}`,
      {
        code: 'FENCING_TOKEN_MISMATCH',
        eventId,
        ticketCategoryId,
        actualFencingToken: actualToken.toString(),
        expectedFencingToken: expectedToken.toString(),
      }
    );
  }

  // 3. Lease expiration check using database time
  if (lease.isExpired) {
    throw new FencingViolationError(
      `Market lease has expired (expired at ${lease.expiresAt.toISOString()})`,
      {
        code: 'LEASE_EXPIRED',
        eventId,
        ticketCategoryId,
        expiresAt: lease.expiresAt,
      }
    );
  }

  return {
    valid: true,
    fencingToken: actualToken,
    ownerId: lease.ownerId,
    expiresAt: lease.expiresAt,
  };
}

export class MarketLeaseManager {
  /**
   * @param {Object} [options]
   * @param {import('@prisma/client').PrismaClient} [options.prismaClient]
   * @param {string} [options.ownerId] - Process instance identifier
   * @param {number} [options.defaultLeaseDurationMs] - Default lease duration
   * @param {number} [options.renewalRatio] - Frequency ratio for renewal
   */
  constructor({
    prismaClient = defaultPrisma,
    ownerId,
    defaultLeaseDurationMs = DEFAULT_LEASE_DURATION_MS,
    renewalRatio = DEFAULT_RENEWAL_RATIO,
  } = {}) {
    this.prisma = prismaClient;
    this.ownerId = ownerId || process.env.INSTANCE_ID || `inst-${process.pid}-${crypto.randomUUID().slice(0, 8)}`;
    this.defaultLeaseDurationMs = defaultLeaseDurationMs;
    this.renewalRatio = renewalRatio;

    /**
     * Map of marketKey -> { marketKey, eventId, ticketCategoryId, ownerId, fencingToken, expiresAt, leaseDurationMs }
     * @type {Map<string, Object>}
     */
    this._activeLeases = new Map();

    /**
     * Map of marketKey -> NodeJS.Timeout
     * @type {Map<string, NodeJS.Timeout>}
     */
    this._renewalTimers = new Map();
  }

  /**
   * Resolves market key.
   * @param {string|Object} marketKeyOrConfig
   * @returns {string}
   */
  _resolveKey(marketKeyOrConfig) {
    if (typeof marketKeyOrConfig === 'string') {
      return marketKeyOrConfig;
    }
    return formatMarketKey(marketKeyOrConfig);
  }

  /**
   * Attempts to acquire exclusive ownership of a market.
   *
   * Exact Semantics:
   * 1. Inserts market lease row if none exists (ON CONFLICT DO NOTHING).
   * 2. Locks lease row FOR UPDATE.
   * 3. If already owned by this instance: renews and returns acquired=true.
   * 4. If owned by another instance but expired: increments fencingToken, claims ownership, returns acquired=true (takeover).
   * 5. If owned by another instance and not expired: returns acquired=false.
   *
   * @param {Object} params
   * @param {string} params.eventId
   * @param {string} params.ticketCategoryId
   * @param {number} [params.leaseDurationMs]
   * @returns {Promise<{ acquired: boolean, fencingToken: bigint, expiresAt: Date, ownerId: string, takeover?: boolean, renewed?: boolean, reason?: string }>}
   */
  async acquireLease({
    eventId,
    ticketCategoryId,
    leaseDurationMs = this.defaultLeaseDurationMs,
  }) {
    if (!eventId || typeof eventId !== 'string') {
      throw new TypeError('eventId must be a non-empty string');
    }
    if (!ticketCategoryId || typeof ticketCategoryId !== 'string') {
      throw new TypeError('ticketCategoryId must be a non-empty string');
    }

    const marketKey = formatMarketKey(eventId, ticketCategoryId);
    const secs = leaseDurationMs / 1000.0;
    const initialId = crypto.randomUUID();

    return this.prisma.$transaction(async (tx) => {
      // Step 1: Ensure row exists via ON CONFLICT DO NOTHING
      await tx.$executeRaw`
        INSERT INTO "MarketLease" (
          "id", "eventId", "ticketCategoryId", "ownerId", "fencingToken",
          "leaseDurationMs", "expiresAt", "acquiredAt", "renewedAt"
        )
        VALUES (
          ${initialId}, ${eventId}, ${ticketCategoryId}, ${this.ownerId}, 1,
          ${leaseDurationMs}, NOW() + make_interval(secs => ${secs}), NOW(), NOW()
        )
        ON CONFLICT ("eventId", "ticketCategoryId") DO NOTHING
      `;

      // Step 2: Lock the lease row FOR UPDATE to evaluate ownership
      const rows = await tx.$queryRaw`
        SELECT id, "ownerId", "fencingToken", "expiresAt", ("expiresAt" <= NOW()) as "isExpired"
        FROM "MarketLease"
        WHERE "eventId" = ${eventId} AND "ticketCategoryId" = ${ticketCategoryId}
        FOR UPDATE
      `;

      if (!rows || rows.length === 0) {
        throw new MarketOwnershipError(
          `Unexpected error: failed to find or create market lease for (${eventId}, ${ticketCategoryId})`,
          { code: 'LEASE_CREATION_FAILED', eventId, ticketCategoryId }
        );
      }

      const row = rows[0];
      const isCurrentOwner = row.ownerId === this.ownerId;
      const isExpired = Boolean(row.isExpired);

      if (isCurrentOwner) {
        // Renewal of existing ownership
        const updated = await tx.$queryRaw`
          UPDATE "MarketLease"
          SET "expiresAt" = NOW() + make_interval(secs => ${secs}),
              "renewedAt" = NOW(),
              "leaseDurationMs" = ${leaseDurationMs}
          WHERE id = ${row.id}
          RETURNING "expiresAt", "fencingToken"
        `;
        const updatedRow = updated[0];
        const fencingToken = BigInt(updatedRow.fencingToken);
        const leaseInfo = {
          marketKey,
          eventId,
          ticketCategoryId,
          ownerId: this.ownerId,
          fencingToken,
          expiresAt: updatedRow.expiresAt,
          leaseDurationMs,
        };
        this._activeLeases.set(marketKey, leaseInfo);
        return {
          acquired: true,
          fencingToken,
          expiresAt: updatedRow.expiresAt,
          ownerId: this.ownerId,
          renewed: true,
        };
      }

      if (isExpired) {
        // Safe takeover of expired lease! Monotonically increment fencingToken
        const newFencingToken = BigInt(row.fencingToken) + 1n;
        const updated = await tx.$queryRaw`
          UPDATE "MarketLease"
          SET "ownerId" = ${this.ownerId},
              "fencingToken" = ${newFencingToken},
              "leaseDurationMs" = ${leaseDurationMs},
              "expiresAt" = NOW() + make_interval(secs => ${secs}),
              "acquiredAt" = NOW(),
              "renewedAt" = NOW()
          WHERE id = ${row.id}
          RETURNING "expiresAt", "fencingToken"
        `;
        const updatedRow = updated[0];
        const fencingToken = BigInt(updatedRow.fencingToken);
        const leaseInfo = {
          marketKey,
          eventId,
          ticketCategoryId,
          ownerId: this.ownerId,
          fencingToken,
          expiresAt: updatedRow.expiresAt,
          leaseDurationMs,
        };
        this._activeLeases.set(marketKey, leaseInfo);
        return {
          acquired: true,
          fencingToken,
          expiresAt: updatedRow.expiresAt,
          ownerId: this.ownerId,
          takeover: true,
        };
      }

      // Active lease owned by another instance
      return {
        acquired: false,
        fencingToken: BigInt(row.fencingToken),
        expiresAt: row.expiresAt,
        ownerId: row.ownerId,
        reason: 'LEASE_ACTIVE',
      };
    });
  }

  /**
   * Renews an existing lease for an active market.
   *
   * @param {Object} params
   * @param {string} params.eventId
   * @param {string} params.ticketCategoryId
   * @param {bigint|string|number} [params.expectedFencingToken]
   * @param {number} [params.leaseDurationMs]
   * @returns {Promise<{ renewed: boolean, fencingToken?: bigint, expiresAt?: Date, reason?: string, currentOwner?: string }>}
   */
  async renewLease({
    eventId,
    ticketCategoryId,
    expectedFencingToken,
    leaseDurationMs = this.defaultLeaseDurationMs,
  }) {
    const marketKey = formatMarketKey(eventId, ticketCategoryId);
    const secs = leaseDurationMs / 1000.0;

    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw`
        SELECT id, "ownerId", "fencingToken", "expiresAt", ("expiresAt" <= NOW()) as "isExpired"
        FROM "MarketLease"
        WHERE "eventId" = ${eventId} AND "ticketCategoryId" = ${ticketCategoryId}
        FOR UPDATE
      `;

      if (!rows || rows.length === 0) {
        this._activeLeases.delete(marketKey);
        return { renewed: false, reason: 'NO_LEASE' };
      }

      const row = rows[0];
      const actualToken = BigInt(row.fencingToken);
      const isOwner = row.ownerId === this.ownerId;
      const isTokenMatch = expectedFencingToken !== undefined
        ? actualToken === BigInt(expectedFencingToken)
        : true;
      const isExpired = Boolean(row.isExpired);

      if (!isOwner || !isTokenMatch || isExpired) {
        this._activeLeases.delete(marketKey);
        return {
          renewed: false,
          reason: !isOwner
            ? 'OWNER_MISMATCH'
            : !isTokenMatch
            ? 'FENCING_TOKEN_MISMATCH'
            : 'LEASE_EXPIRED',
          currentOwner: row.ownerId,
          actualFencingToken: actualToken,
        };
      }

      const updated = await tx.$queryRaw`
        UPDATE "MarketLease"
        SET "expiresAt" = NOW() + make_interval(secs => ${secs}),
            "renewedAt" = NOW(),
            "leaseDurationMs" = ${leaseDurationMs}
        WHERE id = ${row.id}
        RETURNING "expiresAt", "fencingToken"
      `;

      const updatedRow = updated[0];
      const fencingToken = BigInt(updatedRow.fencingToken);
      const leaseInfo = {
        marketKey,
        eventId,
        ticketCategoryId,
        ownerId: this.ownerId,
        fencingToken,
        expiresAt: updatedRow.expiresAt,
        leaseDurationMs,
      };
      this._activeLeases.set(marketKey, leaseInfo);

      return {
        renewed: true,
        fencingToken,
        expiresAt: updatedRow.expiresAt,
      };
    });
  }

  /**
   * Releases an actively owned lease, immediately setting expiration to past time for fast takeover.
   *
   * @param {Object} params
   * @param {string} params.eventId
   * @param {string} params.ticketCategoryId
   * @param {bigint|string|number} [params.expectedFencingToken]
   * @returns {Promise<{ released: boolean, reason?: string, fencingToken?: bigint }>}
   */
  async releaseLease({ eventId, ticketCategoryId, expectedFencingToken }) {
    const marketKey = formatMarketKey(eventId, ticketCategoryId);
    this.stopAutoRenewal(marketKey);
    this._activeLeases.delete(marketKey);

    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw`
        SELECT id, "ownerId", "fencingToken"
        FROM "MarketLease"
        WHERE "eventId" = ${eventId} AND "ticketCategoryId" = ${ticketCategoryId}
        FOR UPDATE
      `;

      if (!rows || rows.length === 0) {
        return { released: false, reason: 'NOT_FOUND' };
      }

      const row = rows[0];
      const isOwner = row.ownerId === this.ownerId;
      const actualToken = BigInt(row.fencingToken);
      const isTokenMatch = expectedFencingToken !== undefined
        ? actualToken === BigInt(expectedFencingToken)
        : true;

      if (!isOwner || !isTokenMatch) {
        return { released: false, reason: !isOwner ? 'NOT_OWNER' : 'TOKEN_MISMATCH' };
      }

      // Expire immediately so competitors can acquire without waiting for timeout
      await tx.$executeRaw`
        UPDATE "MarketLease"
        SET "expiresAt" = NOW() - make_interval(secs => 1.0)
        WHERE id = ${row.id}
      `;

      return { released: true, fencingToken: actualToken };
    });
  }

  /**
   * Starts periodic autonomous renewal for a market.
   *
   * @param {string|Object} marketKeyOrConfig
   * @param {Object} [options]
   * @param {(err: Error) => void} [options.onRenewalFailure]
   */
  startAutoRenewal(marketKeyOrConfig, { onRenewalFailure } = {}) {
    const marketKey = this._resolveKey(marketKeyOrConfig);
    this.stopAutoRenewal(marketKey);

    const lease = this._activeLeases.get(marketKey);
    if (!lease) {
      throw new MarketOwnershipError(
        `Cannot start auto-renewal for "${marketKey}": no active lease cached`,
        { code: 'NO_ACTIVE_LEASE', marketKey }
      );
    }

    const intervalMs = Math.max(200, Math.floor(lease.leaseDurationMs * this.renewalRatio));

    const timer = setInterval(async () => {
      try {
        const result = await this.renewLease({
          eventId: lease.eventId,
          ticketCategoryId: lease.ticketCategoryId,
          expectedFencingToken: lease.fencingToken,
          leaseDurationMs: lease.leaseDurationMs,
        });

        if (!result.renewed) {
          this.stopAutoRenewal(marketKey);
          if (typeof onRenewalFailure === 'function') {
            onRenewalFailure(
              new MarketOwnershipError(
                `Lease renewal rejected for market "${marketKey}": ${result.reason}`,
                { code: 'RENEWAL_REJECTED', marketKey, ...result }
              )
            );
          }
        }
      } catch (err) {
        // Database connectivity error or transaction failure during renewal
        this.stopAutoRenewal(marketKey);
        this._activeLeases.delete(marketKey);
        if (typeof onRenewalFailure === 'function') {
          onRenewalFailure(err);
        }
      }
    }, intervalMs);

    if (timer.unref) {
      timer.unref();
    }

    this._renewalTimers.set(marketKey, timer);
  }

  /**
   * Stops auto-renewal for a market.
   * @param {string|Object} marketKeyOrConfig
   */
  stopAutoRenewal(marketKeyOrConfig) {
    const marketKey = this._resolveKey(marketKeyOrConfig);
    const timer = this._renewalTimers.get(marketKey);
    if (timer) {
      clearInterval(timer);
      this._renewalTimers.delete(marketKey);
    }
  }

  /**
   * Retrieves cached lease info for a market.
   * @param {string|Object} marketKeyOrConfig
   * @returns {Object|null}
   */
  getActiveLease(marketKeyOrConfig) {
    const marketKey = this._resolveKey(marketKeyOrConfig);
    const lease = this._activeLeases.get(marketKey);
    if (!lease) return null;
    return { ...lease };
  }

  /**
   * Checks whether this instance currently holds a valid active lease for the market.
   * @param {string|Object} marketKeyOrConfig
   * @param {Date} [now]
   * @returns {boolean}
   */
  isLeaseActive(marketKeyOrConfig, now = new Date()) {
    const marketKey = this._resolveKey(marketKeyOrConfig);
    const lease = this._activeLeases.get(marketKey);
    if (!lease) return false;
    return new Date(lease.expiresAt).getTime() > now.getTime();
  }

  /**
   * Releases all active leases on graceful shutdown.
   * @returns {Promise<Array<Object>>}
   */
  async releaseAll() {
    const keys = Array.from(this._activeLeases.keys());
    const results = [];
    for (const key of keys) {
      const lease = this._activeLeases.get(key);
      if (lease) {
        try {
          const res = await this.releaseLease({
            eventId: lease.eventId,
            ticketCategoryId: lease.ticketCategoryId,
            expectedFencingToken: lease.fencingToken,
          });
          results.push({ marketKey: key, ...res });
        } catch (err) {
          results.push({ marketKey: key, released: false, error: err.message });
        }
      }
    }
    return results;
  }
}

export default MarketLeaseManager;
