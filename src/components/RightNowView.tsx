import React, { useState, useMemo, useEffect, useRef } from 'react';
import L from 'leaflet';
import {
  Pulse,
  SafeHaven,
  LocationPrivacy,
  DatingProfile,
  SocialStory,
  UserActiveIntent,
} from '../types';

export type MapDiscoveryItem =
  | { type: 'haven'; item: SafeHaven }
  | { type: 'pulse'; item: Pulse }
  | { type: 'profile'; item: DatingProfile };

const fallbackMapCenter: [number, number] = [FALLBACK_MAP_CENTER.lat, FALLBACK_MAP_CENTER.lng];

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
  Maximize2,
  Edit3,
  Pause,
  Play,
  Share2,
  Compass,
  Sparkles,
  RefreshCw
} from 'lucide-react';
import { MAP_PROVIDERS, tileLayerOptions } from '../config/mapProviders';
import { FALLBACK_MAP_CENTER, FALLBACK_MAP_ZOOM, LOCATED_MAP_ZOOM, resolveAreaLabel } from '../config/mapDefaults';
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
  onSubmitInterest?: (pulse: Pulse) => Promise<{ sent: boolean; mutual: boolean; conversation_id: string | null }>;
  onSubmitGaze?: (pulse: Pulse) => Promise<{ sent: boolean }>;
  onSwitchToLater?: () => void;
  onRequestLocation?: () => void;
}

