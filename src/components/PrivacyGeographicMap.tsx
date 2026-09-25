import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { Pulse, SafeHaven, LocationPrivacy, DatingProfile } from '../types';
import { 
  Shield, 
  ShieldCheck, 
  Lock, 
  Radio, 
  MapPin, 
  Coffee, 
  Wine, 
  Footprints, 
  Dumbbell, 
  Palette, 
  Sparkles, 
  Compass, 
  Clock,
  ArrowRight,
  X,
  Eye,
  Calendar,
  Flame,
  User,
  CheckCircle2
} from 'lucide-react';
import { hapticLight, triggerVibration } from '../services/hapticService';

interface PrivacyGeographicMapProps {
  pulses: Pulse[];
  safeHavens: SafeHaven[];
  profiles?: DatingProfile[];
  userNeighborhood: string;
  privacySetting: LocationPrivacy;
  onOpenDirectChat: (pulse: Pulse) => void;
  onOpenDirectChatWithProfile?: (profile: DatingProfile) => void;
  onSelectHaven: (haven: SafeHaven) => void;
  onBroadcastHere: (venueName: string) => void;
  onGazeAtPeer?: (peerName: string) => void;
  onOpenScheduleMeeting?: (peerName: string) => void;
  onViewProfileDetail?: (profile: DatingProfile) => void;
}

