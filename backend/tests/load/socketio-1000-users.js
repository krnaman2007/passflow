/**
 * PassFlow — 1,000+ Concurrent Socket.IO Real-Time Stress Test
 *
 * Simulates 1,000+ concurrent clients establishing WebSocket connections,
 * subscribing to secondary market depth feeds, and measuring:
 * - Connection handshake latency (p50, p95, p99)
 * - Ping-pong RTT latency under load
 * - Broadcast fanout message throughput
 * - Server / process memory and error rates
 *
 * Usage:
 *   node tests/load/socketio-1000-users.js
 *
 * Configuration (via environment variables):
 *   TARGET_URL=http://localhost:5001
 *   TOTAL_CLIENTS=1000
 *   RAMP_UP_SEC=20
 *   HOLD_SEC=30
 */

import { io } from 'socket.io-client';
import dotenv from 'dotenv';

// Automatically load backend .env so the target port matches the running server
dotenv.config();

const DEFAULT_PORT = process.env.PORT || '3001';
const TARGET_URL = process.env.TARGET_URL || `http://localhost:${DEFAULT_PORT}`;
const TOTAL_CLIENTS = parseInt(process.env.TOTAL_CLIENTS || '1000', 10);
const RAMP_UP_SEC = parseInt(process.env.RAMP_UP_SEC || '20', 10);
const HOLD_SEC = parseInt(process.env.HOLD_SEC || '30', 10);
const EVENT_ID = process.env.EVENT_ID || '11111111-1111-1111-1111-111111111111';
const CATEGORY_ID = process.env.CATEGORY_ID || '22222222-2222-2222-2222-222222222222';

console.log('='.repeat(70));
console.log('⚡ PassFlow 1,000+ Concurrent WebSocket Load Test');
console.log('='.repeat(70));
console.log(`Target URL:       ${TARGET_URL}`);
console.log(`Total Clients:    ${TOTAL_CLIENTS}`);
console.log(`Ramp-up Time:     ${RAMP_UP_SEC}s (~${Math.round(TOTAL_CLIENTS / RAMP_UP_SEC)} connects/sec)`);
console.log(`Hold Duration:    ${HOLD_SEC}s`);
console.log(`Market Room:      market:${EVENT_ID}:${CATEGORY_ID}`);
console.log('='.repeat(70));

const sockets = [];
const metrics = {
  connected: 0,
  peakConnected: 0,
  connecting: 0,
  disconnected: 0,
  errors: 0,
  handshakeTimes: [],
  pingRtts: [],
  broadcastsReceived: 0,
};

function calculatePercentiles(arr) {
  if (arr.length === 0) return { p50: 0, p95: 0, p99: 0, min: 0, max: 0 };
  const sorted = [...arr].sort((a, b) => a - b);
  const getP = (p) => sorted[Math.floor(sorted.length * (p / 100))] || sorted[sorted.length - 1];
  return {
    min: sorted[0],
    p50: getP(50),
    p95: getP(95),
    p99: getP(99),
    max: sorted[sorted.length - 1],
  };
}

// Connect a single client
function connectClient(index) {
  metrics.connecting++;
  const startTime = Date.now();

  const socket = io(TARGET_URL, {
    transports: ['websocket'],
    reconnection: true,
    reconnectionAttempts: 3,
    reconnectionDelay: 1000,
    timeout: 10000,
  });

  sockets.push(socket);

  socket.on('connect', () => {
    metrics.connecting--;
    metrics.connected++;
    metrics.peakConnected = Math.max(metrics.peakConnected, metrics.connected);
    const handshakeDuration = Date.now() - startTime;
    metrics.handshakeTimes.push(handshakeDuration);

    // Subscribe to secondary market room
    socket.emit('market:subscribe', {
      eventId: EVENT_ID,
      ticketCategoryId: CATEGORY_ID,
    });
  });

  socket.on('disconnect', () => {
    metrics.connected = Math.max(0, metrics.connected - 1);
    metrics.disconnected++;
  });

  socket.on('connect_error', (err) => {
    metrics.errors++;
    if (metrics.errors <= 3) {
      console.warn(`[Warning] Socket connection error (${TARGET_URL}):`, err?.message || err);
    }
  });

  // Track broadcast messages from backend market stream
  socket.on('market:orderbook', () => {
    metrics.broadcastsReceived++;
  });
  socket.on('market:trade', () => {
    metrics.broadcastsReceived++;
  });
  socket.on('market:snapshot', () => {
    metrics.broadcastsReceived++;
  });

  // Ping/Pong RTT latency measurement
  socket.on('pong-client', (data) => {
    if (data?.received?.sentAt) {
      const rtt = Date.now() - data.received.sentAt;
      metrics.pingRtts.push(rtt);
    }
  });
}