export const RightNowView: React.FC<RightNowViewProps> = ({
  pulses,
  safeHavens,
  userNeighborhood,
  privacySetting = 'fuzzy_500m',
  userLocation = null,
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
  onSubmitGaze,
  onSwitchToLater,
  onRequestLocation,
}) => {
  // 1. User's Personal Active Right Now Intent State
  const [localActiveUserIntent, setLocalActiveUserIntent] = useState<UserActiveIntent | null>(() => {
    try {
      const saved = localStorage.getItem('gayze_active_user_intent');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.expiresAt > Date.now()) return parsed;
      }
    } catch { }
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
  const [isMapReady, setIsMapReady] = useState<boolean>(false);
  const [mapTilesUnavailable, setMapTilesUnavailable] = useState<boolean>(false);
  const [currentProviderIndex, setCurrentProviderIndex] = useState<number>(0);

  useEffect(() => {
    userLocationRef.current = userLocation;
    if (userLocation && mapInstanceRef.current) {
      mapInstanceRef.current.setView([userLocation.lat, userLocation.lng], Math.max(mapInstanceRef.current.getZoom(), 14), { animate: true });
    }
  }, [userLocation]);

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

  const glowPulseBg = useMemo(() => ({
    background: 'radial-gradient(circle at 50% 20%, rgba(111, 60, 195, 0.18), transparent 36%), linear-gradient(180deg, rgba(14,16,23,0.96), rgba(8,9,14,0.98))',
  }), []);

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
    } catch { }

    const updateRemaining = () => {
      const diff = Math.max(0, Math.round((activeUserIntent.expiresAt - Date.now()) / (1000 * 60)));
      setRemainingMinutes(diff);
      if (diff <= 0) {
        setActiveUserIntent(null);
        localStorage.removeItem('gayze_active_user_intent');
        showStatusMessage('Your Right Now intent expired');
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
    } catch { }

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

    const durationNum = intentData.duration === '1 hr' ? 1 : 2;
    const jitterRadiusMeters = privacySetting === 'neighborhood' ? 800 : privacySetting === 'ghost' ? 0 : 500;
    const jitterBearing = Math.random() * Math.PI * 2;
    const jitterDistanceMeters = Math.sqrt(Math.random()) * jitterRadiusMeters;
    const centerLat = userLocation?.lat ?? fallbackMapCenter[0];
    const centerLng = userLocation?.lng ?? fallbackMapCenter[1];
    const latJitter = centerLat + (jitterDistanceMeters * Math.cos(jitterBearing)) / 111_320;
    const lngJitter = centerLng + (jitterDistanceMeters * Math.sin(jitterBearing)) / (111_320 * Math.cos(centerLat * Math.PI / 180));

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
      jitterMeters: jitterRadiusMeters,
      lat: latJitter,
      lng: lngJitter,
      durationHours: durationNum,
      tags: [intentData.intent, intentData.mode, intentData.when],
      safeHavenVenue: Boolean(intentData.isNearSafeHaven),
    });

    showStatusMessage(`● Intent Broadcasted: ${intentData.mode.toUpperCase()} · ${intentData.intent}`, 3500);
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
    } catch { }
    showStatusMessage(nextPaused ? '⏸ Intent paused on map' : '● Intent resumed on map', 2500);
  };

  // End active intent early
  const handleEndIntent = () => {
    hapticSensitiveAction();
    setActiveUserIntent(null);
    setIsUserIntentDrawerOpen(false);
    try {
      localStorage.removeItem('gayze_active_user_intent');
    } catch { }
    showStatusMessage('Intent ended and removed from map', 2500);
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
      let result = { sent: false, mutual: false, conversation_id: null as string | null };
      const looksLikeUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(pulseObj.peerId);

      if (looksLikeUuid && onSubmitInterest) {
        result = await onSubmitInterest(pulseObj);
      }

      if (!result.sent) {
        showStatusMessage('Interest could not be sent. Connect to live discovery and try again.');
        return;
      }

      setInterestedIds((prev) => {
        const next = new Set(prev);
        next.add(id);
        return next;
      });

      if (result.mutual) {
        triggerVibration([40, 60, 100]);
        setMutualMatchPulse(pulseObj);
        showStatusMessage('⚡ Mutual interest — opening your chat', 2500);
        setSelectedItem(null);
        setIsCardExpanded(false);
      } else {
        showStatusMessage('✓ Interest sent — they can now respond', 2500);
      }
    } catch (error) {
      console.error('[GAYZE] Interest submission failed', error);
      showStatusMessage('Interest could not be sent — try again');
    } finally {
      setInterestPendingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const handleGazeAtPerson = async (name: string, pulseObj?: Pulse) => {
    triggerVibration([40, 80]);
    setGazedPeerNames((prev) => new Set(prev).add(name));

    if (pulseObj && onSubmitGaze) {
      try {
        await onSubmitGaze(pulseObj);
        showStatusMessage(`👁️ Gaze sent to ${name}`, 2200);
      } catch (error) {
        console.error('[GAYZE] Gaze submission failed', error);
        showStatusMessage('Gaze could not be sent — try again');
      }
    }

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
        if (typeof p.approxDistanceKm === 'number' && p.approxDistanceKm > maxDistanceKm) return false;
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
        if (typeof p.approxDistanceKm === 'number' && p.approxDistanceKm > maxDistanceKm) return false;
        return true;
      });
      count += matchPulses.length;
    }
    if (activeCategory === 'all' || activeCategory === 'havens') {
      count += safeHavens.filter((h) => typeof h.approxDistanceKm !== 'number' || h.approxDistanceKm <= maxDistanceKm).length;
    }
    return count;
  }, [pulses, datingProfiles, safeHavens, activeCategory, activeIntentMode, maxDistanceKm]);

  // Live members count (people only, excluding safe haven facilities)
  const liveMembersCount = useMemo(() => {
    let count = 0;
    if (activeCategory === 'all' || activeCategory === 'people') {
      count += datingProfiles.filter(p => {
        const isPrivate = p.intentMode === 'private' || p.lookingFor === 'casual';
        if (activeIntentMode === 'Social' && isPrivate) return false;
        if (activeIntentMode === 'Private' && !isPrivate) return false;
        if (typeof p.approxDistanceKm === 'number' && p.approxDistanceKm > maxDistanceKm) return false;
        return true;
      }).length;
    }
    if (activeCategory !== 'havens') {
      count += pulses.filter(p => {
        if (activeCategory !== 'all' && activeCategory !== 'people' && p.activityCategory !== activeCategory) return false;
        const isPrivate = p.intentMode === 'private' || p.intent?.includes('Hookup');
        if (activeIntentMode === 'Social' && isPrivate) return false;
        if (activeIntentMode === 'Private' && !isPrivate) return false;
        if (typeof p.approxDistanceKm === 'number' && p.approxDistanceKm > maxDistanceKm) return false;
        return true;
      }).length;
    }
    return count;
  }, [pulses, datingProfiles, activeCategory, activeIntentMode, maxDistanceKm]);

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
    setMaxDistanceKm(5);
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

  // Once the real device location arrives, move the live map to it.
  // This replaces the previous behaviour where the map could remain centred
  // on a fallback location after permission was granted.
  useEffect(() => {
    if (!userLocation) return;
    const map = mapInstanceRef.current;
    if (!map) return;
    map.flyTo([userLocation.lat, userLocation.lng], LOCATED_MAP_ZOOM, { duration: 0.7 });
  }, [userLocation]);

  // Update map layers on pulses, havens, profiles, or filter changes
  useEffect(() => {
    if (!isMapReady) return;
    const map = mapInstanceRef.current;
    const layerGroup = layerGroupRef.current;
    if (!map || !layerGroup) return;

    layerGroup.clearLayers();

    // 1. User Location and Privacy Jitter Circle
    if (privacySetting !== 'ghost' && userLocation) {
      const userJitterRadius = privacySetting === 'neighborhood' ? 800 : 500;
      if (showJitterCircles) {
        L.circle([userLocation.lat, userLocation.lng], {
          radius: userJitterRadius,
          color: '#38bdf8',
          weight: 1,
          dashArray: '4, 4',
          fillColor: '#0284c7',
          fillOpacity: 0.07,
        }).addTo(layerGroup);
      }
      const userIcon = L.divIcon({
        className: 'custom-user-marker',
        html: '<div class="relative flex items-center justify-center"><div class="w-4 h-4 rounded-full bg-cyan-400 border-2 border-[#090a0f] shadow-lg ring-4 ring-cyan-400/20"></div></div>',
        iconSize: [16, 16],
        iconAnchor: [8, 8],
      });
      L.marker([userLocation.lat, userLocation.lng], { icon: userIcon })
        .addTo(layerGroup)
        .bindTooltip(`Approximate area · ${resolveAreaLabel(userNeighborhood)}`, { direction: 'top', offset: [0, -6] });
    }

    const occupiedMarkerCoordinates = new Map<string, number>();

    // 2. Safe Havens
    if (activeCategory === 'all' || activeCategory === 'havens') {
      safeHavens.forEach((haven) => {
        if (typeof haven.approxDistanceKm === 'number' && haven.approxDistanceKm > maxDistanceKm) return;
        if (typeof haven.lat !== 'number' || isNaN(haven.lat) || typeof haven.lng !== 'number' || isNaN(haven.lng)) return;
        const lat = haven.lat;
        const lng = haven.lng;
        const markerCoords = spreadOverlappingCoordinate(lat, lng, occupiedMarkerCoordinates);
        const selected = selectedItem?.type === 'haven' && selectedItem.item.id === haven.id;
        const icon = L.divIcon({
          className: 'custom-haven-marker',
          html: `<div class="w-8 h-8 rounded-xl ${selected
            ? 'bg-emerald-500 text-black scale-125 ring-4 ring-emerald-400/40 shadow-xl'
            : 'bg-[#10121a] border border-emerald-500/80 text-emerald-400 shadow-lg'
            } flex items-center justify-center">✓</div>`,
          iconSize: [32, 32],
          iconAnchor: [16, 16],
        });
        const marker = L.marker(markerCoords, { icon }).addTo(layerGroup);
        marker.on('click', () => {
          hapticLight();
          setSelectedItem({ type: 'haven', item: haven });
          setIsCardExpanded(false);
        });
      });
    }

    // 3. Profiles — only render when we have a live user location (relative placement)
    // or the profile carries its own coordinates. Never invent a Soho centre.
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
          html: `<div class="w-9 h-9 rounded-full border-2 ${selected ? 'border-[#C9A24D] ring-4 ring-[#C9A24D]/40' : isPrivate ? 'border-[#6F3CC3]' : 'border-[#C9A24D]'
            } overflow-hidden bg-[#141620]"><img src="${profile.photoUrl}" alt="" class="w-full h-full object-cover" /></div>`,
          iconSize: [36, 36],
          iconAnchor: [18, 18],
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
      pulses.forEach((pulse, idx) => {
        if (privacySetting === 'ghost' && pulse.peerId === 'peer_me') return;
        if (typeof pulse.approxDistanceKm === 'number' && pulse.approxDistanceKm > maxDistanceKm) return;
        if (activeCategory !== 'all' && pulse.activityCategory !== activeCategory) return;
        const isPrivate = pulse.intentMode === 'private' || pulse.intent?.includes('Hookup');
        if (activeIntentMode === 'Social' && isPrivate) return;
        if (activeIntentMode === 'Private' && !isPrivate) return;
        const hasCoords = typeof pulse.lat === 'number' && !isNaN(pulse.lat) && typeof pulse.lng === 'number' && !isNaN(pulse.lng);
        if (!hasCoords && !userLocation) return;
        const lat = hasCoords ? pulse.lat : userLocation!.lat + ((idx - 2) * 0.004);
        const lng = hasCoords ? pulse.lng : userLocation!.lng + ((idx % 3 - 1) * 0.005);
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
          html: `<div class="w-8 h-8 rounded-full bg-[#11131a] border-2 ${selected ? 'border-[#C9A24D] ring-4 ring-[#C9A24D]/40' : isPrivate ? 'border-purple-400' : 'border-[#C9A24D]'
            } flex items-center justify-center text-xs text-white font-bold">${pulse.peerName ? pulse.peerName.charAt(0) : 'P'}</div>`,
          iconSize: [32, 32],
          iconAnchor: [16, 16],
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
    pulses,
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
  ]);

  return (
    <div className="gayze-right-now-shell absolute inset-0 w-full h-full min-h-0 overflow-hidden select-none bg-[#07080b]" style={glowPulseBg}>
      {/* Subtle Map Tile Failure Fallback State */}
      {mapTilesUnavailable && (
        <div className="absolute top-16 left-3 right-3 sm:left-auto sm:right-4 z-40 max-w-sm mx-auto bg-[#0e1017]/95 backdrop-blur-md border border-white/10 rounded-2xl p-3.5 shadow-2xl animate-in fade-in duration-200 pointer-events-auto">
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
          1. RESTRAINED RIGHT NOW INTENT & DISCOVERY BAR
          Dominant element after the map is the user's current intent.
          Subtle purple atmospheric aura (#6F3CC3) when active.
         ========================================================================= */}
      <div className="gayze-right-now-topbar absolute top-[calc(env(safe-area-inset-top,0px)+10px)] left-3 right-3 z-20 pointer-events-none">
        <div className="max-w-xl mx-auto flex items-center justify-between gap-2.5">

          {/* User's Right Now Intent (Secondary visual element after map) */}
          <div className="pointer-events-auto min-w-0 flex-1">
            {activeUserIntent ? (
              <button
                type="button"
                onClick={() => {
                  hapticLight();
                  setIsUserIntentDrawerOpen(true);
                }}
                className="w-full text-left bg-[#101019]/92 hover:bg-[#141420]/96 backdrop-blur-xl border border-white/[0.14] hover:border-[#6F3CC3]/55 rounded-xl px-3.5 py-2.5 transition-colors shadow-[0_18px_42px_rgba(0,0,0,0.28)] flex items-center justify-between gap-2.5 cursor-pointer group"
                aria-label="Manage your Right Now intent"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="relative flex h-2 w-2 shrink-0">
                    {!activeUserIntent.isPaused && (
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#6F3CC3] opacity-75" />
                    )}
                    <span className={`relative inline-flex rounded-full h-2 w-2 ${activeUserIntent.isPaused ? 'bg-zinc-500' : 'bg-[#6F3CC3]'
                      }`} />
                  </span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-bold text-white tracking-tight truncate">
                        {activeUserIntent.intent}
                      </span>
                      <span className="text-[10px] font-mono text-purple-300/80 shrink-0">
                        · {formatRemainingTime(remainingMinutes)}
                      </span>
                    </div>
                    <span className="block text-[10px] text-zinc-400 font-mono truncate">
                      {activeUserIntent.isPaused ? 'Broadcast paused' : `Broadcasting in ${resolveAreaLabel(activeUserIntent.area || userNeighborhood)}`}
                    </span>
                  </div>
                </div>

                <div className="shrink-0 flex items-center gap-1 text-[11px] font-medium text-purple-300 group-hover:text-white transition-colors">
                  <span>Manage</span>
                </div>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  hapticLight();
                  setIsSetIntentOpen(true);
                  onOpenSetIntent?.();
                }}
                className="bg-[#0e1017]/90 hover:bg-[#161822]/95 backdrop-blur-xl border border-white/[0.12] hover:border-white/25 rounded-xl px-3.5 py-2.5 transition-colors shadow-[0_18px_42px_rgba(0,0,0,0.24)] flex items-center gap-2.5 cursor-pointer"
                aria-label="Set your Right Now intent"
              >
                <span className="w-2 h-2 rounded-full bg-zinc-500 shrink-0" />
                <div className="text-left min-w-0 flex-1">
                  <span className="block text-xs font-semibold text-zinc-200">
                    Set Right Now Intent
                  </span>
                  <span className="block text-[10px] text-zinc-400 font-mono">
                    {filteredActiveCount} nearby near you
                  </span>
                </div>
                <Plus className="w-4 h-4 text-[#6F3CC3] ml-auto shrink-0" />
              </button>
            )}
          </div>

          {/* Refine Discovery (Unified Filter Button) */}
          <div className="pointer-events-auto shrink-0 flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                hapticLight();
                setIsFilterDrawerOpen(true);
              }}
              className={`h-11 min-h-[44px] px-3 rounded-xl backdrop-blur-xl border shadow-[0_14px_32px_rgba(0,0,0,0.2)] flex items-center gap-2 text-xs font-medium transition-colors cursor-pointer ${activeFilterCount > 0
                ? 'bg-[#181424]/92 text-white border-[#6F3CC3]/60 shadow-[0_0_12px_rgba(111,60,195,0.25)]'
                : 'bg-[#0e1017]/90 hover:bg-[#161822] text-zinc-300 border-white/[0.12] hover:border-white/25'
                }`}
              aria-label="Open discovery filters"
            >
              <SlidersHorizontal className="w-3.5 h-3.5 text-zinc-400" />
              <span className="hidden sm:inline">Filter</span>
              {activeFilterCount > 0 && (
                <span className="min-w-4 h-4 px-1 rounded-full bg-[#6F3CC3] text-white text-[10px] font-mono font-bold flex items-center justify-center">
                  {activeFilterCount}
                </span>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Subtle Toast / Status Notification */}
      {statusMessage && (
        <div className="fixed top-16 left-3 right-3 sm:left-auto sm:right-4 z-50 bg-[#12141f]/95 backdrop-blur-md border border-[#C9A24D]/50 text-white text-xs px-3.5 py-2.5 rounded-xl flex items-center justify-between shadow-2xl animate-in fade-in duration-200">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#C9A24D] animate-ping" />
            <span className="font-semibold">{statusMessage}</span>
          </div>
          <button
            type="button"
            onClick={dismissStatusMessage}
            className="w-11 h-11 min-h-[44px] min-w-[44px] rounded-lg text-zinc-400 hover:text-white flex items-center justify-center cursor-pointer"
            aria-label="Dismiss message"
          >
            ✕
          </button>
        </div>
      )}

      {/* =========================================================================
          2. EDGE-TO-EDGE PRIMARY MAP / RADAR CANVAS
          The map is the central full-screen experience behind all UI.
          Maintains an explicit height and handles ResizeObserver container layout changes.
         ========================================================================= */}
      <div className="w-full h-full absolute inset-0 z-0" style={{ height: '100%', minHeight: '100%', width: '100%' }}>
        <style>{'.leaflet-control-attribution{margin-bottom:calc(3.5rem + env(safe-area-inset-bottom,0px) + 6px)!important;margin-right:.5rem!important;padding:2px 5px!important;border-radius:5px!important;background:rgba(7,8,11,.78)!important;color:rgba(255,255,255,.65)!important;font-size:9px!important;line-height:14px!important}.leaflet-control-attribution a{color:rgba(255,255,255,.78)!important}.leaflet-control-zoom{display:none!important}.leaflet-touch .leaflet-control-zoom{display:none!important}'}</style>
        <div
          ref={mapContainerRef}
          className="w-full h-full min-h-full overflow-hidden z-0 bg-[#07080b] rounded-none"
          style={{
            height: '100%',
            minHeight: '100%',
            width: '100%',
            backgroundImage: 'radial-gradient(circle at 50% 42%, rgba(111, 60, 195, 0.16), transparent 44%), radial-gradient(circle at 15% 10%, rgba(201, 162, 77, 0.08), transparent 30%)'
          }}
        />
      </div>
      {!userLocation && onRequestLocation && (
        <button
          type="button"
          onClick={onRequestLocation}
          className="absolute top-[calc(env(safe-area-inset-top,0px)+88px)] left-3 z-30 flex min-h-[44px] items-center gap-2 rounded-xl border border-[#6F3CC3]/45 bg-[#11131a]/95 px-3 text-xs font-semibold text-white shadow-xl backdrop-blur-md"
          aria-label="Use my location"
        >
          <MapPin className="h-4 w-4 text-[#C9A24D]" />
          <span>Use my location</span>
        </button>
      )}

      {/* =========================================================================
          4. CLEAN FLOATING VERTICAL MAP CONTROLS
          Independent vertical group on top-right edge:
          - Zoom In (+)
          - Zoom Out (-)
          - Recenter / Location compass
          - Toggle ±300m privacy circles
         ========================================================================= */}
      {(
        <div className="absolute top-[calc(env(safe-area-inset-top,0px)+88px)] right-3 z-20 flex flex-col gap-1.5 pointer-events-auto">
          {/* Zoom In */}
          <button
            type="button"
            onClick={() => {
              hapticLight();
              mapControlsRef.current?.zoomIn();
            }}
            title="Zoom In"
            aria-label="Zoom In"
            className="w-11 h-11 min-h-[44px] min-w-[44px] rounded-xl bg-[#0e1017]/85 hover:bg-[#181a26] backdrop-blur-xl border border-white/[0.12] hover:border-white/30 text-zinc-300 hover:text-white shadow-[0_14px_30px_rgba(0,0,0,0.28)] flex items-center justify-center transition-all active:scale-95 cursor-pointer"
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
            className="w-11 h-11 min-h-[44px] min-w-[44px] rounded-xl bg-[#0e1017]/85 hover:bg-[#181a26] backdrop-blur-xl border border-white/[0.12] hover:border-white/30 text-zinc-300 hover:text-white shadow-[0_14px_30px_rgba(0,0,0,0.28)] flex items-center justify-center transition-all active:scale-95 cursor-pointer"
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
            title="Recenter to your location"
            aria-label="Recenter to your location"
            className="w-11 h-11 min-h-[44px] min-w-[44px] rounded-xl bg-[#0e1017]/85 hover:bg-[#181a26] backdrop-blur-xl border border-white/[0.12] hover:border-[#C9A24D]/50 text-zinc-300 hover:text-[#C9A24D] shadow-[0_14px_30px_rgba(0,0,0,0.28)] flex items-center justify-center transition-all active:scale-95 cursor-pointer"
          >
            <Compass className="w-4 h-4 text-[#C9A24D]" />
          </button>

        </div>
      )}

      {/* =========================================================================
          4.5. ELEGANT EMPTY MAP STATE
          Shown when no live members have active intents nearby in current radius.
          Offers clear actions: expand radius, set intent, or switch to Later.
         ========================================================================= */}
      {liveMembersCount === 0 && !selectedItem && (
        <div className="absolute top-[calc(env(safe-area-inset-top,0px)+74px)] left-3 right-3 sm:left-auto sm:right-4 sm:w-88 z-30 pointer-events-auto bg-[#0d0f16]/95 backdrop-blur-xl border border-white/[0.12] rounded-2xl p-4 shadow-2xl space-y-3 animate-in fade-in duration-200">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#6F3CC3]/20 border border-[#6F3CC3]/40 flex items-center justify-center text-[#6F3CC3] shrink-0">
              <Compass className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h4 className="text-xs font-bold text-white tracking-wide">Nothing live nearby right now</h4>
              <p className="text-[10px] text-zinc-400 font-mono">Radius: {maxDistanceKm}km</p>
            </div>
          </div>
          <p className="text-[11px] text-zinc-300 leading-relaxed">
            No members currently have an active Right Now intent in this area. Expand your radius or broadcast your own live intent.
          </p>
          <div className="flex flex-col gap-1.5 pt-1 font-sans">
            <button
              type="button"
              onClick={() => {
                hapticLight();
                setMaxDistanceKm((prev) => (prev <= 5 ? 10 : prev <= 10 ? 25 : 5));
              }}
              className="w-full h-8 rounded-xl bg-white/[0.06] hover:bg-white/10 border border-white/10 text-xs font-semibold text-zinc-200 flex items-center justify-center gap-1.5 transition-colors cursor-pointer active:scale-98"
            >
              <span>Expand Radius to {maxDistanceKm <= 5 ? '10km' : maxDistanceKm <= 10 ? '25km' : '5km'}</span>
            </button>
            {onOpenSetIntent && (
              <button
                type="button"
                onClick={() => {
                  hapticLight();
                  onOpenSetIntent();
                }}
                className="w-full h-8 rounded-xl bg-[#6F3CC3] hover:bg-[#5e32a6] text-xs font-bold text-white flex items-center justify-center gap-1.5 transition-colors cursor-pointer shadow active:scale-98"
              >
                <span>Broadcast Your Live Intent</span>
              </button>
            )}
            {onSwitchToLater && (
              <button
                type="button"
                onClick={() => {
                  hapticLight();
                  onSwitchToLater();
                }}
                className="w-full h-7 rounded-xl bg-transparent hover:bg-white/[0.04] text-[11px] font-semibold text-zinc-400 hover:text-white transition-colors cursor-pointer flex items-center justify-center"
              >
                <span>Explore Later Gatherings →</span>
              </button>
            )}
          </div>
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
        <div className="gayze-discovery-card fixed bottom-[calc(3.5rem+env(safe-area-inset-bottom,0px)+12px)] md:bottom-6 left-3 right-3 max-w-lg mx-auto z-40 animate-in fade-in slide-in-from-bottom-3 duration-200 pointer-events-auto">
          <div className="relative bg-[#0d0f16]/97 backdrop-blur-xl border border-white/[0.14] rounded-2xl p-3.5 shadow-[0_20px_52px_rgba(0,0,0,0.48)]">
            <div className="relative space-y-2.5">
              {/* Row 1: Header (Avatar, Name, Age, Intent Badge, Expand & Close triggers) */}
              <div className="flex items-start justify-between gap-2.5">
                <button
                  type="button"
                  onClick={() => setIsCardExpanded(true)}
                  className="flex items-center gap-3 text-left cursor-pointer group/card flex-1 min-w-0"
                >
                  {/* Avatar / Icon */}
                  {selectedItem.type === 'profile' ? (
                    <div className="relative w-11 h-11 rounded-xl overflow-hidden border border-white/15 bg-[#161822] shrink-0">
                      <img
                        src={selectedItem.item.photoUrl}
                        alt={selectedItem.item.name}
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          (e.target as HTMLImageElement).src = 'https://raw.githubusercontent.com/mrcwalshe-wq/Gayze-App-V3/main/src/assets/images/dating_profile_marcus_1790154961749.jpg';
                        }}
                      />
                      <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-emerald-400 border-2 border-[#0e1017]" />
                    </div>
                  ) : selectedItem.type === 'haven' ? (
                    <div className="w-11 h-11 rounded-xl bg-[#0f1f1a] border border-emerald-500/50 text-emerald-400 flex items-center justify-center shrink-0">
                      <ShieldCheck className="w-5 h-5" />
                    </div>
                  ) : (
                    <div className="w-11 h-11 rounded-xl border border-white/15 bg-[#161822] text-zinc-200 flex items-center justify-center font-bold text-sm shrink-0">
                      {selectedItem.item.peerName.charAt(0)}
                    </div>
                  )}

                  {/* Name + Title + Intent Mode */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <h3 className="text-sm font-bold text-white tracking-tight truncate">
                        {getDisplayName(selectedItem)}
                      </h3>

                      {/* Clean Unboxed Mode Tag */}
                      <span className="text-[11px] font-mono text-zinc-400">
                        {selectedItem.type === 'haven'
                          ? `★ ${selectedItem.item.safetyScore}`
                          : selectedItem.type === 'pulse'
                            ? `· ${(selectedItem.item.intentMode || 'social').toUpperCase()}`
                            : `· ${(selectedItem.item.intentMode || 'social').toUpperCase()}`}
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
                        <span className="w-1.5 h-1.5 rounded-full bg-[#C9A24D]" />
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
                      setSelectedItem(null);
                    }}
                    className="w-11 h-11 min-h-[44px] min-w-[44px] rounded-lg text-zinc-400 hover:text-white hover:bg-white/[0.08] transition-colors flex items-center justify-center cursor-pointer"
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
                      className="col-span-2 h-11 min-h-[44px] px-2 text-xs font-bold text-black bg-[#C9A24D] hover:bg-[#b58f3b] rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5 shadow active:scale-98 font-sans uppercase tracking-wide"
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
                      className="h-11 min-h-[44px] px-2 text-xs font-bold text-[#C9A24D] bg-[#1a1c27] hover:bg-[#222534] border border-[#C9A24D]/40 rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1 active:scale-98 font-mono"
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
                        className={`h-11 min-h-[44px] px-2 text-xs font-bold rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5 border active:scale-98 ${interestedIds.has(selectedItem.item.id)
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
                        onClick={() => void handleGazeAtPerson(selectedItem.item.name)}
                        className={`h-11 min-h-[44px] px-2 text-xs font-bold rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5 border active:scale-98 ${gazedPeerNames.has(selectedItem.item.name)
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
                      className="h-11 min-h-[44px] px-2 text-xs font-bold text-[#C9A24D] hover:text-white bg-[#181a24] hover:bg-[#202332] border border-[#C9A24D]/35 rounded-xl transition-colors cursor-pointer flex items-center justify-center gap-1 active:scale-98 font-mono"
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
                      className="h-11 min-h-[44px] px-2 text-xs font-black text-black bg-[#C9A24D] hover:bg-[#b58f3b] rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5 shadow active:scale-98 uppercase tracking-wide font-sans"
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
          Bottom edge safely floats above the fixed bottom navigation bar.
         ========================================================================= */}
      {selectedItem && isCardExpanded && (
        <div
          className="gayze-discovery-overlay fixed inset-0 z-40 flex flex-col justify-end bg-black/48 backdrop-blur-[2px] animate-in fade-in duration-200 px-3"
          onClick={() => setIsCardExpanded(false)}
        >
          <div
            className="gayze-discovery-sheet w-full max-w-lg mx-auto bg-[#0d0f16] border border-white/[0.18] rounded-2xl shadow-2xl overflow-hidden flex flex-col animate-in slide-in-from-bottom-4 duration-300 pointer-events-auto mb-[calc(3.5rem+env(safe-area-inset-bottom,0px)+12px)] md:mb-6 max-h-[calc(100dvh-3.5rem-env(safe-area-inset-top,0px)-3.5rem-env(safe-area-inset-bottom,0px)-32px)] md:max-h-[calc(100dvh-3.5rem-env(safe-area-inset-top,0px)-48px)]"
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
                    <div className="w-14 h-14 rounded-2xl overflow-hidden border-2 border-[#C9A24D]/60 bg-[#161822] shrink-0 shadow-[0_12px_24px_rgba(201,162,77,0.22)]">
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
                    <div className="w-14 h-14 rounded-2xl bg-[#10221c] border-2 border-emerald-500/70 text-emerald-400 flex items-center justify-center shrink-0 shadow-[0_12px_24px_rgba(16,185,129,0.18)]">
                      <ShieldCheck className="w-7 h-7" />
                    </div>
                  ) : (
                    <div className={`w-14 h-14 rounded-2xl border-2 flex items-center justify-center font-black text-xl shrink-0 shadow-[0_12px_24px_rgba(111,60,195,0.2)] ${selectedItem.item.intentMode === 'private' || selectedItem.item.intent?.includes('Hookup')
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
                  <span className={`px-2 py-0.5 rounded-md font-bold uppercase ${selectedItem.type === 'haven'
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
                    <span className="text-[10px] text-zinc-400 block">Area verified nearby</span>
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
                      className="h-12 min-h-[44px] px-3 text-xs font-bold text-black bg-[#C9A24D] hover:bg-[#b58f3b] rounded-xl transition-all cursor-pointer flex items-center justify-center gap-2 uppercase tracking-wide font-sans shadow-[0_12px_24px_rgba(201,162,77,0.22)]"
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
                        className={`h-12 min-h-[44px] px-2 text-xs font-bold rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5 border active:scale-98 ${interestedIds.has(selectedItem.item.id)
                          ? 'bg-[#201530] text-purple-300 border-[#6F3CC3]/60'
                          : 'bg-[#141620] text-zinc-200 border-white/10 hover:border-white/20'
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
                        onClick={() => void handleGazeAtPerson(selectedItem.item.name)}
                        className={`h-12 min-h-[44px] px-2 text-xs font-bold rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5 border active:scale-98 ${gazedPeerNames.has(selectedItem.item.name)
                          ? 'bg-[#201530] text-purple-300 border-[#6F3CC3]/60'
                          : 'bg-[#141620] text-zinc-200 border-white/10 hover:border-white/20'
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
                      className="h-12 min-h-[44px] px-2 text-xs font-bold text-[#C9A24D] hover:text-white bg-[#141620] hover:bg-[#1c1f2e] border border-white/10 rounded-xl transition-colors cursor-pointer flex items-center justify-center gap-1.5 active:scale-98 font-mono"
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
                      className="h-12 min-h-[44px] px-2 text-xs font-black text-black bg-[#C9A24D] hover:bg-[#b58f3b] rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5 shadow-[0_12px_24px_rgba(201,162,77,0.22)] active:scale-98 uppercase tracking-wider font-sans"
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
            className="w-full max-w-lg mx-auto mb-[calc(3.5rem+env(safe-area-inset-bottom,0px))] md:mb-0 bg-[#0d0f16] border-t border-x border-white/[0.15] rounded-t-3xl shadow-2xl overflow-hidden flex flex-col max-h-[calc(100dvh-3.5rem-env(safe-area-inset-top,0px)-3.5rem-env(safe-area-inset-bottom,0px))] md:max-h-[calc(100dvh-env(safe-area-inset-top,0px))] animate-in slide-in-from-bottom duration-300"
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
                  WHAT
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
                        className={`h-11 min-h-[44px] px-2 text-xs font-semibold rounded-xl border transition-all cursor-pointer flex items-center justify-center text-center active:scale-98 ${isSelected
                          ? 'bg-[#1c182c] text-white border-[#6F3CC3]'
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
                  INTENT
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
                        className={`h-11 min-h-[44px] px-2 text-xs font-bold rounded-xl border transition-all cursor-pointer flex items-center justify-center active:scale-98 uppercase font-mono ${isSelected
                          ? mode === 'Private'
                            ? 'bg-purple-950/80 text-purple-200 border-purple-500'
                            : 'bg-[#1c182c] text-white border-[#6F3CC3]'
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
                  DISTANCE & PRIVACY
                </span>

                <div className="p-3 bg-[#12141e] border border-white/[0.08] rounded-xl flex items-center justify-between gap-3">
                  <div>
                    <span className="text-xs font-bold text-white block">Approximate location radius</span>
                    <span className="text-[11px] text-zinc-400 block">Display a radius around the map marker</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      hapticLight();
                      setShowJitterCircles(!showJitterCircles);
                    }}
                    role="switch"
                    aria-checked={showJitterCircles}
                    aria-label="Show approximate location radius"
                    className="w-12 min-w-[44px] h-11 min-h-[44px] flex items-center justify-center cursor-pointer shrink-0"
                  >
                    <span className={`w-12 h-6 rounded-full transition-colors p-0.5 flex items-center ${showJitterCircles ? 'bg-[#6F3CC3]' : 'bg-zinc-700'}`}>
                      <span className={`w-5 h-5 rounded-full bg-white transition-transform ${showJitterCircles ? 'translate-x-6' : 'translate-x-0'}`} />
                    </span>
                  </button>
                </div>

                <div className="grid grid-cols-3 gap-2 pt-1">
                  {[
                    { km: 1, label: '< 1 km' },
                    { km: 3, label: '< 3 km' },
                    { km: 5, label: 'All nearby' },
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
                        className={`h-11 min-h-[44px] px-2 text-xs font-semibold rounded-xl border transition-all cursor-pointer flex items-center justify-center font-mono ${isSelected
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
                className="flex-1 h-12 min-h-[44px] px-4 text-xs font-black text-black bg-[#C9A24D] hover:bg-[#b58f3b] rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5 shadow-[0_12px_24px_rgba(201,162,77,0.22)] uppercase tracking-wide font-sans active:scale-98"
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
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#6F3CC3] opacity-75" />
                  )}
                  <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${activeUserIntent.isPaused ? 'bg-zinc-500' : 'bg-[#6F3CC3]'
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
                <span className={`text-xs font-black font-mono uppercase px-2 py-0.5 rounded border ${activeUserIntent.mode === 'private'
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
                className="w-11 h-11 min-h-[44px] min-w-[44px] rounded-lg text-zinc-400 hover:text-white flex items-center justify-center cursor-pointer"
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
