import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { api } from '../services/api';
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
  AlertCircle,
  X,
  ShieldCheck,
} from 'lucide-react';

export default function OrdersHistoryPage() {
  const {
    userOrders,
    cancelOrder,
    fetchLiveOrders,
    wallet,
    currentUser,
    currentRole,
    authLoading,
    login,
    showToast,
    navigate,
  } = useApp();

  const [tab, setTab] = useState('ORDERS'); // 'ORDERS' | 'TRADES' | 'TRANSACTIONS'
  const [trades, setTrades] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [cancellingId, setCancellingId] = useState(null);

  // Trade & Settlement details modal states (GET /trades/:id, GET /settlements/:id, GET /escrows/:id)
  const [selectedTrade, setSelectedTrade] = useState(null);
  const [tradeDetails, setTradeDetails] = useState(null);
  const [loadingDetails, setLoadingDetails] = useState(false);

  const handleOpenTradeDetails = async (trade) => {
    setSelectedTrade(trade);
    setLoadingDetails(true);
    setTradeDetails(null);
    try {
      const [tradeRes, settlementRes] = await Promise.allSettled([
        api.trades.getTradeById(trade.id),
        api.trades.getSettlementById(trade.id),
      ]);

      const tData = tradeRes.status === 'fulfilled' ? tradeRes.value?.data || tradeRes.value : null;
      const sData = settlementRes.status === 'fulfilled' ? settlementRes.value?.data || settlementRes.value : null;

      let eData = null;
      const lookupOrderId = tData?.orderId || trade.orderId;
      if (lookupOrderId) {
        try {
          const escrowRes = await api.trades.getEscrowById(lookupOrderId);
          eData = escrowRes?.data || escrowRes;
        } catch {
          // Escrow hold released upon execution settlement
        }
      }

      setTradeDetails({
        trade: tData || trade,
        settlement: sData?.settlement || tData?.settlement || sData,
        escrow: eData,
      });
    } catch (err) {
      console.warn('Could not load complete trade details:', err);
    } finally {
      setLoadingDetails(false);
    }
  };

  // Order details modal states (GET /orders/:id, GET /orders/:id/trades)
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [orderDetails, setOrderDetails] = useState(null);
  const [loadingOrderDetails, setLoadingOrderDetails] = useState(false);

  const handleOpenOrderDetails = async (ord) => {
    setSelectedOrder(ord);
    setLoadingOrderDetails(true);
    setOrderDetails(null);
    try {
      const [orderRes, tradesRes] = await Promise.allSettled([
        api.orders.getOrderById(ord.id),
        api.orders.getOrderTrades(ord.id),
      ]);

      const oData = orderRes.status === 'fulfilled' ? orderRes.value?.data || orderRes.value : null;
      const tData = tradesRes.status === 'fulfilled' ? tradesRes.value?.data?.trades || tradesRes.value?.trades || [] : [];

      setOrderDetails({
        order: oData || ord,
        trades: tData,
      });
    } catch (err) {
      console.warn('Could not load order details:', err);
    } finally {
      setLoadingOrderDetails(false);
    }
  };

  const fetchHistoryData = async () => {
    if (!currentUser || currentRole === 'PUBLIC') {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      // 1. Fetch live orders (/history/orders)
      if (typeof fetchLiveOrders === 'function') {
        await fetchLiveOrders();
      }

      // 2. Fetch live executed trades from PostgreSQL (/history/trades)
      try {
        const tradesRes = await (api.history?.getTrades ? api.history.getTrades() : api.trades.getMyTrades());
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

      // 3. Fetch live financial transaction history from PostgreSQL (/history/transactions)
      try {
        const txRes = await (api.history?.getTransactions ? api.history.getTransactions() : api.wallet.getTransactions());
        const rawTx = txRes?.data?.transactions || txRes?.transactions || [];
        if (Array.isArray(rawTx) && rawTx.length > 0) {
          setTransactions(
            rawTx.map((tx) => {
              // history.service normalizes ledger entries or TransactionHistory records
              let finalAmount = 0;
              if (tx.amount != null) {
                const num = Number(tx.amount);
                // If amount is greater than 100000 and amountPaise is present, it's paise
                finalAmount = num > 10000 && tx.amountPaise ? num / 100 : num;
              }
              return {
                id: tx.id,
                type: tx.type || tx.entryType || 'TRANSACTION',
                amount: finalAmount,
                status: tx.status || 'COMPLETED',
                date: tx.createdAt ? new Date(tx.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'Today',
                note: tx.description || tx.note || 'Escrow ledger mutation',
              };
            })
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

  // 1. Session Restoring Guard
  if (authLoading) {
    return (
      <div className="content-wrap" style={{ maxWidth: 640, textAlign: 'center', padding: '80px 24px', margin: '40px auto' }}>
        <RefreshCw size={32} className="spin" style={{ margin: '0 auto 16px', display: 'block', color: 'var(--brand-primary, #6366f1)' }} />
        <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8, color: 'var(--text-main)' }}>Restoring Ledger...</h3>
        <p style={{ color: 'var(--text-sub)', fontSize: 14 }}>Retrieving orders and trade history</p>
      </div>
    );
  }

  const effectiveRole = currentUser ? (currentUser.role || 'USER') : (currentRole || 'PUBLIC');

  // 2. Visitor / Unauthenticated Guard
  if (!currentUser || effectiveRole === 'PUBLIC') {
    return (
      <div className="content-wrap" style={{ maxWidth: 640 }}>
        <div className="card" style={{ textAlign: 'center', padding: '40px 24px', marginTop: 20 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: '50%',
              background: 'rgba(239, 68, 68, 0.1)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 16
            }}
          >
            <Lock size={26} color="#ef4444" />
          </div>

          <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>
            Authentication Required
          </h2>
          <p style={{ color: 'var(--text-sub)', fontSize: 14, maxWidth: 440, margin: '0 auto 24px' }}>
            Sign in to view your live orders, matched trade executions, and custodial escrow ledger.
          </p>

          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button
              className="btn-primary"
              style={{ padding: '10px 20px', fontSize: 14 }}
              onClick={() => navigate('/login')}
            >
              Sign In to Your Account
            </button>
            <button
              className="btn-secondary"
              style={{ padding: '10px 20px', fontSize: 14 }}
              onClick={() => navigate('/register')}
            >
              Create Account
            </button>
          </div>

          <div
            style={{
              marginTop: 32,
              paddingTop: 24,
              borderTop: '1px solid var(--border-subtle)',
              fontSize: 13,
              color: 'var(--text-muted)'
            }}
          >
            <p style={{ marginBottom: 12 }}>1-Click demo authentication:</p>
            <button
              className="btn-secondary"
              style={{ fontSize: 12, padding: '6px 14px' }}
              onClick={async () => {
                try {
                  await login('ali@passflow.com', 'Password123!');
                  showToast('Signed in as Ali Khan', 'success');
                  fetchHistoryData();
                } catch (err) {
                  showToast(err.message || 'Login failed', 'error');
                }
              }}
            >
              <Zap size={13} color="var(--accent-orange)" />
              <span>1-Click Sign In as Ali Khan</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="content-wrap" style={{ maxWidth: 1080, paddingTop: 28 }}>

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
                        Place limit bids or asks on the{' '}
                        <button
                          type="button"
                          onClick={() => navigate('/market')}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: 'var(--accent-orange)',
                            cursor: 'pointer',
                            textDecoration: 'underline',
                            padding: 0,
                            font: 'inherit',
                          }}
                        >
                          Market Page
                        </button>{' '}
                        to trade tickets.
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
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          <button
                            className="btn-secondary"
                            style={{ padding: '3px 8px', fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 3 }}
                            onClick={() => handleOpenOrderDetails(ord)}
                            title="View Order Details & Associated Trades"
                          >
                            <FileText size={11} />
                            <span>Details</span>
                          </button>
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
                        </div>
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
                  <th>Receipt</th>
                </tr>
              </thead>
              <tbody>
                {trades.length === 0 ? (
                  <tr>
                    <td colSpan={10} style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-muted)' }}>
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
                      <td>
                        <button
                          className="btn-secondary"
                          style={{ padding: '3px 8px', fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 4 }}
                          onClick={() => handleOpenTradeDetails(tr)}
                          title="View Trade, Settlement and Escrow Receipt"
                        >
                          <Receipt size={12} />
                          <span>Receipt</span>
                        </button>
                      </td>
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

      {/* Trade & Settlement Receipt Modal (GET /trades/:id, GET /settlements/:id, GET /escrows/:id) */}
      {selectedTrade && (
        <div className="modal-overlay" onClick={() => setSelectedTrade(null)}>
          <div
            className="modal-card"
            style={{ maxWidth: 540, width: '92%', maxHeight: '88vh', overflowY: 'auto' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Receipt size={20} color="var(--brand-primary, #6366f1)" />
                <h3 style={{ fontSize: 18, margin: 0 }}>Trade & Settlement Receipt</h3>
              </div>
              <button
                className="btn-icon"
                onClick={() => setSelectedTrade(null)}
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}
              >
                <X size={18} />
              </button>
            </div>

            {loadingDetails ? (
              <div style={{ textAlign: 'center', padding: '40px 0' }}>
                <RefreshCw size={24} className="spin" style={{ margin: '0 auto 8px auto', display: 'block', color: 'var(--brand-primary, #6366f1)' }} />
                <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Retrieving cryptographic settlement & escrow receipt...</p>
              </div>
            ) : (
              <div>
                <div style={{ background: 'rgba(255, 255, 255, 0.03)', padding: 14, borderRadius: 'var(--radius-md, 8px)', marginBottom: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Execution ID:</span>
                    <span className="font-mono" style={{ fontSize: 12, color: 'var(--text-main)' }}>
                      {tradeDetails?.trade?.id || selectedTrade.id}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Event & Category:</span>
                    <strong style={{ fontSize: 13, color: 'var(--text-main)' }}>
                      {selectedTrade.eventName} · {selectedTrade.tier}
                    </strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Your Execution Role:</span>
                    <span className="badge badge-blue font-mono" style={{ fontSize: 11 }}>
                      {tradeDetails?.trade?.role || 'TAKER'} ({selectedTrade.side})
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Execution Price & Quantity:</span>
                    <span className="font-mono" style={{ fontWeight: 600, color: 'var(--text-main)' }}>
                      {selectedTrade.quantity}x @ ₹{Number(selectedTrade.price).toLocaleString('en-IN', { minimumFractionDigits: 2 })} = ₹{Number(selectedTrade.totalAmount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                </div>

                {/* Settlement State Block (GET /settlements/:id) */}
                <div style={{ marginBottom: 16 }}>
                  <h4 style={{ fontSize: 13, textTransform: 'uppercase', color: 'var(--text-dim)', letterSpacing: '0.05em', marginBottom: 8 }}>
                    Settlement Status
                  </h4>
                  <div style={{ padding: 12, borderRadius: 'var(--radius-sm, 6px)', background: 'rgba(16, 185, 129, 0.06)', border: '1px solid rgba(16, 185, 129, 0.2)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <ShieldCheck size={16} color="var(--accent-emerald)" />
                        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent-emerald)' }}>
                          {tradeDetails?.settlement?.status || tradeDetails?.trade?.settlementStatus || 'SETTLED'}
                        </span>
                      </div>
                      <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                        {tradeDetails?.settlement?.settledAt ? new Date(tradeDetails.settlement.settledAt).toLocaleTimeString() : selectedTrade.time}
                      </span>
                    </div>
                    {tradeDetails?.settlement?.priceImprovementPaise && Number(tradeDetails.settlement.priceImprovementPaise) > 0 && (
                      <div style={{ fontSize: 11, color: 'var(--accent-emerald)', marginTop: 6 }}>
                        ⚡ Price Improvement: ₹{(Number(tradeDetails.settlement.priceImprovementPaise) / 100).toFixed(2)} saved!
                      </div>
                    )}
                  </div>
                </div>

                {/* Escrow Status Block (GET /escrows/:id) */}
                {tradeDetails?.escrow && (
                  <div style={{ marginBottom: 16 }}>
                    <h4 style={{ fontSize: 13, textTransform: 'uppercase', color: 'var(--text-dim)', letterSpacing: '0.05em', marginBottom: 8 }}>
                      Escrow Hold Record
                    </h4>
                    <div style={{ padding: 12, borderRadius: 'var(--radius-sm, 6px)', background: 'rgba(255, 255, 255, 0.02)', border: '1px solid var(--border-subtle)', fontSize: 12 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                        <span style={{ color: 'var(--text-muted)' }}>Escrow Hold Status:</span>
                        <span className="badge badge-neutral">{tradeDetails.escrow.status || 'RELEASED'}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: 'var(--text-muted)' }}>Hold Reason:</span>
                        <span>{tradeDetails.escrow.reason || 'ORDER_ESCROW'}</span>
                      </div>
                    </div>
                  </div>
                )}

                <button
                  className="btn-primary"
                  style={{ width: '100%', marginTop: 8 }}
                  onClick={() => setSelectedTrade(null)}
                >
                  Close Receipt
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Order Details & Associated Trades Modal (GET /orders/:id, GET /orders/:id/trades) */}
      {selectedOrder && (
        <div className="modal-overlay" onClick={() => setSelectedOrder(null)}>
          <div
            className="modal-card"
            style={{ maxWidth: 560, width: '92%', maxHeight: '88vh', overflowY: 'auto' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <FileText size={20} color="var(--brand-primary, #6366f1)" />
                <h3 style={{ fontSize: 18, margin: 0 }}>Order Details & Trades</h3>
              </div>
              <button
                className="btn-icon"
                onClick={() => setSelectedOrder(null)}
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}
              >
                <X size={18} />
              </button>
            </div>

            {loadingOrderDetails ? (
              <div style={{ textAlign: 'center', padding: '40px 0' }}>
                <RefreshCw size={24} className="spin" style={{ margin: '0 auto 8px auto', display: 'block', color: 'var(--brand-primary, #6366f1)' }} />
                <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Retrieving order details and fill executions...</p>
              </div>
            ) : (
              <div>
                <div style={{ background: 'rgba(255, 255, 255, 0.03)', padding: 14, borderRadius: 'var(--radius-md, 8px)', marginBottom: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Order ID:</span>
                    <span className="font-mono" style={{ fontSize: 12, color: 'var(--text-main)' }}>
                      {orderDetails?.order?.id || selectedOrder.id}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Event & Tier:</span>
                    <strong style={{ fontSize: 13, color: 'var(--text-main)' }}>
                      {selectedOrder.eventName} · {selectedOrder.tier}
                    </strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Side & Status:</span>
                    <div>
                      <span className={`badge ${selectedOrder.side === 'BUY' ? 'badge-green' : 'badge-red'}`} style={{ marginRight: 6 }}>
                        {selectedOrder.side}
                      </span>
                      <span className="badge badge-neutral">{orderDetails?.order?.status || selectedOrder.status}</span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Limit Price:</span>
                    <span className="font-mono" style={{ fontWeight: 600 }}>
                      ₹{Number(selectedOrder.price).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Quantity Filled / Total:</span>
                    <span className="font-mono">
                      {orderDetails?.order?.filledQuantity != null ? orderDetails.order.filledQuantity : selectedOrder.filled} / {orderDetails?.order?.initialQuantity != null ? orderDetails.order.initialQuantity : selectedOrder.qty}
                    </span>
                  </div>
                </div>

                {/* Trades produced by this order (GET /orders/:id/trades) */}
                <div style={{ marginBottom: 16 }}>
                  <h4 style={{ fontSize: 13, textTransform: 'uppercase', color: 'var(--text-dim)', letterSpacing: '0.05em', marginBottom: 8 }}>
                    Trades Produced by this Order ({orderDetails?.trades?.length || 0})
                  </h4>
                  {!orderDetails?.trades || orderDetails.trades.length === 0 ? (
                    <div style={{ padding: 16, borderRadius: 'var(--radius-sm, 6px)', background: 'rgba(255, 255, 255, 0.02)', border: '1px solid var(--border-subtle)', textAlign: 'center', fontSize: 12, color: 'var(--text-muted)' }}>
                      No matching executions have filled this order yet.
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {orderDetails.trades.map((tr, idx) => (
                        <div
                          key={tr.id || idx}
                          style={{
                            padding: '10px 12px',
                            borderRadius: 'var(--radius-sm, 6px)',
                            background: 'rgba(255, 255, 255, 0.03)',
                            border: '1px solid var(--border-subtle)',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            fontSize: 12,
                          }}
                        >
                          <div>
                            <div className="font-mono" style={{ fontWeight: 600, color: 'var(--text-main)' }}>
                              Trade #{tr.sequenceNumber || (tr.id ? tr.id.slice(0, 8) : idx + 1)}
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>
                              {tr.executedAt ? new Date(tr.executedAt).toLocaleTimeString() : 'Executed'}
                            </div>
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            <div className="font-mono" style={{ fontWeight: 600, color: 'var(--accent-emerald)' }}>
                              {tr.quantity}x @ ₹{Number(tr.price).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                            </div>
                            <span className="badge badge-green" style={{ fontSize: 10, marginTop: 2 }}>
                              {tr.settlementStatus || 'SETTLED'}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <button
                  className="btn-primary"
                  style={{ width: '100%', marginTop: 8 }}
                  onClick={() => setSelectedOrder(null)}
                >
                  Close Details
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
