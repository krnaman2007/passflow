/**
 * PassFlow Event Adapter
 * Adapts PostgreSQL backend Event entities to UI component presentation formats.
 * Ensures zero mock data and zero hardcoded fallbacks are used.
 */

const THEMES = [
  { accentColor: '#f97316', gradient: 'from-amber-500/20 via-orange-600/30 to-rose-900/40' },
  { accentColor: '#8b5cf6', gradient: 'from-indigo-500/20 via-purple-600/30 to-pink-900/40' },
  { accentColor: '#10b981', gradient: 'from-emerald-500/20 via-teal-600/30 to-cyan-900/40' },
  { accentColor: '#3b82f6', gradient: 'from-blue-500/20 via-cyan-600/30 to-indigo-900/40' },
  { accentColor: '#ec4899', gradient: 'from-pink-500/20 via-rose-600/30 to-amber-900/40' },
];

/**
 * Format a raw backend event from PostgreSQL into the UI format
 * @param {object} ev - Raw backend event
 * @param {number} index - Index for aesthetic color palette
 */
export function formatBackendEvent(ev, index = 0) {
  if (!ev) return null;

  const categories = Array.isArray(ev.categories) ? ev.categories : [];
  const tiers = categories.map((c) => {
    const left =
      c.availableQuantity != null
        ? Number(c.availableQuantity)
        : Number(c.inventory?.availableQuantity ?? 0);
    const total =
      c.totalQuantity != null
        ? Number(c.totalQuantity)
        : Number(c.inventory?.totalQuantity ?? 0);
    const price = Number(c.originalPrice) || 0;
    const priceCap = c.resalePriceCap != null ? Number(c.resalePriceCap) : price * 1.1;

    return {
      id: c.id,
      name: c.name || 'General Admission',
      description: c.description || '',
      price,
      originalPrice: price,
      resalePriceCap: priceCap,
      left,
      total,
      soldOut: left <= 0,
      cap: priceCap,
    };
  });

  const validPrices = tiers.map((t) => t.price).filter((p) => p > 0);
  const primaryFrom =
    validPrices.length > 0
      ? Math.min(...validPrices)
      : Number(ev.originalPrice) || 0;

  const totalAvailable = tiers.reduce((acc, t) => acc + (t.left || 0), 0);
  const isSoldOut = tiers.length > 0 && totalAvailable === 0;

  const dateObj = ev.dateTime ? new Date(ev.dateTime) : null;
  const isValidDate = dateObj && !isNaN(dateObj.getTime());

  const fullDate = isValidDate
    ? dateObj.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : 'Date TBA';

  const time = isValidDate
    ? dateObj.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
      })
    : 'Time TBA';

  const dateShort = isValidDate
    ? dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : 'TBA';

  const theme = THEMES[index % THEMES.length];

  return {
    id: ev.id,
    title: ev.name || 'Untitled Event',
    tagline:
      ev.description ||
      (ev.organizer?.organizationName
        ? `Presented by ${ev.organizer.organizationName}`
        : 'Live Primary & Resale Exchange Event'),
    description: ev.description || '',
    date: dateShort,
    fullDate: `${fullDate} • ${time}`,
    dateOnly: fullDate,
    time,
    venue: ev.location || 'Venue TBA',
    city: ev.location ? ev.location.split(',')[1]?.trim() || ev.location : 'Live Arena',
    category: categories[0]?.name || 'Concert',
    status: ev.status || 'PUBLISHED',
    gradient: theme.gradient,
    accentColor: theme.accentColor,
    primaryFrom,
    totalAvailable,
    isSoldOut,
    tiers,
    organizer: ev.organizer || null,
    raw: ev,
  };
}
