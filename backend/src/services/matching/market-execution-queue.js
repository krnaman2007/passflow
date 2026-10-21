/**
 * MarketExecutionQueue
 *
 * Provides in-process, asynchronous FIFO serialization for mutating operations
 * on a per-market basis, identified by (eventId, ticketCategoryId).
 *
 * Guarantees:
 * 1. Strict FIFO ordering: Tasks queued on the same market execute in the order enqueued.
 * 2. Non-overlapping execution: No two async tasks for the same market run concurrently.
 * 3. Cross-market concurrency: Operations on different markets run concurrently without blocking.
 * 4. Fault isolation: A rejected task rejects its own caller's promise and does not halt subsequent tasks.
 * 5. State gating: Mutating operations are rejected if the market is not in READY state
 *    (both at enqueue time and at head-of-queue execution time).
 * 6. Memory hygiene: Drained market queues are cleanly deleted to avoid unbounded memory retention.
 *
 * Scope: Process-local. Does not provide cross-process or multi-instance distributed coordination.
 */

import {
  MarketState,
  MarketStateManager,
  MarketNotReadyError,
  formatMarketKey,
} from './market-state.js';

export {
  MarketState,
  MarketStateManager,
  MarketStateError,
  MarketNotReadyError,
  InvalidMarketStateTransitionError,
  formatMarketKey,
  parseMarketKey,
} from './market-state.js';

/**
 * @typedef {Object} QueueItem
 * @property {() => Promise<any>|any} taskFn - The user task to execute.
 * @property {(value: any) => void} resolve - Resolves caller promise.
 * @property {(reason: any) => void} reject - Rejects caller promise.
 * @property {boolean} checkState - Whether to enforce READY state gating.
 * @property {number} enqueuedAt - Timestamp when task was enqueued.
 */

/**
 * @typedef {Object} MarketQueueRecord
 * @property {string} marketKey - Unique market identifier.
 * @property {QueueItem[]} items - Pending tasks.
 * @property {boolean} isProcessing - True while an async task is running.
 */

export class MarketExecutionQueue {
  /**
   * @param {Object} [options]
   * @param {MarketStateManager} [options.stateManager] - Custom state manager.
   */
  constructor({ stateManager } = {}) {
    /** @type {MarketStateManager} */
    this._stateManager = stateManager || new MarketStateManager();

    /** @type {Map<string, MarketQueueRecord>} */
    this._queues = new Map();

    /** @type {Map<string, { totalEnqueued: number, totalProcessed: number, totalFailed: number }>} */
    this._stats = new Map();
  }

  /**
   * Returns the underlying MarketStateManager.
   * @returns {MarketStateManager}
   */
  getStateManager() {
    return this._stateManager;
  }

  /**
   * Resolves a canonical market key from string, config object, or OrderBook.
   * @private
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
   * Updates diagnostic stats for a market on enqueue.
   * @private
   * @param {string} marketKey
   */
  _trackEnqueued(marketKey) {
    let s = this._stats.get(marketKey);
    if (!s) {
      s = { totalEnqueued: 0, totalProcessed: 0, totalFailed: 0 };
      this._stats.set(marketKey, s);
    }
    s.totalEnqueued += 1;
  }

  /**
   * Updates diagnostic stats for a market on success.
   * @private
   * @param {string} marketKey
   */
  _trackProcessed(marketKey) {
    const s = this._stats.get(marketKey);
    if (s) {
      s.totalProcessed += 1;
    }
  }

  /**
   * Updates diagnostic stats for a market on failure.
   * @private
   * @param {string} marketKey
   */
  _trackFailed(marketKey) {
    const s = this._stats.get(marketKey);
    if (s) {
      s.totalFailed += 1;
    }
  }

  /**
   * Enqueues an asynchronous mutating task for serialized execution on the target market.
   *
   * Exact Semantics:
   * 1. Evaluates front-gate state check: if checkState is true and the market is not READY,
   *    immediately rejects with MarketNotReadyError without adding the task to the queue.
   * 2. Pushes task to the market's FIFO queue in synchronous invocation order.
   * 3. When the task reaches the head of the queue, re-evaluates the market state. If the
   *    market transitioned away from READY while waiting, rejects without executing taskFn.
   * 4. Asynchronously awaits taskFn(). Returns taskFn's return value or forwards its rejection.
   * 5. Advances queue to the next pending item, regardless of whether taskFn resolved or rejected.
   *
   * @template T
   * @param {string|Object} marketKeyOrConfig - Market key or { eventId, ticketCategoryId }.
   * @param {() => Promise<T>|T} taskFn - Mutation function returning a Promise or value.
   * @param {Object} [options]
   * @param {boolean} [options.checkState=true] - Whether to enforce READY state gating.
   * @returns {Promise<T>} Resolves or rejects with the individual task's result.
   */
  execute(marketKeyOrConfig, taskFn, { checkState = true } = {}) {
    if (typeof taskFn !== 'function') {
      return Promise.reject(new TypeError('taskFn must be a function'));
    }

    let marketKey;
    try {
      marketKey = this._resolveKey(marketKeyOrConfig);
    } catch (err) {
      return Promise.reject(err);
    }

    // Front-gate check at enqueue time
    if (checkState) {
      try {
        this._stateManager.assertReady(marketKey);
      } catch (err) {
        return Promise.reject(err);
      }
    }

    return new Promise((resolve, reject) => {
      let queue = this._queues.get(marketKey);
      if (!queue) {
        queue = {
          marketKey,
          items: [],
          isProcessing: false,
        };
        this._queues.set(marketKey, queue);
      }

      /** @type {QueueItem} */
      const item = {
        taskFn,
        resolve,
        reject,
        checkState,
        enqueuedAt: Date.now(),
      };

      queue.items.push(item);
      this._trackEnqueued(marketKey);

      if (!queue.isProcessing) {
        this._processQueue(queue);
      }
    });
  }

