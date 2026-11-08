import React, { useState } from 'react';
import { Gathering, UserProfile } from '../types';
import {
  Calendar,
  MapPin,
  Users,
  ShieldCheck,
  Lock,
  Plus,
  Minus,
  Check,
  Clock,
  X,
  ArrowRight,
  Wine,
  Dices,
  Dumbbell,
  Mountain,
  Music,
  UtensilsCrossed,
  Zap,
  ImagePlus,
  BadgeCheck,
  Pencil,
  Flame,
  type LucideIcon,
} from 'lucide-react';
import { hapticLight } from '../services/hapticService';
import { PlacePicker } from './PlacePicker';
import { sparkBurst } from './SparkBorder';
import { SwipeRow } from './SwipeRow';
import { EditPlanSheet, type PlanChanges } from './EditPlanSheet';
import { categoryKey, quickTime, myActivePlans, type QuickWhen } from '../services/eventsModel';

const CATEGORY_ART: Record<string, { label: string; icon: LucideIcon; rgb: string; rgb2: string }> = {
  social: { label: 'Social & Drinks', icon: Wine, rgb: '214, 170, 80', rgb2: '184, 92, 222' },
  games: { label: 'Games & Hobbies', icon: Dices, rgb: '120, 110, 255', rgb2: '70, 170, 230' },
  outdoor: { label: 'Outdoor & Adventure', icon: Mountain, rgb: '52, 211, 153', rgb2: '70, 150, 230' },
  music: { label: 'Music & Nightlife', icon: Music, rgb: '184, 92, 222', rgb2: '240, 120, 160' },
  food: { label: 'Food & Dining', icon: UtensilsCrossed, rgb: '240, 150, 90', rgb2: '214, 170, 80' },
  fitness: { label: 'Fitness & Wellness', icon: Dumbbell, rgb: '70, 190, 230', rgb2: '52, 211, 153' },
};
const artFor = (category: string) => CATEGORY_ART[categoryKey(category, Object.keys(CATEGORY_ART))];


const QUICK_WHEN: { id: QuickWhen; label: string }[] = [
  { id: 'hour', label: 'In an hour' }, { id: 'tonight', label: 'Tonight' }, { id: 'tomorrow', label: 'Tomorrow' }, { id: 'weekend', label: 'Saturday night' }, { id: 'sunday', label: 'Sunday' },
];
const quickPresets = (area: string): { text: string; category: Gathering['category']; when: QuickWhen; icon: LucideIcon }[] => [
  { text: 'Drinks tonight?', category: 'social', when: 'tonight', icon: Wine },
  { text: 'Anyone up for coffee nearby?', category: 'food', when: 'tomorrow', icon: UtensilsCrossed },
  { text: 'Anyone going to the gym?', category: 'fitness', when: 'tonight', icon: Dumbbell },
  { text: 'Sunday walk?', category: 'outdoor', when: 'sunday', icon: Mountain },
  { text: 'Anyone going out this weekend?', category: 'music', when: 'weekend', icon: Music },
];
const QUICK_LABEL: Record<QuickWhen, string> = { hour: 'In an hour', tonight: 'Tonight', tomorrow: 'Tomorrow', weekend: 'Saturday night', sunday: 'Sunday' };
const isQuick = (g: Gathering) => (g.tags ?? []).includes('quick');
const pad2 = (n: number) => String(n).padStart(2, '0');
const toLocalInputValue = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };

const startsIn = (timestamp: number): string => {
  const diff = timestamp - Date.now();
  if (diff <= 0) return 'Now';
  const mins = Math.round(diff / 60000);
  if (mins < 60) return `In ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `In ${hours}h${mins % 60 ? ` ${mins % 60}m` : ''}`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'Tomorrow' : `In ${days} days`;
};

interface LaterViewProps {
  gatherings: Gathering[];
  onToggleRsvp: (gatheringId: string) => void;
  /** Host only: accept or decline someone who asked to join. */
  onRespondToRequest?: (gatheringId: string, userId: string, accept: boolean) => void | Promise<void>;
  /** Host only: change a plan's title, description, time or places. Resolves true when saved. */
  onUpdateGathering?: (plan: Gathering, changes: PlanChanges) => Promise<boolean>;
  /** Host only: cancel a plan (it stays listed, stamped CANCELLED). */
  onCancelGathering?: (gatheringId: string) => void | Promise<void>;
  /** Host only: remove a plan from the list for good (offered once it is cancelled). */
  onCloseGathering?: (gatheringId: string) => void | Promise<void>;
  onOpenProfile?: (userId: string, name: string) => void;
  onOpenGatheringChat: (gathering: Gathering) => void;
  /** `photo` is the optional event picture; the parent uploads it before posting. */
  onCreateGathering: (newGathering: Omit<Gathering, 'id' | 'rsvpCount' | 'isAttending'>, photo?: File | null) => void;
  currentUser: UserProfile;
  currentUserId: string | null;
  userLocation: { lat: number; lng: number } | null;
  activeIntentMode?: 'social' | 'private';
  /** True only when a real group conversation can be opened for a gathering. */
  groupChatAvailable?: boolean;
  /** Gathering id currently being written to the backend (RSVP/create). */
  busyGatheringId?: string | null;
}

export const LaterView: React.FC<LaterViewProps> = ({
  gatherings,
  onToggleRsvp,
  onRespondToRequest,
  onUpdateGathering,
  onCancelGathering,
  onCloseGathering,
  onOpenProfile,
  onOpenGatheringChat,
  onCreateGathering,
  currentUser,
  currentUserId,
  userLocation,
  activeIntentMode: _activeIntentMode,
  groupChatAvailable = false,
  busyGatheringId = null,
}) => {
  const [timeFilter, setTimeFilter] = useState<'all' | 'tonight' | 'tomorrow' | 'weekend'>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [isHostModalOpen, setIsHostModalOpen] = useState<boolean>(false);
  const [closingId, setClosingId] = useState<string | null>(null);
  const [closeBusy, setCloseBusy] = useState(false);
  const [editingPlan, setEditingPlan] = useState<Gathering | null>(null);
  const [swipeId, setSwipeId] = useState<string | null>(null);
  const [brokenPhotos, setBrokenPhotos] = useState<Set<string>>(new Set());
  const [showCancelled, setShowCancelled] = useState(false);

  // Form states
  const [formTitle, setFormTitle] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formCategory, setFormCategory] = useState<Gathering['category']>('social');
  // Stored as a `datetime-local` value (YYYY-MM-DDTHH:mm) so the scheduled time
  // is always a real, unambiguous timestamp.
  const [formDate, setFormDate] = useState('');
  const [formLocation, setFormLocation] = useState('');
  const [formAddress, setFormAddress] = useState('');
  const [formNeighborhood, setFormNeighborhood] = useState('');
  const [formCoords, setFormCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [formCapacity, setFormCapacity] = useState(16);
  const [formTags, setFormTags] = useState('');
  const [formPhoto, setFormPhoto] = useState<{ file: File; preview: string } | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const pickPhoto = (file: File | undefined) => {
    setPhotoError(null);
    if (!file) return;
    if (!/^image\/(jpeg|png|webp|heic|heif)$/i.test(file.type)) { setPhotoError('Choose a JPEG, PNG or WebP picture.'); return; }
    if (file.size > 12 * 1024 * 1024) { setPhotoError('That picture is too large. Choose one under 12 MB.'); return; }
    setFormPhoto((prev) => { if (prev) URL.revokeObjectURL(prev.preview); return { file, preview: URL.createObjectURL(file) }; });
  };
  const clearPhoto = () => setFormPhoto((prev) => { if (prev) URL.revokeObjectURL(prev.preview); return null; });
  // A quick plan is a lightweight, spontaneous gathering ("Anyone fancy a drink tonight?"); an event is a formal listing.
  const [hostKind, setHostKind] = useState<'event' | 'quick'>('event');
  const [quickWhen, setQuickWhen] = useState<QuickWhen | null>(null);
  const quick = hostKind === 'quick';
  const area = currentUser.neighborhood || '';

  // Filters run off the real scheduled timestamp, so they also work for
  // backend gatherings (whose dateStr is a formatted date, not a label).
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfTomorrow = startOfToday + 24 * 60 * 60 * 1000;
  const startOfDayAfterTomorrow = startOfTomorrow + 24 * 60 * 60 * 1000;

  const filteredGatherings = gatherings
    .filter((g) => g.timestamp > Date.now())
    .filter((g) => {
      if (categoryFilter !== 'all' && categoryKey(g.category, Object.keys(CATEGORY_ART)) !== categoryFilter) return false;
      if (timeFilter === 'tonight' && !(g.timestamp >= startOfToday && g.timestamp < startOfTomorrow)) return false;
      if (timeFilter === 'tomorrow' && !(g.timestamp >= startOfTomorrow && g.timestamp < startOfDayAfterTomorrow)) return false;
      if (timeFilter === 'weekend') {
        const weekday = new Date(g.timestamp).getDay();
        if (weekday !== 5 && weekday !== 6 && weekday !== 0) return false;
      }
      return true;
    })
    // Cancelled plans stay listed (stamped) but sit below everything still happening.
    .sort((a, b) => Number(Boolean(a.cancelled)) - Number(Boolean(b.cancelled)) || a.timestamp - b.timestamp);

  const [formError, setFormError] = useState<string | null>(null);

  const handleHostSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formTitle.trim()) {
      setFormError('Add a title for the gathering.');
      return;
    }

    const timestamp = new Date(formDate).getTime();
    if (!Number.isFinite(timestamp)) {
      setFormError('Choose a date and time for the gathering.');
      return;
    }
    if (timestamp <= Date.now()) {
      setFormError('Choose a date and time in the future.');
      return;
    }
    if (!quick && !formLocation.trim()) {
      setFormError('Add a venue name.');
      return;
    }
    setFormError(null);

    onCreateGathering({
      hostId: currentUserId || 'local-user',
      hostName: currentUser.displayName,
      hostShortKey: currentUser.shortKey,
      hostAvatar: currentUser.avatarSeed,
      title: formTitle,
      description: formDesc || (quick ? 'A casual plan. Join and say hello in the group chat.' : 'A gathering for connection and shared interests.'),
      category: formCategory,
      dateStr: new Date(timestamp).toLocaleString([], { weekday: 'long', hour: '2-digit', minute: '2-digit' }),
      timestamp,
      locationName: formLocation.trim() || (quick ? `Around ${area || 'here'}` : formLocation),
      address: formAddress || (quick ? (formLocation.trim() || area || 'To be agreed in the group chat') : formAddress),
      neighborhood: formNeighborhood || (quick ? area : formNeighborhood),
      isSafeHavenVenue: false,
      lat: formCoords?.lat ?? userLocation?.lat ?? null,
      lng: formCoords?.lng ?? userLocation?.lng ?? null,
      capacity: formCapacity,
      tags: [...formTags.split(',').map((t) => t.trim()).filter(Boolean), ...(quick ? ['quick'] : [])],
      safetyGuidelines: 'Safe Haven principles. Consent-first communication and respectful space conduct.',
    }, formPhoto?.file ?? null);

    setIsHostModalOpen(false);
    setFormTitle('');
    setFormDesc('');
    setFormDate('');
    setFormLocation('');
    setFormAddress('');
    setFormNeighborhood('');
    setFormCoords(null);
    setFormError(null);
    setHostKind('event');
    setQuickWhen(null);
    clearPhoto();
  };

  const startQuickPlan = (text: string, category: Gathering['category'], when: QuickWhen) => {
    setHostKind('quick');
    setFormTitle(text);
    setFormCategory(category);
    setQuickWhen(when);
    setFormDate(toLocalInputValue(quickTime(when)));
    setFormCapacity(8);
    setFormError(null);
    setIsHostModalOpen(true);
  };

  const nextUp = filteredGatherings.find((g) => !g.cancelled);
  // Other people's (and your own) quick plans in the next three days, soonest first.
  const myPlans = myActivePlans(gatherings).slice(0, 4);
  // Quick plans already shown in "Happening near you" are not repeated in the full list unless a filter is on.
  const livePlans = gatherings
    .filter((g) => isQuick(g) && g.hostName !== 'You' && !g.cancelled && g.timestamp > Date.now() && g.timestamp < Date.now() + 72 * 3600_000)
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(0, 8);
  const railIds = new Set(livePlans.map((g) => g.id));
  const unfiltered = timeFilter === 'all' && categoryFilter === 'all';
  // Your own quick plans live in "Your plans" (edit, requests, chat), and others' in the rail; the full list does not repeat them.
  const activeList = filteredGatherings.filter((g) => !g.cancelled && !(unfiltered && (railIds.has(g.id) || (isQuick(g) && g.hostName === 'You'))));
  const cancelledList = filteredGatherings.filter((g) => g.cancelled);

  return (
    <div className="gayze-premium-page space-y-5">
      <div className="g-later__hero">
        <div className="min-w-0">
          <div className="g-label">Events</div>
          <h1 className="g-later__title">Find something happening. Or make it happen.</h1>
          <p className="g-later__sub">Discover local gatherings, meet people with shared interests and organise something of your own.</p>
        </div>
      </div>

      <div className="ev-actions">
        <button type="button" className="ev-action ev-action--host" onClick={() => { hapticLight(); setHostKind('event'); setIsHostModalOpen(true); }}>
          <Plus className="w-5 h-5" aria-hidden="true" /><span><b>Host an event</b><small>Create a gathering and chat with everyone who is going</small></span>
        </button>
      </div>

      {myPlans.length > 0 && (
        <section className="yp" aria-label="Your plans">
          <h2>Your plans</h2>
          {myPlans.map((g) => {
            const art = artFor(g.category);
            const confirming = closingId === `mine:${g.id}`;
            return (
              <SwipeRow key={g.id} hintKey={g.id === myPlans[0]?.id ? 'gayze:hint:swipe-plans' : undefined} isOpen={swipeId === g.id} onOpenChange={(open) => setSwipeId(open ? g.id : null)}
                actions={[
                  ...(onCancelGathering ? [{ key: 'cancel', label: 'Cancel', tone: 'danger' as const, icon: <X className="w-5 h-5" aria-hidden="true" />, onClick: () => setClosingId(`mine:${g.id}`) }] : []),
                  ...(onUpdateGathering ? [{ key: 'edit', label: 'Edit', tone: 'archive' as const, icon: <Pencil className="w-5 h-5" aria-hidden="true" />, onClick: () => setEditingPlan(g) }] : []),
                ]}>
              <article className="yp__row" style={{ ['--ev' as string]: art.rgb, ['--ev2' as string]: art.rgb2 }}>
                <div className="yp__info">
                  <span className="yp__kind">{isQuick(g) ? 'Quick plan' : art.label} · {startsIn(g.timestamp)}</span>
                  <strong>{g.title}</strong>
                  <small>{g.rsvpCount} going{(g.pending?.length ?? 0) > 0 ? ` · ${g.pending!.length} waiting for you` : ''}</small>
                </div>
                {(g.pending?.length ?? 0) > 0 && (
                  <div className="yp__requests" role="group" aria-label={`Requests to join ${g.title}`}>
                    <h3>{g.pending!.length === 1 ? '1 person wants to join' : `${g.pending!.length} people want to join`}</h3>
                    {g.pending!.map((r) => {
                      const full = g.rsvpCount >= g.capacity;
                      return (
                        <div key={r.userId} className="yp__request">
                          <button type="button" className="yp__who" onClick={() => onOpenProfile?.(r.userId, r.name)}>{r.name}</button>
                          <button type="button" className="yp__no" onClick={() => { hapticLight(); void onRespondToRequest?.(g.id, r.userId, false); }}>Decline</button>
                          <button type="button" className="yp__yes" disabled={full} onClick={() => { hapticLight(); void onRespondToRequest?.(g.id, r.userId, true); }}>Accept</button>
                        </div>
                      );
                    })}
                    {g.rsvpCount >= g.capacity && <p className="yp__note">Full. Raise the places with Edit, or decline someone.</p>}
                  </div>
                )}
                {g.conversationId
                  ? <button type="button" className="yp__chat" onClick={() => { hapticLight(); onOpenGatheringChat(g); }}><Users className="w-4 h-4" aria-hidden="true" />Group chat<ArrowRight className="w-4 h-4" aria-hidden="true" /></button>
                  : <p className="yp__note">Your group chat opens as soon as you accept someone.</p>}
                {confirming ? (
                  <div className="yp__confirm" role="alertdialog" aria-label={`Cancel ${g.title}?`}>
                    <p>Cancel this plan?{g.rsvpCount > 1 ? ` The ${g.rsvpCount - 1} joining are told in the group chat.` : ''}</p>
                    <button type="button" disabled={closeBusy} onClick={() => setClosingId(null)}>Keep it</button>
                    <button type="button" className="is-danger" disabled={closeBusy} onClick={async () => { hapticLight(); setCloseBusy(true); try { await onCancelGathering?.(g.id); } finally { setCloseBusy(false); setClosingId(null); } }}>Cancel plan</button>
                  </div>
                ) : (
                  <div className="yp__acts">
                    {onUpdateGathering && <button type="button" onClick={() => { hapticLight(); setEditingPlan(g); }}>Edit</button>}
                    {onCancelGathering && <button type="button" className="is-danger" onClick={() => { hapticLight(); setClosingId(`mine:${g.id}`); }}>Cancel</button>}
                  </div>
                )}
              </article>
              </SwipeRow>
            );
          })}
        </section>
      )}

      <section className="qp" aria-label="Quick plans">
        <div className="qp__head">
          <span className="qp__bolt"><Zap className="w-5 h-5" aria-hidden="true" /></span>
          <div>
            <h2>Quick plans</h2>
            <p>Post in ten seconds. People nearby can join.</p>
          </div>
        </div>
        <div className="qp__row no-scrollbar">
          {quickPresets(area).map((q) => {
            const art = artFor(q.category);
            const Icon = q.icon;
            return (
              <button
                key={q.text}
                type="button"
                className="qp__card"
                style={{ ['--ev' as string]: art.rgb, ['--ev2' as string]: art.rgb2 }}
                onClick={(e) => { hapticLight(); sparkBurst(e.currentTarget, 'social', 40); window.setTimeout(() => startQuickPlan(q.text, q.category, q.when), 180); }}
              >
                <span className="qp__icon"><Icon className="w-6 h-6" aria-hidden="true" /></span>
                <Icon className="qp__ghost" aria-hidden="true" />
                <strong>{q.text}</strong>
                <span className="qp__go"><em>{QUICK_LABEL[q.when]}</em><ArrowRight className="w-4 h-4" aria-hidden="true" /></span>
              </button>
            );
          })}
        </div>
        {livePlans.length > 0 && (
          <div className="qp__live">
            <h3><Flame className="w-4 h-4" aria-hidden="true" />Happening near you</h3>
            <div className="qp__live-row no-scrollbar">
              {livePlans.map((g) => {
                const art = artFor(g.category);
                const mine = g.hostName === 'You';
                const spots = Math.max(0, g.capacity - g.rsvpCount);
                return (
                  <article key={g.id} className="qp__plan" style={{ ['--ev' as string]: art.rgb, ['--ev2' as string]: art.rgb2 }}>
                    <span className="qp__when">{g.timestamp - Date.now() < 3 * 3600_000 && <i aria-hidden="true" />}{startsIn(g.timestamp)}</span>
                    <strong>{g.title}</strong>
                    <small>{mine ? 'You' : g.hostName} · {g.rsvpCount} going{spots > 0 ? ` · ${spots} left` : ' · Full'}</small>
                    <button type="button" disabled={mine || busyGatheringId === g.id || (spots === 0 && !g.isAttending && g.myStatus !== 'requested')}
                      className={g.isAttending || mine ? 'is-going' : ''}
                      onClick={(e) => { hapticLight(); if (!g.isAttending) sparkBurst(e.currentTarget, 'social', 28); onToggleRsvp(g.id); }}>
                      {mine ? "You're hosting" : g.isAttending ? 'Going' : g.myStatus === 'requested' ? 'Requested' : 'Join'}
                    </button>
                  </article>
                );
              })}
            </div>
          </div>
        )}
      </section>

      <div className="g-later__filters">
        <div className="g-iseg g-iseg--4" data-tone="social" role="tablist" aria-label="When">
          {[
            { id: 'all', label: 'Any day' },
            { id: 'tonight', label: 'Tonight' },
            { id: 'tomorrow', label: 'Tomorrow' },
            { id: 'weekend', label: 'Weekend' },
          ].map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={timeFilter === item.id}
              className="g-iseg__opt"
              data-active={timeFilter === item.id}
              onClick={() => { hapticLight(); setTimeFilter(item.id as typeof timeFilter); }}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="g-later__cats no-scrollbar">
          {[{ id: 'all', label: 'Everything' }, ...Object.entries(CATEGORY_ART).map(([id, art]) => ({ id, label: art.label }))].map((cat) => {
            const art = cat.id === 'all' ? null : artFor(cat.id);
            const Icon = art?.icon;
            return (
              <button
                key={cat.id}
                type="button"
                className="g-later__cat"
                data-active={categoryFilter === cat.id}
                style={art ? { ['--cat' as string]: art.rgb } : undefined}
                onClick={() => { hapticLight(); setCategoryFilter(cat.id); }}
              >
                {Icon && <Icon className="w-3.5 h-3.5" />}
                {cat.label}
              </button>
            );
          })}
        </div>
      </div>

      {activeList.length === 0 && cancelledList.length === 0 && (
        <div className="g-later__empty">
          <span className="g-later__empty-icon"><Calendar className="w-6 h-6" /></span>
          <p>{gatherings.length === 0 ? 'Nothing planned yet' : 'Nothing matches these filters'}</p>
          <span>
            {gatherings.length === 0
              ? 'Be the first. Host a gathering and it appears here for people nearby.'
              : 'Try a different day or category.'}
          </span>
          {gatherings.length === 0 && (
            <button type="button" onClick={() => setIsHostModalOpen(true)} className="g-btn g-btn--amber !mt-2">
              <Plus className="w-4 h-4" /><span>Host the first one</span>
            </button>
          )}
        </div>
      )}

      <div className="g-later__grid" id="ev-list">
        {(() => { const renderCard = (gathering: Gathering) => {
          const isHost = gathering.hostName === 'You';
          // Everyone the host has accepted, and the host, share one private group chat.
          const chatReady = Boolean(gathering.conversationId) && (isHost || gathering.isAttending);
          const spotsLeft = Math.max(0, gathering.capacity - gathering.rsvpCount);
          const percentFull = Math.min(100, Math.round((gathering.rsvpCount / Math.max(1, gathering.capacity)) * 100));
          const art = artFor(gathering.category);
          const ArtIcon = art.icon;
          const when = new Date(gathering.timestamp);
          const isNext = gathering.id === nextUp?.id;
          const pile = Math.min(5, gathering.rsvpCount);

          return (
            <article
              key={gathering.id}
              className={`g-ev ${isNext ? 'is-next' : ''} ${gathering.isAttending ? 'is-going' : ''} ${gathering.cancelled ? 'is-cancelled' : ''}`}
              style={{ ['--ev' as string]: art.rgb, ['--ev2' as string]: art.rgb2 }}
            >
              {gathering.cancelled && <span className="g-ev__stamp" role="img" aria-label="Cancelled">Cancelled</span>}
              <div className={`g-ev__poster ${gathering.photoUrl && !brokenPhotos.has(gathering.id) ? 'has-photo' : ''}`}>
                {gathering.photoUrl && !brokenPhotos.has(gathering.id) ? <img className="g-ev__photo" src={gathering.photoUrl} alt="" loading="lazy" onError={() => setBrokenPhotos((prev) => new Set(prev).add(gathering.id))} /> : <ArtIcon className="g-ev__art" aria-hidden="true" />}
                <div className="g-ev__date" aria-label={when.toLocaleString()}>
                  <b>{when.getDate()}</b>
                  <span>{when.toLocaleString([], { month: 'short' })}</span>
                </div>
                <div className="g-ev__badges">
                  <span className={`g-ev__badge ${gathering.isAttending ? 'is-going' : ''}`}>
                    {gathering.isAttending && <Check className="w-3 h-3" aria-hidden="true" />}
                    {isHost ? 'Hosting · ' : gathering.isAttending ? 'Going · ' : isNext ? 'Up next · ' : ''}{startsIn(gathering.timestamp)}
                  </span>
                </div>
                <span className="g-ev__cat">{isQuick(gathering) ? `Quick plan · ${art.label}` : art.label}</span>
              </div>

              <div className="g-ev__body">
                <div className="g-ev__time"><Clock className="w-3.5 h-3.5" />{gathering.dateStr}</div>
                <h3 className="g-ev__name">{gathering.title}</h3>
                <div className="g-ev__host">
                  <span className="g-ev__host-av">{gathering.hostAvatarUrl ? <img src={gathering.hostAvatarUrl} alt="" /> : gathering.hostName.charAt(0)}</span>
                  <span>Hosted by <strong>{gathering.hostName}</strong>{gathering.hostVerified && <BadgeCheck className="g-ev__verified" aria-label="Verified" />}</span>
                </div>
                <p className="g-ev__desc">{gathering.description}</p>

                <div className="g-ev__venue">
                  <MapPin className="w-4 h-4" />
                  {gathering.placeHidden ? (
                    <div className="min-w-0">
                      <strong>{gathering.neighborhood || 'Area shared on request'}</strong>
                      <span>Exact place is shared once the host accepts you</span>
                    </div>
                  ) : (
                    <div className="min-w-0">
                      <strong>
                        {gathering.locationName}
                        {gathering.isSafeHavenVenue && <ShieldCheck className="inline w-3.5 h-3.5 ml-1 text-emerald-400" aria-label="Safe Haven venue" />}
                      </strong>
                      <span>{[gathering.address, gathering.neighborhood].filter(Boolean).join(' · ')}</span>
                    </div>
                  )}
                </div>

                <div className="g-ev__crowd">
                  <div className="g-ev__pile" aria-hidden="true">
                    {Array.from({ length: pile }, (_, i) => <i key={i} style={{ ['--n' as string]: i }}>{(gathering.attendees?.[i]?.name || '').charAt(0).toUpperCase()}</i>)}
                    {gathering.rsvpCount > pile && <em>+{gathering.rsvpCount - pile}</em>}
                  </div>
                  <span className="g-ev__count"><Users className="w-3.5 h-3.5" />{gathering.rsvpCount} going{spotsLeft > 0 ? ` · ${spotsLeft} left` : ' · Full'}</span>
                </div>
                <div className="g-ev__meter" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percentFull} aria-label="Spots taken">
                  <span style={{ width: `${percentFull}%` }} />
                </div>

                {(gathering.attendees?.length ?? 0) > 0 && (
                  <p className="g-ev__who"><Users className="w-3.5 h-3.5" aria-hidden="true" />
                    {gathering.attendees!.map((a, i) => (
                      <React.Fragment key={a.userId}>{i > 0 && ', '}<button type="button" onClick={() => onOpenProfile?.(a.userId, a.name)}>{a.userId === currentUserId ? 'You' : a.name}{a.isHost ? ' (host)' : ''}</button></React.Fragment>
                    ))}
                  </p>
                )}
                {isHost && !gathering.cancelled && (gathering.pending?.length ?? 0) > 0 && (
                  <div className="g-ev__requests" role="group" aria-label={`Requests to join ${gathering.title}`}>
                    <h4>Waiting for you · {gathering.pending!.length}</h4>
                    {gathering.pending!.map((r) => (
                      <div key={r.userId} className="g-ev__request">
                        <button type="button" className="g-ev__request-name" onClick={() => onOpenProfile?.(r.userId, r.name)}>{r.name}<small>wants to join</small></button>
                        <button type="button" className="g-ev__decline" onClick={() => { hapticLight(); void onRespondToRequest?.(gathering.id, r.userId, false); }}>Decline</button>
                        <button type="button" className="g-ev__accept" disabled={spotsLeft === 0} onClick={() => { hapticLight(); void onRespondToRequest?.(gathering.id, r.userId, true); }}>Accept</button>
                      </div>
                    ))}
                    {spotsLeft === 0 && <p className="g-ev__soon">Full. Decline someone, or no one else can be accepted.</p>}
                  </div>
                )}

                <p className="g-ev__pledge"><ShieldCheck className="w-3.5 h-3.5" /><span>{gathering.safetyGuidelines}</span></p>
              </div>

              <div className={`g-ev__actions ${chatReady ? '' : 'is-single'}`}>
                <button
                  type="button"
                  onClick={() => { hapticLight(); onToggleRsvp(gathering.id); }}
                  disabled={isHost || gathering.cancelled || gathering.myStatus === 'declined' || busyGatheringId === gathering.id || (spotsLeft === 0 && !gathering.isAttending && gathering.myStatus !== 'requested')}
                  className={`g-ev__rsvp ${gathering.isAttending || isHost ? 'is-going' : ''} ${gathering.myStatus === 'requested' ? 'is-requested' : ''}`}
                  aria-label={isHost ? `You're hosting ${gathering.title}.` : gathering.isAttending ? `You're going to ${gathering.title}. Tap to leave.` : gathering.myStatus === 'requested' ? `Request sent for ${gathering.title}. Tap to withdraw.` : undefined}
                >
                  {gathering.cancelled ? (
                    <span>Cancelled by the host</span>
                  ) : isHost ? (
                    <><Check className="w-4 h-4" /><span>You're hosting</span><small>{(gathering.pending?.length ?? 0) > 0 ? `${gathering.pending!.length} waiting` : gathering.rsvpCount > 1 ? `${gathering.rsvpCount - 1} joining` : 'No guests yet'}</small></>
                  ) : busyGatheringId === gathering.id ? (
                    <span>Saving…</span>
                  ) : gathering.isAttending ? (
                    <><Check className="w-4 h-4" /><span>Going</span><small>Tap to leave</small></>
                  ) : gathering.myStatus === 'requested' ? (
                    <><Clock className="w-4 h-4" /><span>Awaiting approval</span><small>Tap to withdraw</small></>
                  ) : gathering.myStatus === 'declined' ? (
                    <span>Not this time</span>
                  ) : spotsLeft === 0 ? (
                    <span>Full</span>
                  ) : (
                    <span>Ask to join</span>
                  )}
                </button>

                {chatReady && (
                  <button type="button" onClick={() => onOpenGatheringChat(gathering)} className="g-ev__room">
                    <Lock className="w-4 h-4" />
                    <span>Group chat</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                )}
              </div>
              {isHost && (gathering.cancelled ? onCloseGathering : onCancelGathering) && (() => {
                const remove = Boolean(gathering.cancelled);
                const act = remove ? onCloseGathering! : onCancelGathering!;
                return closingId === gathering.id ? (
                  <div className="g-ev__close g-ev__close--confirm" role="alertdialog" aria-label={`${remove ? 'Remove' : 'Cancel'} ${gathering.title}?`}>
                    <p>{remove
                      ? 'Remove this cancelled plan from the list? This cannot be undone.'
                      : `Cancel this plan? It stays on the list marked CANCELLED${gathering.rsvpCount > 1 ? `, and the ${gathering.rsvpCount - 1} joining are told in the group chat` : ''}. No one can join it after that.`}</p>
                    <button type="button" disabled={closeBusy} onClick={() => setClosingId(null)}>Keep it</button>
                    <button type="button" className="is-danger" disabled={closeBusy} onClick={async () => { hapticLight(); setCloseBusy(true); try { await act(gathering.id); } finally { setCloseBusy(false); setClosingId(null); } }}>{closeBusy ? 'Working…' : remove ? 'Remove plan' : 'Cancel plan'}</button>
                  </div>
                ) : (
                  <div className="g-ev__manage">
                    {!remove && onUpdateGathering && <button type="button" className="g-ev__close" onClick={() => { hapticLight(); setEditingPlan(gathering); }}>Edit plan</button>}
                    <button type="button" className="g-ev__close" onClick={() => { hapticLight(); setClosingId(gathering.id); }}>{remove ? 'Remove from list' : 'Cancel this plan'}</button>
                  </div>
                );
              })()}
              {!chatReady && gathering.isAttending && !isHost && (
                <p className="g-ev__soon"><Lock className="w-3 h-3" aria-hidden="true" />Your group chat opens here once it is set up.</p>
              )}
            </article>
          );
        };
        return (
          <>
            {activeList.map(renderCard)}
            {cancelledList.length > 0 && (
              <div className="ev-cancelled">
                <button type="button" className="ev-cancelled__toggle" aria-expanded={showCancelled} onClick={() => { hapticLight(); setShowCancelled((v) => !v); }}>
                  <X className="w-4 h-4" aria-hidden="true" />Cancelled<span>{cancelledList.length}</span>
                </button>
                {showCancelled && cancelledList.map(renderCard)}
              </div>
            )}
          </>
        ); })()}
      </div>

      <EditPlanSheet plan={editingPlan} onClose={() => setEditingPlan(null)} onSave={async (plan, changes) => (onUpdateGathering ? onUpdateGathering(plan, changes) : false)} />

      {isHostModalOpen && (
        <div className="g-overlay flex items-end sm:items-center justify-center sm:p-4" onClick={() => setIsHostModalOpen(false)} role="dialog" aria-modal="true" aria-label="Host a gathering">
          <div className="g-sheet g-sheet--above-nav g-iset g-sheet--dark" onClick={(e) => e.stopPropagation()}>
            <div className="g-sheet__grip" />
            <div className="g-sheet__head">
              <div className="min-w-0">
                <h2 className="text-[16px] font-semibold tracking-[-0.015em] text-white leading-tight">{quick ? 'Make a quick plan' : 'Host a gathering'}</h2>
                <p className="text-[11px] text-zinc-500 leading-tight mt-0.5">{quick ? 'A casual plan. People who join get a group chat.' : 'Creates an encrypted group room for the people who RSVP.'}</p>
              </div>
              <button type="button" onClick={() => setIsHostModalOpen(false)} className="g-icon-btn g-icon-btn--bare shrink-0" aria-label="Close modal">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleHostSubmit} className="flex-1 flex flex-col overflow-hidden min-h-0">
              <div className="g-sheet__body space-y-4">
                {formError && (
                  <p className="text-[12px] text-amber-300 bg-amber-500/10 border border-amber-500/25 rounded-xl px-3 py-2">{formError}</p>
                )}

                <div className="ev-kind" role="group" aria-label="Kind of plan">
                  <button type="button" aria-pressed={!quick} onClick={() => { hapticLight(); setHostKind('event'); }}>Event</button>
                  <button type="button" aria-pressed={quick} onClick={() => { hapticLight(); setHostKind('quick'); setFormCapacity((n) => Math.min(n, 12)); }}>Quick plan</button>
                </div>

                {quick && (
                  <div>
                    <span className="g-label">When</span>
                    <div className="ev-when no-scrollbar">
                      {QUICK_WHEN.map((w) => (
                        <button key={w.id} type="button" aria-pressed={quickWhen === w.id} onClick={() => { hapticLight(); setQuickWhen(w.id); setFormDate(toLocalInputValue(quickTime(w.id))); }}>{w.label}</button>
                      ))}
                    </div>
                  </div>
                )}

                <div>
                  <label htmlFor="gathering-title" className="g-label">{quick ? 'What is the plan?' : 'What is it?'}</label>
                  <input
                    id="gathering-title"
                    type="text"
                    required
                    maxLength={80}
                    placeholder={quick ? 'e.g. Anyone fancy a drink tonight?' : 'e.g. Queer sci-fi book club and wine'}
                    value={formTitle}
                    onChange={(e) => setFormTitle(e.target.value)}
                    className="g-field g-iset__field mt-2.5"
                  />
                </div>

                <div>
                  <span className="g-label">Picture <small className="ev-opt">optional</small></span>
                  {formPhoto ? (
                    <div className="ev-photo has-photo">
                      <img src={formPhoto.preview} alt="Your event picture" />
                      <button type="button" className="ev-photo__x" onClick={() => { hapticLight(); clearPhoto(); }} aria-label="Remove picture"><X className="w-4 h-4" /></button>
                    </div>
                  ) : (
                    <label className="ev-photo">
                      <ImagePlus className="w-6 h-6" aria-hidden="true" />
                      <span><b>Add a picture</b><small>Makes your plan stand out. Please don't show your address or other people's faces.</small></span>
                      <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => { pickPhoto(e.target.files?.[0]); e.target.value = ''; }} />
                    </label>
                  )}
                  {photoError && <p className="ev-photo__err" role="alert">{photoError}</p>}
                </div>

                <div>
                  <span className="g-label">Kind of gathering</span>
                  <div className="g-iset__grid mt-2.5">
                    {Object.entries(CATEGORY_ART).map(([id, art]) => {
                      const Icon = art.icon;
                      return (
                        <button
                          key={id}
                          type="button"
                          className="g-itile"
                          data-tone="social"
                          data-active={formCategory === id}
                          style={{ ['--it-rgb' as string]: art.rgb }}
                          onClick={() => { hapticLight(); setFormCategory(id as Gathering['category']); }}
                        >
                          <span className="g-itile__icon"><Icon className="w-[17px] h-[17px]" /></span>
                          <span className="g-itile__copy"><span className="g-itile__t">{art.label}</span></span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="gathering-datetime" className="g-label">When</label>
                    <input id="gathering-datetime" type="datetime-local" required value={formDate} onChange={(e) => setFormDate(e.target.value)} className="g-field g-iset__field mt-2.5" />
                  </div>
                  <div>
                    <span className="g-label">How many can come</span>
                    <div className="g-stepper mt-2.5">
                      <button type="button" aria-label="Fewer places" onClick={() => setFormCapacity((n) => Math.max(3, n - 1))}><Minus className="w-4 h-4" /></button>
                      <input id="gathering-capacity" aria-label="Capacity" type="number" min={3} max={100} value={formCapacity} onChange={(e) => setFormCapacity(Math.max(3, Math.min(100, Number(e.target.value) || 3)))} />
                      <button type="button" aria-label="More places" onClick={() => setFormCapacity((n) => Math.min(100, n + 1))}><Plus className="w-4 h-4" /></button>
                    </div>
                  </div>
                </div>

                <div>
                  <label htmlFor="gathering-venue" className="g-label">{quick ? 'Where (optional)' : 'Where'}</label>
                  <div className="mt-2.5">
                    <PlacePicker
                      id="gathering-venue" required={!quick} value={formLocation} near={userLocation}
                      placeholder="Search for a venue near you"
                      className="g-field g-iset__field"
                      onTextChange={(t) => { setFormLocation(t); setFormCoords(null); }}
                      onPick={(pl) => { setFormLocation(pl.name); setFormAddress(pl.address || pl.area || pl.name); setFormNeighborhood(pl.area); setFormCoords({ lat: pl.lat, lng: pl.lng }); }}
                    />
                  </div>
                  <input id="gathering-address" type="text" required={!quick} value={formAddress} onChange={(e) => setFormAddress(e.target.value)} placeholder="Street address" aria-label="Street address" className="g-field g-iset__field mt-2" />
                  <input id="gathering-neighborhood" type="text" value={formNeighborhood} onChange={(e) => setFormNeighborhood(e.target.value)} placeholder="Neighbourhood (optional)" aria-label="Neighbourhood" className="g-field g-iset__field mt-2" />
                </div>

                <div>
                  <label htmlFor="gathering-description" className="g-label">What to expect</label>
                  <textarea id="gathering-description" rows={3} value={formDesc} onChange={(e) => setFormDesc(e.target.value)} placeholder="What should people bring or know?" className="g-field mt-2.5 resize-none !py-3 !rounded-[8px]" />
                </div>

                <p className="g-iset__privacy">
                  <ShieldCheck className="w-4 h-4" aria-hidden="true" />
                  <span>Only people who RSVP join the group room, and messages in it are end-to-end encrypted.</span>
                </p>
              </div>

              <div className="g-sheet__foot">
                <button type="button" onClick={() => setIsHostModalOpen(false)} className="g-btn g-btn--quiet !min-h-[46px] !px-5">Cancel</button>
                <button type="submit" className="g-btn g-btn--amber flex-1 !min-h-[46px] font-semibold">{quick ? 'Post plan' : 'Publish gathering'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
