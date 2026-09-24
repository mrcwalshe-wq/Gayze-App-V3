import React, { useState, useMemo, useEffect } from 'react';
import { Pulse, SafeHaven, LocationPrivacy } from '../types';
import { PrivacyGeographicMap } from './PrivacyGeographicMap';
import { RadarMap } from './RadarMap';
import { IntentMode, IntentTimingMode } from './IntentMode';
import { SetIntentSheet, UserActiveIntent, EncounterIntentType } from './SetIntentSheet';
import { 
  Radio, 
  Map as MapIcon, 
  List, 
  ShieldCheck, 
  Lock, 
  Clock, 
  MapPin, 
  X,
  Zap,
  Compass,
  CheckCircle2,
  Sparkles,
  Check,
  Calendar,
  MessageSquare
} from 'lucide-react';
import { 
  hapticLight, 
  hapticSensitiveAction, 
  triggerVibration 
} from '../services/hapticService';

export type AvailabilityWindow = 'now' | '2h' | 'tonight';
export type LaterTimeframe = 'tonight' | 'tomorrow' | 'weekend' | 'choose';

interface RightNowViewProps {
  pulses: Pulse[];
  safeHavens: SafeHaven[];
  userNeighborhood: string;
  privacySetting?: LocationPrivacy;
  onOpenDirectChat: (pulse: Pulse) => void;
  onSelectHaven: (haven: SafeHaven) => void;
  onCreatePulse: (newPulse: Omit<Pulse, 'id' | 'createdAt' | 'expiresAt'>) => void;
}

/**
 * Centralized presentation mapping helper:
 * Maps pulses deterministically to the high-intent encounter vocabulary
 * without exposing demo/pseudo-random logic in the UI.
 */
