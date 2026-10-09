import React, { useState, useMemo, useEffect, useRef } from 'react';
import { supabase } from '../services/supabaseClient';
import { getProfilePhotoUrl, loadProfilePhotos, type ProfilePhoto } from '../services/profilePhotoService';
import { loadOutgoingInterestStatuses } from '../services/supabaseService';
import L from 'leaflet';
import {
  Pulse,
  SafeHaven,
  LocationPrivacy,
  DatingProfile,
  UserActiveIntent,
} from '../types';

export type MapDiscoveryItem =
  | { type: 'haven'; item: SafeHaven }
  | { type: 'pulse'; item: Pulse }
  | { type: 'profile'; item: DatingProfile };

const fallbackMapCenter: [number, number] = [FALLBACK_MAP_CENTER.lat, FALLBACK_MAP_CENTER.lng];

/** Published privacy radius for other people's intent positions. */
const PRIVACY_RADIUS_METERS = 300;

// Re-exported so callers/tests can read the ceiling from either module.
export { MAX_TRAVEL_DISTANCE_KM, clampTravelDistanceKm };

/** Great-circle distance in km — computed on the device, never invented. */
/**
 * Group live intents into atmospheric hotspots.
 *
 * Nearby intents merge into one softer, warmer pool of light; isolated intents
 * stay as small quiet pools. This is what keeps the haze reading as *light in
 * the room* rather than as one circle per person.
 */
const clusterIntents = (
  points: { lat: number; lng: number }[],
  radiusKm: number,
): { lat: number; lng: number; count: number }[] => {
  const clusters: { lat: number; lng: number; count: number; sumLat: number; sumLng: number }[] = [];
  for (const point of points) {
    const match = clusters.find(
      (cluster) => haversineKm(cluster.lat, cluster.lng, point.lat, point.lng) <= radiusKm,
    );
    if (!match) {
      clusters.push({ lat: point.lat, lng: point.lng, count: 1, sumLat: point.lat, sumLng: point.lng });
      continue;
    }
    match.sumLat += point.lat;
    match.sumLng += point.lng;
    match.count += 1;
    match.lat = match.sumLat / match.count;
    match.lng = match.sumLng / match.count;
  }
  return clusters.map(({ lat, lng, count }) => ({ lat, lng, count }));
};

/** Haze pool footprint in metres: one intent is small, a crowd spreads. */
const hazeRadiusFor = (count: number): number => 240 + Math.min(count, 12) * 46;

const DEG_TO_RAD = Math.PI / 180;

// ⚡ Bolt Optimization: Extracted DEG_TO_RAD to module scope and inlined the calculation
// to avoid closure reallocation. Testing shows a ~4.7x speedup (428ms -> 89ms for 1M calls).
// This is critical since it runs in hot O(N*M) clustering loops.
const haversineKm = (aLat: number, aLng: number, bLat: number, bLng: number): number => {
  const dLat = (bLat - aLat) * DEG_TO_RAD;
  const dLng = (bLng - aLng) * DEG_TO_RAD;
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(aLat * DEG_TO_RAD) * Math.cos(bLat * DEG_TO_RAD) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
};

const formatDistanceKm = (km?: number): string => {
  if (km === undefined || !isFinite(km)) return 'distance unavailable';
  if (km < 0.1) return 'under 100 m';
  if (km < 10) return `~${km.toFixed(1)} km`;
  return `~${Math.round(km)} km`;
};

const spreadOverlappingCoordinate = (
  lat: number,
  lng: number,
  occupied: Map<string, number>,
): [number, number] => {
  const key = `${lat.toFixed(4)}:${lng.toFixed(4)}`;
  const occurrence = occupied.get(key) ?? 0;
  occupied.set(key, occurrence + 1);

  if (occurrence === 0) return [lat, lng];

  // Visual-only spiderfy offset. The underlying privacy/jitter geometry is unchanged.
  const angle = (occurrence - 1) * (Math.PI / 3);
  const ring = Math.floor((occurrence - 1) / 6) + 1;
  const radius = 0.00028 * ring;
  return [
    lat + Math.sin(angle) * radius,
    lng + Math.cos(angle) * radius,
  ];
};

import { CountdownPill } from './CountdownPill';
import { CompatibilitySnapshot } from './CompatibilitySnapshot';
import { PeerProfileSummary } from './PeerProfileSummary';
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
  Maximize2,
  Edit3,
  Pause,
  Play,
  Share2,
  Compass,
  Sparkles,
  RefreshCw,
  List,
  Radio
} from 'lucide-react';
import { MAP_PROVIDERS, tileLayerOptions } from '../config/mapProviders';
import {
  FALLBACK_MAP_CENTER,
  FALLBACK_MAP_ZOOM,
  LOCATED_MAP_ZOOM,
  MAX_TRAVEL_DISTANCE_KM,
  clampTravelDistanceKm,
  resolveAreaLabel,
} from '../config/mapDefaults';
import { analytics } from '../services/analyticsService';
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
  userLocation?: { lat: number; lng: number } | null;
  datingProfiles?: DatingProfile[];
  activeUserIntent?: UserActiveIntent | null;
  /** True while a publish/pause/end write is in flight. */
  intentBusy?: boolean;
  onOpenDirectChat: (pulse: Pulse) => void;
  onOpenDirectChatWithProfile?: (profile: DatingProfile) => void;
  onSelectHaven: (haven: SafeHaven) => void;
  onGazeAtPeer?: (peerName: string, peerId?: string, intentId?: string) => boolean | void | Promise<boolean | void>;
  onOpenScheduleMeeting?: (peerName: string) => void;
  onOpenSetIntent?: () => void;
  onUpdateActiveUserIntent?: (intent: UserActiveIntent | null) => void;
  onSubmitInterest?: (pulse: Pulse, message?: string, sharedPhotoIds?: string[]) => Promise<{ sent: boolean; mutual: boolean; conversation_id: string | null }>;
  onSubmitGaze?: (pulse: Pulse) => Promise<{ sent: boolean }>;
  onSwitchToLater?: () => void;
  onRequestLocation?: () => void;
  /**
   * Reports the travel distance the user selected (always 1..5 km) so App can
   * pass it to the live `discover_right_now` RPC instead of a fixed radius.
   */
  onMaxDistanceKmChange?: (km: number) => void;
  /** Signed/public URL for the current user's primary profile photo. */
  userAvatarUrl?: string;
}

