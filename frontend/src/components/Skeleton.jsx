import React from 'react';

/**
 * Primitive Shimmer Skeleton element
 */
export function Skeleton({ width = '100%', height = '16px', borderRadius = 'var(--radius-sm, 6px)', style = {}, className = '' }) {
  return (
    <div
      className={`skeleton ${className}`}
      style={{
        width,
        height,
        borderRadius,
        ...style,
      }}
    />
  );
}

/**
 * Skeleton for Event Cards on EventsPage
 */
export function EventCardSkeleton() {
  return (
    <div className="card event-card" style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: 20, pointerEvents: 'none' }}>
      {/* Category & Status Badges */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Skeleton width="70px" height="22px" borderRadius="12px" />
        <Skeleton width="80px" height="22px" borderRadius="12px" />
      </div>

      {/* Title & Tagline */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
        <Skeleton width="85%" height="24px" borderRadius="6px" />
        <Skeleton width="60%" height="16px" borderRadius="4px" />
      </div>

      {/* Date & Location */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, margin: '8px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Skeleton width="16px" height="16px" borderRadius="4px" />
          <Skeleton width="140px" height="14px" borderRadius="4px" />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Skeleton width="16px" height="16px" borderRadius="4px" />
          <Skeleton width="180px" height="14px" borderRadius="4px" />
        </div>
      </div>

      {/* Price & Action Row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'auto', paddingTop: 14, borderTop: '1px solid var(--border-subtle)' }}>
        <div>
          <Skeleton width="50px" height="12px" borderRadius="4px" style={{ marginBottom: 4 }} />
          <Skeleton width="80px" height="20px" borderRadius="4px" />
        </div>
        <Skeleton width="100px" height="36px" borderRadius="8px" />
      </div>
    </div>
  );
}

/**
 * Grid of Event Card Skeletons
 */
export function EventGridSkeleton({ count = 6 }) {
  return (
    <div className="event-grid">
      {Array.from({ length: count }).map((_, i) => (
        <EventCardSkeleton key={i} />
      ))}
    </div>
  );
}

/**
 * Skeleton for EventDetailPage
 */
export function EventDetailSkeleton() {
  return (
    <div className="content-wrap" style={{ maxWidth: 1200, padding: '24px 20px', pointerEvents: 'none' }}>
      <Skeleton width="120px" height="32px" borderRadius="8px" style={{ marginBottom: 24 }} />

      <div className="detail-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: 24 }}>
        {/* Left Column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div className="card" style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', gap: 10 }}>
              <Skeleton width="90px" height="24px" borderRadius="12px" />
              <Skeleton width="80px" height="24px" borderRadius="12px" />
            </div>
            <Skeleton width="75%" height="36px" borderRadius="8px" />
            <Skeleton width="90%" height="18px" borderRadius="4px" />
            <div style={{ display: 'flex', gap: 24, marginTop: 8 }}>
              <Skeleton width="140px" height="20px" borderRadius="4px" />
              <Skeleton width="180px" height="20px" borderRadius="4px" />
            </div>
          </div>

          {/* Ticket Tiers */}
          <div className="card" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Skeleton width="160px" height="22px" borderRadius="6px" style={{ marginBottom: 8 }} />
            <div className="card" style={{ padding: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <Skeleton width="120px" height="18px" borderRadius="4px" />
                <Skeleton width="80px" height="14px" borderRadius="4px" />
              </div>
              <Skeleton width="90px" height="32px" borderRadius="6px" />
            </div>
            <div className="card" style={{ padding: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <Skeleton width="120px" height="18px" borderRadius="4px" />
                <Skeleton width="80px" height="14px" borderRadius="4px" />
              </div>
              <Skeleton width="90px" height="32px" borderRadius="6px" />
            </div>
          </div>
        </div>

        {/* Right Column: Checkout Card */}
        <div className="card" style={{ padding: 24, height: 'fit-content', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Skeleton width="140px" height="22px" borderRadius="6px" />
          <Skeleton width="100%" height="48px" borderRadius="8px" />
          <Skeleton width="100%" height="48px" borderRadius="8px" />
          <Skeleton width="100%" height="44px" borderRadius="10px" style={{ marginTop: 8 }} />
        </div>
      </div>
    </div>
  );
}

/**
 * Skeleton for MarketPage
 */
export function MarketDepthSkeleton() {
  return (
    <div className="content-wrap" style={{ maxWidth: 1400, padding: '24px 20px', pointerEvents: 'none' }}>
      {/* Market Selector Bar */}
      <div className="card" style={{ padding: '16px 20px', marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Skeleton width="180px" height="24px" borderRadius="6px" />
          <Skeleton width="80px" height="20px" borderRadius="10px" />
        </div>
        <div style={{ display: 'flex', gap: 16 }}>
          <Skeleton width="90px" height="20px" borderRadius="4px" />
          <Skeleton width="90px" height="20px" borderRadius="4px" />
          <Skeleton width="90px" height="20px" borderRadius="4px" />
        </div>
      </div>

      {/* Main Grid: Chart/Depth on Left, Order Form on Right */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 20 }}>
        <div className="card" style={{ padding: 20, height: 450, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <Skeleton width="160px" height="22px" borderRadius="6px" />
            <Skeleton width="120px" height="22px" borderRadius="6px" />
          </div>
          <Skeleton width="100%" height="320px" borderRadius="8px" />
        </div>

        <div className="card" style={{ padding: 20, height: 450, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Skeleton width="100%" height="36px" borderRadius="8px" />
          <Skeleton width="100%" height="42px" borderRadius="8px" style={{ marginTop: 8 }} />
          <Skeleton width="100%" height="42px" borderRadius="8px" />
          <Skeleton width="100%" height="44px" borderRadius="8px" style={{ marginTop: 'auto' }} />
        </div>
      </div>
    </div>
  );
}

/**
 * Skeleton for Ticket Cards on TicketsPage
 */
export function TicketCardSkeleton() {
  return (
    <div className="card" style={{ padding: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center', pointerEvents: 'none' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '60%' }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <Skeleton width="80px" height="20px" borderRadius="10px" />
          <Skeleton width="70px" height="20px" borderRadius="10px" />
        </div>
        <Skeleton width="85%" height="22px" borderRadius="6px" />
        <Skeleton width="50%" height="14px" borderRadius="4px" />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
        <Skeleton width="70px" height="22px" borderRadius="6px" />
        <Skeleton width="90px" height="32px" borderRadius="8px" />
      </div>
    </div>
  );
}

/**
 * Skeleton for User Profile Page
 */
export function ProfileSkeleton() {
  return (
    <div className="content-wrap" style={{ maxWidth: 800, padding: '40px 20px', pointerEvents: 'none' }}>
      <div className="card" style={{ padding: 32, display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <Skeleton width="64px" height="64px" borderRadius="50%" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Skeleton width="180px" height="24px" borderRadius="6px" />
            <Skeleton width="220px" height="16px" borderRadius="4px" />
          </div>
        </div>
        <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 20, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
          <Skeleton width="100%" height="70px" borderRadius="10px" />
          <Skeleton width="100%" height="70px" borderRadius="10px" />
        </div>
      </div>
    </div>
  );
}

/**
 * Skeleton for Dashboard / Metrics
 */
export function DashboardSkeleton({ count = 4 }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, pointerEvents: 'none' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <Skeleton width="80px" height="14px" borderRadius="4px" />
            <Skeleton width="120px" height="28px" borderRadius="6px" />
            <Skeleton width="60px" height="12px" borderRadius="4px" />
          </div>
        ))}
      </div>
      <div className="card" style={{ padding: 24, height: 320, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Skeleton width="180px" height="22px" borderRadius="6px" />
        <Skeleton width="100%" height="220px" borderRadius="8px" />
      </div>
    </div>
  );
}

export default {
  Skeleton,
  EventCardSkeleton,
  EventGridSkeleton,
  EventDetailSkeleton,
  MarketDepthSkeleton,
  TicketCardSkeleton,
  ProfileSkeleton,
  DashboardSkeleton,
};
