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
  Palette,
  MessagesSquare,
  type LucideIcon,
} from 'lucide-react';
import { hapticLight } from '../services/hapticService';

const CATEGORY_ART: Record<string, { label: string; icon: LucideIcon; rgb: string; rgb2: string }> = {
  social: { label: 'Social & drinks', icon: Wine, rgb: '214, 170, 80', rgb2: '184, 92, 222' },
  games: { label: 'Board games', icon: Dices, rgb: '120, 110, 255', rgb2: '70, 170, 230' },
  active: { label: 'Outdoor & sports', icon: Dumbbell, rgb: '52, 211, 153', rgb2: '70, 150, 230' },
  arts: { label: 'Arts & culture', icon: Palette, rgb: '240, 120, 160', rgb2: '184, 92, 222' },
  discussions: { label: 'Salons & talks', icon: MessagesSquare, rgb: '170, 130, 255', rgb2: '214, 170, 80' },
};
const artFor = (category: string) => CATEGORY_ART[category] ?? CATEGORY_ART.social;

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
  onOpenGatheringChat: (gathering: Gathering) => void;
  onCreateGathering: (newGathering: Omit<Gathering, 'id' | 'rsvpCount' | 'isAttending'>) => void;
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
  const [formCapacity, setFormCapacity] = useState(16);
  const [formTags, setFormTags] = useState('');

  // Filters run off the real scheduled timestamp, so they also work for
  // backend gatherings (whose dateStr is a formatted date, not a label).
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfTomorrow = startOfToday + 24 * 60 * 60 * 1000;
  const startOfDayAfterTomorrow = startOfTomorrow + 24 * 60 * 60 * 1000;

  const filteredGatherings = gatherings
    .filter((g) => g.timestamp > Date.now())
    .filter((g) => {
      if (categoryFilter !== 'all' && g.category !== categoryFilter) return false;
      if (timeFilter === 'tonight' && !(g.timestamp >= startOfToday && g.timestamp < startOfTomorrow)) return false;
      if (timeFilter === 'tomorrow' && !(g.timestamp >= startOfTomorrow && g.timestamp < startOfDayAfterTomorrow)) return false;
      if (timeFilter === 'weekend') {
        const weekday = new Date(g.timestamp).getDay();
        if (weekday !== 5 && weekday !== 6 && weekday !== 0) return false;
      }
      return true;
    })
    .sort((a, b) => a.timestamp - b.timestamp);

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
    if (!formLocation.trim()) {
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
      description: formDesc || 'A community gathering for connection and shared interests.',
      category: formCategory,
      dateStr: new Date(timestamp).toLocaleString([], { weekday: 'long', hour: '2-digit', minute: '2-digit' }),
      timestamp,
      locationName: formLocation,
      address: formAddress,
      neighborhood: formNeighborhood,
      isSafeHavenVenue: false,
      lat: userLocation?.lat ?? null,
      lng: userLocation?.lng ?? null,
      capacity: formCapacity,
      tags: formTags.split(',').map((t) => t.trim()).filter(Boolean),
      safetyGuidelines: 'Safe Haven principles. Consent-first communication and respectful space conduct.',
    });

    setIsHostModalOpen(false);
    setFormTitle('');
    setFormDesc('');
    setFormDate('');
    setFormLocation('');
    setFormAddress('');
    setFormNeighborhood('');
    setFormError(null);
  };

  const nextUp = filteredGatherings[0];

  return (
    <div className="gayze-premium-page space-y-5">
      <div className="g-later__hero">
        <div className="min-w-0">
          <div className="g-label">Later</div>
          <h1 className="g-later__title">Plan something real</h1>
          <p className="g-later__sub">Gatherings with people nearby. RSVP, then talk with everyone who is going.</p>
        </div>
        <button onClick={() => setIsHostModalOpen(true)} className="g-btn g-btn--amber g-later__host">
          <Plus className="w-4 h-4" />
          <span>Host</span>
        </button>
      </div>

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

      {filteredGatherings.length === 0 && (
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

      <div className="g-later__grid">
        {filteredGatherings.map((gathering) => {
          const isHost = gathering.hostName === 'You';
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
              className={`g-ev ${isNext ? 'is-next' : ''} ${gathering.isAttending ? 'is-going' : ''}`}
              style={{ ['--ev' as string]: art.rgb, ['--ev2' as string]: art.rgb2 }}
            >
              <div className="g-ev__poster">
                <ArtIcon className="g-ev__art" aria-hidden="true" />
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
                <span className="g-ev__cat">{art.label}</span>
              </div>

              <div className="g-ev__body">
                <div className="g-ev__time"><Clock className="w-3.5 h-3.5" />{gathering.dateStr}</div>
                <h3 className="g-ev__name">{gathering.title}</h3>
                <div className="g-ev__host">
                  <span className="g-ev__host-av">{gathering.hostName.charAt(0)}</span>
                  <span>Hosted by <strong>{gathering.hostName}</strong></span>
                </div>
                <p className="g-ev__desc">{gathering.description}</p>

                <div className="g-ev__venue">
                  <MapPin className="w-4 h-4" />
                  <div className="min-w-0">
                    <strong>
                      {gathering.locationName}
                      {gathering.isSafeHavenVenue && <ShieldCheck className="inline w-3.5 h-3.5 ml-1 text-emerald-400" aria-label="Safe Haven venue" />}
                    </strong>
                    <span>{[gathering.address, gathering.neighborhood].filter(Boolean).join(' · ')}</span>
                  </div>
                </div>

                <div className="g-ev__crowd">
                  <div className="g-ev__pile" aria-hidden="true">
                    {Array.from({ length: pile }, (_, i) => <i key={i} style={{ ['--n' as string]: i }} />)}
                    {gathering.rsvpCount > pile && <em>+{gathering.rsvpCount - pile}</em>}
                  </div>
                  <span className="g-ev__count"><Users className="w-3.5 h-3.5" />{gathering.rsvpCount} going{spotsLeft > 0 ? ` · ${spotsLeft} left` : ' · Full'}</span>
                </div>
                <div className="g-ev__meter" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percentFull} aria-label="Spots taken">
                  <span style={{ width: `${percentFull}%` }} />
                </div>

                <p className="g-ev__pledge"><ShieldCheck className="w-3.5 h-3.5" /><span>{gathering.safetyGuidelines}</span></p>
              </div>

              <div className={`g-ev__actions ${groupChatAvailable ? '' : 'is-single'}`}>
                <button
                  type="button"
                  onClick={() => { hapticLight(); onToggleRsvp(gathering.id); }}
                  disabled={isHost || busyGatheringId === gathering.id || (spotsLeft === 0 && !gathering.isAttending)}
                  className={`g-ev__rsvp ${gathering.isAttending ? 'is-going' : ''}`}
                  aria-label={isHost ? `You're hosting ${gathering.title}.` : gathering.isAttending ? `You're going to ${gathering.title}. Tap to leave.` : undefined}
                >
                  {isHost ? (
                    <><Check className="w-4 h-4" /><span>You're hosting</span><small>{gathering.rsvpCount > 1 ? `${gathering.rsvpCount - 1} joining` : 'No guests yet'}</small></>
                  ) : busyGatheringId === gathering.id ? (
                    <span>Saving…</span>
                  ) : gathering.isAttending ? (
                    <><Check className="w-4 h-4" /><span>Going</span><small>Tap to leave</small></>
                  ) : spotsLeft === 0 ? (
                    <span>Full</span>
                  ) : (
                    <span>I'm in</span>
                  )}
                </button>

                {groupChatAvailable && (
                  <button type="button" onClick={() => onOpenGatheringChat(gathering)} className="g-ev__room">
                    <Lock className="w-4 h-4" />
                    <span>Group room</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                )}
              </div>
              {!groupChatAvailable && gathering.isAttending && (
                <p className="g-ev__soon"><Lock className="w-3 h-3" aria-hidden="true" />A private group room for everyone going is coming soon.</p>
              )}
            </article>
          );
        })}
      </div>

      {isHostModalOpen && (
        <div className="g-overlay flex items-end sm:items-center justify-center sm:p-4" onClick={() => setIsHostModalOpen(false)} role="dialog" aria-modal="true" aria-label="Host a gathering">
          <div className="g-sheet g-sheet--above-nav g-iset" onClick={(e) => e.stopPropagation()}>
            <div className="g-sheet__grip" />
            <div className="g-sheet__head">
              <div className="min-w-0">
                <h2 className="text-[16px] font-semibold tracking-[-0.015em] text-white leading-tight">Host a gathering</h2>
                <p className="text-[11px] text-zinc-500 leading-tight mt-0.5">Creates an encrypted group room for the people who RSVP.</p>
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

                <div>
                  <label htmlFor="gathering-title" className="g-label">What is it?</label>
                  <input
                    id="gathering-title"
                    type="text"
                    required
                    maxLength={80}
                    placeholder="e.g. Queer sci-fi book club and wine"
                    value={formTitle}
                    onChange={(e) => setFormTitle(e.target.value)}
                    className="g-field g-iset__field mt-2.5"
                  />
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
                  <label htmlFor="gathering-venue" className="g-label">Where</label>
                  <input id="gathering-venue" type="text" required value={formLocation} onChange={(e) => setFormLocation(e.target.value)} placeholder="Venue name" className="g-field g-iset__field mt-2.5" />
                  <input id="gathering-address" type="text" required value={formAddress} onChange={(e) => setFormAddress(e.target.value)} placeholder="Street address" aria-label="Street address" className="g-field g-iset__field mt-2" />
                  <input id="gathering-neighborhood" type="text" value={formNeighborhood} onChange={(e) => setFormNeighborhood(e.target.value)} placeholder="Neighbourhood (optional)" aria-label="Neighbourhood" className="g-field g-iset__field mt-2" />
                </div>

                <div>
                  <label htmlFor="gathering-description" className="g-label">What to expect</label>
                  <textarea id="gathering-description" rows={3} value={formDesc} onChange={(e) => setFormDesc(e.target.value)} placeholder="What should people bring or know?" className="g-field mt-2.5 resize-none !py-3 !rounded-[14px]" />
                </div>

                <p className="g-iset__privacy">
                  <ShieldCheck className="w-4 h-4" aria-hidden="true" />
                  <span>Only people who RSVP join the group room, and messages in it are end-to-end encrypted.</span>
                </p>
              </div>

              <div className="g-sheet__foot">
                <button type="button" onClick={() => setIsHostModalOpen(false)} className="g-btn g-btn--quiet !min-h-[46px] !px-5">Cancel</button>
                <button type="submit" className="g-btn g-btn--amber flex-1 !min-h-[46px] font-semibold">Publish gathering</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
