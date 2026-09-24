import React, { useState, useMemo } from 'react';
import { DatingProfile, SafeHaven } from '../types';
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
  Award,
  QrCode,
  Zap,
  Radio
} from 'lucide-react';

export type EncounterIntent = 'All' | 'Meet' | 'Hookup' | 'Drinks' | 'Date' | 'Chat' | 'Group';

interface DatingGridViewProps {
  profiles: DatingProfile[];
  safeHavens: SafeHaven[];
  userNeighborhood: string;
  onOpenDirectChatWithProfile: (profile: DatingProfile) => void;
  onProposeHavenDate: (profile: DatingProfile, havenName?: string) => void;
  onToggleFavorite: (profileId: string) => void;
  onOpenQRWithPeer?: (profile: DatingProfile) => void;
}

export const DatingGridView: React.FC<DatingGridViewProps> = ({
  profiles,
  safeHavens,
  userNeighborhood,
  onOpenDirectChatWithProfile,
  onProposeHavenDate,
  onToggleFavorite,
  onOpenQRWithPeer,
}) => {
  const [selectedProfile, setSelectedProfile] = useState<DatingProfile | null>(null);
  const [filterIntent, setFilterIntent] = useState<EncounterIntent>('All');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [onlyOnline, setOnlyOnline] = useState<boolean>(false);
  const [maxDistanceKm, setMaxDistanceKm] = useState<number>(5);
  const [imageErrors, setImageErrors] = useState<Record<string, boolean>>({});

  // Map each profile to a primary encounter intent
  const getProfileIntent = (profile: DatingProfile): Exclude<EncounterIntent, 'All'> => {
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
    if (profile.isOnline) return 'Available now · ~2 hrs';
    if (profile.lastActive?.includes('m') || profile.lastActive?.includes('now')) return 'Available tonight';
    return 'Open to meeting';
  };

  const filteredProfiles = useMemo(() => {
    return profiles.filter((p) => {
      const intent = getProfileIntent(p);
      if (filterIntent !== 'All' && intent !== filterIntent) {
        return false;
      }
      if (onlyOnline && !p.isOnline) {
        return false;
      }
      if (p.approxDistanceKm > maxDistanceKm) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesName = p.name.toLowerCase().includes(q);
        const matchesBio = p.bio.toLowerCase().includes(q);
        const matchesHeadline = p.headline.toLowerCase().includes(q);
        const matchesNeighborhood = p.neighborhood.toLowerCase().includes(q);
        const matchesInterests = p.interests.some((i) => i.toLowerCase().includes(q));
        if (!matchesName && !matchesBio && !matchesHeadline && !matchesNeighborhood && !matchesInterests) {
          return false;
        }
      }
      return true;
    });
  }, [profiles, filterIntent, onlyOnline, maxDistanceKm, searchQuery]);

  const handleImageError = (profileId: string) => {
    setImageErrors((prev) => ({ ...prev, [profileId]: true }));
  };

  return (
    <div className="space-y-4">
      {/* =========================================================================
          1. HEADER & DISCOVERY INTENT
         ========================================================================= */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-white/[0.08]">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#C9A24D]" />
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white font-sans">
              PEOPLE & INTENT
            </h1>
          </div>
          <p className="text-xs text-zinc-400 mt-0.5">
            Who is nearby and what they are looking for · Encrypted & cloaked by ~300m
          </p>
        </div>

        {/* Quick Search bar */}
        <div className="relative w-full sm:w-64">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by name, intent, vibe..."
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
          2. INTENT FILTERS & CONTROLS
         ========================================================================= */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
        {/* Intent Filters */}
        <div className="flex items-center gap-1 p-1 bg-[#11131a] rounded-xl border border-white/10 overflow-x-auto no-scrollbar">
          {(['All', 'Meet', 'Hookup', 'Drinks', 'Date', 'Chat', 'Group'] as EncounterIntent[]).map((intent) => (
            <button
              key={intent}
              onClick={() => setFilterIntent(intent)}
              className={`h-8 px-3 text-xs font-semibold rounded-lg transition-all whitespace-nowrap cursor-pointer ${
                filterIntent === intent
                  ? 'bg-[#1c1f2b] text-white font-bold border border-[#C9A24D]/40 shadow-sm'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              {intent === 'Hookup' && <span className="text-[#C9A24D] mr-1">●</span>}
              {intent}
            </button>
          ))}
        </div>

        {/* Distance + Online Filter */}
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <button
            onClick={() => setOnlyOnline((prev) => !prev)}
            className={`h-9 px-3 text-xs font-semibold rounded-xl border transition-all flex items-center gap-1.5 cursor-pointer ${
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
            className="h-9 bg-[#11131a] border border-white/10 rounded-xl px-2.5 text-xs text-zinc-300 focus:outline-none focus:border-[#C9A24D] cursor-pointer"
          >
            <option value={1}>Within 1 km</option>
            <option value={2}>Within 2 km</option>
            <option value={5}>Within 5 km</option>
            <option value={20}>Any distance</option>
          </select>
        </div>
      </div>

      {/* Counter summary */}
      <div className="flex items-center justify-between text-xs text-zinc-400 px-1">
        <div>
          <span className="font-semibold text-white">{filteredProfiles.length}</span> members nearby in {userNeighborhood}
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-zinc-400 font-mono">
          <ShieldCheck className="w-3.5 h-3.5 text-[#C9A24D]" />
          <span>Encrypted Intent</span>
        </div>
      </div>

      {/* =========================================================================
          3. PROFILE GRID: CLEAN, HIGH-INTENT DISCOVERY CARDS
         ========================================================================= */}
      {filteredProfiles.length === 0 ? (
        <div className="p-12 text-center rounded-2xl bg-[#11131a] border border-white/10 space-y-3">
          <Compass className="w-8 h-8 text-zinc-500 mx-auto" />
          <h3 className="text-sm font-semibold text-white">No members match this intent</h3>
          <p className="text-xs text-zinc-400 max-w-sm mx-auto">
            Try adjusting your intent filter or increasing the distance radius to see more members nearby.
          </p>
          <button
            onClick={() => {
              setFilterIntent('All');
              setSearchQuery('');
              setOnlyOnline(false);
              setMaxDistanceKm(20);
            }}
            className="h-9 px-4 text-xs font-semibold text-black bg-[#C9A24D] hover:bg-[#b58f3b] rounded-xl transition-colors cursor-pointer"
          >
            Reset Filters
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-4 gap-3 sm:gap-4">
          {filteredProfiles.map((profile) => {
            const hasError = imageErrors[profile.id];
            const intent = getProfileIntent(profile);
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
                  <div className="absolute inset-0 bg-gradient-to-t from-[#090a0e] via-[#090a0e]/45 to-transparent pointer-events-none" />
                </div>

                {/* Top Corner Overlays: Active Status & Favorite */}
                <div className="absolute top-2.5 left-2.5 right-2.5 flex items-center justify-between z-10">
                  <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-black/70 backdrop-blur-md border border-white/10 text-[10px] text-zinc-200 font-medium">
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        profile.isOnline ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-500'
                      }`}
                    />
                    <span>{profile.isOnline ? 'Active' : profile.lastActive}</span>
                  </div>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleFavorite(profile.id);
                    }}
                    className={`w-8 h-8 rounded-lg flex items-center justify-center backdrop-blur-md border transition-colors ${
                      profile.isFavorited
                        ? 'bg-rose-500/25 border-rose-500/50 text-rose-400'
                        : 'bg-black/60 border-white/10 text-zinc-300 hover:text-white'
                    }`}
                    aria-label="Favorite profile"
                  >
                    <Heart className={`w-3.5 h-3.5 ${profile.isFavorited ? 'fill-rose-400' : ''}`} />
                  </button>
                </div>

                {/* Bottom Card Content: Name, Distance, Intent, Headline, Trust */}
                <div className="relative z-10 p-3 text-left space-y-1">
                  {/* Name, Age & Distance */}
                  <div className="flex items-baseline justify-between gap-1">
                    <h3 className="text-sm font-bold text-white tracking-tight truncate">
                      {profile.name}, {profile.age}
                    </h3>
                    <span className="text-[11px] font-mono text-zinc-400 shrink-0 font-medium">
                      {profile.approxDistanceKm} km
                    </span>
                  </div>

                  {/* Intent & Headline */}
                  <div className="flex items-center gap-1.5">
                    <span className="px-1.5 py-0.2 rounded bg-[#C9A24D]/20 text-[#C9A24D] border border-[#C9A24D]/30 text-[10px] font-bold uppercase tracking-wider">
                      {intent}
                    </span>
                    <p className="text-[11px] text-zinc-300 line-clamp-1 leading-snug">
                      "{profile.headline}"
                    </p>
                  </div>

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
      )}

      {/* =========================================================================
          4. PROFILE DETAIL MODAL (INSTANT ACTIONABLE INTENT AT THE TOP)
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
                      selectedProfile.isOnline ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-500'
                    }`}
                  />
                  <span>{selectedProfile.isOnline ? 'Active now' : selectedProfile.lastActive}</span>
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
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="px-2.5 py-1 rounded-lg bg-[#C9A24D]/15 border border-[#C9A24D]/35 text-xs font-black text-[#C9A24D] uppercase tracking-wider">
                    LOOKING FOR: {getProfileIntent(selectedProfile)}
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

              {/* Immediate Primary Actions Right in the Top Viewport */}
              <div className="grid grid-cols-2 gap-2.5 pt-1">
                <button
                  onClick={() => {
                    onProposeHavenDate(selectedProfile, selectedProfile.favoriteSafeHaven);
                    setSelectedProfile(null);
                  }}
                  className="h-11 px-4 text-xs font-bold text-white bg-[#1c1f2b] hover:bg-[#252838] border border-white/10 rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer shadow-sm active:scale-95"
                >
                  <Zap className="w-4 h-4 text-[#C9A24D] fill-current" />
                  <span>I'm Interested</span>
                </button>

                <button
                  onClick={() => {
                    onOpenDirectChatWithProfile(selectedProfile);
                    setSelectedProfile(null);
                  }}
                  className="h-11 px-4 text-xs font-bold text-black bg-[#C9A24D] hover:bg-[#b58f3b] rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer shadow-md active:scale-95"
                >
                  <Lock className="w-3.5 h-3.5" />
                  <span>Message</span>
                </button>
              </div>
            </div>

            {/* Scrollable Body: Headline, Bio, Circles, Safe Haven, Peer Key */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4 text-xs">
              {/* Headline & Bio */}
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
