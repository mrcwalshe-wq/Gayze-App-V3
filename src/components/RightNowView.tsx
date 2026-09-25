import React, { useState, useMemo, useEffect, useRef } from 'react';
import { 
  Pulse, 
  SafeHaven, 
  LocationPrivacy, 
  DatingProfile, 
  SocialStory,
  UserActiveIntent,
} from '../types';
import { PrivacyGeographicMap, MapDiscoveryItem } from './PrivacyGeographicMap';
import { SetIntentSheet } from './SetIntentSheet';
import { CountdownPill } from './CountdownPill';
import { CompatibilitySnapshot } from './CompatibilitySnapshot';
import { 
  ShieldCheck, 
  Lock, 
  Clock, 
  MapPin, 
  X,
  Zap,
  CheckCircle2,
  Check,
  Calendar,
  MessageSquare,
  SlidersHorizontal,
  Plus,
  Minus,
  Navigation,
  Eye,
  ChevronUp,
  Maximize2,
  Edit3,
  Pause,
  Play,
  Share2,
  Compass,
  Sparkles
} from 'lucide-react';
import { 
  hapticLight, 
  hapticSensitiveAction, 
  triggerVibration 
} from '../services/hapticService';

interface RightNowViewProps {
  pulses: Pulse[];
  safeHavens: SafeHaven[];
  userNeighborhood: string;
  privacySetting?: LocationPrivacy;
  datingProfiles?: DatingProfile[];
  stories?: SocialStory[];
  activeUserIntent?: UserActiveIntent | null;
  onOpenDirectChat: (pulse: Pulse) => void;
  onOpenDirectChatWithProfile?: (profile: DatingProfile) => void;
  onSelectHaven: (haven: SafeHaven) => void;
  onCreatePulse: (newPulse: Omit<Pulse, 'id' | 'createdAt' | 'expiresAt'>) => void;
  onGazeAtPeer?: (peerName: string) => void;
  onOpenScheduleMeeting?: (peerName: string) => void;
  onOpenSetIntent?: () => void;
  onUpdateActiveUserIntent?: (intent: UserActiveIntent | null) => void;
  onSubmitInterest?: (pulse: Pulse) => Promise<{ mutual: boolean; conversation_id: string | null }>;
}

