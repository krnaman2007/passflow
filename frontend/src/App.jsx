import { useState, useEffect } from 'react';
import Decimal from 'decimal.js';
import { useAppStore } from './store/useStore';
import { socket } from './services/socket';
import TradingChart from './components/TradingChart';
import './App.css';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5001';

function App() {
  const { user, setUser, logout, isConnected, setConnected, chartSymbol, setChartSymbol } = useAppStore();
  
  // Socket test state
  const [socketLog, setSocketLog] = useState([]);
  
  // Decimal.js test state
  const [num1, setNum1] = useState('0.1');
  const [num2, setNum2] = useState('0.2');
  const [decimalResult, setDecimalResult] = useState('');
  
  // Backend test state
  const [backendStatus, setBackendStatus] = useState('Checking...');
  const [emailInput, setEmailInput] = useState('trader@passflow.io');

  useEffect(() => {
    // Check backend health
    fetch(`${BACKEND_URL}/api/health`)
      .then((res) => res.json())
      .then((data) => setBackendStatus(`Online (${data.message})`))
      .catch(() => setBackendStatus('Offline (Run `npm run dev` in backend)'));

    // Socket listeners
    function onConnect() {
      setConnected(true);
    }
    function onDisconnect() {
      setConnected(false);
    }
    function onPong(data) {
      setSocketLog((prev) => [
        `${new Date().toLocaleTimeString()}: Server reply: ${data.message}`,
        ...prev.slice(0, 4)
      ]);
    }

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('pong-client', onPong);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('pong-client', onPong);
    };
  }, [setConnected]);

  // Compute Decimal.js addition
  useEffect(() => {
    try {
      const a = new Decimal(num1 || '0');
      const b = new Decimal(num2 || '0');
      const sum = a.plus(b);
      const nativeJs = Number(num1) + Number(num2);
      setDecimalResult({
        exact: sum.toString(),
        native: nativeJs.toString(),
        isBuggyInJs: sum.toString() !== nativeJs.toString()
      });
    } catch {
      setDecimalResult({ exact: 'Invalid Input', native: '', isBuggyInJs: false });
    }
  }, [num1, num2]);

  const handlePingSocket = () => {
    socket.emit('ping-server', { clientTime: Date.now() });
  };

  const handleDemoLogin = async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailInput, password: 'password123' })
      });
      const data = await res.json();
      if (data.token) {
        setUser(data.user, data.token);
      }
    } catch (err) {
      alert('Backend server ko start karein (cd backend && npm run dev)');
    }
  };

  return (
    <div className="dashboard-container">
      {/* Top Navbar */}
      <header className="navbar">
        <div className="brand">
          <div className="brand-logo">⚡</div>
          <div>
            <h2>PassFlow Stack</h2>
            <p className="subtitle">All requested libraries & tools installed & configured</p>
          </div>
        </div>
        <div className="server-status">
          <span className={`status-pill ${backendStatus.includes('Online') ? 'online' : 'offline'}`}>
            Backend: {backendStatus}
          </span>
          <span className={`status-pill ${isConnected ? 'online' : 'offline'}`}>
            Socket.IO: {isConnected ? 'Connected' : 'Disconnected'}
          </span>
        </div>
      </header>

      {/* Main Grid */}
      <div className="dashboard-grid">
        {/* Left Column: Chart */}
        <section className="chart-card">
          <div className="card-header">
            <h3>📈 TradingView Lightweight Chart</h3>
            <div className="symbol-selector">
              {['BTC/USDT', 'ETH/USDT', 'SOL/USDT'].map((sym) => (
                <button
                  key={sym}
                  className={`btn-pill ${chartSymbol === sym ? 'active' : ''}`}
                  onClick={() => setChartSymbol(sym)}
                >
                  {sym}
                </button>
              ))}
            </div>
          </div>
          <TradingChart />
        </section>

        {/* Right Column: Interactive Widgets */}
        <div className="widgets-column">
          {/* Decimal.js Widget */}
          <div className="widget-card">
            <h4>🔢 Decimal.js High-Precision Math</h4>
            <p className="widget-desc">Avoids JavaScript floating-point errors (e.g. 0.1 + 0.2)</p>
            <div className="calc-inputs">
              <input
                type="text"
                value={num1}
                onChange={(e) => setNum1(e.target.value)}
                placeholder="Num 1"
              />
              <span>+</span>
              <input
                type="text"
                value={num2}
                onChange={(e) => setNum2(e.target.value)}
                placeholder="Num 2"
              />
            </div>
            <div className="calc-result">
              <div><strong>Decimal.js:</strong> <span className="highlight-green">{decimalResult.exact}</span></div>
              <div><strong>Standard JS:</strong> <span className="highlight-orange">{decimalResult.native}</span></div>
            </div>
            {decimalResult.isBuggyInJs && (
              <div className="badge-warning">Notice JavaScript precision bug avoided!</div>
            )}
          </div>

          {/* Zustand State & JWT Auth Widget */}
          <div className="widget-card">
            <h4>🐻 Zustand Global Store & JWT Auth</h4>
            {user ? (
              <div className="user-logged-in">
                <p>Welcome, <strong>{user.email}</strong></p>
                <button className="btn-secondary" onClick={logout}>Logout</button>
              </div>
            ) : (
              <div className="login-box">
                <input
                  type="email"
                  value={emailInput}
                  onChange={(e) => setEmailInput(e.target.value)}
                  placeholder="Enter email"
                />
                <button className="btn-primary" onClick={handleDemoLogin}>
                  Test JWT Login
                </button>
              </div>
            )}
          </div>

          {/* Socket.IO Real-Time Widget */}
          <div className="widget-card">
            <h4>⚡ Socket.IO Live Events</h4>
            <button className="btn-action" onClick={handlePingSocket}>
              Emit ping-server event
            </button>
            <div className="socket-log-box">
              {socketLog.length === 0 ? (
                <span className="text-muted">Click ping to send real-time event</span>
              ) : (
                socketLog.map((log, idx) => <div key={idx} className="log-line">{log}</div>)
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Tech Stack Checklist Footer */}
      <footer className="stack-footer">
        <h3>📋 Installed Libraries & Components Status</h3>
        <div className="stack-badges">
          <span className="badge">✓ React 19</span>
          <span className="badge">✓ Node.js + Express.js</span>
          <span className="badge">✓ PostgreSQL + Prisma</span>
          <span className="badge">✓ Socket.IO (Client & Server)</span>
          <span className="badge">✓ Zustand</span>
          <span className="badge">✓ Redis (ioredis + redis)</span>
          <span className="badge">✓ Lightweight Charts (TradingView)</span>
          <span className="badge">✓ Decimal.js</span>
          <span className="badge">✓ jsonwebtoken (JWT)</span>
          <span className="badge">✓ Jest + Supertest</span>
          <span className="badge">✓ k6 Load Testing Script</span>
        </div>
      </footer>
    </div>
  );
}

export default App;
