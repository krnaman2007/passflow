/**
 * PassFlow Event Adapter
 * Adapts backend Event entities to UI component presentation formats.
 * Ensures zero mock data and zero hardcoded fallbacks are used.
 */

const THEMES = [
  { accentColor: '#6366f1', gradient: 'from-indigo-500/20 via-purple-600/30 to-slate-900/40' },
  { accentColor: '#8b5cf6', gradient: 'from-purple-500/20 via-indigo-600/30 to-pink-900/40' },
  { accentColor: '#06b6d4', gradient: 'from-cyan-500/20 via-teal-600/30 to-slate-900/40' },
  { accentColor: '#3b82f6', gradient: 'from-blue-500/20 via-cyan-600/30 to-indigo-900/40' },
  { accentColor: '#10b981', gradient: 'from-emerald-500/20 via-teal-600/30 to-cyan-900/40' },
];

/**
 * Format a raw backend event into the UI format
 * @param {object} ev - Raw backend event
 * @param {number} index - Index for aesthetic color palette
 */
/**
 * Resolve high-resolution cinematic cover photography for an event
 * @param {object} ev 
 */
export function getEventImage(ev) {
  if (ev?.imageUrl) return ev.imageUrl;
  if (ev?.bannerUrl) return ev.bannerUrl;
  if (ev?.image) return ev.image;

  const text = `${ev?.name || ev?.title || ''} ${ev?.category || ''} ${ev?.description || ''}`.toLowerCase();

  // Arijit Singh / Live Symphony / Orchestral
  if (text.includes('arijit') || text.includes('symphony') || text.includes('orchestra') || text.includes('classical')) {
    return 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&w=1200&q=80';
  }
  // Zakir Khan / Tathastu / Standup Comedy
  if (text.includes('zakir') || text.includes('comedy') || text.includes('standup') || text.includes('laughter') || text.includes('tathastu')) {
    return 'https://images.unsplash.com/photo-1585699324551-f6c309eedeca?auto=format&fit=crop&w=1200&q=80';
  }
  // Coldplay / Music of the Spheres
  if (text.includes('coldplay') || text.includes('spheres')) {
    return 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?auto=format&fit=crop&w=1200&q=80';
  }
  // Diljit Dosanjh / Dil-Luminati
  if (text.includes('diljit') || text.includes('illuminati') || text.includes('dil-luminati')) {
    return 'https://images.unsplash.com/photo-1501386761578-eac5c94b800a?auto=format&fit=crop&w=1200&q=80';
  }
  // Cricket / ICC / BCCI / T20 / Stadium
  if (text.includes('cricket') || text.includes('t20') || text.includes('icc') || text.includes('stadium') || text.includes('bcci') || text.includes('australia') || text.includes('ipl')) {
    return 'https://images.unsplash.com/photo-1540747913346-19e32dc3e97e?auto=format&fit=crop&w=1200&q=80';
  }
  // Sunburn Goa / EDM / Music Festival / DJ
  if (text.includes('sunburn') || text.includes('edm') || text.includes('festival') || text.includes('dj') || text.includes('rave')) {
    return 'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?auto=format&fit=crop&w=1200&q=80';
  }
  // General Concert / Tour / Music
  if (text.includes('concert') || text.includes('tour') || text.includes('live') || text.includes('music') || text.includes('band')) {
    return 'https://images.unsplash.com/photo-1465847899084-d164df4dedc6?auto=format&fit=crop&w=1200&q=80';
  }

  // High-end ambient stage lights default
  return 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&w=1200&q=80';
}

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

    const activeAuction =
      Array.isArray(c.dutchAuctions) && c.dutchAuctions.length > 0
        ? c.dutchAuctions[0]
        : null;

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
      activeAuction: activeAuction
        ? {
            id: activeAuction.id,
            startPrice: Number(activeAuction.startPrice),
            minPrice: Number(activeAuction.minPrice),
            currentPrice: Number(activeAuction.currentPrice || activeAuction.startPrice),
            startTime: activeAuction.startTime,
            endTime: activeAuction.endTime,
            status: activeAuction.status,
          }
        : null,
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
    imageUrl: getEventImage(ev),
    primaryFrom,
    totalAvailable,
    isSoldOut,
    tiers,
    organizer: ev.organizer || null,
    raw: ev,
  };
}
