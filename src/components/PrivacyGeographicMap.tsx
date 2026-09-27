import React, { useEffect, useMemo, useRef } from 'react';
import L from 'leaflet';
import { Pulse, SafeHaven, LocationPrivacy, DatingProfile } from '../types';

export type MapDiscoveryItem =
  | { type: 'pulse'; item: Pulse }
  | { type: 'haven'; item: SafeHaven }
  | { type: 'profile'; item: DatingProfile };

interface PrivacyGeographicMapProps {
  pulses: Pulse[];
  safeHavens: SafeHaven[];
  profiles?: DatingProfile[];
  userNeighborhood: string;
  privacySetting: LocationPrivacy;
  filter?: 'all' | 'people' | 'coffee' | 'drinks' | 'active' | 'havens';
  intentModeFilter?: 'All' | 'Social' | 'Private';
  showJitterCircles?: boolean;
  maxDistanceKm?: number;
  selectedItem?: MapDiscoveryItem | null;
  onSelectItem: (item: MapDiscoveryItem | null) => void;
  onOpenDirectChat?: (pulse: Pulse) => void;
  onOpenDirectChatWithProfile?: (profile: DatingProfile) => void;
  onSelectHaven?: (haven: SafeHaven) => void;
  onBroadcastHere?: (venueName: string) => void;
  onGazeAtPeer?: (peerName: string) => void;
  onOpenScheduleMeeting?: (peerName: string) => void;
  onViewProfileDetail?: (profile: DatingProfile) => void;
  onMapReady?: (controls: {
    zoomIn: () => void;
    zoomOut: () => void;
    recenter: () => void;
  }) => void;
}

const DEFAULT_CENTER: L.LatLngExpression = [51.5132, -0.13];
const DEFAULT_ZOOM = 14;

const profileCoords: Record<string, [number, number]> = {
  prof_marcus: [51.5126, -0.1268],
  prof_liam: [51.514, -0.128],
  prof_soren: [51.5135, -0.1295],
  prof_mateo: [51.52, -0.135],
  prof_kenji: [51.5255, -0.1248],
  prof_nico: [51.513, -0.131],
  prof_damian: [51.535, -0.1245],
  prof_alex: [51.517, -0.12],
};

const validCoord = (lat: unknown, lng: unknown): lat is number =>
  typeof lat === 'number' &&
  Number.isFinite(lat) &&
  typeof lng === 'number' &&
  Number.isFinite(lng);

const makeIcon = (html: string, size: number, className: string) =>
  L.divIcon({
    className,
    html,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });

