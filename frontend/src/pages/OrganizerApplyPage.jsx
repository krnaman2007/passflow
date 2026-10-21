import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { Building, ArrowLeft, CheckCircle2, ShieldCheck } from 'lucide-react';

export default function OrganizerApplyPage() {
  const { applyForOrganizer, navigate, currentUser } = useApp();

  const [orgName, setOrgName] = useState('Lumen Live Entertainment');
  const [website, setWebsite] = useState('https://lumenevents.io');
  const [volume, setVolume] = useState('$50,000 - $100,000/month');
  const [description, setDescription] = useState('Independent electronic and live concert production agency operating in Seattle and San Francisco.');

  const handleSubmit = (e) => {
    e.preventDefault();
    applyForOrganizer({ orgName, email: currentUser?.email, website, volume });
  };

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
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 'var(--radius-md)',
              background: 'var(--accent-orange-subtle)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <Building size={22} color="var(--accent-orange)" />
          </div>
          <div>
            <h1 style={{ fontSize: 22, margin: 0 }}>Apply for Organizer Status</h1>
            <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 2 }}>
              Post events, mint primary tickets, and access real-time primary box office analytics
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 12, color: 'var(--text-sub)', marginBottom: 6, fontWeight: 500 }}>
              Organization / Promoter Legal Entity Name
            </label>
            <input
              type="text"
              required
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              style={{ width: '100%', fontSize: 14 }}
            />
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 12, color: 'var(--text-sub)', marginBottom: 6, fontWeight: 500 }}>
              Official Website or Social Handle
            </label>
            <input
              type="text"
              required
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              style={{ width: '100%', fontSize: 14 }}
            />
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 12, color: 'var(--text-sub)', marginBottom: 6, fontWeight: 500 }}>
              Estimated Monthly Ticket Sales Volume
            </label>
            <select
              value={volume}
              onChange={(e) => setVolume(e.target.value)}
              style={{ width: '100%', fontSize: 14 }}
            >
              <option>$10,000 - $50,000/month</option>
              <option>$50,000 - $100,000/month</option>
              <option>$100,000 - $500,000/month</option>
              <option>$500,000+/month</option>
            </select>
          </div>

          <div style={{ marginBottom: 24 }}>
            <label style={{ display: 'block', fontSize: 12, color: 'var(--text-sub)', marginBottom: 6, fontWeight: 500 }}>
              Production Experience & Event Types
            </label>
            <textarea
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              style={{ width: '100%', fontSize: 13 }}
            />
          </div>

          <div style={{ background: 'var(--bg-app)', padding: 14, borderRadius: 'var(--radius-sm)', marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-sub)', fontSize: 12 }}>
              <ShieldCheck size={16} color="#10b981" />
              <span>
                Applications are reviewed by the Darkhold compliance board within 24 hours. Once verified, the Organizer Console tab will automatically unlock in your navbar.
              </span>
            </div>
          </div>

          <button
            type="submit"
            className="btn-primary"
            style={{ width: '100%', padding: '12px', fontSize: 14 }}
          >
            Submit Organizer Application
          </button>
        </form>
      </div>
    </div>
  );
}
