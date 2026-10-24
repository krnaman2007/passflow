import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import {
  ArrowLeft,
  Plus,
  CheckCircle2,
  Save,
  Calendar,
  MapPin,
  Tag,
  DollarSign,
  AlertTriangle,
  RefreshCw,
  Sparkles,
  ShieldAlert,
  ArrowRight,
  Send
} from 'lucide-react';

export default function OrganizerCreateEventPage() {
  const {
    createEventDraft,
    addCategoryToEvent,
    publishEvent,
    navigate,
    showToast,
    currentUser,
    currentRole,
    authLoading,
    login
  } = useApp();

  const [step, setStep] = useState(1);
  const [createdEvent, setCreatedEvent] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isAddingTier, setIsAddingTier] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);

  // Helper default ISO string for 14 days from now: YYYY-MM-DDTHH:mm
  const defaultFutureDate = () => {
    const d = new Date(Date.now() + 14 * 24 * 3600 * 1000);
    d.setHours(19, 0, 0, 0);
    return d.toISOString().slice(0, 16);
  };

  // Step 1 Details State
  const [eventName, setEventName] = useState('Neon Horizon Music Festival');
  const [dateTime, setDateTime] = useState(defaultFutureDate());
  const [location, setLocation] = useState('Jawaharlal Nehru Stadium, New Delhi');
  const [description, setDescription] = useState(
    'A premier multi-genre electronic, indie, and alternative live festival featuring top international and domestic headliners.'
  );
  const [basePrice, setBasePrice] = useState('1499');
  const [initialQuantity, setInitialQuantity] = useState('500');

  // Step 2 Tiers State
  const [categories, setCategories] = useState([]);
  const [newCatName, setNewCatName] = useState('VIP Pass');
  const [newCatPrice, setNewCatPrice] = useState('3999');
  const [newCatQty, setNewCatQty] = useState('100');

  // Check Organizer status
  const isOrganizerVerified =
    currentRole === 'ADMIN' ||
    currentUser?.role === 'ADMIN' ||
    currentUser?.organizer?.verificationStatus === 'VERIFIED';

  // 1. Session Restoring Guard
  if (authLoading) {
    return (
      <div className="content-wrap" style={{ maxWidth: 640, textAlign: 'center', padding: '80px 24px', margin: '40px auto' }}>
        <RefreshCw size={32} className="spin" style={{ margin: '0 auto 16px', display: 'block', color: 'var(--brand-primary, #6366f1)' }} />
        <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8, color: 'var(--text-main)' }}>Restoring Session...</h3>
        <p style={{ color: 'var(--text-sub)', fontSize: 14 }}>Verifying organizer permissions</p>
      </div>
    );
  }

  const effectiveRole = currentUser ? (currentUser.role || 'USER') : (currentRole || 'PUBLIC');
  const isOrganizerOrAdmin =
    effectiveRole === 'ADMIN' ||
    effectiveRole === 'ORGANIZER' ||
    currentUser?.role === 'ADMIN' ||
    currentUser?.role === 'ORGANIZER' ||
    currentUser?.organizer != null;

  // 2. Unauthenticated Guard (Visitor / PUBLIC)
  if (!currentUser || effectiveRole === 'PUBLIC') {
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
            <ShieldAlert size={28} color="#ef4444" />
          </div>

          <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>
            Organizer Access Required
          </h2>
          <p style={{ color: 'var(--text-sub)', fontSize: 14, maxWidth: 440, margin: '0 auto 24px' }}>
            Event creation, ticket tier minting, and inventory allocations are restricted to verified organizer accounts.
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
              onClick={() => navigate('/organizer/apply')}
            >
              Apply as Organizer
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
            <p style={{ marginBottom: 12 }}>Quick login with a verified organizer test account:</p>
            <button
              className="btn-secondary"
              style={{ fontSize: 12, padding: '6px 14px' }}
              onClick={() => login('ali@passflow.com', 'Password123!')}
            >
              <Sparkles size={13} color="var(--accent-orange)" />
              <span>1-Click Sign In as Ali (Verified Organizer)</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 3. Authenticated but Not an Organizer Guard (Role: USER)
  if (!isOrganizerOrAdmin) {
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
            <ShieldAlert size={28} color="#ef4444" />
          </div>

          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 10px',
              borderRadius: 6,
              background: 'rgba(239, 68, 68, 0.15)',
              color: '#ef4444',
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: 0.5,
              marginBottom: 12
            }}
          >
            403 FORBIDDEN · ORGANIZER CLEARANCE REQUIRED
          </div>

          <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>
            Organizer Clearance Required
          </h2>
          <p style={{ color: 'var(--text-sub)', fontSize: 14, maxWidth: 460, margin: '0 auto 24px', lineHeight: 1.6 }}>
            Your account ({currentUser.email}) is currently registered with role <strong style={{ color: 'var(--accent-orange)' }}>USER</strong>. Event creation, ticket tier minting, and inventory issuance require an approved organizer profile.
          </p>

          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button
              className="btn-primary"
              style={{ padding: '10px 22px', fontSize: 14 }}
              onClick={() => navigate('/organizer/apply')}
            >
              <span>Apply for Organizer Status</span>
              <ArrowRight size={14} />
            </button>
            <button
              className="btn-secondary"
              style={{ padding: '10px 20px', fontSize: 14 }}
              onClick={() => navigate('/events')}
            >
              Browse Public Events
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 2. Handle Step 1: Create Event Draft on Backend
  const handleSaveDraft = async (e) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!eventName.trim() || eventName.trim().length < 2) {
      setErrorMessage('Event title must be at least 2 characters.');
      return;
    }

    if (!dateTime) {
      setErrorMessage('Please select a valid event date and time.');
      return;
    }

    setIsSubmitting(true);
    try {
      const event = await createEventDraft({
        title: eventName.trim(),
        date: dateTime,
        venue: location.trim(),
        description: description.trim(),
        originalPrice: parseFloat(basePrice) || 50,
      });

      setCreatedEvent(event);

      // Auto-create initial default General Admission tier with chosen quantity
      const defaultTierPrice = parseFloat(basePrice) || 50;
      const defaultTierQty = parseInt(initialQuantity, 10) || 500;
      try {
        const gaTier = await addCategoryToEvent(event.id, {
          name: 'General Admission',
          price: defaultTierPrice,
          quantity: defaultTierQty,
        });
        setCategories([
          {
            id: gaTier?.id || 'ga',
            name: 'General Admission',
            price: defaultTierPrice,
            qty: defaultTierQty,
          }
        ]);
      } catch (tierErr) {
        console.warn('Initial tier creation notice:', tierErr);
      }

      setStep(2);
    } catch (err) {
      const msg = err?.data?.error?.message || err?.message || 'Failed to create event draft';
      setErrorMessage(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  // 3. Handle Step 2: Add Category Tier on Backend
  const handleAddCategory = async () => {
    if (!newCatName.trim() || !newCatPrice || !newCatQty) {
      showToast('Please fill out Tier Name, Price, and Quantity', 'error');
      return;
    }

    const price = parseFloat(newCatPrice);
    const qty = parseInt(newCatQty, 10);

    if (isNaN(price) || price <= 0) {
      showToast('Price must be greater than 0', 'error');
      return;
    }

    if (isNaN(qty) || qty <= 0) {
      showToast('Quantity must be at least 1', 'error');
      return;
    }

    setIsAddingTier(true);
    try {
      const addedCat = await addCategoryToEvent(createdEvent.id, {
        name: newCatName.trim(),
        price,
        quantity: qty,
      });

      setCategories((prev) => [
        ...prev,
        {
          id: addedCat?.id || `tier_${Date.now()}`,
          name: newCatName.trim(),
          price,
          qty
        }
      ]);

      setNewCatName('');
      setNewCatPrice('');
      setNewCatQty('');
    } catch (err) {
      const msg = err?.data?.error?.message || err?.message || 'Failed to add tier';
      showToast(msg, 'error');
    } finally {
      setIsAddingTier(false);
    }
  };

  // 4. Handle Step 2: Publish Event to Public Marketplace
  const handlePublishAndFinish = async () => {
    if (!createdEvent?.id) {
      navigate('/organizer');
      return;
    }

    setIsPublishing(true);
    try {
      await publishEvent(createdEvent.id);
      showToast('Production successfully published to public markets!', 'success');
      navigate('/organizer');
    } catch (err) {
      showToast('Draft saved, but failed to publish status: ' + err.message, 'error');
    } finally {
      setIsPublishing(false);
    }
  };

  return (
    <div className="content-wrap" style={{ maxWidth: 760 }}>
      <button
        className="btn-secondary"
        style={{ marginBottom: 20, padding: '6px 12px', fontSize: 12 }}
        onClick={() => navigate('/organizer')}
      >
        <ArrowLeft size={14} />
        <span>Cancel & Return to Dashboard</span>
      </button>

      <div className="card">
        <div style={{ borderBottom: '1px solid var(--border-subtle)', paddingBottom: 16, marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Create Event Production</h1>
              <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4 }}>
                Step 1: Production Details · Step 2: Mint Ticket Categories & Liquidity Quotas
              </p>
            </div>
            <span className="badge badge-orange font-mono">BACKEND SYNCED</span>
          </div>

          <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
            <span className={`badge ${step >= 1 ? 'badge-orange' : 'badge-neutral'}`}>
              1. Event Details {step > 1 && '✓'}
            </span>
            <span className={`badge ${step >= 2 ? 'badge-orange' : 'badge-neutral'}`}>
              2. Ticket Tiers & Quotas
            </span>
          </div>
        </div>

        {errorMessage && (
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
            <span>{errorMessage}</span>
          </div>
        )}

        {/* ========================================================= */}
        {/* STEP 1: EVENT DETAILS */}
        {/* ========================================================= */}
        {step === 1 && (
          <form onSubmit={handleSaveDraft}>
            <div style={{ marginBottom: 18 }}>
              <label style={{ display: 'block', fontSize: 12, color: 'var(--text-sub)', marginBottom: 6, fontWeight: 500 }}>
                Event Production Name <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <input
                type="text"
                required
                placeholder="e.g. Coldplay: Music of the Spheres World Tour"
                value={eventName}
                onChange={(e) => setEventName(e.target.value)}
                style={{ width: '100%', fontSize: 14 }}
                disabled={isSubmitting}
              />
            </div>

            <div className="grid-2" style={{ marginBottom: 18 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, color: 'var(--text-sub)', marginBottom: 6, fontWeight: 500 }}>
                  Date & Performance Time (ISO/Local) <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <div style={{ position: 'relative' }}>
                  <input
                    type="datetime-local"
                    required
                    value={dateTime}
                    onChange={(e) => setDateTime(e.target.value)}
                    style={{ width: '100%', fontSize: 14 }}
                    disabled={isSubmitting}
                  />
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, color: 'var(--text-sub)', marginBottom: 6, fontWeight: 500 }}>
                  Venue Location & City <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. D.Y. Patil Stadium, Navi Mumbai"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  style={{ width: '100%', fontSize: 14 }}
                  disabled={isSubmitting}
                />
              </div>
            </div>

            <div style={{ marginBottom: 18 }}>
              <label style={{ display: 'block', fontSize: 12, color: 'var(--text-sub)', marginBottom: 6, fontWeight: 500 }}>
                Event Description & Schedule Notes
              </label>
              <textarea
                rows={3}
                placeholder="Provide event overview, age restrictions, gate opening hours, and lineup highlights..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                style={{ width: '100%', fontSize: 13 }}
                disabled={isSubmitting}
              />
            </div>

            <div className="grid-2" style={{ marginBottom: 24 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, color: 'var(--text-sub)', marginBottom: 6, fontWeight: 500 }}>
                  Base Face Price (₹) <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-sub)' }}>₹</span>
                  <input
                    type="number"
                    step="1"
                    min="1"
                    required
                    placeholder="1499"
                    value={basePrice}
                    onChange={(e) => setBasePrice(e.target.value)}
                    style={{ width: '100%', fontSize: 16, fontWeight: 700, fontFamily: 'monospace' }}
                    disabled={isSubmitting}
                  />
                </div>
                <span style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, display: 'block' }}>
                  Used as default benchmark for General Admission and primary market face value.
                </span>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, color: 'var(--text-sub)', marginBottom: 6, fontWeight: 500 }}>
                  Total Number of Tickets (Initial Quantity) <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="number"
                    step="1"
                    min="1"
                    required
                    placeholder="500"
                    value={initialQuantity}
                    onChange={(e) => setInitialQuantity(e.target.value)}
                    style={{ width: '100%', fontSize: 16, fontWeight: 700, fontFamily: 'monospace' }}
                    disabled={isSubmitting}
                  />
                </div>
                <span style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, display: 'block' }}>
                  Total capacity to mint into primary inventory for General Admission.
                </span>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 12 }}>
              <button
                type="button"
                className="btn-secondary"
                disabled={isSubmitting}
                onClick={() => navigate('/organizer')}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn-primary"
                disabled={isSubmitting}
                style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
              >
                {isSubmitting ? (
                  <>
                    <RefreshCw size={15} className="spin" />
                    <span>Creating Production on Database...</span>
                  </>
                ) : (
                  <>
                    <Save size={15} />
                    <span>Save Draft & Configure Tiers</span>
                  </>
                )}
              </button>
            </div>
          </form>
        )}

        {/* ========================================================= */}
        {/* STEP 2: CATEGORIES & TIERS */}
        {/* ========================================================= */}
        {step === 2 && (
          <div>
            <div
              style={{
                background: 'linear-gradient(135deg, rgba(249, 115, 22, 0.08), rgba(23, 27, 38, 0.98))',
                border: '1px solid var(--accent-orange-border)',
                padding: 16,
                borderRadius: 'var(--radius-md)',
                marginBottom: 24
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-main)' }}>
                    Production Created: {createdEvent?.name || eventName}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                    {createdEvent?.date || dateTime} · {createdEvent?.venue || location}
                  </div>
                </div>
                <span className="badge badge-orange font-mono">STATUS: DRAFT</span>
              </div>
            </div>

            <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>
              Step 2 — Mint Ticket Categories & Quotas
            </h3>

            {/* Existing Categories Table */}
            <div className="data-table-wrap" style={{ marginBottom: 20 }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Tier Name</th>
                    <th>Face Price</th>
                    <th>Allocation Qty</th>
                    <th>Anti-Scalp Cap (2x)</th>
                  </tr>
                </thead>
                <tbody>
                  {categories.map((c, i) => (
                    <tr key={c.id || i} className="font-mono">
                      <td style={{ fontWeight: 600, color: 'var(--text-main)' }}>{c.name}</td>
                      <td>₹{parseFloat(c.price).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                      <td>{c.qty}</td>
                      <td style={{ color: 'var(--accent-orange)', fontWeight: 600 }}>
                        Max ₹{(parseFloat(c.price) * 2).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>
                    </tr>
                  ))}
                  {categories.length === 0 && (
                    <tr>
                      <td colSpan={4} style={{ textAlign: 'center', padding: '24px', color: 'var(--text-dim)' }}>
                        No tiers created yet. Add a category below to mint tickets.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Add new inline category */}
            <div
              style={{
                background: 'var(--bg-surface)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-md)',
                padding: 18,
                marginBottom: 24
              }}
            >
              <h4 style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Plus size={14} color="var(--accent-orange)" />
                <span>Add Additional Category Tier (e.g. VIP Lounge, Early Bird, Pit)</span>
              </h4>

              <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr auto', gap: 10, alignItems: 'center' }}>
                <input
                  type="text"
                  placeholder="Tier Name (e.g. Fan Pit)"
                  value={newCatName}
                  onChange={(e) => setNewCatName(e.target.value)}
                  disabled={isAddingTier}
                />
                <input
                  type="number"
                  placeholder="Price (₹)"
                  value={newCatPrice}
                  onChange={(e) => setNewCatPrice(e.target.value)}
                  disabled={isAddingTier}
                />
                <input
                  type="number"
                  placeholder="Total Qty"
                  value={newCatQty}
                  onChange={(e) => setNewCatQty(e.target.value)}
                  disabled={isAddingTier}
                />
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={isAddingTier}
                  onClick={handleAddCategory}
                  style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                >
                  {isAddingTier ? (
                    <RefreshCw size={14} className="spin" />
                  ) : (
                    <Plus size={14} />
                  )}
                  <span>Add Tier</span>
                </button>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn-secondary"
                disabled={isPublishing}
                onClick={() => setStep(1)}
              >
                Back to Details
              </button>

              <button
                type="button"
                className="btn-secondary"
                disabled={isPublishing}
                onClick={() => {
                  showToast('Event draft saved! You can publish it anytime from your dashboard.', 'info');
                  navigate('/organizer');
                }}
              >
                Save as Draft Only
              </button>

              <button
                type="button"
                className="btn-primary"
                style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
                disabled={isPublishing || categories.length === 0}
                onClick={handlePublishAndFinish}
              >
                {isPublishing ? (
                  <>
                    <RefreshCw size={15} className="spin" />
                    <span>Publishing Event to Market...</span>
                  </>
                ) : (
                  <>
                    <Send size={15} />
                    <span>Publish Event to Live Marketplace</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