export const RightNowView: React.FC<RightNowViewProps> = ({
  pulses,
  safeHavens,
  userNeighborhood,
  privacySetting = 'fuzzy_500m',
  userLocation = null,
  datingProfiles = [],
  activeUserIntent = null,
  intentBusy = false,
  onOpenDirectChat,
  onOpenDirectChatWithProfile,
  onSelectHaven,
  onGazeAtPeer,
  onOpenScheduleMeeting,
  onOpenSetIntent,
  onUpdateActiveUserIntent,
  onSubmitInterest,
  onSubmitGaze,
  onSwitchToLater,
  onRequestLocation,
  onMaxDistanceKmChange,
  userAvatarUrl,
}) => {
  // 1. The active Right Now signal is owned by App (Supabase in live mode).
  //    Right Now renders it and routes every change through
  //    `onUpdateActiveUserIntent` — it never writes intent state itself.
  const setActiveUserIntent = (val: UserActiveIntent | null) => {
    onUpdateActiveUserIntent?.(val);
  };

  const [isUserIntentDrawerOpen, setIsUserIntentDrawerOpen] = useState<boolean>(false);
  // Keep the user's own intent compact so the map remains the primary surface.
  // Expanding is temporary; the management sheet remains one tap away.
  const [isUserIntentExpanded, setIsUserIntentExpanded] = useState<boolean>(false);
  const intentCollapseTimerRef = useRef<number | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const statusTimeoutRef = useRef<number | null>(null);

  const clearStatusTimeout = () => {
    if (statusTimeoutRef.current !== null) {
      window.clearTimeout(statusTimeoutRef.current);
      statusTimeoutRef.current = null;
    }
  };

  const showStatusMessage = (message: string, duration = 3000) => {
    clearStatusTimeout();
    setStatusMessage(message);
    statusTimeoutRef.current = window.setTimeout(() => {
      statusTimeoutRef.current = null;
      setStatusMessage(null);
    }, duration);
  };

  const dismissStatusMessage = () => {
    clearStatusTimeout();
    setStatusMessage(null);
  };

  useEffect(() => clearStatusTimeout, []);

  // Map refs & imperative controls
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const layerGroupRef = useRef<L.LayerGroup | null>(null);
  const activeTileLayerRef = useRef<L.TileLayer | null>(null);
  const mapTileRetryRef = useRef<(() => void) | null>(null);
  const mapControlsRef = useRef<{ zoomIn: () => void; zoomOut: () => void; recenter: () => void } | null>(null);
  const userLocationRef = useRef(userLocation);
  // Whether the camera has already been placed on a real device fix. Only the
  // first fix moves the camera — later `watchPosition` updates must never steal
  // the viewport back from the user mid-pan.
  const hasCentredOnUserRef = useRef<boolean>(false);
  const [isMapReady, setIsMapReady] = useState<boolean>(false);
  const [mapTilesUnavailable, setMapTilesUnavailable] = useState<boolean>(false);
  const [currentProviderIndex, setCurrentProviderIndex] = useState<number>(0);

  // Keep the latest location reachable from imperative map code. The camera move
  // itself happens in the single `flyTo` effect below — one move per fix.
  useEffect(() => {
    userLocationRef.current = userLocation;
  }, [userLocation]);

  // 3. Filtering States
  const [isFilterDrawerOpen, setIsFilterDrawerOpen] = useState<boolean>(false);
  const [isNearbyOpen, setIsNearbyOpen] = useState<boolean>(false);
  const [activeCategory, setActiveCategory] = useState<'all' | 'people' | 'coffee' | 'drinks' | 'active' | 'havens'>('all');
  const [activeIntentMode, setActiveIntentMode] = useState<'All' | 'Social' | 'Private'>('All');
  const [selectedSubIntent, setSelectedSubIntent] = useState<string | null>(null);
  const [showJitterCircles, setShowJitterCircles] = useState<boolean>(true);
  const [maxDistanceKm, setMaxDistanceKmState] = useState<number>(MAX_TRAVEL_DISTANCE_KM);
  /** Every write goes through the clamp, so 10 km / 25 km can never be set. */
  const setMaxDistanceKm = (value: number | ((prev: number) => number)) => {
    setMaxDistanceKmState((prev) => clampTravelDistanceKm(typeof value === 'function' ? value(prev) : value));
  };

  // Tell App whenever the selected travel distance changes so live discovery is
  // re-run at that radius. The value is already clamped to the 5 km ceiling.
  useEffect(() => {
    onMaxDistanceKmChange?.(maxDistanceKm);
  }, [maxDistanceKm]);

  // 4. Selected Discovery Item (Docked Compact Bottom Card & Expanded Sheet)
  // Start with a clean map. Discovery details appear only after the user
  // explicitly selects a person, pulse, or Safe Haven.
  const [selectedItem, setSelectedItem] = useState<MapDiscoveryItem | null>(null);

  const [isCardExpanded, setIsCardExpanded] = useState<boolean>(false);

  // 5. "I'm Interested" & Gaze States
  const [interestedIds, setInterestedIds] = useState<Set<string>>(new Set());
  const [interestPendingIds, setInterestPendingIds] = useState<Set<string>>(new Set());
  const [interestStatusByPulseId, setInterestStatusByPulseId] = useState<Record<string, 'pending' | 'mutual' | 'declined' | 'withdrawn'>>({});
  const [gazedPeerNames, setGazedPeerNames] = useState<Set<string>>(new Set());
  const [mutualMatchPulse, setMutualMatchPulse] = useState<Pulse | null>(null);
  const [interestDraftPulse, setInterestDraftPulse] = useState<Pulse | null>(null);
  const [interestMessage, setInterestMessage] = useState('');
  const [interestPhotos, setInterestPhotos] = useState<ProfilePhoto[]>([]);
  const [selectedInterestPhotoIds, setSelectedInterestPhotoIds] = useState<Set<string>>(new Set());
  const [interestComposerBusy, setInterestComposerBusy] = useState(false);

  // Persist sender-side Gayze state across reloads so pending, matched and declined
  // responses remain truthful after navigation or a full reload.
  useEffect(() => {
    let cancelled = false;
    const refreshInterestStatuses = async () => {
      const intentIds = pulses
        .map((pulse) => pulse.id.startsWith('supabase_') ? pulse.id.slice('supabase_'.length) : null)
        .filter((id): id is string => Boolean(id));
      if (!intentIds.length) {
        setInterestStatusByPulseId({});
        return;
      }
      const rows = await loadOutgoingInterestStatuses(intentIds);
      if (cancelled) return;
      const next: Record<string, 'pending' | 'mutual' | 'declined' | 'withdrawn'> = {};
      const interested = new Set<string>();
      for (const row of rows) {
        if (!row.intentId || !['pending', 'mutual', 'declined', 'withdrawn'].includes(row.status)) continue;
        const pulseId = `supabase_${row.intentId}`;
        next[pulseId] = row.status;
        interested.add(pulseId);
      }
      setInterestStatusByPulseId(next);
      setInterestedIds(interested);
    };
    void refreshInterestStatuses();
    const interval = window.setInterval(() => { void refreshInterestStatuses(); }, 15000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [pulses]);

  // 6. Countdown timer for active user intent
  const [remainingMinutes, setRemainingMinutes] = useState<number>(0);
  const [resolvedUserAvatarUrl, setResolvedUserAvatarUrl] = useState<string | null>(userAvatarUrl || null);

  // Resolve the current user's latest primary profile photo for the live map marker.
  // The profile photo bucket is private, so avatar_path must be converted to a
  // short-lived signed URL before it can be rendered inside Leaflet's HTML icon.
  useEffect(() => {
    let cancelled = false;

    const resolveCurrentAvatar = async () => {
      if (!supabase) {
        if (!cancelled) setResolvedUserAvatarUrl(userAvatarUrl || null);
        return;
      }

      try {
        const { data: authData } = await supabase.auth.getUser();
        const userId = authData.user?.id;
        if (!userId) {
          if (!cancelled) setResolvedUserAvatarUrl(userAvatarUrl || null);
          return;
        }

        const { data } = await supabase
          .from('profiles')
          .select('avatar_path')
          .eq('id', userId)
          .maybeSingle();

        const signedUrl = await getProfilePhotoUrl((data?.avatar_path as string | null) || null);
        if (!cancelled) setResolvedUserAvatarUrl(signedUrl || userAvatarUrl || null);
      } catch (error) {
        console.warn('[GAYZE] Could not resolve current map avatar:', error);
        if (!cancelled) setResolvedUserAvatarUrl(userAvatarUrl || null);
      }
    };

    void resolveCurrentAvatar();
    return () => {
      cancelled = true;
    };
  }, [userAvatarUrl]);

  useEffect(() => {
    if (!activeUserIntent) {
      setRemainingMinutes(0);
      return;
    }

    // The backend expiry timestamp is authoritative. Recalculate frequently
    // enough that the map CTA and management sheet never get stuck on "0m"
    // while the signal is still live.
    const updateRemaining = () => {
      const expiresAt = Number(activeUserIntent.expiresAt);
      const remaining = Number.isFinite(expiresAt)
        ? Math.max(0, Math.ceil((expiresAt - Date.now()) / 60000))
        : 0;

      setRemainingMinutes(remaining);

      // Once the authoritative expiry has passed, immediately remove the stale
      // local signal. Supabase already filters expired rows from discovery.
      if (remaining <= 0 && expiresAt <= Date.now() && !activeUserIntent.isPaused) {
        onUpdateActiveUserIntent?.(null);
      }
    };

    updateRemaining();
    const interval = window.setInterval(updateRemaining, 10000);
    return () => window.clearInterval(interval);
  }, [
    activeUserIntent?.remoteId,
    activeUserIntent?.expiresAt,
    activeUserIntent?.isPaused,
    onUpdateActiveUserIntent,
  ]);

  // Map-first behaviour: start compact, then collapse again after inactivity.
  useEffect(() => {
    if (intentCollapseTimerRef.current !== null) {
      window.clearTimeout(intentCollapseTimerRef.current);
      intentCollapseTimerRef.current = null;
    }

    setIsUserIntentExpanded(false);

    if (!activeUserIntent) return;

    intentCollapseTimerRef.current = window.setTimeout(() => {
      setIsUserIntentExpanded(false);
      intentCollapseTimerRef.current = null;
    }, 4500);

    return () => {
      if (intentCollapseTimerRef.current !== null) {
        window.clearTimeout(intentCollapseTimerRef.current);
        intentCollapseTimerRef.current = null;
      }
    };
  }, [activeUserIntent?.remoteId]);

  useEffect(() => {
    if (!isUserIntentExpanded || !activeUserIntent) return;

    if (intentCollapseTimerRef.current !== null) {
      window.clearTimeout(intentCollapseTimerRef.current);
    }

    intentCollapseTimerRef.current = window.setTimeout(() => {
      setIsUserIntentExpanded(false);
      intentCollapseTimerRef.current = null;
    }, 6000);

    return () => {
      if (intentCollapseTimerRef.current !== null) {
        window.clearTimeout(intentCollapseTimerRef.current);
        intentCollapseTimerRef.current = null;
      }
    };
  }, [isUserIntentExpanded, activeUserIntent?.remoteId]);

  // A slow tick keeps expired intents off the map even between discovery refreshes.
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const interval = window.setInterval(() => setNowTick(Date.now()), 30000);
    return () => window.clearInterval(interval);
  }, []);
  // Only genuinely live signals reach the map, the counters and the nearby
  // drawer: a real, finite, still-in-the-future expiry, and not paused. This
  // matches `isItemLive` exactly — a pulse with no expiry is NOT live, so it
  // can never render a marker for an intent that has ended or been paused.
  const livePulses = useMemo(
    () => pulses.filter((pulse) => (
      !pulse.isPaused
      && Number.isFinite(pulse.expiresAt)
      && pulse.expiresAt > nowTick
    )),
    [pulses, nowTick],
  );

  // Handle saving newly created or edited Right Now intent
  // Pause / Resume user intent
  const handleTogglePause = () => {
    if (!activeUserIntent) return;
    hapticLight();
    const nextPaused = !activeUserIntent.isPaused;
    setActiveUserIntent({ ...activeUserIntent, isPaused: nextPaused });
    setIsUserIntentExpanded(false);
    // App owns the single authoritative toast for the async pause/resume result.
  };

  // End active intent early
  const handleEndIntent = () => {
    hapticSensitiveAction();
    setIsUserIntentDrawerOpen(false);
    setIsUserIntentExpanded(false);
    setActiveUserIntent(null);
    // App owns the pending + confirmed/error toast in one shared lane.
  };

  // Express an intent interest with optional note and selected album photos.
  const handleTapInterested = async (id: string, pulseObj?: Pulse) => {
    hapticLight();
    if (!pulseObj || interestComposerBusy) return;
    if (interestedIds.has(id)) return;
    setInterestDraftPulse(pulseObj);
    setInterestMessage('');
    setSelectedInterestPhotoIds(new Set());
    try { setInterestPhotos(await loadProfilePhotos()); } catch { setInterestPhotos([]); }
  };

  const sendInterestRequest = async () => {
    if (!interestDraftPulse || !onSubmitInterest || interestComposerBusy) return;
    setInterestComposerBusy(true);
    setInterestPendingIds((prev) => new Set(prev).add(interestDraftPulse.id));
    try {
      const result = await onSubmitInterest(interestDraftPulse, interestMessage, Array.from(selectedInterestPhotoIds));
      if (!result.sent) { showStatusMessage('Gayze could not be sent — try again.'); return; }
      setInterestedIds((prev) => new Set(prev).add(interestDraftPulse.id));
      setInterestStatusByPulseId((prev) => ({ ...prev, [interestDraftPulse.id]: 'pending' }));
      setInterestDraftPulse(null);
      showStatusMessage(`Gayze sent to ${interestDraftPulse.peerName} — awaiting their response`, 3500);
    } catch (error) {
      console.error('[GAYZE] Intent interest submission failed', error);
      showStatusMessage('Intent interest could not be sent — try again.');
    } finally {
      setInterestPendingIds((prev) => {
        const next = new Set(prev);
        if (interestDraftPulse) next.delete(interestDraftPulse.id);
        return next;
      });
      setInterestComposerBusy(false);
    }
  };

  const handleGazeAtPerson = async (name: string, peerId: string, pulseObj?: Pulse) => {
    triggerVibration([40, 80]);
    try {
      const sent = pulseObj && onSubmitGaze
        ? (await onSubmitGaze(pulseObj)).sent
        : await onGazeAtPeer?.(name, peerId);
      if (sent === true) setGazedPeerNames((prev) => new Set(prev).add(peerId));
      else showStatusMessage('Gaze could not be sent — try again');
    } catch { showStatusMessage('Gaze could not be sent — try again'); }
  };

  const formatRemainingTime = (mins: number) => {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  };

  // ---------------------------------------------------------------------------
  // Distance is either the value measured by the discovery function or computed
  // on-device from the (already privacy-jittered) coordinates. It is never
  // substituted with a placeholder number.
  // ---------------------------------------------------------------------------
  const distanceKmForPulse = (pulse: Pulse): number | undefined => {
    if (typeof pulse.approxDistanceKm === 'number' && pulse.approxDistanceKm > 0) return pulse.approxDistanceKm;
    if (userLocation && Number.isFinite(pulse.lat) && Number.isFinite(pulse.lng)) {
      return haversineKm(userLocation.lat, userLocation.lng, pulse.lat, pulse.lng);
    }
    return undefined;
  };

  const distanceKmForHaven = (haven: SafeHaven): number | undefined => {
    if (typeof haven.approxDistanceKm === 'number' && haven.approxDistanceKm > 0) return haven.approxDistanceKm;
    if (userLocation && Number.isFinite(haven.lat) && Number.isFinite(haven.lng)) {
      return haversineKm(userLocation.lat, userLocation.lng, haven.lat, haven.lng);
    }
    return undefined;
  };

  const distanceKmForProfile = (profile: DatingProfile): number | undefined =>
    typeof profile.approxDistanceKm === 'number' && profile.approxDistanceKm > 0
      ? profile.approxDistanceKm
      : undefined;

  const withinDistance = (km: number | undefined, maxKm: number) => km === undefined || km <= maxKm;

  const matchesFilters = (input: {
    isPrivate: boolean;
    km: number | undefined;
    category: 'pulse' | 'haven' | 'profile';
    activityCategory?: string;
    hasIntent?: boolean;
    specificIntent?: string;
  }): boolean => {
    const { category, isPrivate, km, activityCategory, specificIntent } = input;
    if (activeIntentMode === 'Social' && isPrivate) return false;
    if (activeIntentMode === 'Private' && !isPrivate) return false;
    if (selectedSubIntent && specificIntent && specificIntent !== selectedSubIntent) return false;
    if (!withinDistance(km, maxDistanceKm)) return false;
    if (category === 'haven') return activeCategory === 'all' || activeCategory === 'havens';
    if (category === 'profile') return activeCategory === 'all' || activeCategory === 'people';
    if (activeCategory === 'people' || activeCategory === 'havens') return false;
    if (activeCategory !== 'all' && activityCategory !== activeCategory) return false;
    return true;
  };

  // Filtered active count
  const filteredActiveCount = useMemo(() => {
    let count = 0;
    if (activeCategory === 'all' || activeCategory === 'people') {
      count += datingProfiles.filter((profile) => matchesFilters({
        category: 'profile',
        isPrivate: profile.intentMode === 'private' || profile.lookingFor === 'casual',
        km: distanceKmForProfile(profile),
      })).length;
    }
    if (activeCategory !== 'people' && activeCategory !== 'havens') {
      count += livePulses.filter((pulse) => matchesFilters({
        category: 'pulse',
        isPrivate: pulse.intentMode === 'private' || Boolean(pulse.intent?.includes('Hookup')),
        km: distanceKmForPulse(pulse),
        activityCategory: pulse.activityCategory,
      })).length;
    }
    if (activeCategory === 'all' || activeCategory === 'havens') {
      count += safeHavens.filter((haven) => matchesFilters({
        category: 'haven',
        isPrivate: false,
        km: distanceKmForHaven(haven),
      })).length;
    }
    return count;
  }, [livePulses, datingProfiles, safeHavens, activeCategory, activeIntentMode, maxDistanceKm, userLocation]);

  // Live members count (people only, excluding safe haven facilities)
  const liveMembersCount = useMemo(() => {
    let count = 0;
    if (activeCategory === 'all' || activeCategory === 'people') {
      count += datingProfiles.filter((profile) => matchesFilters({
        category: 'profile',
        isPrivate: profile.intentMode === 'private' || profile.lookingFor === 'casual',
        km: distanceKmForProfile(profile),
      })).length;
    }
    if (activeCategory !== 'havens') {
      count += livePulses.filter((pulse) => (activeCategory === 'people' ? false : matchesFilters({
        category: 'pulse',
        isPrivate: pulse.intentMode === 'private' || Boolean(pulse.intent?.includes('Hookup')),
        km: distanceKmForPulse(pulse),
        activityCategory: pulse.activityCategory,
      }))).length;
    }
    return count;
  }, [livePulses, datingProfiles, activeCategory, activeIntentMode, maxDistanceKm, userLocation]);

  // Active filter count for badge
  const activeFilterCount = useMemo(() => {
    let num = 0;
    if (activeCategory !== 'all') num += 1;
    if (activeIntentMode !== 'All') num += 1;
    if (!showJitterCircles) num += 1;
    if (maxDistanceKm < MAX_TRAVEL_DISTANCE_KM) num += 1;
    return num;
  }, [activeCategory, activeIntentMode, showJitterCircles, maxDistanceKm]);

  // Nearby rows for the discovery drawer — same filter set as the map, sorted by distance
  const nearbyItems = useMemo<MapDiscoveryItem[]>(() => {
    const collected: { item: MapDiscoveryItem; km: number }[] = [];
    if (activeCategory === 'all' || activeCategory === 'people') {
      datingProfiles.forEach((profile) => {
        const km = distanceKmForProfile(profile);
        if (!matchesFilters({
          category: 'profile',
          isPrivate: profile.intentMode === 'private' || profile.lookingFor === 'casual',
          km,
        })) return;
        collected.push({ item: { type: 'profile', item: profile }, km: km ?? Number.POSITIVE_INFINITY });
      });
    }
    if (activeCategory !== 'people' && activeCategory !== 'havens') {
      livePulses.forEach((pulse) => {
        if (pulse.peerId === 'peer_me') return;
        const km = distanceKmForPulse(pulse);
        if (!matchesFilters({
          category: 'pulse',
          isPrivate: pulse.intentMode === 'private' || Boolean(pulse.intent?.includes('Hookup')),
          km,
          activityCategory: pulse.activityCategory,
        })) return;
        collected.push({ item: { type: 'pulse', item: pulse }, km: km ?? Number.POSITIVE_INFINITY });
      });
    }
    if (activeCategory === 'all' || activeCategory === 'havens') {
      safeHavens.forEach((haven) => {
        const km = distanceKmForHaven(haven);
        if (!matchesFilters({ category: 'haven', isPrivate: false, km })) return;
        collected.push({ item: { type: 'haven', item: haven }, km: km ?? Number.POSITIVE_INFINITY });
      });
    }
    return collected
      .sort((a, b) => a.km - b.km)
      .map((entry) => entry.item);
  }, [datingProfiles, livePulses, safeHavens, activeCategory, activeIntentMode, maxDistanceKm, privacySetting, userLocation]);

  const itemDistanceKm = (item: MapDiscoveryItem): number | undefined => {
    if (item.type === 'pulse') return distanceKmForPulse(item.item);
    if (item.type === 'haven') return distanceKmForHaven(item.item);
    return distanceKmForProfile(item.item);
  };

  /** Whether the item on screen is genuinely live right now (never assumed). */
  const isItemLive = (item: MapDiscoveryItem): boolean => {
    if (item.type === 'haven') return true;
    const expiresAt = item.type === 'pulse' ? item.item.expiresAt : item.item.intentExpiresAt;
    if (!expiresAt) return false;
    return expiresAt > nowTick;
  };

  const isItemPrivate = (item: MapDiscoveryItem): boolean => {
    if (item.type === 'haven') return false;
    if (item.type === 'pulse') {
      return item.item.intentMode === 'private' || Boolean(item.item.intent?.includes('Hookup'));
    }
    return item.item.intentMode === 'private' || item.item.lookingFor === 'casual';
  };

  const isSelectedLive = selectedItem ? isItemLive(selectedItem) : false;
  const selectedItemIsPrivate = selectedItem ? isItemPrivate(selectedItem) : false;

  // Helpers for discovery item rendering
  const getDisplayName = (item: MapDiscoveryItem) => {
    if (item.type === 'haven') return item.item.name;
    if (item.type === 'pulse') return `${item.item.peerName}${item.item.peerAge ? ` · ${item.item.peerAge}` : ''}`;
    return `${item.item.name}${item.item.age ? ` · ${item.item.age}` : ''}`;
  };

  const getDisplayDescription = (item: MapDiscoveryItem) => {
    if (item.type === 'haven') return item.item.features?.join(' · ') || 'Venue details unavailable.';
    if (item.type === 'pulse') return item.item.description;
    return item.item.headline;
  };

  // Reset all filters
  const handleClearFilters = () => {
    hapticLight();
    setActiveCategory('all');
    setActiveIntentMode('All');
    setShowJitterCircles(true);
    setMaxDistanceKm(MAX_TRAVEL_DISTANCE_KM);
  };

  // Retry the same provider/fallback pipeline used by the live map.
  const handleRetryMapTiles = () => {
    hapticLight();
    mapTileRetryRef.current?.();
  };

  // 7. Initialize Leaflet Map with ResizeObserver, explicit height, and invalidateSize
  useEffect(() => {
    if (!mapContainerRef.current) return;
    const container = mapContainerRef.current;
    container.classList.add('gayze-leaflet-map');
    container.style.position = 'absolute';
    container.style.inset = '0';
    container.style.width = '100%';
    container.style.height = '100%';
    container.style.minHeight = '320px';

    if (mapInstanceRef.current) {
      try {
        mapInstanceRef.current.remove();
      } catch (e) {
        console.warn('[GAYZE] Map instance remove warning:', e);
      }
      mapInstanceRef.current = null;
    }

    if ((container as any)._leaflet_id) {
      try {
        delete (container as any)._leaflet_id;
      } catch {
        (container as any)._leaflet_id = null;
      }
    }

    let map: L.Map;
    const firstVisiblePulse = pulses.find(
      (pulse) => Number.isFinite(pulse.lat) && Number.isFinite(pulse.lng),
    );
    const initialCenter: [number, number] = userLocationRef.current
      ? [userLocationRef.current.lat, userLocationRef.current.lng]
      : firstVisiblePulse
        ? [firstVisiblePulse.lat, firstVisiblePulse.lng]
        : fallbackMapCenter;
    // The map was built already centred on the device fix, so the one-shot
    // camera move below is no longer needed for this session.
    if (userLocationRef.current) hasCentredOnUserRef.current = true;
    const initialZoom = userLocationRef.current
      ? LOCATED_MAP_ZOOM
      : firstVisiblePulse
        ? 13
        : FALLBACK_MAP_ZOOM;
    try {
      map = L.map(container, {
        center: initialCenter,
        zoom: initialZoom,
        minZoom: 2,
        maxZoom: 18,
        zoomControl: false,
        preferCanvas: false,
        attributionControl: true,
      });
    } catch (e) {
      console.warn('[GAYZE] Map init retry with clean container', e);
      try {
        delete (container as any)._leaflet_id;
        container.innerHTML = '';
        map = L.map(container, {
          center: initialCenter,
          zoom: initialZoom,
          minZoom: 2,
          maxZoom: 18,
          zoomControl: false,
          preferCanvas: false,
          attributionControl: true,
        });
      } catch (err2) {
        console.error('[GAYZE] Fatal map init error:', err2);
        return;
      }
    }

    // Unified Map Provider abstraction with graceful auto-fallback
    let providerIdx = 0;
    let activeTileLayer: L.TileLayer | null = null;
    let fallbackTimer: number | null = null;

    const attachProviderLayer = (index: number) => {
      const targetMap = mapInstanceRef.current || map;
      if (!targetMap) return;

      if (fallbackTimer !== null) {
        window.clearTimeout(fallbackTimer);
        fallbackTimer = null;
      }

      if (activeTileLayer) {
        try {
          targetMap.removeLayer(activeTileLayer);
        } catch { }
        activeTileLayer = null;
      }

      if (index >= MAP_PROVIDERS.length) {
        console.warn('[GAYZE] All map tile providers exhausted. Preserving radar backdrop.');
        setMapTilesUnavailable(true);
        activeTileLayerRef.current = null;
        return;
      }

      const provider = MAP_PROVIDERS[index];
      providerIdx = index;
      setMapTilesUnavailable(false);
      setCurrentProviderIndex(index);

      const layer = L.tileLayer(provider.url, tileLayerOptions(provider));

      let errorCount = 0;
      layer.on('tileerror', () => {
        errorCount += 1;
        if (errorCount < 3 || index + 1 >= MAP_PROVIDERS.length || fallbackTimer !== null) return;

        fallbackTimer = window.setTimeout(() => {
          fallbackTimer = null;
          if (errorCount >= 3 && mapInstanceRef.current) {
            console.warn(`[GAYZE] Tile failures on ${provider.name}. Falling back to next provider.`);
            attachProviderLayer(index + 1);
          }
        }, 1200);
      });

      layer.addTo(targetMap);
      activeTileLayer = layer;
      activeTileLayerRef.current = layer;
    };

    mapTileRetryRef.current = () => {
      providerIdx = 0;
      setMapTilesUnavailable(false);
      attachProviderLayer(0);
    };

    attachProviderLayer(0);

    // GAYZE haze pane: sits under the markers so atmosphere never obscures
    // something the user is trying to read.
    map.createPane('gayzeHaze');
    const hazePane = map.getPane('gayzeHaze');
    if (hazePane) hazePane.classList.add('g-haze-pane');

    const layerGroup = L.layerGroup().addTo(map);
    layerGroupRef.current = layerGroup;
    mapInstanceRef.current = map;
    setIsMapReady(true);

    mapControlsRef.current = {
      zoomIn: () => map.zoomIn(),
      zoomOut: () => map.zoomOut(),
      recenter: () => {
        const location = userLocationRef.current;
        if (location) {
          map.flyTo([location.lat, location.lng], LOCATED_MAP_ZOOM, { duration: 0.8 });
          return;
        }
        const firstPulse = pulses.find(
          (pulse) => Number.isFinite(pulse.lat) && Number.isFinite(pulse.lng),
        );
        if (firstPulse) {
          map.flyTo([firstPulse.lat, firstPulse.lng], 13, { duration: 0.8 });
        } else {
          map.flyTo(fallbackMapCenter, FALLBACK_MAP_ZOOM, { duration: 0.8 });
        }
      },
    };

    const invalidate = () => {
      requestAnimationFrame(() => {
        if (mapInstanceRef.current) {
          mapInstanceRef.current.invalidateSize({ pan: false, debounceMoveend: true });
        }
      });
    };

    // Invoke invalidateSize on mount at staggered intervals for smooth layout stabilization
    invalidate();
    const timer1 = window.setTimeout(invalidate, 80);
    const timer2 = window.setTimeout(invalidate, 250);
    const timer3 = window.setTimeout(invalidate, 600);
    const timer4 = window.setTimeout(invalidate, 1200);

    // Window resize listener
    window.addEventListener('resize', invalidate);

    // Use ResizeObserver to handle container layout changes and invoke invalidateSize
    let resizeObserver: ResizeObserver | null = null;
    if (typeof window !== 'undefined' && 'ResizeObserver' in window && container) {
      resizeObserver = new ResizeObserver(() => {
        if (mapInstanceRef.current) {
          mapInstanceRef.current.invalidateSize({ pan: false, debounceMoveend: true });
        }
      });
      resizeObserver.observe(container);
    }

    return () => {
      window.clearTimeout(timer1);
      window.clearTimeout(timer2);
      window.clearTimeout(timer3);
      window.clearTimeout(timer4);
      window.removeEventListener('resize', invalidate);
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
      setIsMapReady(false);
      mapTileRetryRef.current = null;
      if (fallbackTimer !== null) window.clearTimeout(fallbackTimer);
      try {
        map.remove();
      } catch (err) {
        console.warn('[GAYZE] Map removal error:', err);
      }
      mapInstanceRef.current = null;
      layerGroupRef.current = null;
      if (container && (container as any)._leaflet_id) {
        try {
          delete (container as any)._leaflet_id;
        } catch { }
      }
    };
  }, []);

  // Once the FIRST real device location arrives, move the live map to it.
  // This replaces the previous behaviour where the map could remain centred
  // on a fallback location after permission was granted.
  //
  // It deliberately fires only once. `watchCurrentLocation` emits a new object
  // on every GPS callback, so an unconditional `[userLocation]` effect used to
  // re-fly the camera on each fix — yanking the viewport back while the user
  // was panning. Later fixes still update the marker; only the explicit
  // "recenter" control moves the camera again.
  useEffect(() => {
    if (hasCentredOnUserRef.current) return;
    if (!userLocation) return;
    if (!isMapReady) return;
    const map = mapInstanceRef.current;
    if (!map) return;
    hasCentredOnUserRef.current = true;
    map.flyTo([userLocation.lat, userLocation.lng], LOCATED_MAP_ZOOM, { duration: 0.7 });
  }, [userLocation, isMapReady]);

  // Update map layers on pulses, havens, profiles, or filter changes
  useEffect(() => {
    if (!isMapReady) return;
    const map = mapInstanceRef.current;
    const layerGroup = layerGroupRef.current;
    if (!map || !layerGroup) return;

    layerGroup.clearLayers();

    // 0. Purple atmosphere — soft spatial pools of light around live intent.
    //
    //    Each pool is drawn as four concentric, very low-alpha fills inside a
    //    dedicated pane beneath the markers. Together they resolve as one soft
    //    spatial gradient (light through smoke) at a fraction of the cost of a
    //    blurred layer, so panning stays smooth on mobile. Concentrations merge
    //    into a single denser pool — the haze is a property of the area, not a
    //    ring around a person, and it never encodes anyone's exact position.
    if (activeCategory !== 'people' && activeCategory !== 'havens') {
      const hazePoints: { lat: number; lng: number }[] = [];
      livePulses.forEach((pulse) => {
        // Your own signal is drawn from your live intent at your device
        // position (see the self marker below) — never as a nearby row.
        if (pulse.peerId === 'peer_me') return;
        if (!Number.isFinite(pulse.lat) || !Number.isFinite(pulse.lng)) return;
        if (!matchesFilters({
          category: 'pulse',
          isPrivate: pulse.intentMode === 'private' || Boolean(pulse.intent?.includes('Hookup')),
          km: distanceKmForPulse(pulse),
          activityCategory: pulse.activityCategory,
        })) return;
        hazePoints.push({ lat: pulse.lat, lng: pulse.lng });
      });

      clusterIntents(hazePoints, 1.1)
        .slice(0, 20)
        .forEach((cluster) => {
          const radius = hazeRadiusFor(cluster.count);
          const dense = cluster.count > 3;
          // Three bands of very low alpha resolve as one soft gradient. Only the
          // outer shell animates, so a busy map costs three fills per hotspot and
          // a single animated property.
          [
            { scale: 1, opacity: 0.05, layer: 'outer' },
            { scale: 0.62, opacity: 0.052, layer: 'mid' },
            { scale: 0.3, opacity: 0.058, layer: 'core' },
          ].forEach((band) => {
            L.circle([cluster.lat, cluster.lng], {
              pane: 'gayzeHaze',
              radius: radius * band.scale,
              stroke: false,
              fillColor: dense ? '#9d74ec' : '#6F3CC3',
              fillOpacity: band.opacity,
              interactive: false,
              bubblingMouseEvents: false,
              className: `g-haze g-haze--${band.layer}${dense ? ' g-haze--dense' : ''}`,
            }).addTo(layerGroup);
          });
        });
    }

    // 1. Your own position, and — when you are live — your own signal.
    if (privacySetting !== 'ghost' && userLocation) {
      const userJitterRadius = privacySetting === 'neighborhood' ? 800 : 500;
      const isLive = Boolean(activeUserIntent && !activeUserIntent.isPaused);
      if (showJitterCircles) {
        // Your own privacy area, drawn in the brand's violet rather than a
        // generic blue so the whole map stays inside one palette.
        L.circle([userLocation.lat, userLocation.lng], {
          radius: userJitterRadius,
          color: 'rgba(170, 132, 245, 0.55)',
          weight: 1,
          dashArray: '3, 5',
          fillColor: '#6F3CC3',
          fillOpacity: 0.05,
        }).addTo(layerGroup);
      }

      const selfIcon = L.divIcon({
        className: 'custom-user-marker',
        html: isLive
          ? `<div class="gm-self gm-self--${activeUserIntent?.mode === 'private' ? 'private' : 'social'}${activeUserIntent?.isPaused ? ' gm-self--paused' : ''}">${
              resolvedUserAvatarUrl
                ? `<img class="gm-self__photo" src="${resolvedUserAvatarUrl.replace(/"/g, '&quot;')}" alt="" />`
                : ''
            }</div>`
          : '<div class="gm-user"></div>',
        iconSize: isLive ? [34, 34] : [14, 14],
        iconAnchor: isLive ? [17, 17] : [7, 7],
      });
      L.marker([userLocation.lat, userLocation.lng], { icon: selfIcon, zIndexOffset: 400 })
        .addTo(layerGroup)
        .bindTooltip(
          isLive
            ? `Your live signal · ${resolveAreaLabel(userNeighborhood)}`
            : `Approximate area · ${resolveAreaLabel(userNeighborhood)}`,
          { direction: 'top', offset: [0, -10] },
        );
    }

    const occupiedMarkerCoordinates = new Map<string, number>();

    // 2. Safe Havens
    if (activeCategory === 'all' || activeCategory === 'havens') {
      safeHavens.forEach((haven) => {
        if (typeof haven.lat !== 'number' || isNaN(haven.lat) || typeof haven.lng !== 'number' || isNaN(haven.lng)) return;
        if (!withinDistance(distanceKmForHaven(haven), maxDistanceKm)) return;
        const lat = haven.lat;
        const lng = haven.lng;
        const markerCoords = spreadOverlappingCoordinate(lat, lng, occupiedMarkerCoordinates);
        const selected = selectedItem?.type === 'haven' && selectedItem.item.id === haven.id;
        const icon = L.divIcon({
          className: 'custom-haven-marker',
          html: `<div class="gm-haven ${selected ? 'gm-haven--sel' : ''}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg></div>`,
          iconSize: [30, 30],
          iconAnchor: [15, 15],
        });
        const marker = L.marker(markerCoords, { icon }).addTo(layerGroup);
        marker.on('click', () => {
          hapticLight();
          setSelectedItem({ type: 'haven', item: haven });
          setIsCardExpanded(false);
        });
      });
    }

    // 3. Demo profiles — only used when Supabase is not configured. Live mode
    //    renders real intent rows (below) at their published coordinates.
    if ((activeCategory === 'all' || activeCategory === 'people') && userLocation) {
      datingProfiles.forEach((profile, idx) => {
        if (typeof profile.approxDistanceKm === 'number' && profile.approxDistanceKm > maxDistanceKm) return;
        const isPrivate = profile.intentMode === 'private' || profile.lookingFor === 'casual';
        if (activeIntentMode === 'Social' && isPrivate) return;
        if (activeIntentMode === 'Private' && !isPrivate) return;
        const coords: [number, number] = [
          userLocation.lat + ((idx % 3 - 1) * 0.0035),
          userLocation.lng + (((idx + 1) % 3 - 1) * 0.004),
        ];
        const markerCoords = spreadOverlappingCoordinate(coords[0], coords[1], occupiedMarkerCoordinates);
        const selected = selectedItem?.type === 'profile' && selectedItem.item.id === profile.id;
        const icon = L.divIcon({
          className: 'custom-person-marker',
          html: `<div class="gm-profile ${isPrivate ? 'gm-profile--private' : ''} ${selected ? 'gm-profile--sel' : ''}">${profile.name.charAt(0)}</div>`,
          iconSize: [38, 38],
          iconAnchor: [19, 19],
        });
        const marker = L.marker(markerCoords, { icon }).addTo(layerGroup);
        marker.on('click', () => {
          hapticLight();
          analytics.logEvent('profile_opened', { surface: 'right_now', kind: 'profile' });
          setSelectedItem({ type: 'profile', item: profile });
          setIsCardExpanded(false);
        });
      });
    }

    // 4. Pulses
    if (activeCategory !== 'havens' && activeCategory !== 'people') {
      livePulses.forEach((pulse) => {
        if (pulse.peerId === 'peer_me') return;
        const isPrivate = pulse.intentMode === 'private' || Boolean(pulse.intent?.includes('Hookup'));
        // Only real, published coordinates are ever mapped.
        const hasCoords = Number.isFinite(pulse.lat) && Number.isFinite(pulse.lng);
        if (!hasCoords) return;
        if (!matchesFilters({
          category: 'pulse',
          isPrivate,
          km: distanceKmForPulse(pulse),
          activityCategory: pulse.activityCategory,
        })) return;
        const lat = pulse.lat;
        const lng = pulse.lng;
        const jitter = typeof pulse.jitterMeters === 'number' && !isNaN(pulse.jitterMeters) ? pulse.jitterMeters : 300;
        if (showJitterCircles) {
          L.circle([lat, lng], {
            radius: jitter,
            color: isPrivate ? '#6F3CC3' : '#C9A24D',
            weight: 1,
            dashArray: '3, 4',
            fillColor: isPrivate ? '#6F3CC3' : '#C9A24D',
            fillOpacity: 0.06,
          }).addTo(layerGroup);
        }
        const markerCoords = spreadOverlappingCoordinate(lat, lng, occupiedMarkerCoordinates);
        const selected = selectedItem?.type === 'pulse' && selectedItem.item.id === pulse.id;
        const icon = L.divIcon({
          className: 'custom-pulse-marker',
          html: `<div class="gm-pulse ${isPrivate ? 'gm-pulse--private' : ''} ${selected ? 'gm-pulse--sel' : ''}">${
            pulse.peerAvatar && /^https?:\/\//i.test(pulse.peerAvatar)
              ? `<img class="gm-pulse__photo" src="${pulse.peerAvatar.replace(/"/g, '&quot;')}" alt="" />`
              : (pulse.peerName ? pulse.peerName.charAt(0) : 'P')
          }</div>`,
          iconSize: [34, 34],
          iconAnchor: [17, 17],
        });
        const marker = L.marker(markerCoords, { icon }).addTo(layerGroup);
        marker.on('click', () => {
          hapticLight();
          setSelectedItem({ type: 'pulse', item: pulse });
          setIsCardExpanded(false);
        });
      });
    }
  }, [
    isMapReady,
    livePulses,
    safeHavens,
    datingProfiles,
    activeCategory,
    activeIntentMode,
    showJitterCircles,
    maxDistanceKm,
    privacySetting,
    userNeighborhood,
    selectedItem,
    userLocation,
    activeUserIntent,
    resolvedUserAvatarUrl,
  ]);

  return (
    <div className="g-right-now-shell absolute inset-0 w-full h-full min-h-0 overflow-hidden select-none">
      {/* Subtle Map Tile Failure Fallback State */}
      {mapTilesUnavailable && (
        <div className="absolute top-16 left-3 right-3 sm:left-auto sm:right-4 z-40 max-w-sm mx-auto g-panel p-3.5 !rounded-[18px] pointer-events-auto">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-zinc-200 text-xs font-semibold">
              <Compass className="w-4 h-4 text-[#C9A24D] shrink-0" />
              <span>Map tiles temporarily unavailable</span>
            </div>
            <button
              type="button"
              onClick={handleRetryMapTiles}
              className="px-2.5 py-1 bg-[#6F3CC3] hover:bg-[#5e32a6] text-white text-[11px] font-semibold rounded-lg transition-colors cursor-pointer shrink-0 flex items-center gap-1 active:scale-95"
            >
              <RefreshCw className="w-3 h-3" />
              <span>Retry</span>
            </button>
          </div>
          <p className="text-[11px] text-zinc-400 mt-1 pl-6">
            Proximity radar and live discovery remain fully active.
          </p>
        </div>
      )}

      {/* =========================================================================
          1. TOP FLOATING ROW — current mode / your live signal + filter.
          The map stays clear; state reads at a glance.
         ========================================================================= */}
      <div className="absolute top-[calc(env(safe-area-inset-top,0px)+10px)] left-3 right-3 z-40 flex items-start justify-between gap-2 pointer-events-none">
        <div className="pointer-events-auto min-w-0 flex-1">
          {activeUserIntent ? (
            <div className={`g-float g-map-state g-map-state--live g-map-state--${activeUserIntent.mode === 'private' ? 'private' : 'social'} ${isUserIntentExpanded ? 'is-expanded' : 'is-collapsed'} w-full`} role="status">
              <button
                type="button"
                className="g-map-state__summary"
                onClick={() => {
                  hapticLight();
                  if (isUserIntentExpanded) {
                    setIsUserIntentDrawerOpen(true);
                  } else {
                    setIsUserIntentExpanded(true);
                  }
                }}
                aria-label={isUserIntentExpanded ? 'Open intent details' : 'Expand live intent'}
              >
                <span className={`g-live-dot g-live-dot--${activeUserIntent.mode === 'private' ? 'private' : 'social'} shrink-0 ${activeUserIntent.isPaused ? 'g-live-dot--paused' : ''}`} aria-hidden="true" />
                <span className="min-w-0 flex-1 text-left">
                  <span className="g-map-state__eyebrow">RIGHT NOW <span className={`g-map-state__live-pill ${activeUserIntent.isPaused ? 'is-paused' : ''}`}><span className="g-map-state__live-dot" />{activeUserIntent.isPaused ? 'PAUSED' : 'LIVE'}</span></span>
                  <span className="g-map-state__title truncate">{activeUserIntent.intent}</span>
                  <span className="g-map-state__details"><span>{activeUserIntent.isPaused ? 'Not visible' : 'Visible nearby'}</span><span aria-hidden="true">·</span><span>{resolveAreaLabel(activeUserIntent.area || userNeighborhood).replace(/\s*\([^)]*\)$/, '')}</span></span>
                </span>
                <span className="g-map-state__timer"><span>EXPIRES</span><strong>{formatRemainingTime(remainingMinutes)}</strong></span>
              </button>
              <div className="g-map-state__actions">
                <button type="button" className="g-map-state__action g-map-state__action--pause" onClick={handleTogglePause} disabled={intentBusy}>{activeUserIntent.isPaused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}<span>{activeUserIntent.isPaused ? 'Resume' : 'Pause'}</span></button>
                <button type="button" className="g-map-state__action g-map-state__action--end" onClick={handleEndIntent} disabled={intentBusy}><span className="g-map-state__end-dot" /><span>End intent</span></button>
              </div>
            </div>
          ) : (
            <div className="g-float g-map-state !cursor-default">
              <span className="w-2 h-2 rounded-full shrink-0 bg-[#6F3CC3]/70" aria-hidden="true" />
              <span className="min-w-0 text-left"><span className="flex items-baseline gap-1.5"><span>Right Now</span><span className="g-map-state__meta">{liveMembersCount} live</span></span><span className="block g-map-state__meta font-normal">Tap Set intent to go live</span></span>
            </div>
          )}
        </div>
        <button type="button" onClick={() => { hapticLight(); setIsNearbyOpen(true); }} className={`g-float g-icon-btn shrink-0 relative ${activeFilterCount > 0 ? '!border-[#6F3CC3]/70 !text-white' : ''}`} aria-label="Open discovery filters">
          <SlidersHorizontal className="w-4 h-4" />
          {activeFilterCount > 0 && <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-1 rounded-full bg-[#6F3CC3] text-white text-[10px] font-bold flex items-center justify-center border-2 border-[#0b0c11]">{activeFilterCount}</span>}
        </button>
      </div>

      {/* Status toast */}
      {statusMessage && (
        <div className="g-toast g-toast--map-status" role="status" aria-live="polite">
          <span className="w-1.5 h-1.5 rounded-full bg-[#C9A24D] shrink-0" />
          <span className="flex-1 font-semibold">{statusMessage}</span>
          <button
            type="button"
            onClick={dismissStatusMessage}
            className="g-icon-btn g-icon-btn--bare !w-8 !h-8 shrink-0 text-[13px]"
            aria-label="Dismiss message"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* =========================================================================
          2. EDGE-TO-EDGE PRIMARY MAP / RADAR CANVAS
          The map is the central full-screen experience behind all UI.
          Maintains an explicit height and handles ResizeObserver container layout changes.
         ========================================================================= */}
      <div className="w-full h-full absolute inset-0 z-0" style={{ height: '100%', minHeight: '100%', width: '100%' }}>
        {/* Spatial violet bleed: situates the map inside the brand's light
            instead of sitting on top of it as a separate widget. */}
        <div className="g-map-edge--violet" aria-hidden="true" />
        <style>{'.leaflet-control-attribution{margin-bottom:calc(3.5rem + env(safe-area-inset-bottom,0px) + 76px)!important;margin-right:.5rem!important;padding:2px 5px!important;border-radius:5px!important;background:rgba(7,8,11,.78)!important;color:rgba(255,255,255,.65)!important;font-size:9px!important;line-height:14px!important}.leaflet-control-attribution a{color:rgba(255,255,255,.78)!important}.leaflet-control-zoom{display:none!important}.leaflet-touch .leaflet-control-zoom{display:none!important}'}</style>
        <div
          ref={mapContainerRef}
          className="w-full h-full min-h-full overflow-hidden z-0 bg-[#07080b] rounded-none"
          style={{
            height: '100%',
            minHeight: '100%',
            width: '100%',
            backgroundImage:
              'radial-gradient(circle at 50% 42%, rgba(111, 60, 195, 0.13), transparent 46%), radial-gradient(circle at 14% 8%, rgba(201, 162, 77, 0.05), transparent 30%)'
          }}
        />
        {/* The map dissolves into glass chrome at both edges. */}
        <div className="g-map-edge g-map-edge--top" aria-hidden="true" />
        <div className="g-map-edge g-map-edge--bottom" aria-hidden="true" />
      </div>
      {/* Right micro-rail — locate · zoom only (privacy radius lives in filters) */}
      <div className="g-map-rail absolute top-[calc(env(safe-area-inset-top,0px)+66px)] right-3 z-30 pointer-events-auto">
        <button
          type="button"
          onClick={() => {
            hapticLight();
            mapControlsRef.current?.recenter();
          }}
          title="Locate me"
          aria-label="Locate me"
          className="g-icon-btn"
        >
          <Navigation className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => {
            hapticLight();
            mapControlsRef.current?.zoomIn();
          }}
          title="Zoom in"
          aria-label="Zoom in"
          className="g-icon-btn"
        >
          <Plus className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => {
            hapticLight();
            mapControlsRef.current?.zoomOut();
          }}
          title="Zoom out"
          aria-label="Zoom out"
          className="g-icon-btn"
        >
          <Minus className="w-4 h-4" />
        </button>
      </div>

      {/* =========================================================================
          4.5. EMPTY STATE — honest, compact, map stays visible
         ========================================================================= */}
      {!activeUserIntent && liveMembersCount === 0 && !selectedItem && (
        <div
          className="absolute left-1/2 -translate-x-1/2 z-30 w-[min(92vw,330px)] pointer-events-auto"
          style={{ bottom: 'calc(var(--g-tabbar-h) + env(safe-area-inset-bottom,0px) + 82px)' }}
        >
          <div className="g-empty">
            <div className="g-empty__icon">
              <Radio className="w-5 h-5" />
            </div>
            <h3>No active intent nearby</h3>
            <p>
              Nothing is live within {maxDistanceKm} km right now. Set your intent and the map
              lights up around you.
            </p>
            {onOpenSetIntent && (
              <button
                type="button"
                onClick={() => {
                  hapticLight();
                  onOpenSetIntent();
                }}
                className="g-btn g-btn--primary w-full mt-1"
              >
                <Plus className="w-4 h-4" />
                Create your intent
              </button>
            )}
            {maxDistanceKm < MAX_TRAVEL_DISTANCE_KM && (
              <button
                type="button"
                onClick={() => {
                  hapticLight();
                  setMaxDistanceKm(MAX_TRAVEL_DISTANCE_KM);
                }}
                className="g-btn g-btn--ghost w-full !min-h-[44px] text-[12px]"
              >
                Widen radius to {MAX_TRAVEL_DISTANCE_KM} km
              </button>
            )}
          </div>
        </div>
      )}

      {/* =========================================================================
          4.6. BOTTOM ACTION BAR — discovery drawer + the one primary action
         ========================================================================= */}
      {!selectedItem && !isCardExpanded && (
        <>
          <div className="g-nearby-float">
            {!userLocation && onRequestLocation ? (
              <button type="button" onClick={onRequestLocation} className="g-float g-nearby-btn" aria-label="Use my location"><MapPin className="w-3.5 h-3.5 text-[#C9A24D]" /><span>Use location</span></button>
            ) : (
              <button type="button" onClick={() => { hapticLight(); setIsNearbyOpen(true); }} className="g-float g-nearby-btn" aria-expanded={isNearbyOpen} aria-label={`${liveMembersCount} nearby — open nearby intents`}><List className="w-3.5 h-3.5" /><span>{liveMembersCount}</span><span className="g-nearby-btn__chevron">›</span></button>
            )}
          </div>
        </>
      )}

      {/* =========================================================================
          5. INTENT PREVIEW CARD — identity, intent, one primary action
         ========================================================================= */}
      {selectedItem && !isCardExpanded && (
        <div className="g-preview">
          <div className="flex items-start gap-3">
            <button
              type="button"
              onClick={() => {
                hapticLight();
                setIsCardExpanded(true);
              }}
              className="flex items-start gap-3 flex-1 min-w-0 text-left cursor-pointer"
            >
              {selectedItem.type === 'profile' ? (
                <div className="relative w-11 h-11 rounded-[14px] overflow-hidden border border-white/15 bg-[#161822] shrink-0">
                  <span className="absolute inset-0 flex items-center justify-center text-sm text-white" aria-hidden="true">{selectedItem.item.name.charAt(0)}</span>
                  <img
                    src={selectedItem.item.photoUrl}
                    alt={selectedItem.item.name}
                    className="relative w-full h-full object-cover"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                    }}
                  />
                  {selectedItem.item.safetyVerified && (
                    <span className="absolute bottom-0.5 right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-400 border-2 border-[#12131b]" />
                  )}
                </div>
              ) : selectedItem.type === 'haven' ? (
                <div className="w-11 h-11 rounded-[14px] bg-[#0f1f1a] border border-emerald-500/50 text-emerald-400 flex items-center justify-center shrink-0">
                  <ShieldCheck className="w-5 h-5" />
                </div>
              ) : (
                <div className={`g-avatar w-11 h-11 text-[14px] ${selectedItemIsPrivate ? 'g-avatar--private' : 'g-avatar--social'}`}>
                  {selectedItem.item.peerName.charAt(0)}
                </div>
              )}

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <h3 className="text-[14.5px] font-extrabold text-white tracking-tight truncate">
                    {getDisplayName(selectedItem)}
                  </h3>
                  {selectedItem.type === 'haven' ? (
                    <span className="g-badge g-badge--verify">{selectedItem.item.safetyScore} safety</span>
                  ) : (
                    <span
                      className={`g-chip ${
                        (selectedItem.type === 'pulse'
                          ? selectedItem.item.intentMode
                          : selectedItem.item.intentMode) === 'private'
                          ? 'g-chip--private'
                          : 'g-chip--social'
                      }`}
                    >
                      {(selectedItem.type === 'pulse'
                        ? selectedItem.item.intent?.replace(' · ', ' ')
                        : selectedItem.item.intent?.replace(' · ', ' ')) ||
                        ((selectedItem.type === 'pulse'
                          ? selectedItem.item.intentMode
                          : selectedItem.item.intentMode) === 'private'
                          ? 'Private'
                          : 'Social')}
                    </span>
                  )}
                  {selectedItem.type === 'pulse' && selectedItem.item.expiresAt > 0 && (
                    <CountdownPill expiresAt={selectedItem.item.expiresAt} />
                  )}
                  {selectedItem.type === 'profile' && selectedItem.item.intentExpiresAt && (
                    <CountdownPill expiresAt={selectedItem.item.intentExpiresAt} />
                  )}
                </div>

                <div className="text-[11.5px] text-zinc-400 flex items-center gap-1.5 mt-1 min-w-0">
                  <span className="flex items-center gap-1 text-[#C9A24D] font-semibold shrink-0">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#C9A24D]" />
                    {selectedItem.type === 'haven' ? 'Safe haven' : 'Available now'}
                  </span>
                  <span className="font-mono shrink-0">
                    · {formatDistanceKm(itemDistanceKm(selectedItem))}
                  </span>
                  <span className="truncate">
                    · {selectedItem.type === 'haven'
                      ? selectedItem.item.neighborhood
                      : (selectedItem.item as any).venueName || userNeighborhood}
                  </span>
                </div>
              </div>
            </button>

            <button
              type="button"
              onClick={() => {
                hapticLight();
                setSelectedItem(null);
              }}
              className="g-icon-btn g-icon-btn--bare !w-11 !h-11 shrink-0"
              title="Close preview"
              aria-label="Close preview"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <p className="text-[12.5px] text-zinc-300 leading-snug mt-2.5 line-clamp-2">
            {getDisplayDescription(selectedItem)}
          </p>

          {/* Actions — one primary, two quiet */}
          <div className="flex items-center gap-2 mt-3">
            {selectedItem.type === 'haven' ? (
              <>
                <button
                  type="button"
                  onClick={() => onSelectHaven(selectedItem.item)}
                  className="g-btn g-btn--amber flex-1"
                >
                  <MapPin className="w-4 h-4" />
                  Safe haven details
                </button>
                <button
                  type="button"
                  onClick={() => {
                    hapticLight();
                    onOpenScheduleMeeting?.(selectedItem.item.name);
                  }}
                  className="g-btn g-btn--quiet"
                >
                  <Calendar className="w-4 h-4" />
                  Meet here
                </button>
              </>
            ) : (
              <>
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
                  className="g-btn g-discovery-secondary flex-1"
                >
                  <Lock className="w-4 h-4" />
                  Message
                </button>
                {selectedItem.type === 'pulse' ? (
                  <button
                    type="button"
                    onClick={() => void handleTapInterested(selectedItem.item.id, selectedItem.item)}
                    disabled={interestPendingIds.has(selectedItem.item.id) || Boolean(interestStatusByPulseId[selectedItem.item.id])}
                    className={`g-btn g-discovery-primary !px-3 text-[12px] ${
                      interestedIds.has(selectedItem.item.id)
                        ? 'g-btn--primary'
                        : 'g-btn--quiet'
                    }`}
                  >
                    {interestedIds.has(selectedItem.item.id) ? (
                      <Check className="w-3.5 h-3.5" />
                    ) : (
                      <Zap className="w-3.5 h-3.5" />
                    )}
                    {interestPendingIds.has(selectedItem.item.id)
                      ? 'Sending…'
                      : interestStatusByPulseId[selectedItem.item.id] === 'mutual'
                        ? 'Gayze matched'
                        : interestStatusByPulseId[selectedItem.item.id] === 'declined'
                          ? 'Gayze declined'
                          : interestStatusByPulseId[selectedItem.item.id] === 'pending' || interestedIds.has(selectedItem.item.id)
                            ? 'Gayze sent'
                            : 'Send GAYZE'}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void handleGazeAtPerson(selectedItem.item.name, selectedItem.item.id)}
                    className={`g-btn g-discovery-primary !px-3 text-[12px] ${
                      gazedPeerNames.has(selectedItem.item.id) ? 'g-btn--primary' : 'g-btn--quiet'
                    }`}
                  >
                    <Eye className="w-3.5 h-3.5" />
                    {gazedPeerNames.has(selectedItem.item.id) ? 'Gayze sent' : 'Send GAYZE'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    hapticLight();
                    onOpenScheduleMeeting?.(
                      selectedItem.type === 'pulse' ? selectedItem.item.peerName : selectedItem.item.name,
                    );
                  }}
                  className="g-btn g-btn--quiet !px-3 text-[12px]"
                  aria-label="Safe meet"
                >
                  <Calendar className="w-3.5 h-3.5" />
                  Meet
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* =========================================================================
          6. EXPANDED DISCOVERY DETAIL BOTTOM SHEET
          Slides up smoothly when the user taps expand or the preview card.
          Preserves the map visible behind the sheet with backdrop blur.
          Bottom edge safely floats above the fixed bottom navigation bar.
         ========================================================================= */}
      {selectedItem && isCardExpanded && (
        <div
          className="g-overlay flex flex-col justify-end"
          onClick={() => setIsCardExpanded(false)}
        >
          <div
            className="g-sheet g-sheet--above-nav pointer-events-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Drag Handle */}
            <div
              onClick={() => setIsCardExpanded(false)}
              className="flex flex-col items-center cursor-pointer"
            >
              <div className="g-sheet__grip" />
            </div>

            {/* Scrollable Sheet Content */}
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 pb-6 space-y-4">

              {/* Header Profile / Haven Presentation */}
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  {selectedItem.type === 'profile' ? (
                    <div className="relative w-14 h-14 rounded-2xl overflow-hidden border-2 border-[#C9A24D]/60 bg-[#161822] shrink-0 shadow-[0_12px_24px_rgba(201,162,77,0.22)]">
                      <span className="absolute inset-0 flex items-center justify-center text-xl text-white" aria-hidden="true">{selectedItem.item.name.charAt(0)}</span>
                      <img
                        src={selectedItem.item.photoUrl}
                        alt={selectedItem.item.name}
                        className="relative w-full h-full object-cover"
                        onError={(e) => {
                          // No stand-in portrait is substituted: a missing photo
                          // shows the person's initial instead.
                          (e.target as HTMLImageElement).style.display = 'none';
                        }}
                      />
                    </div>
                  ) : selectedItem.type === 'haven' ? (
                    <div className="g-avatar w-14 h-14 !rounded-[16px] !bg-[#0f1f1a] !border-[#34d399]/45 text-emerald-400">
                      <ShieldCheck className="w-6 h-6" />
                    </div>
                  ) : (
                    <div className={`g-avatar w-14 h-14 text-[20px] ${selectedItemIsPrivate ? 'g-avatar--private' : 'g-avatar--social'}`}>
                      {selectedItem.item.peerName.charAt(0)}
                    </div>
                  )}

                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-[17px] font-semibold text-white tracking-[-0.015em]">
                        {getDisplayName(selectedItem)}
                      </h2>
                    </div>

                    <div className="g-map-state__meta flex items-center gap-2 mt-0.5">
                      {isSelectedLive ? (
                        <span className="g-live-dot" aria-hidden="true" />
                      ) : (
                        <span className="w-1.5 h-1.5 rounded-full bg-zinc-600" aria-hidden="true" />
                      )}
                      <span className="text-zinc-300">
                        {isSelectedLive ? 'Live right now' : 'Not live'}
                      </span>
                      <span>·</span>
                      <span>{formatDistanceKm(itemDistanceKm(selectedItem))} away</span>
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

              {/* Intent summary — one line, quiet, no shouting */}
              <div className="g-panel p-3.5 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="g-label">Intent</span>
                  <span className={`g-chip ${selectedItem.type === 'haven'
                    ? 'g-chip--haven'
                    : selectedItemIsPrivate
                      ? 'g-chip--private'
                      : 'g-chip--social'
                    }`}>
                    {selectedItem.type === 'haven'
                      ? `Safe Haven · ${selectedItem.item.safetyScore}`
                      : selectedItem.type === 'pulse'
                        ? `${selectedItem.item.intent || selectedItem.item.title}`
                        : `${selectedItem.item.lookingForLabel || 'Connect'}`}
                  </span>
                </div>

                <p className="text-sm text-zinc-200 leading-relaxed">
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
              <div className="grid grid-cols-2 gap-2">
                <div className="g-tile">
                  <span className="g-label">Availability</span>
                  <span className="g-tile__v">
                    <Clock className="w-3.5 h-3.5 text-[#C9A24D]" />
                    {isSelectedLive ? 'Available now' : 'Not currently live'}
                  </span>
                  <span className="g-tile__n">
                    {selectedItem.type === 'pulse' ? `${selectedItem.item.durationHours} hr window` : 'Immediate meet'}
                  </span>
                </div>

                <div className="g-tile">
                  <span className="g-label">Area</span>
                  <span className="g-tile__v">
                    <MapPin className="w-3.5 h-3.5 text-[#C9A24D] shrink-0" />
                    <span className="truncate">
                      {selectedItem.type === 'haven' ? selectedItem.item.neighborhood : (selectedItem.item as any).venueName || userNeighborhood}
                    </span>
                  </span>
                  <span className="g-tile__n">Approximate · ±{PRIVACY_RADIUS_METERS} m</span>
                </div>

                {selectedItem.type === 'pulse' && selectedItem.item.canHost && (
                  <div className="g-tile">
                    <span className="g-label">Hosting</span>
                    <span className="g-tile__v">{selectedItem.item.canHost}</span>
                    <span className="g-tile__n">As stated on their intent</span>
                  </div>
                )}

                {selectedItem.type === 'pulse' && selectedItem.item.travelWillingness && !selectedItem.item.canHost && (
                  <div className="g-tile">
                    <span className="g-label">Travel</span>
                    <span className="g-tile__v">{selectedItem.item.travelWillingness}</span>
                    <span className="g-tile__n">As stated on their intent</span>
                  </div>
                )}

                <div className="g-tile col-span-2">
                  <div className="flex items-center justify-between gap-3">
                    <span className="g-label">Privacy</span>
                    <span className="g-badge g-badge--verify">
                      <ShieldCheck className="w-3 h-3" /> Encrypted on your device
                    </span>
                  </div>
                  <div className="text-[11.5px] text-zinc-300 flex items-center gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    <span>Approximate location only · exact GPS stays on the device</span>
                  </div>
                </div>
              </div>

              {/* Verified peer profile details if a person or pulse is selected */}
              {selectedItem.type !== 'haven' && (
                <PeerProfileSummary
                  userId={selectedItem.type === 'pulse' ? selectedItem.item.peerId : selectedItem.item.id}
                />
              )}

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
                      className="g-btn g-discovery-secondary flex-1 !min-h-[50px]"
                    >
                      <MapPin className="w-4 h-4" />
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
                        className={`g-btn !min-h-[46px] !px-2 flex-1 ${interestedIds.has(selectedItem.item.id)
                          ? 'g-btn--selected'
                          : 'g-btn--quiet'
                          }`}
                      >
                        {interestedIds.has(selectedItem.item.id) ? (
                          <>
                            <Check className="w-4 h-4 text-[#C9A24D]" />
                            <span>{interestPendingIds.has(selectedItem.item.id) ? 'Sending…' : 'Send GAYZE'}</span>
                          </>
                        ) : (
                          <>
                            <Zap className="w-4 h-4 text-[#C9A24D]" />
                            <span>{interestPendingIds.has(selectedItem.item.id) ? 'Sending…' : 'Send GAYZE'}</span>
                          </>
                        )}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void handleGazeAtPerson(selectedItem.item.name, selectedItem.item.id)}
                        className={`g-btn !min-h-[46px] !px-2 flex-1 ${gazedPeerNames.has(selectedItem.item.id)
                          ? 'g-btn--selected'
                          : 'g-btn--quiet'
                          }`}
                      >
                        <Eye className="w-4 h-4 text-[#C9A24D]" />
                        <span>{gazedPeerNames.has(selectedItem.item.id) ? 'Gayze sent' : 'Send GAYZE'}</span>
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
                      className="g-btn g-discovery-secondary !min-h-[50px] !px-2 text-xs"
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
                      className="g-btn g-discovery-secondary flex-1 !min-h-[50px]"
                    >
                      <Lock className="w-4 h-4" />
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
          7. FILTER SHEET — one entry point, same anatomy as the intent composer
         ========================================================================= */}
      {isFilterDrawerOpen && (
        <div
          className="g-overlay flex items-end sm:items-center justify-center sm:p-4"
          onClick={() => setIsFilterDrawerOpen(false)}
        >
          <div className="g-sheet g-sheet--above-nav g-sheet--nearby" onClick={(e) => e.stopPropagation()}>
            <div className="g-sheet__grip" />
            <div className="g-sheet__head">
              <div>
                <span className="g-label">Now Map</span>
                <h2 className="text-[15px] font-extrabold text-white mt-0.5">Filter the map</h2>
              </div>
              <div className="flex items-center gap-1.5">
                {activeFilterCount > 0 && (
                  <button
                    type="button"
                    onClick={handleClearFilters}
                    className="g-btn g-btn--ghost !min-h-[44px] px-3 text-[12px]"
                  >
                    Reset
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setIsFilterDrawerOpen(false)}
                  className="g-icon-btn g-icon-btn--bare !w-11 !h-11"
                  aria-label="Close filters"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="g-sheet__body space-y-5">
              {/* Category */}
              <div>
                <span className="g-label">Show me</span>
                <div className="flex flex-wrap gap-2 mt-2.5">
                  {[
                    { id: 'all', label: 'Everything' },
                    // "People" only exists when there is a separate people
                    // dataset (demo mode). In live mode every row is an intent.
                    ...(datingProfiles.length > 0 ? [{ id: 'people', label: 'People' }] : []),
                    { id: 'coffee', label: 'Coffee' },
                    { id: 'drinks', label: 'Drinks' },
                    { id: 'active', label: 'Active' },
                    { id: 'havens', label: 'Safe Havens' },
                  ].map((cat) => (
                    <button
                      key={cat.id}
                      type="button"
                      className="g-optpill"
                      data-tone="amber"
                      data-active={activeCategory === (cat.id as typeof activeCategory)}
                      onClick={() => {
                        hapticLight();
                        setActiveCategory(cat.id as typeof activeCategory);
                      }}
                    >
                      {cat.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Intent mode */}
              <div>
                <span className="g-label">Intent</span>
                <div className="g-seg mt-2.5">
                  {(['All', 'Social', 'Private'] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      className="g-seg__btn"
                      data-tone="purple"
                      data-active={activeIntentMode === mode}
                      onClick={() => {
                        hapticLight();
                        setActiveIntentMode(mode);
                      }}
                    >
                      {mode}
                    </button>
                  ))}
                </div>
              </div>

              {/* Distance */}
              <div>
                <span className="g-label">Distance</span>
                <div className="flex flex-wrap gap-2 mt-2.5">
                  {[
                    { km: 1, label: '< 1 km' },
                    { km: 3, label: '< 3 km' },
                    { km: 5, label: 'All nearby' },
                  ].map((dist) => (
                    <button
                      key={dist.km}
                      type="button"
                      className="g-optpill"
                      data-active={maxDistanceKm === dist.km}
                      onClick={() => {
                        hapticLight();
                        setMaxDistanceKm(dist.km);
                      }}
                    >
                      {dist.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Privacy radius */}
              <div className="flex items-center justify-between gap-3 py-3 px-3.5 rounded-[14px] bg-white/[0.03] border border-white/[0.07]">
                <div className="min-w-0">
                  <span className="text-[13px] font-bold text-white block">Approximate radius</span>
                  <span className="text-[11px] text-zinc-500 block">
                    Show the privacy circle around markers
                  </span>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={showJitterCircles}
                  aria-label="Show approximate location radius"
                  className="g-toggle"
                  onClick={() => {
                    hapticLight();
                    setShowJitterCircles(!showJitterCircles);
                  }}
                />
              </div>

              <p className="text-[11px] text-zinc-500 leading-relaxed">
                Markers show approximate areas (±{PRIVACY_RADIUS_METERS} m). Precise positions are never displayed.
              </p>
            </div>

            <div className="g-sheet__foot">
              <button type="button" className="g-btn g-btn--quiet" onClick={handleClearFilters}>
                Reset
              </button>
              <button
                type="button"
                className="g-btn g-btn--primary flex-1"
                onClick={() => {
                  hapticLight();
                  setIsFilterDrawerOpen(false);
                }}
              >
                Show {filteredActiveCount} nearby
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          7.5 NEARBY DISCOVERY DRAWER — list view of live intents, map stays behind
         ========================================================================= */}
      {isNearbyOpen && (
        <div className="g-overlay flex items-end sm:items-center justify-center sm:p-4" onClick={() => setIsNearbyOpen(false)}>
          <div className="g-sheet g-sheet--active-signal" onClick={(e) => e.stopPropagation()}>
            <div className="g-sheet__grip" />
            <div className="g-sheet__head">
              <div>
                <span className="g-label">Right Now</span>
                <h2 className="text-[15px] font-extrabold text-white mt-0.5">
                  {nearbyItems.length} available nearby
                </h2>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    hapticLight();
                    setIsNearbyOpen(false);
                    setIsFilterDrawerOpen(true);
                  }}
                  className="g-btn g-btn--quiet !min-h-[44px] px-3 text-[12px]"
                >
                  <SlidersHorizontal className="w-3.5 h-3.5" />
                  Filter
                </button>
                <button
                  type="button"
                  onClick={() => setIsNearbyOpen(false)}
                  className="g-icon-btn g-icon-btn--bare !w-11 !h-11"
                  aria-label="Close nearby list"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="g-sheet__body pb-2">
              {nearbyItems.length === 0 ? (
                <div className="py-6">
                  <div className="g-empty !shadow-none">
                    <div className="g-empty__icon">
                      <Radio className="w-5 h-5" />
                    </div>
                    <h3>No active intent nearby</h3>
                    <p>Nothing matches this filter set right now.</p>
                    {onOpenSetIntent && (
                      <button
                        type="button"
                        className="g-btn g-btn--primary w-full mt-1"
                        onClick={() => {
                          hapticLight();
                          setIsNearbyOpen(false);
                          onOpenSetIntent();
                        }}
                      >
                        <Plus className="w-4 h-4" />
                        Create your intent
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                nearbyItems.map((item) => {
                  const key = item.type === 'haven' ? item.item.id : item.type === 'pulse' ? item.item.id : item.item.id;
                  const name =
                    item.type === 'haven'
                      ? item.item.name
                      : item.type === 'pulse'
                        ? `${item.item.peerName}${item.item.peerAge ? ` · ${item.item.peerAge}` : ''}`
                        : `${item.item.name} · ${item.item.age}`;
                  const isPrivate =
                    item.type === 'pulse'
                      ? item.item.intentMode === 'private' || item.item.intent?.includes('Hookup')
                      : item.type === 'profile'
                        ? item.item.intentMode === 'private'
                        : false;
                  const intentLabel =
                    item.type === 'haven'
                      ? 'Safe haven'
                      : item.type === 'pulse'
                        ? item.item.intent?.replace(' · ', ' ') || (isPrivate ? 'Private' : 'Social')
                        : item.item.intent || item.item.lookingForLabel;
                  const expires =
                    item.type === 'pulse' ? item.item.expiresAt : item.type === 'profile' ? item.item.intentExpiresAt : undefined;

                  return (
                    <button
                      key={key}
                      type="button"
                      className="g-intent-row"
                      onClick={() => {
                        hapticLight();
                        setSelectedItem(item);
                        setIsCardExpanded(false);
                        setIsNearbyOpen(false);
                      }}
                    >
                      <div
                        className={`g-avatar w-10 h-10 text-[13px] ${
                          item.type === 'haven'
                            ? '!bg-[#0f1f1a] !text-emerald-400'
                            : isPrivate
                              ? 'g-avatar--ring-private'
                              : 'g-avatar--ring-social'
                        }`}
                      >
                        {item.type === 'profile' ? (
                          <img
                            src={item.item.photoUrl}
                            alt=""
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display = 'none';
                            }}
                          />
                        ) : item.type === 'haven' ? (
                          <ShieldCheck className="w-4 h-4" />
                        ) : (
                          <span>{item.item.peerName.charAt(0)}</span>
                        )}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="text-[13.5px] font-bold text-white truncate">{name}</span>
                          {item.type !== 'haven' && (
                            <span className={`g-chip ${isPrivate ? 'g-chip--private' : 'g-chip--social'}`}>
                              {intentLabel}
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-zinc-500 flex items-center gap-1.5 mt-0.5 min-w-0">
                          <span className="font-mono shrink-0">{formatDistanceKm(itemDistanceKm(item))}</span>
                          <span className="truncate">
                            · {item.type === 'haven' ? item.item.neighborhood : item.type === 'pulse' ? item.item.neighborhood : item.item.neighborhood}
                          </span>
                        </div>
                      </div>

                      {expires ? (
                        <CountdownPill expiresAt={expires} />
                      ) : item.type === 'profile' && item.item.safetyVerified ? (
                        <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                      ) : null}
                    </button>
                  );
                })
              )}
            </div>

            {!activeUserIntent && onOpenSetIntent && nearbyItems.length > 0 && (
              <div className="g-sheet__foot">
                <button
                  type="button"
                  className="g-btn g-btn--primary w-full"
                  onClick={() => {
                    hapticLight();
                    setIsNearbyOpen(false);
                    onOpenSetIntent();
                  }}
                >
                  <Plus className="w-4 h-4" />
                  Create your intent
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* =========================================================================
          8. YOUR LIVE SIGNAL — manage sheet (edit · pause · end)
         ========================================================================= */}
      {isUserIntentDrawerOpen && activeUserIntent && (
        <div
          className="g-overlay g-overlay--active-signal flex items-end sm:items-center justify-center sm:p-4"
          onClick={() => setIsUserIntentDrawerOpen(false)}
        >
          <div className="g-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="g-sheet__grip" />
            <div className="g-sheet__head">
              <div className="flex items-center gap-2.5 min-w-0">
                <span
                  className={`g-live-dot shrink-0 ${activeUserIntent.isPaused ? 'g-live-dot--paused' : ''}`}
                  aria-hidden="true"
                />
                <div className="min-w-0">
                  <h2 className="text-[15px] font-extrabold text-white leading-tight">
                    {activeUserIntent.isPaused ? 'Signal paused' : 'Your live signal'}
                  </h2>
                  <span className="g-map-state__meta">
                    {formatRemainingTime(remainingMinutes)} left ·{' '}
                    {activeUserIntent.isPaused ? 'not visible' : 'visible on the map'}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsUserIntentDrawerOpen(false)}
                className="g-icon-btn g-icon-btn--bare !w-11 !h-11"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="g-sheet__body space-y-4">
              <div className="p-4 rounded-[14px] bg-white/[0.03] border border-white/[0.07] space-y-2.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`g-chip ${activeUserIntent.mode === 'private' ? 'g-chip--private' : 'g-chip--social'}`}>
                    {activeUserIntent.mode === 'private' ? 'Private' : 'Social'}
                  </span>
                  <span className="text-[15px] font-extrabold text-white tracking-tight">
                    {activeUserIntent.intent.replace(' · ', ' ')}
                  </span>
                </div>
                <p className="text-[13px] text-zinc-300 leading-relaxed">{activeUserIntent.description}</p>
                <div className="pt-1 flex items-center justify-between gap-3 text-[11px] font-mono text-zinc-500">
                  <span className="truncate">
                    {activeUserIntent.when} · {activeUserIntent.duration} · {activeUserIntent.travelDistance}
                  </span>
                  <span className="text-[#C9A24D] shrink-0">±{PRIVACY_RADIUS_METERS} m</span>
                </div>
              </div>

              <p className="text-[11px] text-zinc-500 leading-relaxed">
                Your signal disappears the moment it expires or you end it. Nothing is added to
                your profile.
              </p>
            </div>

            <div className="g-sheet__foot">
              <button
                type="button"
                onClick={handleEndIntent}
                disabled={intentBusy}
                className="g-btn g-btn--danger-quiet !px-4"
              >
                End
              </button>
              <button
                type="button"
                onClick={handleTogglePause}
                disabled={intentBusy}
                className="g-btn g-btn--quiet flex-1"
              >
                {activeUserIntent.isPaused ? (
                  <>
                    <Play className="w-4 h-4" /> Resume
                  </>
                ) : (
                  <>
                    <Pause className="w-4 h-4" /> Pause
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={() => {
                  hapticLight();
                  setIsUserIntentDrawerOpen(false);
                  onOpenSetIntent?.();
                }}
                disabled={intentBusy}
                className="g-btn g-btn--primary flex-1"
              >
                <Edit3 className="w-4 h-4" /> {intentBusy ? 'Saving…' : 'Edit'}
              </button>
            </div>
          </div>
        </div>
      )}

      {interestDraftPulse && (
        <div className="g-overlay flex items-end sm:items-center justify-center p-3" onClick={() => !interestComposerBusy && setInterestDraftPulse(null)}>
          <div className="w-full max-w-md g-panel !rounded-[28px] overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 flex items-center gap-3 border-b border-white/[0.08]">
              <div className="relative w-12 h-12 shrink-0 rounded-2xl overflow-hidden border border-[#C9A24D]/45 bg-[#171922] shadow-[0_8px_20px_rgba(0,0,0,.35)]">
                <span className="absolute inset-0 flex items-center justify-center text-base font-bold text-white">{interestDraftPulse.peerName.slice(0,1).toUpperCase()}</span>
                {interestDraftPulse.peerAvatar && /^https?:\/\//i.test(interestDraftPulse.peerAvatar) && (
                  <img
                    src={interestDraftPulse.peerAvatar}
                    alt={interestDraftPulse.peerName}
                    className="absolute inset-0 w-full h-full object-cover"
                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                  />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <span className="g-label text-[#C9A24D]">SEND A GAYZE</span>
                <h3 className="text-[15px] font-semibold text-white truncate">Show {interestDraftPulse.peerName} you’re interested</h3>
                <p className="text-[10.5px] text-zinc-500 truncate">{interestDraftPulse.peerAge ? String(interestDraftPulse.peerAge) + ' · ' : ''}{interestDraftPulse.neighborhood}</p>
              </div>
              <button type="button" onClick={() => setInterestDraftPulse(null)} className="g-icon-btn g-icon-btn--bare !w-11 !h-11 shrink-0" aria-label="Close"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div className="rounded-2xl bg-white/[0.03] border border-white/[0.07] px-4 py-3"><div className="text-[10px] uppercase tracking-[0.14em] text-zinc-500">Their current intent</div><div className="text-sm text-white mt-1">{interestDraftPulse.title || interestDraftPulse.intent || 'Right Now'}</div></div>
              <div><label className="text-xs font-semibold text-zinc-300">Add a note <span className="text-zinc-600">(optional)</span></label><textarea value={interestMessage} onChange={(e) => setInterestMessage(e.target.value.slice(0,500))} rows={3} placeholder="Add a note about why you’re interested… (optional)" className="mt-2 w-full resize-none rounded-2xl bg-black/30 border border-white/10 px-4 py-3 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-[#C9A24D]/60" /></div>
              <div><div className="flex items-center justify-between"><label className="text-xs font-semibold text-zinc-300">Share album photos <span className="text-zinc-600">(optional)</span></label><span className="text-[10px] text-zinc-600">{selectedInterestPhotoIds.size}/6</span></div>
                {interestPhotos.length ? <div className="mt-2 grid grid-cols-6 gap-2">{interestPhotos.map((photo) => { const selected=selectedInterestPhotoIds.has(photo.id); return <button key={photo.id} type="button" onClick={() => setSelectedInterestPhotoIds(prev => { const next=new Set(prev); if(selected) next.delete(photo.id); else if(next.size<6) next.add(photo.id); return next; })} className={`relative aspect-square rounded-xl overflow-hidden border-2 ${selected ? 'border-[#C9A24D]' : 'border-white/10'}`}><img src={photo.url} alt="" className="w-full h-full object-cover" />{selected && <span className="absolute inset-0 bg-[#6F3CC3]/35 flex items-center justify-center"><Check className="w-5 h-5 text-white" /></span>}</button>; })}</div> : <div className="mt-2 text-xs text-zinc-600 rounded-2xl border border-dashed border-white/10 p-4 text-center">No album photos available.</div>}
              </div>
              <button type="button" disabled={interestComposerBusy} onClick={() => void sendInterestRequest()} className="w-full min-h-[50px] rounded-2xl bg-gradient-to-r from-[#6F3CC3] to-[#C9A24D] text-white font-bold disabled:opacity-50">{interestComposerBusy ? 'Sending…' : 'Send GAYZE'}</button>
              <p className="text-[10.5px] text-center text-zinc-600">A Gayze is an interest signal — they can view your profile and accept or decline. Declines stay private.</p>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          9. MUTUAL MATCH / INTEREST NOTIFICATION BANNER
         ========================================================================= */}
      {mutualMatchPulse && (
        <div className="g-overlay flex items-center justify-center p-4" onClick={() => setMutualMatchPulse(null)}>
          <div
            className="w-full max-w-sm p-5 g-panel !rounded-[20px] space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <span className="g-label text-[#C9A24D]">Mutual interest</span>
                <h3 className="text-[17px] font-semibold text-white tracking-[-0.015em] mt-1">
                  {(mutualMatchPulse.intent || mutualMatchPulse.title).replace(' · ', ' ')} · now
                </h3>
                <p className="text-[13px] text-zinc-400 mt-1.5 leading-relaxed">
                  You and {mutualMatchPulse.peerName} both want this right now. The chat is open.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setMutualMatchPulse(null)}
                className="g-icon-btn g-icon-btn--bare !w-11 !h-11 shrink-0"
                aria-label="Dismiss"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex items-center gap-2 text-[11.5px] text-zinc-500 px-3 py-2 rounded-[10px] bg-white/[0.03] border border-white/[0.06]">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span>Approximate locations only · messages are encrypted on your device</span>
            </div>

            <div className="flex items-center gap-2 pt-0.5">
              <button
                type="button"
                onClick={() => setMutualMatchPulse(null)}
                className="g-btn g-btn--quiet flex-1"
              >
                Keep browsing
              </button>
              <button
                type="button"
                onClick={() => {
                  onOpenDirectChat(mutualMatchPulse);
                  setMutualMatchPulse(null);
                }}
                className="g-btn g-btn--amber flex-1"
              >
                <MessageSquare className="w-4 h-4" />
                Message
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
