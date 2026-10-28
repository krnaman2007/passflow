import React, { useState, useEffect, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import {
  Building,
  Plus,
  CheckCircle2,
  AlertCircle,
  Eye,
  Layers,
  ArrowRight,
  Sparkles,
  TrendingUp,
  RefreshCw,
  Clock,
  Ticket,
  DollarSign,
  ShieldCheck,
  Lock,
  ExternalLink,
  Edit3,
  Gavel,
  X,
  Calendar,
  MapPin,
  Sliders,
  BarChart3,
  Ban,
  Check
} from 'lucide-react';
import { api } from '../services/api';
import { formatBackendEvent } from '../utils/eventAdapter';
import { DashboardSkeleton, Skeleton } from '../components/Skeleton';

export default function OrganizerDashboardPage() {
  const {
    navigate,
    addCategoryToEvent,
    publishEvent,
    updateEventDetails,
    updateEventStatus,
    updateCategoryDetails,
    getCategoryInventory,
    updateCategoryInventory,
    currentUser,
    currentRole,
    authLoading,
    login,
    showToast
  } = useApp();

  const [organizerEvents, setOrganizerEvents] = useState([]);
  const [organizerProfile, setOrganizerProfile] = useState(null);
  const [selectedEventId, setSelectedEventId] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isPublishingId, setIsPublishingId] = useState(null);
  const [isUpdatingStatusId, setIsUpdatingStatusId] = useState(null);

  // Edit Event Details modal state (PUT /events/:id)
  const [editingEvent, setEditingEvent] = useState(null);
  const [editEventName, setEditEventName] = useState('');
  const [editEventDate, setEditEventDate] = useState('');
  const [editEventLocation, setEditEventLocation] = useState('');
  const [editEventDesc, setEditEventDesc] = useState('');
  const [editEventPrice, setEditEventPrice] = useState('');
  const [isSavingEventDetails, setIsSavingEventDetails] = useState(false);

  // Category management inside Edit Modal
  const [modalTiers, setModalTiers] = useState([]);
  const [newModalTierName, setNewModalTierName] = useState('');
  const [newModalTierPrice, setNewModalTierPrice] = useState('');
  const [newModalTierQty, setNewModalTierQty] = useState('');
  const [isAddingModalTier, setIsAddingModalTier] = useState(false);
  const [savingModalTierId, setSavingModalTierId] = useState(null);
  const [editingTierDrafts, setEditingTierDrafts] = useState({});

  // Add tier form state
  const [tierName, setTierName] = useState('');
  const [tierPrice, setTierPrice] = useState('');
  const [tierQty, setTierQty] = useState('');
  const [isAddingTier, setIsAddingTier] = useState(false);

  // Edit tier & inventory state (PUT /categories/:id & PUT /categories/:id/inventory)
  const [editingTierId, setEditingTierId] = useState(null);
  const [editTierName, setEditTierName] = useState('');
  const [editPrice, setEditPrice] = useState('');
  const [editTotalQty, setEditTotalQty] = useState('');
  const [isSavingTierEdit, setIsSavingTierEdit] = useState(false);

  // Live Inventory Breakdown Modal state (GET /categories/:id/inventory & PUT /categories/:id/inventory)
  const [inspectingTier, setInspectingTier] = useState(null);
  const [inventoryStats, setInventoryStats] = useState(null);
  const [isLoadingInventory, setIsLoadingInventory] = useState(false);
  const [newQuotaValue, setNewQuotaValue] = useState('');
  const [isSavingQuota, setIsSavingQuota] = useState(false);

  // Dutch auction state
  const [auctionTier, setAuctionTier] = useState(null);
  const [auctionStartPrice, setAuctionStartPrice] = useState('');
  const [auctionMinPrice, setAuctionMinPrice] = useState('');
  const [auctionDurationHours, setAuctionDurationHours] = useState('24');
  const [isCreatingAuction, setIsCreatingAuction] = useState(false);

  // Load Organizer Events from Backend
  const loadOrganizerData = useCallback(async (showNotification = false) => {
    const effRole = currentUser ? (currentUser.role || 'USER') : (currentRole || 'PUBLIC');
    const hasOrgAccess =
      effRole === 'ADMIN' ||
      effRole === 'ORGANIZER' ||
      currentUser?.role === 'ADMIN' ||
      currentUser?.role === 'ORGANIZER' ||
      currentUser?.organizer != null;

    if (!currentUser || effRole === 'PUBLIC' || !hasOrgAccess) {
      setIsLoading(false);
      return;
    }

    try {
      const [eventsRes, profileRes] = await Promise.allSettled([
        api.organizer.getEvents(),
        api.organizer.getProfile(),
      ]);

      if (profileRes.status === 'fulfilled' && profileRes.value?.data) {
        setOrganizerProfile(profileRes.value.data);
      }

      if (eventsRes.status === 'fulfilled') {
        const rawList =
          eventsRes.value?.data?.events ||
          eventsRes.value?.events ||
          (Array.isArray(eventsRes.value?.data) ? eventsRes.value.data : []) ||
          (Array.isArray(eventsRes.value) ? eventsRes.value : []);

        const formatted = rawList.map((ev, idx) => formatBackendEvent(ev, idx));
        setOrganizerEvents(formatted);

        // Keep selection or auto-select first event
        if (formatted.length > 0) {
          setSelectedEventId((prev) => (prev && formatted.some((e) => e.id === prev) ? prev : formatted[0].id));
        } else {
          setSelectedEventId(null);
        }

        if (showNotification) {
          showToast(`Dashboard refreshed (${formatted.length} events loaded)`, 'info');
        }
      } else {
        console.warn('Organizer events fetch notice:', eventsRes.reason);
      }
    } catch (err) {
      console.error('Failed to load organizer dashboard data:', err);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [currentUser, currentRole, showToast]);

  useEffect(() => {
    loadOrganizerData();
  }, [loadOrganizerData]);

  const selectedEvent = organizerEvents.find((e) => e.id === selectedEventId) || organizerEvents[0];

  // Aggregate Metrics
  const totalProduced = organizerEvents.length;
  const activeEventsCount = organizerEvents.filter((e) => e.status === 'PUBLISHED').length;

  const totalTicketsSold = organizerEvents.reduce((acc, ev) => {
    const soldForEv = (ev.tiers || []).reduce((tAcc, t) => tAcc + Math.max(0, (t.total || 0) - (t.left || 0)), 0);
    return acc + soldForEv;
  }, 0);

  const totalRevenue = organizerEvents.reduce((acc, ev) => {
    const revForEv = (ev.tiers || []).reduce((tAcc, t) => {
      const sold = Math.max(0, (t.total || 0) - (t.left || 0));
      return tAcc + sold * (t.price || 0);
    }, 0);
    return acc + revForEv;
  }, 0);

  // Handle Add Tier
  const handleSaveTier = async (e) => {
    e.preventDefault();
    if (!selectedEvent?.id) return;

    if (!tierName.trim() || !tierPrice || !tierQty) {
      showToast('Please fill in Tier Name, Price, and Quantity', 'error');
      return;
    }

    const p = parseFloat(tierPrice);
    const q = parseInt(tierQty, 10);

    if (isNaN(p) || p <= 0) {
      showToast('Price must be greater than 0', 'error');
      return;
    }

    if (isNaN(q) || q <= 0) {
      showToast('Quantity must be at least 1', 'error');
      return;
    }

    setIsAddingTier(true);
    try {
      await addCategoryToEvent(selectedEvent.id, {
        name: tierName.trim(),
        price: p,
        quantity: q,
      });

      setTierName('');
      setTierPrice('');
      setTierQty('');

      // Refresh organizer events from backend
      await loadOrganizerData();
    } catch (err) {
      // error handled in AppContext
    } finally {
      setIsAddingTier(false);
    }
  };

  // Handle Status Update (PATCH /events/:id/status: PUBLISHED, CANCELLED, COMPLETED)
  const handleUpdateStatus = async (eventId, newStatus, e) => {
    if (e) e.stopPropagation();
    if (newStatus === 'CANCELLED') {
      const confirmed = window.confirm(
        'Are you sure you want to cancel this event? Ticket sales will stop and the event will be marked as CANCELLED.'
      );
      if (!confirmed) return;
    }

    setIsUpdatingStatusId(eventId);
    try {
      await updateEventStatus(eventId, newStatus);
      await loadOrganizerData();
    } catch (err) {
      // toast shown in AppContext
    } finally {
      setIsUpdatingStatusId(null);
    }
  };

  const handlePublish = async (eventId, e) => {
    return handleUpdateStatus(eventId, 'PUBLISHED', e);
  };

  // Open Edit Event Modal (PUT /events/:id)
  const handleOpenEditEvent = (ev, e) => {
    if (e) e.stopPropagation();
    setSelectedEventId(ev.id);
    setEditingEvent(ev);
    const tiers = ev.tiers || [];
    setModalTiers(tiers);
    const initialDrafts = {};
    tiers.forEach((t) => {
      initialDrafts[t.id] = {
        name: t.name || '',
        price: String(t.price || ''),
        total: String(t.total || '')
      };
    });
    setEditingTierDrafts(initialDrafts);
    setNewModalTierName('');
    setNewModalTierPrice('');
    setNewModalTierQty('');

    let dateStr = '';
    if (ev.rawDate) {
      const d = new Date(ev.rawDate);
      if (!isNaN(d.getTime())) {
        dateStr = d.toISOString().slice(0, 16);
      }
    }
    setEditEventDate(dateStr);
    setEditEventLocation(ev.venue || ev.location || '');
    setEditEventDesc(ev.description || '');
    setEditEventPrice(ev.basePrice != null ? String(ev.basePrice) : '');
  };

  // Update existing category price & details from modal (PUT /categories/:id & PUT /categories/:id/inventory)
  const handleSaveTierDraft = async (tierId) => {
    const draft = editingTierDrafts[tierId];
    if (!draft) return;
    const p = parseFloat(draft.price);
    const q = parseInt(draft.total, 10);
    if (!draft.name.trim()) {
      showToast('Category name is required', 'error');
      return;
    }
    if (isNaN(p) || p <= 0) {
      showToast('Price must be greater than 0', 'error');
      return;
    }
    if (isNaN(q) || q <= 0) {
      showToast('Quantity must be greater than 0', 'error');
      return;
    }

    setSavingModalTierId(tierId);
    try {
      await updateCategoryDetails(tierId, { name: draft.name.trim(), originalPrice: p });
      if (!isNaN(q) && q > 0) {
        await updateCategoryInventory(tierId, q);
      }
      showToast(`Category "${draft.name}" price updated to ₹${p}!`, 'success');
      await loadOrganizerData();
      setModalTiers((prev) =>
        prev.map((t) => (t.id === tierId ? { ...t, name: draft.name.trim(), price: p, total: q } : t))
      );
    } catch (err) {
      // toast shown in AppContext
    } finally {
      setSavingModalTierId(null);
    }
  };

  // Add a new category tier from modal (POST /events/:id/categories)
  const handleAddCategoryFromModal = async (e) => {
    e.preventDefault();
    if (!editingEvent?.id) return;
    if (!newModalTierName.trim() || !newModalTierPrice || !newModalTierQty) {
      showToast('Please fill all category fields (Name, Price, Quantity)', 'error');
      return;
    }
    const p = parseFloat(newModalTierPrice);
    const q = parseInt(newModalTierQty, 10);
    if (isNaN(p) || p <= 0) {
      showToast('Price must be greater than 0', 'error');
      return;
    }
    if (isNaN(q) || q <= 0) {
      showToast('Quantity must be at least 1', 'error');
      return;
    }

    setIsAddingModalTier(true);
    try {
      const added = await addCategoryToEvent(editingEvent.id, {
        name: newModalTierName.trim(),
        price: p,
        quantity: q
      });
      showToast(`Category "${newModalTierName}" added with price ₹${p}!`, 'success');
      const newTierObj = {
        id: added?.id || `tier_${Date.now()}`,
        name: newModalTierName.trim(),
        price: p,
        total: q,
        left: q
      };
      setModalTiers((prev) => [...prev, newTierObj]);
      setEditingTierDrafts((prev) => ({
        ...prev,
        [newTierObj.id]: {
          name: newModalTierName.trim(),
          price: String(p),
          total: String(q)
        }
      }));
      setNewModalTierName('');
      setNewModalTierPrice('');
      setNewModalTierQty('');
      await loadOrganizerData();
    } catch (err) {
      // toast shown in AppContext
    } finally {
      setIsAddingModalTier(false);
    }
  };

  // Save Event Details (PUT /events/:id)
  const handleSaveEventDetails = async (e) => {
    e.preventDefault();
    if (!editingEvent?.id) return;

    if (!editEventName.trim()) {
      showToast('Event title is required', 'error');
      return;
    }

    setIsSavingEventDetails(true);
    try {
      const payload = {
        name: editEventName.trim(),
        location: editEventLocation.trim(),
        description: editEventDesc.trim(),
      };
      if (editEventDate) {
        payload.dateTime = new Date(editEventDate).toISOString();
      }
      if (editEventPrice && !isNaN(parseFloat(editEventPrice))) {
        payload.originalPrice = parseFloat(editEventPrice);
      }

      await updateEventDetails(editingEvent.id, payload);
      setEditingEvent(null);
      await loadOrganizerData();
    } catch (err) {
      // toast shown in AppContext
    } finally {
      setIsSavingEventDetails(false);
    }
  };

  // Category Tier Inline Edit (PUT /categories/:id & PUT /categories/:id/inventory)
  const handleStartEditTier = (tier) => {
    setEditingTierId(tier.id);
    setEditTierName(tier.name || '');
    setEditPrice(String(tier.price || ''));
    setEditTotalQty(String(tier.total || ''));
  };

  const handleSaveTierEdit = async (tier) => {
    setIsSavingTierEdit(true);
    try {
      const p = parseFloat(editPrice);
      const q = parseInt(editTotalQty, 10);
      let updatedSomething = false;

      const trimmedName = editTierName.trim();
      const nameChanged = trimmedName && trimmedName !== tier.name;
      const priceChanged = !isNaN(p) && p > 0 && p !== tier.price;

      if (nameChanged || priceChanged) {
        const catPayload = {};
        if (nameChanged) catPayload.name = trimmedName;
        if (priceChanged) catPayload.originalPrice = p;
        await updateCategoryDetails(tier.id, catPayload);
        updatedSomething = true;
      }

      if (!isNaN(q) && q >= 0 && q !== tier.total) {
        await updateCategoryInventory(tier.id, q);
        updatedSomething = true;
      }

      if (updatedSomething) {
        await loadOrganizerData();
      }
      setEditingTierId(null);
    } catch (err) {
      // error handled in AppContext
    } finally {
      setIsSavingTierEdit(false);
    }
  };

  // Category Live Inventory Inspection (GET /categories/:id/inventory)
  const handleInspectInventory = async (tier) => {
    setInspectingTier(tier);
    setIsLoadingInventory(true);
    setInventoryStats(null);
    setNewQuotaValue(String(tier.total || ''));

    try {
      const data = await getCategoryInventory(tier.id);
      setInventoryStats(data);
      if (data?.totalQuantity != null) {
        setNewQuotaValue(String(data.totalQuantity));
      }
    } catch (err) {
      // error handled in AppContext
    } finally {
      setIsLoadingInventory(false);
    }
  };

  // Category Inventory Quota Update directly in Modal (PUT /categories/:id/inventory)
  const handleSaveQuotaFromModal = async (e) => {
    e.preventDefault();
    if (!inspectingTier?.id) return;
    const q = parseInt(newQuotaValue, 10);
    if (isNaN(q) || q < 0) {
      showToast('Please enter a valid stock quota quantity', 'error');
      return;
    }

    if (inventoryStats && q < inventoryStats.soldCount) {
      showToast(`Cannot set total stock below tickets already sold (${inventoryStats.soldCount})`, 'error');
      return;
    }

    setIsSavingQuota(true);
    try {
      await updateCategoryInventory(inspectingTier.id, q);
      const refreshed = await getCategoryInventory(inspectingTier.id);
      setInventoryStats(refreshed);
      await loadOrganizerData();
    } catch (err) {
      // error handled in AppContext
    } finally {
      setIsSavingQuota(false);
    }
  };

  const handleOpenAuction = (tier) => {
    setAuctionTier(tier);
    setAuctionStartPrice(String(Math.round(tier.price * 1.5)));
    setAuctionMinPrice(String(tier.price));
    setAuctionDurationHours('24');
  };

  const handleCreateDutchAuction = async (e) => {
    e.preventDefault();
    if (!auctionTier || !selectedEvent?.id) return;

    const startP = parseFloat(auctionStartPrice);
    const minP = parseFloat(auctionMinPrice);
    const durationH = parseFloat(auctionDurationHours) || 24;

    if (isNaN(startP) || startP <= 0 || isNaN(minP) || minP <= 0) {
      showToast('Start price and minimum reserve price must be positive numbers', 'warning');
      return;
    }

    if (minP >= startP) {
      showToast('Minimum reserve price must be lower than the start price for a Dutch auction', 'warning');
      return;
    }

    setIsCreatingAuction(true);
    try {
      const now = new Date();
      const end = new Date(now.getTime() + durationH * 3600 * 1000);
      await api.auctions.createAuction({
        eventId: selectedEvent.id,
        categoryId: auctionTier.id,
        startPrice: startP,
        minPrice: minP,
        startTime: now.toISOString(),
        endTime: end.toISOString()
      });

      showToast(`Dutch auction created for tier "${auctionTier.name}"! Price drops from ₹${startP} to ₹${minP}`, 'success');
      setAuctionTier(null);
    } catch (err) {
      console.error('Failed to create Dutch auction:', err);
      const msg = err?.data?.error?.message || err?.message || 'Failed to launch Dutch auction';
      showToast(msg, 'error');
    } finally {
      setIsCreatingAuction(false);
    }
  };

  // 1. Guard: Restoring Session
  if (authLoading && !currentUser) {
    return (
      <div className="content-wrap" style={{ maxWidth: 1200, padding: '32px 20px' }}>
        <DashboardSkeleton />
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

  // 2. Guard: Visitor / Unauthenticated
  if (!currentUser || effectiveRole === 'PUBLIC') {
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
            Organizer Access Required
          </h2>
          <p style={{ color: 'var(--text-sub)', fontSize: 14, maxWidth: 440, margin: '0 auto 24px' }}>
            The Organizer Console provides box office operations, ticket category minting, and sales analytics. Sign in with a verified organizer account to continue.
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
            <p style={{ marginBottom: 12 }}>Test with a verified organizer account:</p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
              <button
                className="btn-secondary"
                style={{ fontSize: 12, padding: '6px 14px' }}
                onClick={() => login('ali@passflow.com', 'Password123!')}
              >
                <Sparkles size={13} color="var(--accent-orange)" />
                <span>Sign In as Ali (Ali Productions)</span>
              </button>
              <button
                className="btn-secondary"
                style={{ fontSize: 12, padding: '6px 14px' }}
                onClick={() => login('organizer@livenation.com', 'Password123!')}
              >
                <Building size={13} color="var(--accent-emerald)" />
                <span>Sign In as Live Nation India</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // 3. Guard: Authenticated but Not an Organizer (Role: USER)
  if (!isOrganizerOrAdmin) {
    return (
      <div className="content-wrap" style={{ maxWidth: 640 }}>
        <div className="card" style={{ textAlign: 'center', padding: '40px 24px', marginTop: 20 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: '50%',
              background: 'var(--accent-orange-subtle)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 16
            }}
          >
            <Building size={26} color="var(--accent-orange)" />
          </div>

          <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>
            Become an Organizer
          </h2>
          <p style={{ color: 'var(--text-sub)', fontSize: 14, maxWidth: 440, margin: '0 auto 24px' }}>
            Your account ({currentUser.email}) currently does not have an approved organizer profile. Submit an application to unlock the Organizer Console and publish live events.
          </p>

          <button
            className="btn-primary"
            style={{ padding: '10px 24px', fontSize: 14 }}
            onClick={() => navigate('/organizer/apply')}
          >
            <span>Apply for Organizer Status</span>
            <ArrowRight size={14} />
          </button>
        </div>
      </div>
    );
  }

  const organizationName =
    organizerProfile?.organizationName ||
    currentUser?.organizer?.organizationName ||
    (currentUser?.role === 'ADMIN' ? 'PassFlow Global Events (Admin)' : `${currentUser?.name || 'My'} Productions`);

  return (
    <div className="content-wrap">
      {/* Top Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, flexWrap: 'wrap', gap: 14 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h1 style={{ fontSize: 26, fontWeight: 700, margin: 0 }}>Organizer Operations</h1>
            <span className="badge badge-orange font-mono">ORGANIZER CONSOLE</span>
            <span className="badge badge-green font-mono" style={{ fontSize: 11 }}>
              <ShieldCheck size={12} style={{ display: 'inline', marginRight: 4 }} />
              VERIFIED
            </span>
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4 }}>
            Organization: <strong style={{ color: 'var(--text-main)' }}>{organizationName}</strong> · Manage ticket inventories, mint new category tiers, and publish events
          </p>
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button
            className="btn-secondary"
            disabled={isRefreshing}
            onClick={() => {
              setIsRefreshing(true);
              loadOrganizerData(true);
            }}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <RefreshCw size={14} className={isRefreshing ? 'spin' : ''} />
            <span>{isRefreshing ? 'Syncing...' : 'Sync Data'}</span>
          </button>

          <button
            className="btn-primary"
            onClick={() => navigate('/organizer/events/new')}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <Plus size={16} />
            <span>Create Event</span>
          </button>
        </div>
      </div>

      {/* Aggregate KPI Metrics Cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
          gap: 16,
          marginBottom: 24
        }}
      >
        {/* Metric 1: Total Events */}
        <div className="card" style={{ padding: 18 }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6, fontWeight: 500 }}>
            PRODUCED EVENTS
          </div>
          <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--text-main)', fontFamily: 'monospace' }}>
            {totalProduced}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>
            {activeEventsCount} Active on Marketplace
          </div>
        </div>

        {/* Metric 2: Live Marketplace Status */}
        <div className="card" style={{ padding: 18 }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6, fontWeight: 500 }}>
            ACTIVE LIVE PRODUCTIONS
          </div>
          <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--accent-emerald)', fontFamily: 'monospace' }}>
            {activeEventsCount}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>
            {totalProduced - activeEventsCount} In Draft Mode
          </div>
        </div>

        {/* Metric 3: Total Tickets Sold */}
        <div className="card" style={{ padding: 18 }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6, fontWeight: 500 }}>
            TICKETS SOLD TO DATE
          </div>
          <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--accent-orange)', fontFamily: 'monospace' }}>
            {totalTicketsSold.toLocaleString('en-IN')}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>
            Primary allocations validated
          </div>
        </div>

        {/* Metric 4: Total Box Office Revenue */}
        <div className="card" style={{ padding: 18 }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6, fontWeight: 500 }}>
            TOTAL BOX OFFICE REVENUE
          </div>
          <div style={{ fontSize: 24, fontWeight: 700, color: '#38bdf8', fontFamily: 'monospace' }}>
            ₹{totalRevenue.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>
            Direct Primary Gross Sales
          </div>
        </div>
      </div>

      {/* 1. My Events Table Card */}
      <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 24 }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>My Produced Events</h3>
          <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>Click row to inspect inventory tiers & quotas</span>
        </div>

        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Event Name</th>
                <th>Status</th>
                <th>Categories & Prices</th>
                <th>Capacity / Sold</th>
                <th>Box Office Revenue</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <>
                  {[1, 2, 3].map((key) => (
                    <tr key={key}>
                      <td style={{ padding: '16px 12px' }}><Skeleton width="180px" height="18px" /></td>
                      <td style={{ padding: '16px 12px' }}><Skeleton width="100px" height="16px" /></td>
                      <td style={{ padding: '16px 12px' }}><Skeleton width="70px" height="22px" borderRadius="12px" /></td>
                      <td style={{ padding: '16px 12px' }}><Skeleton width="90px" height="16px" /></td>
                      <td style={{ padding: '16px 12px' }}><Skeleton width="80px" height="16px" /></td>
                      <td style={{ padding: '16px 12px' }}><Skeleton width="110px" height="28px" borderRadius="6px" /></td>
                    </tr>
                  ))}
                </>
              ) : organizerEvents.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-sub)' }}>
                    <p style={{ margin: '0 0 12px 0', fontSize: 14 }}>No events created yet under your organizer profile.</p>
                    <button
                      className="btn-primary"
                      onClick={() => navigate('/organizer/events/new')}
                    >
                      <Plus size={14} />
                      <span>Create Your First Event</span>
                    </button>
                  </td>
                </tr>
              ) : (
                organizerEvents.map((ev) => {
                  const isSelected = ev.id === selectedEventId;
                  const totalSold = (ev.tiers || []).reduce(
                    (acc, t) => acc + Math.max(0, (t.total || 0) - (t.left || 0)),
                    0
                  );
                  const totalCapacity = (ev.tiers || []).reduce((acc, t) => acc + (t.total || 0), 0);
                  const revenue = (ev.tiers || []).reduce((acc, t) => {
                    const sold = Math.max(0, (t.total || 0) - (t.left || 0));
                    return acc + sold * (t.price || 0);
                  }, 0);

                  const isPublishingThis = isPublishingId === ev.id;

                  return (
                    <tr
                      key={ev.id}
                      style={{
                        cursor: 'pointer',
                        background: isSelected ? 'rgba(249, 115, 22, 0.12)' : undefined,
                        borderLeft: isSelected ? '3px solid var(--accent-orange)' : '3px solid transparent'
                      }}
                      onClick={() => setSelectedEventId(ev.id)}
                    >
                      <td>
                        <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-main)' }}>{ev.title}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>
                          {ev.fullDate} · {ev.venue}
                        </div>
                      </td>
                      <td>
                        <span className={`badge ${
                          ev.status === 'PUBLISHED'
                            ? 'badge-green'
                            : ev.status === 'COMPLETED'
                            ? 'badge-blue'
                            : ev.status === 'CANCELLED'
                            ? 'badge-red'
                            : 'badge-orange'
                        }`}>
                          {ev.status}
                        </span>
                      </td>
                      <td style={{ minWidth: 170 }}>
                        {(ev.tiers || []).length === 0 ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontSize: 11, color: 'var(--text-dim)', fontStyle: 'italic' }}>
                              No categories
                            </span>
                            <button
                              type="button"
                              className="btn-secondary"
                              style={{ padding: '2px 6px', fontSize: 10 }}
                              onClick={(e) => handleOpenEditEvent(ev, e)}
                            >
                              + Add Price
                            </button>
                          </div>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            {ev.tiers.map((t) => (
                              <div
                                key={t.id}
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  justifyContent: 'space-between',
                                  background: 'rgba(255, 255, 255, 0.04)',
                                  border: '1px solid var(--border-subtle)',
                                  borderRadius: 'var(--radius-sm)',
                                  padding: '3px 8px',
                                  fontSize: 11,
                                  gap: 8
                                }}
                              >
                                <span style={{ fontWeight: 500, color: 'var(--text-sub)' }}>{t.name}</span>
                                <span className="font-mono" style={{ color: 'var(--accent-orange)', fontWeight: 700 }}>
                                  ₹{Number(t.price).toLocaleString('en-IN')}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="font-mono">
                        {ev.status === 'DRAFT' && totalSold === 0 ? (
                          <span style={{ color: 'var(--text-dim)' }}>{totalCapacity} total (Draft)</span>
                        ) : (
                          <span>
                            <strong>{totalSold}</strong> / {totalCapacity}
                          </span>
                        )}
                      </td>
                      <td className="font-mono" style={{ color: 'var(--accent-emerald)', fontWeight: 600 }}>
                        ₹{revenue.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          <button
                            className="btn-secondary"
                            style={{ padding: '4px 8px', fontSize: 11 }}
                            onClick={(e) => {
                              e.stopPropagation();
                              navigate(`/events/${ev.id}`);
                            }}
                            title="View public event page"
                          >
                            <Eye size={12} />
                            <span>View</span>
                          </button>

                          <button
                            className="btn-secondary"
                            style={{ padding: '4px 8px', fontSize: 11 }}
                            onClick={(e) => handleOpenEditEvent(ev, e)}
                            title="Edit Event Details (PUT /events/:id)"
                          >
                            <Edit3 size={12} />
                            <span>Edit</span>
                          </button>

                          {ev.status === 'DRAFT' && (
                            <button
                              className="btn-primary"
                              disabled={isUpdatingStatusId === ev.id}
                              style={{ padding: '4px 10px', fontSize: 11 }}
                              onClick={(e) => handleUpdateStatus(ev.id, 'PUBLISHED', e)}
                              title="Publish Event Live (PATCH /events/:id/status)"
                            >
                              {isUpdatingStatusId === ev.id ? (
                                <RefreshCw size={11} className="spin" />
                              ) : (
                                <span>Publish</span>
                              )}
                            </button>
                          )}

                          {ev.status === 'PUBLISHED' && (
                            <>
                              <button
                                className="btn-secondary"
                                disabled={isUpdatingStatusId === ev.id}
                                style={{ padding: '4px 8px', fontSize: 11, color: '#38bdf8', borderColor: 'rgba(56, 189, 248, 0.3)' }}
                                onClick={(e) => handleUpdateStatus(ev.id, 'COMPLETED', e)}
                                title="Mark Complete (PATCH /events/:id/status)"
                              >
                                Complete
                              </button>
                              <button
                                className="btn-secondary"
                                disabled={isUpdatingStatusId === ev.id}
                                style={{ padding: '4px 8px', fontSize: 11, color: '#ef4444', borderColor: 'rgba(239, 68, 68, 0.3)' }}
                                onClick={(e) => handleUpdateStatus(ev.id, 'CANCELLED', e)}
                                title="Cancel Event (PATCH /events/:id/status)"
                              >
                                Cancel
                              </button>
                            </>
                          )}

                          {(ev.status === 'CANCELLED' || ev.status === 'COMPLETED') && (
                            <button
                              className="btn-secondary"
                              disabled={isUpdatingStatusId === ev.id}
                              style={{ padding: '4px 8px', fontSize: 11 }}
                              onClick={(e) => handleUpdateStatus(ev.id, 'PUBLISHED', e)}
                              title="Re-activate event"
                            >
                              Reopen
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 2. Selected Event Inspector & Inventory Tier Panel */}
      {selectedEvent && (
        <div className="grid-2">
          {/* Left: Inventory Breakdown & Add Category */}
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <h3 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>{selectedEvent.title}</h3>
                  <span className={`badge ${
                    selectedEvent.status === 'PUBLISHED'
                      ? 'badge-green'
                      : selectedEvent.status === 'COMPLETED'
                      ? 'badge-blue'
                      : selectedEvent.status === 'CANCELLED'
                      ? 'badge-red'
                      : 'badge-orange'
                  }`}>
                    {selectedEvent.status}
                  </span>
                </div>
                <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                  {selectedEvent.fullDate} · {selectedEvent.venue} · Base: ₹{selectedEvent.basePrice || 'N/A'}
                </p>
              </div>

              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn-secondary"
                  style={{ padding: '6px 12px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}
                  onClick={(e) => handleOpenEditEvent(selectedEvent, e)}
                  title="Edit Event Title, Date, Venue, Description (PUT /events/:id)"
                >
                  <Edit3 size={13} />
                  <span>Edit Details</span>
                </button>

                {selectedEvent.status === 'DRAFT' && (
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={isUpdatingStatusId === selectedEvent.id || (selectedEvent.tiers || []).length === 0}
                    style={{ padding: '6px 14px', fontSize: 12 }}
                    onClick={(e) => handleUpdateStatus(selectedEvent.id, 'PUBLISHED', e)}
                  >
                    {isUpdatingStatusId === selectedEvent.id ? 'Publishing...' : 'Publish Live'}
                  </button>
                )}

                {selectedEvent.status === 'PUBLISHED' && (
                  <>
                    <button
                      type="button"
                      className="btn-secondary"
                      disabled={isUpdatingStatusId === selectedEvent.id}
                      style={{ padding: '6px 12px', fontSize: 12, borderColor: 'rgba(56, 189, 248, 0.4)', color: '#38bdf8' }}
                      onClick={(e) => handleUpdateStatus(selectedEvent.id, 'COMPLETED', e)}
                      title="Mark event completed (PATCH /events/:id/status)"
                    >
                      <Check size={13} />
                      <span>Complete Event</span>
                    </button>
                    <button
                      type="button"
                      className="btn-secondary"
                      disabled={isUpdatingStatusId === selectedEvent.id}
                      style={{ padding: '6px 12px', fontSize: 12, borderColor: 'rgba(239, 68, 68, 0.4)', color: '#ef4444' }}
                      onClick={(e) => handleUpdateStatus(selectedEvent.id, 'CANCELLED', e)}
                      title="Cancel event (PATCH /events/:id/status)"
                    >
                      <Ban size={13} />
                      <span>Cancel Event</span>
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Inventory Tiers List */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
              {(selectedEvent.tiers || []).length === 0 ? (
                <div
                  style={{
                    background: 'var(--bg-app)',
                    padding: 18,
                    borderRadius: 'var(--radius-sm)',
                    textAlign: 'center',
                    color: 'var(--text-dim)',
                    fontSize: 13
                  }}
                >
                  No category tiers configured yet. Add your first tier below.
                </div>
              ) : (
                selectedEvent.tiers.map((tier) => {
                  const sold = Math.max(0, (tier.total || 0) - (tier.left || 0));
                  const pctSold = tier.total > 0 ? Math.round((sold / tier.total) * 100) : 0;

                  const isEditingThis = editingTierId === tier.id;

                  return (
                    <div
                      key={tier.id}
                      style={{
                        background: 'var(--bg-app)',
                        padding: 14,
                        borderRadius: 'var(--radius-md)',
                        border: isEditingThis ? '1px solid var(--accent-orange)' : '1px solid var(--border-subtle)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 10
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          flexWrap: 'wrap',
                          gap: 12
                        }}
                      >
                        <div>
                          <strong style={{ fontSize: 14, color: 'var(--text-main)' }}>{tier.name}</strong>
                          <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 2 }}>
                            Face price: <span className="font-mono">₹{tier.price}</span> · Resale cap: <span className="font-mono" style={{ color: 'var(--accent-orange)' }}>₹{tier.cap || tier.price * 2}</span>
                          </div>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          <div style={{ textAlign: 'right' }}>
                            <div className="font-mono" style={{ fontSize: 13, fontWeight: 600 }}>
                              <span style={{ color: 'var(--accent-emerald)' }}>{tier.left} avail</span>,{' '}
                              <span style={{ color: 'var(--text-muted)' }}>{sold} sold</span>
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>
                              Quota: {tier.total} tickets ({pctSold}% allocated)
                            </div>
                          </div>

                          <div style={{ display: 'flex', gap: 6 }}>
                            <button
                              type="button"
                              className="btn-secondary"
                              style={{ padding: '5px 8px', fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}
                              onClick={() => handleInspectInventory(tier)}
                              title="Inspect Live Database Stock & Ledger Breakdown (GET /categories/:id/inventory)"
                            >
                              <Layers size={12} color="var(--accent-emerald)" />
                              <span>Stock</span>
                            </button>
                            <button
                              type="button"
                              className="btn-secondary"
                              style={{ padding: '5px 8px', fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}
                              onClick={() => (isEditingThis ? setEditingTierId(null) : handleStartEditTier(tier))}
                              title="Update category name, price, or inventory quota (PUT /categories/:id)"
                            >
                              <Edit3 size={12} />
                              <span>{isEditingThis ? 'Cancel' : 'Edit'}</span>
                            </button>
                            <button
                              type="button"
                              className="btn-secondary"
                              style={{ padding: '5px 8px', fontSize: 11, display: 'flex', alignItems: 'center', gap: 4, borderColor: 'var(--accent-orange-border)' }}
                              onClick={() => handleOpenAuction(tier)}
                              title="Launch Dutch price decay auction"
                            >
                              <Gavel size={12} color="var(--accent-orange)" />
                              <span>Auction</span>
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Inline Tier & Inventory Editor (PUT /categories/:id & PUT /categories/:id/inventory) */}
                      {isEditingThis && (
                        <div
                          style={{
                            paddingTop: 10,
                            borderTop: '1px solid var(--border-subtle)',
                            display: 'flex',
                            gap: 10,
                            alignItems: 'center',
                            flexWrap: 'wrap'
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>Name:</label>
                            <input
                              type="text"
                              value={editTierName}
                              onChange={(e) => setEditTierName(e.target.value)}
                              placeholder="Tier Name"
                              style={{ width: 110, fontSize: 12, padding: '4px 8px' }}
                            />
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>Price (₹):</label>
                            <input
                              type="number"
                              step="1"
                              min="1"
                              value={editPrice}
                              onChange={(e) => setEditPrice(e.target.value)}
                              style={{ width: 90, fontSize: 12, padding: '4px 8px' }}
                            />
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>Total Quota:</label>
                            <input
                              type="number"
                              min={sold}
                              value={editTotalQty}
                              onChange={(e) => setEditTotalQty(e.target.value)}
                              style={{ width: 90, fontSize: 12, padding: '4px 8px' }}
                            />
                          </div>

                          <button
                            type="button"
                            className="btn-primary"
                            disabled={isSavingTierEdit}
                            style={{ padding: '5px 12px', fontSize: 11 }}
                            onClick={() => handleSaveTierEdit(tier)}
                          >
                            {isSavingTierEdit ? 'Saving...' : 'Save Changes'}
                          </button>
                          <button
                            type="button"
                            className="btn-secondary"
                            style={{ padding: '5px 10px', fontSize: 11 }}
                            onClick={() => setEditingTierId(null)}
                          >
                            Cancel
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* Add Ticket Category Form */}
            <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 16 }}>
              <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Plus size={14} color="var(--accent-orange)" />
                <span>Mint New Category Tier</span>
              </h4>

              <form onSubmit={handleSaveTier}>
                <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr', gap: 10, marginBottom: 12 }}>
                  <input
                    type="text"
                    required
                    placeholder="Tier Name (e.g. Balcony)"
                    value={tierName}
                    onChange={(e) => setTierName(e.target.value)}
                    disabled={isAddingTier}
                  />
                  <input
                    type="number"
                    step="1"
                    min="1"
                    required
                    placeholder="Price (₹)"
                    value={tierPrice}
                    onChange={(e) => setTierPrice(e.target.value)}
                    disabled={isAddingTier}
                  />
                  <input
                    type="number"
                    min="1"
                    required
                    placeholder="Quantity"
                    value={tierQty}
                    onChange={(e) => setTierQty(e.target.value)}
                    disabled={isAddingTier}
                  />
                </div>

                <button
                  type="submit"
                  disabled={isAddingTier}
                  className="btn-secondary"
                  style={{ width: '100%', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                >
                  {isAddingTier ? (
                    <>
                      <RefreshCw size={14} className="spin" />
                      <span>Minting Tier on Database...</span>
                    </>
                  ) : (
                    <>
                      <Plus size={14} />
                      <span>Save Category Tier</span>
                    </>
                  )}
                </button>
              </form>
            </div>
          </div>

          {/* Right: Publish Checklist & Event Analytics */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div className="card">
              <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Publish Checklist</h3>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>
                Prerequisites required before event is discoverable on public `/events` directory:
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <CheckCircle2 size={18} color="#10b981" />
                  <span style={{ fontSize: 13 }}>Details complete (Title, venue, performance time)</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <CheckCircle2
                    size={18}
                    color={(selectedEvent.tiers || []).length > 0 ? '#10b981' : 'var(--text-dim)'}
                  />
                  <span style={{ fontSize: 13 }}>
                    {(selectedEvent.tiers || []).length > 0
                      ? `At least one category minted (${selectedEvent.tiers.length} active)`
                      : 'At least one ticket category minted (Required)'}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <CheckCircle2 size={18} color="#10b981" />
                  <span style={{ fontSize: 13 }}>Face price and anti-scalping 2x resale caps active</span>
                </div>
              </div>

              {selectedEvent.status === 'DRAFT' ? (
                <button
                  className="btn-primary"
                  style={{ width: '100%', padding: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
                  disabled={isUpdatingStatusId === selectedEvent.id || (selectedEvent.tiers || []).length === 0}
                  onClick={() => handleUpdateStatus(selectedEvent.id, 'PUBLISHED')}
                >
                  {isUpdatingStatusId === selectedEvent.id ? (
                    <>
                      <RefreshCw size={15} className="spin" />
                      <span>Publishing Event Live...</span>
                    </>
                  ) : (
                    <span>Publish Event Live to Marketplace</span>
                  )}
                </button>
              ) : selectedEvent.status === 'PUBLISHED' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div
                    style={{
                      background: 'rgba(16, 185, 129, 0.08)',
                      border: '1px solid var(--accent-emerald-border)',
                      padding: 12,
                      borderRadius: 'var(--radius-sm)',
                      textAlign: 'center',
                      color: 'var(--accent-emerald)',
                      fontSize: 13,
                      fontWeight: 600,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 8
                    }}
                  >
                    <CheckCircle2 size={16} />
                    <span>Event is Live & Discoverable on Public Exchange</span>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <button
                      type="button"
                      className="btn-secondary"
                      style={{ fontSize: 12, padding: '8px', color: '#38bdf8', borderColor: 'rgba(56, 189, 248, 0.3)' }}
                      onClick={() => handleUpdateStatus(selectedEvent.id, 'COMPLETED')}
                      disabled={isUpdatingStatusId === selectedEvent.id}
                      title="Mark Event Completed (PATCH /events/:id/status)"
                    >
                      Complete Event
                    </button>
                    <button
                      type="button"
                      className="btn-secondary"
                      style={{ fontSize: 12, padding: '8px', color: '#ef4444', borderColor: 'rgba(239, 68, 68, 0.3)' }}
                      onClick={() => handleUpdateStatus(selectedEvent.id, 'CANCELLED')}
                      disabled={isUpdatingStatusId === selectedEvent.id}
                      title="Cancel Event (PATCH /events/:id/status)"
                    >
                      Cancel Event
                    </button>
                  </div>
                </div>
              ) : selectedEvent.status === 'COMPLETED' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div
                    style={{
                      background: 'rgba(56, 189, 248, 0.08)',
                      border: '1px solid rgba(56, 189, 248, 0.3)',
                      padding: 12,
                      borderRadius: 'var(--radius-sm)',
                      textAlign: 'center',
                      color: '#38bdf8',
                      fontSize: 13,
                      fontWeight: 600
                    }}
                  >
                    Event is Completed (Archived)
                  </div>
                  <button
                    type="button"
                    className="btn-secondary"
                    style={{ fontSize: 12, padding: '8px' }}
                    onClick={() => handleUpdateStatus(selectedEvent.id, 'PUBLISHED')}
                    disabled={isUpdatingStatusId === selectedEvent.id}
                  >
                    Reopen Event as Published
                  </button>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div
                    style={{
                      background: 'rgba(239, 68, 68, 0.08)',
                      border: '1px solid rgba(239, 68, 68, 0.3)',
                      padding: 12,
                      borderRadius: 'var(--radius-sm)',
                      textAlign: 'center',
                      color: '#ef4444',
                      fontSize: 13,
                      fontWeight: 600
                    }}
                  >
                    Event is Cancelled
                  </div>
                  <button
                    type="button"
                    className="btn-secondary"
                    style={{ fontSize: 12, padding: '8px' }}
                    onClick={() => handleUpdateStatus(selectedEvent.id, 'PUBLISHED')}
                    disabled={isUpdatingStatusId === selectedEvent.id}
                  >
                    Re-activate Event
                  </button>
                </div>
              )}
            </div>

            {/* Quick Box Office Metric */}
            <div className="card">
              <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                <TrendingUp size={15} color="var(--accent-orange)" />
                <span>Primary Sales Payout Schedule</span>
              </h4>
              <p style={{ fontSize: 12, color: 'var(--text-sub)', lineHeight: 1.6, margin: 0 }}>
                Primary revenues are settled to your linked organizer account within 24 hours of gate validation. Anti-scalping caps protect your fans from secondary price gouging.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Dutch Auction Creation Modal */}
      {auctionTier && (
        <div className="modal-overlay" onClick={() => setAuctionTier(null)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
            <button
              onClick={() => setAuctionTier(null)}
              style={{ position: 'absolute', top: 16, right: 16, color: 'var(--text-dim)', background: 'transparent', border: 'none', cursor: 'pointer' }}
            >
              <X size={18} />
            </button>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <div style={{ width: 36, height: 36, borderRadius: 'var(--radius-sm)', background: 'var(--accent-orange-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Gavel size={18} color="var(--accent-orange)" />
              </div>
              <div>
                <h3 style={{ fontSize: 17, margin: 0 }}>Launch Dutch Auction</h3>
                <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '2px 0 0 0' }}>
                  {selectedEvent?.title} · Tier: {auctionTier.name}
                </p>
              </div>
            </div>

            <p style={{ fontSize: 12, color: 'var(--text-sub)', marginBottom: 16 }}>
              In a Dutch auction, the ticket price starts high and continuously drops linearly over time until buyers purchase tickets or the reserve price is reached.
            </p>

            <form onSubmit={handleCreateDutchAuction}>
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', fontSize: 12, color: 'var(--text-sub)', marginBottom: 4 }}>
                  Starting Price (₹)
                </label>
                <input
                  type="number"
                  step="1"
                  required
                  value={auctionStartPrice}
                  onChange={(e) => setAuctionStartPrice(e.target.value)}
                  style={{ width: '100%', fontSize: 14 }}
                />
              </div>

              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', fontSize: 12, color: 'var(--text-sub)', marginBottom: 4 }}>
                  Minimum Reserve Price (₹)
                </label>
                <input
                  type="number"
                  step="1"
                  required
                  value={auctionMinPrice}
                  onChange={(e) => setAuctionMinPrice(e.target.value)}
                  style={{ width: '100%', fontSize: 14 }}
                />
              </div>

              <div style={{ marginBottom: 18 }}>
                <label style={{ display: 'block', fontSize: 12, color: 'var(--text-sub)', marginBottom: 4 }}>
                  Auction Duration (Hours)
                </label>
                <input
                  type="number"
                  min="1"
                  max="168"
                  required
                  value={auctionDurationHours}
                  onChange={(e) => setAuctionDurationHours(e.target.value)}
                  style={{ width: '100%', fontSize: 14 }}
                />
              </div>

              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  type="button"
                  className="btn-secondary"
                  style={{ flex: 1 }}
                  onClick={() => setAuctionTier(null)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                  style={{ flex: 2 }}
                  disabled={isCreatingAuction}
                >
                  {isCreatingAuction ? 'Deploying Auction...' : 'Launch Dutch Auction'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Event Details Modal (PUT /events/:id) */}
      {editingEvent && (
        <div className="modal-overlay" onClick={() => setEditingEvent(null)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 540 }}>
            <button
              onClick={() => setEditingEvent(null)}
              style={{ position: 'absolute', top: 16, right: 16, color: 'var(--text-dim)', background: 'transparent', border: 'none', cursor: 'pointer' }}
            >
              <X size={18} />
            </button>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <div style={{ width: 36, height: 36, borderRadius: 'var(--radius-sm)', background: 'var(--accent-orange-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Edit3 size={18} color="var(--accent-orange)" />
              </div>
              <div>
                <h3 style={{ fontSize: 17, margin: 0 }}>Edit Event & Category Prices</h3>
                <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '2px 0 0 0' }}>
                  Update event details and category tier pricing (PUT /events/:id & PUT /categories/:id)
                </p>
              </div>
            </div>

            <form onSubmit={handleSaveEventDetails}>
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', fontSize: 12, color: 'var(--text-sub)', marginBottom: 4 }}>
                  Event Name / Title *
                </label>
                <input
                  type="text"
                  required
                  value={editEventName}
                  onChange={(e) => setEditEventName(e.target.value)}
                  style={{ width: '100%', fontSize: 14 }}
                  placeholder="e.g. Neon Horizon Music Festival"
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, color: 'var(--text-sub)', marginBottom: 4 }}>
                    Date & Time
                  </label>
                  <input
                    type="datetime-local"
                    value={editEventDate}
                    onChange={(e) => setEditEventDate(e.target.value)}
                    style={{ width: '100%', fontSize: 13 }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, color: 'var(--text-sub)', marginBottom: 4 }}>
                    Base Reference Price (₹)
                  </label>
                  <input
                    type="number"
                    step="1"
                    min="1"
                    value={editEventPrice}
                    onChange={(e) => setEditEventPrice(e.target.value)}
                    style={{ width: '100%', fontSize: 13 }}
                    placeholder="e.g. 1499"
                  />
                </div>
              </div>

              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', fontSize: 12, color: 'var(--text-sub)', marginBottom: 4 }}>
                  Venue / Location
                </label>
                <input
                  type="text"
                  value={editEventLocation}
                  onChange={(e) => setEditEventLocation(e.target.value)}
                  style={{ width: '100%', fontSize: 14 }}
                  placeholder="e.g. Jawaharlal Nehru Stadium, New Delhi"
                />
              </div>

              <div style={{ marginBottom: 14 }}>
                <label style={{ display: 'block', fontSize: 12, color: 'var(--text-sub)', marginBottom: 4 }}>
                  Event Description
                </label>
                <textarea
                  rows={2}
                  value={editEventDesc}
                  onChange={(e) => setEditEventDesc(e.target.value)}
                  style={{ width: '100%', fontSize: 13, resize: 'vertical' }}
                  placeholder="Describe the artists, rules, schedule, etc."
                />
              </div>

              {/* Category Tiers & Pricing Section */}
              <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border-subtle)', marginBottom: 18 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <div>
                    <h4 style={{ fontSize: 14, fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <DollarSign size={16} color="var(--accent-orange)" />
                      <span>Ticket Categories & Pricing (Har Category Ki Price)</span>
                    </h4>
                    <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '2px 0 0 0' }}>
                      Har category ka price (₹) yahan se directly edit aur save karein
                    </p>
                  </div>
                  <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                    {modalTiers.length} {modalTiers.length === 1 ? 'Tier' : 'Tiers'}
                  </span>
                </div>

                {/* Existing Tiers List with Price Inputs */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
                  {modalTiers.length === 0 ? (
                    <div style={{ padding: 12, background: 'var(--bg-app)', borderRadius: 'var(--radius-sm)', textAlign: 'center', color: 'var(--text-dim)', fontSize: 12 }}>
                      No categories yet. Mint your first category tier below!
                    </div>
                  ) : (
                    modalTiers.map((tier) => {
                      const draft = editingTierDrafts[tier.id] || {
                        name: tier.name || '',
                        price: String(tier.price || ''),
                        total: String(tier.total || '')
                      };

                      return (
                        <div
                          key={tier.id}
                          className="modal-tier-edit-grid"
                          style={{
                            background: 'var(--bg-app)',
                            padding: '10px 12px',
                            borderRadius: 'var(--radius-sm)',
                            border: '1px solid var(--border-subtle)',
                            marginBottom: 8
                          }}
                        >
                          <div>
                            <label style={{ fontSize: 10, color: 'var(--text-dim)', display: 'block', marginBottom: 2 }}>
                              Tier Name
                            </label>
                            <input
                              type="text"
                              value={draft.name}
                              onChange={(e) =>
                                setEditingTierDrafts((prev) => ({
                                  ...prev,
                                  [tier.id]: { ...draft, name: e.target.value }
                                }))
                              }
                              style={{ width: '100%', fontSize: 12, padding: '5px 8px' }}
                              placeholder="e.g. VIP"
                            />
                          </div>

                          <div>
                            <label style={{ fontSize: 10, color: 'var(--accent-orange)', display: 'block', marginBottom: 2, fontWeight: 700 }}>
                              Price (₹) *
                            </label>
                            <input
                              type="number"
                              step="1"
                              min="1"
                              value={draft.price}
                              onChange={(e) =>
                                setEditingTierDrafts((prev) => ({
                                  ...prev,
                                  [tier.id]: { ...draft, price: e.target.value }
                                }))
                              }
                              style={{
                                width: '100%',
                                fontSize: 13,
                                padding: '5px 8px',
                                borderColor: 'var(--accent-orange-border)',
                                color: 'var(--accent-orange)',
                                fontWeight: 700
                              }}
                              placeholder="Price"
                            />
                          </div>

                          <div>
                            <label style={{ fontSize: 10, color: 'var(--text-dim)', display: 'block', marginBottom: 2 }}>
                              Total Quota
                            </label>
                            <input
                              type="number"
                              min="1"
                              value={draft.total}
                              onChange={(e) =>
                                setEditingTierDrafts((prev) => ({
                                  ...prev,
                                  [tier.id]: { ...draft, total: e.target.value }
                                }))
                              }
                              style={{ width: '100%', fontSize: 12, padding: '5px 8px' }}
                              placeholder="Qty"
                            />
                          </div>

                          <div style={{ paddingTop: 14 }}>
                            <button
                              type="button"
                              className="btn-primary"
                              disabled={savingModalTierId === tier.id}
                              style={{ padding: '6px 12px', fontSize: 11, whiteSpace: 'nowrap' }}
                              onClick={() => handleSaveTierDraft(tier.id)}
                              title="Save this category price to database (PUT /categories/:id)"
                            >
                              {savingModalTierId === tier.id ? (
                                <RefreshCw size={11} className="spin" />
                              ) : (
                                <span>Save Price</span>
                              )}
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                {/* Add Category Subform */}
                <div style={{ background: 'rgba(255, 255, 255, 0.02)', padding: '10px 12px', borderRadius: 'var(--radius-sm)', border: '1px dashed var(--border-subtle)' }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-sub)', display: 'block', marginBottom: 6 }}>
                    + Add New Category Tier & Price
                  </span>
                  <div className="modal-tier-add-grid">
                    <input
                      type="text"
                      placeholder="Name (e.g. VIP Pass)"
                      value={newModalTierName}
                      onChange={(e) => setNewModalTierName(e.target.value)}
                      style={{ fontSize: 12, padding: '5px 8px' }}
                    />
                    <input
                      type="number"
                      step="1"
                      min="1"
                      placeholder="Price (₹)"
                      value={newModalTierPrice}
                      onChange={(e) => setNewModalTierPrice(e.target.value)}
                      style={{ fontSize: 12, padding: '5px 8px' }}
                    />
                    <input
                      type="number"
                      min="1"
                      placeholder="Quantity"
                      value={newModalTierQty}
                      onChange={(e) => setNewModalTierQty(e.target.value)}
                      style={{ fontSize: 12, padding: '5px 8px' }}
                    />
                    <button
                      type="button"
                      className="btn-secondary"
                      disabled={isAddingModalTier}
                      style={{ padding: '6px 12px', fontSize: 11, whiteSpace: 'nowrap' }}
                      onClick={handleAddCategoryFromModal}
                    >
                      {isAddingModalTier ? 'Adding...' : '+ Add Tier'}
                    </button>
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  type="button"
                  className="btn-secondary"
                  style={{ flex: 1 }}
                  onClick={() => setEditingEvent(null)}
                >
                  Done / Close
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                  style={{ flex: 2 }}
                  disabled={isSavingEventDetails}
                >
                  {isSavingEventDetails ? 'Saving to Database...' : 'Save Event Details'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Live Category Inventory Breakdown Modal (GET /categories/:id/inventory & PUT /categories/:id/inventory) */}
      {inspectingTier && (
        <div className="modal-overlay" onClick={() => setInspectingTier(null)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 500 }}>
            <button
              onClick={() => setInspectingTier(null)}
              style={{ position: 'absolute', top: 16, right: 16, color: 'var(--text-dim)', background: 'transparent', border: 'none', cursor: 'pointer' }}
            >
              <X size={18} />
            </button>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <div style={{ width: 36, height: 36, borderRadius: 'var(--radius-sm)', background: 'rgba(16, 185, 129, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Layers size={18} color="#10b981" />
              </div>
              <div>
                <h3 style={{ fontSize: 17, margin: 0 }}>Category Stock & Inventory</h3>
                <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '2px 0 0 0' }}>
                  {selectedEvent?.title} · Tier: <strong>{inspectingTier.name}</strong>
                </p>
              </div>
            </div>

            {isLoadingInventory ? (
              <div style={{ padding: '20px 0', display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
                  <Skeleton width="100%" height="60px" borderRadius="8px" />
                  <Skeleton width="100%" height="60px" borderRadius="8px" />
                  <Skeleton width="100%" height="60px" borderRadius="8px" />
                  <Skeleton width="100%" height="60px" borderRadius="8px" />
                </div>
              </div>
            ) : inventoryStats ? (
              <div>
                {/* 4 Metric Cards */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10, marginBottom: 16 }}>
                  <div style={{ background: 'var(--bg-app)', padding: 12, borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>TOTAL CAPACITY</div>
                    <div className="font-mono" style={{ fontSize: 20, fontWeight: 700, marginTop: 4, color: 'var(--text-main)' }}>
                      {inventoryStats.totalQuantity}
                    </div>
                  </div>

                  <div style={{ background: 'rgba(16, 185, 129, 0.05)', padding: 12, borderRadius: 'var(--radius-sm)', border: '1px solid var(--accent-emerald-border)' }}>
                    <div style={{ fontSize: 11, color: 'var(--accent-emerald)' }}>AVAILABLE STOCK</div>
                    <div className="font-mono" style={{ fontSize: 20, fontWeight: 700, marginTop: 4, color: 'var(--accent-emerald)' }}>
                      {inventoryStats.availableQuantity}
                    </div>
                  </div>

                  <div style={{ background: 'rgba(249, 115, 22, 0.05)', padding: 12, borderRadius: 'var(--radius-sm)', border: '1px solid var(--accent-orange-border)' }}>
                    <div style={{ fontSize: 11, color: 'var(--accent-orange)' }}>RESERVED (IN CARTS)</div>
                    <div className="font-mono" style={{ fontSize: 20, fontWeight: 700, marginTop: 4, color: 'var(--accent-orange)' }}>
                      {inventoryStats.reservedQuantity}
                    </div>
                  </div>

                  <div style={{ background: 'rgba(56, 189, 248, 0.05)', padding: 12, borderRadius: 'var(--radius-sm)', border: '1px solid rgba(56, 189, 248, 0.3)' }}>
                    <div style={{ fontSize: 11, color: '#38bdf8' }}>SOLD TICKETS</div>
                    <div className="font-mono" style={{ fontSize: 20, fontWeight: 700, marginTop: 4, color: '#38bdf8' }}>
                      {inventoryStats.soldCount}
                    </div>
                  </div>
                </div>

                {/* Progress Bar */}
                {inventoryStats.totalQuantity > 0 && (
                  <div style={{ marginBottom: 20 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-dim)', marginBottom: 6 }}>
                      <span>Allocation Breakdown</span>
                      <span>{Math.round(((inventoryStats.soldCount + inventoryStats.reservedQuantity) / inventoryStats.totalQuantity) * 100)}% Claimed</span>
                    </div>
                    <div style={{ height: 10, borderRadius: 5, background: 'var(--border-subtle)', overflow: 'hidden', display: 'flex' }}>
                      <div
                        style={{
                          width: `${(inventoryStats.soldCount / inventoryStats.totalQuantity) * 100}%`,
                          background: '#38bdf8'
                        }}
                        title={`Sold: ${inventoryStats.soldCount}`}
                      />
                      <div
                        style={{
                          width: `${(inventoryStats.reservedQuantity / inventoryStats.totalQuantity) * 100}%`,
                          background: 'var(--accent-orange)'
                        }}
                        title={`Reserved: ${inventoryStats.reservedQuantity}`}
                      />
                      <div
                        style={{
                          width: `${(inventoryStats.availableQuantity / inventoryStats.totalQuantity) * 100}%`,
                          background: '#10b981'
                        }}
                        title={`Available: ${inventoryStats.availableQuantity}`}
                      />
                    </div>
                    <div style={{ display: 'flex', gap: 14, fontSize: 10, color: 'var(--text-dim)', marginTop: 6 }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: '#38bdf8' }}></span> Sold</span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent-orange)' }}></span> In Escrow/Cart</span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: '#10b981' }}></span> Available</span>
                    </div>
                  </div>
                )}

                {/* Quota Adjustment Form (PUT /categories/:id/inventory) */}
                <form onSubmit={handleSaveQuotaFromModal} style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 14 }}>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-main)', marginBottom: 4 }}>
                    Adjust Total Inventory Quota (PUT /categories/:id/inventory)
                  </label>
                  <p style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 10 }}>
                    Strict database constraint: Cannot decrease below tickets already sold (≥ {inventoryStats.soldCount}).
                  </p>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <input
                      type="number"
                      min={inventoryStats.soldCount}
                      required
                      value={newQuotaValue}
                      onChange={(e) => setNewQuotaValue(e.target.value)}
                      style={{ flex: 1, fontSize: 14, padding: '8px 12px' }}
                    />
                    <button
                      type="submit"
                      disabled={isSavingQuota}
                      className="btn-primary"
                      style={{ padding: '8px 16px', fontSize: 12 }}
                    >
                      {isSavingQuota ? 'Updating...' : 'Update Quota'}
                    </button>
                  </div>
                </form>
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '20px', color: 'var(--text-dim)' }}>
                Could not load inventory details for this category.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