export const PrivacyGeographicMap: React.FC<PrivacyGeographicMapProps> = ({
  pulses,
  safeHavens,
  profiles = [],
  userNeighborhood,
  privacySetting,
  onOpenDirectChat,
  onOpenDirectChatWithProfile,
  onSelectHaven,
  onBroadcastHere,
  onGazeAtPeer,
  onOpenScheduleMeeting,
  onViewProfileDetail,
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const layerGroupRef = useRef<L.LayerGroup | null>(null);

  const [selectedItem, setSelectedItem] = useState<
    | { type: 'pulse'; item: Pulse }
    | { type: 'haven'; item: SafeHaven }
    | { type: 'profile'; item: DatingProfile }
    | null
  >(null);
  const [filter, setFilter] = useState<'all' | 'people' | 'coffee' | 'drinks' | 'active' | 'havens'>('all');
  const [showJitterCircles, setShowJitterCircles] = useState(true);
  const [gazedPeerNames, setGazedPeerNames] = useState<Set<string>>(new Set());

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

    L.control.zoom({ position: 'topright' }).addTo(map);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; OpenStreetMap &copy; CARTO',
      subdomains: 'abcd',
      maxZoom: 19,
    }).addTo(map);

    const layerGroup = L.layerGroup().addTo(map);
    layerGroupRef.current = layerGroup;
    mapInstanceRef.current = map;

    return () => {
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

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
            <div class="w-4 h-4 rounded-full bg-cyan-400 border-2 border-[#090a0f] shadow-md"></div>
          </div>
        `,
        iconSize: [16, 16],
        iconAnchor: [8, 8],
      });

      L.marker([userCenterLat, userCenterLng], { icon: userIcon })
        .addTo(layerGroup)
        .bindTooltip(`<div class="text-[11px] font-sans font-medium text-cyan-300">You (${userNeighborhood})</div>`, {
          direction: 'top',
          offset: [0, -6],
          className: 'bg-zinc-900 text-cyan-300 border border-zinc-700 px-2 py-1 rounded shadow',
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

        const havenIcon = L.divIcon({
          className: 'custom-haven-marker',
          html: `
            <div class="w-7 h-7 rounded-lg bg-zinc-900 border border-emerald-500 text-emerald-400 flex items-center justify-center shadow-md hover:scale-110 transition-transform cursor-pointer">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/></svg>
            </div>
          `,
          iconSize: [28, 28],
          iconAnchor: [14, 14],
        });

        const marker = L.marker([havenLat, havenLng], { icon: havenIcon }).addTo(layerGroup);
        marker.on('click', () => {
          setSelectedItem({ type: 'haven', item: haven });
        });

        marker.bindTooltip(
          `<div class="text-[11px] font-sans font-semibold text-emerald-400">${haven.name}<div class="text-[10px] text-zinc-400 font-normal">★ ${haven.safetyScore} Safe Haven</div></div>`,
          { direction: 'top', offset: [0, -14] }
        );
      });
    }

    // 3. Nearby People Markers
    if (filter === 'all' || filter === 'people') {
      profiles.forEach((profile, idx) => {
        const coords = profileCoords[profile.id] || [
          51.5132 + ((idx % 3 - 1) * 0.0035),
          -0.1300 + (((idx + 1) % 3 - 1) * 0.004),
        ];

        const isPrivate = profile.intentMode === 'private' || profile.lookingFor === 'casual';
        const personIcon = L.divIcon({
          className: 'custom-person-marker',
          html: `
            <div class="relative cursor-pointer group">
              <div class="w-8 h-8 rounded-full border-2 ${
                isPrivate ? 'border-purple-500 shadow-purple-950/60' : 'border-[#C9A24D] shadow-amber-950/50'
              } overflow-hidden shadow-lg bg-[#141620] hover:scale-110 transition-transform">
                <img src="${profile.photoUrl}" alt="${profile.name}" class="w-full h-full object-cover" onerror="this.src='/src/assets/images/dating_profile_marcus_1790154961749.jpg'" />
              </div>
              <div class="absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full ${
                isPrivate ? 'bg-purple-600' : 'bg-[#C9A24D]'
              } border border-black flex items-center justify-center text-[8px] text-white font-bold">
                ●
              </div>
            </div>
          `,
          iconSize: [32, 32],
          iconAnchor: [16, 16],
        });

        const marker = L.marker(coords, { icon: personIcon }).addTo(layerGroup);
        marker.on('click', () => {
          setSelectedItem({ type: 'profile', item: profile });
        });

        marker.bindTooltip(
          `<div class="text-[11px] font-sans font-semibold text-white">${profile.name}, ${profile.age}<div class="text-[10px] text-[#C9A24D]">${profile.headline}</div></div>`,
          { direction: 'top', offset: [0, -16] }
        );
      });
    }

    // 4. Pulses Markers
    if (filter !== 'havens' && filter !== 'people') {
      pulses.forEach((pulse, idx) => {
        if (filter !== 'all' && pulse.activityCategory !== filter) return;

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
            color: '#f59e0b',
            weight: 1,
            dashArray: '3, 4',
            fillColor: '#d97706',
            fillOpacity: 0.06,
          }).addTo(layerGroup);
        }

        const pulseIcon = L.divIcon({
          className: 'custom-pulse-marker',
          html: `
            <div class="relative cursor-pointer">
              <div class="w-7 h-7 rounded-full bg-zinc-900 border border-amber-400 text-amber-400 flex items-center justify-center shadow-md hover:scale-110 transition-transform">
                <span class="text-xs font-bold font-sans">${pulse.peerName ? pulse.peerName.charAt(0) : 'P'}</span>
              </div>
            </div>
          `,
          iconSize: [28, 28],
          iconAnchor: [14, 14],
        });

        const marker = L.marker([pulseLat, pulseLng], { icon: pulseIcon }).addTo(layerGroup);
        marker.on('click', () => {
          setSelectedItem({ type: 'pulse', item: pulse });
        });

        marker.bindTooltip(
          `<div class="text-[11px] font-sans font-semibold text-white">${pulse.peerName}<div class="text-[10px] text-amber-300">${pulse.title}</div><div class="text-[9px] text-zinc-400">~${pulse.approxDistanceKm || 0.4}km away</div></div>`,
          { direction: 'top', offset: [0, -14] }
        );
      });
    }
  }, [pulses, safeHavens, profiles, filter, showJitterCircles, privacySetting, userNeighborhood]);

  const handleRecenter = () => {
    mapInstanceRef.current?.flyTo([userCenterLat, userCenterLng], 14, { duration: 1 });
  };

  const handleGazeAtPerson = (name: string) => {
    triggerVibration([40, 80]);
    setGazedPeerNames((prev) => new Set(prev).add(name));
    if (onGazeAtPeer) onGazeAtPeer(name);
  };

  return (
    <div className="relative w-full h-[380px] sm:h-[480px] lg:h-[560px] bg-[#0a0b10] rounded-2xl border border-white/[0.08] overflow-hidden flex flex-col shadow-lg">
      {/* Top Floating Controls Bar */}
      <div className="absolute top-2.5 left-2.5 right-2.5 z-[400] flex flex-col sm:flex-row sm:items-center justify-between gap-2 pointer-events-none">
        
        {/* Left: Discreet Privacy Status */}
        <div className="pointer-events-auto self-start flex items-center gap-2 px-3 py-1.5 bg-[#11131a]/95 backdrop-blur-md rounded-xl border border-white/10 text-xs shadow-md">
          <div className="flex items-center gap-1.5 text-zinc-200 font-medium">
            <MapPin className="w-3.5 h-3.5 text-[#C9A24D]" />
            <span>{userNeighborhood}</span>
          </div>
          <span className="text-zinc-600">·</span>
          <span className="text-[11px] text-zinc-400">~300m privacy area</span>
        </div>

        {/* Right Controls: Filter Buttons & Tools */}
        <div className="pointer-events-auto flex items-center gap-1 bg-[#11131a]/95 backdrop-blur-md p-1 rounded-xl border border-white/10 shadow-md overflow-x-auto max-w-full">
          <button
            onClick={() => setFilter('all')}
            className={`h-8 px-2.5 text-xs font-medium rounded-lg transition-colors cursor-pointer whitespace-nowrap ${
              filter === 'all' ? 'bg-[#1c1f2b] text-white font-semibold border border-white/10' : 'text-zinc-400 hover:text-white'
            }`}
          >
            All
          </button>
          <button
            onClick={() => setFilter('people')}
            className={`h-8 px-2.5 text-xs font-medium rounded-lg transition-colors cursor-pointer whitespace-nowrap ${
              filter === 'people' ? 'bg-[#1c1f2b] text-white font-semibold border border-white/10' : 'text-zinc-400 hover:text-white'
            }`}
          >
            People
          </button>
          <button
            onClick={() => setFilter('coffee')}
            className={`h-8 px-2.5 text-xs font-medium rounded-lg transition-colors cursor-pointer whitespace-nowrap ${
              filter === 'coffee' ? 'bg-[#1c1f2b] text-white font-semibold border border-white/10' : 'text-zinc-400 hover:text-white'
            }`}
          >
            Coffee
          </button>
          <button
            onClick={() => setFilter('drinks')}
            className={`h-8 px-2.5 text-xs font-medium rounded-lg transition-colors cursor-pointer whitespace-nowrap ${
              filter === 'drinks' ? 'bg-[#1c1f2b] text-white font-semibold border border-white/10' : 'text-zinc-400 hover:text-white'
            }`}
          >
            Drinks
          </button>
          <button
            onClick={() => setFilter('havens')}
            className={`h-8 flex items-center gap-1 px-2.5 text-xs font-medium rounded-lg transition-colors cursor-pointer whitespace-nowrap ${
              filter === 'havens' ? 'bg-emerald-500/20 text-emerald-300 font-semibold border border-emerald-500/40' : 'text-emerald-400 hover:text-white'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Havens</span>
          </button>

          <div className="w-[1px] h-4 bg-white/10 mx-1 shrink-0" />

          {/* Toggle Jitter Circles */}
          <button
            onClick={() => setShowJitterCircles(!showJitterCircles)}
            title="Toggle Privacy Area Circles"
            aria-label="Toggle Privacy Area"
            className={`w-8 h-8 rounded-lg text-xs transition-colors flex items-center justify-center cursor-pointer ${
              showJitterCircles ? 'text-[#C9A24D] bg-[#1c1f2b] border border-white/10' : 'text-zinc-400 hover:text-white'
            }`}
          >
            <Radio className="w-3.5 h-3.5" />
          </button>

          {/* Recenter button */}
          <button
            onClick={handleRecenter}
            title="Recenter map"
            aria-label="Recenter map"
            className="w-8 h-8 text-zinc-400 hover:text-white rounded-lg hover:bg-white/[0.06] transition-colors flex items-center justify-center cursor-pointer"
          >
            <Compass className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Leaflet Map DOM Node */}
      <div ref={mapContainerRef} className="w-full h-full z-0" />

      {/* Bottom Floating Legend (Compact) */}
      <div className="hidden sm:flex absolute bottom-2.5 left-2.5 z-[400] items-center gap-3 bg-[#11131a]/95 backdrop-blur-md px-3 py-1.5 rounded-xl border border-white/10 text-[11px] text-zinc-400 shadow-md">
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-[#C9A24D]" />
          <span className="text-zinc-300">People</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-sm bg-emerald-400" />
          <span className="text-zinc-300">Safe Haven</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-cyan-400" />
          <span className="text-zinc-300">You</span>
        </div>
      </div>

      {/* Selected Item Sliding Detail Sheet (Mobile Docked Bottom Card) */}
      {selectedItem && (
        <div className="absolute bottom-2.5 left-2.5 right-2.5 sm:left-auto sm:right-2.5 sm:max-w-md z-[400] bg-[#11131a]/95 backdrop-blur-md border border-white/10 rounded-2xl p-4 shadow-2xl animate-in fade-in">
          {selectedItem.type === 'profile' ? (
            /* Selected Nearby Person Details */
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-10 h-10 rounded-xl overflow-hidden border border-white/20 bg-[#171922] shrink-0">
                    <img src={selectedItem.item.photoUrl} alt={selectedItem.item.name} className="w-full h-full object-cover" />
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-bold text-white">
                        {selectedItem.item.name}, {selectedItem.item.age}
                      </span>
                      <span className="text-[10px] px-1.5 py-0.2 rounded font-bold uppercase bg-[#C9A24D]/20 text-[#C9A24D] border border-[#C9A24D]/30">
                        {selectedItem.item.lookingForLabel}
                      </span>
                    </div>
                    <div className="text-[11px] text-zinc-400 flex items-center gap-1.5">
                      <span>{selectedItem.item.neighborhood}</span>
                      <span>·</span>
                      <span>~{selectedItem.item.approxDistanceKm} km</span>
                      <span>·</span>
                      <span className="text-emerald-400 font-mono">Trust {selectedItem.item.reliabilityScore || 96}</span>
                    </div>
                  </div>
                </div>

                <button
                  onClick={() => setSelectedItem(null)}
                  className="w-10 h-10 min-h-[44px] min-w-[44px] flex items-center justify-center text-zinc-400 hover:text-white rounded-xl hover:bg-white/[0.06] cursor-pointer shrink-0"
                  aria-label="Close details"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <p className="text-xs text-zinc-300 leading-relaxed italic">
                "{selectedItem.item.headline}"
              </p>

              {/* Action Buttons: Gaze (👀), Message, Plan Meeting, Profile */}
              <div className="pt-2 grid grid-cols-3 gap-2">
                <button
                  onClick={() => handleGazeAtPerson(selectedItem.item.name)}
                  className={`h-11 min-h-[44px] rounded-xl flex items-center justify-center gap-1.5 text-xs font-bold transition-all cursor-pointer ${
                    gazedPeerNames.has(selectedItem.item.name)
                      ? 'bg-purple-950 text-purple-300 border border-purple-500/60'
                      : 'bg-[#1c1f2b] hover:bg-[#252838] text-white border border-white/10 active:scale-95'
                  }`}
                >
                  <Eye className="w-3.5 h-3.5 text-[#C9A24D]" />
                  <span>{gazedPeerNames.has(selectedItem.item.name) ? 'Gazed' : 'Gaze 👀'}</span>
                </button>

                {onOpenScheduleMeeting && (
                  <button
                    onClick={() => {
                      const name = selectedItem.item.name;
                      setSelectedItem(null);
                      onOpenScheduleMeeting(name);
                    }}
                    className="h-11 min-h-[44px] rounded-xl bg-[#1c1f2b] hover:bg-[#252838] text-[#C9A24D] border border-[#C9A24D]/30 font-bold text-xs flex items-center justify-center gap-1 cursor-pointer transition-colors active:scale-95"
                  >
                    <Calendar className="w-3.5 h-3.5" />
                    <span>Meet</span>
                  </button>
                )}

                <button
                  onClick={() => {
                    if (onOpenDirectChatWithProfile) {
                      onOpenDirectChatWithProfile(selectedItem.item);
                      setSelectedItem(null);
                    }
                  }}
                  className="h-11 min-h-[44px] rounded-xl bg-[#C9A24D] hover:bg-[#b58f3b] text-black font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer shadow transition-all active:scale-95"
                >
                  <Lock className="w-3 h-3" />
                  <span>Chat</span>
                </button>
              </div>
            </div>
          ) : selectedItem.type === 'pulse' ? (
            /* Selected Pulse Details */
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-lg bg-[#171922] border border-white/10 flex items-center justify-center text-sm font-semibold text-[#C9A24D]">
                    {selectedItem.item.peerName.charAt(0)}
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-bold text-white">{selectedItem.item.peerName}</span>
                    </div>
                    <div className="text-[11px] text-zinc-400 flex items-center gap-1.5">
                      <span>{selectedItem.item.neighborhood}</span>
                      <span aria-hidden="true">·</span>
                      <span>~{selectedItem.item.approxDistanceKm} km</span>
                    </div>
                  </div>
                </div>

                <button
                  onClick={() => setSelectedItem(null)}
                  className="w-10 h-10 min-h-[44px] min-w-[44px] flex items-center justify-center text-zinc-400 hover:text-white rounded-xl hover:bg-white/[0.06] cursor-pointer shrink-0"
                  aria-label="Close details"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div>
                <h4 className="text-sm font-semibold text-white">{selectedItem.item.title}</h4>
                <p className="text-xs text-zinc-300 mt-1 leading-relaxed">{selectedItem.item.description}</p>
              </div>

              <div className="pt-2 border-t border-white/[0.07] flex items-center justify-between text-xs">
                <div className="flex items-center gap-1.5 text-zinc-300">
                  <MapPin className="w-3.5 h-3.5 text-[#C9A24D] shrink-0" />
                  <span className="truncate max-w-[200px]">{selectedItem.item.venueName}</span>
                </div>

                <div className="flex items-center gap-1 text-[11px] text-zinc-300 bg-[#171922] px-2 py-0.5 rounded-md border border-white/10 font-mono">
                  <Clock className="w-3 h-3 text-[#C9A24D]" />
                  <span>{selectedItem.item.durationHours}h left</span>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="pt-2 flex items-center gap-2">
                <button
                  onClick={() => handleGazeAtPerson(selectedItem.item.peerName)}
                  className="h-11 min-h-[44px] px-3 text-xs font-bold text-white bg-[#1c1f2b] hover:bg-[#252838] rounded-xl transition-colors border border-white/10 cursor-pointer flex items-center justify-center gap-1.5"
                >
                  <Eye className="w-3.5 h-3.5 text-[#C9A24D]" />
                  <span>Gaze 👀</span>
                </button>

                <button
                  onClick={() => onBroadcastHere(selectedItem.item.venueName)}
                  className="h-11 min-h-[44px] px-3 text-xs font-medium text-zinc-300 hover:text-white bg-[#1c1f2b] hover:bg-[#252838] rounded-xl transition-colors border border-white/10 cursor-pointer flex items-center justify-center"
                >
                  Meet Nearby
                </button>

                <button
                  onClick={() => onOpenDirectChat(selectedItem.item)}
                  className="flex-1 h-11 min-h-[44px] flex items-center justify-center gap-1.5 px-3 text-xs font-semibold text-black bg-[#C9A24D] hover:bg-[#b58f3b] rounded-xl transition-colors cursor-pointer shadow-sm"
                >
                  <Lock className="w-3.5 h-3.5" />
                  <span>Connect & Chat</span>
                </button>
              </div>
            </div>
          ) : (
            /* Selected Safe Haven Details */
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h4 className="text-sm sm:text-base font-bold text-white">{selectedItem.item.name}</h4>
                    <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                  </div>
                  <div className="text-xs text-zinc-400 mt-0.5">
                    {selectedItem.item.address} · {selectedItem.item.neighborhood}
                  </div>
                </div>

                <button
                  onClick={() => setSelectedItem(null)}
                  className="w-10 h-10 min-h-[44px] min-w-[44px] flex items-center justify-center text-zinc-400 hover:text-white rounded-xl hover:bg-white/[0.06] cursor-pointer shrink-0"
                  aria-label="Close details"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="flex items-center gap-2 text-xs">
                <span className="font-mono text-emerald-400 bg-emerald-950/40 px-2 py-0.5 rounded-md border border-emerald-500/30">
                  ★ {selectedItem.item.safetyScore} Safety Score
                </span>
                <span className="text-zinc-400">{selectedItem.item.openHours}</span>
              </div>

              <div className="pt-2 flex items-center justify-between gap-2">
                <button
                  onClick={() => onSelectHaven(selectedItem.item)}
                  className="h-11 min-h-[44px] px-3.5 text-xs font-medium text-zinc-300 hover:text-white bg-[#1c1f2b] hover:bg-[#252838] rounded-xl transition-colors border border-white/10 cursor-pointer flex items-center justify-center"
                >
                  View Details
                </button>

                <button
                  onClick={() => onBroadcastHere(selectedItem.item.name)}
                  className="flex-1 h-11 min-h-[44px] flex items-center justify-center gap-1.5 px-4 text-xs font-semibold text-black bg-[#C9A24D] hover:bg-[#b58f3b] rounded-xl transition-colors cursor-pointer shadow-sm"
                >
                  <Radio className="w-3.5 h-3.5" />
                  <span>Meetup Here</span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

