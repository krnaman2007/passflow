import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { ArrowLeft, Plus, CheckCircle2, Save } from 'lucide-react';

export default function OrganizerCreateEventPage() {
  const { createEventDraft, addCategoryToEvent, navigate, showToast } = useApp();

  const [step, setStep] = useState(1);
  const [createdEventId, setCreatedEventId] = useState(null);

  // Step 1 Details
  const [eventName, setEventName] = useState('Winter Gala');
  const [dateTime, setDateTime] = useState('Dec 20, 8:00 pm');
  const [location, setLocation] = useState('Crystal Hall, 5th Ave');
  const [description, setDescription] = useState('Black-tie winter night of classical symphonies and guest soloists.');
  const [basePrice, setBasePrice] = useState('60.00');

  // Step 2 Tiers
  const [categories, setCategories] = useState([
    { name: 'General', price: '60.00', qty: '500' }
  ]);

  const [newCatName, setNewCatName] = useState('');
  const [newCatPrice, setNewCatPrice] = useState('');
  const [newCatQty, setNewCatQty] = useState('');

  const handleSaveDraft = (e) => {
    e.preventDefault();
    const event = createEventDraft({
      title: eventName,
      date: dateTime,
      venue: location,
      description,
      originalPrice: basePrice
    });
    setCreatedEventId(event.id);
    setStep(2);
  };

  const handleAddCategory = () => {
    if (!newCatName || !newCatPrice || !newCatQty) return;
    setCategories((prev) => [
      ...prev,
      { name: newCatName, price: newCatPrice, qty: newCatQty }
    ]);
    if (createdEventId) {
      addCategoryToEvent(createdEventId, {
        name: newCatName,
        price: newCatPrice,
        quantity: newCatQty
      });
    }
    setNewCatName('');
    setNewCatPrice('');
    setNewCatQty('');
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
          <h1 style={{ fontSize: 24, margin: 0 }}>Create Event Production</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4 }}>
            Step 1 of 2: Details · Step 2: Categories & Fair-Price Caps
          </p>

          <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
            <span className={`badge ${step >= 1 ? 'badge-orange' : 'badge-neutral'}`}>
              1. Event Details {step > 1 && '✓'}
            </span>
            <span className={`badge ${step >= 2 ? 'badge-orange' : 'badge-neutral'}`}>
              2. Ticket Tiers & Quotas
            </span>
          </div>
        </div>

        {/* STEP 1: EVENT DETAILS */}
        {step === 1 && (
          <form onSubmit={handleSaveDraft}>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 12, color: 'var(--text-sub)', marginBottom: 6, fontWeight: 500 }}>
                Event Name
              </label>
              <input
                type="text"
                required
                value={eventName}
                onChange={(e) => setEventName(e.target.value)}
                style={{ width: '100%', fontSize: 14 }}
              />
            </div>

            <div className="grid-2" style={{ marginBottom: 16 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, color: 'var(--text-sub)', marginBottom: 6, fontWeight: 500 }}>
                  Date & Performance Time
                </label>
                <input
                  type="text"
                  required
                  value={dateTime}
                  onChange={(e) => setDateTime(e.target.value)}
                  style={{ width: '100%' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, color: 'var(--text-sub)', marginBottom: 6, fontWeight: 500 }}>
                  Venue Location & City
                </label>
                <input
                  type="text"
                  required
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  style={{ width: '100%' }}
                />
              </div>
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 12, color: 'var(--text-sub)', marginBottom: 6, fontWeight: 500 }}>
                Description
              </label>
              <textarea
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                style={{ width: '100%' }}
              />
            </div>

            <div style={{ marginBottom: 24 }}>
              <label style={{ display: 'block', fontSize: 12, color: 'var(--text-sub)', marginBottom: 6, fontWeight: 500 }}>
                Base Face Price ($)
              </label>
              <input
                type="number"
                step="0.5"
                required
                value={basePrice}
                onChange={(e) => setBasePrice(e.target.value)}
                style={{ width: 180, fontSize: 15, fontWeight: 600 }}
              />
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => navigate('/organizer')}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn-primary"
                style={{ flex: 1 }}
              >
                <Save size={15} />
                <span>Save as Draft & Configure Tiers</span>
              </button>
            </div>
          </form>
        )}

        {/* STEP 2: CATEGORIES & TIERS */}
        {step === 2 && (
          <div>
            <div style={{ background: 'var(--bg-app)', padding: 14, borderRadius: 'var(--radius-md)', marginBottom: 20 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-main)' }}>
                Draft Created: {eventName}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {dateTime} · {location}
              </div>
            </div>

            <h3 style={{ fontSize: 16, marginBottom: 12 }}>Step 2 — Mint Ticket Categories</h3>

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
                    <tr key={i} className="font-mono">
                      <td style={{ fontWeight: 600, color: 'var(--text-main)' }}>{c.name}</td>
                      <td>${parseFloat(c.price).toFixed(2)}</td>
                      <td>{c.qty}</td>
                      <td style={{ color: 'var(--accent-orange)' }}>
                        Max ${(parseFloat(c.price) * 2).toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Add new inline category */}
            <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', padding: 16, marginBottom: 24 }}>
              <h4 style={{ fontSize: 13, marginBottom: 10 }}>+ Add Additional Tier (e.g. VIP, Balcony)</h4>
              <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr auto', gap: 10, alignItems: 'center' }}>
                <input
                  type="text"
                  placeholder="Tier Name (e.g. VIP Lounge)"
                  value={newCatName}
                  onChange={(e) => setNewCatName(e.target.value)}
                />
                <input
                  type="number"
                  placeholder="Price ($)"
                  value={newCatPrice}
                  onChange={(e) => setNewCatPrice(e.target.value)}
                />
                <input
                  type="number"
                  placeholder="Quantity"
                  value={newCatQty}
                  onChange={(e) => setNewCatQty(e.target.value)}
                />
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={handleAddCategory}
                >
                  <Plus size={14} />
                  <span>Add Tier</span>
                </button>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setStep(1)}
              >
                Back to Details
              </button>
              <button
                type="button"
                className="btn-primary"
                style={{ flex: 1 }}
                onClick={() => {
                  showToast('Event draft and categories saved. Ready to publish on dashboard!', 'success');
                  navigate('/organizer');
                }}
              >
                Complete & Go to Organizer Dashboard
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
