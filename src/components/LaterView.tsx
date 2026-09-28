import React, { useState } from 'react';
import { Gathering, UserProfile } from '../types';
import { 
  Calendar, 
  MapPin, 
  Users, 
  ShieldCheck, 
  Lock, 
  Plus, 
  Check, 
  Clock, 
  X, 
  ArrowRight
} from 'lucide-react';

interface LaterViewProps {
  gatherings: Gathering[];
  onToggleRsvp: (gatheringId: string) => void;
  onOpenGatheringChat: (gathering: Gathering) => void;
  onCreateGathering: (newGathering: Omit<Gathering, 'id' | 'rsvpCount' | 'isAttending'>) => void;
  currentUser: UserProfile;
  currentUserId: string | null;
  userLocation: { lat: number; lng: number } | null;
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

  return (
    <div className="gayze-premium-page space-y-5">
      {/* Header section with host button */}
      <div className="gayze-page-intro flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <div className="g-label">Later</div>
          <h1 className="text-[25px] sm:text-[30px] font-semibold tracking-[-0.03em] text-white mt-1.5">
            Planned gatherings
          </h1>
          <p className="text-[12.5px] text-zinc-500 sm:max-w-md leading-relaxed mt-1.5">
            Calm and planned. RSVP, and talk with the people who are going.
          </p>
        </div>

        <button
          onClick={() => setIsHostModalOpen(true)}
          className="g-btn g-btn--amber !min-h-[44px] self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          <span>Host gathering</span>
        </button>
      </div>

      {/* Filter bars */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
        {/* Time filters */}
        <div className="gayze-premium-control flex items-center gap-1 p-1 rounded-[14px] border overflow-x-auto no-scrollbar">
          {[
            { id: 'all', label: 'All Dates' },
            { id: 'tonight', label: 'Tonight' },
            { id: 'tomorrow', label: 'Tomorrow' },
            { id: 'weekend', label: 'This Weekend' },
          ].map((item) => (
            <button
              key={item.id}
              onClick={() => setTimeFilter(item.id as any)}
              className={`h-8 px-3 text-[12.5px] rounded-[10px] transition-colors whitespace-nowrap cursor-pointer ${
                timeFilter === item.id
                  ? 'bg-white/[0.06] text-white font-medium shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]'
                  : 'text-zinc-400 font-normal hover:text-white'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {/* Category pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
          {[
            { id: 'all', label: 'All Circles' },
            { id: 'social', label: 'Social' },
            { id: 'games', label: 'Board Games' },
            { id: 'active', label: 'Sports' },
            { id: 'arts', label: 'Arts & Film' },
            { id: 'discussions', label: 'Talks' },
          ].map((cat) => (
            <button
              key={cat.id}
              onClick={() => setCategoryFilter(cat.id)}
              className={`h-8 px-3 text-xs font-medium rounded-lg whitespace-nowrap transition-colors cursor-pointer ${
                categoryFilter === cat.id
                  ? 'bg-[#1c1f2b] text-white border border-white/10 font-semibold'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04]'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>
      </div>

      {filteredGatherings.length === 0 && (
        <div className="gayze-premium-panel rounded-2xl p-6 text-center space-y-1.5">
          <p className="text-sm font-semibold text-zinc-200">
            {gatherings.length === 0 ? 'No gatherings yet' : 'Nothing matches these filters'}
          </p>
          <p className="text-xs text-zinc-400">
            {gatherings.length === 0
              ? 'Gatherings posted by the community will appear here. Host one to get things started.'
              : 'Try a different date range or circle.'}
          </p>
        </div>
      )}

      {/* Gatherings List */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
        {filteredGatherings.map((gathering) => {
          const spotsLeft = Math.max(0, gathering.capacity - gathering.rsvpCount);
          const percentFull = Math.min(100, Math.round((gathering.rsvpCount / gathering.capacity) * 100));

          return (
            <div
              key={gathering.id}
              className="gayze-premium-panel hover:border-white/15 rounded-[18px] p-4 sm:p-5 transition-colors flex flex-col justify-between"
            >
              <div>
                {/* Header: when + how many are going */}
                <div className="flex items-center justify-between gap-2">
                  <span className="g-chip g-chip--quiet">
                    <Calendar className="w-3.5 h-3.5" />
                    <span>{gathering.dateStr}</span>
                  </span>

                  <div className="flex items-center gap-1.5 text-[11.5px] text-zinc-400">
                    <Users className="w-3.5 h-3.5 text-zinc-500" />
                    <span>{gathering.rsvpCount} of {gathering.capacity} going</span>
                  </div>
                </div>

                {/* Title */}
                <h3 className="text-[16px] font-semibold text-white mt-3 leading-snug tracking-[-0.012em]">
                  {gathering.title}
                </h3>

                {/* Host Info */}
                <div className="flex items-center gap-2 mt-1.5 text-xs text-zinc-400">
                  <div className="w-5 h-5 rounded-full bg-[#1c1f2b] border border-white/10 text-[10px] flex items-center justify-center text-[#C9A24D] font-medium">
                    {gathering.hostName.charAt(0)}
                  </div>
                  <span>Hosted by <strong className="text-zinc-200 font-semibold">{gathering.hostName}</strong></span>
                </div>

                {/* Description */}
                <p className="text-[12.5px] text-zinc-400 mt-2 leading-relaxed">
                  {gathering.description}
                </p>

                {/* Venue */}
                <div className="mt-3 pt-3 border-t border-white/[0.06] space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 text-[12.5px] text-zinc-200 min-w-0">
                      <MapPin className="w-3.5 h-3.5 text-[#C9A24D] shrink-0" />
                      <span className="truncate">{gathering.locationName}</span>
                      {gathering.isSafeHavenVenue && (
                        <span title="Safe Haven venue" className="inline-flex shrink-0">
                          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                        </span>
                      )}
                    </div>
                    <span className="text-[11.5px] text-zinc-500 shrink-0">{gathering.neighborhood}</span>
                  </div>
                  {gathering.address && (
                    <div className="text-[11.5px] text-zinc-500 pl-5 truncate">{gathering.address}</div>
                  )}
                </div>

                {/* Host pledge — a quiet line, not another box */}
                <div className="mt-3 flex items-start gap-2 text-[11.5px] text-zinc-500 leading-relaxed">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400/80 shrink-0 mt-0.5" />
                  <span>{gathering.safetyGuidelines}</span>
                </div>

                {/* Capacity */}
                <div className="mt-3.5 space-y-1.5">
                  <div className="w-full h-[3px] bg-white/[0.07] rounded-full overflow-hidden">
                    <div
                      className="h-full bg-[#C9A24D]/70 transition-all duration-500"
                      style={{ width: `${percentFull}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-zinc-500">
                    <span>{spotsLeft} spots left</span>
                    <span>{gathering.capacity} max</span>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="mt-4 pt-3 border-t border-white/[0.07] flex items-center justify-between gap-2.5">
                {/* RSVP Toggle Button */}
                <button
                  onClick={() => onToggleRsvp(gathering.id)}
                  disabled={busyGatheringId === gathering.id || (spotsLeft === 0 && !gathering.isAttending)}
                  className={`g-btn !min-h-[44px] ${
                    gathering.isAttending ? 'g-btn--selected' : 'g-btn--quiet'
                  }`}
                >
                  {busyGatheringId === gathering.id ? (
                    <span>Saving…</span>
                  ) : gathering.isAttending ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Attending</span>
                    </>
                  ) : spotsLeft === 0 ? (
                    <span>Full</span>
                  ) : (
                    <span>RSVP</span>
                  )}
                </button>

                {/* Open Group Chat — only offered when a real conversation exists. */}
                {groupChatAvailable ? (
                  <button
                    onClick={() => onOpenGatheringChat(gathering)}
                    className="g-btn g-btn--amber !min-h-[44px]"
                  >
                    <Lock className="w-3.5 h-3.5" />
                    <span>Group room</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                ) : (
                  <span
                    title="Group conversations are not available for gatherings yet"
                    className="h-11 min-h-[44px] flex items-center gap-1.5 px-3 text-[11px] font-medium text-zinc-500 bg-white/[0.03] border border-white/[0.07] rounded-xl"
                  >
                    <Lock className="w-3.5 h-3.5" />
                    <span>Group chat not available yet</span>
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Host Gathering Modal */}
      {isHostModalOpen && (
        <div className="g-overlay flex items-center justify-center p-3 sm:p-4" onClick={() => setIsHostModalOpen(false)}>
          <div
            className="g-panel relative w-full max-w-lg p-5 sm:p-6 !rounded-[20px] space-y-4 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-[10px] bg-[#C9A24D]/12 border border-[#C9A24D]/25 flex items-center justify-center text-[#C9A24D]">
                  <Calendar className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Host a Community Gathering</h3>
                  <span className="text-[11px] text-zinc-400">
                    Creates an encrypted group for confirmed attendees
                  </span>
                </div>
              </div>
              <button
                onClick={() => setIsHostModalOpen(false)}
                className="w-8 h-8 rounded-lg text-zinc-400 hover:text-white flex items-center justify-center hover:bg-white/[0.06] transition-colors cursor-pointer"
                aria-label="Close modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleHostSubmit} className="space-y-4">
              {formError && (
                <p className="text-[11px] text-amber-300 bg-amber-500/10 border border-amber-500/25 rounded-xl px-3 py-2">
                  {formError}
                </p>
              )}
              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1">
                  Gathering Title
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Queer Sci-Fi Book Club & Wine"
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  className="w-full bg-[#171922] border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-[#C9A24D] focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-zinc-300 mb-1">Category</label>
                  <select
                    value={formCategory}
                    onChange={(e) => setFormCategory(e.target.value as any)}
                    className="w-full bg-[#171922] border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:border-[#C9A24D] focus:outline-none cursor-pointer"
                  >
                    <option value="social">Social & Drinks</option>
                    <option value="games">Board Games</option>
                    <option value="active">Outdoor & Sports</option>
                    <option value="arts">Arts & Culture</option>
                    <option value="discussions">Salons & Talks</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-zinc-300 mb-1">Capacity</label>
                  <input
                    type="number"
                    min={3}
                    max={100}
                    value={formCapacity}
                    onChange={(e) => setFormCapacity(Number(e.target.value))}
                    className="w-full bg-[#171922] border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:border-[#C9A24D] focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1">Date & Time</label>
                <input
                  type="datetime-local"
                  required
                  value={formDate}
                  onChange={(e) => setFormDate(e.target.value)}
                  className="w-full bg-[#171922] border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder-zinc-500 focus:border-[#C9A24D] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1">Venue Name</label>
                <input
                  type="text"
                  required
                  value={formLocation}
                  onChange={(e) => setFormLocation(e.target.value)}
                  placeholder="e.g. Queer Britain Lounge"
                  className="w-full bg-[#171922] border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder-zinc-500 focus:border-[#C9A24D] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1">Address & Neighborhood</label>
                <input
                  type="text"
                  required
                  value={formAddress}
                  onChange={(e) => setFormAddress(e.target.value)}
                  placeholder="Street address"
                  className="w-full bg-[#171922] border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder-zinc-500 focus:border-[#C9A24D] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1">Description & Guidelines</label>
                <textarea
                  rows={2}
                  value={formDesc}
                  onChange={(e) => setFormDesc(e.target.value)}
                  placeholder="What should attendees bring or expect?"
                  className="w-full bg-[#171922] border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder-zinc-500 focus:border-[#C9A24D] focus:outline-none resize-none"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-3 border-t border-white/[0.08]">
                <button
                  type="button"
                  onClick={() => setIsHostModalOpen(false)}
                  className="min-h-[42px] px-4 py-2 text-xs font-medium text-zinc-400 hover:text-white cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="min-h-[42px] px-4 py-2 text-xs font-semibold text-black bg-[#C9A24D] hover:bg-[#b58f3b] rounded-xl transition-colors cursor-pointer shadow-sm"
                >
                  Publish Gathering
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
