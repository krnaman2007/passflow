/**
 * Recurring background recovery worker for unsettled trade executions.
 *
 * Scans for durable executions that were matched but never settled (e.g. due to
 * process crash or transient database exhaustion during post-match dispatch).
 *
 * Guarantees:
 * 1. Single active polling loop per instance with overlapping tick prevention.
 * 2. Unsettled executions are settled idempotently via TradeSettlementService.
 * 3. Competing workers serialize on PostgreSQL row locks (Execution row).
 * 4. Graceful shutdown mechanism to drain active in-flight tick within timeout.
 * 5. Uses durable database state (settlementStatus, nextRetryAt) for scheduling.
 */
import logger from '../../errorlogging/logger.js';
import { tradeSettlementService as defaultTradeSettlementService } from './trade-settlement-service.js';

export const DEFAULT_RECOVERY_INTERVAL_MS = 10_000; // 10 seconds
export const DEFAULT_RECOVERY_BATCH_SIZE = 100;

export class SettlementRecoveryWorker {
  constructor({
    settlementService = defaultTradeSettlementService,
    intervalMs = Number(process.env.SETTLEMENT_RECOVERY_INTERVAL_MS) || DEFAULT_RECOVERY_INTERVAL_MS,
    batchSize = Number(process.env.SETTLEMENT_RECOVERY_BATCH_SIZE) || DEFAULT_RECOVERY_BATCH_SIZE,
    loggerInstance = logger,
  } = {}) {
    this.settlementService = settlementService;
    this.intervalMs = Number.isSafeInteger(intervalMs) && intervalMs > 0 ? intervalMs : DEFAULT_RECOVERY_INTERVAL_MS;
    const rawBatch = Number.isSafeInteger(batchSize) ? batchSize : DEFAULT_RECOVERY_BATCH_SIZE;
    this.batchSize = Math.max(1, Math.min(500, rawBatch));
    this.logger = loggerInstance;

    this.isRunning = false;
    this.isTickInProgress = false;
    this.lastSeenSequenceNumber = null;
    this.lastTickAt = null;
    this.lastBatchStats = null;
    this._timer = null;
    this._currentTickPromise = null;
  }

  /**
   * Safe internal inspection helper for recovery worker status.
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      isTickInProgress: this.isTickInProgress,
      intervalMs: this.intervalMs,
      batchSize: this.batchSize,
      lastSeenSequenceNumber: this.lastSeenSequenceNumber !== null ? this.lastSeenSequenceNumber.toString() : null,
      lastTickAt: this.lastTickAt || null,
      lastBatchStats: this.lastBatchStats || null,
    };
  }

  /**
   * Resets the sequence cursor to the beginning (wrap-around).
   */
  resetCursor() {
    this.lastSeenSequenceNumber = null;
  }

  /**
   * Starts the recurring recovery worker loop.
   * Safe to call multiple times (idempotent).
   */
  start() {
    if (this.isRunning) {
      return;
    }
    this.isRunning = true;
    if (this.logger?.info) {
      this.logger.info('Settlement recovery worker started', {
        intervalMs: this.intervalMs,
        batchSize: this.batchSize,
      });
    }
    this._scheduleNextTick();
  }

  /**
   * Stops the recurring recovery worker and awaits any active tick up to timeoutMs.
   *
   * @param {Object} [options]
   * @param {number} [options.timeoutMs=5000]
   * @returns {Promise<void>}
   */
  async stop({ timeoutMs = 5000 } = {}) {
    if (!this.isRunning && !this.isTickInProgress) {
      return;
    }
    this.isRunning = false;

    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }

    if (this.isTickInProgress && this._currentTickPromise) {
      if (this.logger?.info) {
        this.logger.info('Settlement recovery worker stopping: waiting for in-flight tick to complete...');
      }
      let timeoutHandle;
      const timeoutPromise = new Promise((resolve) => {
        timeoutHandle = setTimeout(resolve, timeoutMs);
        if (timeoutHandle?.unref) timeoutHandle.unref();
      });

      try {
        await Promise.race([this._currentTickPromise, timeoutPromise]);
      } catch (err) {
        if (this.logger?.warn) {
          this.logger.warn('Error while waiting for in-flight recovery tick during shutdown', { error: err.message });
        }
      } finally {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
      }
    }

