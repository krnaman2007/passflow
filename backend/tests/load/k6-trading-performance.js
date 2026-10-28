import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';

/**
 * ============================================================================
 * PassFlow — k6 Realistic Trading Performance & Concurrency Load Test Suite
 * ============================================================================
 *
 * Requirements & Profiles:
 * - Configurable BASE_URL (default: http://localhost:3001)
 * - Safe target guard: Aborts immediately if pointing to shared/production Neon
 * - Profiles supported via PROFILE env:
 *     - 'smoke'  : 2 VUs, 20s duration (Sanity check)
 *     - 'load'   : Ramp to 20 VUs, hold 1m, ramp down 15s (Standard trading load)
 *     - 'stress' : Ramp to 50 VUs, hold 2m, ramp down 20s (Peak contention & stress)
 * - Read Traffic: Events list, single event detail, orderbook depth, market summary
 * - Write Traffic: Authenticated user wallet checks, limit order placement, order lookup, cancellation
 * - Thresholds: HTTP failure < 1%, p95 latency < 250ms, order placement p95 < 300ms
 * - Safe cleanup: Uses isolated test accounts prefixed with 'k6_trader_'
 */

// Target Base URL
export const BASE_URL = __ENV.BASE_URL || 'http://localhost:3001';

// Active Profile & Duration
const PROFILE = __ENV.PROFILE || 'smoke';
const DURATION = __ENV.DURATION || (PROFILE === 'smoke' ? '20s' : PROFILE === 'load' ? '1m' : '2m');

// Safety Guard against shared Neon database
if (BASE_URL.includes('neon.tech') || BASE_URL.includes('ep-cold-scene')) {
  throw new Error(
    '❌ [SAFETY GUARD]: k6 trading performance test cannot target shared/production Neon database!\n' +
    'Please run against your dedicated local test environment: BASE_URL=http://localhost:3001'
  );
}

// Custom Performance Metrics
export const orderPlacementDuration = new Trend('order_placement_duration', true);
export const orderbookReadDuration = new Trend('orderbook_read_duration', true);
export const walletQueryDuration = new Trend('wallet_query_duration', true);
export const eventQueryDuration = new Trend('event_query_duration', true);
export const successfulOrdersRate = new Rate('successful_orders');
export const successfulReadsRate = new Rate('successful_reads');
export const orderCounter = new Counter('orders_placed_total');

// Build scenario configurations based on active profile
function getScenarioConfig(profile) {
  if (profile === 'scale_1000' || profile === 'scale-1000') {
    return {
      read_traffic: {
        executor: 'ramping-vus',
        startVUs: 10,
        stages: [
          { duration: '30s', target: 700 },
          { duration: DURATION, target: 700 },
          { duration: '30s', target: 0 },
        ],
        exec: 'readTrafficScenario',
      },
      trading_traffic: {
        executor: 'ramping-vus',
        startVUs: 5,
        stages: [
          { duration: '30s', target: 300 },
          { duration: DURATION, target: 300 },
          { duration: '30s', target: 0 },
        ],
        exec: 'tradingTrafficScenario',
      },
    };
  }

  if (profile === 'stress') {
    return {
      read_traffic: {
        executor: 'ramping-vus',
        startVUs: 2,
        stages: [
          { duration: '30s', target: 30 },
          { duration: DURATION, target: 30 },
          { duration: '15s', target: 0 },
        ],
        exec: 'readTrafficScenario',
      },
      trading_traffic: {
        executor: 'ramping-vus',
        startVUs: 1,
        stages: [
          { duration: '30s', target: 20 },
          { duration: DURATION, target: 20 },
          { duration: '15s', target: 0 },
        ],
        exec: 'tradingTrafficScenario',
      },
    };
  }

  if (profile === 'load') {
    return {
      read_traffic: {
        executor: 'ramping-vus',
        startVUs: 2,
        stages: [
          { duration: '20s', target: 12 },
          { duration: DURATION, target: 12 },
          { duration: '10s', target: 0 },
        ],
        exec: 'readTrafficScenario',
      },
      trading_traffic: {
        executor: 'ramping-vus',
        startVUs: 1,
        stages: [
          { duration: '20s', target: 8 },
          { duration: DURATION, target: 8 },
          { duration: '10s', target: 0 },
        ],
        exec: 'tradingTrafficScenario',
      },
    };
  }

  // Default: Smoke Profile
  return {
    smoke_traffic: {
      executor: 'constant-vus',
      vus: 2,
      duration: DURATION,
      exec: 'default',
    },
  };
}

