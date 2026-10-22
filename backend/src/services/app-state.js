/**
 * Application Lifecycle & Readiness State
 *
 * Tracks whether backend startup sequencing (database verification, settlement recovery,
 * matching coordinator readiness, recovery worker launch) has completed successfully,
 * and whether graceful shutdown has been initiated.
 */
class AppLifecycleState {
  constructor() {
    this._isInitialized = false;
    this._isShuttingDown = false;
    this._startupError = null;
  }

  isInitialized() {
    return this._isInitialized;
  }

  setInitialized(val = true) {
    this._isInitialized = Boolean(val);
  }

  isShuttingDown() {
    return this._isShuttingDown;
  }

  setShuttingDown(val = true) {
    this._isShuttingDown = Boolean(val);
  }

  getStartupError() {
    return this._startupError;
  }

  setStartupError(err) {
    this._startupError = err;
  }

  reset() {
    this._isInitialized = false;
    this._isShuttingDown = false;
    this._startupError = null;
  }
}

export const appLifecycleState = new AppLifecycleState();
export default appLifecycleState;