export const PrivacyGeographicMap: React.FC<PrivacyGeographicMapProps> = ({
  pulses,
  safeHavens,
  profiles = [],
  userNeighborhood,
  privacySetting,
  filter = 'all',
  intentModeFilter = 'All',
  showJitterCircles = true,
  maxDistanceKm = 5,
  selectedItem,
  onSelectItem,
  onMapReady,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layersRef = useRef<L.LayerGroup | null>(null);
  const tilesRef = useRef<L.TileLayer | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  const recenter = () => {
    const map = mapRef.current;
    if (!map) return;
    map.invalidateSize({ pan: false });
    map.flyTo(DEFAULT_CENTER, DEFAULT_ZOOM, { duration: 0.45 });
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container || mapRef.current) return;

    // Leaflet must never initialise against a zero-sized/hidden container.
    container.style.width = '100%';
    container.style.height = '100%';
    container.style.minHeight = '100%';

    const map = L.map(container, {
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      minZoom: 11,
      maxZoom: 19,
      zoomControl: false,
      attributionControl: true,
      preferCanvas: true,
      zoomAnimation: true,
      fadeAnimation: true,
      markerZoomAnimation: true,
    });

    mapRef.current = map;

    // One deterministic, public tile source. Do not replace the entire map
    // after individual tile errors; Leaflet will retry failed tiles itself.
    const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      minZoom: 0,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors',
      crossOrigin: true,
      keepBuffer: 6,
      updateWhenIdle: false,
      updateWhenZooming: false,
    });

    tilesRef.current = tiles;
    tiles.addTo(map);

    const layers = L.layerGroup().addTo(map);
    layersRef.current = layers;

    L.control.zoom({ position: 'bottomright' }).addTo(map);

    const refreshSize = () => {
      if (!mapRef.current) return;
      requestAnimationFrame(() => {
        mapRef.current?.invalidateSize({ pan: false, debounceMoveend: true });
      });
    };

    const ro =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(refreshSize)
        : null;

    ro?.observe(container);
    resizeObserverRef.current = ro;

    const onWindowResize = () => refreshSize();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        window.setTimeout(refreshSize, 50);
        window.setTimeout(refreshSize, 300);
      }
    };

    window.addEventListener('resize', onWindowResize);
    document.addEventListener('visibilitychange', onVisibility);

    // Covers maps mounted inside animated tabs/drawers/modals.
    const timers = [0, 50, 150, 400, 900].map((delay) =>
      window.setTimeout(refreshSize, delay),
    );

    map.whenReady(() => {
      refreshSize();
      onMapReady?.({
        zoomIn: () => map.zoomIn(),
        zoomOut: () => map.zoomOut(),
        recenter,
      });
    });

    return () => {
      timers.forEach(window.clearTimeout);
      window.removeEventListener('resize', onWindowResize);
      document.removeEventListener('visibilitychange', onVisibility);
      ro?.disconnect();
      resizeObserverRef.current = null;
      layers.clearLayers();
      tiles.remove();
      map.remove();
      mapRef.current = null;
      layersRef.current = null;
      tilesRef.current = null;
    };
  }, []);

  const visibleItems = useMemo(() => {
    const result: MapDiscoveryItem[] = [];

    if (filter === 'all' || filter === 'havens') {
      safeHavens.forEach((item) => {
        if (
          typeof item.approxDistanceKm === 'number' &&
          item.approxDistanceKm > maxDistanceKm
        )
          return;
        result.push({ type: 'haven', item });
      });
    }

    if (filter === 'all' || filter === 'people') {
      profiles.forEach((item) => {
        if (
          typeof item.approxDistanceKm === 'number' &&
          item.approxDistanceKm > maxDistanceKm
        )
          return;
        const isPrivate =
          item.intentMode === 'private' || item.lookingFor === 'casual';
        if (intentModeFilter === 'Social' && isPrivate) return;
        if (intentModeFilter === 'Private' && !isPrivate) return;
        result.push({ type: 'profile', item });
      });
    }

    if (filter !== 'people' && filter !== 'havens') {
      pulses.forEach((item) => {
        if (
          typeof item.approxDistanceKm === 'number' &&
          item.approxDistanceKm > maxDistanceKm
        )
          return;
        if (filter !== 'all' && item.activityCategory !== filter) return;
        const isPrivate =
          item.intentMode === 'private' || item.intent?.includes('Hookup');
        if (intentModeFilter === 'Social' && isPrivate) return;
        if (intentModeFilter === 'Private' && !isPrivate) return;
        result.push({ type: 'pulse', item });
      });
    }

    return result;
  }, [
    pulses,
    safeHavens,
    profiles,
    filter,
    intentModeFilter,
    maxDistanceKm,
  ]);

  useEffect(() => {
    const map = mapRef.current;
    const layers = layersRef.current;
    if (!map || !layers) return;

    layers.clearLayers();

    if (privacySetting !== 'ghost') {
      const radius = privacySetting === 'neighborhood' ? 800 : 400;
      if (showJitterCircles) {
        L.circle(DEFAULT_CENTER, {
          radius,
          color: '#38bdf8',
          weight: 1,
          dashArray: '4,4',
          fillColor: '#0284c7',
          fillOpacity: 0.07,
        }).addTo(layers);
      }

      const userIcon = makeIcon(
        '<div class="flex items-center justify-center"><div class="w-4 h-4 rounded-full bg-cyan-400 border-2 border-[#090a0f] shadow-lg ring-4 ring-cyan-400/20"></div></div>',
        16,
        'custom-user-marker',
      );

      L.marker(DEFAULT_CENTER, { icon: userIcon })
        .addTo(layers)
        .bindTooltip(`You (${userNeighborhood}) · ~300m cloaked`, {
          direction: 'top',
          offset: [0, -6],
        });
    }

    visibleItems.forEach((entry, idx) => {
      if (entry.type === 'haven') {
        const item = entry.item;
        const lat = validCoord(item.lat, item.lng)
          ? item.lat
          : 51.5126 + idx * 0.004;
        const lng = validCoord(item.lat, item.lng)
          ? item.lng
          : -0.1268 + (idx % 2 === 0 ? 0.003 : -0.003);
        const selected =
          selectedItem?.type === 'haven' && selectedItem.item.id === item.id;
        const icon = makeIcon(
          `<div class="w-8 h-8 rounded-xl ${selected ? 'bg-emerald-500 text-black scale-125 ring-4 ring-emerald-400/40' : 'bg-[#10121a] border border-emerald-500/80 text-emerald-400'} flex items-center justify-center shadow-lg">✓</div>`,
          32,
          'custom-haven-marker',
        );
        L.marker([lat, lng], { icon })
          .addTo(layers)
          .on('click', () => onSelectItem({ type: 'haven', item }));
        return;
      }

      if (entry.type === 'profile') {
        const item = entry.item;
        const isPrivate =
          item.intentMode === 'private' || item.lookingFor === 'casual';
        const fallback = profileCoords[item.id] || [
          51.5132 + ((idx % 3 - 1) * 0.0035),
          -0.13 + (((idx + 1) % 3 - 1) * 0.004),
        ];
        const coords: [number, number] = fallback;
        const selected =
          selectedItem?.type === 'profile' && selectedItem.item.id === item.id;
        const icon = makeIcon(
          `<div class="w-9 h-9 rounded-full border-2 ${selected ? 'border-[#C9A24D] ring-4 ring-[#C9A24D]/40' : isPrivate ? 'border-[#6F3CC3]' : 'border-[#C9A24D]'} overflow-hidden bg-[#141620]">${item.photoUrl ? `<img src="${item.photoUrl}" alt="" class="w-full h-full object-cover" />` : '<div class="w-full h-full flex items-center justify-center text-white font-bold">G</div>'}</div>`,
          36,
          'custom-person-marker',
        );
        L.marker(coords as L.LatLngExpression, { icon })
          .addTo(layers)
          .on('click', () => onSelectItem({ type: 'profile', item }));
        return;
      }

      const item = entry.item;
      const isPrivate =
        item.intentMode === 'private' || item.intent?.includes('Hookup');
      const fallback: [number, number] = [
        51.5132 + ((idx % 5) - 2) * 0.003,
        -0.13 + ((idx % 4) - 1.5) * 0.004,
      ];
      const coords: [number, number] = validCoord(item.lat, item.lng)
        ? [item.lat, item.lng]
        : fallback;
      if (showJitterCircles) {
        const jitter =
          typeof item.jitterMeters === 'number' &&
          Number.isFinite(item.jitterMeters)
            ? item.jitterMeters
            : 300;
        L.circle(coords, {
          radius: jitter,
          color: isPrivate ? '#6F3CC3' : '#C9A24D',
          weight: 1,
          dashArray: '3,4',
          fillColor: isPrivate ? '#6F3CC3' : '#C9A24D',
          fillOpacity: 0.06,
        }).addTo(layers);
      }

      const selected =
        selectedItem?.type === 'pulse' && selectedItem.item.id === item.id;
      const icon = makeIcon(
        `<div class="w-8 h-8 rounded-full bg-[#11131a] border-2 ${selected ? 'border-[#C9A24D] ring-4 ring-[#C9A24D]/40' : isPrivate ? 'border-purple-400' : 'border-[#C9A24D]'} flex items-center justify-center text-xs text-white font-bold">${item.peerName ? item.peerName.charAt(0) : 'P'}</div>`,
        32,
        'custom-pulse-marker',
      );

      L.marker(coords, { icon })
        .addTo(layers)
        .on('click', () => onSelectItem({ type: 'pulse', item }));
    });

    // A map can be mounted while its parent is transitioning. Recalculate
    // after the marker/layout pass as well as during the initial mount.
    requestAnimationFrame(() => map.invalidateSize({ pan: false }));
  }, [
    visibleItems,
    privacySetting,
    showJitterCircles,
    userNeighborhood,
    selectedItem,
    onSelectItem,
  ]);

  return (
    <>
      <style>{`
        .gayze-leaflet-map.leaflet-container { width:100%!important; height:100%!important; min-height:100%!important; background:#07080b!important; }
        .gayze-leaflet-map .leaflet-tile { filter: invert(100%) hue-rotate(180deg) brightness(.82) contrast(.96) saturate(.28); }
        .gayze-leaflet-map .leaflet-control-attribution { margin-bottom:4.5rem!important; margin-right:.5rem!important; padding:2px 6px!important; border-radius:6px!important; background:rgba(7,8,11,.78)!important; color:rgba(255,255,255,.65)!important; font-size:9px!important; line-height:14px!important; }
        .gayze-leaflet-map .leaflet-control-attribution a { color:rgba(255,255,255,.78)!important; }
        .gayze-leaflet-map .leaflet-control-zoom { border:0!important; box-shadow:0 8px 22px rgba(0,0,0,.35)!important; border-radius:12px!important; overflow:hidden!important; }
        .gayze-leaflet-map .leaflet-control-zoom a { width:36px!important; height:36px!important; line-height:36px!important; background:rgba(15,17,24,.94)!important; color:rgba(255,255,255,.82)!important; border:0!important; border-bottom:1px solid rgba(255,255,255,.08)!important; }
        .gayze-leaflet-map .leaflet-marker-icon { background:transparent!important; border:0!important; }
      `}</style>
      <div
        ref={containerRef}
        className="gayze-leaflet-map relative w-full h-full min-h-0 overflow-hidden z-0 bg-[#07080b]"
        style={{ width: '100%', height: '100%', minHeight: '100%' }}
      />
    </>
  );
};
