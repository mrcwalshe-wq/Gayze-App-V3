import React, { useState, useMemo, useEffect } from 'react';
import { Pulse, SafeHaven, LocationPrivacy } from '../types';
import { PrivacyGeographicMap } from './PrivacyGeographicMap';
import { RadarMap } from './RadarMap';
import { IntentModeControl, IntentTimingMode } from './IntentModeControl';
import { SetIntentSheet, UserActiveIntent, EncounterIntentType } from './SetIntentSheet';
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
  Zap,
  Compass,
  CheckCircle2,
  SlidersHorizontal,
  Flame,
  MessageSquare,
  Sparkles,
  Check,
  Calendar,
  Share2
} from 'lucide-react';
import { 
  hapticLight, 
  hapticSensitiveAction, 
  triggerVibration 
} from '../services/hapticService';

export type AvailabilityWindow = 'now' | '2h' | 'tonight';

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
  // 1. Signature IntentMode Timing: 'right_now' vs 'later'
  const [intentTimingMode, setIntentTimingMode] = useState<IntentTimingMode>('right_now');

  // 2. User's Personal Active Intent State
  const [activeUserIntent, setActiveUserIntent] = useState<UserActiveIntent | null>(null);
  const [isSetIntentOpen, setIsSetIntentOpen] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // 3. Right Now Filtering & Intent Chips
  const [selectedIntentChip, setSelectedIntentChip] = useState<EncounterIntentType | 'All'>('All');
  const [availabilityWindow, setAvailabilityWindow] = useState<AvailabilityWindow>('now');
  const [laterTimeFilter, setLaterTimeFilter] = useState<'tonight' | 'tomorrow' | 'weekend'>('tonight');
  const [maxDistanceKm, setMaxDistanceKm] = useState<number>(5);
  const [viewMode, setViewMode] = useState<'feed' | 'map' | 'radar'>('feed');

  // 4. "I'm Interested" & Mutual Match State
  const [interestedPulseIds, setInterestedPulseIds] = useState<Set<string>>(new Set());
  const [mutualMatchPulse, setMutualMatchPulse] = useState<Pulse | null>(null);
  const [selectedPulseForDetail, setSelectedPulseForDetail] = useState<Pulse | null>(null);

  // Countdown timer for active user intent
  const [remainingMinutes, setRemainingMinutes] = useState<number>(0);

  useEffect(() => {
    if (!activeUserIntent) return;

    const updateRemaining = () => {
      const diff = Math.max(0, Math.round((activeUserIntent.expiresAt - Date.now()) / (1000 * 60)));
      setRemainingMinutes(diff);
      if (diff <= 0) {
        setActiveUserIntent(null);
        setStatusMessage('Intent ended (timer expired)');
        setTimeout(() => setStatusMessage(null), 3500);
      }
    };

    updateRemaining();
    const interval = setInterval(updateRemaining, 30000);
    return () => clearInterval(interval);
  }, [activeUserIntent]);

  // Map each Pulse to a high-intent encounter vocabulary
  const getPulseIntent = (pulse: Pulse): EncounterIntentType => {
    const tagMatch = pulse.tags?.find((t) =>
      ['meet', 'hookup', 'date', 'drinks', 'chat', 'group', 'explore'].includes(t.toLowerCase())
    );
    if (tagMatch) {
      const capitalized = tagMatch.charAt(0).toUpperCase() + tagMatch.slice(1).toLowerCase();
      return capitalized as EncounterIntentType;
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
    const rem = Math.max(
      0,
      Math.round((pulse.expiresAt - Date.now()) / (1000 * 60))
    );
    if (rem <= 60) return `Available now · ~${rem}m`;
    const hours = Math.round(rem / 60);
    return `Available now · ~${hours} hrs`;
  };

  // Compatibility helper between current user intent and peer intent
  const getCompatibility = (peerIntent: EncounterIntentType): 'MATCHING' | 'SIMILAR' | null => {
    const myIntent = activeUserIntent ? activeUserIntent.intent : (selectedIntentChip !== 'All' ? selectedIntentChip : null);
    if (!myIntent) return null;

    if (myIntent === peerIntent) {
      return 'MATCHING';
    }

    // Related intents
    const hookupCluster: EncounterIntentType[] = ['Hookup', 'Meet', 'Drinks'];
    const dateCluster: EncounterIntentType[] = ['Date', 'Drinks', 'Chat', 'Meet'];
    const socialCluster: EncounterIntentType[] = ['Group', 'Explore', 'Chat'];

    if (hookupCluster.includes(myIntent) && hookupCluster.includes(peerIntent)) return 'SIMILAR';
    if (dateCluster.includes(myIntent) && dateCluster.includes(peerIntent)) return 'SIMILAR';
    if (socialCluster.includes(myIntent) && socialCluster.includes(peerIntent)) return 'SIMILAR';

    return null;
  };

  // Filter and prioritize pulses
  const filteredPulses = useMemo(() => {
    let list = pulses.filter((p) => {
      const intent = getPulseIntent(p);
      if (selectedIntentChip !== 'All' && intent !== selectedIntentChip) {
        return false;
      }
      if (p.approxDistanceKm > maxDistanceKm) {
        return false;
      }

      if (intentTimingMode === 'right_now') {
        if (availabilityWindow === 'now') return p.durationHours <= 2;
        if (availabilityWindow === '2h') return p.durationHours <= 2.5;
        return true;
      } else {
        // 'later' mode: filter by planned windows
        if (laterTimeFilter === 'tonight') return p.durationHours >= 2 || p.title.toLowerCase().includes('tonight') || p.tags.some(t => t.toLowerCase().includes('evening'));
        return true;
      }
    });

    // Deterministic ranking: when user intent is active, prioritize matching/similar intent
    if (activeUserIntent) {
      list.sort((a, b) => {
        const compA = getCompatibility(getPulseIntent(a));
        const compB = getCompatibility(getPulseIntent(b));

        const scoreA = compA === 'MATCHING' ? 3 : compA === 'SIMILAR' ? 2 : 1;
        const scoreB = compB === 'MATCHING' ? 3 : compB === 'SIMILAR' ? 2 : 1;

        if (scoreB !== scoreA) return scoreB - scoreA;
        return a.approxDistanceKm - b.approxDistanceKm;
      });
    }

    return list;
  }, [pulses, selectedIntentChip, maxDistanceKm, availabilityWindow, intentTimingMode, laterTimeFilter, activeUserIntent]);

  // Handle saving intent from bottom sheet
  const handleSaveIntent = (intentData: UserActiveIntent) => {
    setActiveUserIntent(intentData);

    // Also publish a Pulse to the swarm for nearby peers
    const categoryMap: Record<EncounterIntentType, Pulse['activityCategory']> = {
      Meet: 'coffee',
      Hookup: 'chill',
      Date: 'walk',
      Drinks: 'drinks',
      Chat: 'culture',
      Group: 'active',
      Explore: 'walk',
    };

    const durationNum = intentData.duration === '1 hr' ? 1 : intentData.duration === '2 hrs' ? 2 : 4;
    const latJitter = 51.5132 + (Math.random() - 0.5) * 0.005;
    const lngJitter = -0.1300 + (Math.random() - 0.5) * 0.005;

    onCreatePulse({
      peerId: 'peer_me',
      peerName: 'Julian K.',
      peerShortKey: 'pk_7e3f...6e80',
      peerAvatar: 'julian',
      title: `${intentData.intent.toUpperCase()} · ${intentData.when === 'Now' ? 'Available now' : intentData.when}`,
      description: intentData.note || `Available for ${intentData.intent.toLowerCase()} near ${intentData.area}. Open to: ${intentData.openTo.toLowerCase()}.`,
      activityCategory: categoryMap[intentData.intent],
      venueName: intentData.area,
      neighborhood: userNeighborhood,
      approxDistanceKm: 0.1,
      jitterMeters: 250,
      lat: latJitter,
      lng: lngJitter,
      durationHours: durationNum,
      tags: [intentData.intent, intentData.when, intentData.openTo],
      safeHavenVenue: intentData.area.toLowerCase().includes('haven'),
    });

    setStatusMessage(`✓ Intent live: ${intentData.intent.toUpperCase()} (${intentData.when})`);
    setTimeout(() => setStatusMessage(null), 3500);
  };

  // End active intent
  const handleEndIntent = () => {
    hapticSensitiveAction();
    setActiveUserIntent(null);
    setStatusMessage('Intent ended');
    setTimeout(() => setStatusMessage(null), 3000);
  };

  // Tap "I'm Interested"
  const handleTapInterested = (pulse: Pulse) => {
    hapticLight();
    const nextSet = new Set(interestedPulseIds);
    const isNew = !nextSet.has(pulse.id);
    nextSet.add(pulse.id);
    setInterestedPulseIds(nextSet);

    // Mutual interest trigger on compatible profiles (e.g. pulse_1 Marcus, pulse_4 Alex, or any hookup pulse)
    const isCompatible = getCompatibility(getPulseIntent(pulse)) !== null || pulse.id === 'pulse_1' || pulse.id === 'pulse_4';
    if (isNew && isCompatible) {
      triggerVibration([40, 60, 100]);
      setTimeout(() => {
        setMutualMatchPulse(pulse);
      }, 350);
    }
  };

  const handleBroadcastHere = (venueName: string) => {
    setIsSetIntentOpen(true);
  };

  // Format remaining time for live status
  const formatRemainingTime = (mins: number) => {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h > 0) return `~${h}h ${m}m`;
    return `~${m}m`;
  };

  return (
    <div className="space-y-4">
      {/* Subtle Flash Notification Banner */}
      {statusMessage && (
        <div className="bg-[#141620] border border-[#C9A24D]/40 text-white text-xs px-3.5 py-2 rounded-xl flex items-center justify-between shadow-lg animate-in fade-in duration-150">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#C9A24D] animate-pulse" />
            <span className="font-semibold">{statusMessage}</span>
          </div>
          <button
            onClick={() => setStatusMessage(null)}
            className="text-zinc-400 hover:text-white text-xs cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* =========================================================================
          1. INTENTMODE™ SIGNATURE INTERACTION
          RIGHT NOW                         LATER
          ●━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━●
         ========================================================================= */}
      <IntentModeControl
        mode={intentTimingMode}
        onChange={(newMode) => {
          setIntentTimingMode(newMode);
        }}
        activeEncountersCount={pulses.length}
        laterPlansCount={6}
      />

      {/* =========================================================================
          2. ACTIVE INTENT STATUS OR "SET MY INTENT" CTA
         ========================================================================= */}
      {activeUserIntent ? (
        /* Persistent discreet active state */
        <div className="bg-[#11131a] border border-[#C9A24D]/50 rounded-2xl p-3 sm:p-4 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-in fade-in duration-200">
          <div className="flex items-center gap-3">
            <div className="relative flex h-3 w-3 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#C9A24D] opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-[#C9A24D]"></span>
            </div>

            <div>
              <div className="flex items-baseline gap-2">
                <span className="text-[11px] font-black tracking-wider text-[#C9A24D] uppercase font-mono">
                  ● LIVE NOW
                </span>
                <span className="text-sm font-black text-white uppercase tracking-wide font-sans">
                  {activeUserIntent.intent}
                </span>
                <span className="text-xs text-zinc-300 font-medium">
                  · Available for {formatRemainingTime(remainingMinutes)}
                </span>
              </div>

              <div className="flex items-center gap-2 text-[11px] text-zinc-400 mt-0.5">
                <span className="text-zinc-300">Open to: {activeUserIntent.openTo}</span>
                <span className="text-zinc-600">·</span>
                <span className="text-zinc-400 flex items-center gap-1">
                  <ShieldCheck className="w-3 h-3 text-[#C9A24D]" />
                  Approximate location protected (±300m)
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
            <button
              onClick={() => {
                hapticLight();
                setIsSetIntentOpen(true);
              }}
              className="h-8 px-3 text-xs font-semibold text-zinc-200 hover:text-white bg-[#1a1d28] hover:bg-[#232736] border border-white/10 rounded-xl transition-all cursor-pointer"
            >
              Change
            </button>
            <button
              onClick={handleEndIntent}
              className="h-8 px-3 text-xs font-semibold text-rose-400 hover:text-rose-300 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 rounded-xl transition-all cursor-pointer"
            >
              End
            </button>
          </div>
        </div>
      ) : (
        /* Unset Intent: Fast entry point */
        <div className="bg-[#11131a] border border-white/[0.08] rounded-2xl p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-white tracking-tight">
              {intentTimingMode === 'right_now'
                ? 'Looking for a spontaneous encounter?'
                : 'Making plans for tonight or tomorrow?'}
            </h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              Set what you want and when you're available. Zero friction, approximate location only.
            </p>
          </div>

          <button
            onClick={() => {
              hapticLight();
              setIsSetIntentOpen(true);
            }}
            className="h-9 px-4 text-xs font-black text-black bg-[#C9A24D] hover:bg-[#b58f3b] active:scale-95 rounded-xl transition-all cursor-pointer shadow-md flex items-center justify-center gap-1.5 shrink-0 uppercase tracking-wider"
          >
            <Zap className="w-3.5 h-3.5 fill-black" />
            <span>Set My Intent</span>
          </button>
        </div>
      )}

      {/* =========================================================================
          3. DISCOVERY CONTROLS & RESTRAINED INTENT CHIPS
         ========================================================================= */}
      <div className="bg-[#11131a] border border-white/[0.08] rounded-2xl p-3 sm:p-3.5 space-y-2.5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          {/* Availability Filter Segment */}
          {intentTimingMode === 'right_now' ? (
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-1 shrink-0">
                <Clock className="w-3 h-3 text-[#C9A24D]" />
                <span>Available:</span>
              </span>

              <div className="flex items-center p-0.5 bg-[#090a0e] rounded-xl border border-white/10">
                {(
                  [
                    { id: 'now', label: 'Now' },
                    { id: '2h', label: '2h' },
                    { id: 'tonight', label: 'Tonight' },
                  ] as const
                ).map((tab) => {
                  const isActive = availabilityWindow === tab.id;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => {
                        hapticLight();
                        setAvailabilityWindow(tab.id);
                      }}
                      className={`h-7 px-3 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                        isActive
                          ? 'bg-[#C9A24D] text-black shadow-sm'
                          : 'text-zinc-400 hover:text-white'
                      }`}
                    >
                      {tab.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-1 shrink-0">
                <Calendar className="w-3 h-3 text-[#6F3CC3]" />
                <span>Timeframe:</span>
              </span>

              <div className="flex items-center p-0.5 bg-[#090a0e] rounded-xl border border-white/10">
                {(
                  [
                    { id: 'tonight', label: 'Tonight' },
                    { id: 'tomorrow', label: 'Tomorrow' },
                    { id: 'weekend', label: 'Weekend' },
                  ] as const
                ).map((tab) => {
                  const isActive = laterTimeFilter === tab.id;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => {
                        hapticLight();
                        setLaterTimeFilter(tab.id);
                      }}
                      className={`h-7 px-3 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                        isActive
                          ? 'bg-[#6F3CC3] text-white shadow-sm'
                          : 'text-zinc-400 hover:text-white'
                      }`}
                    >
                      {tab.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* View Modes & Distance */}
          <div className="flex items-center gap-2 self-end sm:self-auto">
            <select
              value={maxDistanceKm}
              onChange={(e) => setMaxDistanceKm(Number(e.target.value))}
              className="h-7 bg-[#090a0e] border border-white/10 rounded-lg px-2 text-xs text-zinc-300 focus:outline-none focus:border-[#C9A24D] cursor-pointer"
            >
              <option value={1}>&lt; 1 km</option>
              <option value={2}>&lt; 2 km</option>
              <option value={5}>&lt; 5 km</option>
              <option value={20}>Any distance</option>
            </select>

            <div className="flex items-center p-0.5 bg-[#090a0e] rounded-lg border border-white/10">
              <button
                onClick={() => setViewMode('feed')}
                className={`h-6 px-2.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1 cursor-pointer ${
                  viewMode === 'feed'
                    ? 'bg-[#1c1f2b] text-white font-semibold'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                <List className="w-3 h-3" />
                <span className="hidden sm:inline">List</span>
              </button>

              <button
                onClick={() => setViewMode('map')}
                className={`h-6 px-2.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1 cursor-pointer ${
                  viewMode === 'map'
                    ? 'bg-[#1c1f2b] text-white font-semibold'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                <MapIcon className="w-3 h-3" />
                <span className="hidden sm:inline">Map</span>
              </button>

              <button
                onClick={() => setViewMode('radar')}
                className={`h-6 px-2 rounded-md text-xs font-medium transition-colors flex items-center gap-1 cursor-pointer ${
                  viewMode === 'radar'
                    ? 'bg-[#1c1f2b] text-white font-semibold'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                <Radio className="w-3 h-3" />
                <span className="hidden sm:inline">Radar</span>
              </button>
            </div>
          </div>
        </div>

        {/* Restrained Intent Chips: Meet, Hookup, Date, Drinks, Chat, Group, Explore */}
        <div className="pt-2 border-t border-white/[0.06] flex items-center gap-1.5 overflow-x-auto no-scrollbar">
          <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 mr-1 shrink-0 hidden sm:inline">
            Filter:
          </span>
          {(['All', 'Meet', 'Hookup', 'Date', 'Drinks', 'Chat', 'Group', 'Explore'] as (EncounterIntentType | 'All')[]).map((intent) => {
            const isActive = selectedIntentChip === intent;
            return (
              <button
                key={intent}
                onClick={() => {
                  hapticLight();
                  setSelectedIntentChip(intent);
                }}
                className={`h-7 px-3 rounded-lg text-xs font-semibold whitespace-nowrap transition-all duration-150 cursor-pointer flex items-center gap-1.5 border ${
                  isActive
                    ? 'bg-[#181a24] text-white border-[#C9A24D] shadow-sm font-bold'
                    : 'bg-[#090a0e] text-zinc-400 border-white/[0.08] hover:text-zinc-200 hover:border-white/20'
                }`}
              >
                {intent === 'Hookup' && (
                  <span className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-[#C9A24D]' : 'bg-zinc-500'}`} />
                )}
                <span>{intent}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* =========================================================================
          4. MUTUAL INTEREST / MATCH CARD (ELEGANT, NO SLOP)
         ========================================================================= */}
      {mutualMatchPulse && (
        <div className="p-4 bg-[#141620] border border-[#C9A24D] rounded-2xl shadow-2xl animate-in fade-in zoom-in-95 duration-200 space-y-3">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-black tracking-widest text-[#C9A24D] uppercase font-mono">
                  IT’S A MATCH
                </span>
                <span className="text-zinc-500">·</span>
                <span className="text-xs text-zinc-300 font-medium">Both interested</span>
              </div>
              <h3 className="text-base font-black text-white tracking-wide uppercase mt-0.5">
                {getPulseIntent(mutualMatchPulse)} · NOW
              </h3>
              <p className="text-xs text-zinc-300 mt-1">
                You and {mutualMatchPulse.peerName} expressed mutual interest.
              </p>
            </div>
            <button
              onClick={() => setMutualMatchPulse(null)}
              className="w-7 h-7 rounded-lg text-zinc-400 hover:text-white flex items-center justify-center cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Safety Context at the Right Moment */}
          <div className="p-2.5 bg-[#0d0e14] rounded-xl border border-white/[0.06] text-[11px] text-zinc-400 space-y-1.5">
            <div className="flex items-center gap-2 text-emerald-400 font-medium">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Identity verified · Approximate location protected (±300m)</span>
            </div>
            {safeHavens.length > 0 && (
              <div className="flex items-center justify-between text-zinc-300 pt-1">
                <span className="truncate">Safe Haven nearby: {safeHavens[0].name}</span>
                <button
                  onClick={() => {
                    onSelectHaven(safeHavens[0]);
                    setMutualMatchPulse(null);
                  }}
                  className="text-xs font-semibold text-[#C9A24D] hover:underline shrink-0 ml-2"
                >
                  Share Safe Haven
                </button>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={() => setMutualMatchPulse(null)}
              className="h-9 px-4 text-xs font-semibold text-zinc-400 hover:text-white cursor-pointer"
            >
              Keep Browsing
            </button>
            <button
              onClick={() => {
                onOpenDirectChat(mutualMatchPulse);
                setMutualMatchPulse(null);
              }}
              className="flex-1 h-9 px-4 text-xs font-black text-black bg-[#C9A24D] hover:bg-[#b58f3b] rounded-xl transition-all cursor-pointer shadow-md flex items-center justify-center gap-1.5 uppercase tracking-wider"
            >
              <MessageSquare className="w-3.5 h-3.5 fill-black" />
              <span>Message {mutualMatchPulse.peerName}</span>
            </button>
          </div>
        </div>
      )}

      {/* =========================================================================
          5. ENCOUNTER DISCOVERY LIST / FEED
         ========================================================================= */}
      {viewMode === 'feed' && (
        <div className="space-y-2.5">
          {filteredPulses.length === 0 ? (
            <div className="p-10 text-center rounded-2xl bg-[#11131a] border border-white/[0.08] space-y-3">
              <Compass className="w-8 h-8 text-zinc-500 mx-auto" />
              <h3 className="text-sm font-semibold text-white">No active pulses matching this window</h3>
              <p className="text-xs text-zinc-400 max-w-sm mx-auto">
                Be the first to communicate what you want in {userNeighborhood}.
              </p>
              <button
                onClick={() => {
                  hapticLight();
                  setIsSetIntentOpen(true);
                }}
                className="h-9 px-4 text-xs font-bold text-black bg-[#C9A24D] hover:bg-[#b58f3b] rounded-xl transition-colors cursor-pointer"
              >
                Set My Intent
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 sm:gap-3">
              {filteredPulses.map((pulse) => {
                const intent = getPulseIntent(pulse);
                const availability = getPulseAvailability(pulse);
                const compatibility = getCompatibility(intent);
                const isInterested = interestedPulseIds.has(pulse.id);
                const reliability = 96;

                return (
                  <div
                    key={pulse.id}
                    className="group bg-[#11131a] hover:bg-[#141620] border border-white/[0.08] hover:border-[#C9A24D]/40 rounded-2xl p-4 transition-all duration-150 flex flex-col justify-between shadow-sm relative overflow-hidden"
                  >
                    <div>
                      {/* Compatibility Banner (if active) */}
                      {compatibility && (
                        <div className="flex items-center gap-1.5 mb-2 text-[10px] font-mono font-bold text-[#C9A24D]">
                          <Sparkles className="w-3 h-3" />
                          <span>
                            {compatibility === 'MATCHING' ? 'MATCHING INTENT' : 'OPEN TO SIMILAR'}
                          </span>
                        </div>
                      )}

                      {/* Header: Name, Age, Distance & Intent */}
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-2.5">
                          <div className="w-10 h-10 rounded-xl bg-[#1c1f2b] border border-white/10 flex items-center justify-center text-sm font-black text-[#C9A24D] shrink-0">
                            {pulse.peerName.charAt(0)}
                          </div>

                          <div>
                            <div className="flex items-baseline gap-1.5">
                              <span className="text-sm font-bold text-white tracking-tight">
                                {pulse.peerName}, 32
                              </span>
                              <span className="text-[11px] font-mono text-zinc-400">
                                · ~{pulse.approxDistanceKm} km
                              </span>
                            </div>

                            {/* Active & Availability Status */}
                            <div className="flex items-center gap-2 text-[11px] text-zinc-400 mt-0.5">
                              <span className="flex items-center gap-1 text-emerald-400 font-semibold">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                ACTIVE NOW
                              </span>
                              <span>·</span>
                              <span className="text-zinc-300 font-medium">{availability}</span>
                            </div>
                          </div>
                        </div>

                        {/* Distinct Intent Callout */}
                        <div className="text-right shrink-0">
                          <span className="text-xs font-black tracking-wider uppercase text-[#C9A24D] font-sans">
                            {intent}
                          </span>
                        </div>
                      </div>

                      {/* Short headline quote */}
                      <div className="mt-2.5">
                        <p className="text-xs font-medium text-zinc-200 line-clamp-1 leading-snug">
                          "{pulse.title}"
                        </p>
                      </div>

                      {/* Cloaked Venue & Verification Badge */}
                      <div className="mt-2.5 pt-2 border-t border-white/[0.05] flex items-center justify-between text-[11px] text-zinc-400">
                        <div className="flex items-center gap-1 truncate max-w-[210px]">
                          <MapPin className="w-3 h-3 text-[#C9A24D] shrink-0" />
                          <span className="truncate">{pulse.venueName}</span>
                        </div>

                        <div className="flex items-center gap-1 text-emerald-400 font-mono shrink-0">
                          <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                          <span>Verified · {reliability}</span>
                        </div>
                      </div>
                    </div>

                    {/* Action Row: I'm Interested & Message */}
                    <div className="mt-3 pt-2.5 border-t border-white/[0.06] flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1 text-[10px] text-zinc-500 font-mono">
                        <Lock className="w-3 h-3 text-[#C9A24D]" />
                        <span>E2EE Swarm</span>
                      </div>

                      <div className="flex items-center gap-2">
                        {/* Primary Action: I'm Interested */}
                        <button
                          onClick={() => handleTapInterested(pulse)}
                          className={`h-8 px-3.5 text-xs font-bold rounded-xl transition-all duration-150 cursor-pointer flex items-center gap-1.5 active:scale-95 ${
                            isInterested
                              ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                              : 'bg-[#C9A24D] hover:bg-[#b58f3b] text-black shadow-sm'
                          }`}
                        >
                          {isInterested ? (
                            <>
                              <Check className="w-3.5 h-3.5" />
                              <span>Interest sent</span>
                            </>
                          ) : (
                            <>
                              <Zap className="w-3.5 h-3.5 fill-black" />
                              <span>I'm Interested</span>
                            </>
                          )}
                        </button>

                        {/* Secondary Action: Message */}
                        <button
                          onClick={() => onOpenDirectChat(pulse)}
                          className="h-8 px-3 text-xs font-medium text-zinc-300 hover:text-white bg-[#1c1f2b] hover:bg-[#252838] border border-white/10 rounded-xl transition-colors cursor-pointer"
                        >
                          Message
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
          6. MAP VIEW (INTENT & PRIVACY FOCUSED)
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
              <span>Locations randomized ~300m for member safety</span>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          7. TACTICAL RADAR VIEW
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
                    <span className="text-[11px] font-bold text-[#C9A24D] uppercase">
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
          8. LIGHTWEIGHT "SET MY INTENT" BOTTOM SHEET / MODAL
         ========================================================================= */}
      <SetIntentSheet
        isOpen={isSetIntentOpen}
        onClose={() => setIsSetIntentOpen(false)}
        onSaveIntent={handleSaveIntent}
        existingIntent={activeUserIntent}
        safeHavens={safeHavens}
        userNeighborhood={userNeighborhood}
      />
    </div>
  );
};