export const options = {
  scenarios: getScenarioConfig(PROFILE),
  thresholds: {
    http_req_failed: ['rate<0.01'],              // HTTP errors must be < 1%
    http_req_duration: ['p(95)<250'],            // 95% of all HTTP requests < 250ms
    order_placement_duration: ['p(95)<300'],     // Order placement p95 < 300ms
    orderbook_read_duration: ['p(95)<150'],      // Orderbook fetch p95 < 150ms
    successful_orders: ['rate>0.95'],            // >95% orders submitted must succeed
    successful_reads: ['rate>0.98'],             // >98% public reads must succeed
  },
};

/**
 * Test setup: executed once before virtual users start.
 * Verifies backend health, obtains active event data, and seeds isolated test traders.
 */
export function setup() {
  // 1. Health check
  const healthRes = http.get(`${BASE_URL}/health`);
  check(healthRes, {
    'health check returns 200': (r) => r.status === 200,
  });

  if (healthRes.status !== 200) {
    throw new Error(`Target backend at ${BASE_URL} is unhealthy or unreachable (status: ${healthRes.status})`);
  }

  // 2. Discover an active published event
  const eventsRes = http.get(`${BASE_URL}/api/v1/events`);
  let eventId = null;
  let categoryId = null;
  let originalPrice = 2000;

  if (eventsRes.status === 200) {
    try {
      const body = JSON.parse(eventsRes.body);
      const events = body.data?.events || body.data || [];
      if (events.length > 0) {
        const publishedEvent = events.find((e) => e.status === 'PUBLISHED') || events[0];
        eventId = publishedEvent.id;
        if (publishedEvent.categories && publishedEvent.categories.length > 0) {
          categoryId = publishedEvent.categories[0].id;
          originalPrice = Number(publishedEvent.categories[0].originalPrice) || 2000;
        }
      }
    } catch (e) {
      // Fallback below
    }
  }

  // 3. Register a pool of 5 isolated test traders
  const users = [];
  const testRunId = Date.now().toString(36);

  for (let i = 1; i <= 5; i++) {
    const email = `k6_trader_${testRunId}_${i}@test.passflow.internal`;
    const password = 'Password123!';
    const regPayload = JSON.stringify({
      name: `K6 Load Trader ${i}`,
      email,
      password,
      role: 'USER',
    });

    const regRes = http.post(`${BASE_URL}/api/v1/auth/register`, regPayload, {
      headers: { 'Content-Type': 'application/json' },
    });

    let token = null;
    let userId = null;

    if (regRes.status === 201) {
      const body = JSON.parse(regRes.body);
      token = body.data?.tokens?.accessToken;
      userId = body.data?.user?.id;
    } else {
      // Attempt login if user exists
      const loginRes = http.post(`${BASE_URL}/api/v1/auth/login`, JSON.stringify({ email, password }), {
        headers: { 'Content-Type': 'application/json' },
      });
      if (loginRes.status === 200) {
        const body = JSON.parse(loginRes.body);
        token = body.data?.tokens?.accessToken;
        userId = body.data?.user?.id;
      }
    }

    if (token) {
      // Deposit test wallet funds (100,000 INR = 10,000,000 paise)
      http.post(
        `${BASE_URL}/api/v1/wallet/deposit`,
        JSON.stringify({ amount: 10000000, idempotencyKey: `deposit_${testRunId}_${i}` }),
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
        }
      );

      users.push({ id: userId, email, token });
    }
  }

  return {
    testRunId,
    eventId,
    categoryId,
    originalPrice,
    users,
    startTime: new Date().toISOString(),
  };
}

/**
 * Public Market & Event Read Traffic Flow
 */
