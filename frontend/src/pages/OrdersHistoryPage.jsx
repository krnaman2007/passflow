import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { FileText, ArrowRight, XCircle } from 'lucide-react';

export default function OrdersHistoryPage() {
  const { userOrders, cancelOrder, wallet } = useApp();
  const [tab, setTab] = useState('ORDERS'); // 'ORDERS' | 'TRADES' | 'TRANSACTIONS'

  return (
    <div className="content-wrap">
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 28, margin: 0 }}>Orders & Trade History</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4 }}>
          Comprehensive record of open limit orders, market fills, and escrow settlements
        </p>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {['ORDERS', 'TRADES', 'TRANSACTIONS'].map((t) => (
          <button
            key={t}
            className={`btn-pill ${tab === t ? 'active' : ''}`}
            style={{
              padding: '8px 18px',
              borderRadius: 'var(--radius-sm)',
              fontWeight: 600,
              fontSize: 13,
              background: tab === t ? 'var(--bg-card)' : 'var(--bg-surface)',
              color: tab === t ? 'var(--accent-orange)' : 'var(--text-muted)',
              border: '1px solid',
              borderColor: tab === t ? 'var(--accent-orange-border)' : 'var(--border-subtle)'
            }}
            onClick={() => setTab(t)}
          >
            {t === 'ORDERS' && `Active & Past Orders (${userOrders.length})`}
            {t === 'TRADES' && 'Executed Trades'}
            {t === 'TRANSACTIONS' && 'Wallet Transactions'}
          </button>
        ))}
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {tab === 'ORDERS' && (
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Order ID</th>
                  <th>Event</th>
                  <th>Tier</th>
                  <th>Side</th>
                  <th>Price</th>
                  <th>Quantity</th>
                  <th>Filled</th>
                  <th>Status</th>
                  <th>Date</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {userOrders.map((ord) => (
                  <tr key={ord.id}>
                    <td className="font-mono">{ord.id}</td>
                    <td style={{ fontWeight: 600 }}>{ord.eventName}</td>
                    <td>{ord.tier}</td>
                    <td>
                      <span className={`badge ${ord.side === 'BUY' ? 'badge-green' : 'badge-red'}`}>
                        {ord.side}
                      </span>
                    </td>
                    <td className="font-mono">${ord.price.toFixed(2)}</td>
                    <td className="font-mono">{ord.qty}</td>
                    <td className="font-mono">{ord.filled} / {ord.qty}</td>
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
                    <td style={{ color: 'var(--text-dim)', fontSize: 12 }}>{ord.date}</td>
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
        )}

        {tab === 'TRADES' && (
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Trade #</th>
                  <th>Event</th>
                  <th>Tier</th>
                  <th>Side</th>
                  <th>Execution Price</th>
                  <th>Qty</th>
                  <th>Settlement Status</th>
                  <th>Timestamp</th>
                </tr>
              </thead>
              <tbody>
                <tr className="font-mono">
                  <td>TR-9041</td>
                  <td style={{ fontWeight: 600 }}>Nightfall Festival</td>
                  <td>General</td>
                  <td><span className="badge badge-green">BUY</span></td>
                  <td style={{ color: 'var(--accent-emerald)', fontWeight: 600 }}>$106.00</td>
                  <td>2</td>
                  <td><span className="badge badge-green">SETTLED IN ESCROW</span></td>
                  <td style={{ color: 'var(--text-dim)' }}>Oct 20, 11:45</td>
                </tr>
                <tr className="font-mono">
                  <td>TR-8812</td>
                  <td style={{ fontWeight: 600 }}>Nightfall Festival</td>
                  <td>General</td>
                  <td><span className="badge badge-red">SELL</span></td>
                  <td style={{ color: 'var(--accent-rose)', fontWeight: 600 }}>$112.00</td>
                  <td>1</td>
                  <td><span className="badge badge-green">SETTLED (+$112.00)</span></td>
                  <td style={{ color: 'var(--text-dim)' }}>Oct 20, 10:12</td>
                </tr>
                <tr className="font-mono">
                  <td>TR-8104</td>
                  <td style={{ fontWeight: 600 }}>Nightfall Festival</td>
                  <td>General</td>
                  <td><span className="badge badge-green">BUY</span></td>
                  <td style={{ color: 'var(--accent-emerald)', fontWeight: 600 }}>$52.00</td>
                  <td>1</td>
                  <td><span className="badge badge-green">SETTLED IN ESCROW</span></td>
                  <td style={{ color: 'var(--text-dim)' }}>Oct 19, 14:22</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {tab === 'TRANSACTIONS' && (
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Date</th>
                  <th>Description</th>
                </tr>
              </thead>
              <tbody>
                {wallet.transactions.map((tx) => (
                  <tr key={tx.id}>
                    <td>
                      <span className="badge badge-neutral">{tx.type}</span>
                    </td>
                    <td className="font-mono" style={{ fontWeight: 600 }}>
                      ${Math.abs(tx.amount).toFixed(2)}
                    </td>
                    <td><span className="badge badge-green">{tx.status}</span></td>
                    <td style={{ color: 'var(--text-dim)', fontSize: 12 }}>{tx.date}</td>
                    <td style={{ color: 'var(--text-sub)' }}>{tx.note}</td>
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
