import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { ProfileSkeleton } from '../components/Skeleton';
import {
  User,
  ShieldCheck,
  KeyRound,
  Building,
  ArrowRight,
  CheckCircle2,
  RefreshCw,
  AlertCircle,
  Clock,
  Lock,
  Wallet,
  Sparkles,
  Save,
  Phone,
  Mail,
  FileText
} from 'lucide-react';

export default function ProfilePage() {
  const {
    currentUser,
    currentRole,
    authLoading,
    navigate,
    showToast,
    login,
    updateUserProfile,
    submitUserKyc,
    changeUserPassword,
    refreshUserProfile,
    wallet
  } = useApp();

  // Profile Form State
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [profileBio, setProfileBio] = useState('');
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // KYC Form State
  const [docType, setDocType] = useState('PAN_CARD');
  const [docNumber, setDocNumber] = useState('');
  const [isSubmittingKyc, setIsSubmittingKyc] = useState(false);

  // Password Form State
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isChangingPassword, setIsChangingPassword] = useState(false);

  // Sync state with currentUser whenever loaded
  useEffect(() => {
    if (currentUser) {
      setName(currentUser.name || '');
      setPhone(currentUser.phone || '');
      setProfileBio(currentUser.profile || '');
    }
  }, [currentUser]);

  // Refresh profile from backend
  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await refreshUserProfile();
      showToast('Profile data refreshed from database', 'info');
    } catch (err) {
      showToast('Failed to refresh: ' + err.message, 'error');
    } finally {
      setIsRefreshing(false);
    }
  };

  // Save Personal Details
  const handleSaveProfile = async (e) => {
    e.preventDefault();
    if (!name.trim()) {
      showToast('Full Name cannot be empty', 'error');
      return;
    }

    setIsSavingProfile(true);
    try {
      await updateUserProfile({
        name: name.trim(),
        phone: phone.trim() || undefined,
        profile: profileBio.trim() || undefined,
      });
    } catch (err) {
      // Toast shown in AppContext
    } finally {
      setIsSavingProfile(false);
    }
  };

  // Submit KYC Document
  const handleKycSubmit = async (e) => {
    e.preventDefault();
    if (!docNumber.trim()) {
      showToast('Please provide a document identifier number', 'error');
      return;
    }

    setIsSubmittingKyc(true);
    try {
      await submitUserKyc({
        documentType: docType,
        documentNumber: docNumber.trim(),
      });
      setDocNumber('');
    } catch (err) {
      // Toast shown in AppContext
    } finally {
      setIsSubmittingKyc(false);
    }
  };

  // Change Password
  const handleChangePassword = async (e) => {
    e.preventDefault();
    if (!oldPassword) {
      showToast('Current password is required', 'error');
      return;
    }
    if (newPassword.length < 6) {
      showToast('New password must be at least 6 characters long', 'error');
      return;
    }
    if (newPassword !== confirmPassword) {
      showToast('New passwords do not match', 'error');
      return;
    }

    setIsChangingPassword(true);
    try {
      await changeUserPassword({
        oldPassword,
        newPassword,
      });
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      // Toast shown in AppContext
    } finally {
      setIsChangingPassword(false);
    }
  };

  // 1. Session Restoring Guard
  if (authLoading && !currentUser) {
    return <ProfileSkeleton />;
  }

  // 2. Visitor / Unauthenticated Guard
  if (!currentUser || currentRole === 'PUBLIC') {
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
            Please log in or register to manage your personal profile, identity credentials, security settings, and organizer roles.
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
              Create an Account
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
            <p style={{ marginBottom: 12 }}>Explore with a demo account:</p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
              <button
                className="btn-secondary"
                style={{ fontSize: 12, padding: '6px 14px' }}
                onClick={() => login('ali@passflow.com', 'Password123!')}
              >
                <Sparkles size={13} color="var(--accent-orange)" />
                <span>Sign In as Ali Khan (Trader/Organizer)</span>
              </button>
              <button
                className="btn-secondary"
                style={{ fontSize: 12, padding: '6px 14px' }}
                onClick={() => login('admin@passflow.com', 'Password123!')}
              >
                <ShieldCheck size={13} color="var(--accent-emerald)" />
                <span>Sign In as Admin</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Real KYC status from database
  const kycStatus = currentUser?.buyerSeller?.kycStatus || currentUser?.kycStatus || 'UNVERIFIED';

  return (
    <div className="content-wrap" style={{ maxWidth: 840 }}>
      {/* Top Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 700, margin: 0 }}>Account & Identity (KYC)</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4 }}>
            Manage your legal profile, identity credentials, security, and organizer status
          </p>
        </div>

        <button
          className="btn-secondary"
          disabled={isRefreshing}
          onClick={handleRefresh}
          style={{ display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <RefreshCw size={14} className={isRefreshing ? 'spin' : ''} />
          <span>{isRefreshing ? 'Syncing...' : 'Sync Profile'}</span>
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        {/* User Profile Summary Hero Card */}
        <div
          className="card"
          style={{
            background: 'linear-gradient(135deg, rgba(249, 115, 22, 0.05), rgba(23, 27, 38, 0.98))',
            padding: 24
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <div
                style={{
                  width: 58,
                  height: 58,
                  borderRadius: '50%',
                  background: 'linear-gradient(135deg, var(--accent-orange), #ea580c)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 24,
                  fontWeight: 700,
                  color: '#fff',
                  boxShadow: '0 4px 12px rgba(249, 115, 22, 0.25)'
                }}
              >
                {currentUser.avatar || 'U'}
              </div>

              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>
                    {currentUser.name || 'PassFlow User'}
                  </h2>
                  <span className="badge badge-orange font-mono" style={{ fontSize: 11 }}>
                    ROLE: {currentUser.role || currentRole || 'USER'}
                  </span>
                  {kycStatus === 'VERIFIED' ? (
                    <span className="badge badge-green font-mono" style={{ fontSize: 11 }}>
                      <CheckCircle2 size={12} style={{ display: 'inline', marginRight: 4 }} />
                      KYC VERIFIED
                    </span>
                  ) : kycStatus === 'PENDING' ? (
                    <span className="badge badge-orange font-mono" style={{ fontSize: 11 }}>
                      <Clock size={12} style={{ display: 'inline', marginRight: 4 }} />
                      KYC PENDING
                    </span>
                  ) : (
                    <span className="badge badge-neutral font-mono" style={{ fontSize: 11 }}>
                      KYC UNVERIFIED
                    </span>
                  )}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 6, fontSize: 12, color: 'var(--text-sub)' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Mail size={13} />
                    {currentUser.email}
                  </span>
                  {currentUser.phone && (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <Phone size={13} />
                      {currentUser.phone}
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <button
                className="btn-secondary"
                onClick={() => navigate('/wallet')}
                style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}
              >
                <Wallet size={14} color="var(--accent-orange)" />
                <span>Wallet: ₹{wallet?.available ? wallet.available.toLocaleString('en-IN') : '0.00'}</span>
              </button>
            </div>
          </div>
        </div>

        {/* 1. Personal Details Card */}
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
            <User size={18} color="var(--accent-orange)" />
            <h3 style={{ fontSize: 17, fontWeight: 600, margin: 0 }}>Personal & Contact Details</h3>
          </div>

          <form onSubmit={handleSaveProfile}>
            <div className="grid-2" style={{ marginBottom: 18 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, color: 'var(--text-sub)', marginBottom: 6, fontWeight: 500 }}>
                  Full Legal Name <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Ali Khan"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  style={{ width: '100%', fontSize: 14 }}
                  disabled={isSavingProfile}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, color: 'var(--text-sub)', marginBottom: 6, fontWeight: 500 }}>
                  Phone Number
                </label>
                <input
                  type="text"
                  placeholder="e.g. +91 98765 43210"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  style={{ width: '100%', fontSize: 14 }}
                  disabled={isSavingProfile}
                />
              </div>
            </div>

            <div style={{ marginBottom: 18 }}>
              <label style={{ display: 'block', fontSize: 12, color: 'var(--text-sub)', marginBottom: 6, fontWeight: 500 }}>
                Bio / Trader Tagline
              </label>
              <input
                type="text"
                placeholder="e.g. Live music collector and EDM enthusiast"
                value={profileBio}
                onChange={(e) => setProfileBio(e.target.value)}
                style={{ width: '100%', fontSize: 14 }}
                disabled={isSavingProfile}
              />
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', fontSize: 12, color: 'var(--text-sub)', marginBottom: 6, fontWeight: 500 }}>
                Email Address (Permanent Account Identifier)
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  type="email"
                  disabled
                  value={currentUser?.email || ''}
                  style={{ width: '100%', fontSize: 14, opacity: 0.75, cursor: 'not-allowed' }}
                />
                <span style={{ position: 'absolute', right: 12, top: 12, fontSize: 12, color: 'var(--text-dim)' }}>
                  Immutable
                </span>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="submit"
                className="btn-primary"
                disabled={isSavingProfile}
                style={{ padding: '8px 24px', display: 'flex', alignItems: 'center', gap: 6 }}
              >
                {isSavingProfile ? (
                  <>
                    <RefreshCw size={14} className="spin" />
                    <span>Saving...</span>
                  </>
                ) : (
                  <>
                    <Save size={14} />
                    <span>Save Profile Changes</span>
                  </>
                )}
              </button>
            </div>
          </form>
        </div>

        {/* 2. Identity Verification (KYC) Card */}
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <ShieldCheck size={20} color={kycStatus === 'VERIFIED' ? '#10b981' : 'var(--accent-orange)'} />
              <h3 style={{ fontSize: 17, fontWeight: 600, margin: 0 }}>Identity Verification (KYC)</h3>
            </div>

            <span
              className={`badge ${
                kycStatus === 'VERIFIED'
                  ? 'badge-green'
                  : kycStatus === 'PENDING'
                  ? 'badge-orange'
                  : 'badge-neutral'
              }`}
            >
              STATUS: {kycStatus}
            </span>
          </div>

          <p style={{ fontSize: 13, color: 'var(--text-sub)', marginBottom: 20, lineHeight: 1.6 }}>
            To comply with anti-scalping laws, prevent sybil bot attacks, and protect peer-to-peer liquidity, identity verification is required to unlock withdrawal limits exceeding ₹50,000/day.
          </p>

          {kycStatus === 'VERIFIED' ? (
            <div
              style={{
                background: 'rgba(16, 185, 129, 0.08)',
                border: '1px solid var(--accent-emerald-border)',
                padding: 16,
                borderRadius: 'var(--radius-sm)',
                display: 'flex',
                alignItems: 'center',
                gap: 12
              }}
            >
              <CheckCircle2 size={22} color="#10b981" style={{ flexShrink: 0 }} />
              <div>
                <div style={{ fontWeight: 600, color: 'var(--accent-emerald)', fontSize: 14 }}>
                  Identity Fully Verified
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-sub)', marginTop: 2 }}>
                  Your government ID is approved. You have full peer-to-peer trading privileges and unlimited daily fiat withdrawals.
                </div>
              </div>
            </div>
          ) : kycStatus === 'PENDING' ? (
            <div
              style={{
                background: 'rgba(249, 115, 22, 0.08)',
                border: '1px solid var(--accent-orange-border)',
                padding: 16,
                borderRadius: 'var(--radius-sm)',
                display: 'flex',
                alignItems: 'center',
                gap: 12
              }}
            >
              <Clock size={22} color="var(--accent-orange)" style={{ flexShrink: 0 }} />
              <div>
                <div style={{ fontWeight: 600, color: 'var(--accent-orange)', fontSize: 14 }}>
                  Document Submitted — Pending Compliance Review
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-sub)', marginTop: 2 }}>
                  Your verification credentials have been logged in the system. The PassFlow compliance board evaluates submissions within 24 hours.
                </div>
              </div>
            </div>
          ) : (
            <form onSubmit={handleKycSubmit}>
              <div className="grid-2" style={{ marginBottom: 16 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, color: 'var(--text-sub)', marginBottom: 6, fontWeight: 500 }}>
                    Government Document Type <span style={{ color: '#ef4444' }}>*</span>
                  </label>
                  <select
                    value={docType}
                    onChange={(e) => setDocType(e.target.value)}
                    style={{ width: '100%', fontSize: 14 }}
                    disabled={isSubmittingKyc}
                  >
                    <option value="PAN_CARD">PAN Card (India)</option>
                    <option value="AADHAAR">Aadhaar Card (UIDAI)</option>
                    <option value="PASSPORT">Passport (International)</option>
                    <option value="DRIVERS_LICENSE">Driver's License</option>
                    <option value="VOTER_ID">Voter ID</option>
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12, color: 'var(--text-sub)', marginBottom: 6, fontWeight: 500 }}>
                    Document / Identity Number <span style={{ color: '#ef4444' }}>*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. ABCDE1234F or Passport #"
                    value={docNumber}
                    onChange={(e) => setDocNumber(e.target.value)}
                    style={{ width: '100%', fontSize: 14 }}
                    disabled={isSubmittingKyc}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={isSubmittingKyc}
                  style={{ padding: '8px 20px', display: 'flex', alignItems: 'center', gap: 6 }}
                >
                  {isSubmittingKyc ? (
                    <>
                      <RefreshCw size={14} className="spin" />
                      <span>Submitting KYC to Backend...</span>
                    </>
                  ) : (
                    <>
                      <ShieldCheck size={14} />
                      <span>Submit KYC Verification</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          )}
        </div>

        {/* 3. Security & Password Update Card */}
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
            <KeyRound size={18} color="var(--accent-orange)" />
            <h3 style={{ fontSize: 17, fontWeight: 600, margin: 0 }}>Security & Password Management</h3>
          </div>

          <form onSubmit={handleChangePassword}>
            <div className="grid-3" style={{ marginBottom: 18 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, color: 'var(--text-sub)', marginBottom: 6, fontWeight: 500 }}>
                  Current Password <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <input
                  type="password"
                  required
                  placeholder="••••••••"
                  value={oldPassword}
                  onChange={(e) => setOldPassword(e.target.value)}
                  style={{ width: '100%', fontSize: 14 }}
                  disabled={isChangingPassword}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, color: 'var(--text-sub)', marginBottom: 6, fontWeight: 500 }}>
                  New Password <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <input
                  type="password"
                  required
                  placeholder="Min 6 characters"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  style={{ width: '100%', fontSize: 14 }}
                  disabled={isChangingPassword}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, color: 'var(--text-sub)', marginBottom: 6, fontWeight: 500 }}>
                  Confirm New Password <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <input
                  type="password"
                  required
                  placeholder="Re-enter new password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  style={{ width: '100%', fontSize: 14 }}
                  disabled={isChangingPassword}
                />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="submit"
                className="btn-secondary"
                disabled={isChangingPassword}
                style={{ padding: '8px 20px', display: 'flex', alignItems: 'center', gap: 6 }}
              >
                {isChangingPassword ? (
                  <>
                    <RefreshCw size={14} className="spin" />
                    <span>Updating Password...</span>
                  </>
                ) : (
                  <>
                    <Lock size={14} />
                    <span>Update Account Password</span>
                  </>
                )}
              </button>
            </div>
          </form>
        </div>

        {/* 4. Organizer Status Card */}
        {currentUser?.organizer?.verificationStatus === 'VERIFIED' ? (
          <div
            className="card"
            style={{
              background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.08), rgba(23, 27, 38, 0.95))',
              borderColor: 'rgba(16, 185, 129, 0.3)'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <Building size={18} color="#10b981" />
                  <h3 style={{ fontSize: 17, margin: 0, fontWeight: 600 }}>Organizer Console Active</h3>
                  <span className="badge badge-green">VERIFIED</span>
                </div>
                <p style={{ fontSize: 13, color: 'var(--text-sub)', maxWidth: 520, margin: '6px 0 0 0' }}>
                  Organization: <strong style={{ color: 'var(--text-main)' }}>{currentUser.organizer.organizationName}</strong>. You have full publisher rights to mint tickets and manage primary box office drops.
                </p>
              </div>

              <button
                className="btn-primary"
                onClick={() => navigate('/organizer')}
              >
                <span>Open Organizer Console</span>
                <ArrowRight size={14} />
              </button>
            </div>
          </div>
        ) : currentUser?.organizer?.verificationStatus === 'PENDING' ? (
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
                  <h3 style={{ fontSize: 17, margin: 0, fontWeight: 600 }}>Organizer Application Under Review</h3>
                  <span className="badge badge-orange">PENDING APPROVAL</span>
                </div>
                <p style={{ fontSize: 13, color: 'var(--text-sub)', maxWidth: 520, margin: '6px 0 0 0' }}>
                  Organization: <strong style={{ color: 'var(--text-main)' }}>{currentUser.organizer.organizationName}</strong>. Your credential application is currently being evaluated by PassFlow compliance admins.
                </p>
              </div>

              <button
                className="btn-primary"
                onClick={() => navigate('/organizer/apply')}
              >
                <span>Check Status</span>
                <ArrowRight size={14} />
              </button>
            </div>
          </div>
        ) : (
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
                  <h3 style={{ fontSize: 17, margin: 0, fontWeight: 600 }}>Become an Organizer</h3>
                  <span className="badge badge-orange">SELLER ACCESS</span>
                </div>
                <p style={{ fontSize: 13, color: 'var(--text-sub)', maxWidth: 520, margin: '6px 0 0 0' }}>
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
        )}
      </div>
    </div>
  );
}