export const getEncounterIntent = (pulse: Pulse): EncounterIntentType => {
  // 1. Curated peer mapping for baseline prototype pulses
  const CURATED_INTENTS: Record<string, EncounterIntentType> = {
    pulse_1: 'Meet',
    pulse_2: 'Group',
    pulse_3: 'Date',
    pulse_4: 'Drinks',
    pulse_5: 'Hookup',
  };
  if (CURATED_INTENTS[pulse.id]) {
    return CURATED_INTENTS[pulse.id];
  }

  // 2. Check tags (e.g. from user-created pulses)
  if (pulse.tags && pulse.tags.length > 0) {
    const validIntents: EncounterIntentType[] = ['Meet', 'Hookup', 'Date', 'Drinks', 'Chat', 'Group'];
    for (const tag of pulse.tags) {
      const match = validIntents.find((i) => i.toLowerCase() === tag.toLowerCase());
      if (match) return match;
    }
  }

  // 3. Centralized category fallback
  switch (pulse.activityCategory) {
    case 'drinks':
      return 'Drinks';
    case 'chill':
      return 'Hookup';
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

  // 3. Filtering States
  const [selectedIntentChip, setSelectedIntentChip] = useState<EncounterIntentType | 'All'>('All');
  const [availabilityWindow, setAvailabilityWindow] = useState<AvailabilityWindow>('now');
  const [laterTimeframe, setLaterTimeframe] = useState<LaterTimeframe>('tonight');
  const [maxDistanceKm, setMaxDistanceKm] = useState<number>(5);
  const [viewMode, setViewMode] = useState<'feed' | 'map' | 'radar'>('feed');

  // 4. "I'm Interested" & Mutual Match State
  const [interestedPulseIds, setInterestedPulseIds] = useState<Set<string>>(new Set());
  const [mutualMatchPulse, setMutualMatchPulse] = useState<Pulse | null>(null);
  const [selectedPulseForDetail, setSelectedPulseForDetail] = useState<Pulse | null>(null);

  // 5. Countdown timer for active user intent
  const [remainingMinutes, setRemainingMinutes] = useState<number>(0);

  useEffect(() => {
    if (!activeUserIntent) return;

    const updateRemaining = () => {
      const diff = Math.max(0, Math.round((activeUserIntent.expiresAt - Date.now()) / (1000 * 60)));
      setRemainingMinutes(diff);
      if (diff <= 0) {
        setActiveUserIntent(null);
        setStatusMessage('Intent ended');
        setTimeout(() => setStatusMessage(null), 3000);
      }
    };

    updateRemaining();
    const interval = setInterval(updateRemaining, 30000);
    return () => clearInterval(interval);
  }, [activeUserIntent]);

  // Compatibility helper: deterministic check without artificial percentage score
  const getCompatibility = (peerIntent: EncounterIntentType): 'MATCHING' | 'SIMILAR' | null => {
    const myIntent = activeUserIntent ? activeUserIntent.intent : (selectedIntentChip !== 'All' ? selectedIntentChip : null);
    if (!myIntent) return null;

    if (myIntent === peerIntent) {
      return 'MATCHING';
    }

    const hookupCluster: EncounterIntentType[] = ['Hookup', 'Meet', 'Drinks'];
    const dateCluster: EncounterIntentType[] = ['Date', 'Drinks', 'Chat', 'Meet'];
    const groupCluster: EncounterIntentType[] = ['Group', 'Chat', 'Meet'];

    if (hookupCluster.includes(myIntent) && hookupCluster.includes(peerIntent)) return 'SIMILAR';
    if (dateCluster.includes(myIntent) && dateCluster.includes(peerIntent)) return 'SIMILAR';
    if (groupCluster.includes(myIntent) && groupCluster.includes(peerIntent)) return 'SIMILAR';

    return null;
  };

  // Filter and prioritize pulses deterministically
  const filteredPulses = useMemo(() => {
    let list = pulses.filter((p) => {
      const intent = getEncounterIntent(p);
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
        // 'later' mode: planned encounters
        if (laterTimeframe === 'tonight') {
          return p.durationHours >= 2 || p.title.toLowerCase().includes('tonight') || p.tags.some(t => t.toLowerCase().includes('casual') || t.toLowerCase().includes('quiet'));
        }
        if (laterTimeframe === 'tomorrow') {
          return p.durationHours >= 1.5;
        }
        return true;
      }
    });

    // When user's intent is active, prioritize compatible intent deterministically
    if (activeUserIntent) {
      list.sort((a, b) => {
        const compA = getCompatibility(getEncounterIntent(a));
        const compB = getCompatibility(getEncounterIntent(b));

        const scoreA = compA === 'MATCHING' ? 3 : compA === 'SIMILAR' ? 2 : 1;
        const scoreB = compB === 'MATCHING' ? 3 : compB === 'SIMILAR' ? 2 : 1;

        if (scoreB !== scoreA) return scoreB - scoreA;
        return a.approxDistanceKm - b.approxDistanceKm;
      });
    }

    return list;
  }, [pulses, selectedIntentChip, maxDistanceKm, availabilityWindow, intentTimingMode, laterTimeframe, activeUserIntent]);

  // Active counts for the header hierarchy
  const activeNearbyCount = pulses.length || 12;
  const openToMeetingCount = pulses.filter((p) => {
    const intent = getEncounterIntent(p);
    return intent === 'Meet' || intent === 'Hookup' || intent === 'Drinks';
  }).length || 4;

  // Handle saving intent from bottom sheet
  const handleSaveIntent = (intentData: UserActiveIntent) => {
    setActiveUserIntent(intentData);

    const categoryMap: Record<EncounterIntentType, Pulse['activityCategory']> = {
      Meet: 'coffee',
      Hookup: 'chill',
      Date: 'walk',
      Drinks: 'drinks',
      Chat: 'culture',
      Group: 'active',
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
      description: `Available for ${intentData.intent.toLowerCase()} near ${intentData.area}.`,
      activityCategory: categoryMap[intentData.intent],
      venueName: intentData.area,
      neighborhood: userNeighborhood,
      approxDistanceKm: 0.1,
      jitterMeters: 250,
      lat: latJitter,
      lng: lngJitter,
      durationHours: durationNum,
      tags: [intentData.intent, intentData.when],
      safeHavenVenue: Boolean(intentData.isNearSafeHaven),
    });

    setStatusMessage(`● Intent Live: ${intentData.intent.toUpperCase()}`);
    setTimeout(() => setStatusMessage(null), 3000);
  };

  // End active intent
  const handleEndIntent = () => {
    hapticSensitiveAction();
    setActiveUserIntent(null);
    setStatusMessage('Intent ended');
    setTimeout(() => setStatusMessage(null), 2500);
  };

  // Tap "Interested"
  const handleTapInterested = (pulse: Pulse) => {
    hapticLight();
    const nextSet = new Set(interestedPulseIds);
    const isNew = !nextSet.has(pulse.id);
    nextSet.add(pulse.id);
    setInterestedPulseIds(nextSet);

    // Mutual match trigger on compatible profile
    const isCompatible = getCompatibility(getEncounterIntent(pulse)) !== null || pulse.id === 'pulse_1' || pulse.id === 'pulse_5';
    if (isNew && isCompatible) {
      triggerVibration([40, 60, 100]);
      setTimeout(() => {
        setMutualMatchPulse(pulse);
      }, 300);
    }
  };

  const handleBroadcastHere = (venueName: string) => {
    setIsSetIntentOpen(true);
  };

  const formatRemainingTime = (mins: number) => {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  };

  const isRightNowMode = intentTimingMode === 'right_now';

  return (
    <div className="relative space-y-4 max-w-xl mx-auto">
      {/* =========================================================================
          1. RESTRAINED PURPLE ATMOSPHERE
          Radiating from the live discovery center, dark edges, subtly subdued on LATER
         ========================================================================= */}
      <div
        className={`pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 w-full max-w-lg h-[480px] rounded-full blur-3xl transition-opacity duration-700 ease-out z-0 ${
          isRightNowMode ? 'opacity-35' : 'opacity-15'
        }`}
        style={{
          background: 'radial-gradient(ellipse at 50% 35%, rgba(111, 60, 195, 0.45) 0%, rgba(111, 60, 195, 0.12) 50%, rgba(11, 12, 16, 0) 75%)',
        }}
        aria-hidden="true"
      />

      {/* Subtle Toast / Status Notification */}
      {statusMessage && (
        <div className="relative z-20 bg-[#141620] border border-[#C9A24D]/40 text-white text-xs px-3.5 py-2 rounded-xl flex items-center justify-between shadow-lg animate-in fade-in duration-150">
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
          2. MOBILE-FIRST TOP HIERARCHY (~390px):
          RIGHT NOW
          IntentMode™
          [ RIGHT NOW –––– LATER ]
          12 active nearby · 4 open to meeting
          AVAILABILITY BUTTON (OFF / ACTIVE)
         ========================================================================= */}
      <div className="relative z-10 space-y-3">
        {/* Header Title & Protection Indicator */}
        <div className="flex items-center justify-between px-1">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-black tracking-tight text-white uppercase font-sans">
                RIGHT NOW
              </h1>
              {isRightNowMode && (
                <span className="w-2 h-2 rounded-full bg-[#C9A24D] shadow-[0_0_8px_#C9A24D] animate-pulse" />
              )}
            </div>
            <p className="text-[11px] text-zinc-400 font-medium">
              Real intent. Real time. {userNeighborhood}
            </p>
          </div>
          <div className="flex items-center gap-1.5 text-[11px] font-mono text-zinc-400">
            <ShieldCheck className="w-3.5 h-3.5 text-[#C9A24D]" />
            <span>Cloaked ±300m</span>
          </div>
        </div>

        {/* IntentMode™ Signature Control */}
        <IntentMode
          mode={intentTimingMode}
          onChangeMode={(newMode) => setIntentTimingMode(newMode)}
          activeCount={activeNearbyCount}
          plannedCount={6}
        />

        {/* Proximity / Intent Summary Stats */}
        <div className="flex items-center justify-between text-xs text-zinc-400 px-1 font-mono">
          <span className="font-semibold text-zinc-300">
            {activeNearbyCount} active nearby
          </span>
          <span className="text-zinc-600">·</span>
          <span className="font-bold text-[#C9A24D]">
            {openToMeetingCount} open to meeting
          </span>
        </div>

        {/* =======================================================================
            3. AVAILABILITY BUTTON COLOUR & ACTIVE TREATMENT:
            OFF STATE: Premium neutral/dark with subtle amber edge
            ACTIVE STATE: Amber + purple live treatment with ● LIVE NOW
           ======================================================================= */}
        {activeUserIntent ? (
          /* ACTIVE STATE: Amber + Purple live treatment */
          <div className="space-y-1.5 animate-in fade-in duration-200">
            <div className="relative group">
              {/* Purple atmospheric halo behind active button */}
              <div className="absolute -inset-1 rounded-2xl bg-[#6F3CC3]/30 blur-md pointer-events-none" />

              <div className="relative w-full h-12 bg-gradient-to-r from-[#C9A24D] via-[#deb85e] to-[#C9A24D] border border-[#C9A24D] rounded-xl shadow-[0_0_22px_rgba(111,60,195,0.4)] flex items-center justify-between px-4">
                <div className="flex items-center gap-2.5 min-w-0">
                  {/* Subtle animated live indicator */}
                  <span className="relative flex h-2.5 w-2.5 shrink-0">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-black opacity-50"></span>
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-black"></span>
                  </span>
                  <span className="text-xs sm:text-sm font-black tracking-widest text-black uppercase font-sans shrink-0">
                    ● LIVE NOW
                  </span>
                  <span className="text-xs font-bold text-black/80 font-mono truncate">
                    · {activeUserIntent.intent.toUpperCase()}
                  </span>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      hapticLight();
                      setIsSetIntentOpen(true);
                    }}
                    className="h-7 px-2.5 text-[11px] font-black text-black bg-black/10 hover:bg-black/20 rounded-lg transition-colors cursor-pointer uppercase font-mono"
                  >
                    Change
                  </button>
                  <button
                    type="button"
                    onClick={handleEndIntent}
                    className="h-7 px-2.5 text-[11px] font-black text-black bg-black/10 hover:bg-black/20 rounded-lg transition-colors cursor-pointer uppercase font-mono"
                  >
                    End
                  </button>
                </div>
              </div>
            </div>

            {/* 4. Subordinate Compact Availability Status Indicator */}
            <div className="flex items-center justify-between px-1 text-[11px] font-mono text-zinc-400">
              <div className="flex items-center gap-1.5">
                <span className="text-[#C9A24D] font-bold">● LIVE</span>
                <span className="text-zinc-600">·</span>
                <span className="text-white font-bold">{activeUserIntent.intent} · NOW</span>
                <span className="text-zinc-600">·</span>
                <span className="text-zinc-300">{formatRemainingTime(remainingMinutes)} remaining</span>
              </div>
              <span className="text-[10px] text-zinc-500 font-sans hidden sm:inline">
                Approximate ±300m
              </span>
            </div>
          </div>
        ) : (
          /* OFF STATE: Premium neutral/dark with subtle amber edge */
          <button
            type="button"
            onClick={() => {
              hapticLight();
              setIsSetIntentOpen(true);
            }}
            className="w-full h-12 bg-[#12131a] hover:bg-[#181a24] active:scale-[0.99] border border-[#C9A24D]/35 hover:border-[#C9A24D]/75 rounded-xl transition-all duration-200 cursor-pointer flex items-center justify-center gap-2 group shadow-sm"
          >
            <span className="w-2 h-2 rounded-full bg-[#C9A24D]/60 group-hover:bg-[#C9A24D] transition-colors" />
            <span className="text-xs sm:text-sm font-black tracking-widest text-zinc-100 group-hover:text-white uppercase font-sans">
              I’M AVAILABLE
            </span>
          </button>
        )}
      </div>

      {/* =========================================================================
          5. SURROUNDING CONTROLS & POPPING SELECTED INTENT:
          Selected intent has strong typography, amber foreground, subtle purple backing,
          slightly increased scale, restrained glow, and excellent contrast.
         ========================================================================= */}
      <div className="relative z-10 bg-[#101118] border border-white/[0.08] rounded-2xl p-3 sm:p-3.5 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          {/* Availability / When Segment */}
          {isRightNowMode ? (
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-1 shrink-0 font-mono">
                <Clock className="w-3 h-3 text-[#C9A24D]" />
                <span>When:</span>
              </span>

              <div className="flex items-center p-0.5 bg-[#07080b] rounded-xl border border-white/10">
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
                      type="button"
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
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-1 shrink-0 font-mono">
                <Calendar className="w-3 h-3 text-[#6F3CC3]" />
                <span>When?</span>
              </span>

              <div className="flex items-center p-0.5 bg-[#07080b] rounded-xl border border-white/10">
                {(
                  [
                    { id: 'tonight', label: 'Tonight' },
                    { id: 'tomorrow', label: 'Tomorrow' },
                    { id: 'weekend', label: 'This weekend' },
                    { id: 'choose', label: 'Choose time' },
                  ] as const
                ).map((tab) => {
                  const isActive = laterTimeframe === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => {
                        hapticLight();
                        setLaterTimeframe(tab.id);
                      }}
                      className={`h-7 px-2.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${
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

          {/* Distance & View Modes */}
          <div className="flex items-center gap-2 self-end sm:self-auto">
            <select
              value={maxDistanceKm}
              onChange={(e) => setMaxDistanceKm(Number(e.target.value))}
              aria-label="Filter distance"
              className="h-7 bg-[#07080b] border border-white/10 rounded-lg px-2 text-xs text-zinc-300 focus:outline-none focus:border-[#C9A24D] cursor-pointer"
            >
              <option value={1}>&lt; 1 km</option>
              <option value={2}>&lt; 2 km</option>
              <option value={5}>&lt; 5 km</option>
              <option value={20}>Any distance</option>
            </select>

            <div className="flex items-center p-0.5 bg-[#07080b] rounded-lg border border-white/10">
              <button
                type="button"
                onClick={() => setViewMode('feed')}
                aria-label="List view"
                className={`h-6 px-2.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1 cursor-pointer ${
                  viewMode === 'feed'
                    ? 'bg-[#181a24] text-white font-semibold'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                <List className="w-3 h-3" />
                <span className="hidden sm:inline">List</span>
              </button>

              <button
                type="button"
                onClick={() => setViewMode('map')}
                aria-label="Map view"
                className={`h-6 px-2.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1 cursor-pointer ${
                  viewMode === 'map'
                    ? 'bg-[#181a24] text-white font-semibold'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                <MapIcon className="w-3 h-3" />
                <span className="hidden sm:inline">Map</span>
              </button>

              <button
                type="button"
                onClick={() => setViewMode('radar')}
                aria-label="Radar view"
                className={`h-6 px-2 rounded-md text-xs font-medium transition-colors flex items-center gap-1 cursor-pointer ${
                  viewMode === 'radar'
                    ? 'bg-[#181a24] text-white font-semibold'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                <Radio className="w-3 h-3" />
                <span className="hidden sm:inline">Radar</span>
              </button>
            </div>
          </div>
        </div>

        {/* SIGNATURE INTENT SELECTOR (Selected intent pops with purple backing & amber foreground) */}
        <div className="pt-2 border-t border-white/[0.06] space-y-1.5">
          <div className="flex items-center justify-between text-[10px] font-mono text-zinc-400 uppercase tracking-wider px-0.5">
            <span>Intent Selection</span>
            {selectedIntentChip !== 'All' && (
              <span className="text-[#C9A24D] font-bold">
                Filtered: {selectedIntentChip}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-1">
            {(['All', 'Meet', 'Hookup', 'Date', 'Drinks', 'Chat', 'Group'] as (EncounterIntentType | 'All')[]).map((intent) => {
              const isSelected = selectedIntentChip === intent;
              return (
                <button
                  key={intent}
                  type="button"
                  onClick={() => {
                    hapticLight();
                    setSelectedIntentChip(intent);
                  }}
                  className={`h-8 sm:h-9 px-3.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all duration-200 cursor-pointer flex items-center gap-1.5 border relative ${
                    isSelected
                      ? 'scale-[1.04] bg-gradient-to-b from-[#6F3CC3]/25 via-[#1c1628] to-[#12111b] text-[#C9A24D] border-[#C9A24D] shadow-[0_0_18px_rgba(111,60,195,0.4),0_0_8px_rgba(201,162,77,0.3)] font-black uppercase tracking-wider z-10'
                      : 'bg-[#08090e] text-zinc-400 border-white/[0.07] hover:text-zinc-200 hover:border-white/20'
                  }`}
                >
                  {/* Subtle active glow dot on selected */}
                  {isSelected && (
                    <span className="w-1.5 h-1.5 rounded-full bg-[#C9A24D] shadow-[0_0_6px_#C9A24D]" />
                  )}
                  {intent === 'Hookup' && !isSelected && (
                    <span className="w-1.5 h-1.5 rounded-full bg-zinc-600" />
                  )}
                  <span>{intent}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* =========================================================================
          6. MUTUAL INTEREST / MATCH CARD (PURE GAYZE PALETTE, NO GREEN)
         ========================================================================= */}
      {mutualMatchPulse && (
        <div className="relative z-10 p-4 bg-[#141620] border border-[#C9A24D] rounded-2xl shadow-[0_0_30px_rgba(111,60,195,0.4)] animate-in fade-in zoom-in-95 duration-200 space-y-3">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-black tracking-widest text-[#C9A24D] uppercase font-mono">
                  IT’S A MATCH
                </span>
                <span className="text-zinc-500">·</span>
                <span className="text-xs text-zinc-300 font-medium">Both interested</span>
              </div>
              <h3 className="text-base font-black text-white tracking-wide uppercase mt-0.5 font-sans">
                {getEncounterIntent(mutualMatchPulse)} · NOW
              </h3>
              <p className="text-xs text-zinc-300 mt-1">
                You and {mutualMatchPulse.peerName} expressed mutual interest.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setMutualMatchPulse(null)}
              className="w-7 h-7 rounded-lg text-zinc-400 hover:text-white flex items-center justify-center cursor-pointer"
              aria-label="Dismiss match banner"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="p-2.5 bg-[#0a0b10] rounded-xl border border-white/[0.06] text-[11px] text-zinc-400 space-y-1.5">
            <div className="flex items-center gap-2 text-[#C9A24D] font-medium font-mono">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Identity verified · Approximate location protected (±300m)</span>
            </div>
            {safeHavens.length > 0 && (
              <div className="flex items-center justify-between text-zinc-300 pt-1">
                <span className="truncate">Safe Haven nearby: {safeHavens[0].name}</span>
                <button
                  type="button"
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
              type="button"
              onClick={() => setMutualMatchPulse(null)}
              className="h-9 px-4 text-xs font-semibold text-zinc-400 hover:text-white cursor-pointer"
            >
              Keep Browsing
            </button>
            <button
              type="button"
              onClick={() => {
                onOpenDirectChat(mutualMatchPulse);
                setMutualMatchPulse(null);
              }}
              className="flex-1 h-9 px-4 text-xs font-black text-black bg-[#C9A24D] hover:bg-[#b58f3b] rounded-xl transition-all cursor-pointer shadow-md flex items-center justify-center gap-1.5 uppercase tracking-wider font-sans"
            >
              <MessageSquare className="w-3.5 h-3.5 fill-black" />
              <span>Message {mutualMatchPulse.peerName}</span>
            </button>
          </div>
        </div>
      )}

      {/* =========================================================================
          7. LIVE DISCOVERY CARDS:
          WHO → INTENT → WHEN → DISTANCE → TRUST → ACTION
         ========================================================================= */}
      {viewMode === 'feed' && (
        <div className="relative z-10 space-y-2.5">
          {filteredPulses.length === 0 ? (
            <div className="p-8 text-center rounded-2xl bg-[#101118] border border-white/[0.08] space-y-3">
              <Compass className="w-8 h-8 text-zinc-500 mx-auto" />
              <h3 className="text-sm font-semibold text-white">
                {isRightNowMode
                  ? 'No active encounters matching this window'
                  : 'No planned connections posted yet'}
              </h3>
              <p className="text-xs text-zinc-400 max-w-sm mx-auto">
                Communicate what you're open to in {userNeighborhood}.
              </p>
              <button
                type="button"
                onClick={() => {
                  hapticLight();
                  setIsSetIntentOpen(true);
                }}
                className="h-9 px-4 text-xs font-bold text-black bg-[#C9A24D] hover:bg-[#b58f3b] rounded-xl transition-colors cursor-pointer"
              >
                I’M AVAILABLE
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              {filteredPulses.map((pulse) => {
                const intent = getEncounterIntent(pulse);
                const compatibility = getCompatibility(intent);
                const isInterested = interestedPulseIds.has(pulse.id);

                return (
                  <div
                    key={pulse.id}
                    className="group bg-[#101118] hover:bg-[#141620] border border-white/[0.08] hover:border-[#C9A24D]/40 rounded-2xl p-4 transition-all duration-200 flex flex-col justify-between shadow-sm relative overflow-hidden"
                  >
                    <div>
                      {/* Compatibility Indicator (deterministic, human) */}
                      {compatibility && (
                        <div className="flex items-center gap-1.5 mb-2 text-[10px] font-mono font-bold text-[#C9A24D]">
                          <Sparkles className="w-3 h-3" />
                          <span>
                            {compatibility === 'MATCHING' ? 'MATCHING INTENT' : 'OPEN TO SIMILAR'}
                          </span>
                        </div>
                      )}

                      {/* 1. WHO: Avatar & Name + Age */}
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-2.5">
                          <div className="w-11 h-11 rounded-xl bg-[#181a24] border border-white/10 flex items-center justify-center text-sm font-black text-[#C9A24D] shrink-0 font-sans shadow-inner">
                            {pulse.peerName.charAt(0)}
                          </div>

                          <div>
                            <span className="text-sm sm:text-base font-bold text-white tracking-tight">
                              {pulse.peerName} · 34
                            </span>
                            {/* Proximity & Live dot */}
                            <div className="flex items-center gap-2 text-[11px] text-zinc-400 mt-0.5 font-mono">
                              <span className="flex items-center gap-1 text-[#C9A24D] font-semibold">
                                <span className="w-1.5 h-1.5 rounded-full bg-[#C9A24D] animate-pulse" />
                                {isRightNowMode ? 'Active now' : 'Upcoming'}
                              </span>
                              <span>·</span>
                              <span>{pulse.approxDistanceKm} km</span>
                            </div>
                          </div>
                        </div>

                        {/* 2. INTENT: Prominently displayed */}
                        <div className="text-right shrink-0">
                          <span className="inline-block px-2.5 py-1 rounded-lg bg-[#181424] border border-[#6F3CC3]/40 text-[#C9A24D] text-xs font-black tracking-wider uppercase font-sans shadow-[0_0_10px_rgba(111,60,195,0.25)]">
                            {intent}
                          </span>
                        </div>
                      </div>

                      {/* 3. WHEN: Availability window */}
                      <div className="mt-3">
                        <p className="text-xs font-medium text-zinc-200">
                          {isRightNowMode ? 'Available now · ~2 hrs' : 'Available for tonight'}
                        </p>
                      </div>

                      {/* 4. TRUST: Protected Area & Verified */}
                      <div className="mt-2.5 pt-2 border-t border-white/[0.05] flex items-center justify-between text-[11px] text-zinc-400">
                        <div className="flex items-center gap-1 truncate max-w-[210px]">
                          <MapPin className="w-3 h-3 text-[#C9A24D] shrink-0" />
                          <span className="truncate">{pulse.venueName}</span>
                        </div>

                        <div className="flex items-center gap-1 text-[#C9A24D] font-mono shrink-0">
                          <CheckCircle2 className="w-3 h-3 text-[#C9A24D]" />
                          <span>Verified · 94</span>
                        </div>
                      </div>
                    </div>

                    {/* 5. ACTION: [ Interested ] [ Message ] */}
                    <div className="mt-3.5 pt-2.5 border-t border-white/[0.06] flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1 text-[10px] text-zinc-500 font-mono">
                        <Lock className="w-3 h-3 text-[#C9A24D]" />
                        <span>E2EE Swarm</span>
                      </div>

                      <div className="flex items-center gap-2">
                        {/* Primary Action: Interested */}
                        <button
                          type="button"
                          onClick={() => handleTapInterested(pulse)}
                          className={`h-8 px-3.5 text-xs font-bold rounded-xl transition-all duration-150 cursor-pointer flex items-center gap-1.5 active:scale-95 ${
                            isInterested
                              ? 'bg-[#181a24] text-[#C9A24D] border border-[#C9A24D]/40'
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
                              <span>Interested</span>
                            </>
                          )}
                        </button>

                        {/* Secondary Action: Message */}
                        <button
                          type="button"
                          onClick={() => onOpenDirectChat(pulse)}
                          className="h-8 px-3 text-xs font-medium text-zinc-300 hover:text-white bg-[#181a24] hover:bg-[#202330] border border-white/10 rounded-xl transition-colors cursor-pointer"
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
          8. MAP VIEW (SUBTLE PURPLE ATMOSPHERIC HALO, READABLE)
         ========================================================================= */}
      {viewMode === 'map' && (
        <div className="relative z-10 space-y-3">
          <div className="relative rounded-2xl overflow-hidden shadow-[0_0_30px_rgba(111,60,195,0.2)] border border-white/10">
            <PrivacyGeographicMap
              pulses={filteredPulses}
              safeHavens={safeHavens}
              userNeighborhood={userNeighborhood}
              privacySetting={privacySetting}
              onOpenDirectChat={onOpenDirectChat}
              onSelectHaven={onSelectHaven}
              onBroadcastHere={handleBroadcastHere}
            />
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-3.5 py-2.5 bg-[#101118] border border-white/10 rounded-xl text-xs text-zinc-400">
            <div className="flex items-center gap-2">
              <span className="text-zinc-200 font-semibold">{filteredPulses.length} real-time encounters active</span>
              <span>·</span>
              <span>{safeHavens.length} safe meeting spots</span>
            </div>

            <div className="text-[11px] text-zinc-400 flex items-center gap-1 font-mono">
              <ShieldCheck className="w-3.5 h-3.5 text-[#C9A24D]" />
              <span>Cloaked ~300m</span>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          9. TACTICAL RADAR VIEW
         ========================================================================= */}
      {viewMode === 'radar' && (
        <div className="relative z-10 space-y-4">
          <div className="relative rounded-2xl overflow-hidden shadow-[0_0_30px_rgba(111,60,195,0.2)] border border-white/10">
            <RadarMap
              pulses={filteredPulses}
              safeHavens={safeHavens}
              userNeighborhood={userNeighborhood}
              onSelectPulse={(p) => setSelectedPulseForDetail(p)}
              onSelectHaven={(h) => onSelectHaven(h)}
            />
          </div>

          {selectedPulseForDetail && (
            <div className="p-4 bg-[#101118] border border-white/10 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4 animate-in fade-in">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-[#1a1b24] border border-white/10 flex items-center justify-center font-bold text-[#C9A24D] shrink-0">
                  {selectedPulseForDetail.peerName.charAt(0)}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-white">{selectedPulseForDetail.peerName}</span>
                    <span className="text-[11px] font-bold text-[#C9A24D] uppercase font-mono">
                      {getEncounterIntent(selectedPulseForDetail)}
                    </span>
                  </div>
                  <h4 className="text-xs font-semibold text-zinc-200 mt-0.5">{selectedPulseForDetail.title}</h4>
                  <div className="text-[11px] text-zinc-400 mt-1 flex items-center gap-1.5 font-mono">
                    <MapPin className="w-3 h-3 text-[#C9A24D]" />
                    <span>{selectedPulseForDetail.venueName}</span>
                    <span>·</span>
                    <span>~{selectedPulseForDetail.approxDistanceKm} km</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setSelectedPulseForDetail(null)}
                  className="px-3 py-1.5 text-xs text-zinc-400 hover:text-white cursor-pointer"
                >
                  Dismiss
                </button>
                <button
                  type="button"
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
          10. REFINED "SET YOUR INTENT" BOTTOM SHEET / MODAL
         ========================================================================= */}
      <SetIntentSheet
        isOpen={isSetIntentOpen}
        onClose={() => setIsSetIntentOpen(false)}
        onSaveIntent={handleSaveIntent}
        existingIntent={activeUserIntent}
        safeHavens={safeHavens}
        userNeighborhood={userNeighborhood}
        defaultWhen={isRightNowMode ? 'Now' : 'Tonight'}
      />
    </div>
  );
};
