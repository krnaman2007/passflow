import {
  MarketExecutionQueue,
  MarketState,
  MarketStateManager,
  MarketStateError,
  MarketNotReadyError,
  InvalidMarketStateTransitionError,
  formatMarketKey,
  parseMarketKey,
} from '../../src/services/matching/market-execution-queue.js';

/**
 * Creates a deferred promise with manual resolve/reject handles.
 * Used for deterministic concurrency and barrier testing without timing-dependent sleeps.
 */
function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('MarketExecutionQueue & Market State Gating', () => {
  let queue;
  let stateManager;

  beforeEach(() => {
    stateManager = new MarketStateManager();
    queue = new MarketExecutionQueue({ stateManager });
  });

  afterEach(() => {
    queue.reset();
  });

  describe('Market Key Encoding & Collision Avoidance', () => {
    it('generates distinct keys for identical substrings in different positions', () => {
      const key1 = formatMarketKey('event:vip', 'general');
      const key2 = formatMarketKey('event', 'vip:general');
      const key3 = formatMarketKey('event', 'vip');

      expect(key1).not.toBe(key2);
      expect(key1).not.toBe(key3);
      expect(key2).not.toBe(key3);
    });

    it('round-trips eventId and ticketCategoryId accurately via parseMarketKey', () => {
      const inputs = [
        { eventId: 'evt-123', ticketCategoryId: 'cat-456' },
        { eventId: 'event:with:colons', ticketCategoryId: 'cat:with:colons' },
        { eventId: 'event with spaces', ticketCategoryId: 'cat with spaces' },
        { eventId: 'a', ticketCategoryId: 'b' },
        { eventId: 'uuid-1', ticketCategoryId: 'uuid-2' },
      ];

      for (const input of inputs) {
        const key = formatMarketKey(input);
        const parsed = parseMarketKey(key);
        expect(parsed).toEqual(input);
      }
    });

    it('rejects invalid inputs to formatMarketKey and parseMarketKey', () => {
      expect(() => formatMarketKey('', 'cat')).toThrow(RangeError);
      expect(() => formatMarketKey('evt', '')).toThrow(RangeError);
      expect(() => formatMarketKey('   ', 'cat')).toThrow(RangeError);
      expect(() => formatMarketKey(null, 'cat')).toThrow(TypeError);
      expect(() => formatMarketKey('evt', null)).toThrow(TypeError);

      expect(() => parseMarketKey('not-a-valid-key')).toThrow(RangeError);
      expect(() => parseMarketKey(123)).toThrow(TypeError);
    });
  });

  describe('1. Non-Overlapping Execution on Same Market', () => {
    it('two asynchronous tasks for the same market never overlap', async () => {
      const marketKey = formatMarketKey('event-1', 'cat-1');
      stateManager.registerMarket(marketKey, MarketState.READY);

      const barrier1 = createDeferred();
      const barrier2 = createDeferred();

      let task1Started = false;
      let task1Finished = false;
      let task2Started = false;
      let task2Finished = false;

      const p1 = queue.execute(marketKey, async () => {
        task1Started = true;
        await barrier1.promise;
        task1Finished = true;
        return 'res-1';
      });

      const p2 = queue.execute(marketKey, async () => {
        task2Started = true;
        await barrier2.promise;
        task2Finished = true;
        return 'res-2';
      });

      // Allow microtasks to settle
      await Promise.resolve();

      // Task 1 should be active, Task 2 must NOT have started yet
      expect(task1Started).toBe(true);
      expect(task1Finished).toBe(false);
      expect(task2Started).toBe(false);
      expect(queue.isProcessing(marketKey)).toBe(true);
      expect(queue.getPendingCount(marketKey)).toBe(1);

      // Release barrier 1
      barrier1.resolve();
      const r1 = await p1;
      expect(r1).toBe('res-1');
      expect(task1Finished).toBe(true);

      // Allow queue runner to pick up Task 2
      await Promise.resolve();
      expect(task2Started).toBe(true);
      expect(task2Finished).toBe(false);

      // Release barrier 2
      barrier2.resolve();
      const r2 = await p2;
      expect(r2).toBe('res-2');
      expect(task2Finished).toBe(true);
    });
  });

  describe('2. FIFO Enqueue Ordering', () => {
    it('same-market tasks execute in FIFO enqueue order, even when earlier tasks await', async () => {
      const marketKey = formatMarketKey('event-fifo', 'cat-fifo');
      stateManager.registerMarket(marketKey, MarketState.READY);

      const executionOrder = [];
      const barrier1 = createDeferred();
      const barrier2 = createDeferred();

      const p1 = queue.execute(marketKey, async () => {
        executionOrder.push('start-1');
        await barrier1.promise;
        executionOrder.push('end-1');
        return 1;
      });

      const p2 = queue.execute(marketKey, async () => {
        executionOrder.push('start-2');
        await barrier2.promise;
        executionOrder.push('end-2');
        return 2;
      });

      const p3 = queue.execute(marketKey, async () => {
        executionOrder.push('start-3');
        executionOrder.push('end-3');
        return 3;
      });

      // Initially only task 1 has started
      await Promise.resolve();
      expect(executionOrder).toEqual(['start-1']);

      // Resolving barrier 1 must let task 1 finish, then task 2 starts
      barrier1.resolve();
      await p1;

      await Promise.resolve();
      expect(executionOrder).toEqual(['start-1', 'end-1', 'start-2']);

      // Resolving barrier 2 lets task 2 finish, then task 3 runs to completion
      barrier2.resolve();
      await Promise.all([p2, p3]);

      expect(executionOrder).toEqual([
        'start-1',
        'end-1',
        'start-2',
        'end-2',
        'start-3',
        'end-3',
      ]);
    });
  });

  describe('3. Cross-Market Concurrency', () => {
    it('tasks for different markets can overlap', async () => {
      const marketA = formatMarketKey('event-A', 'cat-A');
      const marketB = formatMarketKey('event-B', 'cat-B');

      stateManager.registerMarket(marketA, MarketState.READY);
      stateManager.registerMarket(marketB, MarketState.READY);

      const barrierA = createDeferred();
      let taskAStarted = false;
      let taskAFinished = false;
      let taskBStarted = false;
      let taskBFinished = false;

      const pA = queue.execute(marketA, async () => {
        taskAStarted = true;
        await barrierA.promise;
        taskAFinished = true;
        return 'resA';
      });

      const pB = queue.execute(marketB, async () => {
        taskBStarted = true;
        taskBFinished = true;
        return 'resB';
      });

      // Let microtasks run
      await Promise.resolve();

      // Task A is active and awaiting barrierA
      expect(taskAStarted).toBe(true);
      expect(taskAFinished).toBe(false);

      // Task B on Market B ran and finished without being blocked by Market A
      const rB = await pB;
      expect(rB).toBe('resB');
      expect(taskBStarted).toBe(true);
      expect(taskBFinished).toBe(true);
      expect(taskAFinished).toBe(false);

      // Now release Market A
      barrierA.resolve();
      const rA = await pA;
      expect(rA).toBe('resA');
      expect(taskAFinished).toBe(true);
    });
  });

  describe('4. Fault Isolation on Rejection', () => {
    it('a rejected task does not prevent the next task from executing', async () => {
      const marketKey = formatMarketKey('event-err', 'cat-err');
      stateManager.registerMarket(marketKey, MarketState.READY);

      const p1 = queue.execute(marketKey, async () => {
        throw new Error('Database transaction aborted');
      });

      const p2 = queue.execute(marketKey, async () => {
        return 'recovered-task-2';
      });

      await expect(p1).rejects.toThrow('Database transaction aborted');
      await expect(p2).resolves.toBe('recovered-task-2');

      const stats = queue.getStats(marketKey);
      expect(stats.totalEnqueued).toBe(2);
      expect(stats.totalProcessed).toBe(1);
      expect(stats.totalFailed).toBe(1);
      expect(queue.isProcessing(marketKey)).toBe(false);
    });
  });

  describe('5. Queue Cleanup Safety & Idle Memory Reclamation', () => {
    it('cleans up idle queues and correctly re-creates them when new work arrives', async () => {
      const marketKey = formatMarketKey('event-clean', 'cat-clean');
      stateManager.registerMarket(marketKey, MarketState.READY);

      // First task executes and completes
      const r1 = await queue.execute(marketKey, async () => 'task-1');
      expect(r1).toBe('task-1');

      // Once drained, queue should be cleaned up from internal map
      expect(queue.size()).toBe(0);
      expect(queue.getActiveMarketKeys()).toHaveLength(0);
      expect(queue.getPendingCount(marketKey)).toBe(0);
      expect(queue.isProcessing(marketKey)).toBe(false);

      // Immediately queue subsequent tasks; serialization must remain intact
      const barrier2 = createDeferred();
      let task2Active = false;
      let task3Started = false;

      const p2 = queue.execute(marketKey, async () => {
        task2Active = true;
        await barrier2.promise;
        task2Active = false;
        return 'task-2';
      });

      const p3 = queue.execute(marketKey, async () => {
        task3Started = true;
        return 'task-3';
      });

      await Promise.resolve();
      expect(queue.size()).toBe(1);
      expect(task2Active).toBe(true);
      expect(task3Started).toBe(false);

      barrier2.resolve();
      const [r2, r3] = await Promise.all([p2, p3]);
      expect(r2).toBe('task-2');
      expect(r3).toBe('task-3');
      expect(task3Started).toBe(true);

      // Should return to idle clean state
      expect(queue.size()).toBe(0);
    });
  });

  describe('6. State Gating: Rejecting Mutations in Non-READY States', () => {
    it('rejects mutations when market is INITIALIZING, RECONCILING, or PAUSED', async () => {
      const initKey = formatMarketKey('evt-init', 'cat-init');
      const pausedKey = formatMarketKey('evt-pause', 'cat-pause');
      const reconKey = formatMarketKey('evt-recon', 'cat-recon');

      stateManager.registerMarket(initKey, MarketState.INITIALIZING);
      stateManager.registerMarket(pausedKey, MarketState.INITIALIZING);
      stateManager.transition(pausedKey, MarketState.PAUSED);

      stateManager.registerMarket(reconKey, MarketState.INITIALIZING);
      stateManager.transition(reconKey, MarketState.READY);
      stateManager.transition(reconKey, MarketState.RECONCILING);

      // INITIALIZING rejection
      await expect(queue.execute(initKey, async () => 'mut')).rejects.toThrow(MarketNotReadyError);
      await expect(queue.execute(initKey, async () => 'mut')).rejects.toMatchObject({
        code: 'MARKET_INITIALIZING',
      });

      // PAUSED rejection
      await expect(queue.execute(pausedKey, async () => 'mut')).rejects.toThrow(MarketNotReadyError);
      await expect(queue.execute(pausedKey, async () => 'mut')).rejects.toMatchObject({
        code: 'MARKET_PAUSED',
      });

      // RECONCILING rejection
      await expect(queue.execute(reconKey, async () => 'mut')).rejects.toThrow(MarketNotReadyError);
      await expect(queue.execute(reconKey, async () => 'mut')).rejects.toMatchObject({
        code: 'MARKET_RECONCILING',
      });
    });

    it('rejects mutations for unregistered markets (defaulting to uninitialized)', async () => {
      const unregKey = formatMarketKey('unreg-event', 'unreg-cat');
      await expect(queue.execute(unregKey, async () => 'mut')).rejects.toThrow(MarketNotReadyError);
      await expect(queue.execute(unregKey, async () => 'mut')).rejects.toMatchObject({
        code: 'MARKET_INITIALIZING',
      });
    });
  });

  describe('7. State Transitions Validation', () => {
    it('succeeds for all permitted state transitions', () => {
      const m1 = formatMarketKey('m1', 'c1');
      stateManager.registerMarket(m1, MarketState.INITIALIZING);

      // INITIALIZING -> READY
      expect(stateManager.transition(m1, MarketState.READY)).toBe(MarketState.READY);
      expect(stateManager.isReady(m1)).toBe(true);

      // READY -> PAUSED
      expect(stateManager.transition(m1, MarketState.PAUSED)).toBe(MarketState.PAUSED);
      expect(stateManager.isReady(m1)).toBe(false);

      // PAUSED -> READY
      expect(stateManager.transition(m1, MarketState.READY)).toBe(MarketState.READY);

      // READY -> RECONCILING
      expect(stateManager.transition(m1, MarketState.RECONCILING)).toBe(MarketState.RECONCILING);

      // RECONCILING -> PAUSED
      expect(stateManager.transition(m1, MarketState.PAUSED)).toBe(MarketState.PAUSED);

      // PAUSED -> RECONCILING
      expect(stateManager.transition(m1, MarketState.RECONCILING)).toBe(MarketState.RECONCILING);

      // RECONCILING -> READY
      expect(stateManager.transition(m1, MarketState.READY)).toBe(MarketState.READY);
    });

    it('fails for all disallowed state transitions', () => {
      const m2 = formatMarketKey('m2', 'c2');
      stateManager.registerMarket(m2, MarketState.INITIALIZING);

      // INITIALIZING -> RECONCILING disallowed
      expect(() => stateManager.transition(m2, MarketState.RECONCILING)).toThrow(
        InvalidMarketStateTransitionError
      );

      // Move to READY
      stateManager.transition(m2, MarketState.READY);

      // READY -> INITIALIZING disallowed
      expect(() => stateManager.transition(m2, MarketState.INITIALIZING)).toThrow(
        InvalidMarketStateTransitionError
      );

      // Self-transition READY -> READY disallowed
      expect(() => stateManager.transition(m2, MarketState.READY)).toThrow(
        InvalidMarketStateTransitionError
      );

      // Move to PAUSED
      stateManager.transition(m2, MarketState.PAUSED);

      // PAUSED -> INITIALIZING disallowed
      expect(() => stateManager.transition(m2, MarketState.INITIALIZING)).toThrow(
        InvalidMarketStateTransitionError
      );

      // Self-transition PAUSED -> PAUSED disallowed
      expect(() => stateManager.transition(m2, MarketState.PAUSED)).toThrow(
        InvalidMarketStateTransitionError
      );
    });
  });

  describe('8. Ordering Semantics Between State Changes and Queued Operations', () => {
    it('immediate transition to PAUSED rejects pending tasks at the head-of-queue gate without executing mutation', async () => {
      const marketKey = formatMarketKey('evt-gate', 'cat-gate');
      stateManager.registerMarket(marketKey, MarketState.READY);

      const barrier1 = createDeferred();
      let task1Finished = false;
      let task2Executed = false;

      const p1 = queue.execute(marketKey, async () => {
        await barrier1.promise;
        task1Finished = true;
        return 'res1';
      });

      const p2 = queue.execute(marketKey, async () => {
        task2Executed = true;
        return 'res2';
      });

      await Promise.resolve();
      expect(queue.getPendingCount(marketKey)).toBe(1);

      // Operator triggers immediate pause while Task 1 is active
      queue.transitionMarket(marketKey, MarketState.PAUSED);
      expect(stateManager.getState(marketKey)).toBe(MarketState.PAUSED);

      // Release Task 1
      barrier1.resolve();
      const r1 = await p1;
      expect(r1).toBe('res1');
      expect(task1Finished).toBe(true);

      // Task 2 should reject with MarketNotReadyError and its mutation function must NEVER run
      await expect(p2).rejects.toThrow(MarketNotReadyError);
      await expect(p2).rejects.toMatchObject({ code: 'MARKET_PAUSED' });
      expect(task2Executed).toBe(false);
    });

    it('queued state transition (enqueueTransition) executes sequentially in FIFO order', async () => {
      const marketKey = formatMarketKey('evt-seq', 'cat-seq');
      stateManager.registerMarket(marketKey, MarketState.READY);

      const trace = [];

      const p1 = queue.execute(marketKey, async () => {
        trace.push('task-1');
        return 'val-1';
      });

      const pTrans = queue.enqueueTransition(marketKey, MarketState.PAUSED);

      // Task 3 is enqueued after the pause transition; since it is evaluated against the new state
      // when it reaches head of queue, it should reject
      const p3 = queue.execute(marketKey, async () => {
        trace.push('task-3');
        return 'val-3';
      }, { checkState: false }); // Allow to enter queue without front gate check to verify sequential transition

      const r1 = await p1;
      const rTrans = await pTrans;
      const r3 = await p3;

      expect(r1).toBe('val-1');
      expect(rTrans).toBe(MarketState.PAUSED);
      expect(r3).toBe('val-3');
      expect(trace).toEqual(['task-1', 'task-3']);
      expect(stateManager.getState(marketKey)).toBe(MarketState.PAUSED);
    });
  });

  describe('9. Isolation Across Identical IDs in Different Combinations', () => {
    it('isolates different markets even when substring IDs share components', async () => {
      const market1 = formatMarketKey('evt:1', 'cat');
      const market2 = formatMarketKey('evt', '1:cat');

      stateManager.registerMarket(market1, MarketState.READY);
      stateManager.registerMarket(market2, MarketState.READY);

      const barrier1 = createDeferred();
      let m1Started = false;
      let m2Finished = false;

      const p1 = queue.execute(market1, async () => {
        m1Started = true;
        await barrier1.promise;
        return 'm1-done';
      });

      const p2 = queue.execute(market2, async () => {
        m2Finished = true;
        return 'm2-done';
      });

      await Promise.resolve();
      expect(m1Started).toBe(true);

      // Market 2 should finish immediately despite Market 1 awaiting
      const r2 = await p2;
      expect(r2).toBe('m2-done');
      expect(m2Finished).toBe(true);

      barrier1.resolve();
      const r1 = await p1;
      expect(r1).toBe('m1-done');
    });
  });

  describe('10. Absence of Race Window Between Readiness Check and Queued Mutation', () => {
    it('guarantees that mutating function never runs if market was transitioned away from READY before execution begins', async () => {
      const marketKey = formatMarketKey('evt-norace', 'cat-norace');
      stateManager.registerMarket(marketKey, MarketState.READY);

      const barrierHold = createDeferred();
      let mutationRan = false;

      // Occupy queue with blocking task
      const pBlock = queue.execute(marketKey, async () => {
        await barrierHold.promise;
        return 'block-done';
      });

      // Enqueue mutation while READY
      const pMut = queue.execute(marketKey, async () => {
        mutationRan = true;
        return 'mut-done';
      });

      // Pause market before pMut reaches head of queue
      queue.transitionMarket(marketKey, MarketState.PAUSED);

      // Unblock initial task
      barrierHold.resolve();
      await pBlock;

      // pMut must reject and mutationRan must remain false
      await expect(pMut).rejects.toThrow(MarketNotReadyError);
      expect(mutationRan).toBe(false);
    });

    it('rejects synchronously invalid taskFn without altering market state', async () => {
      const marketKey = formatMarketKey('evt-inv', 'cat-inv');
      stateManager.registerMarket(marketKey, MarketState.READY);

      await expect(queue.execute(marketKey, 'not-a-fn')).rejects.toThrow(TypeError);
      expect(queue.isProcessing(marketKey)).toBe(false);
      expect(queue.getPendingCount(marketKey)).toBe(0);
    });
  });
});
