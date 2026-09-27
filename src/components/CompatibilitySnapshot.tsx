import React, { useMemo } from 'react';
import { DatingProfile, UserActiveIntent, CompatibilitySignal } from '../types';
import { Sparkles, Check, MapPin, Clock, Coffee, ShieldCheck, Zap } from 'lucide-react';

interface CompatibilitySnapshotProps {
  profile: DatingProfile;
  userIntent?: UserActiveIntent | null;
  userNeighborhood?: string;
  variant?: 'badge' | 'compact' | 'full';
  className?: string;
}

export const getProfileMode = (profile: DatingProfile): 'social' | 'private' => {
  if (profile.intentMode) return profile.intentMode;
  return profile.lookingFor === 'casual' ? 'private' : 'social';
};

export const getProfileIntent = (profile: DatingProfile): string => {
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

/**
 * Computes explainable compatibility signals without fake percentages.
 */
export function computeCompatibilitySignals(
  profile: DatingProfile,
  userIntent?: UserActiveIntent | null,
  userNeighborhood: string = 'Soho'
): {
  signals: CompatibilitySignal[];
  hasIntentMatch: boolean;
  hasGoodMatch: boolean;
  matchTitle: string;
} {
  const profileMode = getProfileMode(profile);
  const profileIntent = getProfileIntent(profile);
  const signals: CompatibilitySignal[] = [];

  let hasIntentMatch = false;

  if (userIntent) {
    // 1. Intent & Mode Evaluation
    if (userIntent.intent === profileIntent) {
      hasIntentMatch = true;
      signals.push({
        type: 'intent',
        label: `Intent match: ${profileIntent}`,
        matched: true,
        scoreWeight: 3,
        detail: 'You are both looking for the exact same interaction',
      });
    } else if (
      (userIntent.intent === 'Hookup · Host' && profileIntent === 'Hookup · Travel') ||
      (userIntent.intent === 'Hookup · Travel' && profileIntent === 'Hookup · Host')
    ) {
      hasIntentMatch = true;
      signals.push({
        type: 'intent',
        label: 'Host & Travel complementary match',
        matched: true,
        scoreWeight: 3,
        detail: 'One can host, one is ready to travel',
      });
    } else if (userIntent.mode === profileMode) {
      signals.push({
        type: 'intent',
        label: `Same mode: ${profileMode.toUpperCase()}`,
        matched: true,
        scoreWeight: 1,
        detail: `Both active in ${profileMode} discovery`,
      });
    }

    // 2. Timing Evaluation
    const userIsRightNow = userIntent.when === 'Now' || userIntent.when === 'Right Now';
    const profileIsRightNow = profile.hasRightNowIntent || profile.isOnline;

    if (userIsRightNow && profileIsRightNow) {
      signals.push({
        type: 'timing',
        label: 'Both available Right Now',
        matched: true,
        scoreWeight: 2,
        detail: 'Active at the same moment within immediate radius',
      });
    } else if (!userIsRightNow && !profile.hasRightNowIntent) {
      signals.push({
        type: 'timing',
        label: 'Timing match: Later / Flexible',
        matched: true,
        scoreWeight: 1,
        detail: 'Both planning ahead rather than immediate spontaneous meetup',
      });
    }

    // 3. Location & Distance Evaluation
    if (profile.approxDistanceKm <= 0.6) {
      signals.push({
        type: 'location',
        label: `Immediate walking distance (~${profile.approxDistanceKm} km)`,
        matched: true,
        scoreWeight: 2,
        detail: `Nearby in ${profile.neighborhood}`,
      });
    } else if (profile.neighborhood.toLowerCase().includes(userNeighborhood.toLowerCase())) {
      signals.push({
        type: 'location',
        label: `Same neighborhood (${profile.neighborhood})`,
        matched: true,
        scoreWeight: 1,
      });
    }

    // 4. Safe Haven Venue
    if (
      userIntent.isNearSafeHaven &&
      profile.favoriteSafeHaven &&
      (userIntent.safeHavenName?.toLowerCase() === profile.favoriteSafeHaven.toLowerCase() ||
        userIntent.safeHavenName?.includes(profile.favoriteSafeHaven) ||
        profile.favoriteSafeHaven.includes(userIntent.safeHavenName || ''))
    ) {
      signals.push({
        type: 'haven',
        label: `Shared Safe Haven: ${profile.favoriteSafeHaven}`,
        matched: true,
        scoreWeight: 2,
        detail: 'Verified vetted meeting location preferred by both',
      });
    }
  } else {
    // If user has not yet set a custom active intent, evaluate general compatibility
    if (profile.hasRightNowIntent) {
      signals.push({
        type: 'timing',
        label: 'Active Right Now',
        matched: true,
        scoreWeight: 2,
      });
    }

    if (profile.approxDistanceKm <= 0.5) {
      signals.push({
        type: 'location',
        label: `Nearby · ${profile.approxDistanceKm} km`,
        matched: true,
        scoreWeight: 1,
      });
    }
  }

  // 5. Trust & Verification
  if ((profile.reliabilityScore || 90) >= 95) {
    signals.push({
      type: 'trust',
      label: `High Trust (${profile.reliabilityScore} score)`,
      matched: true,
      scoreWeight: 1,
    });
  }

  if (profile.verifiedViaQR) {
    signals.push({
      type: 'trust',
      label: 'Peer-to-Peer QR Verified',
      matched: true,
      scoreWeight: 2,
    });
  }

  const matchedCount = signals.filter((s) => s.matched).length;
  const hasGoodMatch = hasIntentMatch || matchedCount >= 3;

  const matchTitle = hasIntentMatch
    ? 'YOUR INTENT MATCHES'
    : hasGoodMatch
    ? 'GOOD INTENT MATCH'
    : 'COMPATIBILITY SIGNALS';

  return {
    signals,
    hasIntentMatch,
    hasGoodMatch,
    matchTitle,
  };
}

export const CompatibilitySnapshot: React.FC<CompatibilitySnapshotProps> = ({
  profile,
  userIntent,
  userNeighborhood = 'Soho',
  variant = 'compact',
  className = '',
}) => {
  const { signals, hasIntentMatch, hasGoodMatch, matchTitle } = useMemo(
    () => computeCompatibilitySignals(profile, userIntent, userNeighborhood),
    [profile, userIntent, userNeighborhood]
  );

  if (variant === 'badge') {
    if (!hasGoodMatch && !hasIntentMatch) return null;

    return (
      <div
        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md font-mono text-[9px] font-bold uppercase tracking-wider ${
          hasIntentMatch
            ? 'bg-amber-400/15 border border-amber-400/40 text-amber-300 shadow-[0_0_10px_rgba(201,162,77,0.25)]'
            : 'bg-purple-500/15 border border-purple-500/35 text-purple-200'
        } ${className}`}
      >
        <Sparkles className="w-2.5 h-2.5 text-amber-400 shrink-0" />
        <span>{matchTitle}</span>
      </div>
    );
  }

  if (variant === 'compact') {
    if (signals.length === 0) return null;

    return (
      <div className={`space-y-1.5 ${className}`}>
        {hasIntentMatch && (
          <div className="flex items-center gap-1 text-[10px] font-mono font-bold text-amber-400 uppercase tracking-wider">
            <Sparkles className="w-3 h-3 text-amber-400" />
            <span>{matchTitle}</span>
          </div>
        )}
        <div className="flex flex-wrap gap-1">
          {signals.slice(0, 3).map((sig, idx) => (
            <span
              key={idx}
              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border ${
                sig.type === 'intent'
                  ? 'bg-amber-950/40 border-amber-500/40 text-amber-200'
                  : sig.type === 'timing'
                  ? 'bg-purple-950/40 border-purple-500/40 text-purple-200'
                  : 'bg-white/[0.04] border-white/10 text-zinc-300'
              }`}
            >
              <Check className="w-2.5 h-2.5 text-emerald-400 shrink-0" />
              <span>{sig.label}</span>
            </span>
          ))}
        </div>
      </div>
    );
  }

  // Full detailed variant for profile sheet/modal
  return (
    <div className={`rounded-xl bg-[#0f1118] border border-white/10 p-3.5 space-y-2.5 ${className}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className={`w-4 h-4 ${hasIntentMatch ? 'text-[#C9A24D]' : 'text-purple-400'}`} />
          <span className="text-xs font-mono font-bold uppercase tracking-wider text-white">
            {matchTitle}
          </span>
        </div>
        <span className="text-[10px] font-mono text-zinc-500">
          Transparent match · No black-box scores
        </span>
      </div>

      <div className="space-y-1.5 pt-1">
        {signals.length === 0 ? (
          <p className="text-xs text-zinc-400 italic">
            Set your active intent in the header to view live mutual alignment.
          </p>
        ) : (
          signals.map((sig, idx) => (
            <div
              key={idx}
              className="flex items-start gap-2 text-xs py-1 px-2 rounded-lg bg-white/[0.02] border border-white/5"
            >
              <div className="mt-0.5">
                {sig.type === 'intent' && <Sparkles className="w-3.5 h-3.5 text-[#C9A24D]" />}
                {sig.type === 'timing' && <Clock className="w-3.5 h-3.5 text-purple-400" />}
                {sig.type === 'location' && <MapPin className="w-3.5 h-3.5 text-cyan-400" />}
                {sig.type === 'haven' && <Coffee className="w-3.5 h-3.5 text-amber-400" />}
                {sig.type === 'trust' && <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />}
              </div>
              <div className="flex-1 min-w-0">
                <span className="font-semibold text-zinc-200">{sig.label}</span>
                {sig.detail && (
                  <p className="text-[11px] text-zinc-400 leading-tight mt-0.5">{sig.detail}</p>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
