import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import {
  FileText,
  ArrowRight,
  XCircle,
  RefreshCw,
  TrendingUp,
  Receipt,
  Clock,
  CheckCircle2,
  Lock,
  Zap,
  Inbox,
  AlertCircle
} from 'lucide-react';

export default function OrdersHistoryPage() {
  const {
    userOrders,
    cancelOrder,
    fetchLiveOrders,
    wallet,
    currentRole,
    login,
    api,
    showToast
  } = useApp();

  const [tab, setTab] = useState('ORDERS'); // 'ORDERS' | 'TRADES' | 'TRANSACTIONS'
  const [trades, setTrades] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [cancellingId, setCancellingId] = useState(null);

  const fetchHistoryData = async () => {
    setLoading(true);
    try {
      // 1. Fetch live orders
      if (typeof fetchLiveOrders === 'function') {
        await fetchLiveOrders();
      }

      // 2. Fetch live executed trades from PostgreSQL
      try {
        const tradesRes = await api.trades.getMyTrades();
        const rawTrades = tradesRes?.data?.trades || tradesRes?.trades || [];
        if (Array.isArray(rawTrades)) {
          setTrades(
            rawTrades.map((t) => {
              const dateObj = t.executedAt ? new Date(t.executedAt) : new Date();
              const dateStr = dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
              const timeStr = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
              const priceVal = t.price != null ? Number(t.price) / (Number(t.price) > 1000 ? 100 : 1) : 0;
              const totalVal = t.totalAmount != null ? Number(t.totalAmount) : (priceVal * (t.quantity || 1));
              return {
                id: t.tradeId || t.id,
                tradeId: (t.tradeId || t.id).slice ? (t.tradeId || t.id).slice(0, 10) : t.tradeId,
                eventName: t.eventName || t.event?.name || 'Live Event',
                tier: t.categoryName || t.ticketCategory?.name || 'General Admission',
                side: t.side === 'BID' || t.side === 'BUY' ? 'BUY' : 'SELL',
                price: priceVal,
                quantity: t.quantity || 1,
                totalAmount: totalVal,
                settlementStatus: t.settlementStatus || 'SETTLED',
                time: `${dateStr}, ${timeStr}`,
              };
            })
          );
        }
      } catch (err) {
        console.warn('Trades fetch deferred:', err.message);
      }

      // 3. Fetch live wallet ledger transactions
      try {
        const txRes = await api.wallet.getTransactions();
        const rawTx = txRes?.data?.transactions || txRes?.transactions || [];
        if (Array.isArray(rawTx) && rawTx.length > 0) {
          setTransactions(
            rawTx.map((tx) => ({
              id: tx.id,
              type: tx.type || tx.entryType || 'TRANSACTION',
              amount: tx.amount != null ? Number(tx.amount) / 100 : 0,
              status: tx.status || 'Done',
              date: tx.createdAt ? new Date(tx.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'Today',
              note: tx.description || tx.note || 'Escrow ledger mutation',
            }))
          );
        } else if (wallet?.transactions && wallet.transactions.length > 0) {
          setTransactions(wallet.transactions);
        }
      } catch (err) {
        console.warn('Transactions fetch deferred:', err.message);
        if (wallet?.transactions) setTransactions(wallet.transactions);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHistoryData();
  }, []);

  const handleManualRefresh = async () => {
    await fetchHistoryData();
    showToast('Orders, trades, and ledger refreshed from PostgreSQL', 'success');
  };

  const handleCancelOrder = async (orderId) => {
    setCancellingId(orderId);
    try {
      await cancelOrder(orderId);
    } finally {
      setCancellingId(null);
    }
  };

  return (
    <div className="content-wrap" style={{ maxWidth: 1080, paddingTop: 28 }}>
      {/* Visitor Notice / 1-Click Login if Public */}
      {currentRole === 'PUBLIC' && (
        <div
          className="card"
          style={{
            background: 'linear-gradient(135deg, rgba(249, 115, 22, 0.08), rgba(23, 27, 38, 0.95))',
            borderColor: 'var(--accent-orange-border)',
            marginBottom: 20,
            padding: 16,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 12
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Lock size={18} color="var(--accent-orange)" />
            <div>
              <strong style={{ fontSize: 13, color: 'var(--text-main)' }}>
                Authenticated Account Required
              </strong>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Sign in to view your live orders, matched trade executions, and custodial escrow ledger.
              </div>
            </div>
          </div>
          <button
            className="btn-primary"
            style={{ fontSize: 12, padding: '7px 14px' }}
            onClick={async () => {
              try {
                await login('ali@passflow.com', 'Password123!');
                showToast('Signed in as Ali Khan (ali@passflow.com)', 'success');
                fetchHistoryData();
              } catch (err) {
                showToast(err.message || 'Login failed', 'error');
              }
            }}
          >
            <Zap size={14} />
            <span>1-Click Sign in as Ali Khan</span>
          </button>
        </div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h1 style={{ fontSize: 26, margin: 0 }}>Orders & Trade History</h1>
            <span className="badge badge-green font-mono" style={{ fontSize: 10 }}>
              LIVE ORDER BOOK
            </span>
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4 }}>
            Authoritative ledger of open limit orders, matching engine fills, and escrow settlements from PostgreSQL
          </p>
        </div>

        <button
          className="btn-secondary"
          onClick={handleManualRefresh}
          disabled={loading}
          style={{ fontSize: 12, padding: '7px 14px', display: 'flex', alignItems: 'center', gap: 6 }}
          title="Refresh latest orders and trades"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          <span>{loading ? 'Refreshing...' : 'Refresh History'}</span>
        </button>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {[
          { id: 'ORDERS', label: `Active & Past Orders (${(userOrders || []).length})` },
          { id: 'TRADES', label: `Executed Trades (${trades.length})` },
          { id: 'TRANSACTIONS', label: `Wallet Transactions (${transactions.length})` }
        ].map((t) => (
          <button
            key={t.id}
            className={`btn-pill ${tab === t.id ? 'active' : ''}`}
            style={{
              padding: '8px 18px',
              borderRadius: 'var(--radius-sm)',
              fontWeight: 600,
              fontSize: 13,
              background: tab === t.id ? 'var(--bg-card)' : 'var(--bg-surface)',
              color: tab === t.id ? 'var(--accent-orange)' : 'var(--text-muted)',
              border: '1px solid',
              borderColor: tab === t.id ? 'var(--accent-orange-border)' : 'var(--border-subtle)',
              cursor: 'pointer',
              transition: 'all 0.15s ease'
            }}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {/* ===================== TAB 1: ORDERS ===================== */}
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
                {(userOrders || []).length === 0 ? (
                  <tr>
                    <td colSpan={10} style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-muted)' }}>
                      <Inbox size={32} color="var(--text-dim)" style={{ margin: '0 auto 8px auto', display: 'block' }} />
                      <strong style={{ color: 'var(--text-main)', fontSize: 14 }}>No orders found</strong>
                      <div style={{ fontSize: 12, marginTop: 4 }}>
                        Place limit bids or asks on the <a href="/market/coldplay-mumbai/general" style={{ color: 'var(--accent-orange)' }}>Market Page</a> to trade tickets.
                      </div>
                    </td>
                  </tr>
                ) : (
                  userOrders.map((ord) => (
                    <tr key={ord.id}>
                      <td className="font-mono" style={{ fontSize: 12 }}>
                        {ord.id.slice ? ord.id.slice(0, 10) : ord.id}
                      </td>
                      <td style={{ fontWeight: 600 }}>{ord.eventName}</td>
                      <td>{ord.tier}</td>
                      <td>
                        <span className={`badge ${ord.side === 'BUY' ? 'badge-green' : 'badge-red'}`}>
                          {ord.side}
                        </span>
                      </td>
                      <td className="font-mono font-semibold" style={{ color: 'var(--text-main)' }}>
                        ₹{Number(ord.price).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>
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
                            style={{ padding: '3px 8px', fontSize: 11 }}
                            disabled={cancellingId === ord.id}
                            onClick={() => handleCancelOrder(ord.id)}
                          >
                            {cancellingId === ord.id ? 'Cancelling...' : 'Cancel'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* ===================== TAB 2: EXECUTED TRADES ===================== */}
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
                  <th>Total Amount</th>
                  <th>Settlement Status</th>
                  <th>Timestamp</th>
                </tr>
              </thead>
              <tbody>
                {trades.length === 0 ? (
                  <tr>
                    <td colSpan={9} style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-muted)' }}>
                      <TrendingUp size={32} color="var(--text-dim)" style={{ margin: '0 auto 8px auto', display: 'block' }} />
                      <strong style={{ color: 'var(--text-main)', fontSize: 14 }}>No executed trades yet</strong>
                      <div style={{ fontSize: 12, marginTop: 4 }}>
                        When your bids or asks match on the order book, the atomic execution will appear here.
                      </div>
                    </td>
                  </tr>
                ) : (
                  trades.map((tr) => (
                    <tr key={tr.id} className="font-mono">
                      <td style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                        {tr.tradeId}
                      </td>
                      <td style={{ fontWeight: 600, fontFamily: 'var(--font-sans)', color: 'var(--text-main)' }}>
                        {tr.eventName}
                      </td>
                      <td style={{ fontFamily: 'var(--font-sans)' }}>{tr.tier}</td>
                      <td>
                        <span className={`badge ${tr.side === 'BUY' ? 'badge-green' : 'badge-red'}`}>
                          {tr.side}
                        </span>
                      </td>
                      <td style={{ color: tr.side === 'BUY' ? 'var(--accent-emerald)' : 'var(--accent-rose)', fontWeight: 600 }}>
                        ₹{Number(tr.price).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>
                      <td>{tr.quantity}</td>
                      <td style={{ fontWeight: 600 }}>
                        ₹{Number(tr.totalAmount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>
                      <td>
                        <span className="badge badge-green">
                          {tr.settlementStatus === 'SETTLED' ? 'SETTLED IN ESCROW' : tr.settlementStatus}
                        </span>
                      </td>
                      <td style={{ color: 'var(--text-dim)', fontSize: 12 }}>{tr.time}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* ===================== TAB 3: WALLET TRANSACTIONS ===================== */}
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
                {transactions.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-muted)' }}>
                      <Receipt size={32} color="var(--text-dim)" style={{ margin: '0 auto 8px auto', display: 'block' }} />
                      <strong style={{ color: 'var(--text-main)', fontSize: 14 }}>No wallet transactions</strong>
                      <div style={{ fontSize: 12, marginTop: 4 }}>
                        Deposits, withdrawals, and escrow hold records will be logged here.
                      </div>
                    </td>
                  </tr>
                ) : (
                  transactions.map((tx) => (
                    <tr key={tx.id}>
                      <td>
                        <span className={`badge ${
                          tx.type.includes('DEPOSIT') || tx.type === 'CREDIT'
                            ? 'badge-green'
                            : tx.type.includes('WITHDRAW') || tx.type === 'DEBIT'
                            ? 'badge-red'
                            : 'badge-neutral'
                        }`}>
                          {tx.type}
                        </span>
                      </td>
                      <td className="font-mono" style={{ fontWeight: 600, color: tx.amount < 0 ? 'var(--accent-rose)' : 'var(--accent-emerald)' }}>
                        {tx.amount < 0 ? '-' : '+'}₹{Math.abs(tx.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>
                      <td>
                        <span className="badge badge-green">{tx.status || 'Done'}</span>
                      </td>
                      <td style={{ color: 'var(--text-dim)', fontSize: 12 }}>{tx.date}</td>
                      <td style={{ color: 'var(--text-sub)' }}>{tx.note}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
