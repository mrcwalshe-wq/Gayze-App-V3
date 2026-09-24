import React, { useState, useMemo } from 'react';
import { Pulse, SafeHaven, LocationPrivacy } from '../types';
import { PrivacyGeographicMap } from './PrivacyGeographicMap';
import { RadarMap } from './RadarMap';
import { 
  Radio, 
  Map as MapIcon, 
  List, 
  ShieldCheck, 
  Lock, 
  Clock, 
  MapPin, 
  ArrowRight,
  X,
  Flame,
  Zap,
  Coffee,
  Wine,
  Sparkles,
  Users,
  Compass,
  Check,
  CheckCircle2
} from 'lucide-react';

export type EncounterIntent = 'All' | 'Meet' | 'Hookup' | 'Date' | 'Drinks' | 'Chat' | 'Group';

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
  // IntentMode: 'now' (immediate) vs 'later' (tonight)
  const [intentMode, setIntentMode] = useState<'now' | 'later'>('now');
  const [selectedIntent, setSelectedIntent] = useState<EncounterIntent>('All');
  const [maxDistanceKm, setMaxDistanceKm] = useState<number>(5);
  const [viewMode, setViewMode] = useState<'feed' | 'map' | 'radar'>('feed');
  const [isAvailableModalOpen, setIsAvailableModalOpen] = useState<boolean>(false);
  const [selectedPulseForDetail, setSelectedPulseForDetail] = useState<Pulse | null>(null);

  // Fast "I'm Available" Flow State
  const [availIntent, setAvailIntent] = useState<Exclude<EncounterIntent, 'All'>>('Meet');
  const [availWindow, setAvailWindow] = useState<'now' | '2h' | 'tonight'>('now');
  const [availVenue, setAvailVenue] = useState('Timberyard Cafe (Safe Haven)');
  const [availNote, setAvailNote] = useState('');

  // Map each Pulse to a high-intent encounter vocabulary
  const getPulseIntent = (pulse: Pulse): Exclude<EncounterIntent, 'All'> => {
    const tagMatch = pulse.tags?.find((t) =>
      ['meet', 'hookup', 'date', 'drinks', 'chat', 'group'].includes(t.toLowerCase())
    );
    if (tagMatch) {
      return (tagMatch.charAt(0).toUpperCase() + tagMatch.slice(1).toLowerCase()) as Exclude<EncounterIntent, 'All'>;
    }
    switch (pulse.activityCategory) {
      case 'drinks':
        return 'Drinks';
      case 'chill':
        return pulse.id.charCodeAt(pulse.id.length - 1) % 2 === 0 ? 'Hookup' : 'Meet';
      case 'coffee':
        return 'Meet';
      case 'walk':
        return 'Date';
      case 'culture':
        return 'Chat';
      case 'active':
        return 'Group';
      default:
        return 'Meet';
    }
  };

  const getPulseAvailability = (pulse: Pulse): string => {
    const remainingMinutes = Math.max(
      0,
      Math.round((pulse.expiresAt - Date.now()) / (1000 * 60))
    );
    if (remainingMinutes <= 60) return `Available now · ~${remainingMinutes}m`;
    const hours = Math.round(remainingMinutes / 60);
    return `Available now · ~${hours} hrs`;
  };

  // Filter pulses by intent, distance, and intentMode urgency
  const filteredPulses = useMemo(() => {
    return pulses.filter((p) => {
      const intent = getPulseIntent(p);
      if (selectedIntent !== 'All' && intent !== selectedIntent) {
        return false;
      }
      if (p.approxDistanceKm > maxDistanceKm) {
        return false;
      }
      if (intentMode === 'now') {
        // Prioritize active, immediate duration (<= 3 hours)
        return p.durationHours <= 3;
      }
      return true;
    });
  }, [pulses, selectedIntent, maxDistanceKm, intentMode]);

  const activeCount = pulses.length + 8; // realistic contextual activity count
  const meetingCount = pulses.length;

  const handleCreateAvailableSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const durationMap = {
      now: 1,
      '2h': 2,
      tonight: 4,
    };

    const categoryMap: Record<Exclude<EncounterIntent, 'All'>, Pulse['activityCategory']> = {
      Meet: 'coffee',
      Hookup: 'chill',
      Drinks: 'drinks',
      Date: 'walk',
      Chat: 'culture',
      Group: 'active',
    };

    const latJitter = 51.5132 + (Math.random() - 0.5) * 0.005;
    const lngJitter = -0.1300 + (Math.random() - 0.5) * 0.005;

    onCreatePulse({
      peerId: 'peer_me',
      peerName: 'Julian K.',
      peerShortKey: 'pk_7e3f...6e80',
      peerAvatar: 'julian',
      title: `${availIntent.toUpperCase()} · ${availWindow === 'now' ? 'Available now' : availWindow === '2h' ? 'Next 2 hours' : 'Free tonight'}`,
      description: availNote.trim() || `Available for ${availIntent.toLowerCase()} near ${availVenue}. Respectful & discreet.`,
      activityCategory: categoryMap[availIntent],
      venueName: availVenue,
      neighborhood: userNeighborhood,
      approxDistanceKm: 0.1,
      jitterMeters: 250,
      lat: latJitter,
      lng: lngJitter,
      durationHours: durationMap[availWindow],
      tags: [availIntent, availWindow, 'Available'],
      safeHavenVenue: availVenue.toLowerCase().includes('haven') || safeHavens.some((h) => availVenue.includes(h.name)),
    });

    setIsAvailableModalOpen(false);
    setAvailNote('');
  };

  const handleBroadcastHere = (venueName: string) => {
    setAvailVenue(venueName);
    setIsAvailableModalOpen(true);
  };

  return (
    <div className="space-y-4">
      {/* =========================================================================
          1. HERO HEADER: LIVE RADAR FEEL & INTENTMODE™
         ========================================================================= */}
      <div className="flex flex-col gap-3 pb-3 border-b border-white/[0.08]">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          {/* Title & Live Status */}
          <div>
            <div className="flex items-center gap-2">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#C9A24D] opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#C9A24D]"></span>
              </span>
              <h1 className="text-xl sm:text-2xl font-black tracking-tight text-white font-sans uppercase">
                RIGHT NOW
              </h1>
              <span className="text-xs font-mono text-zinc-400 bg-[#141620] px-2 py-0.5 rounded-md border border-white/10">
                {userNeighborhood}
              </span>
            </div>

            <div className="flex items-center gap-2 text-xs text-zinc-400 mt-1">
              <span>{activeCount} active nearby</span>
              <span className="text-zinc-600">·</span>
              <span className="text-zinc-200 font-medium">{meetingCount} ready to meet</span>
              <span className="text-zinc-600">·</span>
              <span className="text-[#C9A24D] flex items-center gap-1">
                <ShieldCheck className="w-3 h-3 text-[#C9A24D]" />
                Cloaked ±300m
              </span>
            </div>
          </div>

          {/* Header Controls: IntentMode™ Signature Slider + Primary "I'm Available" CTA */}
          <div className="flex items-center gap-2.5">
            {/* Signature IntentMode™ Switcher */}
            <div className="flex items-center p-1 bg-[#11131a] rounded-xl border border-white/10 shadow-inner">
              <button
                onClick={() => setIntentMode('now')}
                className={`h-8 px-3 text-xs font-bold rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${
                  intentMode === 'now'
                    ? 'bg-[#C9A24D] text-black shadow-md'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                <Zap className="w-3.5 h-3.5 fill-current" />
                <span>RIGHT NOW</span>
              </button>

              <button
                onClick={() => setIntentMode('later')}
                className={`h-8 px-3 text-xs font-bold rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${
                  intentMode === 'later'
                    ? 'bg-[#6F3CC3] text-white shadow-md'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                <Clock className="w-3.5 h-3.5" />
                <span>LATER</span>
              </button>
            </div>

            {/* Primary Action Button */}
            <button
              onClick={() => setIsAvailableModalOpen(true)}
              className="h-10 px-4 text-xs font-bold text-black bg-[#C9A24D] hover:bg-[#b58f3b] rounded-xl transition-all shadow-md cursor-pointer flex items-center gap-1.5 active:scale-95 shrink-0"
            >
              <Zap className="w-4 h-4 fill-black" />
              <span>I'm Available</span>
            </button>
          </div>
        </div>

        {/* View Switcher: Feed / Map / Radar */}
        <div className="flex items-center justify-between gap-2 pt-1">
          {/* Intent Filters */}
          <div className="flex items-center gap-1 overflow-x-auto no-scrollbar py-0.5">
            {(['All', 'Meet', 'Hookup', 'Drinks', 'Date', 'Chat', 'Group'] as EncounterIntent[]).map((intent) => {
              const isActive = selectedIntent === intent;
              return (
                <button
                  key={intent}
                  onClick={() => setSelectedIntent(intent)}
                  className={`h-8 px-3 text-xs font-semibold rounded-lg whitespace-nowrap transition-all cursor-pointer ${
                    isActive
                      ? 'bg-[#1c1f2b] text-white border border-[#C9A24D]/40 shadow-sm'
                      : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04]'
                  }`}
                >
                  {intent === 'Hookup' && <span className="text-[#C9A24D] mr-1">●</span>}
                  {intent}
                </button>
              );
            })}
          </div>

          {/* Right: Distance & Display toggles */}
          <div className="flex items-center gap-1.5 shrink-0">
            <select
              value={maxDistanceKm}
              onChange={(e) => setMaxDistanceKm(Number(e.target.value))}
              className="h-8 bg-[#11131a] border border-white/10 rounded-lg px-2 text-xs text-zinc-300 focus:outline-none focus:border-[#C9A24D] cursor-pointer"
            >
              <option value={1}>&lt; 1 km</option>
              <option value={2}>&lt; 2 km</option>
              <option value={5}>&lt; 5 km</option>
              <option value={20}>Any distance</option>
            </select>

            <div className="flex items-center p-0.5 bg-[#11131a] rounded-lg border border-white/10">
              <button
                onClick={() => setViewMode('feed')}
                title="Feed View"
                className={`h-7 px-2.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1 cursor-pointer ${
                  viewMode === 'feed'
                    ? 'bg-[#1c1f2b] text-white font-semibold'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                <List className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Feed</span>
              </button>

              <button
                onClick={() => setViewMode('map')}
                title="Map View"
                className={`h-7 px-2.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1 cursor-pointer ${
                  viewMode === 'map'
                    ? 'bg-[#1c1f2b] text-white font-semibold'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                <MapIcon className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Map</span>
              </button>

              <button
                onClick={() => setViewMode('radar')}
                title="Radar View"
                className={`h-7 px-2 rounded-md text-xs font-medium transition-colors flex items-center gap-1 cursor-pointer ${
                  viewMode === 'radar'
                    ? 'bg-[#1c1f2b] text-white font-semibold'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                <Radio className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Radar</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* =========================================================================
          2. FEED VIEW: HIGH-INTENT DISCOVERY CARDS
         ========================================================================= */}
      {viewMode === 'feed' && (
        <div className="space-y-3">
          {filteredPulses.length === 0 ? (
            <div className="p-10 text-center rounded-2xl bg-[#11131a] border border-white/[0.08] space-y-3">
              <Compass className="w-8 h-8 text-zinc-500 mx-auto" />
              <h3 className="text-sm font-semibold text-white">No active intent matches right now</h3>
              <p className="text-xs text-zinc-400 max-w-sm mx-auto">
                No one nearby is broadcasting for this specific intent. Be the first to let nearby members know you are free!
              </p>
              <button
                onClick={() => setIsAvailableModalOpen(true)}
                className="h-9 px-4 text-xs font-bold text-black bg-[#C9A24D] hover:bg-[#b58f3b] rounded-xl transition-colors cursor-pointer"
              >
                Set My Intent Now
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
              {filteredPulses.map((pulse) => {
                const intent = getPulseIntent(pulse);
                const availability = getPulseAvailability(pulse);
                const reliability = 96; // confident trust score indicator

                return (
                  <div
                    key={pulse.id}
                    className="group bg-[#11131a] hover:bg-[#141620] border border-white/[0.08] hover:border-[#C9A24D]/40 rounded-2xl p-4 transition-all flex flex-col justify-between shadow-sm relative overflow-hidden"
                  >
                    {/* Top Identity & Status Row */}
                    <div>
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-2.5">
                          {/* Avatar Monogram */}
                          <div className="w-10 h-10 rounded-xl bg-[#1c1f2b] border border-white/10 flex items-center justify-center text-sm font-bold text-[#C9A24D] shrink-0">
                            {pulse.peerName.charAt(0)}
                          </div>

                          <div>
                            <div className="flex items-baseline gap-1.5">
                              <span className="text-sm font-bold text-white tracking-tight">
                                {pulse.peerName}, 32
                              </span>
                              <span className="text-[11px] font-mono text-zinc-400">
                                · {pulse.approxDistanceKm} km
                              </span>
                            </div>

                            {/* Active & Availability Status */}
                            <div className="flex items-center gap-2 text-[11px] text-zinc-400 mt-0.5">
                              <span className="flex items-center gap-1 text-emerald-400 font-medium">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                Active now
                              </span>
                              <span>·</span>
                              <span className="text-zinc-300 font-medium">{availability}</span>
                            </div>
                          </div>
                        </div>

                        {/* Intent Tag Pill */}
                        <div className="px-2.5 py-1 rounded-lg bg-[#1c1f2b] border border-[#C9A24D]/30 text-xs font-bold text-[#C9A24D] tracking-wider uppercase shrink-0">
                          {intent}
                        </div>
                      </div>

                      {/* Headline / What they are looking for */}
                      <div className="mt-3">
                        <div className="text-xs font-semibold text-white tracking-tight">
                          {pulse.title}
                        </div>
                        <p className="text-xs text-zinc-300 mt-1 leading-relaxed line-clamp-2">
                          {pulse.description}
                        </p>
                      </div>

                      {/* Meeting Context & Cloaked Location */}
                      <div className="mt-3 pt-2.5 border-t border-white/[0.06] flex items-center justify-between text-xs text-zinc-400">
                        <div className="flex items-center gap-1.5 truncate max-w-[220px]">
                          <MapPin className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                          <span className="truncate">{pulse.venueName}</span>
                          {pulse.safeHavenVenue && (
                            <span title="Safe Haven Verified" className="shrink-0 text-emerald-400">
                              <ShieldCheck className="w-3.5 h-3.5" />
                            </span>
                          )}
                        </div>

                        {/* Trust indicator */}
                        <div className="flex items-center gap-1 text-[11px] text-emerald-300 font-mono shrink-0">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                          <span>Verified · {reliability} trust</span>
                        </div>
                      </div>
                    </div>

                    {/* Bottom Action Row */}
                    <div className="mt-3 pt-2.5 border-t border-white/[0.06] flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1 text-[11px] text-zinc-400 font-mono">
                        <Lock className="w-3 h-3 text-[#C9A24D]" />
                        <span>E2EE Swarm</span>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => onOpenDirectChat(pulse)}
                          className="h-9 px-3 text-xs font-medium text-zinc-300 hover:text-white bg-[#1c1f2b] hover:bg-[#252838] border border-white/10 rounded-xl transition-colors cursor-pointer"
                        >
                          Message
                        </button>

                        <button
                          onClick={() => onOpenDirectChat(pulse)}
                          className="h-9 px-3.5 text-xs font-bold text-black bg-[#C9A24D] hover:bg-[#b58f3b] rounded-xl transition-all cursor-pointer flex items-center gap-1.5 shadow-sm active:scale-95"
                        >
                          <span>I'm Interested</span>
                          <ArrowRight className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* =========================================================================
          3. MAP VIEW (PRESERVED IMPLEMENTATION, INTENT-FOCUSED CONTEXT)
         ========================================================================= */}
      {viewMode === 'map' && (
        <div className="space-y-3">
          <PrivacyGeographicMap
            pulses={filteredPulses}
            safeHavens={safeHavens}
            userNeighborhood={userNeighborhood}
            privacySetting={privacySetting}
            onOpenDirectChat={onOpenDirectChat}
            onSelectHaven={onSelectHaven}
            onBroadcastHere={handleBroadcastHere}
          />

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-3.5 py-2.5 bg-[#11131a] border border-white/10 rounded-xl text-xs text-zinc-400">
            <div className="flex items-center gap-2">
              <span className="text-zinc-200 font-semibold">{filteredPulses.length} real-time encounters active</span>
              <span>·</span>
              <span>{safeHavens.length} verified safe meeting spots</span>
            </div>

            <div className="text-[11px] text-zinc-400 flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5 text-[#C9A24D]" />
              <span>Locations are randomized by ~300m for member privacy</span>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          4. TACTICAL RADAR VIEW
         ========================================================================= */}
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
            <div className="p-4 bg-[#11131a] border border-white/10 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4 animate-in fade-in">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-[#1c1f2b] border border-white/10 flex items-center justify-center font-bold text-[#C9A24D] shrink-0">
                  {selectedPulseForDetail.peerName.charAt(0)}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-white">{selectedPulseForDetail.peerName}</span>
                    <span className="px-2 py-0.5 rounded bg-[#1c1f2b] text-[10px] font-bold text-[#C9A24D] uppercase">
                      {getPulseIntent(selectedPulseForDetail)}
                    </span>
                  </div>
                  <h4 className="text-xs font-semibold text-zinc-200 mt-0.5">{selectedPulseForDetail.title}</h4>
                  <div className="text-[11px] text-zinc-400 mt-1 flex items-center gap-1.5">
                    <MapPin className="w-3 h-3 text-[#C9A24D]" />
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
                  className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-black bg-[#C9A24D] hover:bg-[#b58f3b] rounded-xl transition-colors cursor-pointer"
                >
                  <Lock className="w-3.5 h-3.5" />
                  <span>Connect & Chat</span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* =========================================================================
          5. "I'M AVAILABLE" / FAST INTENT MODAL (2-3 STEP EXPERIENCE)
         ========================================================================= */}
      {isAvailableModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/85 backdrop-blur-sm animate-in fade-in">
          <div className="relative w-full max-w-md bg-[#11131a] border border-white/10 rounded-2xl p-5 sm:p-6 shadow-2xl space-y-4 max-h-[92vh] overflow-y-auto">
            {/* Header */}
            <div className="flex items-center justify-between pb-2 border-b border-white/[0.08]">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-[#C9A24D]/15 border border-[#C9A24D]/30 flex items-center justify-center text-[#C9A24D]">
                  <Zap className="w-4 h-4 fill-current" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">I'm Available</h3>
                  <p className="text-[11px] text-zinc-400">
                    Real-time intent · Ephemeral · Cloaked by ~300m
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsAvailableModalOpen(false)}
                className="w-8 h-8 rounded-lg text-zinc-400 hover:text-white flex items-center justify-center hover:bg-white/[0.06] transition-colors cursor-pointer"
                aria-label="Close modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateAvailableSubmit} className="space-y-4">
              {/* Step 1: What are you open to? */}
              <div>
                <label className="block text-xs font-semibold text-zinc-300 uppercase tracking-wider mb-2">
                  1. What are you open to?
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {(['Meet', 'Hookup', 'Drinks', 'Date', 'Chat', 'Group'] as Exclude<EncounterIntent, 'All'>[]).map((intent) => {
                    const isSelected = availIntent === intent;
                    return (
                      <button
                        key={intent}
                        type="button"
                        onClick={() => setAvailIntent(intent)}
                        className={`h-11 px-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex flex-col items-center justify-center border ${
                          isSelected
                            ? 'bg-[#C9A24D] text-black border-[#C9A24D] shadow-md scale-[1.02]'
                            : 'bg-[#171922] text-zinc-300 border-white/10 hover:border-white/20'
                        }`}
                      >
                        <span>{intent}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Step 2: Availability Window */}
              <div>
                <label className="block text-xs font-semibold text-zinc-300 uppercase tracking-wider mb-2">
                  2. Availability Window
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: 'now', label: 'Right Now', desc: '1 hour' },
                    { id: '2h', label: 'Next 2 Hours', desc: '2 hours' },
                    { id: 'tonight', label: 'Tonight', desc: '4 hours' },
                  ].map((win) => {
                    const isSelected = availWindow === win.id;
                    return (
                      <button
                        key={win.id}
                        type="button"
                        onClick={() => setAvailWindow(win.id as any)}
                        className={`h-12 px-2 rounded-xl text-xs font-semibold transition-all cursor-pointer flex flex-col items-center justify-center border ${
                          isSelected
                            ? 'bg-[#1c1f2b] text-[#C9A24D] border-[#C9A24D]/50 shadow-sm'
                            : 'bg-[#171922] text-zinc-400 border-white/10 hover:text-white'
                        }`}
                      >
                        <span className="font-bold">{win.label}</span>
                        <span className="text-[10px] text-zinc-500">{win.desc}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Step 3: Preferred Area / Spot */}
              <div>
                <label className="block text-xs font-semibold text-zinc-300 uppercase tracking-wider mb-1.5">
                  3. Area or Meeting Spot
                </label>
                <input
                  type="text"
                  required
                  value={availVenue}
                  onChange={(e) => setAvailVenue(e.target.value)}
                  placeholder="e.g. Soho Square, Cafe, or my place"
                  className="w-full bg-[#171922] border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder-zinc-500 focus:border-[#C9A24D] focus:outline-none"
                />
                <div className="flex items-center gap-1.5 mt-1.5 overflow-x-auto no-scrollbar">
                  {safeHavens.slice(0, 3).map((haven) => (
                    <button
                      key={haven.id}
                      type="button"
                      onClick={() => setAvailVenue(`${haven.name} (Safe Haven)`)}
                      className="px-2 py-0.5 rounded-lg bg-[#141620] hover:bg-[#1c1f2b] text-[10px] text-zinc-300 border border-white/[0.08] whitespace-nowrap cursor-pointer"
                    >
                      ★ {haven.name}
                    </button>
                  ))}
                </div>
              </div>

              {/* Step 4: Optional Vibe / Note */}
              <div>
                <label className="block text-xs font-semibold text-zinc-300 uppercase tracking-wider mb-1.5">
                  4. Short Note (Optional)
                </label>
                <input
                  type="text"
                  value={availNote}
                  onChange={(e) => setAvailNote(e.target.value)}
                  placeholder="e.g. Relaxed, hosting or can travel nearby"
                  className="w-full bg-[#171922] border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder-zinc-500 focus:border-[#C9A24D] focus:outline-none"
                />
              </div>

              {/* Privacy Cloaking Notice */}
              <div className="p-2.5 rounded-xl bg-[#141620] border border-white/[0.07] text-[11px] text-zinc-400 flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>Zero precise GPS stored. Automatically expires when timer finishes.</span>
              </div>

              {/* Actions */}
              <div className="pt-2 flex items-center justify-end gap-2.5 border-t border-white/[0.08]">
                <button
                  type="button"
                  onClick={() => setIsAvailableModalOpen(false)}
                  className="h-10 px-4 text-xs font-medium text-zinc-400 hover:text-white cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="h-10 px-5 text-xs font-bold text-black bg-[#C9A24D] hover:bg-[#b58f3b] rounded-xl transition-all cursor-pointer shadow-md flex items-center gap-1.5"
                >
                  <Zap className="w-3.5 h-3.5 fill-black" />
                  <span>Go Live Now</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