// Progress reporting interval
const reportInterval = setInterval(() => {
  const hs = calculatePercentiles(metrics.handshakeTimes);
  const pings = calculatePercentiles(metrics.pingRtts);
  const mem = process.memoryUsage();

  console.log(
    `[${new Date().toISOString().substring(11, 19)}] ` +
    `Connected: ${metrics.connected}/${TOTAL_CLIENTS} | ` +
    `Errors: ${metrics.errors} | ` +
    `Handshake p95: ${hs.p95}ms | ` +
    `Ping p95: ${pings.p95}ms | ` +
    `Broadcasts: ${metrics.broadcastsReceived} | ` +
    `RAM: ${(mem.rss / 1024 / 1024).toFixed(1)}MB`
  );
}, 2000);

// Periodic ping from a random sample of 20 connected clients every 3 seconds
const pingInterval = setInterval(() => {
  if (sockets.length === 0) return;
  const sampleSize = Math.min(25, sockets.length);
  for (let i = 0; i < sampleSize; i++) {
    const randomIdx = Math.floor(Math.random() * sockets.length);
    const sock = sockets[randomIdx];
    if (sock && sock.connected) {
      sock.emit('ping-server', { sentAt: Date.now() });
    }
  }
}, 3000);

// Main ramp-up loop
async function run() {
  const batchSize = Math.max(1, Math.round(TOTAL_CLIENTS / (RAMP_UP_SEC * 10))); // batch every 100ms
  const intervalMs = 100;
  let spawned = 0;

  console.log(`Starting ramp-up: spawning ~${batchSize * 10} clients per second...`);

  await new Promise((resolve) => {
    const rampTimer = setInterval(() => {
      for (let i = 0; i < batchSize && spawned < TOTAL_CLIENTS; i++) {
        connectClient(spawned++);
      }
      if (spawned >= TOTAL_CLIENTS) {
        clearInterval(rampTimer);
        resolve();
      }
    }, intervalMs);
  });

  console.log(`\n✅ All ${TOTAL_CLIENTS} clients spawned. Holding active connections for ${HOLD_SEC}s...\n`);
  await new Promise((resolve) => setTimeout(resolve, HOLD_SEC * 1000));

  console.log('\n🛑 Hold period complete. Tearing down all client sockets...');
  clearInterval(reportInterval);
  clearInterval(pingInterval);

  for (const s of sockets) {
    try {
      s.disconnect();
    } catch {}
  }

  // Final summary
  const hs = calculatePercentiles(metrics.handshakeTimes);
  const pings = calculatePercentiles(metrics.pingRtts);
  const peak = metrics.peakConnected;
  const successRate = ((peak / TOTAL_CLIENTS) * 100).toFixed(1);

  console.log('\n' + '='.repeat(70));
  console.log('📊 FINAL TEST RESULTS SUMMARY');
  console.log('='.repeat(70));
  console.log(`Total Attempted:         ${TOTAL_CLIENTS}`);
  console.log(`Peak Concurrent Sockets: ${peak}`);
  console.log(`Success Rate:            ${successRate}%`);
  console.log(`Total Connection Errors: ${metrics.errors}`);
  console.log(`Total Broadcasts Caught: ${metrics.broadcastsReceived}`);
  console.log('----------------------------------------------------------------------');
  console.log('Handshake Latencies:');
  console.log(`  Min:    ${hs.min}ms`);
  console.log(`  Median: ${hs.p50}ms`);
  console.log(`  p95:    ${hs.p95}ms`);
  console.log(`  p99:    ${hs.p99}ms`);
  console.log(`  Max:    ${hs.max}ms`);
  console.log('----------------------------------------------------------------------');
  console.log('Round-Trip Ping Latencies:');
  console.log(`  Min:    ${pings.min}ms`);
  console.log(`  Median: ${pings.p50}ms`);
  console.log(`  p95:    ${pings.p95}ms`);
  console.log(`  Max:    ${pings.max}ms`);
  console.log('='.repeat(70));

  if (parseFloat(successRate) >= 95 && (hs.p95 <= 1500 || hs.p95 === 0)) {
    console.log('🎉 PASS: System successfully sustained 1,000+ concurrent WebSocket users!');
    process.exit(0);
  } else {
    console.log('❌ FAIL: Connection success rate fell below 95% or latency exceeded threshold.');
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('Fatal load test error:', err);
  process.exit(1);
});

