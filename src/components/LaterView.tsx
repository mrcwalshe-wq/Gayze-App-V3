import React, { useState } from 'react';
import { Gathering } from '../types';
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
}

export const LaterView: React.FC<LaterViewProps> = ({
  gatherings,
  onToggleRsvp,
  onOpenGatheringChat,
  onCreateGathering,
}) => {
  const [timeFilter, setTimeFilter] = useState<'all' | 'tonight' | 'tomorrow' | 'weekend'>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [isHostModalOpen, setIsHostModalOpen] = useState<boolean>(false);

  // Form states
  const [formTitle, setFormTitle] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formCategory, setFormCategory] = useState<Gathering['category']>('social');
  const [formDate, setFormDate] = useState('Saturday, 19:00');
  const [formLocation, setFormLocation] = useState('Queer Britain Lounge');
  const [formAddress, setFormAddress] = useState('2 Granary Square, King’s Cross');
  const [formNeighborhood, setFormNeighborhood] = useState('King’s Cross');
  const [formCapacity, setFormCapacity] = useState(16);
  const [formTags, setFormTags] = useState('Social, Casual, Safe Space');

  const filteredGatherings = gatherings.filter((g) => {
    if (categoryFilter !== 'all' && g.category !== categoryFilter) return false;
    if (timeFilter === 'tonight' && !g.dateStr.toLowerCase().includes('tonight')) return false;
    if (timeFilter === 'tomorrow' && !g.dateStr.toLowerCase().includes('tomorrow')) return false;
    if (timeFilter === 'weekend' && !g.dateStr.toLowerCase().includes('sunday') && !g.dateStr.toLowerCase().includes('saturday') && !g.dateStr.toLowerCase().includes('friday')) return false;
    return true;
  });

  const handleHostSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formTitle.trim()) return;

    onCreateGathering({
      hostId: 'peer_me',
      hostName: 'Julian K.',
      hostShortKey: 'pk_7e3f...6e80',
      hostAvatar: 'julian',
      title: formTitle,
      description: formDesc || 'A community gathering for connection and shared interests.',
      category: formCategory,
      dateStr: formDate,
      timestamp: Date.now() + 24 * 3600 * 1000,
      locationName: formLocation,
      address: formAddress,
      neighborhood: formNeighborhood,
      isSafeHavenVenue: formLocation.includes('Haven') || formLocation.includes('Britain') || formLocation.includes('Word'),
      lat: 51.5132,
      lng: -0.1300,
      capacity: formCapacity,
      tags: formTags.split(',').map((t) => t.trim()).filter(Boolean),
      safetyGuidelines: 'Safe Haven principles. Consent-first communication and respectful space conduct.',
    });

    setIsHostModalOpen(false);
    setFormTitle('');
    setFormDesc('');
  };

  return (
    <div className="space-y-4">
      {/* Header section with host button */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-white/[0.08]">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#C9A24D]" />
            <h1 className="text-lg sm:text-xl font-bold tracking-tight text-white font-sans">
              Planned Circles & Meetups
            </h1>
          </div>
          <p className="text-xs text-zinc-400 mt-0.5">
            Curated group sessions and social circles with encrypted attendee swarms
          </p>
        </div>

        <button
          onClick={() => setIsHostModalOpen(true)}
          className="h-9 min-h-[38px] flex items-center gap-1.5 px-3.5 text-xs font-semibold text-black bg-[#C9A24D] hover:bg-[#b58f3b] rounded-xl transition-colors shadow-sm self-start sm:self-auto cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>Host Gathering</span>
        </button>
      </div>

      {/* Filter bars */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
        {/* Time filters */}
        <div className="flex items-center gap-1 p-1 bg-[#11131a] rounded-xl border border-white/[0.07] overflow-x-auto no-scrollbar">
          {[
            { id: 'all', label: 'All Dates' },
            { id: 'tonight', label: 'Tonight' },
            { id: 'tomorrow', label: 'Tomorrow' },
            { id: 'weekend', label: 'This Weekend' },
          ].map((item) => (
            <button
              key={item.id}
              onClick={() => setTimeFilter(item.id as any)}
              className={`h-8 px-3 text-xs font-medium rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
                timeFilter === item.id
                  ? 'bg-[#1c1f2b] text-white font-semibold border border-white/10 shadow-sm'
                  : 'text-zinc-400 hover:text-white'
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

      {/* Gatherings List */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
        {filteredGatherings.map((gathering) => {
          const spotsLeft = Math.max(0, gathering.capacity - gathering.rsvpCount);
          const percentFull = Math.min(100, Math.round((gathering.rsvpCount / gathering.capacity) * 100));

          return (
            <div
              key={gathering.id}
              className="bg-[#11131a] hover:bg-[#141620] border border-white/[0.08] hover:border-[#C9A24D]/40 rounded-2xl p-4 sm:p-5 transition-all flex flex-col justify-between shadow-sm"
            >
              <div>
                {/* Header: Date badge + Attendance count */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-xs text-[#C9A24D] bg-[#C9A24D]/10 px-2.5 py-1 rounded-lg border border-[#C9A24D]/30">
                    <Calendar className="w-3.5 h-3.5" />
                    <span>{gathering.dateStr}</span>
                  </div>

                  <div className="flex items-center gap-1.5 text-[11px] text-zinc-400 font-mono">
                    <Users className="w-3.5 h-3.5 text-zinc-500" />
                    <span>{gathering.rsvpCount} / {gathering.capacity} attending</span>
                  </div>
                </div>

                {/* Title */}
                <h3 className="text-base font-bold text-white mt-3 leading-snug">
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
                <p className="text-xs text-zinc-300 mt-2 leading-relaxed">
                  {gathering.description}
                </p>

                {/* Venue & Location */}
                <div className="mt-3 pt-2.5 border-t border-white/[0.07] space-y-1 text-xs">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-zinc-200 font-medium">
                      <MapPin className="w-3.5 h-3.5 text-[#C9A24D] shrink-0" />
                      <span>{gathering.locationName}</span>
                      {gathering.isSafeHavenVenue && (
                        <span title="Safe Haven Verified" className="inline-flex shrink-0">
                          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                        </span>
                      )}
                    </div>
                    <span className="text-zinc-400">{gathering.neighborhood}</span>
                  </div>

                  <div className="text-[11px] text-zinc-400 pl-5">
                    {gathering.address}
                  </div>
                </div>

                {/* Safety Guidelines / Host Pledge */}
                <div className="mt-2.5 p-2 rounded-xl bg-[#141620] border border-white/[0.07] text-[11px] text-zinc-400 flex items-start gap-2">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                  <span>{gathering.safetyGuidelines}</span>
                </div>

                {/* Progress bar */}
                <div className="mt-3 space-y-1">
                  <div className="w-full h-1.5 bg-[#1c1f2b] rounded-full overflow-hidden">
                    <div
                      className="h-full bg-[#C9A24D] transition-all"
                      style={{ width: `${percentFull}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-zinc-500 font-mono">
                    <span>{spotsLeft} spots available</span>
                    <span>{percentFull}% filled</span>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="mt-4 pt-3 border-t border-white/[0.07] flex items-center justify-between gap-2.5">
                {/* RSVP Toggle Button */}
                <button
                  onClick={() => onToggleRsvp(gathering.id)}
                  className={`h-9 min-h-[38px] flex items-center gap-1.5 px-3.5 text-xs font-semibold rounded-xl transition-colors cursor-pointer ${
                    gathering.isAttending
                      ? 'bg-emerald-950/40 text-emerald-300 border border-emerald-500/50'
                      : 'bg-[#1c1f2b] hover:bg-[#252838] text-zinc-200 border border-white/10'
                  }`}
                >
                  {gathering.isAttending ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Attending</span>
                    </>
                  ) : (
                    <span>RSVP</span>
                  )}
                </button>

                {/* Open Group Swarm Chat */}
                <button
                  onClick={() => onOpenGatheringChat(gathering)}
                  className="h-9 min-h-[38px] flex items-center gap-1.5 px-3.5 text-xs font-semibold text-black bg-[#C9A24D] hover:bg-[#b58f3b] rounded-xl transition-colors cursor-pointer shadow-sm"
                >
                  <Lock className="w-3.5 h-3.5" />
                  <span>Swarm Room</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Host Gathering Modal */}
      {isHostModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/85 backdrop-blur-sm animate-in fade-in">
          <div className="relative w-full max-w-lg bg-[#11131a] border border-white/10 rounded-2xl p-5 sm:p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-[#C9A24D]/15 border border-[#C9A24D]/30 flex items-center justify-center text-[#C9A24D]">
                  <Calendar className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Host a Community Gathering</h3>
                  <span className="text-[11px] text-zinc-400">
                    Creates an encrypted group swarm for confirmed attendees
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
                  type="text"
                  required
                  value={formDate}
                  onChange={(e) => setFormDate(e.target.value)}
                  placeholder="e.g. Saturday, 19:30"
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
