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

export const PrivacyGeographicMap: React.FC<PrivacyGeographicMapProps> = (props) => {
  const { pulses, safeHavens, profiles = [], userNeighborhood, privacySetting, filter = 'all', intentModeFilter = 'All', showJitterCircles = true, selectedItem, onSelectItem, onMapReady } = props;
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const layerGroupRef = useRef<L.LayerGroup | null>(null);
  const userCenterLat = 51.5132;
  const userCenterLng = -0.1300;
  const profileCoords: Record<string, [number, number]> = {
    prof_marcus: [51.5126, -0.1268], prof_liam: [51.5140, -0.1280], prof_soren: [51.5135, -0.1295],
    prof_mateo: [51.5200, -0.1350], prof_kenji: [51.5255, -0.1248], prof_nico: [51.5130, -0.1310],
    prof_damian: [51.5350, -0.1245], prof_alex: [51.5170, -0.1200],
  };

  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;
    const map = L.map(mapContainerRef.current, { center: [userCenterLat, userCenterLng], zoom: 14, minZoom: 11, maxZoom: 18, zoomControl: false });

    // Free OpenStreetMap tiles. No API key or paid map SDK is required.
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors', maxZoom: 19, maxNativeZoom: 19,
    }).addTo(map);

    const layerGroup = L.layerGroup().addTo(map);
    layerGroupRef.current = layerGroup;
    mapInstanceRef.current = map;
    if (onMapReady) onMapReady({ zoomIn: () => map.zoomIn(), zoomOut: () => map.zoomOut(), recenter: () => map.flyTo([userCenterLat, userCenterLng], 14, { duration: 0.8 }) });
    const invalidate = () => requestAnimationFrame(() => map.invalidateSize({ pan: false }));
    invalidate(); const timer = window.setTimeout(invalidate, 100); const timer2 = window.setTimeout(invalidate, 350);
    let ro: ResizeObserver | null = null;
    if (window.ResizeObserver && mapContainerRef.current) { ro = new ResizeObserver(() => map.invalidateSize()); ro.observe(mapContainerRef.current); }
    return () => { clearTimeout(timer); clearTimeout(timer2); if (ro) ro.disconnect(); map.remove(); mapInstanceRef.current = null; };
  }, []);

  useEffect(() => {
    if (onMapReady && mapInstanceRef.current) { const map = mapInstanceRef.current; onMapReady({ zoomIn: () => map.zoomIn(), zoomOut: () => map.zoomOut(), recenter: () => map.flyTo([userCenterLat, userCenterLng], 14, { duration: 0.8 }) }); }
  }, [onMapReady]);

  useEffect(() => {
    const map = mapInstanceRef.current; const layerGroup = layerGroupRef.current; if (!map || !layerGroup) return;
    layerGroup.clearLayers();
    if (privacySetting !== 'ghost') {
      const userJitterRadius = privacySetting === 'neighborhood' ? 800 : 400;
      if (showJitterCircles) L.circle([userCenterLat, userCenterLng], { radius: userJitterRadius, color: '#38bdf8', weight: 1, dashArray: '4, 4', fillColor: '#0284c7', fillOpacity: 0.07 }).addTo(layerGroup);
      const userIcon = L.divIcon({ className: 'custom-user-marker', html: '<div class="relative flex items-center justify-center"><div class="w-4 h-4 rounded-full bg-cyan-400 border-2 border-[#090a0f] shadow-lg ring-4 ring-cyan-400/20"></div></div>', iconSize: [16, 16], iconAnchor: [8, 8] });
      L.marker([userCenterLat, userCenterLng], { icon: userIcon }).addTo(layerGroup).bindTooltip('You (' + userNeighborhood + ') · ~300m cloaked', { direction: 'top', offset: [0, -6] });
    }
    if (filter === 'all' || filter === 'havens') safeHavens.forEach((haven, idx) => {
      const lat = typeof haven.lat === 'number' && !isNaN(haven.lat) ? haven.lat : 51.5126 + idx * 0.004;
      const lng = typeof haven.lng === 'number' && !isNaN(haven.lng) ? haven.lng : -0.1268 + ((idx % 2 === 0 ? 1 : -1) * 0.003);
      const selected = selectedItem?.type === 'haven' && selectedItem.item.id === haven.id;
      const icon = L.divIcon({ className: 'custom-haven-marker', html: '<div class="w-8 h-8 rounded-xl ' + (selected ? 'bg-emerald-500 text-black scale-125 ring-4 ring-emerald-400/40 shadow-xl' : 'bg-[#10121a] border border-emerald-500/80 text-emerald-400 shadow-lg') + ' flex items-center justify-center">✓</div>', iconSize: [32, 32], iconAnchor: [16, 16] });
      const marker = L.marker([lat, lng], { icon }).addTo(layerGroup); marker.on('click', () => onSelectItem({ type: 'haven', item: haven }));
    });
    if (filter === 'all' || filter === 'people') profiles.forEach((profile, idx) => {
      const isPrivate = profile.intentMode === 'private' || profile.lookingFor === 'casual';
      if (intentModeFilter === 'Social' && isPrivate) return; if (intentModeFilter === 'Private' && !isPrivate) return;
      const coords = profileCoords[profile.id] || [51.5132 + ((idx % 3 - 1) * 0.0035), -0.1300 + (((idx + 1) % 3 - 1) * 0.004)];
      const selected = selectedItem?.type === 'profile' && selectedItem.item.id === profile.id;
      const icon = L.divIcon({ className: 'custom-person-marker', html: '<div class="w-9 h-9 rounded-full border-2 ' + (selected ? 'border-[#C9A24D] ring-4 ring-[#C9A24D]/40' : isPrivate ? 'border-[#6F3CC3]' : 'border-[#C9A24D]') + ' overflow-hidden bg-[#141620]"><img src="' + profile.photoUrl + '" alt="" class="w-full h-full object-cover" /></div>', iconSize: [36, 36], iconAnchor: [18, 18] });
      const marker = L.marker(coords, { icon }).addTo(layerGroup); marker.on('click', () => onSelectItem({ type: 'profile', item: profile }));
    });
    if (filter !== 'havens' && filter !== 'people') pulses.forEach((pulse, idx) => {
      if (filter !== 'all' && pulse.activityCategory !== filter) return;
      const isPrivate = pulse.intentMode === 'private' || pulse.intent?.includes('Hookup');
      if (intentModeFilter === 'Social' && isPrivate) return; if (intentModeFilter === 'Private' && !isPrivate) return;
      const lat = typeof pulse.lat === 'number' && !isNaN(pulse.lat) ? pulse.lat : 51.5132 + ((idx - 2) * 0.004);
      const lng = typeof pulse.lng === 'number' && !isNaN(pulse.lng) ? pulse.lng : -0.1300 + ((idx % 3 - 1) * 0.005);
      const jitter = typeof pulse.jitterMeters === 'number' && !isNaN(pulse.jitterMeters) ? pulse.jitterMeters : 300;
      if (showJitterCircles) L.circle([lat, lng], { radius: jitter, color: isPrivate ? '#6F3CC3' : '#C9A24D', weight: 1, dashArray: '3, 4', fillColor: isPrivate ? '#6F3CC3' : '#C9A24D', fillOpacity: 0.06 }).addTo(layerGroup);
      const selected = selectedItem?.type === 'pulse' && selectedItem.item.id === pulse.id;
      const icon = L.divIcon({ className: 'custom-pulse-marker', html: '<div class="w-8 h-8 rounded-full bg-[#11131a] border-2 ' + (selected ? 'border-[#C9A24D] ring-4 ring-[#C9A24D]/40' : isPrivate ? 'border-purple-400' : 'border-[#C9A24D]') + ' flex items-center justify-center text-xs text-white font-bold">' + (pulse.peerName ? pulse.peerName.charAt(0) : 'P') + '</div>', iconSize: [32, 32], iconAnchor: [16, 16] });
      const marker = L.marker([lat, lng], { icon }).addTo(layerGroup); marker.on('click', () => onSelectItem({ type: 'pulse', item: pulse }));
    });
  }, [pulses, safeHavens, profiles, filter, intentModeFilter, showJitterCircles, privacySetting, userNeighborhood, selectedItem]);

  return (
    <>
      <style>{'.leaflet-tile-pane{filter:invert(0.92) hue-rotate(180deg) brightness(0.72) saturate(0.7)}.leaflet-control-attribution{margin-bottom:4.5rem!important;margin-right:.5rem!important;padding:2px 6px!important;border-radius:6px!important;background:rgba(7,8,11,.78)!important;color:rgba(255,255,255,.65)!important;font-size:9px!important;line-height:14px!important}.leaflet-control-attribution a{color:rgba(255,255,255,.78)!important}'}</style>
      <div ref={mapContainerRef} className="w-full h-full z-0 bg-[#07080b]" />
    </>
  );
};