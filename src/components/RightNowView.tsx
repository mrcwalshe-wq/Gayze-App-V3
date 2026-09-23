import React, { useState } from 'react';
import { Pulse, SafeHaven, LocationPrivacy } from '../types';
import { PrivacyGeographicMap } from './PrivacyGeographicMap';
import { RadarMap } from './RadarMap';
import { 
  Radio, 
  Map, 
  List, 
  Plus, 
  ShieldCheck, 
  Lock, 
  Clock, 
  MapPin, 
  Coffee, 
  Wine, 
  Footprints, 
  Dumbbell, 
  Palette, 
  Sparkles, 
  ArrowRight,
  X
} from 'lucide-react';

interface RightNowViewProps {
  pulses: Pulse[];
  safeHavens: SafeHaven[];
  userNeighborhood: string;
  privacySetting?: LocationPrivacy;
  onOpenDirectChat: (pulse: Pulse) => void;
  onSelectHaven: (haven: SafeHaven) => void;
  onCreatePulse: (newPulse: Omit<Pulse, 'id' | 'createdAt' | 'expiresAt'>) => void;
}

export const RightNowView: React.FC<RightNowViewProps> = ({
  pulses,
  safeHavens,
  userNeighborhood,
  privacySetting = 'fuzzy_500m',
  onOpenDirectChat,
  onSelectHaven,
  onCreatePulse,
}) => {
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [viewMode, setViewMode] = useState<'map' | 'radar' | 'feed'>('map');
  const [isCreateOpen, setIsCreateOpen] = useState<boolean>(false);
  const [selectedPulseForDetail, setSelectedPulseForDetail] = useState<Pulse | null>(null);

  // Form state
  const [formTitle, setFormTitle] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formCategory, setFormCategory] = useState<Pulse['activityCategory']>('coffee');
  const [formVenue, setFormVenue] = useState('Timberyard Cafe (Safe Haven)');
  const [formDuration, setFormDuration] = useState(2);
  const [formTags, setFormTags] = useState('Casual, Conversation');

  const filteredPulses = pulses.filter((p) => {
    if (selectedCategory === 'all') return true;
    return p.activityCategory === selectedCategory;
  });

  const handleBroadcastSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formTitle.trim()) return;

    const latJitter = 51.5132 + (Math.random() - 0.5) * 0.005;
    const lngJitter = -0.1300 + (Math.random() - 0.5) * 0.005;

    onCreatePulse({
      peerId: 'peer_me',
      peerName: 'Julian K.',
      peerShortKey: 'pk_7e3f...6e80',
      peerAvatar: 'julian',
      title: formTitle,
      description: formDesc || 'Spontaneous meetup in a public safe space.',
      activityCategory: formCategory,
      venueName: formVenue,
      neighborhood: userNeighborhood,
      approxDistanceKm: 0.1,
      jitterMeters: 250,
      lat: latJitter,
      lng: lngJitter,
      durationHours: formDuration,
      tags: formTags.split(',').map((t) => t.trim()).filter(Boolean),
      safeHavenVenue: formVenue.includes('Haven'),
    });

    setIsCreateOpen(false);
    setFormTitle('');
    setFormDesc('');
  };

  const handleBroadcastHere = (venueName: string) => {
    setFormVenue(venueName);
    setFormTitle(`Coffee at ${venueName.split('(')[0].trim()}`);
    setIsCreateOpen(true);
  };

  const getActivityIcon = (category: string) => {
    switch (category) {
      case 'coffee':
        return <Coffee className="w-4 h-4 text-amber-400" />;
      case 'drinks':
        return <Wine className="w-4 h-4 text-rose-400" />;
      case 'walk':
        return <Footprints className="w-4 h-4 text-emerald-400" />;
      case 'active':
        return <Dumbbell className="w-4 h-4 text-cyan-400" />;
      case 'culture':
        return <Palette className="w-4 h-4 text-purple-400" />;
      default:
        return <Sparkles className="w-4 h-4 text-amber-300" />;
    }
  };

  return (
    <div className="space-y-4">
      {/* Header section with view switcher and broadcast button */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-zinc-800/80">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            <h1 className="text-lg sm:text-xl font-bold tracking-tight text-white font-sans">
              Right Now in {userNeighborhood}
            </h1>
          </div>
          <p className="text-xs text-zinc-400 mt-0.5">
            Spontaneous meetups & safe spaces nearby · Privacy cloaked
          </p>
        </div>

        <div className="flex items-center justify-between sm:justify-end gap-2 shrink-0">
          {/* View mode toggle: Map, Radar, List */}
          <div className="flex items-center p-1 bg-zinc-900 rounded-xl border border-zinc-800">
            <button
              onClick={() => setViewMode('map')}
              className={`min-h-[34px] flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-lg transition-colors cursor-pointer ${
                viewMode === 'map'
                  ? 'bg-zinc-800 text-white shadow-sm font-semibold'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              <Map className="w-3.5 h-3.5" />
              <span>Map</span>
            </button>
            <button
              onClick={() => setViewMode('feed')}
              className={`min-h-[34px] flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-lg transition-colors cursor-pointer ${
                viewMode === 'feed'
                  ? 'bg-zinc-800 text-white shadow-sm font-semibold'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              <List className="w-3.5 h-3.5" />
              <span>List</span>
            </button>
            <button
              onClick={() => setViewMode('radar')}
              className={`min-h-[34px] flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg transition-colors cursor-pointer ${
                viewMode === 'radar'
                  ? 'bg-zinc-800 text-white shadow-sm font-semibold'
                  : 'text-zinc-400 hover:text-white'
              }`}
              title="Radar View"
            >
              <Radio className="w-3.5 h-3.5" />
              <span className="hidden xs:inline">Radar</span>
            </button>
          </div>

          {/* Broadcast Right Now Pulse */}
          <button
            onClick={() => setIsCreateOpen(true)}
            className="min-h-[38px] flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-black bg-amber-400 hover:bg-amber-300 rounded-xl transition-colors shadow-sm cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Broadcast</span>
          </button>
        </div>
      </div>

      {/* Main Geographic Display View */}
      {viewMode === 'map' && (
        <div className="space-y-3">
          <PrivacyGeographicMap
            pulses={pulses}
            safeHavens={safeHavens}
            userNeighborhood={userNeighborhood}
            privacySetting={privacySetting}
            onOpenDirectChat={onOpenDirectChat}
            onSelectHaven={onSelectHaven}
            onBroadcastHere={handleBroadcastHere}
          />

          {/* Quick Context Summary Below Map */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-3.5 py-2.5 bg-zinc-900/60 border border-zinc-800/80 rounded-xl text-xs text-zinc-400">
            <div className="flex items-center gap-2">
              <span className="text-zinc-300 font-medium">{pulses.length} active meetups</span>
              <span>·</span>
              <span>{safeHavens.length} verified safe havens</span>
            </div>

            <div className="text-[11px] text-zinc-500 flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              <span>Locations are randomized by ~300m for member privacy</span>
            </div>
          </div>
        </div>
      )}

      {/* Alternative View: Tactical Radar */}
      {viewMode === 'radar' && (
        <div className="space-y-4">
          <RadarMap
            pulses={filteredPulses}
            safeHavens={safeHavens}
            userNeighborhood={userNeighborhood}
            onSelectPulse={(p) => setSelectedPulseForDetail(p)}
            onSelectHaven={(h) => onSelectHaven(h)}
          />

          {selectedPulseForDetail && (
            <div className="p-4 bg-zinc-900 border border-zinc-800 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-lg bg-zinc-800 border border-zinc-700 flex items-center justify-center shrink-0">
                  {getActivityIcon(selectedPulseForDetail.activityCategory)}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-white">{selectedPulseForDetail.peerName}</span>
                  </div>
                  <h4 className="text-xs font-semibold text-zinc-200 mt-0.5">{selectedPulseForDetail.title}</h4>
                  <div className="text-[11px] text-zinc-400 mt-1 flex items-center gap-1.5">
                    <MapPin className="w-3 h-3 text-amber-400" />
                    <span>{selectedPulseForDetail.venueName}</span>
                    <span>·</span>
                    <span>~{selectedPulseForDetail.approxDistanceKm} km</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => setSelectedPulseForDetail(null)}
                  className="px-3 py-1.5 text-xs text-zinc-400 hover:text-white"
                >
                  Dismiss
                </button>
                <button
                  onClick={() => onOpenDirectChat(selectedPulseForDetail)}
                  className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-black bg-amber-400 hover:bg-amber-300 rounded-xl transition-colors cursor-pointer"
                >
                  <Lock className="w-3.5 h-3.5" />
                  <span>Connect & Chat</span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Alternative View: Filtered Card Feed List */}
      {viewMode === 'feed' && (
        <div className="space-y-3">
          {/* Category Filter Bar */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
            {[
              { id: 'all', label: 'All Activities' },
              { id: 'coffee', label: 'Coffee' },
              { id: 'drinks', label: 'Drinks' },
              { id: 'walk', label: 'Walks' },
              { id: 'active', label: 'Active & Sports' },
              { id: 'culture', label: 'Art & Film' },
              { id: 'chill', label: 'Co-work' },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setSelectedCategory(tab.id)}
                className={`min-h-[34px] px-3 py-1 text-xs font-medium rounded-lg whitespace-nowrap transition-colors cursor-pointer ${
                  selectedCategory === tab.id
                    ? 'bg-zinc-800 text-white border border-zinc-700 font-semibold'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
            {filteredPulses.map((pulse) => {
              const remainingMinutes = Math.max(
                0,
                Math.round((pulse.expiresAt - Date.now()) / (1000 * 60))
              );

              return (
                <div
                  key={pulse.id}
                  className="bg-zinc-900/60 hover:bg-zinc-900 border border-zinc-800 hover:border-zinc-700 rounded-2xl p-4 transition-all flex flex-col justify-between"
                >
                  <div>
                    {/* Header: Peer info, short key & countdown */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-lg bg-zinc-800 border border-zinc-700 flex items-center justify-center text-xs font-semibold text-amber-400">
                          {pulse.peerName.charAt(0)}
                        </div>
                        <div>
                          <span className="text-xs font-bold text-white">{pulse.peerName}</span>
                          <div className="text-[11px] text-zinc-400">
                            {pulse.neighborhood} · ~{pulse.approxDistanceKm} km
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1 text-[10px] text-zinc-300 bg-zinc-800 px-2 py-0.5 rounded border border-zinc-700 shrink-0 font-mono">
                        <Clock className="w-3 h-3 text-amber-400" />
                        <span>{remainingMinutes}m left</span>
                      </div>
                    </div>

                    {/* Pulse Title & Description */}
                    <div className="mt-3">
                      <h3 className="text-sm font-semibold text-white tracking-tight flex items-center gap-2">
                        {getActivityIcon(pulse.activityCategory)}
                        <span>{pulse.title}</span>
                      </h3>
                      <p className="text-xs text-zinc-300 mt-1 leading-relaxed line-clamp-2">
                        {pulse.description}
                      </p>
                    </div>

                    {/* Public Venue Tag */}
                    <div className="mt-3 pt-2.5 border-t border-zinc-800/80 flex items-center justify-between text-xs">
                      <div className="flex items-center gap-1.5 text-zinc-300">
                        <MapPin className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                        <span className="truncate max-w-[200px]">{pulse.venueName}</span>
                        {pulse.safeHavenVenue && (
                          <span title="Safe Haven Verified" className="inline-flex shrink-0">
                            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                          </span>
                        )}
                      </div>
                      <span className="text-[11px] text-zinc-500 font-mono">
                        ~{pulse.jitterMeters}m area
                      </span>
                    </div>
                  </div>

                  {/* Bottom Action: Connect & Chat */}
                  <div className="mt-3 pt-2.5 border-t border-zinc-800/80 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1 text-[11px] text-zinc-400">
                      <Lock className="w-3 h-3 text-emerald-400" />
                      <span>Encrypted Direct Chat</span>
                    </div>

                    <button
                      onClick={() => onOpenDirectChat(pulse)}
                      className="min-h-[36px] flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-black bg-amber-400 hover:bg-amber-300 rounded-xl transition-colors cursor-pointer"
                    >
                      <span>Connect & Chat</span>
                      <ArrowRight className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Broadcast Pulse Modal */}
      {isCreateOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
          <div className="relative w-full max-w-lg bg-[#12131a] border border-zinc-800 rounded-2xl p-5 sm:p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-amber-400/10 border border-amber-400/30 flex items-center justify-center text-amber-400">
                  <Radio className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Broadcast Right Now Pulse</h3>
                  <span className="text-[11px] text-zinc-400">
                    Ephemeral · Automatically disappears · Privacy cloaked
                  </span>
                </div>
              </div>
              <button
                onClick={() => setIsCreateOpen(false)}
                className="w-8 h-8 rounded-lg text-zinc-400 hover:text-white flex items-center justify-center hover:bg-zinc-800 transition-colors"
                aria-label="Close modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3 rounded-xl bg-zinc-900 border border-zinc-800 text-xs text-zinc-300 leading-relaxed">
              <strong>Privacy Protection:</strong> Exact GPS coordinates are never stored. Your location is randomized by ~300m and automatically removed when your timer expires.
            </div>

            <form onSubmit={handleBroadcastSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1">
                  What are you looking to do right now?
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Grabbing espresso in Soho courtyard, up for a chat"
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  className="w-full bg-[#181a24] border border-zinc-700/80 rounded-xl px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-amber-400 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-zinc-300 mb-1">Activity Category</label>
                  <select
                    value={formCategory}
                    onChange={(e) => setFormCategory(e.target.value as any)}
                    className="w-full bg-[#181a24] border border-zinc-700/80 rounded-xl px-3 py-2 text-xs text-white focus:border-amber-400 focus:outline-none"
                  >
                    <option value="coffee">Coffee & Tea</option>
                    <option value="drinks">Casual Drinks</option>
                    <option value="walk">Walks & Parks</option>
                    <option value="active">Sports & Bouldering</option>
                    <option value="culture">Art & Film</option>
                    <option value="chill">Co-work & Chill</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-zinc-300 mb-1">Duration Window</label>
                  <select
                    value={formDuration}
                    onChange={(e) => setFormDuration(Number(e.target.value))}
                    className="w-full bg-[#181a24] border border-zinc-700/80 rounded-xl px-3 py-2 text-xs text-white focus:border-amber-400 focus:outline-none"
                  >
                    <option value={1}>1 hour</option>
                    <option value={2}>2 hours</option>
                    <option value={3}>3 hours</option>
                    <option value={4}>4 hours</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1">Public Meeting Spot</label>
                <input
                  type="text"
                  required
                  value={formVenue}
                  onChange={(e) => setFormVenue(e.target.value)}
                  placeholder="Public venue, cafe, or park square"
                  className="w-full bg-[#181a24] border border-zinc-700/80 rounded-xl px-3 py-2 text-xs text-white placeholder-zinc-500 focus:border-amber-400 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1">
                  Note / Vibe (Optional)
                </label>
                <textarea
                  rows={2}
                  value={formDesc}
                  onChange={(e) => setFormDesc(e.target.value)}
                  placeholder="e.g. Reading by the window, friendly chat welcome, no expectations."
                  className="w-full bg-[#181a24] border border-zinc-700/80 rounded-xl px-3 py-2 text-xs text-white placeholder-zinc-500 focus:border-amber-400 focus:outline-none resize-none"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-3 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={() => setIsCreateOpen(false)}
                  className="min-h-[40px] px-4 py-2 text-xs font-medium text-zinc-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="min-h-[40px] px-4 py-2 text-xs font-semibold text-black bg-amber-400 hover:bg-amber-300 rounded-xl transition-colors cursor-pointer"
                >
                  Broadcast Pulse
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
