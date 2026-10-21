import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import {
  Wallet,
  ArrowUpRight,
  ArrowDownLeft,
  Lock,
  Clock,
  Filter,
  CheckCircle2,
  XCircle,
  AlertCircle
} from 'lucide-react';

export default function WalletPage() {
  const {
    wallet,
    depositWallet,
    withdrawWallet,
    userOrders,
    cancelOrder,
    navigate
  } = useApp();

  const [inputAmount, setInputAmount] = useState('250.00');
  const [filterType, setFilterType] = useState('ALL');

  // Filter transactions
  const filteredTransactions = wallet.transactions.filter((tx) => {
    if (filterType === 'ALL') return true;
    if (filterType === 'DEPOSIT') return tx.type === 'DEPOSIT';
    if (filterType === 'PURCHASE') return tx.type === 'PURCHASE';
    if (filterType === 'HOLD') return tx.type === 'HOLD' || tx.type === 'RELEASE_HOLD';
    if (filterType === 'TRADE_CREDIT') return tx.type === 'TRADE_CREDIT';
    if (filterType === 'WITHDRAW') return tx.type === 'WITHDRAW';
    return true;
  });

  return (
    <div className="content-wrap">
      {/* Page Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 28, margin: 0 }}>Escrow & Trading Wallet</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4 }}>
          Atomic settlement engine: funds held during open orders and released upon trade execution or cancellation
        </p>
      </div>

      {/* 3 Metric Cards */}
      <div className="grid-3" style={{ marginBottom: 24 }}>
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Total Ledger Balance
            </span>
            <Wallet size={16} color="var(--accent-orange)" />
          </div>
          <div className="font-mono" style={{ fontSize: 28, fontWeight: 700, color: 'var(--text-main)' }}>
            ${wallet.balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>
            Includes available balance + funds locked in escrow
          </div>
        </div>

        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Held in Open Orders
            </span>
            <Lock size={16} color="#f97316" />
          </div>
          <div className="font-mono" style={{ fontSize: 28, fontWeight: 700, color: 'var(--accent-orange)' }}>
            ${wallet.held.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>
            Reserved for active bids on live order books
          </div>
        </div>

        <div className="card" style={{ borderColor: 'var(--accent-emerald-border)', background: 'rgba(16, 185, 129, 0.04)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 12, color: 'var(--accent-emerald)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
              Available to Trade / Withdraw
            </span>
            <CheckCircle2 size={16} color="#10b981" />
          </div>
          <div className="font-mono" style={{ fontSize: 28, fontWeight: 700, color: 'var(--accent-emerald)' }}>
            ${wallet.available.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>
            Balance $1,240 − Held $212 = Available $1,028
          </div>
        </div>
      </div>

      {/* 2-column Grid: Transactions Table on Left, Actions on Right */}
      <div className="detail-grid">
        {/* Left: Transactions History Table */}
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
            <h3 style={{ fontSize: 16 }}>Ledger Transactions</h3>

            {/* Filter pills */}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {['ALL', 'DEPOSIT', 'PURCHASE', 'HOLD', 'TRADE_CREDIT', 'WITHDRAW'].map((type) => (
                <button
                  key={type}
                  className={`btn-pill ${filterType === type ? 'active' : ''}`}
                  style={{
                    fontSize: 11,
                    padding: '3px 8px',
                    borderRadius: 'var(--radius-full)',
                    background: filterType === type ? 'var(--accent-orange)' : 'var(--bg-input)',
                    color: filterType === type ? '#fff' : 'var(--text-muted)'
                  }}
                  onClick={() => setFilterType(type)}
                >
                  {type}
                </button>
              ))}
            </div>
          </div>

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
                {filteredTransactions.map((tx) => (
                  <tr key={tx.id}>
                    <td>
                      <span
                        className={`badge ${
                          tx.type === 'DEPOSIT' || tx.type === 'TRADE_CREDIT'
                            ? 'badge-green'
                            : tx.type === 'HOLD'
                            ? 'badge-orange'
                            : tx.type === 'PURCHASE' || tx.type === 'WITHDRAW'
                            ? 'badge-red'
                            : 'badge-neutral'
                        }`}
                      >
                        {tx.type}
                      </span>
                    </td>
                    <td className="font-mono" style={{ fontWeight: 600 }}>
                      <span
                        style={{
                          color:
                            tx.amount > 0 && tx.type !== 'HOLD'
                              ? 'var(--accent-emerald)'
                              : tx.type === 'HOLD'
                              ? 'var(--accent-orange)'
                              : 'var(--accent-rose)'
                        }}
                      >
                        {tx.amount > 0 && tx.type !== 'HOLD' ? '+' : ''}
                        {tx.amount < 0 ? '−' : ''}
                        ${Math.abs(tx.amount).toFixed(2)}
                      </span>
                    </td>
                    <td>
                      <span
                        className={`badge ${
                          tx.status === 'Done' ? 'badge-neutral' : 'badge-orange'
                        }`}
                      >
                        {tx.status}
                      </span>
                    </td>
                    <td style={{ color: 'var(--text-dim)', fontSize: 12 }}>{tx.date}</td>
                    <td style={{ fontSize: 12, color: 'var(--text-sub)' }}>{tx.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right: Add/Withdraw Widget and Funds on Hold list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Add or Withdraw Form */}
          <div className="card">
            <h3 style={{ fontSize: 16, marginBottom: 12 }}>Add or Withdraw Funds</h3>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>
              Instant mock payment simulation for buyer checkout & seller payouts
            </p>

            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 12, color: 'var(--text-sub)', marginBottom: 6, fontWeight: 500 }}>
                Amount ($)
              </label>
              <input
                type="number"
                min="10"
                step="10"
                value={inputAmount}
                onChange={(e) => setInputAmount(e.target.value)}
                style={{ width: '100%', fontSize: 16, fontWeight: 600 }}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <button
                className="btn-primary"
                onClick={() => depositWallet(inputAmount)}
              >
                <ArrowDownLeft size={15} />
                <span>Deposit</span>
              </button>

              <button
                className="btn-secondary"
                onClick={() => withdrawWallet(inputAmount)}
              >
                <ArrowUpRight size={15} />
                <span>Withdraw</span>
              </button>
            </div>

            <p style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 12 }}>
              Withdrawals draw strictly from Available balance (${wallet.available.toFixed(2)}). Locked escrow funds cannot be withdrawn.
            </p>
          </div>

          {/* Funds on Hold Panel */}
          <div className="card">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <Lock size={15} color="var(--accent-orange)" />
              <h3 style={{ fontSize: 16 }}>Funds on Hold</h3>
            </div>

            {wallet.held > 0 ? (
              <div style={{ background: 'var(--bg-app)', padding: 14, borderRadius: 'var(--radius-md)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>Nightfall: Buy 2 at $106</span>
                  <span className="font-mono" style={{ color: 'var(--accent-orange)', fontWeight: 700 }}>
                    ${wallet.held.toFixed(2)}
                  </span>
                </div>
                <p style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 10 }}>
                  Funds locked in escrow order #ORD-8821. Released automatically when order fills or is cancelled.
                </p>
                <button
                  className="btn-danger-outline"
                  style={{ width: '100%', padding: '6px' }}
                  onClick={() => cancelOrder('ORD-8821')}
                >
                  Release Hold / Cancel Order
                </button>
              </div>
            ) : (
              <p style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                No active order holds. All your funds are available for trading.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
