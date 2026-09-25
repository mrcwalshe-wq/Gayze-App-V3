import React, { useEffect, useRef } from 'react';
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
  selectedItem?: MapDiscoveryItem | null;
  onSelectItem: (item: MapDiscoveryItem | null) => void;
  onOpenDirectChat?: (pulse: Pulse) => void;
  onOpenDirectChatWithProfile?: (profile: DatingProfile) => void;
  onSelectHaven?: (haven: SafeHaven) => void;
  onBroadcastHere?: (venueName: string) => void;
  onGazeAtPeer?: (peerName: string) => void;
  onOpenScheduleMeeting?: (peerName: string) => void;
  onViewProfileDetail?: (profile: DatingProfile) => void;
  onMapReady?: (controls: { zoomIn: () => void; zoomOut: () => void; recenter: () => void }) => void;
}

export const PrivacyGeographicMap: React.FC<PrivacyGeographicMapProps> = ({
  pulses,
  safeHavens,
  profiles = [],
  userNeighborhood,
  privacySetting,
  filter = 'all',
  intentModeFilter = 'All',
  showJitterCircles = true,
  selectedItem,
  onSelectItem,
  onMapReady,
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const layerGroupRef = useRef<L.LayerGroup | null>(null);

  // User's default center (London Soho/Covent Garden hub)
  const userCenterLat = 51.5132;
  const userCenterLng = -0.1300;

  // Curated coordinates for nearby profiles to ensure realistic Soho/Covent Garden placement
  const profileCoords: Record<string, [number, number]> = {
    prof_marcus: [51.5126, -0.1268],
    prof_liam: [51.5140, -0.1280],
    prof_soren: [51.5135, -0.1295],
    prof_mateo: [51.5200, -0.1350],
    prof_kenji: [51.5255, -0.1248],
    prof_nico: [51.5130, -0.1310],
    prof_damian: [51.5350, -0.1245],
    prof_alex: [51.5170, -0.1200],
  };

  // Initialize Map
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center: [userCenterLat, userCenterLng],
      zoom: 14,
      minZoom: 11,
      maxZoom: 18,
      zoomControl: false,
    });

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; OpenStreetMap &copy; CARTO',
      subdomains: 'abcd',
      maxZoom: 19,
    }).addTo(map);

    const layerGroup = L.layerGroup().addTo(map);
    layerGroupRef.current = layerGroup;
    mapInstanceRef.current = map;

    // Deselect if user taps map background
    map.on('click', (e) => {
      // If clicking directly on map canvas (not marker)
      const target = e.originalEvent?.target as HTMLElement;
      if (target && target.tagName === 'DIV' && target.classList.contains('leaflet-container')) {
        // preserve or handle
      }
    });

    // Notify parent of controls
    if (onMapReady) {
      onMapReady({
        zoomIn: () => map.zoomIn(),
        zoomOut: () => map.zoomOut(),
        recenter: () => map.flyTo([userCenterLat, userCenterLng], 14, { duration: 0.8 }),
      });
    }

    // Invalidate after the browser has committed the layout. This is important
    // because Right Now is mounted inside a tabbed viewport and Leaflet can
    // initialise before its container has its final dimensions.
    const invalidate = () => {
      requestAnimationFrame(() => {
        map.invalidateSize({ pan: false });
      });
    };

    invalidate();
    const timer = window.setTimeout(invalidate, 100);
    const timer2 = window.setTimeout(invalidate, 350);

    // Resize observer keeps Leaflet in sync with mobile viewport / tab changes.
    let ro: ResizeObserver | null = null;
    if (window.ResizeObserver && mapContainerRef.current) {
      ro = new ResizeObserver(() => {
        map.invalidateSize();
      });
      ro.observe(mapContainerRef.current);
    }

    return () => {
      clearTimeout(timer);
      clearTimeout(timer2);
      if (ro) ro.disconnect();
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  // Update controls callback if provided
  useEffect(() => {
    if (onMapReady && mapInstanceRef.current) {
      const map = mapInstanceRef.current;
      onMapReady({
        zoomIn: () => map.zoomIn(),
        zoomOut: () => map.zoomOut(),
        recenter: () => map.flyTo([userCenterLat, userCenterLng], 14, { duration: 0.8 }),
      });
    }
  }, [onMapReady]);

  // Render markers and privacy circles whenever data, filters, or settings change
  useEffect(() => {
    const map = mapInstanceRef.current;
    const layerGroup = layerGroupRef.current;
    if (!map || !layerGroup) return;

    layerGroup.clearLayers();

    // 1. User Location Indicator (if not Ghost)
    if (privacySetting !== 'ghost') {
      const userJitterRadius = privacySetting === 'neighborhood' ? 800 : 400;

      if (showJitterCircles) {
        L.circle([userCenterLat, userCenterLng], {
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
        html: `
          <div class="relative flex items-center justify-center">
            <div class="w-4 h-4 rounded-full bg-cyan-400 border-2 border-[#090a0f] shadow-lg ring-4 ring-cyan-400/20"></div>
          </div>
        `,
        iconSize: [16, 16],
        iconAnchor: [8, 8],
      });

      L.marker([userCenterLat, userCenterLng], { icon: userIcon })
        .addTo(layerGroup)
        .bindTooltip(`<div class="text-[11px] font-sans font-medium text-cyan-300">You (${userNeighborhood}) · ~300m cloaked</div>`, {
          direction: 'top',
          offset: [0, -6],
          className: 'bg-zinc-900 text-cyan-300 border border-zinc-700 px-2.5 py-1 rounded-lg shadow-xl',
        });
    }

    // 2. Safe Havens Markers
    if (filter === 'all' || filter === 'havens') {
      safeHavens.forEach((haven, idx) => {
        const havenLat = typeof haven.lat === 'number' && !isNaN(haven.lat) 
          ? haven.lat 
          : 51.5126 + (idx * 0.004);
        const havenLng = typeof haven.lng === 'number' && !isNaN(haven.lng) 
          ? haven.lng 
          : -0.1268 + ((idx % 2 === 0 ? 1 : -1) * 0.003);

        const isSelected = selectedItem?.type === 'haven' && selectedItem.item.id === haven.id;

        const havenIcon = L.divIcon({
          className: 'custom-haven-marker',
          html: `
            <div class="w-8 h-8 rounded-xl ${
              isSelected 
                ? 'bg-emerald-500 text-black scale-125 ring-4 ring-emerald-400/40 shadow-xl' 
                : 'bg-[#10121a] border border-emerald-500/80 text-emerald-400 shadow-lg hover:scale-110'
            } flex items-center justify-center transition-all cursor-pointer">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="${isSelected ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/></svg>
            </div>
          `,
          iconSize: [32, 32],
          iconAnchor: [16, 16],
        });

        const marker = L.marker([havenLat, havenLng], { icon: havenIcon }).addTo(layerGroup);
        marker.on('click', () => {
          onSelectItem({ type: 'haven', item: haven });
        });

        marker.bindTooltip(
          `<div class="text-[11px] font-sans font-semibold text-emerald-400">${haven.name}<div class="text-[10px] text-zinc-400 font-normal">★ ${haven.safetyScore} Safe Haven</div></div>`,
          { direction: 'top', offset: [0, -16] }
        );
      });
    }

    // 3. Nearby People Markers
    if (filter === 'all' || filter === 'people') {
      profiles.forEach((profile, idx) => {
        const isPrivate = profile.intentMode === 'private' || profile.lookingFor === 'casual';
        
        // Mode filter
        if (intentModeFilter === 'Social' && isPrivate) return;
        if (intentModeFilter === 'Private' && !isPrivate) return;

        const coords = profileCoords[profile.id] || [
          51.5132 + ((idx % 3 - 1) * 0.0035),
          -0.1300 + (((idx + 1) % 3 - 1) * 0.004),
        ];

        const isSelected = selectedItem?.type === 'profile' && selectedItem.item.id === profile.id;

        const personIcon = L.divIcon({
          className: 'custom-person-marker',
          html: `
            <div class="relative cursor-pointer group ${isSelected ? 'scale-125 z-50' : 'hover:scale-110'} transition-transform">
              <div class="w-9 h-9 rounded-full border-2 ${
                isSelected
                  ? 'border-[#C9A24D] ring-4 ring-[#C9A24D]/40 shadow-2xl'
                  : isPrivate 
                    ? 'border-[#6F3CC3] shadow-[0_0_12px_rgba(111,60,195,0.45)]' 
                    : 'border-[#C9A24D] shadow-[0_0_12px_rgba(201,162,77,0.35)]'
              } overflow-hidden bg-[#141620]">
                <img src="${profile.photoUrl}" alt="${profile.name}" class="w-full h-full object-cover" onerror="this.src='https://raw.githubusercontent.com/mrcwalshe-wq/Gayze-App-V3/main/src/assets/images/dating_profile_marcus_1790154961749.jpg'" />
              </div>
              <div class="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full ${
                isPrivate ? 'bg-[#6F3CC3]' : 'bg-[#C9A24D]'
              } border border-black flex items-center justify-center text-[7px] text-white font-bold shadow">
                ●
              </div>
            </div>
          `,
          iconSize: [36, 36],
          iconAnchor: [18, 18],
        });

        const marker = L.marker(coords, { icon: personIcon }).addTo(layerGroup);
        marker.on('click', () => {
          onSelectItem({ type: 'profile', item: profile });
        });

        marker.bindTooltip(
          `<div class="text-[11px] font-sans font-semibold text-white">${profile.name}, ${profile.age}<div class="text-[10px] text-[#C9A24D] font-mono">${profile.lookingForLabel || profile.headline}</div></div>`,
          { direction: 'top', offset: [0, -18] }
        );
      });
    }

    // 4. Pulses Markers
    if (filter !== 'havens' && filter !== 'people') {
      pulses.forEach((pulse, idx) => {
        if (filter !== 'all' && pulse.activityCategory !== filter) return;

        const isPrivate = pulse.intentMode === 'private' || pulse.intent?.includes('Hookup');
        if (intentModeFilter === 'Social' && isPrivate) return;
        if (intentModeFilter === 'Private' && !isPrivate) return;

        const pulseLat = typeof pulse.lat === 'number' && !isNaN(pulse.lat) 
          ? pulse.lat 
          : 51.5132 + ((idx - 2) * 0.004);
        const pulseLng = typeof pulse.lng === 'number' && !isNaN(pulse.lng) 
          ? pulse.lng 
          : -0.1300 + ((idx % 3 - 1) * 0.005);
        const jitterRadius = typeof pulse.jitterMeters === 'number' && !isNaN(pulse.jitterMeters)
          ? pulse.jitterMeters
          : 300;

        if (showJitterCircles) {
          L.circle([pulseLat, pulseLng], {
            radius: jitterRadius,
            color: isPrivate ? '#6F3CC3' : '#C9A24D',
            weight: 1,
            dashArray: '3, 4',
            fillColor: isPrivate ? '#6F3CC3' : '#C9A24D',
            fillOpacity: 0.06,
          }).addTo(layerGroup);
        }

        const isSelected = selectedItem?.type === 'pulse' && selectedItem.item.id === pulse.id;

        const pulseIcon = L.divIcon({
          className: 'custom-pulse-marker',
          html: `
            <div class="relative cursor-pointer ${isSelected ? 'scale-125 z-50' : 'hover:scale-110'} transition-transform">
              <div class="w-8 h-8 rounded-full bg-[#11131a] border-2 ${
                isSelected
                  ? 'border-[#C9A24D] ring-4 ring-[#C9A24D]/40 text-[#C9A24D] shadow-2xl'
                  : isPrivate 
                    ? 'border-purple-400 text-purple-300 shadow-[0_0_12px_rgba(111,60,195,0.45)]' 
                    : 'border-[#C9A24D] text-[#C9A24D] shadow-[0_0_12px_rgba(201,162,77,0.35)]'
              } flex items-center justify-center font-bold font-sans text-xs">
                ${pulse.peerName ? pulse.peerName.charAt(0) : 'P'}
              </div>
              <div class="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full ${
                isPrivate ? 'bg-purple-500' : 'bg-[#C9A24D]'
              } border border-black shadow"></div>
            </div>
          `,
          iconSize: [32, 32],
          iconAnchor: [16, 16],
        });

        const marker = L.marker([pulseLat, pulseLng], { icon: pulseIcon }).addTo(layerGroup);
        marker.on('click', () => {
          onSelectItem({ type: 'pulse', item: pulse });
        });

        marker.bindTooltip(
          `<div class="text-[11px] font-sans font-semibold text-white">${pulse.peerName}<div class="text-[10px] text-[#C9A24D] font-mono">${pulse.intent || pulse.title}</div><div class="text-[9px] text-zinc-400">~${pulse.approxDistanceKm || 0.3} km away</div></div>`,
          { direction: 'top', offset: [0, -16] }
        );
      });
    }
  }, [pulses, safeHavens, profiles, filter, intentModeFilter, showJitterCircles, privacySetting, userNeighborhood, selectedItem]);

  return (
    <div ref={mapContainerRef} className="w-full h-full z-0 bg-[#07080b]" />
  );
};
