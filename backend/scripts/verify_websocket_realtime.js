import { io } from 'socket.io-client';
import { randomUUID } from 'crypto';

async function testWebSocketRealTime() {
  console.log('\n============================================================');
  console.log('⚡ TESTING WEBSOCKET REAL-TIME MARKET UPDATES (NO REFRESH)');
  console.log('============================================================\n');

  // 1. Authenticate two test users (Ali & Bob)
  console.log('1️⃣ Authenticating test users via REST API...');
  const aliLogin = await (await fetch('http://localhost:3001/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'ali@passflow.com', password: 'Password123!' })
  })).json();
  const aliToken = aliLogin.data.tokens.accessToken;
  const aliUser = aliLogin.data.user;

  const bobLogin = await (await fetch('http://localhost:3001/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'priya@passflow.com', password: 'Password123!' })
  })).json();
  const bobToken = bobLogin.data.tokens.accessToken;
  const bobUser = bobLogin.data.user;

  console.log(`   ✓ Ali authenticated (ID: ${aliUser.id})`);
  console.log(`   ✓ Bob authenticated (ID: ${bobUser.id})`);

  // Ensure Bob has funds in wallet
  await fetch('http://localhost:3001/api/v1/wallet/deposit', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + bobToken
    },
    body: JSON.stringify({ amount: '50000.00' })
  }).catch(() => {});

  // 2. Fetch active events & categories
  const eventsRes = await (await fetch('http://localhost:3001/api/v1/events')).json();
  const event = eventsRes.data.events[0];
  const category = event.categories[0];
  const eventId = event.id;
  const categoryId = category.id;

  console.log(`\n2️⃣ Selected Live Market: "${event.name}"`);
  console.log(`   Event ID: ${eventId}`);
  console.log(`   Category: "${category.name}" (ID: ${categoryId})`);

  // 3. Connect a Frontend Socket.IO Client (simulating browser)
  console.log('\n3️⃣ Initializing WebSocket client connection to http://localhost:3001...');
  const socket = io('http://localhost:3001', {
    transports: ['websocket'],
    auth: { token: aliToken }
  });

  const receivedEvents = [];

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Socket connection timed out')), 8000);
    socket.on('connect', () => {
      clearTimeout(timer);
      console.log(`   ✓ WebSocket connected! Client Socket ID: ${socket.id}`);
      resolve();
    });
    socket.on('connect_error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });

  // 4. Subscribe to the public market room
  console.log('\n4️⃣ Subscribing to public market room (market:subscribe)...');
  const snapshotPromise = new Promise((resolve) => {
    socket.on('market:snapshot', (snapshot) => {
      console.log('   ✓ Received authoritative initial "market:snapshot":', {
        bidsCount: snapshot.bids?.length || 0,
        asksCount: snapshot.asks?.length || 0,
        sequenceNumber: snapshot.sequenceNumber
      });
      receivedEvents.push('market:snapshot');
      resolve(snapshot);
    });
  });

  socket.emit('market:subscribe', { eventId, ticketCategoryId: categoryId });
  await snapshotPromise;

  // Set up listeners for live real-time pushes
  const depthUpdatePromise = new Promise((resolve) => {
    socket.on('market:orderbook', (update) => {
      console.log('   ⚡ [WS PUSH RECEIVED] "market:orderbook" (Depth Update):', {
        action: update.action,
        bidsCount: update.bids?.length || 0,
        asksCount: update.asks?.length || 0,
        sequenceNumber: update.sequenceNumber
      });
      receivedEvents.push('market:orderbook');
      resolve(update);
    });
  });

  const tradePromise = new Promise((resolve) => {
    socket.on('market:trade', (trade) => {
      console.log('   ⚡ [WS PUSH RECEIVED] "market:trade" (Trade Execution):', {
        tradeId: trade.tradeId,
        price: trade.price,
        quantity: trade.quantity,
        sequenceNumber: trade.sequenceNumber
      });
      receivedEvents.push('market:trade');
      resolve(trade);
    });
  });

  const orderFillPromise = new Promise((resolve) => {
    socket.on('order:fill', (fill) => {
      console.log('   ⚡ [WS PUSH RECEIVED] "order:fill" (Private User Fill):', {
        orderId: fill.orderId,
        side: fill.side,
        status: fill.status,
        fillPrice: fill.fillPrice,
        fillQuantity: fill.fillQuantity
      });
      receivedEvents.push('order:fill');
      resolve(fill);
    });
  });

  // 5. Place a BID order as Bob via REST API
  console.log('\n5️⃣ Placing a Limit BID order via REST API to trigger WebSocket push...');
  const testBidPrice = 120000; // ₹1,200 (120000 paise)
  const orderRes = await (await fetch('http://localhost:3001/api/v1/orders', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + bobToken
    },
    body: JSON.stringify({
      eventId,
      ticketCategoryId: categoryId,
      side: 'BID',
      type: 'LIMIT',
      price: testBidPrice,
      quantity: 1,
      idempotencyKey: randomUUID()
    })
  })).json();

  console.log('   ✓ REST order response:', {
    success: orderRes.success,
    orderId: orderRes.data?.orderId,
    status: orderRes.data?.status
  });

  // Wait for the real-time depth update push over WebSocket
  console.log('\n6️⃣ Waiting for live WebSocket depth push without any page refresh...');
  const receivedDepth = await Promise.race([
    depthUpdatePromise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Depth push timed out')), 6000))
  ]);

  console.log('\n============================================================');
  console.log('🎯 REAL-TIME WEBSOCKET VERIFICATION RESULT:');
  console.log('   ✓ WebSocket Connection:      ESTABLISHED (Socket.IO v4)');
  console.log('   ✓ Market Subscription:       ACTIVE (market:' + eventId.slice(0, 8) + '...)');
  console.log('   ✓ Authoritative Snapshot:    RECEIVED');
  console.log('   ✓ Real-Time Push on Order:   RECEIVED (' + receivedEvents.join(' -> ') + ')');
  console.log('   ✓ Zero Page Refresh Needed:  CONFIRMED');
  console.log('============================================================\n');

  socket.disconnect();
}

testWebSocketRealTime().catch((err) => {
  console.error('❌ WebSocket Test Error:', err);
  process.exit(1);
});
