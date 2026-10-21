import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import {
  TrendingUp,
  Activity,
  Lock,
  ArrowRight,
  Shield,
  Clock,
  XCircle,
  CheckCircle,
  Zap,
  HelpCircle
} from 'lucide-react';

export default function MarketPage() {
  const {
    events,
    orderBooks,
    userOrders,
    userTickets,
    routeParams,
    navigate,
    currentRole,
    wallet,
    placeOrder,
    cancelOrder,
    showToast
  } = useApp();

  const eventId = routeParams.id || 'nightfall';
  const categoryId = routeParams.categoryId || 'general';

  const event = events.find((e) => e.id === eventId) || events[0];
  const orderBookKey = `${eventId}:${categoryId}`;
  const book = orderBooks[orderBookKey] || orderBooks['nightfall:general'];

  // Order Form State
  const [side, setSide] = useState('BUY'); // 'BUY' | 'SELL'
  const [orderType, setOrderType] = useState('LIMIT'); // 'LIMIT' | 'MARKET'
  const [price, setPrice] = useState('106.00');
  const [qty, setQty] = useState(2);
  const [bottomTab, setBottomTab] = useState('OPEN_ORDERS'); // 'OPEN_ORDERS' | 'TRADE_FEED'

  // Cap lookup
  const currentTier = event.tiers.find((t) => t.id.toLowerCase() === categoryId.toLowerCase()) || event.tiers[0];
  const resaleCap = currentTier?.cap || 120;

  // Total
  const numPrice = orderType === 'MARKET' ? (side === 'BUY' ? parseFloat(book.asks[book.asks.length - 1]?.price || '108') : parseFloat(book.bids[0]?.price || '105')) : parseFloat(price || 0);
  const totalCost = numPrice * qty;

  // Handle clicking row to autofill price
  const handlePriceClick = (clickedPrice) => {
    setPrice(clickedPrice);
    if (orderType === 'MARKET') setOrderType('LIMIT');
    showToast(`Filled $${clickedPrice} into order ticket`, 'info');
  };

  // Submit Order
  const handleSubmitOrder = (e) => {
    e.preventDefault();
    if (currentRole === 'PUBLIC') {
      navigate('/login');
      return;
    }

    if (qty <= 0) {
      showToast('Quantity must be at least 1', 'warning');
      return;
    }

    placeOrder({
      side,
      type: orderType,
      price: numPrice,
      qty,
      eventId: event.id,
      tier: currentTier.name
    });
  };

  return (
    <div className="content-wrap">
      {/* Top Header: Title, Category Tabs & Live Status */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h1 style={{ fontSize: 24, margin: 0 }}>{event.title}</h1>
            <span className="badge badge-green">
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#10b981', display: 'inline-block' }} />
              ● Live
            </span>
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
            Order matching engine running in-memory with price-time priority
          </p>
        </div>

        {/* Category Tabs: General / VIP / Early bird */}
        <div style={{ display: 'flex', gap: 6, background: 'var(--bg-surface)', padding: 4, borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
          {event.tiers.map((t) => (
            <button
              key={t.id}
              className={`nav-item ${categoryId.toLowerCase() === t.id.toLowerCase() ? 'active' : ''}`}
              style={{ padding: '6px 14px', fontSize: 12 }}
              onClick={() => navigate(`/market/${event.id}/${t.id}`, { id: event.id, categoryId: t.id })}
            >
              {t.name}
            </button>
          ))}
        </div>
      </div>

      {/* Ticker Bar */}
      <div className="market-ticker-bar">
        <div className="ticker-tile">
          <span className="label">Best Bid</span>
          <span className="val font-mono" style={{ color: 'var(--accent-emerald)' }}>
            ${book.bids[0]?.price || '105.00'}
          </span>
        </div>
        <div className="ticker-tile">
          <span className="label">Best Ask</span>
          <span className="val font-mono" style={{ color: 'var(--accent-rose)' }}>
            ${book.asks[book.asks.length - 1]?.price || '108.00'}
          </span>
        </div>
        <div className="ticker-tile">
          <span className="label">Last Trade</span>
          <span className="val font-mono" style={{ color: 'var(--text-main)' }}>
            ${book.trades[0]?.price || '106.00'}
          </span>
        </div>
        <div className="ticker-tile">
          <span className="label">Volume 24h</span>
          <span className="val font-mono" style={{ color: 'var(--accent-orange)' }}>
            {event.volume24h || 312} tickets
          </span>
        </div>
        <div className="ticker-tile">
          <span className="label">Anti-Scalp Cap</span>
          <span className="val font-mono" style={{ color: 'var(--text-sub)' }}>
            Max ${resaleCap}.00
          </span>
        </div>
      </div>

      {/* Main 2-column Grid: Orderbook on Left, Order Form on Right */}
      <div className="trading-desk-grid">
        {/* Left: Order Book Table */}
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ fontSize: 15, display: 'flex', alignItems: 'center', gap: 6 }}>
              <TrendingUp size={16} color="var(--accent-orange)" />
              <span>Order Book ({currentTier.name})</span>
            </h3>
            <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
              Click any row to fill price
            </span>
          </div>

          {/* Table Header */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', padding: '8px 14px', borderBottom: '1px solid var(--border-subtle)', fontSize: 11, color: 'var(--text-dim)', fontWeight: 600 }}>
            <span>PRICE ($)</span>
            <span style={{ textAlign: 'center' }}>QTY</span>
            <span style={{ textAlign: 'right' }}>TOTAL ($)</span>
          </div>

          {/* Asks (Sells) in reverse order (highest to lowest ask) */}
          <div className="orderbook-table">
            {book.asks.map((ask, idx) => (
              <div
                key={`ask-${idx}`}
                className="orderbook-row font-mono"
                onClick={() => handlePriceClick(ask.price)}
                title={`Click to fill $${ask.price}`}
              >
                <div className="ask-depth-bar" style={{ width: `${Math.min(100, ask.depth * 3)}%` }} />
                <span style={{ color: 'var(--accent-rose)', fontWeight: 600 }}>{ask.price}</span>
                <span style={{ textAlign: 'center', color: 'var(--text-sub)' }}>{ask.qty}</span>
                <span style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{ask.total}</span>
              </div>
            ))}
          </div>

          {/* Spread Divider */}
          <div className="spread-divider font-mono">
            <span>Spread</span>
            <span style={{ color: 'var(--accent-orange)', fontWeight: 600 }}>${book.spread}</span>
          </div>

          {/* Bids (Buys) */}
          <div className="orderbook-table">
            {book.bids.map((bid, idx) => (
              <div
                key={`bid-${idx}`}
                className="orderbook-row font-mono"
                onClick={() => handlePriceClick(bid.price)}
                title={`Click to fill $${bid.price}`}
              >
                <div className="bid-depth-bar" style={{ width: `${Math.min(100, bid.depth * 3)}%` }} />
                <span style={{ color: 'var(--accent-emerald)', fontWeight: 600 }}>{bid.price}</span>
                <span style={{ textAlign: 'center', color: 'var(--text-sub)' }}>{bid.qty}</span>
                <span style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{bid.total}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Right: Order Form or Public Login Lock */}
        <div>
          {currentRole === 'PUBLIC' ? (
            /* Public View-Only Lock Box */
            <div className="card" style={{ textAlign: 'center', padding: '36px 24px' }}>
              <div
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: '50%',
                  background: 'var(--accent-orange-subtle)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto 16px'
                }}
              >
                <Lock size={24} color="#f97316" />
              </div>
              <h3 style={{ fontSize: 18, marginBottom: 8 }}>Trade karne ke liye login karo</h3>
              <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 24, lineHeight: 1.5 }}>
                Book dekhna free hai. Buy / Sell order place karne ke liye verified account aur escrow wallet balance chahiye.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <button className="btn-primary" onClick={() => navigate('/login')}>
                  Log in to trade
                </button>
                <button className="btn-secondary" onClick={() => navigate('/register')}>
                  Sign up
                </button>
              </div>
            </div>
          ) : (
            /* Active Trading Form */
            <div className="card" style={{ padding: 20 }}>
              <form onSubmit={handleSubmitOrder}>
                {/* Buy / Sell Toggle */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 16 }}>
                  <button
                    type="button"
                    className={`btn-pill ${side === 'BUY' ? 'active' : ''}`}
                    style={{
                      background: side === 'BUY' ? 'var(--accent-emerald)' : 'var(--bg-input)',
                      color: side === 'BUY' ? '#06281e' : 'var(--text-muted)',
                      fontWeight: 700,
                      padding: '8px',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: 13
                    }}
                    onClick={() => setSide('BUY')}
                  >
                    Buy Tickets
                  </button>
                  <button
                    type="button"
                    className={`btn-pill ${side === 'SELL' ? 'active' : ''}`}
                    style={{
                      background: side === 'SELL' ? 'var(--accent-rose)' : 'var(--bg-input)',
                      color: side === 'SELL' ? '#fff' : 'var(--text-muted)',
                      fontWeight: 700,
                      padding: '8px',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: 13
                    }}
                    onClick={() => setSide('SELL')}
                  >
                    Sell Tickets
                  </button>
                </div>

                {/* Limit / Market Toggle */}
                <div style={{ display: 'flex', gap: 12, marginBottom: 16, fontSize: 12 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                    <input
                      type="radio"
                      name="orderType"
                      checked={orderType === 'LIMIT'}
                      onChange={() => setOrderType('LIMIT')}
                    />
                    <span>Limit Order</span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                    <input
                      type="radio"
                      name="orderType"
                      checked={orderType === 'MARKET'}
                      onChange={() => setOrderType('MARKET')}
                    />
                    <span>Market Order</span>
                  </label>
                </div>

                {/* Price Input */}
                <div style={{ marginBottom: 14 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Price ($)</label>
                    {orderType === 'MARKET' && (
                      <span style={{ fontSize: 11, color: 'var(--accent-orange)' }}>Best market match</span>
                    )}
                  </div>
                  <input
                    type="number"
                    step="0.5"
                    disabled={orderType === 'MARKET'}
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    style={{ width: '100%', fontSize: 15, fontWeight: 600 }}
                  />
                </div>

                {/* Quantity Input */}
                <div style={{ marginBottom: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Quantity</label>
                    <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                      {side === 'SELL' ? 'Select from your owned tickets' : `Wallet avail: $${wallet.available.toFixed(2)}`}
                    </span>
                  </div>
                  <input
                    type="number"
                    min="1"
                    max={side === 'SELL' ? 10 : 20}
                    value={qty}
                    onChange={(e) => setQty(parseInt(e.target.value, 10) || 1)}
                    style={{ width: '100%', fontSize: 15, fontWeight: 600 }}
                  />
                </div>

                {/* Total and Cap Warning */}
                <div style={{ background: 'var(--bg-app)', padding: 12, borderRadius: 'var(--radius-sm)', marginBottom: 18, fontSize: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ color: 'var(--text-muted)' }}>Total Amount:</span>
                    <strong className="font-mono" style={{ fontSize: 14, color: 'var(--text-main)' }}>
                      ${totalCost.toFixed(2)}
                    </strong>
                  </div>
                  <p style={{ color: 'var(--text-dim)', fontSize: 11, lineHeight: 1.4 }}>
                    Resale cap for {currentTier.name}: <strong>${resaleCap}</strong>. ${totalCost.toFixed(2)} will be held in escrow until filled or cancelled.
                  </p>
                </div>

                {/* Submit button */}
                <button
                  type="submit"
                  className={side === 'BUY' ? 'btn-primary' : 'btn-primary'}
                  style={{
                    width: '100%',
                    padding: 12,
                    fontSize: 14,
                    background: side === 'SELL' ? 'linear-gradient(135deg, #e11d48, #f43f5e)' : undefined
                  }}
                >
                  {side === 'BUY' ? `Place Buy Order ($${totalCost.toFixed(2)})` : `Place Sell Order ($${totalCost.toFixed(2)})`}
                </button>
              </form>
            </div>
          )}
        </div>
      </div>

      {/* Bottom Section: Tabs for Open Orders & Trade Feed */}
      <div className="card" style={{ marginTop: 24, padding: 0, overflow: 'hidden' }}>
        <div style={{ display: 'flex', gap: 10, padding: '12px 16px', borderBottom: '1px solid var(--border-subtle)', background: 'rgba(0,0,0,0.2)' }}>
          <button
            className={`btn-pill ${bottomTab === 'OPEN_ORDERS' ? 'active' : ''}`}
            style={{
              padding: '6px 14px',
              fontSize: 12,
              fontWeight: 600,
              background: bottomTab === 'OPEN_ORDERS' ? 'var(--bg-card)' : 'transparent',
              color: bottomTab === 'OPEN_ORDERS' ? 'var(--accent-orange)' : 'var(--text-muted)',
              borderRadius: 'var(--radius-sm)'
            }}
            onClick={() => setBottomTab('OPEN_ORDERS')}
          >
            My Active Orders ({userOrders.filter((o) => o.status === 'OPEN' || o.status === 'PARTIAL').length})
          </button>
          <button
            className={`btn-pill ${bottomTab === 'TRADE_FEED' ? 'active' : ''}`}
            style={{
              padding: '6px 14px',
              fontSize: 12,
              fontWeight: 600,
              background: bottomTab === 'TRADE_FEED' ? 'var(--bg-card)' : 'transparent',
              color: bottomTab === 'TRADE_FEED' ? 'var(--accent-orange)' : 'var(--text-muted)',
              borderRadius: 'var(--radius-sm)'
            }}
            onClick={() => setBottomTab('TRADE_FEED')}
          >
            Recent Public Trades (Live Feed)
          </button>
        </div>

        {bottomTab === 'OPEN_ORDERS' ? (
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Order #</th>
                  <th>Side</th>
                  <th>Tier</th>
                  <th>Qty</th>
                  <th>Price</th>
                  <th>Filled</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {userOrders.map((ord) => (
                  <tr key={ord.id}>
                    <td className="font-mono">{ord.id}</td>
                    <td>
                      <span className={`badge ${ord.side === 'BUY' ? 'badge-green' : 'badge-red'}`}>
                        {ord.side}
                      </span>
                    </td>
                    <td>{ord.tier}</td>
                    <td className="font-mono">{ord.qty}</td>
                    <td className="font-mono">${ord.price.toFixed(2)}</td>
                    <td className="font-mono">
                      {ord.filled} / {ord.qty}
                    </td>
                    <td>
                      <span
                        className={`badge ${
                          ord.status === 'OPEN'
                            ? 'badge-blue'
                            : ord.status === 'PARTIAL'
                            ? 'badge-orange'
                            : ord.status === 'FILLED'
                            ? 'badge-green'
                            : 'badge-neutral'
                        }`}
                      >
                        {ord.status}
                      </span>
                    </td>
                    <td>
                      {(ord.status === 'OPEN' || ord.status === 'PARTIAL') && (
                        <button
                          className="btn-danger-outline"
                          onClick={() => cancelOrder(ord.id)}
                        >
                          Cancel
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          /* Trade Feed */
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Price ($)</th>
                  <th>Quantity</th>
                  <th>Timestamp</th>
                  <th>Execution Side</th>
                </tr>
              </thead>
              <tbody>
                {book.trades.map((tr, idx) => (
                  <tr key={idx} className="font-mono">
                    <td style={{ color: tr.side === 'buy' ? 'var(--accent-emerald)' : 'var(--accent-rose)', fontWeight: 600 }}>
                      ${tr.price}
                    </td>
                    <td>{tr.qty} tickets</td>
                    <td style={{ color: 'var(--text-dim)' }}>{tr.time}</td>
                    <td>
                      <span className={`badge ${tr.side === 'buy' ? 'badge-green' : 'badge-red'}`}>
                        {tr.side.toUpperCase()}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
