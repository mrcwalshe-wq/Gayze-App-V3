import React, { useState, useMemo } from 'react';
import { 
  DatingProfile, 
  SafeHaven, 
  SocialStory, 
  IntentActivityPost, 
  TopLevelIntentMode,
  SOCIAL_INTENTS,
  PRIVATE_INTENTS,
  EncounterIntent
} from '../types';
import { StoriesTray } from './StoriesTray';
import { 
  Heart, 
  MapPin, 
  ShieldCheck, 
  Lock, 
  Search, 
  X, 
  Coffee, 
  Clock, 
  Compass, 
  CheckCircle2, 
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Check,
  Award, 
  QrCode, 
  Zap, 
  Eye, 
  Calendar, 
  LayoutGrid, 
  ListFilter, 
  Sparkles,
  SlidersHorizontal,
  Edit3
} from 'lucide-react';
import { hapticLight, triggerVibration } from '../services/hapticService';
import { CountdownPill } from './CountdownPill';
import { CompatibilitySnapshot } from './CompatibilitySnapshot';
import { TrustReputationSnapshot } from './TrustReputationSnapshot';
import { UserProfile, UserActiveIntent } from '../types';

export type DiscoveryDisplayMode = 'grid' | 'feed';
export type TimingFilterMode = 'all' | 'right_now' | 'later';

interface DatingGridViewProps {
  profiles: DatingProfile[];
  safeHavens: SafeHaven[];
  userNeighborhood: string;
  stories?: SocialStory[];
  intentPosts?: IntentActivityPost[];
  activeUserIntent?: UserActiveIntent | null;
  currentUser?: UserProfile;
  onOpenDirectChatWithProfile: (profile: DatingProfile) => void;
  onProposeHavenDate: (profile: DatingProfile, havenName?: string) => void;
  onToggleFavorite: (profileId: string) => void;
  onOpenQRWithPeer?: (profile: DatingProfile) => void;
  onGazeAtPeer?: (peerName: string) => void;
  onOpenScheduleMeeting?: (peerName: string) => void;
  onOpenSetIntent?: () => void;
}

