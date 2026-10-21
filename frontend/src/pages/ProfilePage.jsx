import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { User, ShieldCheck, KeyRound, Building, ArrowRight, CheckCircle2 } from 'lucide-react';

export default function ProfilePage() {
  const { currentUser, navigate, showToast } = useApp();

  const [name, setName] = useState(currentUser?.name || 'Ali K.');
  const [phone, setPhone] = useState(currentUser?.phone || '+91 98765 43210');
  const [kycSubmitted, setKycSubmitted] = useState(false);

  const handleSaveProfile = (e) => {
    e.preventDefault();
    showToast('Profile information updated successfully.', 'success');
  };

  const handleKycSubmit = () => {
    setKycSubmitted(true);
    showToast('KYC Identity Document submitted. Compliance approval pending.', 'info');
  };

  return (
    <div className="content-wrap" style={{ maxWidth: 840 }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 28, margin: 0 }}>Account & Identity (KYC)</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4 }}>
          Manage your trader profile, identity verification, and organizer authorization
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        {/* Profile Card */}
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <User size={18} color="var(--accent-orange)" />
            <h3 style={{ fontSize: 17 }}>Personal Details</h3>
          </div>

          <form onSubmit={handleSaveProfile}>
            <div className="grid-2" style={{ marginBottom: 16 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, color: 'var(--text-sub)', marginBottom: 6 }}>
                  Full Legal Name
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  style={{ width: '100%' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, color: 'var(--text-sub)', marginBottom: 6 }}>
                  Phone Number
                </label>
                <input
                  type="text"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  style={{ width: '100%' }}
                />
              </div>
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 12, color: 'var(--text-sub)', marginBottom: 6 }}>
                Email Address (Immutable)
              </label>
              <input
                type="email"
                disabled
                value={currentUser?.email || 'ali@example.com'}
                style={{ width: '100%', opacity: 0.7 }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button type="submit" className="btn-primary" style={{ padding: '8px 20px' }}>
                Save Profile
              </button>
            </div>
          </form>
        </div>

        {/* KYC Verification Card */}
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <ShieldCheck size={18} color="#10b981" />
              <h3 style={{ fontSize: 17 }}>Identity Verification (KYC)</h3>
            </div>

            <span className="badge badge-orange">
              STATUS: {kycSubmitted ? 'PENDING REVIEW' : currentUser?.kycStatus || 'PENDING'}
            </span>
          </div>

          <p style={{ fontSize: 13, color: 'var(--text-sub)', marginBottom: 16, lineHeight: 1.5 }}>
            To protect exchange liquidity and comply with anti-scalping resale laws, identity verification is required to unlock withdrawal limits exceeding $5,000/day.
          </p>

          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <button
              className="btn-primary"
              disabled={kycSubmitted || currentUser?.kycStatus === 'VERIFIED'}
              onClick={handleKycSubmit}
            >
              {currentUser?.kycStatus === 'VERIFIED' ? (
                <span>✓ Identity Fully Verified</span>
              ) : kycSubmitted ? (
                <span>Document Submitted (Pending Admin Approval)</span>
              ) : (
                <span>Submit KYC Document (Government ID)</span>
              )}
            </button>
          </div>
        </div>

        {/* Become an Organizer Banner */}
        <div
          className="card"
          style={{
            background: 'linear-gradient(135deg, rgba(249, 115, 22, 0.08), rgba(23, 27, 38, 0.95))',
            borderColor: 'var(--accent-orange-border)'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <Building size={18} color="var(--accent-orange)" />
                <h3 style={{ fontSize: 17 }}>Become an Organizer</h3>
                <span className="badge badge-orange">SELLER ACCESS</span>
              </div>
              <p style={{ fontSize: 13, color: 'var(--text-sub)', maxWidth: 520 }}>
                Looking to sell tickets for your own live events? Submit an application for admin approval to access the Organizer Console, publish events, and collect box office payouts.
              </p>
            </div>

            <button
              className="btn-primary"
              onClick={() => navigate('/organizer/apply')}
            >
              <span>Apply for Organizer</span>
              <ArrowRight size={14} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
