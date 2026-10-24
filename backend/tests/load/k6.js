/**
 * PassFlow k6 Load Test Suite Entry Point
 * Re-exports the full realistic trading performance test suite from k6-trading-performance.js
 */
export {
  options,
  setup,
  readTrafficScenario,
  tradingTrafficScenario,
  teardown,
  default,
} from './k6-trading-performance.js';