export const DatingGridView: React.FC<DatingGridViewProps> = ({
  profiles,
  safeHavens,
  userNeighborhood,
  stories = [],
  intentPosts = [],
  activeUserIntent,
  currentUser,
  onOpenDirectChatWithProfile,
  onProposeHavenDate,
  onToggleFavorite,
  onOpenQRWithPeer,
  onGazeAtPeer,
  onOpenScheduleMeeting,
  onOpenSetIntent,
}) => {
  const [selectedProfile, setSelectedProfile] = useState<DatingProfile | null>(null);
  
  // Core Intent Architecture: Top-Level Mode + Specific Intent
  const [mode, setMode] = useState<TopLevelIntentMode>('social');
  const [selectedIntent, setSelectedIntent] = useState<EncounterIntent>('All');
  
  // Filtering & Search states
  const [timingFilter, setTimingFilter] = useState<TimingFilterMode>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [onlyOnline, setOnlyOnline] = useState<boolean>(false);
  const [maxDistanceKm, setMaxDistanceKm] = useState<number>(5);
  const [safetyVerifiedOnly, setSafetyVerifiedOnly] = useState<boolean>(false);
  const [highTrustOnly, setHighTrustOnly] = useState<boolean>(false);
  const [safeHavenOnly, setSafeHavenOnly] = useState<boolean>(false);

  // View state: Grid vs IntentBoard (feed)
  const [displayMode, setDisplayMode] = useState<DiscoveryDisplayMode>('grid');

  // Sheet & Popover states
  const [isFilterDrawerOpen, setIsFilterDrawerOpen] = useState<boolean>(false);
  const [isIntentSelectorOpen, setIsIntentSelectorOpen] = useState<boolean>(false);
  const [isViewMenuOpen, setIsViewMenuOpen] = useState<boolean>(false);

  // Drawer collapsible sections
  const [isTimingSectionOpen, setIsTimingSectionOpen] = useState<boolean>(true);
  const [isLookingForSectionOpen, setIsLookingForSectionOpen] = useState<boolean>(true);
  const [isAvailabilitySectionOpen, setIsAvailabilitySectionOpen] = useState<boolean>(true);
  const [isDistanceSectionOpen, setIsDistanceSectionOpen] = useState<boolean>(true);
  const [isPreferencesSectionOpen, setIsPreferencesSectionOpen] = useState<boolean>(false);
  const [isLocationSectionOpen, setIsLocationSectionOpen] = useState<boolean>(false);

  const [imageErrors, setImageErrors] = useState<Record<string, boolean>>({});
  const [gazedPeerNames, setGazedPeerNames] = useState<Set<string>>(new Set());

  const handleGaze = (e: React.MouseEvent, peerName: string) => {
    e.stopPropagation();
    triggerVibration([40, 70]);
    setGazedPeerNames((prev) => new Set(prev).add(peerName));
    if (onGazeAtPeer) onGazeAtPeer(peerName);
  };

  // Switch between Social and Private top-level modes
  const handleModeSwitch = (targetMode: TopLevelIntentMode) => {
    if (targetMode === mode) return;
    hapticLight();
    setMode(targetMode);

    // Keep state consistent: if current intent doesn't exist in new mode, reset to 'All'
    if (targetMode === 'social') {
      if (!(SOCIAL_INTENTS as readonly string[]).includes(selectedIntent)) {
        setSelectedIntent('All');
      }
    } else {
      if (!(PRIVATE_INTENTS as readonly string[]).includes(selectedIntent)) {
        setSelectedIntent('All');
      }
    }
  };

  // Select intent from compact selector
  const handleSelectIntent = (intent: EncounterIntent) => {
    hapticLight();
    setSelectedIntent(intent);
    setIsIntentSelectorOpen(false);
  };

  // Clear all non-default filters
  const handleClearAllFilters = () => {
    hapticLight();
    setSelectedIntent('All');
    setTimingFilter('all');
    setOnlyOnline(false);
    setMaxDistanceKm(20);
    setSafetyVerifiedOnly(false);
    setHighTrustOnly(false);
    setSafeHavenOnly(false);
    setSearchQuery('');
  };

  // Map each profile to its top-level context mode (Social or Private)
  const getProfileMode = (profile: DatingProfile): TopLevelIntentMode => {
    if (profile.intentMode) return profile.intentMode;
    return profile.lookingFor === 'casual' ? 'private' : 'social';
  };

  // Map each profile to an encounter intent
  const getProfileIntent = (profile: DatingProfile): EncounterIntent => {
    if (profile.intent) return profile.intent;
    switch (profile.lookingFor) {
      case 'casual':
        return 'Hookup';
      case 'dates_coffee':
        return 'Drinks';
      case 'dating':
        return 'Date';
      case 'friends':
        return 'Meet';
      case 'relationship':
        return 'Chat';
      default:
        return 'Meet';
    }
  };

  const getProfileAvailability = (profile: DatingProfile): string => {
    if (profile.hasRightNowIntent && profile.rightNowDetail) return profile.rightNowDetail;
    if (profile.isOnline) return 'Available now · ~2 hrs';
    if (profile.lastActive?.includes('m') || profile.lastActive?.includes('now')) return 'Available tonight';
    return 'Open to meeting';
  };

  // Active filter count for badge
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (selectedIntent !== 'All') count++;
    if (timingFilter !== 'all') count++;
    if (onlyOnline) count++;
    if (maxDistanceKm !== 20) count++;
    if (safetyVerifiedOnly) count++;
    if (highTrustOnly) count++;
    if (safeHavenOnly) count++;
    if (searchQuery.trim().length > 0) count++;
    return count;
  }, [
    selectedIntent, 
    timingFilter, 
    onlyOnline, 
    maxDistanceKm, 
    safetyVerifiedOnly, 
    highTrustOnly, 
    safeHavenOnly, 
    searchQuery
  ]);

  const filteredProfiles = useMemo(() => {
    return profiles.filter((p) => {
      // 1. Top-Level Mode Filter (Social vs Private)
      const profileMode = getProfileMode(p);
      if (profileMode !== mode) {
        return false;
      }

      // 2. Specific Intent Filter
      if (selectedIntent !== 'All') {
        const pIntent = getProfileIntent(p);
        if (pIntent !== selectedIntent) {
          // Broad matching for general 'Hookup'
          if (selectedIntent === 'Hookup' && pIntent.startsWith('Hookup')) {
            // matches
          } else {
            return false;
          }
        }
      }

      // 3. Timing Filter (Right Now vs Later)
      if (timingFilter === 'right_now') {
        if (!p.hasRightNowIntent && !p.isOnline) return false;
      } else if (timingFilter === 'later') {
        if (p.hasRightNowIntent) return false;
      }

      // 4. Online Filter
      if (onlyOnline && !p.isOnline) {
        return false;
      }

      // 5. Distance Filter
      if (p.approxDistanceKm > maxDistanceKm) {
        return false;
      }

      // 6. Safety Verified Only
      if (safetyVerifiedOnly && !p.safetyVerified) {
        return false;
      }

      // 7. High Trust Only (>=95)
      if (highTrustOnly && (p.reliabilityScore || 90) < 95) {
        return false;
      }

      // 8. Safe Haven Only
      if (safeHavenOnly && !p.favoriteSafeHaven) {
        return false;
      }

      // 9. Text Search Filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const pIntent = getProfileIntent(p).toLowerCase();
        const matchesName = p.name.toLowerCase().includes(q);
        const matchesBio = p.bio.toLowerCase().includes(q);
        const matchesHeadline = p.headline.toLowerCase().includes(q);
        const matchesNeighborhood = p.neighborhood.toLowerCase().includes(q);
        const matchesInterests = p.interests.some((i) => i.toLowerCase().includes(q));
        const matchesIntent = pIntent.includes(q);
        if (!matchesName && !matchesBio && !matchesHeadline && !matchesNeighborhood && !matchesInterests && !matchesIntent) {
          return false;
        }
      }

      return true;
    });
  }, [
    profiles, 
    mode, 
    selectedIntent, 
    timingFilter, 
    onlyOnline, 
    maxDistanceKm, 
    safetyVerifiedOnly, 
    highTrustOnly, 
    safeHavenOnly, 
    searchQuery
  ]);

  const filteredIntentPosts = useMemo(() => {
    return intentPosts.filter((post) => {
      const postMode = (post.category === 'private' || post.category === 'spicy') ? 'private' : 'social';
      if (postMode !== mode) {
        return false;
      }

      if (selectedIntent !== 'All') {
        if (post.intent !== selectedIntent) {
          if (selectedIntent === 'Hookup' && post.intent.startsWith('Hookup')) {
            // matches
          } else {
            return false;
          }
        }
      }

      if (timingFilter === 'right_now') {
        if (post.timing !== 'Right Now' && post.timing !== 'Next 1 hour') return false;
      } else if (timingFilter === 'later') {
        if (post.timing === 'Right Now') return false;
      }

      if (onlyOnline && post.timing !== 'Right Now') {
        return false;
      }

      if (post.approxDistanceKm > maxDistanceKm) {
        return false;
      }

      if (safetyVerifiedOnly && !post.isSafeHaven) {
        return false;
      }

      if (highTrustOnly && post.reliabilityScore < 95) {
        return false;
      }

      if (safeHavenOnly && !post.isSafeHaven) {
        return false;
      }

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          post.activityTitle.toLowerCase().includes(q) ||
          post.description.toLowerCase().includes(q) ||
          post.peerName.toLowerCase().includes(q) ||
          post.venueName.toLowerCase().includes(q) ||
          post.intent.toLowerCase().includes(q)
        );
      }

      return true;
    });
  }, [
    intentPosts, 
    mode, 
    selectedIntent, 
    timingFilter, 
    onlyOnline, 
    maxDistanceKm, 
    safetyVerifiedOnly, 
    highTrustOnly, 
    safeHavenOnly, 
    searchQuery
  ]);

  const handleImageError = (profileId: string) => {
    setImageErrors((prev) => ({ ...prev, [profileId]: true }));
  };

  const currentIntentOptions = mode === 'social' ? SOCIAL_INTENTS : PRIVATE_INTENTS;

  return (
    <div className={`space-y-4 transition-transform duration-200 ${isFilterDrawerOpen ? 'scale-[0.985] origin-top opacity-95' : ''}`}>
      {/* =========================================================================
          1. STORIES TRAY (COMPACT MOBILE-FIRST SOCIAL LAYER)
         ========================================================================= */}
      {stories.length > 0 && (
        <div className="pb-1 border-b border-white/[0.06]">
          <StoriesTray
            stories={stories}
            datingProfiles={profiles}
            onOpenDirectChatWithProfile={onOpenDirectChatWithProfile}
            onGazeAtPeer={(name) => {
              setGazedPeerNames((prev) => new Set(prev).add(name));
              if (onGazeAtPeer) onGazeAtPeer(name);
            }}
            onOpenSetIntent={onOpenSetIntent}
          />
        </div>
      )}

      {/* =========================================================================
          2. HEADER & SEARCH
         ========================================================================= */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-white/[0.08]">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#C9A24D]" />
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white font-sans uppercase">
              Discover & Intent
            </h1>
          </div>
          <p className="text-xs text-zinc-400 mt-0.5">
            Nearby peers and active intentions · Encrypted & cloaked by ~300m
          </p>
        </div>

        {/* Quick Search bar */}
        <div className="relative w-full sm:w-64">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search name, intent, vibe…"
            className="w-full bg-[#11131a] border border-white/10 rounded-xl pl-9 pr-8 py-2 text-xs text-white placeholder-zinc-500 focus:border-[#C9A24D] focus:outline-none"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-white cursor-pointer"
              aria-label="Clear search"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* =========================================================================
          2B. ACTIVE USER INTENT STATUS BANNER (CORE INTENT-FIRST DISCOVERY)
         ========================================================================= */}
      {activeUserIntent ? (
        <div className="p-3 rounded-2xl bg-[#14121f]/90 border border-[#6F3CC3]/40 shadow-[0_0_20px_rgba(111,60,195,0.15)] backdrop-blur-xl flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-[#231738] border border-purple-500/50 flex items-center justify-center text-purple-300 shrink-0">
              <Sparkles className="w-4 h-4 text-[#C9A24D]" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] font-mono uppercase font-bold text-zinc-400">YOUR ACTIVE INTENT</span>
                <span className="text-zinc-500">·</span>
                <span className="text-xs font-bold text-white uppercase font-mono tracking-wide">
                  {activeUserIntent.mode} · {activeUserIntent.intent}
                </span>
                <CountdownPill expiresAt={activeUserIntent.expiresAt} />
              </div>
              <p className="text-[11px] text-zinc-300 truncate mt-0.5">
                "{activeUserIntent.description || 'Active nearby'}" · {activeUserIntent.when} · {activeUserIntent.travelDistance}
              </p>
            </div>
          </div>

          {onOpenSetIntent && (
            <button
              type="button"
              onClick={onOpenSetIntent}
              className="h-8 px-3 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 text-xs font-semibold text-zinc-200 hover:text-white transition-colors cursor-pointer self-start sm:self-auto shrink-0 flex items-center gap-1.5 active:scale-95"
            >
              <Edit3 className="w-3 h-3 text-[#C9A24D]" />
              <span>Edit Intent</span>
            </button>
          )}
        </div>
      ) : onOpenSetIntent ? (
        <div className="p-3 rounded-2xl bg-[#11131a]/80 border border-white/[0.08] flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-[#1a1726] border border-[#C9A24D]/30 flex items-center justify-center text-[#C9A24D] shrink-0">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <div className="text-xs font-bold text-white">Broadcast Your Intention</div>
              <p className="text-[11px] text-zinc-400">Set what you're looking for to reveal live mutual alignment & badges.</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onOpenSetIntent}
            className="h-8 px-3.5 rounded-xl bg-[#C9A24D] hover:bg-[#b58f3b] text-black text-xs font-bold transition-all cursor-pointer shrink-0 shadow active:scale-95"
          >
            Set Intent
          </button>
        </div>
      ) : null}

      {/* =========================================================================
          3. SIMPLIFIED DISCOVER CONTROLS ROW:
             [ ✦ Intent · Mode · Selection ] [ Filters (N) ] [ View: Grid/Feed ]
         ========================================================================= */}
      <div className="space-y-2.5">
        <div className="flex items-center gap-2">
          {/* Prominent Intent Control (Core GAYZE Mechanic) */}
          <button
            type="button"
            onClick={() => {
              hapticLight();
              setIsIntentSelectorOpen(true);
            }}
            className={`h-11 min-h-[44px] flex-1 px-3.5 rounded-xl border flex items-center justify-between gap-2 transition-all cursor-pointer select-none active:scale-[0.98] ${
              mode === 'private'
                ? 'bg-[#181324] hover:bg-[#201832] border-[#6F3CC3]/60 text-purple-200 shadow-[0_0_16px_rgba(111,60,195,0.2)]'
                : 'bg-[#191610] hover:bg-[#221e14] border-[#C9A24D]/50 text-amber-200 shadow-[0_0_16px_rgba(201,162,77,0.18)]'
            }`}
            aria-label="Select Intent"
          >
            <div className="flex items-center gap-2 truncate">
              <Sparkles className={`w-3.5 h-3.5 shrink-0 ${mode === 'private' ? 'text-[#c084fc]' : 'text-[#C9A24D]'}`} />
              <div className="flex items-baseline gap-1.5 truncate">
                <span className="text-[10px] font-mono uppercase tracking-wider font-bold text-zinc-400">
                  {timingFilter === 'right_now' ? 'Right Now' : timingFilter === 'later' ? 'Later' : 'Intent'}
                </span>
                <span className="text-zinc-500 text-xs">·</span>
                <span className="text-xs sm:text-sm font-bold truncate">
                  {mode === 'private' ? 'Private' : 'Social'} · {selectedIntent}
                </span>
              </div>
            </div>
            <ChevronDown className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
          </button>

          {/* Compact Filter Button with Active Filter Count Badge */}
          <button
            type="button"
            onClick={() => {
              hapticLight();
              setIsFilterDrawerOpen(true);
            }}
            className={`h-11 min-h-[44px] px-3.5 rounded-xl border flex items-center gap-2 text-xs sm:text-sm font-semibold transition-all cursor-pointer select-none active:scale-[0.98] shrink-0 ${
              activeFilterCount > 0
                ? 'bg-[#1a1726] border-[#C9A24D]/60 text-white shadow-sm'
                : 'bg-[#11131a] hover:bg-[#161824] border-white/10 text-zinc-300 hover:text-white'
            }`}
            aria-label="Open Filter Drawer"
          >
            <SlidersHorizontal className={`w-3.5 h-3.5 ${activeFilterCount > 0 ? 'text-[#C9A24D]' : 'text-zinc-400'}`} />
            <span>Filters</span>
            {activeFilterCount > 0 && (
              <span className="w-5 h-5 rounded-full bg-[#C9A24D] text-black text-[10px] font-black flex items-center justify-center font-mono">
                {activeFilterCount}
              </span>
            )}
          </button>

          {/* View Control: Grid vs IntentBoard (Clean View Switcher) */}
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => setIsViewMenuOpen(!isViewMenuOpen)}
              className="h-11 min-h-[44px] px-3 rounded-xl bg-[#11131a] hover:bg-[#161824] border border-white/10 flex items-center gap-1.5 text-xs font-semibold text-zinc-200 transition-colors cursor-pointer select-none active:scale-[0.98]"
              aria-label="Toggle view mode"
            >
              {displayMode === 'grid' ? (
                <LayoutGrid className="w-3.5 h-3.5 text-[#C9A24D]" />
              ) : (
                <ListFilter className="w-3.5 h-3.5 text-[#6F3CC3]" />
              )}
              <span className="hidden sm:inline font-mono uppercase tracking-wider text-[11px]">
                {displayMode === 'grid' ? 'Grid' : 'IntentBoard'}
              </span>
              <ChevronDown className={`w-3.5 h-3.5 text-zinc-400 transition-transform duration-200 ${isViewMenuOpen ? 'rotate-180' : ''}`} />
            </button>

            {/* View Selector Dropdown */}
            {isViewMenuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setIsViewMenuOpen(false)} />
                <div className="absolute right-0 top-full mt-1.5 z-50 w-44 bg-[#11131a]/98 backdrop-blur-xl border border-white/15 rounded-2xl shadow-2xl p-1.5 animate-in fade-in zoom-in-95 duration-150">
                  <div className="px-2.5 py-1 text-[10px] font-mono uppercase tracking-widest text-zinc-500 font-bold border-b border-white/[0.06] mb-1">
                    VIEW
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setDisplayMode('grid');
                      setIsViewMenuOpen(false);
                      hapticLight();
                    }}
                    className={`w-full px-2.5 py-2 rounded-xl text-xs font-medium flex items-center justify-between transition-colors cursor-pointer ${
                      displayMode === 'grid'
                        ? 'bg-[#1c1f2b] text-white font-bold'
                        : 'text-zinc-400 hover:text-white hover:bg-white/[0.04]'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <LayoutGrid className="w-3.5 h-3.5 text-[#C9A24D]" />
                      <span>Grid</span>
                    </div>
                    {displayMode === 'grid' && <Check className="w-3.5 h-3.5 text-[#C9A24D]" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDisplayMode('feed');
                      setIsViewMenuOpen(false);
                      hapticLight();
                    }}
                    className={`w-full px-2.5 py-2 rounded-xl text-xs font-medium flex items-center justify-between transition-colors cursor-pointer ${
                      displayMode === 'feed'
                        ? 'bg-[#1c1f2b] text-white font-bold'
                        : 'text-zinc-400 hover:text-white hover:bg-white/[0.04]'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <ListFilter className="w-3.5 h-3.5 text-[#6F3CC3]" />
                      <span>IntentBoard</span>
                    </div>
                    {displayMode === 'feed' && <Check className="w-3.5 h-3.5 text-[#6F3CC3]" />}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        {/* =========================================================================
            ACTIVE FILTER CHIPS (Horizontally Scrollable, 1-Tap Removable)
           ========================================================================= */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
          {/* Top-Level Mode Chip */}
          <button
            type="button"
            onClick={() => handleModeSwitch(mode === 'social' ? 'private' : 'social')}
            className={`shrink-0 h-7 px-2.5 rounded-lg text-xs font-bold font-mono tracking-tight flex items-center gap-1.5 transition-all cursor-pointer ${
              mode === 'private'
                ? 'bg-purple-950/80 text-purple-200 border border-purple-500/40'
                : 'bg-[#C9A24D]/15 text-[#C9A24D] border border-[#C9A24D]/35'
            }`}
            title="Tap to switch between Social and Private mode"
          >
            <span className={`w-1.5 h-1.5 rounded-full ${mode === 'private' ? 'bg-[#9333EA]' : 'bg-[#C9A24D]'}`} />
            <span>{mode.toUpperCase()}</span>
          </button>

          {/* Selected Intent Chip */}
          {selectedIntent !== 'All' && (
            <div className="shrink-0 h-7 px-2.5 rounded-lg bg-[#181a24] border border-white/10 text-xs font-medium text-zinc-200 flex items-center gap-1.5 shadow-sm">
              <span className="text-zinc-400 font-mono text-[10px]">Intent:</span>
              <span className="font-semibold text-white">{selectedIntent}</span>
              <button
                type="button"
                onClick={() => {
                  setSelectedIntent('All');
                  hapticLight();
                }}
                className="text-zinc-400 hover:text-white p-0.5 ml-0.5 cursor-pointer"
                aria-label="Remove intent filter"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          )}

          {/* Timing Chip */}
          {timingFilter !== 'all' && (
            <div className="shrink-0 h-7 px-2.5 rounded-lg bg-[#181a24] border border-white/10 text-xs font-medium text-zinc-200 flex items-center gap-1.5 shadow-sm">
              <span className={`w-1.5 h-1.5 rounded-full ${timingFilter === 'right_now' ? 'bg-[#C9A24D]' : 'bg-[#9333EA]'}`} />
              <span className="font-semibold text-white">{timingFilter === 'right_now' ? 'Right Now' : 'Later'}</span>
              <button
                type="button"
                onClick={() => {
                  setTimingFilter('all');
                  hapticLight();
                }}
                className="text-zinc-400 hover:text-white p-0.5 ml-0.5 cursor-pointer"
                aria-label="Remove timing filter"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          )}

          {/* Active Now Chip */}
          {onlyOnline && (
            <div className="shrink-0 h-7 px-2.5 rounded-lg bg-emerald-950/60 border border-emerald-500/40 text-xs font-semibold text-emerald-300 flex items-center gap-1.5 shadow-sm">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span>Active now</span>
              <button
                type="button"
                onClick={() => {
                  setOnlyOnline(false);
                  hapticLight();
                }}
                className="text-emerald-400 hover:text-white p-0.5 ml-0.5 cursor-pointer"
                aria-label="Remove online filter"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          )}

          {/* Distance Radius Chip */}
          {maxDistanceKm !== 20 && (
            <div className="shrink-0 h-7 px-2.5 rounded-lg bg-[#181a24] border border-white/10 text-xs font-medium text-zinc-200 flex items-center gap-1.5 shadow-sm">
              <MapPin className="w-3 h-3 text-[#C9A24D]" />
              <span className="font-semibold text-white">Within {maxDistanceKm} km</span>
              <button
                type="button"
                onClick={() => {
                  setMaxDistanceKm(20);
                  hapticLight();
                }}
                className="text-zinc-400 hover:text-white p-0.5 ml-0.5 cursor-pointer"
                aria-label="Reset distance filter"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          )}

          {/* Verified Only Chip */}
          {safetyVerifiedOnly && (
            <div className="shrink-0 h-7 px-2.5 rounded-lg bg-[#181a24] border border-emerald-500/30 text-xs font-medium text-emerald-300 flex items-center gap-1.5 shadow-sm">
              <ShieldCheck className="w-3 h-3 text-emerald-400" />
              <span>Verified only</span>
              <button
                type="button"
                onClick={() => {
                  setSafetyVerifiedOnly(false);
                  hapticLight();
                }}
                className="text-zinc-400 hover:text-white p-0.5 ml-0.5 cursor-pointer"
                aria-label="Remove verified filter"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          )}

          {/* High Trust Chip */}
          {highTrustOnly && (
            <div className="shrink-0 h-7 px-2.5 rounded-lg bg-[#181a24] border border-[#C9A24D]/30 text-xs font-medium text-[#C9A24D] flex items-center gap-1.5 shadow-sm">
              <Award className="w-3 h-3 text-[#C9A24D]" />
              <span>Trust ≥95</span>
              <button
                type="button"
                onClick={() => {
                  setHighTrustOnly(false);
                  hapticLight();
                }}
                className="text-zinc-400 hover:text-white p-0.5 ml-0.5 cursor-pointer"
                aria-label="Remove trust filter"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          )}

          {/* Safe Haven Only Chip */}
          {safeHavenOnly && (
            <div className="shrink-0 h-7 px-2.5 rounded-lg bg-[#181a24] border border-white/10 text-xs font-medium text-zinc-200 flex items-center gap-1.5 shadow-sm">
              <Coffee className="w-3 h-3 text-[#C9A24D]" />
              <span>Safe Haven</span>
              <button
                type="button"
                onClick={() => {
                  setSafeHavenOnly(false);
                  hapticLight();
                }}
                className="text-zinc-400 hover:text-white p-0.5 ml-0.5 cursor-pointer"
                aria-label="Remove safe haven filter"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          )}

          {/* Search Query Chip */}
          {searchQuery.trim() && (
            <div className="shrink-0 h-7 px-2.5 rounded-lg bg-[#181a24] border border-white/10 text-xs font-medium text-zinc-200 flex items-center gap-1.5 shadow-sm">
              <span className="text-zinc-400 font-mono text-[10px]">Query:</span>
              <span className="font-semibold text-white truncate max-w-[120px]">"{searchQuery}"</span>
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  hapticLight();
                }}
                className="text-zinc-400 hover:text-white p-0.5 ml-0.5 cursor-pointer"
                aria-label="Clear search query"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          )}

          {/* Clear all text button */}
          {activeFilterCount > 0 && (
            <button
              type="button"
              onClick={handleClearAllFilters}
              className="shrink-0 text-xs text-zinc-400 hover:text-[#C9A24D] px-2 py-1 transition-colors cursor-pointer font-medium"
            >
              Clear all
            </button>
          )}
        </div>
      </div>

      {/* =========================================================================
          4. INTENTBOARD FEED VIEW: "WHAT ARE PEOPLE ACTUALLY DOING?"
         ========================================================================= */}
      {displayMode === 'feed' ? (
        <div className="space-y-3">
          {filteredIntentPosts.length === 0 ? (
            <div className="p-10 text-center rounded-2xl bg-[#11131a] border border-white/10 space-y-2">
              <Compass className="w-8 h-8 text-zinc-500 mx-auto" />
              <h3 className="text-sm font-semibold text-white">No activity posts match your filter</h3>
              <p className="text-xs text-zinc-400">
                Try switching between Social and Private or resetting the intent filter.
              </p>
              <button
                type="button"
                onClick={handleClearAllFilters}
                className="mt-2 h-8 px-3 text-xs font-semibold text-black bg-[#C9A24D] hover:bg-[#b58f3b] rounded-lg transition-colors cursor-pointer"
              >
                Reset all filters
              </button>
            </div>
          ) : (
            filteredIntentPosts.map((post) => {
              const matchedProfile = profiles.find((p) => p.name.toLowerCase() === post.peerName.toLowerCase());
              const postMode = (post.category === 'private' || post.category === 'spicy') ? 'private' : 'social';
              const isPrivate = postMode === 'private';

              return (
                <div
                  key={post.id}
                  className="p-4 sm:p-5 rounded-2xl bg-[#11131a] border border-white/[0.08] hover:border-white/20 transition-all space-y-3 shadow-sm"
                >
                  {/* Post Top: Peer Info, Timing & Realm */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-11 h-11 rounded-xl overflow-hidden border border-white/20 bg-[#171922] shrink-0">
                        {post.photoUrl ? (
                          <img src={post.photoUrl} alt={post.peerName} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center font-bold text-white bg-zinc-800">
                            {post.peerName.charAt(0)}
                          </div>
                        )}
                      </div>

                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-white">{post.peerName}</span>
                          <span
                            className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider font-mono ${
                              isPrivate
                                ? 'bg-purple-950/80 text-purple-300 border border-purple-500/40'
                                : 'bg-[#C9A24D]/20 text-[#C9A24D] border border-[#C9A24D]/35'
                            }`}
                          >
                            {postMode.toUpperCase()} · {post.intent}
                          </span>
                        </div>
                        <div className="text-[11px] text-zinc-400 flex items-center gap-1.5 mt-0.5">
                          <span>{post.neighborhood}</span>
                          <span>·</span>
                          <span>~{post.approxDistanceKm} km</span>
                          <span>·</span>
                          <span className="text-emerald-400 font-mono">Trust {post.reliabilityScore}/100</span>
                        </div>
                      </div>
                    </div>

                    <div className="text-[11px] font-mono px-2.5 py-1 rounded-lg bg-[#141620] border border-white/10 text-zinc-300 shrink-0">
                      {post.timing}
                    </div>
                  </div>

                  {/* Activity Content */}
                  <div>
                    <h3 className="text-sm font-bold text-white leading-snug">{post.activityTitle}</h3>
                    <p className="text-xs text-zinc-300 mt-1 leading-relaxed">{post.description}</p>
                  </div>

                  {/* Venue / Safe Haven indicator */}
                  <div className="pt-2 border-t border-white/[0.06] flex items-center justify-between text-xs text-zinc-400">
                    <div className="flex items-center gap-1.5">
                      <MapPin className="w-3.5 h-3.5 text-[#C9A24D] shrink-0" />
                      <span className="truncate max-w-[240px] text-zinc-300">{post.venueName}</span>
                    </div>

                    {post.isSafeHaven && (
                      <span className="text-[10px] text-emerald-400 font-mono flex items-center gap-1">
                        <ShieldCheck className="w-3 h-3 text-emerald-400" />
                        Verified Safe Haven
                      </span>
                    )}
                  </div>

                  {/* Immediate 1-Tap Action Row: Gaze (👀) + Message + Meet */}
                  <div className="pt-2 grid grid-cols-3 gap-2">
                    <button
                      onClick={(e) => handleGaze(e, post.peerName)}
                      className={`h-11 min-h-[44px] rounded-xl flex items-center justify-center gap-1.5 text-xs font-bold transition-all cursor-pointer ${
                        gazedPeerNames.has(post.peerName)
                          ? 'bg-purple-950 text-purple-300 border border-purple-500/60'
                          : 'bg-[#1c1f2b] hover:bg-[#252838] text-white border border-white/10 active:scale-95'
                      }`}
                    >
                      <Eye className="w-4 h-4 text-[#C9A24D]" />
                      <span>{gazedPeerNames.has(post.peerName) ? 'Gazed' : 'Gaze 👀'}</span>
                    </button>

                    {onOpenScheduleMeeting && (
                      <button
                        onClick={() => onOpenScheduleMeeting(post.peerName)}
                        className="h-11 min-h-[44px] rounded-xl bg-[#1c1f2b] hover:bg-[#252838] text-[#C9A24D] border border-[#C9A24D]/30 font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer transition-colors active:scale-95"
                      >
                        <Calendar className="w-3.5 h-3.5" />
                        <span>Meet Here</span>
                      </button>
                    )}

                    <button
                      onClick={() => {
                        if (matchedProfile) {
                          onOpenDirectChatWithProfile(matchedProfile);
                        } else {
                          const syntheticProfile: DatingProfile = {
                            id: post.peerId,
                            name: post.peerName,
                            age: 29,
                            photoUrl: post.photoUrl || '',
                            neighborhood: post.neighborhood,
                            approxDistanceKm: post.approxDistanceKm,
                            headline: post.activityTitle,
                            bio: post.description,
                            lookingFor: isPrivate ? 'casual' : 'dating',
                            lookingForLabel: post.intent,
                            intentMode: postMode,
                            intent: post.intent,
                            heightCm: 180,
                            interests: ['Coffee', 'Design'],
                            tribes: ['Creative'],
                            isOnline: true,
                            lastActive: 'Active now',
                            safetyVerified: true,
                            peerPublicKey: 'pk_' + post.peerId + '_simulated_key',
                            reliabilityScore: post.reliabilityScore,
                            verifiedPeersCount: 12,
                          };
                          onOpenDirectChatWithProfile(syntheticProfile);
                        }
                      }}
                      className="h-11 min-h-[44px] rounded-xl bg-[#C9A24D] hover:bg-[#b58f3b] text-black font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer shadow transition-all active:scale-95"
                    >
                      <Lock className="w-3 h-3" />
                      <span>Connect</span>
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      ) : (
        /* =========================================================================
            5. PROFILE GRID: CLEAN, HIGH-INTENT DISCOVERY CARDS
           ========================================================================= */
        filteredProfiles.length === 0 ? (
          <div className="p-12 text-center rounded-2xl bg-[#11131a] border border-white/10 space-y-3">
            <Compass className="w-8 h-8 text-zinc-500 mx-auto" />
            <h3 className="text-sm font-semibold text-white">No members match this intent</h3>
            <p className="text-xs text-zinc-400 max-w-sm mx-auto">
              Try resetting the intent selector to All or adjusting the distance radius to see more members nearby.
            </p>
            <button
              onClick={handleClearAllFilters}
              className="h-9 px-4 text-xs font-semibold text-black bg-[#C9A24D] hover:bg-[#b58f3b] rounded-xl transition-colors cursor-pointer"
            >
              Show All {mode === 'social' ? 'Social' : 'Private'}
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-4 gap-3 sm:gap-4">
            {filteredProfiles.map((profile) => {
              const hasError = imageErrors[profile.id];
              const intent = getProfileIntent(profile);
              const profileMode = getProfileMode(profile);
              const reliability = profile.reliabilityScore || 96;

              return (
                <div
                  key={profile.id}
                  onClick={() => setSelectedProfile(profile)}
                  className="group relative bg-[#11131a] rounded-2xl overflow-hidden border border-white/[0.08] hover:border-[#C9A24D]/50 transition-all cursor-pointer flex flex-col justify-end aspect-[3/4] select-none shadow-md"
                >
                  {/* Photo Container */}
                  <div className="absolute inset-0 bg-[#090a0e]">
                    {!hasError ? (
                      <img
                        src={profile.photoUrl}
                        alt={profile.name}
                        onError={() => handleImageError(profile.id)}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover object-center group-hover:scale-105 transition-transform duration-300"
                      />
                    ) : (
                      <div className="w-full h-full bg-gradient-to-br from-[#171922] to-[#090a0e] flex flex-col items-center justify-center p-4 text-center">
                        <div className="w-14 h-14 rounded-full bg-[#1c1f2b] border border-white/10 flex items-center justify-center text-base font-bold text-[#C9A24D]">
                          {profile.name.charAt(0)}
                        </div>
                        <span className="text-xs font-semibold text-zinc-200 mt-2">{profile.name}</span>
                      </div>
                    )}

                    {/* High contrast gradient scrim */}
                    <div className="absolute inset-0 bg-gradient-to-t from-[#090a0e] via-[#090a0e]/50 to-transparent pointer-events-none" />
                  </div>

                  {/* Top Corner Overlays: Active Status & Actions (Gaze + Favorite) */}
                  <div className="absolute top-2.5 left-2.5 right-2.5 flex items-start justify-between z-10 gap-1">
                    <div className="flex flex-col gap-1 items-start min-w-0">
                      <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-black/75 backdrop-blur-md border border-white/10 text-[10px] text-zinc-200 font-medium">
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            profile.hasRightNowIntent
                              ? 'bg-amber-400 animate-pulse'
                              : profile.isOnline
                              ? 'bg-emerald-400 animate-pulse'
                              : 'bg-zinc-500'
                          }`}
                        />
                        <span className="font-mono">
                          {profile.hasRightNowIntent
                            ? 'Right Now'
                            : profile.isOnline
                            ? 'Active'
                            : profile.lastActive}
                        </span>
                      </div>

                      {/* Intent Countdown if defined & active */}
                      {profile.intentExpiresAt && profile.hasRightNowIntent && (
                        <CountdownPill expiresAt={profile.intentExpiresAt} />
                      )}
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {/* 1-Tap Gaze (👀) */}
                      <button
                        onClick={(e) => handleGaze(e, profile.name)}
                        className={`w-8 h-8 rounded-lg flex items-center justify-center backdrop-blur-md border transition-colors cursor-pointer ${
                          gazedPeerNames.has(profile.name)
                            ? 'bg-purple-950/80 border-purple-500/60 text-purple-300'
                            : 'bg-black/60 border-white/10 text-zinc-300 hover:text-white'
                        }`}
                        title="Send Gaze attraction signal"
                        aria-label="Send Gaze"
                      >
                        <Eye className="w-3.5 h-3.5 text-[#C9A24D]" />
                      </button>

                      {/* Favorite button */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleFavorite(profile.id);
                        }}
                        className={`w-8 h-8 rounded-lg flex items-center justify-center backdrop-blur-md border transition-colors cursor-pointer ${
                          profile.isFavorited
                            ? 'bg-rose-500/25 border-rose-500/50 text-rose-400'
                            : 'bg-black/60 border-white/10 text-zinc-300 hover:text-white'
                        }`}
                        aria-label="Favorite profile"
                      >
                        <Heart className={`w-3.5 h-3.5 ${profile.isFavorited ? 'fill-rose-400' : ''}`} />
                      </button>
                    </div>
                  </div>

                  {/* Mid-Card Mutual Intent Alignment Badge */}
                  {activeUserIntent && (
                    <div className="absolute top-12 left-2.5 z-10">
                      <CompatibilitySnapshot
                        profile={profile}
                        userIntent={activeUserIntent}
                        userNeighborhood={userNeighborhood}
                        variant="badge"
                      />
                    </div>
                  )}

                  {/* Bottom Card Content: Name, Distance, Intent, Headline, Trust */}
                  <div className="relative z-10 p-3 text-left space-y-1">
                    <div className="flex items-baseline justify-between gap-1">
                      <h3 className="text-sm font-bold text-white tracking-tight truncate">
                        {profile.name}, {profile.age}
                      </h3>
                      <span className="text-[11px] font-mono text-zinc-400 shrink-0 font-medium">
                        {profile.approxDistanceKm} km
                      </span>
                    </div>

                    {/* Clean Two-level Intent Badge */}
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span
                        className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider font-mono ${
                          profileMode === 'private'
                            ? 'bg-[#6F3CC3]/25 text-[#d8b4fe] border border-[#6F3CC3]/40'
                            : 'bg-[#C9A24D]/15 text-[#C9A24D] border border-[#C9A24D]/35'
                        }`}
                      >
                        {profileMode.toUpperCase()}
                      </span>
                      <span className="text-[11px] font-semibold text-zinc-200 truncate">
                        {intent}
                      </span>
                    </div>

                    {profile.rightNowDetail && (
                      <p className="text-[10px] text-amber-300/90 font-mono truncate">
                        {profile.rightNowDetail}
                      </p>
                    )}

                    <p className="text-[11px] text-zinc-300 line-clamp-1 leading-snug">
                      "{profile.headline}"
                    </p>

                    {/* Trust & Reputation Layer */}
                    <div className="pt-1 border-t border-white/[0.08] flex items-center justify-between">
                      <TrustReputationSnapshot profile={profile} variant="compact" />
                      <span className="text-[10px] text-zinc-500 font-mono truncate max-w-[70px]">{profile.neighborhood}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )
      )}

      {/* =========================================================================
          5. LIGHTWEIGHT SEPARATE INTENT SELECTOR (Step 5)
             Opened when user taps the primary Intent control
         ========================================================================= */}
      {isIntentSelectorOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div
            className="fixed inset-0"
            onClick={() => setIsIntentSelectorOpen(false)}
          />

          <div className="relative w-full max-w-lg bg-[#0e1017] border border-white/15 rounded-t-3xl sm:rounded-2xl shadow-2xl p-5 space-y-4 z-10 animate-in slide-in-from-bottom sm:zoom-in-95 duration-200 max-h-[85vh] overflow-y-auto no-scrollbar">
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-3 border-b border-white/[0.08]">
              <div>
                <span className="text-[10px] font-mono text-[#C9A24D] uppercase tracking-wider font-bold">
                  WHAT'S YOUR INTENT?
                </span>
                <h2 className="text-base font-bold text-white mt-0.5">
                  Choose what you're looking for
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setIsIntentSelectorOpen(false)}
                className="w-8 h-8 rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center text-zinc-400 hover:text-white transition-colors cursor-pointer"
                aria-label="Close intent selector"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Mode Switcher: Social / Private */}
            <div className="space-y-1.5">
              <span className="text-[11px] font-medium text-zinc-400">Interaction Mode</span>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => handleModeSwitch('social')}
                  className={`h-11 min-h-[44px] rounded-xl font-bold text-xs sm:text-sm tracking-wide transition-all cursor-pointer flex items-center justify-center gap-2 select-none active:scale-[0.98] ${
                    mode === 'social'
                      ? 'bg-[#C9A24D]/20 text-[#C9A24D] border border-[#C9A24D]/60 shadow-[0_0_16px_rgba(201,162,77,0.2)]'
                      : 'bg-[#141620] text-zinc-400 hover:text-white border border-white/10'
                  }`}
                >
                  <span className={`w-2 h-2 rounded-full ${mode === 'social' ? 'bg-[#C9A24D] shadow-[0_0_8px_#C9A24D]' : 'bg-zinc-600'}`} />
                  <span>Social</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleModeSwitch('private')}
                  className={`h-11 min-h-[44px] rounded-xl font-bold text-xs sm:text-sm tracking-wide transition-all cursor-pointer flex items-center justify-center gap-2 select-none active:scale-[0.98] ${
                    mode === 'private'
                      ? 'bg-[#6F3CC3]/25 text-[#d8b4fe] border border-[#6F3CC3]/60 shadow-[0_0_16px_rgba(111,60,195,0.25)]'
                      : 'bg-[#141620] text-zinc-400 hover:text-white border border-white/10'
                  }`}
                >
                  <span className={`w-2 h-2 rounded-full ${mode === 'private' ? 'bg-[#9333EA] shadow-[0_0_8px_#9333EA]' : 'bg-zinc-600'}`} />
                  <span>Private</span>
                </button>
              </div>
            </div>

            {/* Timing Quick Toggle */}
            <div className="space-y-1.5">
              <span className="text-[11px] font-medium text-zinc-400">Timing</span>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: 'all', label: 'Any Timing' },
                  { id: 'right_now', label: '⚡ Right Now' },
                  { id: 'later', label: '📅 Later' },
                ].map((t) => {
                  const isSelected = timingFilter === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => {
                        setTimingFilter(t.id as TimingFilterMode);
                        hapticLight();
                      }}
                      className={`h-9 min-h-[36px] rounded-xl text-xs font-semibold flex items-center justify-center transition-all cursor-pointer select-none ${
                        isSelected
                          ? mode === 'private'
                            ? 'bg-purple-950/80 text-purple-200 border border-purple-500/50 shadow-sm'
                            : 'bg-[#C9A24D]/20 text-[#C9A24D] border border-[#C9A24D]/50 shadow-sm'
                          : 'bg-[#141620] text-zinc-400 hover:text-white border border-white/10'
                      }`}
                    >
                      {t.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Intent Choices for the active mode */}
            <div className="space-y-2">
              <span className="text-[11px] font-medium text-zinc-400">
                {mode === 'social' ? 'Social Intent Options' : 'Private Intent Options'}
              </span>

              <div className="space-y-1.5 max-h-60 overflow-y-auto no-scrollbar" role="listbox">
                {currentIntentOptions.map((opt) => {
                  const isSelected = selectedIntent === opt;
                  return (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => handleSelectIntent(opt)}
                      className={`w-full min-h-[44px] px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-medium flex items-center justify-between transition-all cursor-pointer text-left ${
                        isSelected
                          ? mode === 'private'
                            ? 'bg-purple-950/80 text-purple-200 border border-purple-500/50 font-bold shadow-[0_0_12px_rgba(111,60,195,0.2)]'
                            : 'bg-[#C9A24D]/20 text-[#C9A24D] border border-[#C9A24D]/40 font-bold shadow-[0_0_12px_rgba(201,162,77,0.15)]'
                          : 'text-zinc-300 hover:bg-white/[0.05] hover:text-white border border-white/5'
                      }`}
                      role="option"
                      aria-selected={isSelected}
                    >
                      <div className="flex items-center gap-2.5 truncate">
                        <span
                          className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                            isSelected
                              ? mode === 'private'
                                ? 'bg-[#c4b5fd]'
                                : 'bg-[#C9A24D]'
                              : 'bg-zinc-600'
                          }`}
                        />
                        <span className="truncate">{opt}</span>
                      </div>

                      {isSelected && (
                        <Check
                          className={`w-4 h-4 shrink-0 ${
                            mode === 'private' ? 'text-[#c4b5fd]' : 'text-[#C9A24D]'
                          }`}
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Bottom Done button */}
            <div className="pt-2">
              <button
                type="button"
                onClick={() => {
                  setIsIntentSelectorOpen(false);
                  hapticLight();
                }}
                className={`w-full h-11 min-h-[44px] rounded-xl font-bold text-xs sm:text-sm transition-all cursor-pointer flex items-center justify-center gap-2 ${
                  mode === 'private'
                    ? 'bg-[#6F3CC3] hover:bg-[#7e47db] text-white shadow-[0_0_16px_rgba(111,60,195,0.3)]'
                    : 'bg-[#C9A24D] hover:bg-[#b58f3b] text-black shadow-[0_0_16px_rgba(201,162,77,0.25)]'
                }`}
              >
                <span>Done</span>
                <Check className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          6. PREMIUM ANIMATED FILTER DRAWER (Step 2, 3, 4)
             Bottom-sheet drawer with subtle spring slide-in and progressive disclosure
         ========================================================================= */}
      {isFilterDrawerOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center">
          {/* Subtle dark backdrop scrim */}
          <div
            className="fixed inset-0 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200"
            onClick={() => setIsFilterDrawerOpen(false)}
          />

          {/* Drawer container: occupies 80-90% on mobile */}
          <div className="relative w-full max-w-xl max-h-[88vh] sm:max-h-[85vh] bg-[#0c0d12] border-t border-x border-white/15 rounded-t-3xl sm:rounded-2xl shadow-[0_-12px_48px_rgba(0,0,0,0.85)] flex flex-col z-10 animate-in slide-in-from-bottom duration-300 ease-out">
            {/* Drag Handle */}
            <div className="pt-3 pb-1 flex justify-center cursor-grab shrink-0">
              <div className="w-12 h-1.5 bg-zinc-600/80 rounded-full hover:bg-zinc-500 transition-colors" />
            </div>

            {/* Drawer Header */}
            <div className="px-5 py-3 border-b border-white/[0.08] flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <SlidersHorizontal className="w-4 h-4 text-[#C9A24D]" />
                <h2 className="text-xs sm:text-sm font-bold tracking-wider uppercase font-mono text-white">
                  FILTER DISCOVER
                </h2>
                {activeFilterCount > 0 && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#C9A24D] text-black font-bold font-mono">
                    {activeFilterCount}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-3">
                {activeFilterCount > 0 && (
                  <button
                    type="button"
                    onClick={handleClearAllFilters}
                    className="text-xs text-[#C9A24D] hover:text-[#e4c06b] transition-colors font-medium cursor-pointer"
                  >
                    Clear all
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setIsFilterDrawerOpen(false)}
                  className="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center text-zinc-400 hover:text-white transition-colors cursor-pointer"
                  aria-label="Close filters"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Scrollable Drawer Body with Expandable Sections */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 no-scrollbar text-xs">
              
              {/* SECTION 1: INTENT & TIMING */}
              <div className="rounded-2xl bg-[#11131a] border border-white/[0.08] p-3.5 space-y-3">
                <button
                  type="button"
                  onClick={() => setIsTimingSectionOpen(!isTimingSectionOpen)}
                  className="w-full flex items-center justify-between text-left cursor-pointer"
                >
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-[#C9A24D]" />
                    <span className="font-bold text-white text-xs sm:text-sm">TIMING</span>
                    <span className="text-[11px] text-zinc-400 font-mono">
                      ({timingFilter === 'all' ? 'Any' : timingFilter === 'right_now' ? 'Right Now' : 'Later'})
                    </span>
                  </div>
                  <ChevronDown className={`w-4 h-4 text-zinc-400 transition-transform ${isTimingSectionOpen ? 'rotate-180' : ''}`} />
                </button>

                {isTimingSectionOpen && (
                  <div className="pt-2 border-t border-white/[0.06] grid grid-cols-3 gap-2">
                    {[
                      { id: 'all', label: 'Both / Any' },
                      { id: 'right_now', label: '⚡ Right Now' },
                      { id: 'later', label: '📅 Later' },
                    ].map((item) => {
                      const isSelected = timingFilter === item.id;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => {
                            setTimingFilter(item.id as TimingFilterMode);
                            hapticLight();
                          }}
                          className={`h-10 min-h-[40px] px-2 rounded-xl text-xs font-semibold flex items-center justify-center transition-all cursor-pointer select-none ${
                            isSelected
                              ? 'bg-[#C9A24D]/20 text-[#C9A24D] border border-[#C9A24D]/60 shadow-[0_0_12px_rgba(201,162,77,0.15)] font-bold'
                              : 'bg-[#181a24] text-zinc-400 hover:text-white border border-white/5'
                          }`}
                        >
                          {item.label}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* SECTION 2: LOOKING FOR (INTENT TAXONOMY) */}
              <div className="rounded-2xl bg-[#11131a] border border-white/[0.08] p-3.5 space-y-3">
                <button
                  type="button"
                  onClick={() => setIsLookingForSectionOpen(!isLookingForSectionOpen)}
                  className="w-full flex items-center justify-between text-left cursor-pointer"
                >
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-[#6F3CC3]" />
                    <span className="font-bold text-white text-xs sm:text-sm">LOOKING FOR</span>
                    <span className="text-[11px] text-zinc-400 font-mono">
                      ({mode.toUpperCase()} · {selectedIntent})
                    </span>
                  </div>
                  <ChevronDown className={`w-4 h-4 text-zinc-400 transition-transform ${isLookingForSectionOpen ? 'rotate-180' : ''}`} />
                </button>

                {isLookingForSectionOpen && (
                  <div className="pt-2 border-t border-white/[0.06] space-y-3">
                    {/* Top Level Mode Toggle */}
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => handleModeSwitch('social')}
                        className={`h-10 min-h-[40px] rounded-xl font-bold text-xs flex items-center justify-center gap-2 cursor-pointer transition-all ${
                          mode === 'social'
                            ? 'bg-[#C9A24D]/20 text-[#C9A24D] border border-[#C9A24D]/50 shadow-sm'
                            : 'bg-[#181a24] text-zinc-400 border border-white/5 hover:text-white'
                        }`}
                      >
                        <span className={`w-2 h-2 rounded-full ${mode === 'social' ? 'bg-[#C9A24D]' : 'bg-zinc-600'}`} />
                        <span>Social</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleModeSwitch('private')}
                        className={`h-10 min-h-[40px] rounded-xl font-bold text-xs flex items-center justify-center gap-2 cursor-pointer transition-all ${
                          mode === 'private'
                            ? 'bg-[#6F3CC3]/25 text-[#d8b4fe] border border-[#6F3CC3]/50 shadow-sm'
                            : 'bg-[#181a24] text-zinc-400 border border-white/5 hover:text-white'
                        }`}
                      >
                        <span className={`w-2 h-2 rounded-full ${mode === 'private' ? 'bg-[#9333EA]' : 'bg-zinc-600'}`} />
                        <span>Private</span>
                      </button>
                    </div>

                    {/* Specific Intent Chips */}
                    <div className="flex flex-wrap gap-1.5">
                      {currentIntentOptions.map((opt) => {
                        const isSelected = selectedIntent === opt;
                        return (
                          <button
                            key={opt}
                            type="button"
                            onClick={() => {
                              setSelectedIntent(opt);
                              hapticLight();
                            }}
                            className={`h-9 min-h-[36px] px-3 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                              isSelected
                                ? mode === 'private'
                                  ? 'bg-purple-950/80 text-purple-200 border border-purple-500/50 shadow-sm'
                                  : 'bg-[#C9A24D]/20 text-[#C9A24D] border border-[#C9A24D]/50 shadow-sm'
                                : 'bg-[#181a24] text-zinc-300 hover:text-white border border-white/5'
                            }`}
                          >
                            <span>{opt}</span>
                            {isSelected && <Check className="w-3 h-3" />}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* SECTION 3: AVAILABILITY & TIME */}
              <div className="rounded-2xl bg-[#11131a] border border-white/[0.08] p-3.5 space-y-3">
                <button
                  type="button"
                  onClick={() => setIsAvailabilitySectionOpen(!isAvailabilitySectionOpen)}
                  className="w-full flex items-center justify-between text-left cursor-pointer"
                >
                  <div className="flex items-center gap-2">
                    <Zap className="w-4 h-4 text-emerald-400" />
                    <span className="font-bold text-white text-xs sm:text-sm">AVAILABILITY & STATUS</span>
                    {onlyOnline && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-300 border border-emerald-500/40 font-mono">
                        Active now
                      </span>
                    )}
                  </div>
                  <ChevronDown className={`w-4 h-4 text-zinc-400 transition-transform ${isAvailabilitySectionOpen ? 'rotate-180' : ''}`} />
                </button>

                {isAvailabilitySectionOpen && (
                  <div className="pt-2 border-t border-white/[0.06] space-y-2">
                    <button
                      type="button"
                      onClick={() => {
                        setOnlyOnline(!onlyOnline);
                        hapticLight();
                      }}
                      className={`w-full min-h-[44px] px-3.5 py-2.5 rounded-xl text-xs font-medium flex items-center justify-between transition-colors cursor-pointer ${
                        onlyOnline
                          ? 'bg-emerald-950/50 text-emerald-300 border border-emerald-500/50'
                          : 'bg-[#181a24] text-zinc-300 border border-white/5 hover:text-white'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${onlyOnline ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-600'}`} />
                        <span className="font-semibold">Only show members active now</span>
                      </div>
                      <div
                        className={`w-10 h-6 rounded-full transition-colors p-0.5 flex items-center ${
                          onlyOnline ? 'bg-emerald-500 justify-end' : 'bg-zinc-800 justify-start'
                        }`}
                      >
                        <div className="w-5 h-5 rounded-full bg-white shadow" />
                      </div>
                    </button>
                  </div>
                )}
              </div>

              {/* SECTION 4: DISTANCE */}
              <div className="rounded-2xl bg-[#11131a] border border-white/[0.08] p-3.5 space-y-3">
                <button
                  type="button"
                  onClick={() => setIsDistanceSectionOpen(!isDistanceSectionOpen)}
                  className="w-full flex items-center justify-between text-left cursor-pointer"
                >
                  <div className="flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-[#C9A24D]" />
                    <span className="font-bold text-white text-xs sm:text-sm">MAXIMUM DISTANCE</span>
                    <span className="text-[11px] text-zinc-400 font-mono">
                      ({maxDistanceKm === 20 ? 'Any distance' : `Within ${maxDistanceKm} km`})
                    </span>
                  </div>
                  <ChevronDown className={`w-4 h-4 text-zinc-400 transition-transform ${isDistanceSectionOpen ? 'rotate-180' : ''}`} />
                </button>

                {isDistanceSectionOpen && (
                  <div className="pt-2 border-t border-white/[0.06] grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {[
                      { dist: 1, label: 'Within 1 km' },
                      { dist: 2, label: 'Within 2 km' },
                      { dist: 5, label: 'Within 5 km' },
                      { dist: 20, label: 'Any distance' },
                    ].map((item) => {
                      const isSelected = maxDistanceKm === item.dist;
                      return (
                        <button
                          key={item.dist}
                          type="button"
                          onClick={() => {
                            setMaxDistanceKm(item.dist);
                            hapticLight();
                          }}
                          className={`h-10 min-h-[40px] px-2.5 rounded-xl text-xs font-semibold flex items-center justify-center transition-all cursor-pointer ${
                            isSelected
                              ? 'bg-[#C9A24D]/20 text-[#C9A24D] border border-[#C9A24D]/60 font-bold shadow-sm'
                              : 'bg-[#181a24] text-zinc-400 hover:text-white border border-white/5'
                          }`}
                        >
                          {item.label}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* SECTION 5: VIBE & PREFERENCES */}
              <div className="rounded-2xl bg-[#11131a] border border-white/[0.08] p-3.5 space-y-3">
                <button
                  type="button"
                  onClick={() => setIsPreferencesSectionOpen(!isPreferencesSectionOpen)}
                  className="w-full flex items-center justify-between text-left cursor-pointer"
                >
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-emerald-400" />
                    <span className="font-bold text-white text-xs sm:text-sm">VIBE & VERIFICATION</span>
                    {(safetyVerifiedOnly || highTrustOnly) && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-300 border border-emerald-500/40 font-mono">
                        Active
                      </span>
                    )}
                  </div>
                  <ChevronDown className={`w-4 h-4 text-zinc-400 transition-transform ${isPreferencesSectionOpen ? 'rotate-180' : ''}`} />
                </button>

                {isPreferencesSectionOpen && (
                  <div className="pt-2 border-t border-white/[0.06] space-y-2">
                    <button
                      type="button"
                      onClick={() => {
                        setSafetyVerifiedOnly(!safetyVerifiedOnly);
                        hapticLight();
                      }}
                      className={`w-full min-h-[44px] px-3.5 py-2.5 rounded-xl text-xs font-medium flex items-center justify-between transition-colors cursor-pointer ${
                        safetyVerifiedOnly
                          ? 'bg-emerald-950/50 text-emerald-300 border border-emerald-500/50'
                          : 'bg-[#181a24] text-zinc-300 border border-white/5 hover:text-white'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                        <span>Safety Verified members only</span>
                      </div>
                      {safetyVerifiedOnly && <Check className="w-4 h-4 text-emerald-400" />}
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setHighTrustOnly(!highTrustOnly);
                        hapticLight();
                      }}
                      className={`w-full min-h-[44px] px-3.5 py-2.5 rounded-xl text-xs font-medium flex items-center justify-between transition-colors cursor-pointer ${
                        highTrustOnly
                          ? 'bg-[#C9A24D]/20 text-[#C9A24D] border border-[#C9A24D]/50'
                          : 'bg-[#181a24] text-zinc-300 border border-white/5 hover:text-white'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <Award className="w-4 h-4 text-[#C9A24D]" />
                        <span>High Trust Score (≥95/100) only</span>
                      </div>
                      {highTrustOnly && <Check className="w-4 h-4 text-[#C9A24D]" />}
                    </button>
                  </div>
                )}
              </div>

              {/* SECTION 6: TRAVEL & LOCATION */}
              <div className="rounded-2xl bg-[#11131a] border border-white/[0.08] p-3.5 space-y-3">
                <button
                  type="button"
                  onClick={() => setIsLocationSectionOpen(!isLocationSectionOpen)}
                  className="w-full flex items-center justify-between text-left cursor-pointer"
                >
                  <div className="flex items-center gap-2">
                    <Coffee className="w-4 h-4 text-[#C9A24D]" />
                    <span className="font-bold text-white text-xs sm:text-sm">TRAVEL & SAFE HAVENS</span>
                    {safeHavenOnly && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#C9A24D]/20 text-[#C9A24D] border border-[#C9A24D]/40 font-mono">
                        Safe Haven Only
                      </span>
                    )}
                  </div>
                  <ChevronDown className={`w-4 h-4 text-zinc-400 transition-transform ${isLocationSectionOpen ? 'rotate-180' : ''}`} />
                </button>

                {isLocationSectionOpen && (
                  <div className="pt-2 border-t border-white/[0.06] space-y-2">
                    <button
                      type="button"
                      onClick={() => {
                        setSafeHavenOnly(!safeHavenOnly);
                        hapticLight();
                      }}
                      className={`w-full min-h-[44px] px-3.5 py-2.5 rounded-xl text-xs font-medium flex items-center justify-between transition-colors cursor-pointer ${
                        safeHavenOnly
                          ? 'bg-[#C9A24D]/20 text-[#C9A24D] border border-[#C9A24D]/50'
                          : 'bg-[#181a24] text-zinc-300 border border-white/5 hover:text-white'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <Coffee className="w-4 h-4 text-[#C9A24D]" />
                        <span>Prefers Verified Safe Haven spots</span>
                      </div>
                      {safeHavenOnly && <Check className="w-4 h-4 text-[#C9A24D]" />}
                    </button>

                    <div className="p-3 rounded-xl bg-[#181a24] border border-white/5 flex items-center justify-between text-xs text-zinc-400">
                      <span>Current Area:</span>
                      <span className="text-white font-mono font-semibold">{userNeighborhood} · London</span>
                    </div>
                  </div>
                )}
              </div>

            </div>

            {/* STICKY CTA FOOTER (Step 4) */}
            <div className="p-4 sm:p-5 border-t border-white/[0.08] bg-[#0c0d12]/95 backdrop-blur-md shrink-0 flex items-center gap-3 pb-6 sm:pb-5">
              <button
                type="button"
                onClick={handleClearAllFilters}
                className="h-12 min-h-[48px] px-4 rounded-xl border border-white/10 text-xs font-semibold text-zinc-400 hover:text-white hover:bg-white/[0.04] transition-colors cursor-pointer shrink-0"
              >
                Clear all
              </button>

              <button
                type="button"
                onClick={() => {
                  setIsFilterDrawerOpen(false);
                  hapticLight();
                }}
                className={`h-12 min-h-[48px] flex-1 rounded-xl font-bold text-xs sm:text-sm tracking-wide transition-all cursor-pointer flex items-center justify-center gap-2 shadow-lg active:scale-[0.99] ${
                  mode === 'private'
                    ? 'bg-[#6F3CC3] hover:bg-[#7e47db] text-white shadow-[0_0_20px_rgba(111,60,195,0.35)]'
                    : 'bg-[#C9A24D] hover:bg-[#b58f3b] text-black shadow-[0_0_20px_rgba(201,162,77,0.3)]'
                }`}
              >
                <span>
                  {displayMode === 'grid'
                    ? `Show ${filteredProfiles.length} ${filteredProfiles.length === 1 ? 'person' : 'people'}`
                    : `Show ${filteredIntentPosts.length} ${filteredIntentPosts.length === 1 ? 'result' : 'results'}`}
                </span>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          7. PROFILE DETAIL MODAL (INSTANT ACTIONABLE INTENT & PROGRESSIVE DISCLOSURE)
         ========================================================================= */}
      {selectedProfile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/85 backdrop-blur-sm animate-in fade-in">
          <div className="relative w-full max-w-lg bg-[#11131a] border border-white/10 rounded-2xl overflow-hidden shadow-2xl flex flex-col max-h-[92vh]">
            {/* Photo Header */}
            <div className="relative w-full h-64 sm:h-72 bg-[#090a0e] shrink-0 select-none">
              {!imageErrors[selectedProfile.id] ? (
                <img
                  src={selectedProfile.photoUrl}
                  alt={selectedProfile.name}
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover object-center"
                />
              ) : (
                <div className="w-full h-full bg-gradient-to-br from-[#171922] to-[#090a0e] flex flex-col items-center justify-center p-4">
                  <div className="w-16 h-16 rounded-full bg-[#1c1f2b] border border-white/10 flex items-center justify-center text-xl font-bold text-[#C9A24D]">
                    {selectedProfile.name.charAt(0)}
                  </div>
                </div>
              )}

              {/* Scrim Overlay */}
              <div className="absolute inset-0 bg-gradient-to-t from-[#11131a] via-black/35 to-transparent" />

              {/* Top Controls */}
              <div className="absolute top-3 left-3 right-3 flex items-center justify-between z-10">
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-black/70 backdrop-blur-md border border-white/10 text-xs text-zinc-200">
                  <span
                    className={`w-2 h-2 rounded-full ${
                      selectedProfile.hasRightNowIntent
                        ? 'bg-amber-400 animate-pulse'
                        : selectedProfile.isOnline
                        ? 'bg-emerald-400 animate-pulse'
                        : 'bg-zinc-500'
                    }`}
                  />
                  <span>
                    {selectedProfile.hasRightNowIntent
                      ? 'Right Now Active'
                      : selectedProfile.isOnline
                      ? 'Active now'
                      : selectedProfile.lastActive}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => onToggleFavorite(selectedProfile.id)}
                    className={`h-9 w-9 rounded-xl flex items-center justify-center backdrop-blur-md border transition-colors cursor-pointer ${
                      selectedProfile.isFavorited
                        ? 'bg-rose-500/25 border-rose-500/50 text-rose-400'
                        : 'bg-black/60 border-white/10 text-zinc-300 hover:text-white'
                    }`}
                    aria-label="Favorite"
                  >
                    <Heart className={`w-4 h-4 ${selectedProfile.isFavorited ? 'fill-rose-400' : ''}`} />
                  </button>

                  <button
                    onClick={() => setSelectedProfile(null)}
                    className="h-9 w-9 rounded-xl bg-black/60 hover:bg-black/80 backdrop-blur-md border border-white/10 text-zinc-300 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
                    aria-label="Close profile"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Identity on photo bottom */}
              <div className="absolute bottom-3 left-4 right-4 z-10">
                <div className="flex items-baseline gap-2">
                  <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight">
                    {selectedProfile.name}, {selectedProfile.age}
                  </h2>
                  {selectedProfile.rolePronouns && (
                    <span className="text-xs text-zinc-300 font-medium">
                      ({selectedProfile.rolePronouns})
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2 text-xs text-zinc-300 mt-0.5">
                  <MapPin className="w-3.5 h-3.5 text-[#C9A24D] shrink-0" />
                  <span>{selectedProfile.neighborhood}</span>
                  <span>·</span>
                  <span>~{selectedProfile.approxDistanceKm} km away</span>
                  <span>·</span>
                  <span>{selectedProfile.heightCm} cm</span>
                </div>
              </div>
            </div>

            {/* ACTION-FIRST TOP VIEWPORT: Intent, Availability, Trust, Actions */}
            <div className="p-4 sm:p-5 border-b border-white/[0.08] bg-[#141620]/60 space-y-3 shrink-0">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2 flex-wrap">
                  <span
                    className={`px-2.5 py-1 rounded-lg text-xs font-black uppercase tracking-wider font-mono ${
                      getProfileMode(selectedProfile) === 'private'
                        ? 'bg-purple-950/80 text-purple-200 border border-purple-500/50'
                        : 'bg-[#C9A24D]/15 border border-[#C9A24D]/35 text-[#C9A24D]'
                    }`}
                  >
                    {getProfileMode(selectedProfile).toUpperCase()} · {getProfileIntent(selectedProfile)}
                  </span>
                  <span className="text-xs text-zinc-300 font-medium">
                    {getProfileAvailability(selectedProfile)}
                  </span>
                  {selectedProfile.intentExpiresAt && selectedProfile.hasRightNowIntent && (
                    <CountdownPill expiresAt={selectedProfile.intentExpiresAt} />
                  )}
                </div>

                <div className="flex items-center gap-1.5 text-xs text-emerald-400 font-mono shrink-0">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <span>Verified · {selectedProfile.reliabilityScore || 96}</span>
                </div>
              </div>

              {/* Immediate Primary Actions: Gaze (👀) + Meet + Message */}
              <div className="grid grid-cols-3 gap-2 pt-1">
                <button
                  onClick={(e) => handleGaze(e, selectedProfile.name)}
                  className={`h-11 min-h-[44px] px-3 text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-sm active:scale-95 ${
                    gazedPeerNames.has(selectedProfile.name)
                      ? 'bg-purple-950 text-purple-300 border border-purple-500/60'
                      : 'bg-[#1c1f2b] hover:bg-[#252838] text-white border border-white/10'
                  }`}
                >
                  <Eye className="w-4 h-4 text-[#C9A24D]" />
                  <span>{gazedPeerNames.has(selectedProfile.name) ? 'Gazed' : 'Gaze 👀'}</span>
                </button>

                {onOpenScheduleMeeting && (
                  <button
                    onClick={() => {
                      const name = selectedProfile.name;
                      setSelectedProfile(null);
                      onOpenScheduleMeeting(name);
                    }}
                    className="h-11 min-h-[44px] px-3 text-xs font-bold text-[#C9A24D] bg-[#1c1f2b] hover:bg-[#252838] border border-[#C9A24D]/30 rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-sm active:scale-95"
                  >
                    <Calendar className="w-3.5 h-3.5" />
                    <span>Meet</span>
                  </button>
                )}

                <button
                  onClick={() => {
                    onOpenDirectChatWithProfile(selectedProfile);
                    setSelectedProfile(null);
                  }}
                  className="h-11 min-h-[44px] px-4 text-xs font-bold text-black bg-[#C9A24D] hover:bg-[#b58f3b] rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-md active:scale-95"
                >
                  <Lock className="w-3.5 h-3.5" />
                  <span>Message</span>
                </button>
              </div>
            </div>

            {/* Scrollable Body: Compatibility, Trust, Headline, Bio, Circles, Safe Haven */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4 text-xs">
              
              {/* Compatibility Snapshot (Explainable signals) */}
              <CompatibilitySnapshot
                profile={selectedProfile}
                userIntent={activeUserIntent}
                userNeighborhood={userNeighborhood}
                variant="full"
              />

              {/* Trust & Reputation Layer */}
              <TrustReputationSnapshot
                profile={selectedProfile}
                variant="card"
                onOpenQR={() => {
                  if (onOpenQRWithPeer) {
                    onOpenQRWithPeer(selectedProfile);
                    setSelectedProfile(null);
                  }
                }}
              />

              <div className="space-y-1.5">
                <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-wider">About</h4>
                <p className="text-sm font-semibold text-white leading-snug">
                  "{selectedProfile.headline}"
                </p>
                <p className="text-zinc-300 leading-relaxed text-xs">
                  {selectedProfile.bio}
                </p>
              </div>

              {/* Circles & Interests */}
              <div className="space-y-2 pt-2 border-t border-white/[0.07]">
                <h4 className="text-xs font-semibold text-zinc-400">Interests & Circles</h4>
                <div className="flex flex-wrap gap-1.5">
                  {selectedProfile.interests.map((interest, idx) => (
                    <span
                      key={idx}
                      className="px-2.5 py-1 rounded-lg bg-[#141620] border border-white/[0.08] text-zinc-300 text-xs"
                    >
                      {interest}
                    </span>
                  ))}
                  {selectedProfile.tribes.map((tribe, idx) => (
                    <span
                      key={'t_' + idx}
                      className="px-2.5 py-1 rounded-lg bg-[#141620]/60 border border-white/[0.05] text-zinc-400 text-xs font-mono"
                    >
                      #{tribe}
                    </span>
                  ))}
                </div>
              </div>

              {/* Favorite Safe Haven */}
              {selectedProfile.favoriteSafeHaven && (
                <div className="p-3 rounded-xl bg-[#141620] border border-white/[0.08] space-y-1.5">
                  <div className="text-[10px] uppercase font-mono tracking-wider text-zinc-400">
                    Preferred First Meeting Spot:
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Coffee className="w-4 h-4 text-[#C9A24D]" />
                      <span className="text-xs font-semibold text-white">
                        {selectedProfile.favoriteSafeHaven}
                      </span>
                    </div>
                    <button
                      onClick={() => {
                        onProposeHavenDate(selectedProfile, selectedProfile.favoriteSafeHaven);
                        setSelectedProfile(null);
                      }}
                      className="text-xs font-medium text-[#C9A24D] hover:underline flex items-center gap-1 cursor-pointer"
                    >
                      <span>Suggest Here</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )}

              {/* In-Person Verification & Trust Score */}
              <div className="p-3 rounded-xl bg-[#141620] border border-white/[0.08] flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-emerald-950/60 border border-emerald-500/40 flex items-center justify-center text-emerald-400 shrink-0">
                    <Award className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-white flex items-center gap-1.5">
                      <span>Trust Score:</span>
                      <span className="text-[#C9A24D] font-mono">{selectedProfile.reliabilityScore || 96}/100</span>
                      {selectedProfile.verifiedViaQR && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-500/40 font-mono">
                          QR Verified
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-zinc-400">
                      {selectedProfile.verifiedPeersCount || 12} in-person physical verifications
                    </div>
                  </div>
                </div>

                {onOpenQRWithPeer && (
                  <button
                    onClick={() => {
                      const prof = selectedProfile;
                      setSelectedProfile(null);
                      onOpenQRWithPeer(prof);
                    }}
                    className="h-8 px-2.5 rounded-lg bg-[#1c1f2b] hover:bg-[#252838] text-zinc-200 text-xs font-medium flex items-center gap-1.5 cursor-pointer shrink-0 border border-white/10 transition-colors"
                  >
                    <QrCode className="w-3.5 h-3.5 text-[#C9A24D]" />
                    <span>Scan Key</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

