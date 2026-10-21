/**
 * Market Lifecycle States and State Gating Manager
 *
 * Defines explicit market states, valid state transitions, collision-free
 * market key encoding, and typed error handling for the PassFlow matching engine.
 */

/**
 * Permitted market lifecycle states.
 * @readonly
 * @enum {string}
 */
export const MarketState = Object.freeze({
  INITIALIZING: 'INITIALIZING',
  READY: 'READY',
  RECONCILING: 'RECONCILING',
  PAUSED: 'PAUSED',
});

/**
 * Base error for market state violations.
 */
export class MarketStateError extends Error {
  /**
   * @param {string} message
   * @param {Object} [details]
   * @param {string} [details.marketKey]
   * @param {string} [details.currentState]
   * @param {string} [details.targetState]
   * @param {string} [details.code]
   */
  constructor(message, { marketKey, currentState, targetState, code } = {}) {
    super(message);
    this.name = 'MarketStateError';
    this.marketKey = marketKey;
    this.currentState = currentState;
    this.targetState = targetState;
    this.code = code || 'MARKET_STATE_ERROR';
  }
}

/**
 * Typed error thrown when an operation requires the market to be READY,
 * but the market is in another lifecycle state (INITIALIZING, RECONCILING, or PAUSED).
 */
export class MarketNotReadyError extends MarketStateError {
  /**
   * @param {string} marketKey
   * @param {string} currentState
   */
  constructor(marketKey, currentState) {
    super(
      `Market "${marketKey}" is not ready for mutations (current state: ${currentState})`,
      {
        marketKey,
        currentState,
        code: `MARKET_${currentState}`,
      }
    );
    this.name = 'MarketNotReadyError';
  }
}

/**
 * Typed error thrown when an illegal market state transition is attempted.
 */
export class InvalidMarketStateTransitionError extends MarketStateError {
  /**
   * @param {string} marketKey
   * @param {string} currentState
   * @param {string} targetState
   */
  constructor(marketKey, currentState, targetState) {
    super(
      `Invalid market state transition for "${marketKey}": cannot transition from ${currentState} to ${targetState}`,
      {
        marketKey,
        currentState,
        targetState,
        code: 'INVALID_MARKET_STATE_TRANSITION',
      }
    );
    this.name = 'InvalidMarketStateTransitionError';
  }
}

/**
 * Strict table of permitted state transitions.
 * Self-transitions are disallowed to prevent redundant or silent state drift.
 *
 * - INITIALIZING -> READY, PAUSED
 * - READY        -> PAUSED, RECONCILING
 * - PAUSED       -> READY, RECONCILING
 * - RECONCILING  -> READY, PAUSED
 */
const VALID_TRANSITIONS = Object.freeze({
  [MarketState.INITIALIZING]: Object.freeze(new Set([MarketState.READY, MarketState.PAUSED])),
  [MarketState.READY]: Object.freeze(new Set([MarketState.PAUSED, MarketState.RECONCILING])),
  [MarketState.PAUSED]: Object.freeze(new Set([MarketState.READY, MarketState.RECONCILING])),
  [MarketState.RECONCILING]: Object.freeze(new Set([MarketState.READY, MarketState.PAUSED])),
});

/**
 * Encodes an (eventId, ticketCategoryId) pair into a deterministic, collision-proof string key.
 *
 * Uses explicit length-prefixing `${eventId.length}:${eventId}:${ticketCategoryId.length}:${ticketCategoryId}`
 * so that IDs containing delimiters (e.g. colons, slashes, whitespace) cannot collide with
 * different ID combinations.
 *
 * @param {string|{eventId: string, ticketCategoryId: string}} eventIdOrConfig
 * @param {string} [maybeTicketCategoryId]
 * @returns {string} Length-prefixed market key.
 * @throws {TypeError} If parameters are not strings or valid objects.
 * @throws {RangeError} If identifiers are empty or whitespace.
 */
export function formatMarketKey(eventIdOrConfig, maybeTicketCategoryId) {
  let eventId;
  let ticketCategoryId;

  if (typeof eventIdOrConfig === 'object' && eventIdOrConfig !== null) {
    eventId = eventIdOrConfig.eventId;
    ticketCategoryId = eventIdOrConfig.ticketCategoryId;
  } else {
    eventId = eventIdOrConfig;
    ticketCategoryId = maybeTicketCategoryId;
  }

  if (typeof eventId !== 'string') {
    throw new TypeError('eventId must be a string');
  }
  if (eventId.trim().length === 0) {
    throw new RangeError('eventId must be a non-empty string');
  }
  if (typeof ticketCategoryId !== 'string') {
    throw new TypeError('ticketCategoryId must be a string');
  }
  if (ticketCategoryId.trim().length === 0) {
    throw new RangeError('ticketCategoryId must be a non-empty string');
  }

  return `${eventId.length}:${eventId}:${ticketCategoryId.length}:${ticketCategoryId}`;
}

/**
 * Decodes a length-prefixed market key back into its original eventId and ticketCategoryId.
 *
 * @param {string} marketKey
 * @returns {{ eventId: string, ticketCategoryId: string }}
 * @throws {TypeError|RangeError} If the format or length prefixes do not match.
 */
