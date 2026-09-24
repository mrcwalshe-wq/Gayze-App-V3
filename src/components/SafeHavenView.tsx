import React, { useState } from 'react';
import { SafeHaven } from '../types';
import { Shield, ShieldCheck, MapPin, Phone, Clock, Sparkles, CheckCircle2, ArrowRight } from 'lucide-react';

interface SafeHavenViewProps {
  safeHavens: SafeHaven[];
  onSelectVenueForPulse: (haven: SafeHaven) => void;
  onStartSafeCheckinWithVenue: (haven: SafeHaven) => void;
}

export const SafeHavenView: React.FC<SafeHavenViewProps> = ({
  safeHavens,
  onSelectVenueForPulse,
  onStartSafeCheckinWithVenue,
}) => {
  const [filterType, setFilterType] = useState<string>('all');

  const filteredHavens = safeHavens.filter((h) => {
    if (filterType === 'all') return true;
    return h.type === filterType;
  });

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-white/[0.08]">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            <h1 className="text-lg sm:text-xl font-bold tracking-tight text-white font-sans">
              Verified Queer Safe Havens
            </h1>
          </div>
          <p className="text-xs text-zinc-400 mt-0.5">
            Community-vetted venues with trained staff, emergency support, and safe meetup spaces
          </p>
        </div>

        {/* Filter Pills with horizontal scroll on mobile */}
        <div className="flex items-center gap-1 p-1 bg-[#11131a] rounded-xl border border-white/[0.07] overflow-x-auto no-scrollbar self-start sm:self-auto max-w-full">
          {[
            { id: 'all', label: 'All Havens' },
            { id: 'cafe', label: 'Cafes' },
            { id: 'bookstore', label: 'Bookstores' },
            { id: 'community_center', label: 'Centres' },
            { id: 'queer_bar', label: 'Bars' },
          ].map((item) => (
            <button
              key={item.id}
              onClick={() => setFilterType(item.id)}
              className={`h-8 px-3 text-xs font-medium rounded-lg whitespace-nowrap transition-colors cursor-pointer ${
                filterType === item.id
                  ? 'bg-[#1c1f2b] text-white font-semibold border border-white/10 shadow-sm'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {/* Safety Protocol Banner */}
      <div className="p-3.5 sm:p-4 rounded-2xl bg-[#11131a] border border-white/[0.08] flex flex-col md:flex-row md:items-center justify-between gap-3 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0">
            <ShieldCheck className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-xs sm:text-sm font-semibold text-white">The Safe Haven Standards</h3>
            <p className="text-xs text-zinc-400 mt-0.5 max-w-2xl leading-relaxed">
              Every haven commits to discreet assistance if you feel uncomfortable on a date, phone charging if stranded, zero harassment tolerance, and staff trained in de-escalation.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-emerald-400 bg-emerald-950/40 px-2.5 py-1 rounded-xl border border-emerald-500/30 font-mono">
            {safeHavens.length} Verified Spots Nearby
          </span>
        </div>
      </div>

      {/* Grid of Safe Havens */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
        {filteredHavens.map((haven) => (
          <div
            key={haven.id}
            className="bg-[#11131a] hover:bg-[#141620] border border-white/[0.08] hover:border-[#C9A24D]/40 rounded-2xl p-4 sm:p-5 transition-all flex flex-col justify-between shadow-sm"
          >
            <div>
              {/* Header */}
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm sm:text-base font-bold text-white">{haven.name}</h3>
                    <ShieldCheck className="w-4 h-4 text-emerald-400 inline" />
                  </div>
                  <div className="flex items-center gap-2 text-xs text-zinc-400 mt-1">
                    <MapPin className="w-3.5 h-3.5 text-[#C9A24D] shrink-0" />
                    <span>{haven.address}</span>
                    <span aria-hidden="true">·</span>
                    <span className="text-zinc-300">{haven.neighborhood}</span>
                  </div>
                </div>

                <div className="flex flex-col items-end">
                  <div className="flex items-center gap-1 text-xs text-emerald-300 bg-emerald-950/40 px-2 py-0.5 rounded-lg border border-emerald-500/30 font-mono font-semibold">
                    <span>★ {haven.safetyScore}</span>
                  </div>
                  <span className="text-[10px] text-zinc-500 font-mono mt-0.5">~{haven.approxDistanceKm} km</span>
                </div>
              </div>

              {/* Verified Features */}
              <div className="mt-3 space-y-1">
                <div className="text-[11px] text-zinc-400 font-medium">Verified Safety Amenities:</div>
                <div className="grid grid-cols-2 gap-1.5 text-xs text-zinc-300">
                  {haven.features.map((feature, idx) => (
                    <div key={idx} className="flex items-center gap-1.5 text-zinc-300">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      <span className="text-[11px] truncate">{feature}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Hours & Contact */}
              <div className="mt-3 pt-2.5 border-t border-white/[0.07] flex items-center justify-between text-xs text-zinc-400">
                <div className="flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-zinc-500" />
                  <span>{haven.openHours}</span>
                </div>

                {haven.emergencyPhone && (
                  <div className="flex items-center gap-1.5 text-zinc-400 font-mono text-[11px]">
                    <Phone className="w-3 h-3 text-zinc-500" />
                    <span>{haven.emergencyPhone}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Actions */}
            <div className="mt-4 pt-3 border-t border-white/[0.07] flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2">
              <button
                onClick={() => onStartSafeCheckinWithVenue(haven)}
                className="h-11 min-h-[44px] px-4 text-xs font-medium text-zinc-300 hover:text-white bg-[#1c1f2b] hover:bg-[#252838] rounded-xl border border-white/10 transition-colors cursor-pointer flex items-center justify-center"
              >
                Set Safety Beacon Here
              </button>

              <button
                onClick={() => onSelectVenueForPulse(haven)}
                className="h-11 min-h-[44px] flex items-center justify-center gap-1.5 px-4 text-xs font-semibold text-black bg-[#C9A24D] hover:bg-[#b58f3b] rounded-xl transition-colors cursor-pointer shadow-sm"
              >
                <span>Broadcast Pulse Here</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
