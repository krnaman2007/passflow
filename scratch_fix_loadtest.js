const fs = require('fs');
const path = require('path');

const targetPath = path.join(__dirname, 'backend/src/services/load-test.service.js');
let code = fs.readFileSync(targetPath, 'utf8');

// 1. Replace static import
const oldImport = "import { io as ioClient } from 'socket.io-client';";
const newHelper = `// Lazy-loaded socket.io-client to guarantee server boot on any deployment environment
let _ioClient = null;
async function getIoClient() {
  if (_ioClient) return _ioClient;
  try {
    const mod = await import('socket.io-client');
    _ioClient = mod.io || mod.default?.io || mod.default;
    return _ioClient;
  } catch (err) {
    console.warn('[LoadTestService] socket.io-client could not be loaded:', err.message);
    return null;
  }
}`;

code = code.replace(oldImport, newHelper);

// 2. In runWebSocketSuite, get io before running sockets
const oldRunWsHeader = `    log(\`Ramping up \${totalClients} WebSocket connections...\`);

    const spawnClient = (i) => {
      return new Promise((resolve) => {
        const t0 = Date.now();
        const socket = ioClient(targetUrl, {`;

const newRunWsHeader = `    log(\`Ramping up \${totalClients} WebSocket connections...\`);

    const io = await getIoClient();
    if (!io) {
      throw new Error('socket.io-client package is unavailable in this environment.');
    }

    const spawnClient = (i) => {
      return new Promise((resolve) => {
        const t0 = Date.now();
        const socket = io(targetUrl, {`;

const normCode = code.replace(/\r\n/g, '\n');
const normOld = oldRunWsHeader.replace(/\r\n/g, '\n');

if (normCode.includes(normOld)) {
  code = normCode.replace(normOld, newRunWsHeader.replace(/\r\n/g, '\n'));
  fs.writeFileSync(targetPath, code, 'utf8');
  console.log('Successfully updated load-test.service.js');
} else {
  console.error('Could not find oldRunWsHeader in load-test.service.js');
}