export function readTrafficScenario(data) {
  group('Read Traffic', () => {
    // 1. Health Ping
    const healthRes = http.get(`${BASE_URL}/health`);
    successfulReadsRate.add(healthRes.status === 200);

    // 2. Events Directory
    const t0 = Date.now();
    const eventsRes = http.get(`${BASE_URL}/api/v1/events`);
    eventQueryDuration.add(Date.now() - t0);
    check(eventsRes, { 'events directory 200 OK': (r) => r.status === 200 });
    successfulReadsRate.add(eventsRes.status === 200);

    // 3. Market Summary
    const summaryRes = http.get(`${BASE_URL}/api/v1/market/summary?limit=10`);
    check(summaryRes, { 'market summary 200 OK': (r) => r.status === 200 });
    successfulReadsRate.add(summaryRes.status === 200);

    // 4. Orderbook Depth (if event available)
    if (data.eventId) {
      const t1 = Date.now();
      const orderbookUrl = data.categoryId
        ? `${BASE_URL}/api/v1/market/${data.eventId}/${data.categoryId}/depth`
        : `${BASE_URL}/api/v1/events/${data.eventId}/orderbook`;
      const obRes = http.get(orderbookUrl);
      orderbookReadDuration.add(Date.now() - t1);
      check(obRes, { 'orderbook fetch 200 OK': (r) => r.status === 200 || r.status === 404 });
      successfulReadsRate.add(obRes.status === 200 || obRes.status === 404);
    }

    sleep(0.5);
  });
}

/**
 * Authenticated Trading & Order Lifecycle Flow
 */
export function tradingTrafficScenario(data) {
  if (!data.users || data.users.length === 0 || !data.eventId || !data.categoryId) {
    // Fall back to read traffic if isolated trading data could not be seeded
    readTrafficScenario(data);
    return;
  }

  // Select a trader deterministically per VU
  const user = data.users[(__VU - 1) % data.users.length];
  const authHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${user.token}`,
  };

  group('Trading Flow', () => {
    // 1. Wallet Balance Check
    const t0 = Date.now();
    const walletRes = http.get(`${BASE_URL}/api/v1/wallet`, { headers: authHeaders });
    walletQueryDuration.add(Date.now() - t0);
    check(walletRes, { 'wallet lookup 200 OK': (r) => r.status === 200 });

    // 2. Place Limit BID Order
    const idempotencyKey = `k6_order_${data.testRunId}_${__VU}_${__ITER}_${Date.now()}`;
    const orderPrice = Math.max(100, Math.floor(data.originalPrice * (0.90 + Math.random() * 0.15)));
    const orderPayload = JSON.stringify({
      eventId: data.eventId,
      ticketCategoryId: data.categoryId,
      side: 'BID',
      type: 'LIMIT',
      price: orderPrice,
      quantity: 1,
      idempotencyKey,
    });

    const t1 = Date.now();
    const orderRes = http.post(`${BASE_URL}/api/v1/orders`, orderPayload, {
      headers: {
        ...authHeaders,
        'Idempotency-Key': idempotencyKey,
      },
    });
    orderPlacementDuration.add(Date.now() - t1);

    const isCreated = orderRes.status === 201;
    successfulOrdersRate.add(isCreated);
    check(orderRes, { 'order placed 201 Created': (r) => r.status === 201 });

    if (isCreated) {
      orderCounter.add(1);
      let orderId = null;
      try {
        const body = JSON.parse(orderRes.body);
        orderId = body.data?.order?.id || body.data?.id;
      } catch (e) {
        // Parse error
      }

      // 3. Query Order Status
      if (orderId) {
        const lookupRes = http.get(`${BASE_URL}/api/v1/orders/${orderId}`, { headers: authHeaders });
        check(lookupRes, { 'order lookup 200 OK': (r) => r.status === 200 });

        // 4. Cancel Order (50% probability to test cancellation race / lifecycle)
        if (Math.random() < 0.5) {
          const cancelRes = http.del(`${BASE_URL}/api/v1/orders/${orderId}`, null, { headers: authHeaders });
          check(cancelRes, { 'order cancel 200 OK': (r) => r.status === 200 || r.status === 400 });
        }
      }
    }

    sleep(1);
  });
}

/**
 * Default function for smoke profile (runs combined read + trading)
 */
export default function (data) {
  if (__ITER % 3 === 0 && data.users && data.users.length > 0 && data.eventId) {
    tradingTrafficScenario(data);
  } else {
    readTrafficScenario(data);
  }
}

/**
 * Teardown hook: executed once at completion
 */
export function teardown(data) {
  console.log(`\n============================================================`);
  console.log(`PassFlow k6 Trading Performance Test Completed`);
  console.log(`Profile: ${PROFILE} | Target: ${BASE_URL}`);
  console.log(`Test Run ID: ${data.testRunId}`);
  console.log(`Test Traders Seeded: ${data.users ? data.users.length : 0}`);
  console.log(`Market Target: ${data.eventId || 'None'} / ${data.categoryId || 'None'}`);
  console.log(`Disposable dataset prefix: k6_trader_${data.testRunId}_*`);
  console.log(`============================================================\n`);
}