    if (this.logger?.info) {
      this.logger.info('Settlement recovery worker stopped');
    }
  }

  /**
   * Executes a single recovery tick.
   * Protected against concurrent invocations within the same process.
   * Advances a sequenceNumber cursor across ticks to prevent permanently failing
   * older executions from starving newer eligible executions.
   *
   * @returns {Promise<Array<Object>|null>}
   */
  async tick() {
    if (this.isTickInProgress) {
      if (this.logger?.warn) {
        this.logger.warn('Settlement recovery tick skipped: previous tick is still in progress');
      }
      return null;
    }

    this.isTickInProgress = true;
    this._currentTickPromise = (async () => {
      try {
        const queryOptions = { batchSize: this.batchSize };
        if (this.lastSeenSequenceNumber !== null) {
          queryOptions.afterSequenceNumber = this.lastSeenSequenceNumber;
        }

        const results = await this.settlementService.recoverUnsettled(queryOptions);

        if (Array.isArray(results) && results.length > 0) {
          let maxSeq = null;
          for (const item of results) {
            const seq = item.sequenceNumber ?? item.settlement?.execution?.sequenceNumber;
            if (seq !== undefined && seq !== null) {
              const seqBigInt = BigInt(seq);
              if (maxSeq === null || seqBigInt > maxSeq) {
                maxSeq = seqBigInt;
              }
            }
          }
          if (maxSeq !== null) {
            this.lastSeenSequenceNumber = maxSeq;
          }
        } else if (Array.isArray(results) && this.lastSeenSequenceNumber !== null) {
          // Wrapped around: reached the tail of the sequence stream with no newer unsettled executions.
          // Reset cursor so subsequent ticks re-examine earlier unsettled executions.
          this.lastSeenSequenceNumber = null;
        }

        const failures = Array.isArray(results) ? results.filter((r) => r && r.settled === false) : [];
        const succeeded = Array.isArray(results) ? results.filter((r) => r && r.settled !== false) : [];

        this.lastTickAt = new Date();
        this.lastBatchStats = {
          processedCount: Array.isArray(results) ? results.length : 0,
          succeededCount: succeeded.length,
          failedCount: failures.length,
        };

        if (this.logger?.info && Array.isArray(results) && results.length > 0) {
          this.logger.info('Settlement recovery batch summary', {
            processedCount: results.length,
            succeededCount: succeeded.length,
            failedCount: failures.length,
          });
        }

        if (failures.length > 0) {
          if (this.logger?.error) {
            const meta = {
              failedCount: failures.length,
              executionIds: failures.map((f) => f.executionId),
            };
            if (this.lastSeenSequenceNumber !== null) {
              meta.lastSeenSequenceNumber = this.lastSeenSequenceNumber.toString();
            }
            this.logger.error('Settlement recovery found executions requiring intervention', meta);
          }
        } else if (Array.isArray(results) && results.length > 0) {
          if (this.logger?.info) {
            const meta = { count: results.length };
            if (this.lastSeenSequenceNumber !== null) {
              meta.lastSeenSequenceNumber = this.lastSeenSequenceNumber.toString();
            }
            this.logger.info('Settlement recovery processed executions', meta);
          }
        }

        return results;
      } catch (err) {
        if (this.logger?.error) {
          this.logger.error('Settlement recovery worker error', { error: err.message });
          this.logger.error('Settlement recovery tick failed unexpectedly', { error: err.message });
        }
        return null;
      } finally {
        this.isTickInProgress = false;
        this._currentTickPromise = null;
        if (this.isRunning) {
          this._scheduleNextTick();
        }
      }
    })();

    return this._currentTickPromise;
  }

  /**
   * Internal scheduler for the next tick using setTimeout.
   * @private
   */
  _scheduleNextTick() {
    if (!this.isRunning) return;
    if (this._timer) {
      clearTimeout(this._timer);
    }
    this._timer = setTimeout(() => {
      this.tick().catch((err) => {
        if (this.logger?.error) {
          this.logger.error('Unhandled rejection in settlement recovery tick', { error: err.message });
        }
      });
    }, this.intervalMs);

    if (this._timer && typeof this._timer.unref === 'function') {
      this._timer.unref();
    }
  }
}

export const settlementRecoveryWorker = new SettlementRecoveryWorker();
export default settlementRecoveryWorker;
