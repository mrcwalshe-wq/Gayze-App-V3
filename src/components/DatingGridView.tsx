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
  Check,
  Award, 
  QrCode, 
  Zap, 
  Eye, 
  Calendar, 
  LayoutGrid, 
  ListFilter, 
  Sparkles
} from 'lucide-react';
import { hapticLight, triggerVibration } from '../services/hapticService';

export type DiscoveryDisplayMode = 'grid' | 'feed';

interface DatingGridViewProps {
  profiles: DatingProfile[];
  safeHavens: SafeHaven[];
  userNeighborhood: string;
  stories?: SocialStory[];
  intentPosts?: IntentActivityPost[];
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
  onOpenDirectChatWithProfile,
  onProposeHavenDate,
  onToggleFavorite,
  onOpenQRWithPeer,
  onGazeAtPeer,
  onOpenScheduleMeeting,
  onOpenSetIntent,
}) => {
  const [selectedProfile, setSelectedProfile] = useState<DatingProfile | null>(null);
  
  // Two-level Intent Architecture: Top-Level Mode + Specific Intent
  const [mode, setMode] = useState<TopLevelIntentMode>('social');
  const [selectedIntent, setSelectedIntent] = useState<EncounterIntent>('All');
  const [isSelectorOpen, setIsSelectorOpen] = useState<boolean>(false);
  
  const [displayMode, setDisplayMode] = useState<DiscoveryDisplayMode>('grid');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [onlyOnline, setOnlyOnline] = useState<boolean>(false);
  const [maxDistanceKm, setMaxDistanceKm] = useState<number>(5);
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
    setIsSelectorOpen(false);

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

  // Select intent from dropdown/sheet
  const handleSelectIntent = (intent: EncounterIntent) => {
    hapticLight();
    setSelectedIntent(intent);
    setIsSelectorOpen(false);
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

      // 3. Online Filter
      if (onlyOnline && !p.isOnline) {
        return false;
      }

      // 4. Distance Filter
      if (p.approxDistanceKm > maxDistanceKm) {
        return false;
      }

      // 5. Text Search Filter
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
  }, [profiles, mode, selectedIntent, onlyOnline, maxDistanceKm, searchQuery]);

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

      if (post.approxDistanceKm > maxDistanceKm) {
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
  }, [intentPosts, mode, selectedIntent, maxDistanceKm, searchQuery]);

  const handleImageError = (profileId: string) => {
    setImageErrors((prev) => ({ ...prev, [profileId]: true }));
  };

  const currentIntentOptions = mode === 'social' ? SOCIAL_INTENTS : PRIVATE_INTENTS;

  return (
    <div className="space-y-4">
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
            placeholder="Search name, intent, vibe..."
            className="w-full bg-[#11131a] border border-white/10 rounded-xl pl-9 pr-8 py-2 text-xs text-white placeholder-zinc-500 focus:border-[#C9A24D] focus:outline-none"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-white"
              aria-label="Clear search"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* =========================================================================
          3. TWO-LEVEL INTENT ARCHITECTURE:
             TOP-LEVEL MODE: [ Social ] [ Private ]
             What are you looking for?                 All ▾
         ========================================================================= */}
      <div className="space-y-2.5">
        {/* Top-Level Mode: Social & Private Buttons */}
        <div className="grid grid-cols-2 gap-2 w-full max-w-sm">
          <button
            type="button"
            onClick={() => handleModeSwitch('social')}
            className={`h-11 min-h-[44px] rounded-xl font-bold text-xs sm:text-sm tracking-wide transition-all cursor-pointer flex items-center justify-center gap-2 select-none active:scale-[0.98] ${
              mode === 'social'
                ? 'bg-[#C9A24D]/20 text-[#C9A24D] border border-[#C9A24D]/50 shadow-[0_0_16px_rgba(201,162,77,0.18)]'
                : 'bg-[#11131a] text-zinc-400 hover:text-white border border-white/[0.08]'
            }`}
            aria-pressed={mode === 'social'}
          >
            <span
              className={`w-2 h-2 rounded-full transition-all ${
                mode === 'social'
                  ? 'bg-[#C9A24D] shadow-[0_0_8px_#C9A24D] scale-110'
                  : 'bg-zinc-600'
              }`}
            />
            <span>Social</span>
          </button>

          <button
            type="button"
            onClick={() => handleModeSwitch('private')}
            className={`h-11 min-h-[44px] rounded-xl font-bold text-xs sm:text-sm tracking-wide transition-all cursor-pointer flex items-center justify-center gap-2 select-none active:scale-[0.98] ${
              mode === 'private'
                ? 'bg-[#6F3CC3]/25 text-[#d8b4fe] border border-[#6F3CC3]/60 shadow-[0_0_16px_rgba(111,60,195,0.22)]'
                : 'bg-[#11131a] text-zinc-400 hover:text-white border border-white/[0.08]'
            }`}
            aria-pressed={mode === 'private'}
          >
            <span
              className={`w-2 h-2 rounded-full transition-all ${
                mode === 'private'
                  ? 'bg-[#9333EA] shadow-[0_0_8px_#9333EA] scale-110'
                  : 'bg-zinc-600'
              }`}
            />
            <span>Private</span>
          </button>
        </div>

        {/* "What are you looking for?" Selector Pill & Polished Dropdown */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setIsSelectorOpen((prev) => !prev)}
            className="w-full h-11 min-h-[44px] px-3.5 sm:px-4 bg-[#11131a] hover:bg-[#151824] border border-white/10 hover:border-white/20 rounded-xl flex items-center justify-between gap-3 text-xs sm:text-sm transition-all cursor-pointer shadow-sm select-none active:scale-[0.99] focus:outline-none focus:ring-1 focus:ring-[#C9A24D]/40"
            aria-expanded={isSelectorOpen}
            aria-haspopup="listbox"
          >
            <span className="font-medium text-zinc-300 truncate">
              What are you looking for?
            </span>

            <div className="flex items-center gap-1.5 shrink-0">
              <span
                className={`font-semibold px-2.5 py-1 rounded-lg text-xs font-mono tracking-tight truncate max-w-[170px] sm:max-w-[240px] ${
                  mode === 'private'
                    ? 'bg-purple-950/80 text-[#d8b4fe] border border-purple-500/40'
                    : 'bg-[#C9A24D]/15 text-[#C9A24D] border border-[#C9A24D]/35'
                }`}
              >
                {selectedIntent}
              </span>
              <ChevronDown
                className={`w-4 h-4 text-zinc-400 transition-transform duration-200 ${
                  isSelectorOpen ? 'rotate-180 text-white' : ''
                }`}
              />
            </div>
          </button>

          {/* Polished Dropdown Popover */}
          {isSelectorOpen && (
            <>
              {/* Invisible backdrop for outside dismiss */}
              <div
                className="fixed inset-0 z-40"
                onClick={() => setIsSelectorOpen(false)}
              />

              <div className="absolute left-0 right-0 top-full mt-1.5 z-50 bg-[#11131a]/98 backdrop-blur-xl border border-white/15 rounded-2xl shadow-2xl p-2 animate-in fade-in zoom-in-95 duration-150">
                <div className="px-3 py-2 border-b border-white/[0.08] flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        mode === 'private' ? 'bg-[#9333EA]' : 'bg-[#C9A24D]'
                      }`}
                    />
                    <span className="text-xs font-bold text-white tracking-wide uppercase font-mono">
                      {mode === 'private' ? 'Private Intents' : 'Social Intents'}
                    </span>
                  </div>
                  <span className="text-[11px] text-zinc-400">
                    Tap to filter
                  </span>
                </div>

                <div className="mt-1 space-y-1 max-h-72 overflow-y-auto no-scrollbar" role="listbox">
                  {currentIntentOptions.map((opt) => {
                    const isSelected = selectedIntent === opt;
                    return (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => handleSelectIntent(opt)}
                        className={`w-full min-h-[44px] px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-medium flex items-center justify-between transition-colors cursor-pointer text-left ${
                          isSelected
                            ? mode === 'private'
                              ? 'bg-purple-950/80 text-purple-200 border border-purple-500/50 font-bold'
                              : 'bg-[#C9A24D]/20 text-[#C9A24D] border border-[#C9A24D]/40 font-bold'
                            : 'text-zinc-300 hover:bg-white/[0.05] hover:text-white border border-transparent'
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
            </>
          )}
        </div>

        {/* Auxiliary Controls: Online Only, Distance, Grid vs Feed View */}
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-400 pt-0.5">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setOnlyOnline((prev) => !prev)}
              className={`h-8 px-2.5 text-xs font-semibold rounded-lg border transition-all flex items-center gap-1.5 cursor-pointer ${
                onlyOnline
                  ? 'bg-emerald-950/50 text-emerald-300 border-emerald-500/50 shadow-sm'
                  : 'bg-[#11131a] text-zinc-400 border-white/10 hover:text-white'
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${onlyOnline ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-500'}`} />
              <span>Active now</span>
            </button>

            <select
              value={maxDistanceKm}
              onChange={(e) => setMaxDistanceKm(Number(e.target.value))}
              className="h-8 bg-[#11131a] border border-white/10 rounded-lg px-2 text-xs text-zinc-300 focus:outline-none focus:border-[#C9A24D] cursor-pointer"
            >
              <option value={1}>Within 1 km</option>
              <option value={2}>Within 2 km</option>
              <option value={5}>Within 5 km</option>
              <option value={20}>Any distance</option>
            </select>
          </div>

          <div className="flex items-center gap-1 bg-[#11131a] p-0.5 rounded-xl border border-white/10">
            <button
              type="button"
              onClick={() => setDisplayMode('grid')}
              className={`h-7 px-2.5 text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer ${
                displayMode === 'grid'
                  ? 'bg-[#1c1f2b] text-white border border-white/10 shadow-sm'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              <LayoutGrid className="w-3 h-3" />
              <span>Grid</span>
            </button>

            <button
              type="button"
              onClick={() => setDisplayMode('feed')}
              className={`h-7 px-2.5 text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer ${
                displayMode === 'feed'
                  ? 'bg-[#1c1f2b] text-white border border-white/10 shadow-sm'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              <ListFilter className="w-3 h-3 text-[#C9A24D]" />
              <span>IntentBoard</span>
            </button>
          </div>
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
                onClick={() => setSelectedIntent('All')}
                className="mt-2 h-8 px-3 text-xs font-semibold text-black bg-[#C9A24D] hover:bg-[#b58f3b] rounded-lg transition-colors cursor-pointer"
              >
                Reset to All
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
              onClick={() => {
                setSelectedIntent('All');
                setSearchQuery('');
                setOnlyOnline(false);
                setMaxDistanceKm(20);
              }}
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
                  <div className="absolute top-2.5 left-2.5 right-2.5 flex items-center justify-between z-10">
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
                      <span>
                        {profile.hasRightNowIntent
                          ? 'Right Now'
                          : profile.isOnline
                          ? 'Active'
                          : profile.lastActive}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5">
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

                    <p className="text-[11px] text-zinc-300 line-clamp-1 leading-snug">
                      "{profile.headline}"
                    </p>

                    {/* Trust indicator */}
                    <div className="flex items-center justify-between text-[10px] text-zinc-400 pt-0.5 border-t border-white/[0.08]">
                      <span className="text-emerald-400 font-mono flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                        Verified · {reliability}
                      </span>
                      <span className="text-zinc-500 truncate max-w-[80px]">{profile.neighborhood}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )
      )}

      {/* =========================================================================
          6. PROFILE DETAIL MODAL (INSTANT ACTIONABLE INTENT & PROGRESSIVE DISCLOSURE)
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

            {/* Scrollable Body: Headline, Bio, Circles, Safe Haven, Peer Key */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4 text-xs">
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
