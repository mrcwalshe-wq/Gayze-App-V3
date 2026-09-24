import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Pulse, SafeHaven, LocationPrivacy } from '../types';
import { PrivacyGeographicMap } from './PrivacyGeographicMap';
import { RadarMap } from './RadarMap';
import { IntentMode, IntentTimingMode } from './IntentMode';
import { SetIntentSheet, UserActiveIntent, EncounterIntentType } from './SetIntentSheet';
import { 
  Radio, 
  Map as MapIcon, 
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
export type MapDisplayType = 'map' | 'radar';

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

  // 4. Map / Radar Display Toggle (Both remain embedded in RIGHT NOW)
  const [mapDisplayType, setMapDisplayType] = useState<MapDisplayType>('map');
  const mapSectionRef = useRef<HTMLDivElement>(null);

  // 5. "I'm Interested" & Mutual Match State
  const [interestedPulseIds, setInterestedPulseIds] = useState<Set<string>>(new Set());
  const [mutualMatchPulse, setMutualMatchPulse] = useState<Pulse | null>(null);
  const [selectedPulseForDetail, setSelectedPulseForDetail] = useState<Pulse | null>(null);

  // 6. Countdown timer for active user intent
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

  const scrollToMap = () => {
    hapticLight();
    mapSectionRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const isRightNowMode = intentTimingMode === 'right_now';

  return (
    <div className="relative space-y-4 max-w-xl mx-auto px-1 sm:px-0 pb-12">
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
            type="button"
            onClick={() => setStatusMessage(null)}
            className="text-zinc-400 hover:text-white text-xs cursor-pointer p-1"
            aria-label="Dismiss message"
          >
            ✕
          </button>
        </div>
      )}

      {/* =========================================================================
          2. HIERARCHY LEVEL 1:
          RIGHT NOW
          IntentMode™
          [ RIGHT NOW –––– LATER ]
          12 active nearby · 4 open to meeting
          AVAILABILITY BUTTON (OFF / ACTIVE with RESPONSIVE MOBILE ACTIONS)
         ========================================================================= */}
      <div className="relative z-10 space-y-3">
        {/* Header Title & Protection Indicator */}
        <div className="flex items-center justify-between px-1">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl sm:text-2xl font-black tracking-tight text-white uppercase font-sans">
                RIGHT NOW
              </h1>
              {isRightNowMode && (
                <span className="w-2 h-2 rounded-full bg-[#C9A24D] shadow-[0_0_8px_#C9A24D] animate-pulse" />
              )}
            </div>
            <p className="text-[11px] sm:text-xs text-zinc-400 font-medium">
              Real intent. Real time. {userNeighborhood}
            </p>
          </div>
          <button
            type="button"
            onClick={scrollToMap}
            className="flex items-center gap-1.5 text-[11px] font-mono text-[#C9A24D] hover:underline cursor-pointer bg-[#141620] border border-white/10 px-2.5 py-1 rounded-lg"
          >
            <MapIcon className="w-3.5 h-3.5" />
            <span>View Map</span>
          </button>
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
            3. AVAILABILITY BUTTON RESPONSIVE MOBILE ACTIONS:
            OFF STATE: Premium neutral/dark with subtle amber edge
            ACTIVE STATE:
            ┌───────────────────────────┐
            │       ● LIVE NOW          │
            └───────────────────────────┘
            ┌──────────────┐ ┌──────────┐
            │    CHANGE    │ │   END    │
            └──────────────┘ └──────────┘
           ======================================================================= */}
        {activeUserIntent ? (
          /* ACTIVE STATE: Clean responsive layout with zero button collisions */
          <div className="space-y-2 animate-in fade-in duration-200">
            {/* Dominant Amber + Purple Live Banner */}
            <div className="relative group">
              <div className="absolute -inset-1 rounded-2xl bg-[#6F3CC3]/30 blur-md pointer-events-none" />

              <div className="relative w-full h-12 min-h-[48px] bg-gradient-to-r from-[#C9A24D] via-[#deb85e] to-[#C9A24D] border border-[#C9A24D] rounded-xl shadow-[0_0_22px_rgba(111,60,195,0.4)] flex items-center justify-between px-4">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="relative flex h-2.5 w-2.5 shrink-0">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-black opacity-50"></span>
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-black"></span>
                  </span>
                  <span className="text-xs sm:text-sm font-black tracking-widest text-black uppercase font-sans shrink-0">
                    ● LIVE NOW
                  </span>
                  <span className="text-xs font-black text-black/85 uppercase font-sans truncate">
                    · {activeUserIntent.intent}
                  </span>
                </div>

                <span className="text-xs font-mono font-bold text-black/90 shrink-0 bg-black/10 px-2 py-0.5 rounded">
                  {formatRemainingTime(remainingMinutes)}
                </span>
              </div>
            </div>

            {/* Responsive Secondary Actions Grid (Minimum 44x44px touch targets) */}
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  hapticLight();
                  setIsSetIntentOpen(true);
                }}
                className="h-11 min-h-[44px] px-3 text-xs font-bold text-zinc-100 hover:text-white bg-[#141622] hover:bg-[#1a1d2e] border border-[#C9A24D]/40 rounded-xl transition-all cursor-pointer flex items-center justify-center uppercase tracking-wider font-mono shadow-sm active:scale-[0.98]"
              >
                Change Intent
              </button>

              <button
                type="button"
                onClick={handleEndIntent}
                className="h-11 min-h-[44px] px-3 text-xs font-bold text-zinc-300 hover:text-white bg-[#1a1424] hover:bg-[#251c36] border border-[#6F3CC3]/50 rounded-xl transition-all cursor-pointer flex items-center justify-center uppercase tracking-wider font-mono shadow-sm active:scale-[0.98]"
              >
                End Intent
              </button>
            </div>

            {/* Compact Protection & Area Note */}
            <div className="flex items-center justify-between px-1 text-[11px] font-mono text-zinc-400">
              <div className="flex items-center gap-1.5">
                <span className="text-[#C9A24D] font-bold">● Protected</span>
                <span className="text-zinc-600">·</span>
                <span className="text-zinc-300 truncate">{activeUserIntent.area}</span>
              </div>
              <span className="text-[10px] text-zinc-500 shrink-0">±300m cloaked</span>
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
            className="w-full h-12 min-h-[48px] bg-[#12131a] hover:bg-[#181a24] active:scale-[0.99] border border-[#C9A24D]/35 hover:border-[#C9A24D]/75 rounded-xl transition-all duration-200 cursor-pointer flex items-center justify-center gap-2 group shadow-sm"
          >
            <span className="w-2 h-2 rounded-full bg-[#C9A24D]/60 group-hover:bg-[#C9A24D] transition-colors" />
            <span className="text-xs sm:text-sm font-black tracking-widest text-zinc-100 group-hover:text-white uppercase font-sans">
              I’M AVAILABLE
            </span>
          </button>
        )}
      </div>

      {/* =========================================================================
          4. SECONDARY CONTROLS & POPPING SELECTED INTENT:
          Selected intent has strong typography, amber foreground, subtle purple backing,
          slightly increased scale, restrained glow, and excellent contrast.
         ========================================================================= */}
      <div className="relative z-10 bg-[#101118] border border-white/[0.08] rounded-2xl p-3 sm:p-3.5 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          {/* Availability / When Segment */}
          {isRightNowMode ? (
            <div className="flex items-center gap-2 flex-wrap">
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
                      className={`h-8 min-h-[34px] px-3 text-xs font-bold rounded-lg transition-all cursor-pointer ${
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
                      className={`h-8 min-h-[34px] px-2.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${
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

          {/* Distance Dropdown */}
          <div className="flex items-center gap-2 self-start sm:self-auto">
            <span className="text-[10px] text-zinc-400 font-mono uppercase">Radius:</span>
            <select
              value={maxDistanceKm}
              onChange={(e) => setMaxDistanceKm(Number(e.target.value))}
              aria-label="Filter distance"
              className="h-8 min-h-[34px] bg-[#07080b] border border-white/10 rounded-lg px-2 text-xs text-zinc-300 focus:outline-none focus:border-[#C9A24D] cursor-pointer"
            >
              <option value={1}>&lt; 1 km</option>
              <option value={2}>&lt; 2 km</option>
              <option value={5}>&lt; 5 km</option>
              <option value={20}>Any distance</option>
            </select>
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

          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-1 -mx-1 px-1">
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
                  className={`h-9 min-h-[36px] px-3.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all duration-200 cursor-pointer flex items-center gap-1.5 border relative shrink-0 ${
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
          5. MUTUAL INTEREST / MATCH CARD (PURE GAYZE PALETTE, NO GREEN)
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
              className="w-8 h-8 rounded-lg text-zinc-400 hover:text-white flex items-center justify-center cursor-pointer"
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

          <div className="grid grid-cols-2 gap-2 pt-1">
            <button
              type="button"
              onClick={() => setMutualMatchPulse(null)}
              className="h-11 min-h-[44px] px-3 text-xs font-semibold text-zinc-400 hover:text-white bg-[#101118] border border-white/10 rounded-xl cursor-pointer flex items-center justify-center"
            >
              Keep Browsing
            </button>
            <button
              type="button"
              onClick={() => {
                onOpenDirectChat(mutualMatchPulse);
                setMutualMatchPulse(null);
              }}
              className="h-11 min-h-[44px] px-3 text-xs font-black text-black bg-[#C9A24D] hover:bg-[#b58f3b] rounded-xl transition-all cursor-pointer shadow-md flex items-center justify-center gap-1.5 uppercase tracking-wider font-sans"
            >
              <MessageSquare className="w-3.5 h-3.5 fill-black" />
              <span>Message</span>
            </button>
          </div>
        </div>
      )}

      {/* =========================================================================
          6. LIVE DISCOVERY CARDS:
          WHO → INTENT → WHEN → DISTANCE → TRUST → ACTION
          Buttons never overlap, thumb-friendly 44px+ touch targets
         ========================================================================= */}
      <div className="relative z-10 space-y-2.5">
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-2">
            <h2 className="text-xs sm:text-sm font-black tracking-wider uppercase font-sans text-white">
              LIVE DISCOVERY
            </h2>
            <span className="text-[10px] text-zinc-400 font-mono">
              ({filteredPulses.length} available)
            </span>
          </div>
          <span className="text-[10px] text-zinc-400 font-mono">
            {isRightNowMode ? 'Spontaneous encounters' : 'Upcoming plans'}
          </span>
        </div>

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
              className="h-11 min-h-[44px] px-5 text-xs font-bold text-black bg-[#C9A24D] hover:bg-[#b58f3b] rounded-xl transition-colors cursor-pointer inline-flex items-center justify-center"
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
                  className="group bg-[#101118] hover:bg-[#141620] border border-white/[0.08] hover:border-[#C9A24D]/40 rounded-2xl p-3.5 sm:p-4 transition-all duration-200 flex flex-col justify-between shadow-sm relative overflow-hidden"
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
                      <div className="flex items-center gap-1 truncate max-w-[200px]">
                        <MapPin className="w-3 h-3 text-[#C9A24D] shrink-0" />
                        <span className="truncate">{pulse.venueName}</span>
                      </div>

                      <div className="flex items-center gap-1 text-[#C9A24D] font-mono shrink-0">
                        <CheckCircle2 className="w-3 h-3 text-[#C9A24D]" />
                        <span>Verified · 94</span>
                      </div>
                    </div>
                  </div>

                  {/* 5. ACTION: [ Interested ] [ Message ]
                      Responsive 2-column grid with min-h-[44px], ZERO overlap
                  */}
                  <div className="mt-3.5 pt-2.5 border-t border-white/[0.06] space-y-2">
                    <div className="flex items-center justify-between text-[10px] text-zinc-500 font-mono">
                      <div className="flex items-center gap-1">
                        <Lock className="w-3 h-3 text-[#C9A24D]" />
                        <span>E2EE Group</span>
                      </div>
                      <span>Cloaked ±300m</span>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      {/* Primary Action: Interested */}
                      <button
                        type="button"
                        onClick={() => handleTapInterested(pulse)}
                        className={`h-11 min-h-[44px] px-3 text-xs font-bold rounded-xl transition-all duration-150 cursor-pointer flex items-center justify-center gap-1.5 active:scale-95 ${
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
                        className="h-11 min-h-[44px] px-3 text-xs font-medium text-zinc-300 hover:text-white bg-[#181a24] hover:bg-[#202330] border border-white/10 rounded-xl transition-colors cursor-pointer flex items-center justify-center"
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

      {/* =========================================================================
          7. HIERARCHY LEVEL 3: MAP / RADAR (RESTORED & PROMINENTLY EMBEDDED)
          The map is a core part of GAYZE and is visible within RIGHT NOW.
          Includes Map & Radar switcher with min-h-[44px] touch targets.
          Subtle purple atmospheric glow on container border, map remains 100% readable.
         ========================================================================= */}
      <div ref={mapSectionRef} className="relative z-10 pt-3 space-y-2.5">
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-2">
            <h2 className="text-xs sm:text-sm font-black tracking-wider uppercase font-sans text-white">
              LIVE MAP & RADAR
            </h2>
            <span className="text-[10px] text-[#C9A24D] font-mono">
              · {filteredPulses.length} active
            </span>
          </div>

          {/* Toggle between Map and Radar */}
          <div className="flex items-center p-0.5 bg-[#08090e] rounded-xl border border-white/10">
            <button
              type="button"
              onClick={() => {
                hapticLight();
                setMapDisplayType('map');
              }}
              className={`h-8 min-h-[36px] px-3 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                mapDisplayType === 'map'
                  ? 'bg-[#181a24] text-[#C9A24D] border border-[#C9A24D]/50 shadow-sm'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              <MapIcon className="w-3.5 h-3.5" />
              <span>Map</span>
            </button>

            <button
              type="button"
              onClick={() => {
                hapticLight();
                setMapDisplayType('radar');
              }}
              className={`h-8 min-h-[36px] px-3 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                mapDisplayType === 'radar'
                  ? 'bg-[#181a24] text-[#C9A24D] border border-[#C9A24D]/50 shadow-sm'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              <Radio className="w-3.5 h-3.5" />
              <span>Radar</span>
            </button>
          </div>
        </div>

        {/* Embedded Map Container */}
        <div className="relative rounded-2xl overflow-hidden border border-white/10 shadow-[0_0_24px_rgba(111,60,195,0.22)] bg-[#07080b]">
          {mapDisplayType === 'map' ? (
            <PrivacyGeographicMap
              pulses={filteredPulses}
              safeHavens={safeHavens}
              userNeighborhood={userNeighborhood}
              privacySetting={privacySetting}
              onOpenDirectChat={onOpenDirectChat}
              onSelectHaven={onSelectHaven}
              onBroadcastHere={handleBroadcastHere}
            />
          ) : (
            <div className="space-y-3 p-3">
              <RadarMap
                pulses={filteredPulses}
                safeHavens={safeHavens}
                userNeighborhood={userNeighborhood}
                onSelectPulse={(p) => setSelectedPulseForDetail(p)}
                onSelectHaven={(h) => onSelectHaven(h)}
              />

              {selectedPulseForDetail && (
                <div className="p-3 bg-[#101118] border border-white/10 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-in fade-in">
                  <div className="flex items-start gap-2.5">
                    <div className="w-9 h-9 rounded-xl bg-[#181a24] border border-white/10 flex items-center justify-center font-bold text-[#C9A24D] shrink-0">
                      {selectedPulseForDetail.peerName.charAt(0)}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs sm:text-sm font-bold text-white">
                          {selectedPulseForDetail.peerName}
                        </span>
                        <span className="text-[10px] font-bold text-[#C9A24D] uppercase font-mono">
                          {getEncounterIntent(selectedPulseForDetail)}
                        </span>
                      </div>
                      <div className="text-[11px] text-zinc-400 flex items-center gap-1 font-mono">
                        <MapPin className="w-3 h-3 text-[#C9A24D]" />
                        <span>{selectedPulseForDetail.venueName}</span>
                        <span>·</span>
                        <span>~{selectedPulseForDetail.approxDistanceKm} km</span>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:flex sm:items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => setSelectedPulseForDetail(null)}
                      className="h-10 min-h-[40px] px-3 text-xs text-zinc-400 hover:text-white bg-[#141620] border border-white/10 rounded-xl cursor-pointer"
                    >
                      Dismiss
                    </button>
                    <button
                      type="button"
                      onClick={() => onOpenDirectChat(selectedPulseForDetail)}
                      className="h-10 min-h-[40px] flex items-center justify-center gap-1.5 px-3.5 text-xs font-bold text-black bg-[#C9A24D] hover:bg-[#b58f3b] rounded-xl transition-colors cursor-pointer"
                    >
                      <Lock className="w-3.5 h-3.5" />
                      <span>Message</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Supporting Privacy & Safety Metadata */}
        <div className="flex items-center justify-between px-2 text-[11px] text-zinc-400 font-mono">
          <span>{filteredPulses.length} live encounters · {safeHavens.length} safe havens</span>
          <span className="flex items-center gap-1 text-[#C9A24D]">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Cloaked ±300m</span>
          </span>
        </div>
      </div>

      {/* =========================================================================
          8. REFINED "SET YOUR INTENT" BOTTOM SHEET / MODAL
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
