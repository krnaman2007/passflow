import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { ProfileSkeleton } from '../components/Skeleton';
import {
  Building,
  ArrowLeft,
  CheckCircle2,
  ShieldCheck,
  Clock,
  AlertTriangle,
  RefreshCw,
  ExternalLink,
  Sparkles,
  Lock,
  ArrowRight
} from 'lucide-react';
import { api } from '../services/api';

export default function OrganizerApplyPage() {
  const { applyForOrganizer, navigate, currentUser, currentRole, authLoading, login, showToast } = useApp();

  const [orgName, setOrgName] = useState('');
  const [website, setWebsite] = useState('');
  const [volume, setVolume] = useState('₹1,00,000 - ₹5,00,000/month');
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Prefill default or existing info if available
  useEffect(() => {
    if (currentUser?.organizer?.organizationName) {
      setOrgName(currentUser.organizer.organizationName);
    } else if (currentUser?.name && !orgName) {
      setOrgName(`${currentUser.name} Events`);
    }
  }, [currentUser]);

  const organizerStatus = currentUser?.organizer?.verificationStatus;

  // Refresh status from backend
  const handleRefreshStatus = async () => {
    setIsRefreshing(true);
    try {
      const res = await api.auth.getProfile();
      const updatedUser = res?.data || res;
      if (updatedUser) {
        showToast('Profile and organizer status refreshed', 'info');
      }
    } catch (err) {
      showToast('Could not refresh status: ' + err.message, 'error');
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitError(null);

    if (!orgName.trim() || orgName.trim().length < 2) {
      setSubmitError('Organization name must be at least 2 characters.');
      return;
    }

    setIsSubmitting(true);
    try {
      await applyForOrganizer({
        orgName: orgName.trim(),
        email: currentUser?.email,
        website: website.trim(),
        volume,
        description: description.trim(),
      });
      setSubmitSuccess(true);
    } catch (err) {
      const msg = err?.data?.error?.message || err?.message || 'Failed to submit organizer application';
      setSubmitError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  // 1. Session Restoring Guard
  if (authLoading && !currentUser) {
    return <ProfileSkeleton />;
  }

  // 2. Unauthenticated / Guest View
  if (!currentUser || currentRole === 'PUBLIC') {
    return (
      <div className="content-wrap" style={{ maxWidth: 640 }}>
        <button
          className="btn-secondary"
          style={{ marginBottom: 20, padding: '6px 12px', fontSize: 12 }}
          onClick={() => navigate('/events')}
        >
          <ArrowLeft size={14} />
          <span>Back to Events</span>
        </button>

        <div className="card" style={{ textAlign: 'center', padding: '40px 24px' }}>
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
            To protect exchange security and link box office payouts to verified legal entities, you must sign in before submitting an organizer application.
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
            <p style={{ marginBottom: 12 }}>Testing or exploring PassFlow?</p>
            <button
              className="btn-secondary"
              style={{ fontSize: 12, padding: '6px 14px' }}
              onClick={() => login('ali@passflow.com', 'Password123!')}
            >
              <Sparkles size={13} color="var(--accent-orange)" />
              <span>1-Click Sign In as Ali (Test User)</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 2. Already Verified Organizer
  if (organizerStatus === 'VERIFIED') {
    return (
      <div className="content-wrap" style={{ maxWidth: 680 }}>
        <button
          className="btn-secondary"
          style={{ marginBottom: 20, padding: '6px 12px', fontSize: 12 }}
          onClick={() => navigate('/profile')}
        >
          <ArrowLeft size={14} />
          <span>Back to Profile</span>
        </button>

        <div
          className="card"
          style={{
            background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.08), rgba(23, 27, 38, 0.98))',
            borderColor: 'rgba(16, 185, 129, 0.3)',
            padding: 32
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
            <div
              style={{
                width: 52,
                height: 52,
                borderRadius: 'var(--radius-md)',
                background: 'rgba(16, 185, 129, 0.15)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <CheckCircle2 size={28} color="#10b981" />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Verified Organizer</h1>
                <span className="badge badge-green" style={{ fontSize: 11 }}>
                  VERIFIED & ACTIVE
                </span>
              </div>
              <p style={{ color: 'var(--text-sub)', fontSize: 13, marginTop: 4 }}>
                {currentUser?.organizer?.organizationName || 'Your Organization'} is fully authorized.
              </p>
            </div>
          </div>

          <p style={{ fontSize: 14, color: 'var(--text-main)', lineHeight: 1.6, marginBottom: 24 }}>
            Your account has full publisher privileges on PassFlow. You can mint primary ticket tiers, manage inventory allocations, and monitor real-time box office liquidity in the Organizer Console.
          </p>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <button
              className="btn-primary"
              style={{ padding: '10px 20px', fontSize: 14 }}
              onClick={() => navigate('/organizer')}
            >
              <span>Launch Organizer Console</span>
              <ArrowRight size={14} />
            </button>
            <button
              className="btn-secondary"
              style={{ padding: '10px 18px', fontSize: 13 }}
              onClick={() => navigate('/profile')}
            >
              View Profile
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 3. Application Submitted / Pending Review
  if (organizerStatus === 'PENDING' || submitSuccess) {
    return (
      <div className="content-wrap" style={{ maxWidth: 680 }}>
        <button
          className="btn-secondary"
          style={{ marginBottom: 20, padding: '6px 12px', fontSize: 12 }}
          onClick={() => navigate('/profile')}
        >
          <ArrowLeft size={14} />
          <span>Back to Profile</span>
        </button>

        <div
          className="card"
          style={{
            background: 'linear-gradient(135deg, rgba(249, 115, 22, 0.08), rgba(23, 27, 38, 0.98))',
            borderColor: 'var(--accent-orange-border)',
            padding: 32
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
            <div
              style={{
                width: 52,
                height: 52,
                borderRadius: 'var(--radius-md)',
                background: 'var(--accent-orange-subtle)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <Clock size={28} color="var(--accent-orange)" />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Application Under Review</h1>
                <span className="badge badge-orange" style={{ fontSize: 11 }}>
                  STATUS: PENDING COMPLIANCE
                </span>
              </div>
              <p style={{ color: 'var(--text-sub)', fontSize: 13, marginTop: 4 }}>
                Organization: <strong>{currentUser?.organizer?.organizationName || orgName || 'Registered Entity'}</strong>
              </p>
            </div>
          </div>

          <div
            style={{
              background: 'var(--bg-app)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-sm)',
              padding: 18,
              marginBottom: 24,
              fontSize: 13,
              color: 'var(--text-sub)',
              lineHeight: 1.6
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 12 }}>
              <ShieldCheck size={18} color="#10b981" style={{ flexShrink: 0, marginTop: 2 }} />
              <div>
                <strong style={{ color: 'var(--text-main)' }}>Compliance Verification Process</strong>
                <p style={{ margin: '4px 0 0 0' }}>
                  The PassFlow compliance committee verifies business licenses and anti-fraud credentials within <strong>24 business hours</strong>.
                </p>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <CheckCircle2 size={18} color="var(--accent-orange)" style={{ flexShrink: 0, marginTop: 2 }} />
              <div>
                <strong style={{ color: 'var(--text-main)' }}>Automatic Console Activation</strong>
                <p style={{ margin: '4px 0 0 0' }}>
                  Once verified, your account role will elevate to <strong>ORGANIZER</strong> and the primary event publishing console will automatically unlock in your navigation bar.
                </p>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <button
              className="btn-primary"
              style={{ padding: '10px 18px', fontSize: 13 }}
              disabled={isRefreshing}
              onClick={handleRefreshStatus}
            >
              <RefreshCw size={14} className={isRefreshing ? 'spin' : ''} />
              <span>{isRefreshing ? 'Checking Status...' : 'Check Verification Status'}</span>
            </button>
            <button
              className="btn-secondary"
              style={{ padding: '10px 18px', fontSize: 13 }}
              onClick={() => navigate('/events')}
            >
              Explore Public Events
            </button>
            <button
              className="btn-secondary"
              style={{ padding: '10px 18px', fontSize: 13 }}
              onClick={() => navigate('/profile')}
            >
              Return to Profile
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 4. Default: New Organizer Application Form
  return (
    <div className="content-wrap" style={{ maxWidth: 680 }}>
      <button
        className="btn-secondary"
        style={{ marginBottom: 20, padding: '6px 12px', fontSize: 12 }}
        onClick={() => navigate('/profile')}
      >
        <ArrowLeft size={14} />
        <span>Back to Profile</span>
      </button>

      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20 }}>
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 'var(--radius-md)',
              background: 'var(--accent-orange-subtle)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <Building size={24} color="var(--accent-orange)" />
          </div>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Apply for Organizer Status</h1>
            <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4 }}>
              Post events, mint primary tickets, and access real-time primary box office liquidity.
            </p>
          </div>
        </div>

        {submitError && (
          <div
            style={{
              background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              borderRadius: 'var(--radius-sm)',
              padding: '12px 16px',
              marginBottom: 20,
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              color: '#f87171',
              fontSize: 13
            }}
          >
            <AlertTriangle size={18} style={{ flexShrink: 0 }} />
            <span>{submitError}</span>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          {/* Organization Name */}
          <div style={{ marginBottom: 18 }}>
            <label style={{ display: 'block', fontSize: 12, color: 'var(--text-sub)', marginBottom: 6, fontWeight: 500 }}>
              Organization / Promoter Legal Entity Name <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <input
              type="text"
              required
              placeholder="e.g. Acme Entertainment LLC"
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              style={{ width: '100%', fontSize: 14 }}
              disabled={isSubmitting}
            />
            <span style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, display: 'block' }}>
              Minimum 2 characters. This name will appear on official ticket receipts and event pages.
            </span>
          </div>

          {/* Contact Email (Readonly) */}
          <div style={{ marginBottom: 18 }}>
            <label style={{ display: 'block', fontSize: 12, color: 'var(--text-sub)', marginBottom: 6, fontWeight: 500 }}>
              Applicant Account Email
            </label>
            <input
              type="email"
              disabled
              value={currentUser?.email || ''}
              style={{ width: '100%', fontSize: 14, opacity: 0.75, cursor: 'not-allowed' }}
            />
          </div>

          {/* Website / Social URL */}
          <div style={{ marginBottom: 18 }}>
            <label style={{ display: 'block', fontSize: 12, color: 'var(--text-sub)', marginBottom: 6, fontWeight: 500 }}>
              Official Website or Social Handle
            </label>
            <input
              type="text"
              placeholder="e.g. https://myeventgroup.com or @myeventgroup"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              style={{ width: '100%', fontSize: 14 }}
              disabled={isSubmitting}
            />
          </div>

          {/* Sales Volume */}
          <div style={{ marginBottom: 18 }}>
            <label style={{ display: 'block', fontSize: 12, color: 'var(--text-sub)', marginBottom: 6, fontWeight: 500 }}>
              Estimated Monthly Ticket Sales Volume
            </label>
            <select
              value={volume}
              onChange={(e) => setVolume(e.target.value)}
              style={{ width: '100%', fontSize: 14 }}
              disabled={isSubmitting}
            >
              <option>₹50,000 - ₹2,00,000 / month</option>
              <option>₹2,00,000 - ₹10,00,000 / month</option>
              <option>₹10,00,000 - ₹50,00,000 / month</option>
              <option>₹50,00,000+ / month (Enterprise)</option>
            </select>
          </div>

          {/* Experience / Description */}
          <div style={{ marginBottom: 24 }}>
            <label style={{ display: 'block', fontSize: 12, color: 'var(--text-sub)', marginBottom: 6, fontWeight: 500 }}>
              Production Experience & Event Types
            </label>
            <textarea
              rows={4}
              placeholder="Describe upcoming concerts, festivals, sports, or conferences you plan to host..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              style={{ width: '100%', fontSize: 13 }}
              disabled={isSubmitting}
            />
          </div>

          {/* Compliance Info Banner */}
          <div
            style={{
              background: 'var(--bg-app)',
              border: '1px solid var(--border-subtle)',
              padding: 16,
              borderRadius: 'var(--radius-sm)',
              marginBottom: 24
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, color: 'var(--text-sub)', fontSize: 12 }}>
              <ShieldCheck size={18} color="#10b981" style={{ flexShrink: 0, marginTop: 1 }} />
              <span style={{ lineHeight: 1.5 }}>
                Applications are reviewed by the PassFlow compliance board within 24 hours. Once verified, the Organizer Console tab will automatically unlock in your navbar.
              </span>
            </div>
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            className="btn-primary"
            disabled={isSubmitting}
            style={{ width: '100%', padding: '12px', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
          >
            {isSubmitting ? (
              <>
                <RefreshCw size={16} className="spin" />
                <span>Submitting Application to Backend...</span>
              </>
            ) : (
              <span>Submit Organizer Application</span>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