  /**
   * Processes queued items for a specific market sequentially.
   * @private
   * @param {MarketQueueRecord} queue
   */
  async _processQueue(queue) {
    if (queue.isProcessing) {
      return;
    }
    queue.isProcessing = true;
    const marketKey = queue.marketKey;

    try {
      while (queue.items.length > 0) {
        const item = queue.items.shift();

        // Head-of-queue gate check: verify market state right before execution
        if (item.checkState && !this._stateManager.isReady(marketKey)) {
          const currentState = this._stateManager.getState(marketKey);
          this._trackFailed(marketKey);
          item.reject(new MarketNotReadyError(marketKey, currentState));
          continue;
        }

        // Execute task
        try {
          const result = await item.taskFn();
          this._trackProcessed(marketKey);
          item.resolve(result);
        } catch (err) {
          this._trackFailed(marketKey);
          item.reject(err);
        }
      }
    } finally {
      queue.isProcessing = false;

      // Safe queue cleanup: if items were somehow appended before finally or during abnormal exit,
      // re-trigger processing; otherwise remove the idle queue to prevent memory leaks.
      if (queue.items.length > 0) {
        this._processQueue(queue);
      } else {
        this._queues.delete(marketKey);
      }
    }
  }

  /**
   * Enqueues an administrative state transition to run sequentially at its exact
   * FIFO position in the market queue, ensuring all tasks enqueued prior to it complete first.
   *
   * @param {string|Object} marketKeyOrConfig
   * @param {string} targetState
   * @returns {Promise<string>} Resolves to targetState.
   */
  enqueueTransition(marketKeyOrConfig, targetState) {
    const marketKey = this._resolveKey(marketKeyOrConfig);
    return this.execute(
      marketKey,
      () => this._stateManager.transition(marketKey, targetState),
      { checkState: false }
    );
  }

  /**
   * Immediately transitions the market state without queuing.
   * Subsequent or in-flight queued tasks will immediately see the new state.
   *
   * @param {string|Object} marketKeyOrConfig
   * @param {string} targetState
   * @returns {string} The new MarketState.
   */
  transitionMarket(marketKeyOrConfig, targetState) {
    const marketKey = this._resolveKey(marketKeyOrConfig);
    return this._stateManager.transition(marketKey, targetState);
  }

  /**
   * Returns the number of tasks waiting in queue (excluding any actively executing task).
   *
   * @param {string|Object} marketKeyOrConfig
   * @returns {number}
   */
  getPendingCount(marketKeyOrConfig) {
    const marketKey = this._resolveKey(marketKeyOrConfig);
    const queue = this._queues.get(marketKey);
    return queue ? queue.items.length : 0;
  }

  /**
   * Checks whether a task is currently executing for the market.
   *
   * @param {string|Object} marketKeyOrConfig
   * @returns {boolean}
   */
  isProcessing(marketKeyOrConfig) {
    const marketKey = this._resolveKey(marketKeyOrConfig);
    const queue = this._queues.get(marketKey);
    return Boolean(queue && queue.isProcessing);
  }

  /**
   * Returns market keys that currently have active or pending tasks.
   * @returns {string[]}
   */
  getActiveMarketKeys() {
    return Array.from(this._queues.keys());
  }

  /**
   * Returns the count of markets with active or pending queues.
   * @returns {number}
   */
  size() {
    return this._queues.size;
  }

  /**
   * Retrieves diagnostic execution statistics for a market.
   *
   * @param {string|Object} marketKeyOrConfig
   * @returns {{ totalEnqueued: number, totalProcessed: number, totalFailed: number, pendingCount: number, isProcessing: boolean }}
   */
  getStats(marketKeyOrConfig) {
    const marketKey = this._resolveKey(marketKeyOrConfig);
    const s = this._stats.get(marketKey) || { totalEnqueued: 0, totalProcessed: 0, totalFailed: 0 };
    return {
      ...s,
      pendingCount: this.getPendingCount(marketKey),
      isProcessing: this.isProcessing(marketKey),
    };
  }

  /**
   * Resets all queues and stats. Intended for testing only.
   */
  reset() {
    this._queues.clear();
    this._stats.clear();
    this._stateManager.reset();
  }
}
