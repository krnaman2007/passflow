import React, { useState, useEffect, useCallback } from 'react';
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
  AlertCircle,
  RefreshCw,
  CreditCard,
  Building,
  Smartphone,
  ShieldCheck,
  ExternalLink,
  ChevronRight,
  Sparkles
} from 'lucide-react';
import { getAuthToken } from '../services/api';

export default function WalletPage() {
  const {
    wallet,
    depositWallet,
    withdrawWallet,
    syncLiveWallet,
    fetchLiveWalletTransactions,
    userOrders,
    cancelOrder,
    currentUser,
    currentRole,
    login,
    showToast,
    navigate
  } = useApp();

  const [activeTab, setActiveTab] = useState('DEPOSIT'); // 'DEPOSIT' | 'WITHDRAW'
  const [inputAmount, setInputAmount] = useState('1000');
  const [paymentMethod, setPaymentMethod] = useState('UPI'); // 'UPI' | 'NETBANKING' | 'CARD'
  const [filterType, setFilterType] = useState('ALL');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [txSearch, setTxSearch] = useState('');

  // Initial fetch on mount
  const handleRefresh = useCallback(async (isManual = false) => {
    if (isManual) setIsRefreshing(true);
    try {
      if (syncLiveWallet) await syncLiveWallet();
      if (fetchLiveWalletTransactions) await fetchLiveWalletTransactions();
      if (isManual) {
        showToast('Escrow ledger & balances synchronized', 'info');
      }
    } catch (err) {
      console.warn('Sync failed:', err.message);
    } finally {
      if (isManual) setIsRefreshing(false);
    }
  }, [syncLiveWallet, fetchLiveWalletTransactions, showToast]);

  useEffect(() => {
    handleRefresh(false);
  }, [handleRefresh]);

  // Handle deposit
  const handleDeposit = async () => {
    const num = parseFloat(inputAmount);
    if (isNaN(num) || num <= 0) {
      showToast('Please enter a valid amount greater than ₹0', 'warning');
      return;
    }
    setIsSubmitting(true);
    try {
      const desc = paymentMethod === 'UPI'
        ? 'Instant UPI Deposit (VPA @okhdfcbank)'
        : paymentMethod === 'NETBANKING'
        ? 'NetBanking IMPS Fast Transfer'
        : 'Credit/Debit Card Settlement';

      await depositWallet(num, desc);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle withdrawal
  const handleWithdraw = async () => {
    const num = parseFloat(inputAmount);
    if (isNaN(num) || num <= 0) {
      showToast('Please enter a valid withdrawal amount', 'warning');
      return;
    }
    if (num > (wallet?.available || 0)) {
      showToast(`Requested withdrawal (₹${num.toLocaleString('en-IN')}) exceeds available funds (₹${Number(wallet?.available || 0).toLocaleString('en-IN')})`, 'error');
      return;
    }
    setIsSubmitting(true);
    try {
      await withdrawWallet(num, 'Direct IMPS Bank Payout to primary account');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Filter transactions
  const txList = wallet?.transactions || [];
  const filteredTransactions = txList.filter((tx) => {
    // Type Filter
    let matchesType = true;
    const t = String(tx.type || '').toUpperCase();
    if (filterType === 'DEPOSIT') matchesType = t.includes('DEPOSIT');
    else if (filterType === 'WITHDRAW') matchesType = t.includes('WITHDRAW');
    else if (filterType === 'PURCHASE') matchesType = t.includes('PURCHASE') || t.includes('BUY');
    else if (filterType === 'HOLD') matchesType = t.includes('HOLD');
    else if (filterType === 'TRADE_CREDIT') matchesType = t.includes('CREDIT') || t.includes('SETTLED') || t.includes('SELL');

    // Search query filter
    const matchesSearch = !txSearch.trim() ||
      String(tx.note || '').toLowerCase().includes(txSearch.toLowerCase()) ||
      String(tx.id || '').toLowerCase().includes(txSearch.toLowerCase()) ||
      String(tx.type || '').toLowerCase().includes(txSearch.toLowerCase());

    return matchesType && matchesSearch;
  });

  // Real open buy orders holding escrow funds
  const openBuyHolds = (userOrders || []).filter(
    (o) => (o.status === 'OPEN' || o.status === 'PENDING') && (o.side === 'BUY' || o.side === 'BID')
  );

  // Real Unauthenticated guard
  const hasToken = Boolean(getAuthToken());
  const isAuth = hasToken && currentUser && currentRole !== 'PUBLIC';

  if (!isAuth) {
    return (
      <div className="content-wrap" style={{ maxWidth: 640, margin: '60px auto', textAlign: 'center' }}>
        <div className="card" style={{ padding: '40px 28px', border: '1px solid var(--border-subtle)' }}>
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: '50%',
              background: 'rgba(249, 115, 22, 0.1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 20px auto',
              color: 'var(--accent-orange)'
            }}
          >
            <Wallet size={32} />
          </div>
          <h2 style={{ fontSize: 24, marginBottom: 8 }}>Authentication Required</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 24, lineHeight: 1.5 }}>
                        Sign in to access your escrow trading wallet, view your ledger balances, and manage deposits or withdrawals.
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button
              className="btn-primary"
              disabled={isRefreshing}
              onClick={async () => {
                setIsRefreshing(true);
                try {
                  await login('ali@passflow.com', 'Password123!');
                  await handleRefresh(false);
                } finally {
                  setIsRefreshing(false);
                }
              }}
              style={{ padding: '10px 20px', fontSize: 14 }}
            >
              {isRefreshing ? 'Authenticating...' : 'Sign In as Ali Khan (Demo)'}
            </button>
            <button
              className="btn-secondary"
              onClick={() => navigate('/login')}
              style={{ padding: '10px 20px', fontSize: 14 }}
            >
              Go to Login Page
            </button>
          </div>
        </div>
      </div>
    );
  }

  const balance = Number(wallet?.balance || 0);
  const held = Number(wallet?.held || 0);
  const available = Number(wallet?.available || 0);

  return (
    <div className="content-wrap">
      {/* Page Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24, flexWrap: 'wrap', gap: 16 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h1 style={{ fontSize: 28, margin: 0 }}>Escrow & Trading Wallet</h1>
            <span className="badge badge-green" style={{ fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <ShieldCheck size={12} />
              Atomic Ledger Active
            </span>
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4 }}>
            Secure escrow ledger that safely holds your funds during trades.
          </p>
        </div>

        <button
          className="btn-secondary"
          onClick={() => handleRefresh(true)}
          disabled={isRefreshing}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '8px 14px' }}
        >
          <RefreshCw size={14} className={isRefreshing ? 'spin' : ''} />
          <span>{isRefreshing ? 'Syncing...' : 'Sync Ledger'}</span>
        </button>
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
            ₹{balance.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>
            Includes available cash + active buy order escrows
          </div>
        </div>

        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Held in Escrow (Open Bids)
            </span>
            <Lock size={16} color="#f97316" />
          </div>
          <div className="font-mono" style={{ fontSize: 28, fontWeight: 700, color: 'var(--accent-orange)' }}>
            ₹{held.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>
            Reserved by matching engine for {openBuyHolds.length} open limit buy order{openBuyHolds.length === 1 ? '' : 's'}
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
            ₹{available.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>
            Ledger ₹{balance.toLocaleString('en-IN', { maximumFractionDigits: 0 })} − Reserved ₹{held.toLocaleString('en-IN', { maximumFractionDigits: 0 })} = Available ₹{available.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
          </div>
        </div>
      </div>

      {/* 2-Column Grid: Transactions Table on Left, Actions on Right */}
      <div className="detail-grid">
        {/* Left: Transactions History Table */}
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div
            style={{
              padding: '16px 20px',
              borderBottom: '1px solid var(--border-subtle)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 12
            }}
          >
            <div>
              <h3 style={{ fontSize: 16, margin: 0 }}>Ledger Audit Entries</h3>
              <p style={{ fontSize: 11, color: 'var(--text-dim)', margin: '2px 0 0 0' }}>
                Cryptographically tracked debit and credit events
              </p>
            </div>

            {/* Filter pills */}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {['ALL', 'DEPOSIT', 'PURCHASE', 'HOLD', 'TRADE_CREDIT', 'WITHDRAW'].map((type) => (
                <button
                  key={type}
                  className={`btn-pill ${filterType === type ? 'active' : ''}`}
                  style={{
                    fontSize: 11,
                    padding: '4px 10px',
                    borderRadius: 'var(--radius-full)',
                    background: filterType === type ? 'var(--accent-orange)' : 'var(--bg-input)',
                    color: filterType === type ? '#fff' : 'var(--text-muted)',
                    cursor: 'pointer',
                    border: 'none',
                    fontWeight: 500
                  }}
                  onClick={() => setFilterType(type)}
                >
                  {type === 'TRADE_CREDIT' ? 'CREDIT' : type}
                </button>
              ))}
            </div>
          </div>

          {/* Quick Search */}
          <div style={{ padding: '10px 20px', borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-card)' }}>
            <input
              type="text"
              placeholder="Search by transaction note, type, or ID..."
              value={txSearch}
              onChange={(e) => setTxSearch(e.target.value)}
              style={{
                width: '100%',
                padding: '7px 12px',
                fontSize: 12,
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border-subtle)',
                background: 'var(--bg-input)',
                color: 'var(--text-main)'
              }}
            />
          </div>

          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Amount (₹)</th>
                  <th>Status</th>
                  <th>Timestamp</th>
                  <th>Description / Audit Note</th>
                </tr>
              </thead>
              <tbody>
                {filteredTransactions.length > 0 ? (
                  filteredTransactions.map((tx) => {
                    const isPositive = Number(tx.amount) > 0 && String(tx.type).toUpperCase() !== 'HOLD';
                    const isHold = String(tx.type).toUpperCase().includes('HOLD');
                    const isNegative = Number(tx.amount) < 0;

                    return (
                      <tr key={tx.id}>
                        <td>
                          <span
                            className={`badge ${
                              String(tx.type).includes('DEPOSIT') || String(tx.type).includes('CREDIT')
                                ? 'badge-green'
                                : isHold
                                ? 'badge-orange'
                                : 'badge-neutral'
                            }`}
                            style={{ fontSize: 10, fontWeight: 600 }}
                          >
                            {tx.type}
                          </span>
                        </td>
                        <td className="font-mono" style={{ fontWeight: 600 }}>
                          <span
                            style={{
                              color: isPositive
                                ? 'var(--accent-emerald)'
                                : isHold
                                ? 'var(--accent-orange)'
                                : 'var(--accent-rose)'
                            }}
                          >
                            {isPositive ? '+' : ''}
                            {isNegative ? '−' : ''}
                            ₹{Math.abs(Number(tx.amount || 0)).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </span>
                        </td>
                        <td>
                          <span
                            className={`badge ${
                              tx.status === 'Done' || tx.status === 'COMPLETED' ? 'badge-neutral' : 'badge-orange'
                            }`}
                            style={{ fontSize: 10 }}
                          >
                            {tx.status || 'Done'}
                          </span>
                        </td>
                        <td style={{ color: 'var(--text-dim)', fontSize: 12, whiteSpace: 'nowrap' }}>
                          {tx.date}
                        </td>
                        <td style={{ fontSize: 12, color: 'var(--text-sub)' }}>
                          <div style={{ fontWeight: 500 }}>{tx.note}</div>
                          {tx.sequenceNumber && (
                            <span style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'monospace' }}>
                              Seq #{tx.sequenceNumber}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={5} style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-dim)' }}>
                      <AlertCircle size={24} style={{ margin: '0 auto 8px auto', display: 'block', opacity: 0.5 }} />
                      <div style={{ fontSize: 13, fontWeight: 500 }}>No ledger transactions match this filter.</div>
                      <div style={{ fontSize: 11, marginTop: 4 }}>
                        Deposit funds or trade on the order book to generate authoritative transactions.
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right: Add/Withdraw Widget and Funds on Hold list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Add or Withdraw Form */}
          <div className="card">
            {/* Tab Switcher */}
            <div
              style={{
                display: 'flex',
                background: 'var(--bg-input)',
                padding: 3,
                borderRadius: 'var(--radius-md)',
                marginBottom: 16
              }}
            >
              <button
                type="button"
                onClick={() => setActiveTab('DEPOSIT')}
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  borderRadius: 'var(--radius-sm)',
                  border: 'none',
                  background: activeTab === 'DEPOSIT' ? 'var(--accent-orange)' : 'transparent',
                  color: activeTab === 'DEPOSIT' ? '#fff' : 'var(--text-muted)',
                  fontWeight: 600,
                  fontSize: 13,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6
                }}
              >
                <ArrowDownLeft size={15} />
                <span>Deposit Funds</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('WITHDRAW')}
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  borderRadius: 'var(--radius-sm)',
                  border: 'none',
                  background: activeTab === 'WITHDRAW' ? 'var(--accent-orange)' : 'transparent',
                  color: activeTab === 'WITHDRAW' ? '#fff' : 'var(--text-muted)',
                  fontWeight: 600,
                  fontSize: 13,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6
                }}
              >
                <ArrowUpRight size={15} />
                <span>Withdraw Payout</span>
              </button>
            </div>

            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>
              {activeTab === 'DEPOSIT'
                ? 'Instant simulated gateway deposit. Balances reflect immediately on your trading wallet.'
                : 'Direct payout from your available balance. Escrow holds cannot be withdrawn until unlocked.'}
            </p>

            {/* Amount Input */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 12, color: 'var(--text-sub)', marginBottom: 6, fontWeight: 500 }}>
                Amount (₹ INR)
              </label>
              <input
                type="number"
                min="50"
                step="50"
                value={inputAmount}
                onChange={(e) => setInputAmount(e.target.value)}
                style={{ width: '100%', fontSize: 18, fontWeight: 700, padding: '10px 14px' }}
                placeholder="1000"
              />

              {/* Quick Preset Pills */}
              <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                {[500, 1000, 2500, 5000, 10000].map((amt) => (
                  <button
                    key={amt}
                    type="button"
                    onClick={() => setInputAmount(String(amt))}
                    style={{
                      padding: '3px 8px',
                      fontSize: 11,
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--border-subtle)',
                      background: inputAmount === String(amt) ? 'rgba(249, 115, 22, 0.15)' : 'var(--bg-input)',
                      color: inputAmount === String(amt) ? 'var(--accent-orange)' : 'var(--text-muted)',
                      cursor: 'pointer'
                    }}
                  >
                    +₹{amt.toLocaleString('en-IN')}
                  </button>
                ))}
              </div>
            </div>

            {/* Payment Method Selector */}
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', fontSize: 12, color: 'var(--text-sub)', marginBottom: 8, fontWeight: 500 }}>
                {activeTab === 'DEPOSIT' ? 'Payment Gateway Channel' : 'Payout Settlement Route'}
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                <button
                  type="button"
                  onClick={() => setPaymentMethod('UPI')}
                  style={{
                    padding: '8px 6px',
                    borderRadius: 'var(--radius-md)',
                    border: paymentMethod === 'UPI' ? '1px solid var(--accent-orange)' : '1px solid var(--border-subtle)',
                    background: paymentMethod === 'UPI' ? 'rgba(249, 115, 22, 0.08)' : 'var(--bg-input)',
                    color: paymentMethod === 'UPI' ? 'var(--accent-orange)' : 'var(--text-muted)',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 4
                  }}
                >
                  <Smartphone size={16} />
                  <span style={{ fontSize: 11, fontWeight: 600 }}>UPI Fast</span>
                </button>

                <button
                  type="button"
                  onClick={() => setPaymentMethod('NETBANKING')}
                  style={{
                    padding: '8px 6px',
                    borderRadius: 'var(--radius-md)',
                    border: paymentMethod === 'NETBANKING' ? '1px solid var(--accent-orange)' : '1px solid var(--border-subtle)',
                    background: paymentMethod === 'NETBANKING' ? 'rgba(249, 115, 22, 0.08)' : 'var(--bg-input)',
                    color: paymentMethod === 'NETBANKING' ? 'var(--accent-orange)' : 'var(--text-muted)',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 4
                  }}
                >
                  <Building size={16} />
                  <span style={{ fontSize: 11, fontWeight: 600 }}>NetBanking</span>
                </button>

                <button
                  type="button"
                  onClick={() => setPaymentMethod('CARD')}
                  style={{
                    padding: '8px 6px',
                    borderRadius: 'var(--radius-md)',
                    border: paymentMethod === 'CARD' ? '1px solid var(--accent-orange)' : '1px solid var(--border-subtle)',
                    background: paymentMethod === 'CARD' ? 'rgba(249, 115, 22, 0.08)' : 'var(--bg-input)',
                    color: paymentMethod === 'CARD' ? 'var(--accent-orange)' : 'var(--text-muted)',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 4
                  }}
                >
                  <CreditCard size={16} />
                  <span style={{ fontSize: 11, fontWeight: 600 }}>Cards</span>
                </button>
              </div>
            </div>

            {/* Action Submit Button */}
            {activeTab === 'DEPOSIT' ? (
              <button
                className="btn-primary"
                onClick={handleDeposit}
                disabled={isSubmitting}
                style={{ width: '100%', padding: '12px', fontSize: 14, fontWeight: 600 }}
              >
                {isSubmitting ? (
                  <span>Processing Gateway Deposit...</span>
                ) : (
                  <>
                    <ArrowDownLeft size={16} />
                    <span>Deposit ₹{Number(inputAmount || 0).toLocaleString('en-IN')} to Escrow</span>
                  </>
                )}
              </button>
            ) : (
              <button
                className="btn-secondary"
                onClick={handleWithdraw}
                disabled={isSubmitting || Number(inputAmount) > available}
                style={{
                  width: '100%',
                  padding: '12px',
                  fontSize: 14,
                  fontWeight: 600,
                  borderColor: 'var(--accent-orange)',
                  color: 'var(--accent-orange)'
                }}
              >
                {isSubmitting ? (
                  <span>Processing Direct Payout...</span>
                ) : (
                  <>
                    <ArrowUpRight size={16} />
                    <span>Withdraw ₹{Number(inputAmount || 0).toLocaleString('en-IN')} Payout</span>
                  </>
                )}
              </button>
            )}

            <p style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 12, lineHeight: 1.4 }}>
              {activeTab === 'DEPOSIT'
                ? 'Deposits are instantly verified and credited as unreserved available trading funds.'
                : `Withdrawals draw strictly from Available balance (₹${available.toLocaleString('en-IN', { minimumFractionDigits: 2 })}). Locked open order funds cannot be withdrawn.`}
            </p>
          </div>

          {/* Funds on Hold Panel */}
          <div className="card">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Lock size={15} color="var(--accent-orange)" />
                <h3 style={{ fontSize: 16, margin: 0 }}>Active Escrow Holds</h3>
              </div>
              <span className="badge badge-orange" style={{ fontSize: 10 }}>
                {openBuyHolds.length} Orders
              </span>
            </div>

            {openBuyHolds.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {openBuyHolds.map((ord) => {
                  const heldAmount = ord.heldAmount || (Number(ord.price || 0) * Number(ord.qty || 1));
                  return (
                    <div
                      key={ord.id}
                      style={{
                        background: 'var(--bg-app)',
                        padding: 14,
                        borderRadius: 'var(--radius-md)',
                        border: '1px solid var(--border-subtle)'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                        <span style={{ fontWeight: 600, fontSize: 13 }}>
                          {ord.eventName || 'Order Book Bid'}: {ord.qty}x {ord.tier}
                        </span>
                        <span className="font-mono" style={{ color: 'var(--accent-orange)', fontWeight: 700 }}>
                          ₹{Number(heldAmount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </span>
                      </div>
                      <p style={{ fontSize: 11, color: 'var(--text-dim)', margin: '0 0 10px 0' }}>
                        Locked in matching engine escrow for order #{ord.id ? (ord.id.slice ? ord.id.slice(0, 10) : ord.id) : ''}.
                      </p>
                      <button
                        className="btn-danger-outline"
                        style={{ width: '100%', padding: '6px 10px', fontSize: 12 }}
                        onClick={() => cancelOrder(ord.id)}
                      >
                        Cancel Bid & Unlock Escrow (₹{Number(heldAmount).toLocaleString('en-IN')})
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : held > 0 ? (
              <div style={{ background: 'var(--bg-app)', padding: 14, borderRadius: 'var(--radius-md)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>Matching Engine Reserve</span>
                  <span className="font-mono" style={{ color: 'var(--accent-orange)', fontWeight: 700 }}>
                    ₹{held.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </span>
                </div>
                <p style={{ fontSize: 11, color: 'var(--text-dim)', margin: 0 }}>
                  Funds locked in matching engine order book contracts. Released automatically upon order fulfillment or cancellation.
                </p>
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '16px 8px' }}>
                <CheckCircle2 size={24} color="#10b981" style={{ margin: '0 auto 8px auto', display: 'block' }} />
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-main)' }}>
                  Zero funds locked in escrow
                </div>
                <p style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4, marginBottom: 0 }}>
                  100% of your ledger balance is unlocked and available for trading or instant payout.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