export function parseMarketKey(marketKey) {
  if (typeof marketKey !== 'string') {
    throw new TypeError('marketKey must be a string');
  }

  const firstColon = marketKey.indexOf(':');
  if (firstColon <= 0) {
    throw new RangeError(`Invalid market key format: "${marketKey}"`);
  }

  const len1 = parseInt(marketKey.slice(0, firstColon), 10);
  if (Number.isNaN(len1) || len1 < 0) {
    throw new RangeError(`Invalid eventId length prefix in market key: "${marketKey}"`);
  }

  const start1 = firstColon + 1;
  const end1 = start1 + len1;
  if (end1 >= marketKey.length || marketKey.charAt(end1) !== ':') {
    throw new RangeError(`Malformed delimiter after eventId in market key: "${marketKey}"`);
  }

  const eventId = marketKey.slice(start1, end1);
  const secondPart = marketKey.slice(end1 + 1);
  const secondColon = secondPart.indexOf(':');
  if (secondColon <= 0) {
    throw new RangeError(`Invalid ticketCategoryId length prefix in market key: "${marketKey}"`);
  }

  const len2 = parseInt(secondPart.slice(0, secondColon), 10);
  if (Number.isNaN(len2) || len2 < 0) {
    throw new RangeError(`Invalid ticketCategoryId length prefix in market key: "${marketKey}"`);
  }

  const start2 = secondColon + 1;
  const end2 = start2 + len2;
  if (secondPart.length !== end2) {
    throw new RangeError(`Trailing or mismatched data in market key: "${marketKey}"`);
  }

  const ticketCategoryId = secondPart.slice(start2, end2);
  return { eventId, ticketCategoryId };
}

/**
 * In-memory manager for market lifecycle states.
 *
 * Tracks the state of each market and validates state transitions.
 * Guarantees that markets begin in INITIALIZING and are never silently
 * transitioned or reset.
 */
export class MarketStateManager {
  constructor() {
    /** @type {Map<string, string>} */
    this._states = new Map();
  }

  /**
   * Resolves a marketKey from string or config object.
   * @private
   * @param {string|Object} marketKeyOrConfig
   * @returns {string}
   */
  _resolveKey(marketKeyOrConfig) {
    if (typeof marketKeyOrConfig === 'string') {
      // Validate or format if colon-separated
      return marketKeyOrConfig;
    }
    return formatMarketKey(marketKeyOrConfig);
  }

  /**
   * Registers a market with an initial state.
   *
   * @param {string|Object} marketKeyOrConfig
   * @param {string} [initialState=MarketState.INITIALIZING]
   * @returns {string} The registered state.
   * @throws {TypeError} If initialState is invalid.
   */
  registerMarket(marketKeyOrConfig, initialState = MarketState.INITIALIZING) {
    const marketKey = this._resolveKey(marketKeyOrConfig);
    if (!Object.values(MarketState).includes(initialState)) {
      throw new TypeError(`Invalid initial MarketState: "${initialState}"`);
    }

    if (!this._states.has(marketKey)) {
      this._states.set(marketKey, initialState);
    }
    return this._states.get(marketKey);
  }

  /**
   * Checks whether a market has been registered with the state manager.
   *
   * @param {string|Object} marketKeyOrConfig
   * @returns {boolean}
   */
  hasMarket(marketKeyOrConfig) {
    const marketKey = this._resolveKey(marketKeyOrConfig);
    return this._states.has(marketKey);
  }

  /**
   * Retrieves the current state of a market.
   * Unregistered markets default to INITIALIZING (not ready for mutations).
   *
   * @param {string|Object} marketKeyOrConfig
   * @returns {string} The current MarketState.
   */
  getState(marketKeyOrConfig) {
    const marketKey = this._resolveKey(marketKeyOrConfig);
    return this._states.get(marketKey) || MarketState.INITIALIZING;
  }

  /**
   * Checks whether a market is in READY state.
   *
   * @param {string|Object} marketKeyOrConfig
   * @returns {boolean} True if and only if the market state is READY.
   */
  isReady(marketKeyOrConfig) {
    return this.getState(marketKeyOrConfig) === MarketState.READY;
  }

  /**
   * Asserts that a market is in READY state.
   *
   * @param {string|Object} marketKeyOrConfig
   * @throws {MarketNotReadyError} If the market state is not READY.
   */
  assertReady(marketKeyOrConfig) {
    const marketKey = this._resolveKey(marketKeyOrConfig);
    const state = this.getState(marketKey);
    if (state !== MarketState.READY) {
      throw new MarketNotReadyError(marketKey, state);
    }
  }

  /**
   * Transitions a market to a target state following the state transition table.
   *
   * @param {string|Object} marketKeyOrConfig
   * @param {string} targetState
   * @returns {string} The new MarketState.
   * @throws {InvalidMarketStateTransitionError} If the transition is disallowed.
   * @throws {TypeError} If targetState is not a valid MarketState.
   */
  transition(marketKeyOrConfig, targetState) {
    const marketKey = this._resolveKey(marketKeyOrConfig);
    if (!Object.values(MarketState).includes(targetState)) {
      throw new TypeError(`Invalid target MarketState: "${targetState}"`);
    }

    const currentState = this.getState(marketKey);
    const allowed = VALID_TRANSITIONS[currentState];

    if (!allowed || !allowed.has(targetState)) {
      throw new InvalidMarketStateTransitionError(marketKey, currentState, targetState);
    }

    this._states.set(marketKey, targetState);
    return targetState;
  }

  /**
   * Returns a list of all currently tracked market keys.
   * @returns {string[]}
   */
  getRegisteredMarkets() {
    return Array.from(this._states.keys());
  }

  /**
   * Clears all registered market states. Intended for testing only.
   */
  reset() {
    this._states.clear();
  }
}
