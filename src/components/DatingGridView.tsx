import React, { useState, useMemo } from 'react';
import { DatingProfile, SafeHaven } from '../types';
import { 
  Heart, 
  MapPin, 
  ShieldCheck, 
  Lock, 
  Search, 
  Filter, 
  X, 
  MessageSquare, 
  Coffee, 
  Sparkles, 
  Check, 
  Clock, 
  Compass, 
  UserCheck, 
  ExternalLink,
  ChevronRight,
  Award,
  QrCode
} from 'lucide-react';

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
  const [filterIntent, setFilterIntent] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [onlyOnline, setOnlyOnline] = useState<boolean>(false);
  const [maxDistanceKm, setMaxDistanceKm] = useState<number>(5);
  const [imageErrors, setImageErrors] = useState<Record<string, boolean>>({});

  const filteredProfiles = useMemo(() => {
    return profiles.filter((p) => {
      if (filterIntent !== 'all' && p.lookingFor !== filterIntent) {
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
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-zinc-800/80">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-amber-400" />
            <h1 className="text-lg sm:text-xl font-bold tracking-tight text-white font-sans">
              Dating & Connections
            </h1>
          </div>
          <p className="text-xs text-zinc-400 mt-0.5">
            Nearby members · End-to-end encrypted chats · Privacy cloaked by ~300m
          </p>
        </div>

        {/* Quick Search bar */}
        <div className="relative w-full sm:w-64">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by name, interests..."
            className="w-full bg-zinc-900 border border-zinc-800 rounded-xl pl-9 pr-8 py-1.5 text-xs text-white placeholder-zinc-500 focus:border-amber-400 focus:outline-none"
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

      {/* Filter Segmented Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
        {/* Intent filter */}
        <div className="flex items-center gap-1 p-1 bg-zinc-900 rounded-xl border border-zinc-800 overflow-x-auto no-scrollbar">
          {[
            { id: 'all', label: 'All Profiles' },
            { id: 'dating', label: 'Dates & Romance' },
            { id: 'dates_coffee', label: 'Coffee & Walks' },
            { id: 'relationship', label: 'Long-term' },
            { id: 'casual', label: 'Spontaneous' },
            { id: 'friends', label: 'Friends' },
          ].map((item) => (
            <button
              key={item.id}
              onClick={() => setFilterIntent(item.id)}
              className={`min-h-[32px] px-3 py-1 text-xs font-medium rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
                filterIntent === item.id
                  ? 'bg-zinc-800 text-white font-semibold'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {/* Secondary filters: Online only + Distance */}
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <button
            onClick={() => setOnlyOnline((prev) => !prev)}
            className={`min-h-[34px] px-3 py-1 text-xs font-medium rounded-xl border transition-colors flex items-center gap-1.5 cursor-pointer ${
              onlyOnline
                ? 'bg-emerald-950/40 text-emerald-300 border-emerald-600/50'
                : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:text-white'
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${onlyOnline ? 'bg-emerald-400' : 'bg-zinc-500'}`} />
            <span>Online now</span>
          </button>

          <select
            value={maxDistanceKm}
            onChange={(e) => setMaxDistanceKm(Number(e.target.value))}
            className="min-h-[34px] bg-zinc-900 border border-zinc-800 rounded-xl px-2.5 py-1 text-xs text-zinc-300 focus:outline-none focus:border-amber-400 cursor-pointer"
          >
            <option value={1}>Within 1 km</option>
            <option value={2}>Within 2 km</option>
            <option value={5}>Within 5 km</option>
            <option value={20}>Any distance</option>
          </select>
        </div>
      </div>

      {/* Grid count & safety reminder */}
      <div className="flex items-center justify-between text-xs text-zinc-400 px-1">
        <div>
          <span className="font-semibold text-zinc-200">{filteredProfiles.length}</span> profiles nearby in {userNeighborhood}
        </div>
        <div className="flex items-center gap-1 text-[11px] text-zinc-500">
          <Lock className="w-3 h-3 text-emerald-400" />
          <span>E2EE Swarm Ready</span>
        </div>
      </div>

      {/* Profile Grid */}
      {filteredProfiles.length === 0 ? (
        <div className="p-12 text-center rounded-2xl bg-zinc-900/40 border border-zinc-800 space-y-2">
          <Compass className="w-8 h-8 text-zinc-500 mx-auto" />
          <h3 className="text-sm font-semibold text-white">No profiles found</h3>
          <p className="text-xs text-zinc-400 max-w-sm mx-auto">
            Try adjusting your distance radius or search keywords to discover more members.
          </p>
          <button
            onClick={() => {
              setFilterIntent('all');
              setSearchQuery('');
              setOnlyOnline(false);
              setMaxDistanceKm(20);
            }}
            className="min-h-[36px] px-3.5 py-1.5 text-xs font-medium text-amber-400 bg-amber-950/30 border border-amber-800/40 rounded-xl hover:bg-amber-900/40 cursor-pointer"
          >
            Reset Filters
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-4 gap-3 sm:gap-4">
          {filteredProfiles.map((profile) => {
            const hasError = imageErrors[profile.id];

            return (
              <div
                key={profile.id}
                onClick={() => setSelectedProfile(profile)}
                className="group relative bg-zinc-900 rounded-2xl overflow-hidden border border-zinc-800/90 hover:border-zinc-700 transition-all cursor-pointer flex flex-col justify-end aspect-[3/4] select-none"
              >
                {/* Photo / Fallback Container */}
                <div className="absolute inset-0 bg-zinc-950">
                  {!hasError ? (
                    <img
                      src={profile.photoUrl}
                      alt={profile.name}
                      onError={() => handleImageError(profile.id)}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover object-center group-hover:scale-105 transition-transform duration-300"
                    />
                  ) : (
                    <div className="w-full h-full bg-gradient-to-br from-zinc-800 to-zinc-950 flex flex-col items-center justify-center p-4 text-center">
                      <div className="w-14 h-14 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center text-base font-bold text-amber-400">
                        {profile.name.charAt(0)}
                      </div>
                      <span className="text-xs font-semibold text-zinc-200 mt-2">{profile.name}</span>
                    </div>
                  )}

                  {/* Scrim Gradient for Legibility */}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/40 to-transparent pointer-events-none" />
                </div>

                {/* Top Corner Badges */}
                <div className="absolute top-2.5 left-2.5 right-2.5 flex items-center justify-between z-10">
                  {/* Online / Active status & Reliability Badge */}
                  <div className="flex items-center gap-1.5">
                    <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-black/60 backdrop-blur-md border border-white/10 text-[10px] text-zinc-300">
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          profile.isOnline ? 'bg-emerald-400' : 'bg-zinc-500'
                        }`}
                      />
                      <span>{profile.isOnline ? 'Online' : profile.lastActive}</span>
                    </div>

                    <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-lg bg-black/60 backdrop-blur-md border border-emerald-500/30 text-[10px] text-emerald-300 font-mono" title={`Reliability Score: ${profile.reliabilityScore || 95}/100`}>
                      <Award className="w-3 h-3 text-emerald-400" />
                      <span>{profile.reliabilityScore || 95}</span>
                    </div>
                  </div>

                  {/* Favorite Bookmark */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleFavorite(profile.id);
                    }}
                    className={`w-7 h-7 rounded-lg flex items-center justify-center backdrop-blur-md border transition-colors ${
                      profile.isFavorited
                        ? 'bg-rose-500/20 border-rose-500/40 text-rose-400'
                        : 'bg-black/50 border-white/10 text-zinc-300 hover:text-white'
                    }`}
                    aria-label="Favorite profile"
                  >
                    <Heart className={`w-3.5 h-3.5 ${profile.isFavorited ? 'fill-rose-400' : ''}`} />
                  </button>
                </div>

                {/* Bottom Content Area */}
                <div className="relative z-10 p-3 text-left space-y-1">
                  <div className="flex items-baseline justify-between gap-1">
                    <h3 className="text-sm font-bold text-white tracking-tight truncate">
                      {profile.name}, {profile.age}
                    </h3>
                    <span className="text-[11px] font-mono text-amber-300 shrink-0">
                      {profile.approxDistanceKm} km
                    </span>
                  </div>

                  <p className="text-[11px] text-zinc-300 line-clamp-1 leading-snug">
                    {profile.headline}
                  </p>

                  <div className="flex items-center gap-1.5 text-[10px] text-zinc-400 pt-0.5">
                    <MapPin className="w-3 h-3 text-zinc-500 shrink-0" />
                    <span className="truncate">{profile.neighborhood}</span>
                    <span>·</span>
                    <span className="text-zinc-300 truncate">{profile.lookingForLabel}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Profile Detail Slide-up Sheet / Modal */}
      {selectedProfile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
          <div className="relative w-full max-w-lg bg-[#111219] border border-zinc-800 rounded-2xl overflow-hidden shadow-2xl flex flex-col max-h-[92vh]">
            {/* Header image area */}
            <div className="relative w-full h-72 sm:h-80 bg-zinc-950 shrink-0 select-none">
              {!imageErrors[selectedProfile.id] ? (
                <img
                  src={selectedProfile.photoUrl}
                  alt={selectedProfile.name}
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover object-center"
                />
              ) : (
                <div className="w-full h-full bg-gradient-to-br from-zinc-800 to-zinc-950 flex flex-col items-center justify-center p-4">
                  <div className="w-16 h-16 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center text-xl font-bold text-amber-400">
                    {selectedProfile.name.charAt(0)}
                  </div>
                </div>
              )}

              {/* Scrim Overlay */}
              <div className="absolute inset-0 bg-gradient-to-t from-[#111219] via-black/40 to-transparent" />

              {/* Top Controls */}
              <div className="absolute top-3 left-3 right-3 flex items-center justify-between z-10">
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-black/60 backdrop-blur-md border border-white/10 text-xs text-zinc-200">
                  <span
                    className={`w-2 h-2 rounded-full ${
                      selectedProfile.isOnline ? 'bg-emerald-400' : 'bg-zinc-500'
                    }`}
                  />
                  <span>{selectedProfile.isOnline ? 'Active now' : selectedProfile.lastActive}</span>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => onToggleFavorite(selectedProfile.id)}
                    className={`min-h-[36px] min-w-[36px] rounded-xl flex items-center justify-center backdrop-blur-md border transition-colors cursor-pointer ${
                      selectedProfile.isFavorited
                        ? 'bg-rose-500/20 border-rose-500/40 text-rose-400'
                        : 'bg-black/60 border-white/10 text-zinc-300 hover:text-white'
                    }`}
                    aria-label="Favorite"
                  >
                    <Heart className={`w-4 h-4 ${selectedProfile.isFavorited ? 'fill-rose-400' : ''}`} />
                  </button>

                  <button
                    onClick={() => setSelectedProfile(null)}
                    className="min-h-[36px] min-w-[36px] rounded-xl bg-black/60 hover:bg-black/80 backdrop-blur-md border border-white/10 text-zinc-300 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
                    aria-label="Close profile"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Identity on photo bottom */}
              <div className="absolute bottom-3 left-4 right-4 z-10">
                <div className="flex items-baseline gap-2">
                  <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
                    {selectedProfile.name}, {selectedProfile.age}
                  </h2>
                  {selectedProfile.rolePronouns && (
                    <span className="text-xs text-zinc-300 font-medium">
                      ({selectedProfile.rolePronouns})
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2 text-xs text-zinc-300 mt-0.5">
                  <MapPin className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  <span>{selectedProfile.neighborhood}</span>
                  <span>·</span>
                  <span>~{selectedProfile.approxDistanceKm} km</span>
                  <span>·</span>
                  <span>{selectedProfile.heightCm} cm</span>
                </div>
              </div>
            </div>

            {/* Scrollable Details Body */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4 text-xs">
              {/* Privacy and Verification Badge */}
              <div className="flex items-center justify-between p-2.5 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-400">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span className="text-[11px] text-zinc-300">
                    Location cloaked (±300m) · Direct device key
                  </span>
                </div>
                <span className="font-mono text-[10px] text-zinc-500">
                  {selectedProfile.peerPublicKey.slice(0, 10)}...
                </span>
              </div>

              {/* Reliability Score & In-Person Swarm Status Card */}
              <div className="p-3 rounded-xl bg-zinc-900/90 border border-zinc-800 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-emerald-950/60 border border-emerald-500/40 flex items-center justify-center text-emerald-400 shrink-0">
                    <Award className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-white flex items-center gap-1.5">
                      <span>Reliability Score:</span>
                      <span className="text-amber-300">{selectedProfile.reliabilityScore || 95}/100</span>
                      {selectedProfile.verifiedViaQR && (
                        <span className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-950 text-emerald-300 border border-emerald-700/50 font-mono">
                          QR Verified
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-zinc-400">
                      {selectedProfile.verifiedPeersCount || 10} verified physical Swarm meetups
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
                    className="min-h-[34px] px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium flex items-center gap-1.5 cursor-pointer shrink-0 border border-zinc-700 transition-colors"
                    title="Scan peer QR to verify public keys"
                  >
                    <QrCode className="w-3.5 h-3.5 text-amber-400" />
                    <span>Scan Key</span>
                  </button>
                )}
              </div>

              {/* Headline & Bio */}
              <div className="space-y-1.5">
                <h4 className="text-sm font-semibold text-white">About Me</h4>
                <p className="text-zinc-300 leading-relaxed text-xs">
                  {selectedProfile.bio}
                </p>
              </div>

              {/* Looking for */}
              <div className="space-y-1.5 pt-2 border-t border-zinc-800/80">
                <h4 className="text-xs font-semibold text-zinc-200">Looking For</h4>
                <div className="text-xs text-amber-300 font-medium">
                  {selectedProfile.lookingForLabel}
                </div>
              </div>

              {/* Interests & Tribes */}
              <div className="space-y-2 pt-2 border-t border-zinc-800/80">
                <h4 className="text-xs font-semibold text-zinc-200">Interests & Activities</h4>
                <div className="flex flex-wrap gap-1.5">
                  {selectedProfile.interests.map((interest, idx) => (
                    <span
                      key={idx}
                      className="px-2.5 py-1 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-300 text-xs"
                    >
                      {interest}
                    </span>
                  ))}
                  {selectedProfile.tribes.map((tribe, idx) => (
                    <span
                      key={'t_' + idx}
                      className="px-2.5 py-1 rounded-lg bg-zinc-900/60 border border-zinc-800/60 text-zinc-400 text-xs"
                    >
                      #{tribe}
                    </span>
                  ))}
                </div>
              </div>

              {/* Favorite Safe Haven */}
              {selectedProfile.favoriteSafeHaven && (
                <div className="p-3 rounded-xl bg-zinc-900/80 border border-zinc-800 space-y-1.5">
                  <div className="text-[10px] uppercase font-mono tracking-wider text-zinc-400">
                    Preferred First Meet Spot:
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Coffee className="w-4 h-4 text-amber-400" />
                      <span className="text-xs font-semibold text-white">
                        {selectedProfile.favoriteSafeHaven}
                      </span>
                    </div>
                    <button
                      onClick={() => {
                        onProposeHavenDate(selectedProfile, selectedProfile.favoriteSafeHaven);
                        setSelectedProfile(null);
                      }}
                      className="text-xs font-medium text-amber-400 hover:text-amber-300 flex items-center gap-1 cursor-pointer"
                    >
                      <span>Suggest Here</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Bottom Actions Sticky Bar */}
            <div className="p-3 sm:p-4 bg-zinc-950 border-t border-zinc-800 flex items-center justify-between gap-3 shrink-0">
              <button
                onClick={() => {
                  onProposeHavenDate(selectedProfile, selectedProfile.favoriteSafeHaven);
                  setSelectedProfile(null);
                }}
                className="flex-1 min-h-[42px] px-3 py-2 text-xs font-medium text-zinc-200 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700/80 rounded-xl transition-colors cursor-pointer flex items-center justify-center gap-1.5"
              >
                <Coffee className="w-3.5 h-3.5 text-amber-400" />
                <span>Propose Date</span>
              </button>

              <button
                onClick={() => {
                  onOpenDirectChatWithProfile(selectedProfile);
                  setSelectedProfile(null);
                }}
                className="flex-1 min-h-[42px] px-4 py-2 text-xs font-semibold text-black bg-amber-400 hover:bg-amber-300 rounded-xl transition-colors cursor-pointer flex items-center justify-center gap-1.5 shadow-sm"
              >
                <Lock className="w-3.5 h-3.5" />
                <span>Encrypted Chat</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