export const RightNowView: React.FC<RightNowViewProps> = ({
  pulses,
  safeHavens,
  userNeighborhood,
  privacySetting = 'fuzzy_500m',
  datingProfiles = [],
  stories = [],
  activeUserIntent: propActiveUserIntent,
  onOpenDirectChat,
  onOpenDirectChatWithProfile,
  onSelectHaven,
  onCreatePulse,
  onGazeAtPeer,
  onOpenScheduleMeeting,
  onOpenSetIntent,
  onUpdateActiveUserIntent,
  onSubmitInterest,
}) => {
  // 1. User's Personal Active Right Now Intent State
  const [localActiveUserIntent, setLocalActiveUserIntent] = useState<UserActiveIntent | null>(() => {
    try {
      const saved = localStorage.getItem('gayze_active_user_intent');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.expiresAt > Date.now()) return parsed;
      }
    } catch {}
    return null;
  });

  const activeUserIntent = propActiveUserIntent !== undefined ? propActiveUserIntent : localActiveUserIntent;
  const setActiveUserIntent = (val: UserActiveIntent | null) => {
    if (onUpdateActiveUserIntent) {
      onUpdateActiveUserIntent(val);
    } else {
      setLocalActiveUserIntent(val);
    }
    if (val) {
      localStorage.setItem('gayze_active_user_intent', JSON.stringify(val));
    } else {
      localStorage.removeItem('gayze_active_user_intent');
    }
  };

  const [isSetIntentOpen, setIsSetIntentOpen] = useState<boolean>(false);
  const [isUserIntentDrawerOpen, setIsUserIntentDrawerOpen] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Map Imperative Controls ref
  const mapControlsRef = useRef<{ zoomIn: () => void; zoomOut: () => void; recenter: () => void } | null>(null);

  // 3. Filtering States
  const [isFilterDrawerOpen, setIsFilterDrawerOpen] = useState<boolean>(false);
  const [activeCategory, setActiveCategory] = useState<'all' | 'people' | 'coffee' | 'drinks' | 'active' | 'havens'>('all');
  const [activeIntentMode, setActiveIntentMode] = useState<'All' | 'Social' | 'Private'>('All');
  const [showJitterCircles, setShowJitterCircles] = useState<boolean>(true);
  const [maxDistanceKm, setMaxDistanceKm] = useState<number>(5);

  // 4. Selected Discovery Item (Docked Compact Bottom Card & Expanded Sheet)
  // Start with a clean map. Discovery details appear only after the user
  // explicitly selects a person, pulse, or Safe Haven.
  const [selectedItem, setSelectedItem] = useState<MapDiscoveryItem | null>(null);

  const [isCardExpanded, setIsCardExpanded] = useState<boolean>(false);

  // 5. "I'm Interested" & Gaze States
  const [interestedIds, setInterestedIds] = useState<Set<string>>(new Set());
  const [interestPendingIds, setInterestPendingIds] = useState<Set<string>>(new Set());
  const [gazedPeerNames, setGazedPeerNames] = useState<Set<string>>(new Set());
  const [mutualMatchPulse, setMutualMatchPulse] = useState<Pulse | null>(null);

  // 6. Countdown timer for active user intent
  const [remainingMinutes, setRemainingMinutes] = useState<number>(0);

  useEffect(() => {
    if (!activeUserIntent) return;

    try {
      localStorage.setItem('gayze_active_user_intent', JSON.stringify(activeUserIntent));
    } catch {}

    const updateRemaining = () => {
      const diff = Math.max(0, Math.round((activeUserIntent.expiresAt - Date.now()) / (1000 * 60)));
      setRemainingMinutes(diff);
      if (diff <= 0) {
        setActiveUserIntent(null);
        localStorage.removeItem('gayze_active_user_intent');
        setStatusMessage('Your Right Now intent expired');
        setTimeout(() => setStatusMessage(null), 3000);
      }
    };

    updateRemaining();
    const interval = setInterval(updateRemaining, 30000);
    return () => clearInterval(interval);
  }, [activeUserIntent, onUpdateActiveUserIntent]);

  // Handle saving newly created or edited Right Now intent
  const handleSaveIntent = (intentData: UserActiveIntent) => {
    setActiveUserIntent(intentData);
    try {
      localStorage.setItem('gayze_active_user_intent', JSON.stringify(intentData));
    } catch {}

    const categoryMap: Record<string, Pulse['activityCategory']> = {
      Meet: 'coffee',
      Drinks: 'drinks',
      Date: 'walk',
      Chat: 'culture',
      Group: 'active',
      Hookup: 'chill',
      'Hookup · Host': 'chill',
      'Hookup · Travel': 'chill',
      'Hookup · Outdoor': 'chill',
      'Hookup · Car': 'chill',
      Other: 'chill',
    };

    const durationNum = intentData.duration === '1 hr' ? 1 : intentData.duration === '2 hrs' ? 2 : 4;
    const latJitter = 51.5132 + (Math.random() - 0.5) * 0.005;
    const lngJitter = -0.1300 + (Math.random() - 0.5) * 0.005;

    // Publish to the map as a live pulse
    onCreatePulse({
      peerId: 'peer_me',
      peerName: 'Julian K.',
      peerShortKey: 'pk_7e3f...6e80',
      peerAvatar: 'julian',
      peerAge: 30,
      title: `${intentData.mode.toUpperCase()} · ${intentData.intent}`,
      description: intentData.description || `Available for ${intentData.intent.toLowerCase()} near ${intentData.area}.`,
      activityCategory: categoryMap[intentData.intent] || 'drinks',
      intentMode: intentData.mode,
      intent: intentData.intent,
      travelDistance: intentData.travelDistance,
      canHost: intentData.canHost,
      travelWillingness: intentData.travelWillingness,
      venueName: intentData.area,
      neighborhood: userNeighborhood,
      approxDistanceKm: 0.1,
      jitterMeters: 250,
      lat: latJitter,
      lng: lngJitter,
      durationHours: durationNum,
      tags: [intentData.intent, intentData.mode, intentData.when],
      safeHavenVenue: Boolean(intentData.isNearSafeHaven),
    });

    setStatusMessage(`● Intent Broadcasted: ${intentData.mode.toUpperCase()} · ${intentData.intent}`);
    setTimeout(() => setStatusMessage(null), 3500);
  };

  // Pause / Resume user intent
  const handleTogglePause = () => {
    if (!activeUserIntent) return;
    hapticLight();
    const nextPaused = !activeUserIntent.isPaused;
    const updated = { ...activeUserIntent, isPaused: nextPaused };
    setActiveUserIntent(updated);
    try {
      localStorage.setItem('gayze_active_user_intent', JSON.stringify(updated));
    } catch {}
    setStatusMessage(nextPaused ? '⏸ Intent paused on map' : '● Intent resumed on map');
    setTimeout(() => setStatusMessage(null), 2500);
  };

  // End active intent early
  const handleEndIntent = () => {
    hapticSensitiveAction();
    setActiveUserIntent(null);
    setIsUserIntentDrawerOpen(false);
    try {
      localStorage.removeItem('gayze_active_user_intent');
    } catch {}
    setStatusMessage('Intent ended and removed from map');
    setTimeout(() => setStatusMessage(null), 2500);
  };

  // Express interest in a pulse / profile
  const handleTapInterested = async (id: string, pulseObj?: Pulse) => {
    hapticLight();
    if (!pulseObj) return;

    if (interestedIds.has(id)) {
      setInterestedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      return;
    }

    setInterestPendingIds((prev) => new Set(prev).add(id));

    try {
      let result: { mutual: boolean; conversation_id: string | null } = { mutual: false, conversation_id: null };
      const looksLikeUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(pulseObj.peerId);

      if (looksLikeUuid && onSubmitInterest) {
        result = await onSubmitInterest(pulseObj);
      }

      setInterestedIds((prev) => {
        const next = new Set(prev);
        next.add(id);
        return next;
      });

      if (result.mutual) {
        triggerVibration([40, 60, 100]);
        setMutualMatchPulse(pulseObj);
        setStatusMessage('⚡ Mutual interest — opening your chat');
        setTimeout(() => setStatusMessage(null), 2500);
        setSelectedItem(null);
        setIsCardExpanded(false);
      } else {
        setStatusMessage('✓ Interest sent — they can now respond');
        setTimeout(() => setStatusMessage(null), 2500);
      }
    } catch (error) {
      console.error('[GAYZE] Interest submission failed', error);
      setStatusMessage('Interest could not be sent — try again');
      setTimeout(() => setStatusMessage(null), 3000);
    } finally {
      setInterestPendingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const handleGazeAtPerson = (name: string) => {
    triggerVibration([40, 80]);
    setGazedPeerNames((prev) => new Set(prev).add(name));
    if (onGazeAtPeer) onGazeAtPeer(name);
  };

  const formatRemainingTime = (mins: number) => {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  };

  // Filtered active count
  const filteredActiveCount = useMemo(() => {
    let count = 0;
    if (activeCategory === 'all' || activeCategory === 'people') {
      const matchProfiles = datingProfiles.filter(p => {
        const isPrivate = p.intentMode === 'private' || p.lookingFor === 'casual';
        if (activeIntentMode === 'Social' && isPrivate) return false;
        if (activeIntentMode === 'Private' && !isPrivate) return false;
        return true;
      });
      count += matchProfiles.length;
    }
    if (activeCategory !== 'people' && activeCategory !== 'havens') {
      const matchPulses = pulses.filter(p => {
        if (activeCategory !== 'all' && p.activityCategory !== activeCategory) return false;
        const isPrivate = p.intentMode === 'private' || p.intent?.includes('Hookup');
        if (activeIntentMode === 'Social' && isPrivate) return false;
        if (activeIntentMode === 'Private' && !isPrivate) return false;
        return true;
      });
      count += matchPulses.length;
    }
    if (activeCategory === 'all' || activeCategory === 'havens') {
      count += safeHavens.length;
    }
    return count;
  }, [pulses, datingProfiles, safeHavens, activeCategory, activeIntentMode]);

  // Active filter count for badge
  const activeFilterCount = useMemo(() => {
    let num = 0;
    if (activeCategory !== 'all') num += 1;
    if (activeIntentMode !== 'All') num += 1;
    if (!showJitterCircles) num += 1;
    if (maxDistanceKm < 5) num += 1;
    return num;
  }, [activeCategory, activeIntentMode, showJitterCircles, maxDistanceKm]);

  // Helpers for discovery item rendering
  const getDisplayName = (item: MapDiscoveryItem) => {
    if (item.type === 'haven') return item.item.name;
    if (item.type === 'pulse') return `${item.item.peerName}${item.item.peerAge ? ` · ${item.item.peerAge}` : ''}`;
    return `${item.item.name}${item.item.age ? ` · ${item.item.age}` : ''}`;
  };

  const getDisplayDescription = (item: MapDiscoveryItem) => {
    if (item.type === 'haven') return item.item.features?.join(' · ') || 'Verified sanctuary with safety check-in beacon and trained staff.';
    if (item.type === 'pulse') return item.item.description;
    return item.item.headline;
  };

  // Reset all filters
  const handleClearFilters = () => {
    hapticLight();
    setActiveCategory('all');
    setActiveIntentMode('All');
    setShowJitterCircles(true);
    setMaxDistanceKm(5);
  };

  return (
    <div className="absolute inset-0 w-full h-full min-h-0 overflow-hidden select-none bg-[#07080b]">
      {/* =========================================================================
          1. RESTRAINED PURPLE ATMOSPHERE
          Deep radial purple atmospheric glow radiating outward over the map canvas.
         ========================================================================= */}
      <div
        className="pointer-events-none absolute -top-16 left-1/2 -translate-x-1/2 w-full max-w-4xl h-[480px] rounded-full blur-3xl z-10 opacity-30 transition-opacity duration-700 ease-out"
        style={{
          background: 'radial-gradient(ellipse at 50% 20%, rgba(111, 60, 195, 0.45) 0%, rgba(111, 60, 195, 0.12) 44%, rgba(7, 8, 11, 0) 74%)',
        }}
        aria-hidden="true"
      />

      {/* Subtle Toast / Status Notification */}
      {statusMessage && (
        <div className="fixed top-16 left-3 right-3 sm:left-auto sm:right-4 z-50 bg-[#12141f]/95 backdrop-blur-md border border-[#C9A24D]/50 text-white text-xs px-3.5 py-2.5 rounded-xl flex items-center justify-between shadow-2xl animate-in fade-in duration-200">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#C9A24D] animate-ping" />
            <span className="font-semibold">{statusMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setStatusMessage(null)}
            className="text-zinc-400 hover:text-white text-xs cursor-pointer p-1 min-h-[32px] min-w-[32px] flex items-center justify-center"
            aria-label="Dismiss message"
          >
            ✕
          </button>
        </div>
      )}

      {/* =========================================================================
          2. EDGE-TO-EDGE PRIMARY MAP / RADAR CANVAS
          The map is the central full-screen experience behind all UI.
         ========================================================================= */}
      <div className="w-full h-full absolute inset-0 z-0">
        <PrivacyGeographicMap
          pulses={pulses}
          safeHavens={safeHavens}
          profiles={datingProfiles}
          userNeighborhood={userNeighborhood}
          privacySetting={privacySetting}
          filter={activeCategory}
          intentModeFilter={activeIntentMode}
          showJitterCircles={showJitterCircles}
          selectedItem={selectedItem}
          onSelectItem={(item) => {
            hapticLight();
            setSelectedItem(item);
            setIsCardExpanded(false);
          }}
          onOpenDirectChat={onOpenDirectChat}
          onOpenDirectChatWithProfile={onOpenDirectChatWithProfile}
          onSelectHaven={onSelectHaven}
          onGazeAtPeer={onGazeAtPeer}
          onOpenScheduleMeeting={onOpenScheduleMeeting}
          onMapReady={(controls) => {
            mapControlsRef.current = controls;
          }}
        />
      </div>
      {/* =========================================================================
          4. CLEAN FLOATING VERTICAL MAP CONTROLS
          Independent vertical group on top-right edge:
          - Zoom In (+)
          - Zoom Out (-)
          - Recenter / Location compass
          - Toggle ±300m privacy circles
         ========================================================================= */}
      {(
        <div className="absolute top-16 right-2.5 z-20 flex flex-col gap-1.5 pointer-events-auto">
          {/* Zoom In */}
          <button
            type="button"
            onClick={() => {
              hapticLight();
              mapControlsRef.current?.zoomIn();
            }}
            title="Zoom In"
            aria-label="Zoom In"
            className="w-10 h-10 min-h-[40px] min-w-[40px] rounded-xl bg-[#0e1017]/85 hover:bg-[#181a26] backdrop-blur-xl border border-white/[0.12] hover:border-white/30 text-zinc-300 hover:text-white shadow-lg flex items-center justify-center transition-all active:scale-95 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
          </button>

          {/* Zoom Out */}
          <button
            type="button"
            onClick={() => {
              hapticLight();
              mapControlsRef.current?.zoomOut();
            }}
            title="Zoom Out"
            aria-label="Zoom Out"
            className="w-10 h-10 min-h-[40px] min-w-[40px] rounded-xl bg-[#0e1017]/85 hover:bg-[#181a26] backdrop-blur-xl border border-white/[0.12] hover:border-white/30 text-zinc-300 hover:text-white shadow-lg flex items-center justify-center transition-all active:scale-95 cursor-pointer"
          >
            <Minus className="w-4 h-4" />
          </button>

          {/* Recenter / Compass */}
          <button
            type="button"
            onClick={() => {
              hapticLight();
              mapControlsRef.current?.recenter();
            }}
            title="Recenter to Soho"
            aria-label="Recenter to Soho"
            className="w-10 h-10 min-h-[40px] min-w-[40px] rounded-xl bg-[#0e1017]/85 hover:bg-[#181a26] backdrop-blur-xl border border-white/[0.12] hover:border-[#C9A24D]/50 text-zinc-300 hover:text-[#C9A24D] shadow-lg flex items-center justify-center transition-all active:scale-95 cursor-pointer"
          >
            <Compass className="w-4 h-4 text-[#C9A24D]" />
          </button>

          {/* Toggle Privacy Area Circles */}
          <button
            type="button"
            onClick={() => {
              hapticLight();
              setShowJitterCircles(!showJitterCircles);
            }}
            title="Toggle Privacy Area Cloaking (~300m)"
            aria-label="Toggle Privacy Area"
            className={`w-10 h-10 min-h-[40px] min-w-[40px] rounded-xl backdrop-blur-xl border shadow-lg flex items-center justify-center transition-all active:scale-95 cursor-pointer ${
              showJitterCircles
                ? 'bg-[#1c152a]/90 text-[#C9A24D] border-[#6F3CC3]/60 shadow-[0_0_10px_rgba(111,60,195,0.3)]'
                : 'bg-[#0e1017]/85 hover:bg-[#181a26] text-zinc-400 border-white/[0.12]'
            }`}
          >
            <ShieldCheck className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* =========================================================================
          5. COMPACT FLOATING BOTTOM DISCOVERY CARD (PREVIEW)
          Sits comfortably above the mobile bottom navigation bar without overlapping.
          Has clear visual hierarchy:
          - avatar/name
          - distance + availability
          - short intent description
          - location/time
          - actions (Interested, Safe Meet, Message)
         ========================================================================= */}
      {selectedItem && !isCardExpanded && (
        <div className="absolute bottom-[4.25rem] md:bottom-5 left-2.5 right-2.5 max-w-lg mx-auto z-30 animate-in fade-in slide-in-from-bottom-3 duration-200">
          <div className="relative group bg-[#0e1017]/92 backdrop-blur-xl border border-white/[0.14] hover:border-white/25 rounded-2xl p-3 sm:p-3.5 shadow-2xl transition-all">
            
            {/* Ambient subtle glow based on intent type */}
            <div className={`absolute -inset-0.5 rounded-2xl blur-md pointer-events-none opacity-40 transition-opacity ${
              selectedItem.type === 'haven'
                ? 'bg-emerald-500/25'
                : selectedItem.type === 'pulse' && (selectedItem.item.intentMode === 'private' || selectedItem.item.intent?.includes('Hookup'))
                ? 'bg-[#6F3CC3]/35'
                : 'bg-[#C9A24D]/25'
            }`} />

            <div className="relative space-y-2">
              {/* Row 1: Header (Avatar, Name, Age, Intent Badge, Expand & Close triggers) */}
              <div className="flex items-start justify-between gap-2.5">
                <button
                  type="button"
                  onClick={() => setIsCardExpanded(true)}
                  className="flex items-center gap-2.5 text-left cursor-pointer group/card flex-1 min-w-0"
                >
                  {/* Avatar / Icon */}
                  {selectedItem.type === 'profile' ? (
                    <div className="relative w-11 h-11 rounded-xl overflow-hidden border border-white/20 bg-[#161822] shrink-0 shadow-inner">
                      <img
                        src={selectedItem.item.photoUrl}
                        alt={selectedItem.item.name}
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          (e.target as HTMLImageElement).src = 'https://raw.githubusercontent.com/mrcwalshe-wq/Gayze-App-V3/main/src/assets/images/dating_profile_marcus_1790154961749.jpg';
                        }}
                      />
                      <span className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-emerald-500 border border-black shadow" />
                    </div>
                  ) : selectedItem.type === 'haven' ? (
                    <div className="w-11 h-11 rounded-xl bg-[#101e1a] border border-emerald-500/60 text-emerald-400 flex items-center justify-center shrink-0 shadow-inner">
                      <ShieldCheck className="w-5 h-5" />
                    </div>
                  ) : (
                    <div className={`w-11 h-11 rounded-xl border flex items-center justify-center font-bold text-sm shrink-0 shadow-inner ${
                      selectedItem.item.intentMode === 'private' || selectedItem.item.intent?.includes('Hookup')
                        ? 'bg-[#221634] border-purple-500/50 text-purple-300'
                        : 'bg-[#221c12] border-[#C9A24D]/50 text-[#C9A24D]'
                    }`}>
                      {selectedItem.item.peerName.charAt(0)}
                    </div>
                  )}

                  {/* Name + Title + Intent Badge */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <h3 className="text-sm font-bold text-white tracking-tight truncate">
                        {getDisplayName(selectedItem)}
                      </h3>

                      {/* Intent Pill / Badge */}
                      <span className={`text-[10px] font-mono font-bold uppercase px-2 py-0.5 rounded-md border shrink-0 ${
                        selectedItem.type === 'haven'
                          ? 'bg-emerald-950/70 text-emerald-300 border-emerald-500/40'
                          : selectedItem.type === 'pulse' && (selectedItem.item.intentMode === 'private' || selectedItem.item.intent?.includes('Hookup'))
                          ? 'bg-[#271438] text-purple-300 border-purple-500/50 shadow-[0_0_8px_rgba(111,60,195,0.3)]'
                          : 'bg-[#261f12] text-[#C9A24D] border-[#C9A24D]/50'
                      }`}>
                        {selectedItem.type === 'haven'
                          ? `HAVEN ★ ${selectedItem.item.safetyScore}`
                          : selectedItem.type === 'pulse'
                          ? `${(selectedItem.item.intentMode || 'social').toUpperCase()} · ${selectedItem.item.intent || selectedItem.item.title}`
                          : `${(selectedItem.item.intentMode || 'social').toUpperCase()} · ${selectedItem.item.lookingForLabel || 'Connect'}`}
                      </span>

                      {/* Live Intent Countdown */}
                      {selectedItem.type === 'pulse' && selectedItem.item.expiresAt && (
                        <CountdownPill expiresAt={selectedItem.item.expiresAt} />
                      )}
                      {selectedItem.type === 'profile' && selectedItem.item.intentExpiresAt && (
                        <CountdownPill expiresAt={selectedItem.item.intentExpiresAt} />
                      )}

                      {/* Compatibility Badge if matched */}
                      {selectedItem.type === 'profile' && activeUserIntent && (
                        <CompatibilitySnapshot profile={selectedItem.item} userIntent={activeUserIntent} variant="badge" />
                      )}
                    </div>

                    {/* Unboxed Distance & Context */}
                    <div className="text-[11px] text-zinc-400 flex items-center gap-1.5 font-mono mt-0.5">
                      <span className="flex items-center gap-1 text-[#C9A24D]">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#C9A24D] animate-pulse" />
                        Available now
                      </span>
                      <span>·</span>
                      <span>
                        ~{selectedItem.type === 'haven' ? '0.2' : (selectedItem.item as any).approxDistanceKm || '0.3'} km
                      </span>
                      <span>·</span>
                      <span className="text-zinc-400 truncate">
                        {selectedItem.type === 'haven' ? selectedItem.item.neighborhood : (selectedItem.item as any).venueName || userNeighborhood}
                      </span>
                    </div>
                  </div>
                </button>

                {/* Top Right Controls (Expand & Dismiss) */}
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      hapticLight();
                      setIsCardExpanded(true);
                    }}
                    className="w-8 h-8 rounded-lg text-zinc-400 hover:text-white hover:bg-white/[0.08] transition-colors flex items-center justify-center cursor-pointer"
                    title="Expand details"
                    aria-label="Expand details"
                  >
                    <ChevronUp className="w-4 h-4 text-[#C9A24D]" />
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      hapticLight();
                      setSelectedItem(null);
                    }}
                    className="w-8 h-8 rounded-lg text-zinc-400 hover:text-white hover:bg-white/[0.08] transition-colors flex items-center justify-center cursor-pointer"
                    title="Close preview"
                    aria-label="Close preview"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Short Intent Description (Intelligently truncated) */}
              <p
                onClick={() => setIsCardExpanded(true)}
                className="text-xs text-zinc-300 italic line-clamp-1 cursor-pointer hover:text-white transition-colors"
              >
                "{getDisplayDescription(selectedItem)}"
              </p>

              {/* Actions Row */}
              <div className="grid grid-cols-3 gap-2 pt-0.5">
                {selectedItem.type === 'haven' ? (
                  <>
                    <button
                      type="button"
                      onClick={() => onSelectHaven(selectedItem.item)}
                      className="col-span-2 h-10 min-h-[40px] px-2 text-xs font-bold text-black bg-[#C9A24D] hover:bg-[#b58f3b] rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5 shadow active:scale-98 font-sans uppercase tracking-wide"
                    >
                      <MapPin className="w-3.5 h-3.5 fill-black" />
                      <span>Explore Safe Haven</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        hapticLight();
                        if (onOpenScheduleMeeting) {
                          onOpenScheduleMeeting(selectedItem.item.name);
                        }
                      }}
                      className="h-10 min-h-[40px] px-2 text-xs font-bold text-[#C9A24D] bg-[#1a1c27] hover:bg-[#222534] border border-[#C9A24D]/40 rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1 active:scale-98 font-mono"
                    >
                      <Calendar className="w-3.5 h-3.5" />
                      <span>Meet Here</span>
                    </button>
                  </>
                ) : (
                  <>
                    {/* Action 1: Interested / Gaze */}
                    {selectedItem.type === 'pulse' ? (
                      <button
                        type="button"
                        onClick={() => void handleTapInterested(selectedItem.item.id, selectedItem.item)}
                        disabled={interestPendingIds.has(selectedItem.item.id)}
                        className={`h-10 min-h-[40px] px-2 text-xs font-bold rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5 border active:scale-98 ${
                          interestedIds.has(selectedItem.item.id)
                            ? 'bg-[#20182c] text-[#C9A24D] border-[#C9A24D]/60 shadow-[0_0_8px_rgba(201,162,77,0.3)]'
                            : 'bg-[#181a24] hover:bg-[#202332] text-zinc-200 border-white/10'
                        }`}
                      >
                        {interestedIds.has(selectedItem.item.id) ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-[#C9A24D]" />
                            <span>{interestPendingIds.has(selectedItem.item.id) ? 'Sending…' : 'Interested'}</span>
                          </>
                        ) : (
                          <>
                            <Zap className="w-3.5 h-3.5 text-[#C9A24D]" />
                            <span>{interestPendingIds.has(selectedItem.item.id) ? 'Sending…' : 'Interested'}</span>
                          </>
                        )}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleGazeAtPerson(selectedItem.item.name)}
                        className={`h-10 min-h-[40px] px-2 text-xs font-bold rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5 border active:scale-98 ${
                          gazedPeerNames.has(selectedItem.item.name)
                            ? 'bg-[#231535] text-purple-300 border-purple-500/60'
                            : 'bg-[#181a24] hover:bg-[#202332] text-zinc-200 border-white/10'
                        }`}
                      >
                        <Eye className="w-3.5 h-3.5 text-[#C9A24D]" />
                        <span>{gazedPeerNames.has(selectedItem.item.name) ? 'Gazed' : 'Gaze 👀'}</span>
                      </button>
                    )}

                    {/* Action 2: Safe Meet */}
                    <button
                      type="button"
                      onClick={() => {
                        hapticLight();
                        const peerName = selectedItem.type === 'pulse' ? selectedItem.item.peerName : selectedItem.item.name;
                        if (onOpenScheduleMeeting) {
                          onOpenScheduleMeeting(peerName);
                        }
                      }}
                      className="h-10 min-h-[40px] px-2 text-xs font-bold text-[#C9A24D] hover:text-white bg-[#181a24] hover:bg-[#202332] border border-[#C9A24D]/35 rounded-xl transition-colors cursor-pointer flex items-center justify-center gap-1 active:scale-98 font-mono"
                    >
                      <Calendar className="w-3.5 h-3.5" />
                      <span>Safe Meet</span>
                    </button>

                    {/* Action 3: Message (Direct Encrypted Chat) */}
                    <button
                      type="button"
                      onClick={() => {
                        hapticLight();
                        if (selectedItem.type === 'pulse') {
                          onOpenDirectChat(selectedItem.item);
                        } else if (onOpenDirectChatWithProfile) {
                          onOpenDirectChatWithProfile(selectedItem.item);
                        }
                      }}
                      className="h-10 min-h-[40px] px-2 text-xs font-black text-black bg-[#C9A24D] hover:bg-[#b58f3b] rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5 shadow active:scale-98 uppercase tracking-wide font-sans"
                    >
                      <Lock className="w-3.5 h-3.5 fill-black" />
                      <span>Message</span>
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          6. EXPANDED DISCOVERY DETAIL BOTTOM SHEET
          Slides up smoothly when the user taps expand or the preview card.
          Preserves the map visible behind the sheet with backdrop blur.
         ========================================================================= */}
      {selectedItem && isCardExpanded && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div
            className="w-full max-w-lg mx-auto bg-[#0d0f16] border-t border-x border-white/[0.15] rounded-t-3xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh] animate-in slide-in-from-bottom duration-300"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Drag Handle */}
            <div
              onClick={() => setIsCardExpanded(false)}
              className="py-3 flex flex-col items-center justify-center cursor-pointer group"
            >
              <div className="w-12 h-1.5 bg-zinc-600 group-hover:bg-zinc-400 rounded-full transition-colors" />
            </div>

            {/* Scrollable Sheet Content */}
            <div className="px-5 pb-6 overflow-y-auto space-y-4">
              
              {/* Header Profile / Haven Presentation */}
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  {selectedItem.type === 'profile' ? (
                    <div className="w-14 h-14 rounded-2xl overflow-hidden border-2 border-[#C9A24D]/60 bg-[#161822] shrink-0 shadow-lg">
                      <img
                        src={selectedItem.item.photoUrl}
                        alt={selectedItem.item.name}
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          (e.target as HTMLImageElement).src = 'https://raw.githubusercontent.com/mrcwalshe-wq/Gayze-App-V3/main/src/assets/images/dating_profile_marcus_1790154961749.jpg';
                        }}
                      />
                    </div>
                  ) : selectedItem.type === 'haven' ? (
                    <div className="w-14 h-14 rounded-2xl bg-[#10221c] border-2 border-emerald-500/70 text-emerald-400 flex items-center justify-center shrink-0 shadow-lg">
                      <ShieldCheck className="w-7 h-7" />
                    </div>
                  ) : (
                    <div className={`w-14 h-14 rounded-2xl border-2 flex items-center justify-center font-black text-xl shrink-0 shadow-lg ${
                      selectedItem.item.intentMode === 'private' || selectedItem.item.intent?.includes('Hookup')
                        ? 'bg-[#251538] border-purple-500 text-purple-200'
                        : 'bg-[#251e12] border-[#C9A24D] text-[#C9A24D]'
                    }`}>
                      {selectedItem.item.peerName.charAt(0)}
                    </div>
                  )}

                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-lg font-black text-white tracking-tight">
                        {getDisplayName(selectedItem)}
                      </h2>
                    </div>

                    <div className="flex items-center gap-2 text-xs font-mono text-zinc-400 mt-0.5">
                      <span className="text-[#C9A24D] font-semibold flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#C9A24D] animate-pulse" />
                        Active Right Now
                      </span>
                      <span>·</span>
                      <span>
                        ~{selectedItem.type === 'haven' ? '0.2' : (selectedItem.item as any).approxDistanceKm || '0.3'} km away
                      </span>
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setIsCardExpanded(false)}
                  className="w-9 h-9 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] text-zinc-400 hover:text-white flex items-center justify-center cursor-pointer transition-colors"
                  aria-label="Close sheet"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Intent Mode & Category Highlight Box */}
              <div className="p-3.5 bg-[#12141e] border border-white/[0.08] rounded-2xl space-y-2">
                <div className="flex items-center justify-between text-xs font-mono">
                  <span className="text-zinc-400 uppercase font-semibold">Broadcast Intent</span>
                  <span className={`px-2 py-0.5 rounded-md font-bold uppercase ${
                    selectedItem.type === 'haven'
                      ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/40'
                      : selectedItem.type === 'pulse' && (selectedItem.item.intentMode === 'private' || selectedItem.item.intent?.includes('Hookup'))
                      ? 'bg-purple-950 text-purple-300 border border-purple-500/40'
                      : 'bg-[#C9A24D]/20 text-[#C9A24D] border border-[#C9A24D]/40'
                  }`}>
                    {selectedItem.type === 'haven'
                      ? `SAFE HAVEN · ★ ${selectedItem.item.safetyScore}`
                      : selectedItem.type === 'pulse'
                      ? `${selectedItem.item.intentMode?.toUpperCase() || 'SOCIAL'} · ${selectedItem.item.intent || selectedItem.item.title}`
                      : `${selectedItem.item.intentMode?.toUpperCase() || 'SOCIAL'} · ${selectedItem.item.lookingForLabel || 'Connect'}`}
                  </span>
                </div>

                <p className="text-sm text-zinc-200 leading-relaxed italic">
                  "{getDisplayDescription(selectedItem)}"
                </p>

                {/* Expiry countdown if defined */}
                {selectedItem.type === 'pulse' && selectedItem.item.expiresAt && (
                  <div className="pt-1 flex items-center justify-between">
                    <span className="text-[11px] font-mono text-zinc-400">Intent Lifetime:</span>
                    <CountdownPill expiresAt={selectedItem.item.expiresAt} />
                  </div>
                )}
                {selectedItem.type === 'profile' && selectedItem.item.intentExpiresAt && (
                  <div className="pt-1 flex items-center justify-between">
                    <span className="text-[11px] font-mono text-zinc-400">Intent Lifetime:</span>
                    <CountdownPill expiresAt={selectedItem.item.intentExpiresAt} />
                  </div>
                )}
              </div>

              {/* Compatibility Snapshot if profile and activeUserIntent */}
              {selectedItem.type === 'profile' && activeUserIntent && (
                <CompatibilitySnapshot
                  profile={selectedItem.item}
                  userIntent={activeUserIntent}
                  userNeighborhood={userNeighborhood}
                  variant="full"
                />
              )}

              {/* Context Details Grid (Hosting, Window, Neighborhood, Security) */}
              <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                <div className="p-3 bg-[#10121a] border border-white/[0.06] rounded-xl space-y-1">
                  <span className="text-zinc-500 text-[10px] uppercase font-bold block">Availability Window</span>
                  <div className="flex items-center gap-1.5 text-zinc-200 font-semibold">
                    <Clock className="w-3.5 h-3.5 text-[#C9A24D]" />
                    <span>Available now</span>
                  </div>
                  <span className="text-[10px] text-zinc-400 block">
                    {selectedItem.type === 'pulse' ? `~${selectedItem.item.durationHours} hrs window` : 'Immediate meet'}
                  </span>
                </div>

                <div className="p-3 bg-[#10121a] border border-white/[0.06] rounded-xl space-y-1">
                  <span className="text-zinc-500 text-[10px] uppercase font-bold block">Neighborhood</span>
                  <div className="flex items-center gap-1.5 text-zinc-200 font-semibold truncate">
                    <MapPin className="w-3.5 h-3.5 text-[#C9A24D] shrink-0" />
                    <span className="truncate">
                      {selectedItem.type === 'haven' ? selectedItem.item.neighborhood : (selectedItem.item as any).venueName || userNeighborhood}
                    </span>
                  </div>
                  <span className="text-[10px] text-zinc-400 block">±300m privacy cloaked</span>
                </div>

                {selectedItem.type === 'pulse' && selectedItem.item.canHost && (
                  <div className="p-3 bg-[#10121a] border border-white/[0.06] rounded-xl space-y-1">
                    <span className="text-zinc-500 text-[10px] uppercase font-bold block">Host Status</span>
                    <span className="text-purple-300 font-bold block">{selectedItem.item.canHost}</span>
                    <span className="text-[10px] text-zinc-400 block">Soho area verified</span>
                  </div>
                )}

                {selectedItem.type === 'pulse' && selectedItem.item.travelWillingness && !selectedItem.item.canHost && (
                  <div className="p-3 bg-[#10121a] border border-white/[0.06] rounded-xl space-y-1">
                    <span className="text-zinc-500 text-[10px] uppercase font-bold block">Travel Range</span>
                    <span className="text-purple-300 font-bold block">{selectedItem.item.travelWillingness}</span>
                    <span className="text-[10px] text-zinc-400 block">Walking distance</span>
                  </div>
                )}

                <div className="p-3 bg-[#10121a] border border-white/[0.06] rounded-xl space-y-1 col-span-2">
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-500 text-[10px] uppercase font-bold">Safety & Cryptographic Trust</span>
                    <span className="text-emerald-400 font-bold">P2P Verified</span>
                  </div>
                  <div className="text-[11px] text-zinc-300 flex items-center gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    <span>Approximate location only · No GPS breadcrumbs stored</span>
                  </div>
                </div>
              </div>

              {/* Action Buttons in Expanded Sheet */}
              <div className="pt-2 space-y-2">
                {selectedItem.type === 'haven' ? (
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        onSelectHaven(selectedItem.item);
                        setIsCardExpanded(false);
                      }}
                      className="h-12 min-h-[44px] px-3 text-xs font-bold text-black bg-[#C9A24D] hover:bg-[#b58f3b] rounded-xl transition-all cursor-pointer flex items-center justify-center gap-2 uppercase tracking-wide font-sans shadow-lg"
                    >
                      <MapPin className="w-4 h-4 fill-black" />
                      <span>View Safe Haven</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        hapticLight();
                        setIsCardExpanded(false);
                        if (onOpenScheduleMeeting) {
                          onOpenScheduleMeeting(selectedItem.item.name);
                        }
                      }}
                      className="h-12 min-h-[44px] px-3 text-xs font-bold text-[#C9A24D] bg-[#1a1c27] hover:bg-[#222534] border border-[#C9A24D]/40 rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5 font-mono"
                    >
                      <Calendar className="w-4 h-4" />
                      <span>Schedule Meetup</span>
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-2">
                    {/* Interested */}
                    {selectedItem.type === 'pulse' ? (
                      <button
                        type="button"
                        onClick={() => void handleTapInterested(selectedItem.item.id, selectedItem.item)}
                        disabled={interestPendingIds.has(selectedItem.item.id)}
                        className={`h-12 min-h-[44px] px-2 text-xs font-bold rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5 border active:scale-98 ${
                          interestedIds.has(selectedItem.item.id)
                            ? 'bg-[#221832] text-[#C9A24D] border-[#C9A24D]/70 shadow-[0_0_12px_rgba(201,162,77,0.35)]'
                            : 'bg-[#181a24] text-zinc-200 border-white/10 hover:border-white/20'
                        }`}
                      >
                        {interestedIds.has(selectedItem.item.id) ? (
                          <>
                            <Check className="w-4 h-4 text-[#C9A24D]" />
                            <span>{interestPendingIds.has(selectedItem.item.id) ? 'Sending…' : 'Interested'}</span>
                          </>
                        ) : (
                          <>
                            <Zap className="w-4 h-4 text-[#C9A24D]" />
                            <span>{interestPendingIds.has(selectedItem.item.id) ? 'Sending…' : 'Interested'}</span>
                          </>
                        )}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleGazeAtPerson(selectedItem.item.name)}
                        className={`h-12 min-h-[44px] px-2 text-xs font-bold rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5 border active:scale-98 ${
                          gazedPeerNames.has(selectedItem.item.name)
                            ? 'bg-[#241538] text-purple-300 border-purple-500/60'
                            : 'bg-[#181a24] text-zinc-200 border-white/10 hover:border-white/20'
                        }`}
                      >
                        <Eye className="w-4 h-4 text-[#C9A24D]" />
                        <span>{gazedPeerNames.has(selectedItem.item.name) ? 'Gazed' : 'Gaze 👀'}</span>
                      </button>
                    )}

                    {/* Safe Meet */}
                    <button
                      type="button"
                      onClick={() => {
                        hapticLight();
                        setIsCardExpanded(false);
                        const peerName = selectedItem.type === 'pulse' ? selectedItem.item.peerName : selectedItem.item.name;
                        if (onOpenScheduleMeeting) {
                          onOpenScheduleMeeting(peerName);
                        }
                      }}
                      className="h-12 min-h-[44px] px-2 text-xs font-bold text-[#C9A24D] hover:text-white bg-[#181a24] hover:bg-[#202332] border border-[#C9A24D]/40 rounded-xl transition-colors cursor-pointer flex items-center justify-center gap-1.5 active:scale-98 font-mono"
                    >
                      <Calendar className="w-4 h-4" />
                      <span>Safe Meet</span>
                    </button>

                    {/* Message */}
                    <button
                      type="button"
                      onClick={() => {
                        hapticLight();
                        setIsCardExpanded(false);
                        if (selectedItem.type === 'pulse') {
                          onOpenDirectChat(selectedItem.item);
                        } else if (onOpenDirectChatWithProfile) {
                          onOpenDirectChatWithProfile(selectedItem.item);
                        }
                      }}
                      className="h-12 min-h-[44px] px-2 text-xs font-black text-black bg-[#C9A24D] hover:bg-[#b58f3b] rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5 shadow-lg active:scale-98 uppercase tracking-wider font-sans"
                    >
                      <Lock className="w-4 h-4 fill-black" />
                      <span>Message</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          7. ANIMATED FILTER DRAWER (BOTTOM SHEET)
          Triggered from "Filters · X".
          Replaces the heavy static "All / People / Coffee / Drinks / Havens" bar.
          Organised into clean progressive disclosure sections:
          - Discovery Target (All / People / Coffee / Drinks / Safe Havens)
          - Intent Mode (All / Social / Private)
          - Distance / Cloaking options
          - Dynamic contextual CTA ("Show 6 active nearby")
         ========================================================================= */}
      {isFilterDrawerOpen && (
        <div 
          className="fixed inset-0 z-50 flex flex-col justify-end bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
          onClick={() => setIsFilterDrawerOpen(false)}
        >
          <div
            className="w-full max-w-lg mx-auto bg-[#0d0f16] border-t border-x border-white/[0.15] rounded-t-3xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh] animate-in slide-in-from-bottom duration-300"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Drawer Drag Handle */}
            <div className="py-3 flex flex-col items-center justify-center">
              <div className="w-12 h-1.5 bg-zinc-600 rounded-full" />
            </div>

            {/* Header: Title + Clear all */}
            <div className="px-5 pb-3 flex items-center justify-between border-b border-white/[0.08]">
              <div className="flex items-center gap-2">
                <SlidersHorizontal className="w-4 h-4 text-[#C9A24D]" />
                <h2 className="text-sm font-black uppercase tracking-wider text-white font-sans">
                  FILTER RIGHT NOW
                </h2>
              </div>

              {activeFilterCount > 0 && (
                <button
                  type="button"
                  onClick={handleClearFilters}
                  className="text-xs font-mono text-[#C9A24D] hover:underline cursor-pointer"
                >
                  Clear all
                </button>
              )}
            </div>

            {/* Scrollable Filters Body */}
            <div className="px-5 py-4 overflow-y-auto space-y-5">
              
              {/* SECTION 1: WHAT ARE YOU LOOKING FOR? */}
              <div className="space-y-2">
                <span className="text-[11px] font-mono font-bold uppercase tracking-wider text-zinc-400">
                  CATEGORY & SPOT TYPE
                </span>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: 'all', label: 'All Nearby' },
                    { id: 'people', label: 'People' },
                    { id: 'coffee', label: 'Coffee / Meet' },
                    { id: 'drinks', label: 'Drinks / Bars' },
                    { id: 'havens', label: 'Safe Havens' },
                    { id: 'active', label: 'Active / Walks' },
                  ].map((cat) => {
                    const isSelected = activeCategory === cat.id;
                    return (
                      <button
                        key={cat.id}
                        type="button"
                        onClick={() => {
                          hapticLight();
                          setActiveCategory(cat.id as any);
                        }}
                        className={`h-11 min-h-[44px] px-2 text-xs font-semibold rounded-xl border transition-all cursor-pointer flex items-center justify-center text-center active:scale-98 ${
                          isSelected
                            ? 'bg-[#221634] text-[#C9A24D] border-[#C9A24D]/60 shadow-[0_0_10px_rgba(201,162,77,0.3)]'
                            : 'bg-[#12141e] text-zinc-300 border-white/[0.08] hover:border-white/20'
                        }`}
                      >
                        {cat.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* SECTION 2: INTENT MODE */}
              <div className="space-y-2">
                <span className="text-[11px] font-mono font-bold uppercase tracking-wider text-zinc-400">
                  INTENT MODE
                </span>
                <div className="grid grid-cols-3 gap-2">
                  {(['All', 'Social', 'Private'] as const).map((mode) => {
                    const isSelected = activeIntentMode === mode;
                    return (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => {
                          hapticLight();
                          setActiveIntentMode(mode);
                        }}
                        className={`h-11 min-h-[44px] px-2 text-xs font-bold rounded-xl border transition-all cursor-pointer flex items-center justify-center active:scale-98 uppercase font-mono ${
                          isSelected
                            ? mode === 'Private'
                              ? 'bg-purple-950/80 text-purple-200 border-purple-500 shadow-[0_0_12px_rgba(111,60,195,0.4)]'
                              : 'bg-[#C9A24D] text-black border-[#C9A24D] shadow-md'
                            : 'bg-[#12141e] text-zinc-300 border-white/[0.08] hover:border-white/20'
                        }`}
                      >
                        {mode}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* SECTION 3: PRIVACY & DISTANCE */}
              <div className="space-y-2">
                <span className="text-[11px] font-mono font-bold uppercase tracking-wider text-zinc-400">
                  PRIVACY & DISTANCE
                </span>

                <div className="p-3 bg-[#12141e] border border-white/[0.08] rounded-xl flex items-center justify-between gap-3">
                  <div>
                    <span className="text-xs font-bold text-white block">±300m Location Cloaking Circles</span>
                    <span className="text-[11px] text-zinc-400 block">Render fuzzy safety zones over exact coordinates</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      hapticLight();
                      setShowJitterCircles(!showJitterCircles);
                    }}
                    className={`w-12 h-6 rounded-full transition-colors p-0.5 cursor-pointer shrink-0 ${
                      showJitterCircles ? 'bg-[#6F3CC3]' : 'bg-zinc-700'
                    }`}
                  >
                    <div className={`w-5 h-5 rounded-full bg-white transition-transform ${
                      showJitterCircles ? 'translate-x-6' : 'translate-x-0'
                    }`} />
                  </button>
                </div>

                <div className="grid grid-cols-3 gap-2 pt-1">
                  {[
                    { km: 1, label: '< 1 km' },
                    { km: 3, label: '< 3 km' },
                    { km: 5, label: 'All Soho' },
                  ].map((dist) => {
                    const isSelected = maxDistanceKm === dist.km;
                    return (
                      <button
                        key={dist.km}
                        type="button"
                        onClick={() => {
                          hapticLight();
                          setMaxDistanceKm(dist.km);
                        }}
                        className={`h-10 min-h-[40px] px-2 text-xs font-semibold rounded-xl border transition-all cursor-pointer flex items-center justify-center font-mono ${
                          isSelected
                            ? 'bg-[#1e2230] text-[#C9A24D] border-[#C9A24D]/60'
                            : 'bg-[#12141e] text-zinc-400 border-white/[0.08]'
                        }`}
                      >
                        {dist.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Sticky Dynamic Apply CTA */}
            <div className="p-4 border-t border-white/[0.08] bg-[#0c0e15] flex items-center gap-2 pb-safe">
              <button
                type="button"
                onClick={handleClearFilters}
                className="h-12 min-h-[44px] px-4 text-xs font-bold text-zinc-400 hover:text-white bg-[#141620] border border-white/10 rounded-xl cursor-pointer"
              >
                Reset
              </button>

              <button
                type="button"
                onClick={() => {
                  hapticLight();
                  setIsFilterDrawerOpen(false);
                }}
                className="flex-1 h-12 min-h-[44px] px-4 text-xs font-black text-black bg-[#C9A24D] hover:bg-[#b58f3b] rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5 shadow-lg uppercase tracking-wide font-sans active:scale-98"
              >
                <span>Show {filteredActiveCount} Active Nearby</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          8. USER'S ACTIVE INTENT BOTTOM SHEET / DRAWER
          Triggered from the top status pill when user has a broadcast live.
         ========================================================================= */}
      {isUserIntentDrawerOpen && activeUserIntent && (
        <div 
          className="fixed inset-0 z-50 flex flex-col justify-end bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
          onClick={() => setIsUserIntentDrawerOpen(false)}
        >
          <div
            className="w-full max-w-lg mx-auto bg-[#0d0f16] border-t border-x border-white/[0.15] rounded-t-3xl shadow-2xl overflow-hidden flex flex-col p-5 space-y-4 animate-in slide-in-from-bottom duration-300 pb-safe"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Drag Handle */}
            <div className="py-1 flex flex-col items-center justify-center">
              <div className="w-12 h-1.5 bg-zinc-600 rounded-full" />
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="relative flex h-2.5 w-2.5">
                  {!activeUserIntent.isPaused && (
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#C9A24D] opacity-75" />
                  )}
                  <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${
                    activeUserIntent.isPaused ? 'bg-zinc-500' : 'bg-[#C9A24D]'
                  }`} />
                </span>
                <h3 className="text-sm font-black uppercase tracking-wider text-white font-sans">
                  {activeUserIntent.isPaused ? 'INTENT PAUSED ON MAP' : 'YOUR LIVE BROADCAST'}
                </h3>
              </div>

              <span className="text-xs font-mono font-bold text-zinc-300 bg-white/[0.06] px-2.5 py-0.5 rounded-md border border-white/10">
                {formatRemainingTime(remainingMinutes)} left
              </span>
            </div>

            <div className="p-3.5 bg-[#12141e] border border-white/[0.08] rounded-2xl space-y-2">
              <div className="flex items-baseline gap-2">
                <span className={`text-xs font-black font-mono uppercase px-2 py-0.5 rounded border ${
                  activeUserIntent.mode === 'private'
                    ? 'bg-purple-950/80 text-purple-300 border-purple-500/40'
                    : 'bg-[#C9A24D]/20 text-[#C9A24D] border-[#C9A24D]/40'
                }`}>
                  {activeUserIntent.mode}
                </span>
                <h4 className="text-base font-black text-white uppercase tracking-wide truncate">
                  {activeUserIntent.intent}
                </h4>
              </div>

              <p className="text-xs text-zinc-300 italic leading-relaxed">
                "{activeUserIntent.description}"
              </p>

              <div className="pt-1 flex items-center justify-between text-[11px] font-mono text-zinc-400">
                <span>{activeUserIntent.when} · {activeUserIntent.travelDistance}</span>
                <span className="text-[#C9A24D]">±300m cloaked in {activeUserIntent.area}</span>
              </div>
            </div>

            {/* Actions: Edit, Pause/Resume, End */}
            <div className="grid grid-cols-3 gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  hapticLight();
                  setIsUserIntentDrawerOpen(false);
                  setIsSetIntentOpen(true);
                }}
                className="h-11 min-h-[44px] px-2 text-xs font-bold text-zinc-200 hover:text-white bg-[#151722] hover:bg-[#1c1f2e] border border-white/10 rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5 uppercase font-mono active:scale-98 shadow-sm"
              >
                <Edit3 className="w-3.5 h-3.5 text-[#C9A24D]" />
                <span>Edit</span>
              </button>

              <button
                type="button"
                onClick={handleTogglePause}
                className="h-11 min-h-[44px] px-2 text-xs font-bold text-zinc-200 hover:text-white bg-[#151722] hover:bg-[#1c1f2e] border border-white/10 rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5 uppercase font-mono active:scale-98 shadow-sm"
              >
                {activeUserIntent.isPaused ? (
                  <>
                    <Play className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Resume</span>
                  </>
                ) : (
                  <>
                    <Pause className="w-3.5 h-3.5 text-amber-400" />
                    <span>Pause</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={handleEndIntent}
                className="h-11 min-h-[44px] px-2 text-xs font-bold text-purple-300 hover:text-white bg-[#221528] hover:bg-[#2c1836] border border-purple-500/40 rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5 uppercase font-mono active:scale-98 shadow-sm"
              >
                <X className="w-3.5 h-3.5 text-purple-400" />
                <span>End</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          9. MUTUAL MATCH / INTEREST NOTIFICATION BANNER
         ========================================================================= */}
      {mutualMatchPulse && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-sm p-4 bg-[#141620] border border-[#C9A24D] rounded-2xl shadow-[0_0_36px_rgba(111,60,195,0.45)] space-y-3 animate-in zoom-in-95 duration-200">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-black tracking-widest text-[#C9A24D] uppercase font-mono">
                    MUTUAL INTEREST
                  </span>
                  <span className="text-zinc-500">·</span>
                  <span className="text-xs text-zinc-300 font-medium">Both active now</span>
                </div>
                <h3 className="text-base font-black text-white tracking-wide uppercase mt-0.5 font-sans">
                  {mutualMatchPulse.intent || mutualMatchPulse.title} · NOW
                </h3>
                <p className="text-xs text-zinc-300 mt-1">
                  You and {mutualMatchPulse.peerName} both expressed mutual availability.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setMutualMatchPulse(null)}
                className="w-8 h-8 rounded-lg text-zinc-400 hover:text-white flex items-center justify-center cursor-pointer"
                aria-label="Dismiss banner"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-2.5 bg-[#0a0b10] rounded-xl border border-white/[0.06] text-[11px] text-zinc-400 space-y-1.5 font-mono">
              <div className="flex items-center gap-2 text-[#C9A24D]">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Identity verified · Approximate location protected (±300m)</span>
              </div>
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
        </div>
      )}

      {/* =========================================================================
          10. SET INTENT BOTTOM SHEET / MODAL
         ========================================================================= */}
      <SetIntentSheet
        isOpen={isSetIntentOpen}
        onClose={() => setIsSetIntentOpen(false)}
        onSaveIntent={handleSaveIntent}
        existingIntent={activeUserIntent}
        safeHavens={safeHavens}
        userNeighborhood={userNeighborhood}
        defaultWhen="Now"
      />
    </div>
  );
};
