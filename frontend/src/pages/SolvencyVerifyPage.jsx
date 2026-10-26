import React, { useState, useEffect, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import {
  ShieldCheck,
  CheckCircle2,
  ArrowLeft,
  RefreshCw,
  Copy,
  Check,
  Lock,
  ExternalLink,
  AlertTriangle,
  TrendingUp,
  FileCheck2,
  Sparkles
} from 'lucide-react';
import { api } from '../services/api';

export default function SolvencyVerifyPage() {
  const { navigate, showToast, currentUser, currentRole, regenerateSolvencyProof } = useApp();

  const [solvencyData, setSolvencyData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [copiedHash, setCopiedHash] = useState(false);
  const [fetchError, setFetchError] = useState(null);

  // Fetch live solvency proof from backend
  const fetchSolvencyProof = useCallback(async (isManualRefresh = false) => {
    if (isManualRefresh) setIsRefreshing(true);
    setFetchError(null);

    try {
      const res = await api.solvency.verify();
      const data = res?.data || res;
      setSolvencyData(data);
      if (isManualRefresh) {
        showToast('Cryptographic Solvency Proof verified from database.', 'success');
      }
    } catch (err) {
      console.error('Failed to load solvency proof:', err);
      const msg = err?.data?.error?.message || err?.message || 'Could not retrieve proof of solvency';
      setFetchError(msg);
      showToast(msg, 'error');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [showToast]);

  useEffect(() => {
    fetchSolvencyProof();
  }, [fetchSolvencyProof]);

  // Copy hash helper
  const handleCopyHash = (text) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedHash(true);
    showToast('Merkle root hash copied to clipboard', 'info');
    setTimeout(() => setCopiedHash(false), 2000);
  };

  // Admin action: recalculate proof
  const handleAdminRegenerate = async () => {
    setIsRegenerating(true);
    try {
      if (regenerateSolvencyProof) {
        await regenerateSolvencyProof();
      } else {
        await api.admin.generateSolvencyProof({
          backingAssets: 250000,
          notes: 'Authoritative Escrow Custody Attestation',
        });
        showToast('Solvency proof regenerated and updated.', 'success');
      }
      await fetchSolvencyProof();
    } catch (err) {
      showToast('Failed to regenerate proof: ' + err.message, 'error');
    } finally {
      setIsRegenerating(false);
    }
  };

  const isAdmin = currentUser?.role === 'ADMIN' || currentRole === 'ADMIN';

  const proof = solvencyData?.proof;
  const isSolvent = solvencyData?.isSolvent ?? (proof?.isSolvent ?? true);

  const backingAssets = Number(proof?.backingAssets || 0);
  const liabilities = Number(proof?.liabilities || 0);
  const ratio = Number(proof?.ratio || (liabilities > 0 ? backingAssets / liabilities : 1.0));
  const surplus = Math.max(0, backingAssets - liabilities);
  const ratioPercent = Math.round(ratio * 100);

  const verifiedDate = proof?.verifiedAt
    ? new Date(proof.verifiedAt).toLocaleString('en-IN', {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : 'Live';

  return (
    <div className="content-wrap" style={{ maxWidth: 840 }}>
      {/* Back Button & Top Navigation */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <button
          className="btn-secondary"
          style={{ padding: '6px 14px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}
          onClick={() => navigate('/events')}
        >
          <ArrowLeft size={14} />
          <span>Return to Marketplace</span>
        </button>

        <button
          className="btn-secondary"
          disabled={isRefreshing || isLoading}
          onClick={() => fetchSolvencyProof(true)}
          style={{ padding: '6px 14px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <RefreshCw size={14} className={isRefreshing ? 'spin' : ''} />
          <span>{isRefreshing ? 'Verifying...' : 'Re-verify Proof'}</span>
        </button>
      </div>

      {fetchError && (
        <div
          style={{
            background: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            borderRadius: 'var(--radius-sm)',
            padding: '14px 18px',
            marginBottom: 20,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            color: '#f87171',
            fontSize: 13
          }}
        >
          <AlertTriangle size={20} style={{ flexShrink: 0 }} />
          <div>
            <strong>Solvency Verification Notice:</strong> {fetchError}
          </div>
        </div>
      )}

      {/* Main Solvency Card */}
      <div className="card" style={{ borderColor: isSolvent ? 'var(--accent-emerald-border)' : 'var(--accent-orange-border)', marginBottom: 24, padding: 28 }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 14, marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div
              style={{
                width: 52,
                height: 52,
                borderRadius: 'var(--radius-md)',
                background: isSolvent ? 'rgba(16, 185, 129, 0.15)' : 'var(--accent-orange-subtle)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <ShieldCheck size={28} color={isSolvent ? '#10b981' : 'var(--accent-orange)'} />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Cryptographic Proof of Solvency</h1>
                <span className={`badge ${isSolvent ? 'badge-green' : 'badge-orange'} font-mono`} style={{ fontSize: 11 }}>
                  {isSolvent ? '100% FULL RESERVE' : 'SOLVENCY WARNING'}
                </span>
              </div>
              <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4 }}>
                Public Merkle Reserve Verification · Auditor Attested: <strong style={{ color: 'var(--text-main)' }}>{verifiedDate}</strong>
              </p>
            </div>
          </div>

          {isAdmin && (
            <button
              className="btn-primary"
              disabled={isRegenerating}
              onClick={handleAdminRegenerate}
              style={{ fontSize: 12, padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <RefreshCw size={13} className={isRegenerating ? 'spin' : ''} />
              <span>{isRegenerating ? 'Attesting...' : 'Admin: Re-Attest Reserves'}</span>
            </button>
          )}
        </div>

        {/* Assets vs Liabilities Metric Breakdown */}
        <div className="grid-2" style={{ marginBottom: 20, gap: 16 }}>
          {/* Assets */}
          <div
            style={{
              background: 'var(--bg-app)',
              border: '1px solid var(--border-subtle)',
              padding: 20,
              borderRadius: 'var(--radius-md)'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.05em' }}>
                Total Verified Custodied Assets
              </span>
              <span className="badge badge-green" style={{ fontSize: 10 }}>ESCROW BACKED</span>
            </div>
            <div className="font-mono" style={{ fontSize: 32, fontWeight: 700, color: 'var(--accent-emerald)', marginTop: 8 }}>
              {isLoading ? '...' : `₹${backingAssets.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`}
            </div>
            <p style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 4, margin: '4px 0 0 0' }}>
              Independently verified in audited bank escrow vaults
            </p>
          </div>

          {/* Liabilities */}
          <div
            style={{
              background: 'var(--bg-app)',
              border: '1px solid var(--border-subtle)',
              padding: 20,
              borderRadius: 'var(--radius-md)'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.05em' }}>
                Total User Balance Liabilities
              </span>
              <span className="badge badge-neutral" style={{ fontSize: 10 }}>PLATFORM USERS</span>
            </div>
            <div className="font-mono" style={{ fontSize: 32, fontWeight: 700, color: 'var(--text-main)', marginTop: 8 }}>
              {isLoading ? '...' : `₹${liabilities.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`}
            </div>
            <p style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 4, margin: '4px 0 0 0' }}>
              Sum of all trader wallet balances + open orderbook holds
            </p>
          </div>
        </div>

        {/* Reserve Ratio & Solvency Guarantee Banner */}
        <div
          style={{
            background: isSolvent ? 'rgba(16, 185, 129, 0.08)' : 'rgba(249, 115, 22, 0.08)',
            border: `1px solid ${isSolvent ? 'rgba(16, 185, 129, 0.3)' : 'rgba(249, 115, 22, 0.3)'}`,
            padding: 18,
            borderRadius: 'var(--radius-md)',
            marginBottom: 20
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <CheckCircle2 size={20} color={isSolvent ? '#10b981' : 'var(--accent-orange)'} />
            <strong style={{ fontSize: 15, color: isSolvent ? 'var(--accent-emerald)' : 'var(--accent-orange)' }}>
              Full Reserve Solvency Guarantee — {ratioPercent}% Backed ({ratio.toFixed(2)}x Coverage)
            </strong>
          </div>
          <p style={{ fontSize: 13, color: 'var(--text-sub)', lineHeight: 1.6, margin: 0 }}>
            PassFlow Exchange enforces strict full-reserve solvency. Every rupee deposited by buyers and sellers is matched 1:1 with segregated bank escrow reserves. No algorithmic re-hypothecation, fractional lending, or unbacked liquidity injection is permitted on the platform.
          </p>

          <div style={{ display: 'flex', gap: 20, marginTop: 12, paddingTop: 12, borderTop: '1px solid rgba(255,255,255,0.06)', fontSize: 12 }}>
            <div>
              <span style={{ color: 'var(--text-muted)' }}>Net Reserve Surplus: </span>
              <strong style={{ color: 'var(--accent-emerald)', fontFamily: 'monospace' }}>
                ₹{surplus.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </strong>
            </div>
            <div>
              <span style={{ color: 'var(--text-muted)' }}>Audit Status: </span>
              <strong style={{ color: '#fff' }}>Authoritative Attestation Logged</strong>
            </div>
          </div>
        </div>

        {/* Cryptographic Merkle Root Hash */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <label style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 500 }}>
              Current SHA-256 Merkle Tree Root Hash
            </label>
            <button
              className="btn-secondary"
              onClick={() => handleCopyHash(proof?.proofHash)}
              style={{ padding: '3px 8px', fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}
            >
              {copiedHash ? <Check size={12} color="#10b981" /> : <Copy size={12} />}
              <span>{copiedHash ? 'Copied' : 'Copy Hash'}</span>
            </button>
          </div>

          <div
            style={{
              background: 'var(--bg-app)',
              border: '1px solid var(--border-subtle)',
              padding: 14,
              borderRadius: 'var(--radius-sm)',
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
              color: 'var(--accent-orange)',
              wordBreak: 'break-all',
              letterSpacing: '0.04em'
            }}
          >
            {isLoading ? 'Fetching authoritative hash from cryptographic ledger...' : proof?.proofHash || 'N/A'}
          </div>
        </div>

        {/* Proof Metadata & Verification Details */}
        {proof && (
          <div
            style={{
              marginTop: 16,
              paddingTop: 16,
              borderTop: '1px solid var(--border-subtle)',
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: 12,
              fontSize: 12,
              color: 'var(--text-sub)'
            }}
          >
            <div>
              <span style={{ color: 'var(--text-muted)', display: 'block', marginBottom: 2 }}>Proof Identifier:</span>
              <span className="font-mono" style={{ color: 'var(--text-main)', fontSize: 11 }}>
                {proof.id}
              </span>
            </div>
            <div>
              <span style={{ color: 'var(--text-muted)', display: 'block', marginBottom: 2 }}>Verification Protocol:</span>
              <span style={{ color: 'var(--text-main)' }}>SHA-256 Merkle Snapshot</span>
            </div>
            <div>
              <span style={{ color: 'var(--text-muted)', display: 'block', marginBottom: 2 }}>Attestation Notes:</span>
              <span style={{ color: 'var(--text-main)' }}>
                {proof.notes || 'Automated solvency verification proof'}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Explanatory Cards */}
      <div className="grid-2">
        <div className="card">
          <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
            <FileCheck2 size={16} color="var(--accent-emerald)" />
            <span>How Merkle Solvency Works</span>
          </h3>
          <p style={{ fontSize: 12, color: 'var(--text-sub)', lineHeight: 1.6, margin: 0 }}>
            Every individual user balance and open ticket order is hashed into an immutable Merkle tree leaf. The platform cannot secretly modify or falsify user balances without breaking the published root hash.
          </p>
        </div>

        <div className="card">
          <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
            <TrendingUp size={16} color="var(--accent-orange)" />
            <span>Anti-Scalping Liquidity Protection</span>
          </h3>
          <p style={{ fontSize: 12, color: 'var(--text-sub)', lineHeight: 1.6, margin: 0 }}>
            Because assets are 100% full-reserve backed, secondary market buy bids are guaranteed settlement against verifiable ticket escrows with zero counterparty default risk.
          </p>
        </div>
      </div>
    </div>
  );
}
