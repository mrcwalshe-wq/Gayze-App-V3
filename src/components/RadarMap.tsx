import React, { useState } from 'react';
import { Pulse, SafeHaven } from '../types';
import { Shield, Radio, MapPin, Coffee, Wine, Footprints, Dumbbell, Palette, Sparkles, Navigation, Lock } from 'lucide-react';

interface RadarMapProps {
  pulses: Pulse[];
  safeHavens: SafeHaven[];
  userNeighborhood: string;
  selectedId?: string | null;
  onSelectPulse: (pulse: Pulse) => void;
  onSelectHaven: (haven: SafeHaven) => void;
}

export const RadarMap: React.FC<RadarMapProps> = ({
  pulses,
  safeHavens,
  userNeighborhood,
  selectedId,
  onSelectPulse,
  onSelectHaven,
}) => {
  const [activeItem, setActiveItem] = useState<{ type: 'pulse' | 'haven'; id: string } | null>(null);

  const pulseCoords: Record<string, { x: number; y: number }> = {
    pulse_1: { x: 54, y: 46 },
    pulse_2: { x: 28, y: 72 },
    pulse_3: { x: 62, y: 22 },
    pulse_4: { x: 48, y: 52 },
    pulse_5: { x: 58, y: 32 },
  };

  const havenCoords: Record<string, { x: number; y: number }> = {
    sh_1: { x: 64, y: 35 },
    sh_2: { x: 53, y: 48 },
    sh_3: { x: 63, y: 20 },
    sh_4: { x: 47, y: 54 },
    sh_5: { x: 42, y: 38 },
  };

  return (
    <div className="relative w-full h-full bg-[#07080b] overflow-hidden select-none">
      {/* Background Grid & Radar Rings */}
      <div className="absolute inset-0 bg-[radial-gradient(rgba(255,255,255,0.08)_1px,transparent_1px)] [background-size:24px_24px] opacity-40" />

      {/* Concentric distance rings from user center */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[150px] h-[150px] rounded-full border border-white/10 pointer-events-none" />
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[270px] h-[270px] rounded-full border border-white/[0.07] pointer-events-none" />
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[370px] h-[370px] rounded-full border border-white/[0.05] pointer-events-none" />

      {/* Compass / Axis lines */}
      <div className="absolute left-1/2 top-0 bottom-0 w-[1px] bg-white/[0.06] -translate-x-1/2 pointer-events-none" />
      <div className="absolute top-1/2 left-0 right-0 h-[1px] bg-white/[0.06] -translate-y-1/2 pointer-events-none" />

      {/* Top Left info overlay */}
      <div className="absolute top-2.5 left-2.5 z-10 flex flex-col gap-0.5 text-[11px] text-zinc-300 bg-[#11131a]/95 backdrop-blur-md px-3 py-1.5 rounded-xl border border-white/10 shadow-sm">
        <div className="flex items-center gap-1.5 text-zinc-200 font-semibold">
          <span className="w-1.5 h-1.5 rounded-full bg-[#C9A24D]" />
          <span>Proximity Radar</span>
        </div>
        <div className="text-zinc-400 text-[10px]">Center: {userNeighborhood} (~300m cloaked)</div>
      </div>

      {/* Top Right Legend */}
      <div className="absolute top-2.5 right-2.5 z-10 flex items-center gap-2.5 text-[11px] bg-[#11131a]/95 backdrop-blur-md px-3 py-1.5 rounded-xl border border-white/10 text-zinc-400 shadow-sm">
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-[#C9A24D]" />
          <span className="text-zinc-300">Pulse</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-sm bg-emerald-400" />
          <span className="text-zinc-300">Safe Haven</span>
        </div>
      </div>

      {/* Center user marker */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-20 flex flex-col items-center pointer-events-none">
        <div className="w-3.5 h-3.5 rounded-full bg-[#C9A24D] border-2 border-[#0a0b10] shadow-md ring-2 ring-[#C9A24D]/20" />
        <span className="mt-1 text-[10px] text-zinc-200 bg-[#11131a] px-2 py-0.5 rounded-md border border-white/10 font-mono">
          You
        </span>
      </div>

      {/* Safe Havens plotted on map */}
      {safeHavens.map((haven) => {
        const coord = havenCoords[haven.id] || { x: 50, y: 50 };
        const isSelected = (selectedId && selectedId === haven.id) || (activeItem?.type === 'haven' && activeItem.id === haven.id);
        return (
          <div
            key={haven.id}
            style={{ left: `${coord.x}%`, top: `${coord.y}%` }}
            onClick={() => {
              setActiveItem({ type: 'haven', id: haven.id });
              onSelectHaven(haven);
            }}
            className="absolute -translate-x-1/2 -translate-y-1/2 z-20 cursor-pointer group"
          >
            <div
              className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all ${
                isSelected
                  ? 'bg-emerald-500 text-black scale-110 shadow-md'
                  : 'bg-[#11131a] border border-emerald-500/60 text-emerald-400 hover:scale-110 shadow-sm'
              }`}
            >
              <Shield className="w-3.5 h-3.5" />
            </div>
            <div className="hidden group-hover:block absolute left-1/2 bottom-full mb-1.5 -translate-x-1/2 whitespace-nowrap z-30 bg-[#11131a] text-white text-[11px] font-medium px-2.5 py-1.5 rounded-xl shadow-xl border border-white/10">
              <span className="text-emerald-400 font-semibold">{haven.name}</span>
              <span className="text-zinc-400 block text-[10px]">{haven.neighborhood} · Score {haven.safetyScore}</span>
            </div>
          </div>
        );
      })}

      {/* Live Pulses plotted on map */}
      {pulses.map((pulse) => {
        const coord = pulseCoords[pulse.id] || { x: 50 + (Math.random() * 20 - 10), y: 50 + (Math.random() * 20 - 10) };
        const isSelected = (selectedId && selectedId === pulse.id) || (activeItem?.type === 'pulse' && activeItem.id === pulse.id);
        return (
          <div
            key={pulse.id}
            style={{ left: `${coord.x}%`, top: `${coord.y}%` }}
            onClick={() => {
              setActiveItem({ type: 'pulse', id: pulse.id });
              onSelectPulse(pulse);
            }}
            className="absolute -translate-x-1/2 -translate-y-1/2 z-20 cursor-pointer group"
          >
            <div
              className={`w-7 h-7 rounded-full flex items-center justify-center transition-all ${
                isSelected
                  ? 'bg-[#C9A24D] text-black scale-110 shadow-md'
                  : 'bg-[#11131a] border border-[#C9A24D]/60 text-[#C9A24D] hover:scale-110 shadow-sm'
              }`}
            >
              {pulse.activityCategory === 'coffee' && <Coffee className="w-3.5 h-3.5" />}
              {pulse.activityCategory === 'drinks' && <Wine className="w-3.5 h-3.5" />}
              {pulse.activityCategory === 'walk' && <Footprints className="w-3.5 h-3.5" />}
              {pulse.activityCategory === 'active' && <Dumbbell className="w-3.5 h-3.5" />}
              {pulse.activityCategory === 'culture' && <Palette className="w-3.5 h-3.5" />}
              {pulse.activityCategory === 'chill' && <Sparkles className="w-3.5 h-3.5" />}
            </div>

            {/* Hover tooltip */}
            <div className="hidden group-hover:block absolute left-1/2 bottom-full mb-2 -translate-x-1/2 whitespace-nowrap z-30 bg-[#11131a] text-white text-[11px] font-medium px-2.5 py-1.5 rounded-xl shadow-xl border border-white/10">
              <div className="font-semibold text-[#C9A24D]">{pulse.peerName}</div>
              <div className="text-zinc-300 text-[10px] truncate max-w-[200px]">{pulse.title}</div>
              <div className="text-zinc-400 text-[10px] mt-0.5 font-mono">~{pulse.approxDistanceKm} km away · ~{pulse.jitterMeters}m blur</div>
            </div>
          </div>
        );
      })}

      {/* Bottom Range Indicators */}
      <div className="absolute bottom-2.5 left-2.5 z-10 flex items-center gap-2 text-[10px] text-zinc-400 bg-[#11131a]/95 backdrop-blur-md px-3 py-1 rounded-xl border border-white/10 font-mono shadow-sm">
        <span>Range: 1.5km</span>
        <span>·</span>
        <span className="text-emerald-400 flex items-center gap-1">
          <Lock className="w-2.5 h-2.5" /> No GPS logs
        </span>
      </div>
    </div>
  );
};
