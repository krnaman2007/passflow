import React from 'react';
import { useApp } from '../context/AppContext';
import { ShieldCheck, Layers, CheckCircle2, ArrowLeft, ExternalLink } from 'lucide-react';

export default function SolvencyVerifyPage() {
  const { adminData, navigate } = useApp();
  const { solvency } = adminData;

  return (
    <div className="content-wrap" style={{ maxWidth: 780 }}>
      <button
        className="btn-secondary"
        style={{ marginBottom: 20, padding: '6px 12px', fontSize: 12 }}
        onClick={() => navigate('/events')}
      >
        <ArrowLeft size={14} />
        <span>Return to Marketplace</span>
      </button>

      <div className="card" style={{ borderColor: 'var(--accent-emerald-border)', marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 'var(--radius-md)',
              background: 'var(--accent-emerald-subtle)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <ShieldCheck size={26} color="#10b981" />
          </div>
          <div>
            <h1 style={{ fontSize: 24, margin: 0 }}>Cryptographic Proof of Solvency</h1>
            <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 2 }}>
              Public Merkle Reserve Verification · Auditor Verified: {solvency.verifiedDate}
            </p>
          </div>
        </div>

        <div className="grid-2" style={{ marginBottom: 20 }}>
          <div style={{ background: 'var(--bg-app)', padding: 18, borderRadius: 'var(--radius-md)' }}>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
              Total Verified Assets
            </span>
            <div className="font-mono" style={{ fontSize: 28, fontWeight: 700, color: 'var(--accent-emerald)', marginTop: 4 }}>
              ${solvency.assets.toLocaleString()}
            </div>
            <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>Custodied in FDIC escrow bank</span>
          </div>

          <div style={{ background: 'var(--bg-app)', padding: 18, borderRadius: 'var(--radius-md)' }}>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
              Total User Liabilities
            </span>
            <div className="font-mono" style={{ fontSize: 28, fontWeight: 700, color: 'var(--text-main)', marginTop: 4 }}>
              ${solvency.liabilities.toLocaleString()}
            </div>
            <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>User wallet balances + open order holds</span>
          </div>
        </div>

        <div style={{ background: 'rgba(16, 185, 129, 0.08)', padding: 16, borderRadius: 'var(--radius-md)', marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <CheckCircle2 size={18} color="#10b981" />
            <strong style={{ fontSize: 14, color: 'var(--accent-emerald)' }}>
              100% Full Reserve Guarantee ({solvency.ratio}%)
            </strong>
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-sub)', lineHeight: 1.5 }}>
            PassFlow Exchange operates with full backing. All buyer funds deposited into the exchange are matched 1:1 with escrow liquidity. No re-hypothecation or algorithmic fractioning.
          </p>
        </div>

        <div>
          <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>
            Current Merkle Tree Root Hash
          </label>
          <div
            style={{
              background: 'var(--bg-app)',
              padding: 12,
              borderRadius: 'var(--radius-sm)',
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
              color: 'var(--text-sub)',
              wordBreak: 'break-all'
            }}
          >
            {solvency.merkleRoot}
          </div>
        </div>
      </div>
    </div>
  );
}
