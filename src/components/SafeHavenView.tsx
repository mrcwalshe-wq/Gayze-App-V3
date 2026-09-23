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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-zinc-800/80">
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
        <div className="flex items-center gap-1 p-1 bg-zinc-900 rounded-xl border border-zinc-800 overflow-x-auto no-scrollbar self-start sm:self-auto max-w-full">
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
              className={`min-h-[32px] px-3 py-1 text-xs font-medium rounded-lg whitespace-nowrap transition-colors cursor-pointer ${
                filterType === item.id
                  ? 'bg-zinc-800 text-white font-semibold'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {/* Safety Protocol Banner */}
      <div className="p-3.5 sm:p-4 rounded-2xl bg-zinc-900/60 border border-zinc-800 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-emerald-950/40 border border-emerald-800/40 flex items-center justify-center text-emerald-400 shrink-0">
            <ShieldCheck className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-xs sm:text-sm font-semibold text-white">The Safe Haven Standards</h3>
            <p className="text-xs text-zinc-400 mt-0.5 max-w-2xl leading-relaxed">
              Every haven commits to: discreet assistance if you feel uncomfortable on a date, phone charging if stranded, zero harassment tolerance, and staff trained in de-escalation.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-emerald-400 bg-emerald-950/30 px-2.5 py-1 rounded-lg border border-emerald-800/40 font-mono">
            {safeHavens.length} Verified Spots Nearby
          </span>
        </div>
      </div>

      {/* Grid of Safe Havens */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
        {filteredHavens.map((haven) => (
          <div
            key={haven.id}
            className="bg-zinc-900/60 hover:bg-zinc-900 border border-zinc-800 hover:border-zinc-700 rounded-2xl p-4 sm:p-5 transition-all flex flex-col justify-between"
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
                    <MapPin className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                    <span>{haven.address}</span>
                    <span aria-hidden="true">·</span>
                    <span className="text-zinc-300">{haven.neighborhood}</span>
                  </div>
                </div>

                <div className="flex flex-col items-end">
                  <div className="flex items-center gap-1 text-xs text-emerald-300 bg-emerald-950/30 px-2 py-0.5 rounded-lg border border-emerald-800/40 font-mono">
                    <span>★ {haven.safetyScore}</span>
                  </div>
                  <span className="text-[10px] text-zinc-500 mt-0.5">~{haven.approxDistanceKm} km</span>
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
              <div className="mt-3 pt-2.5 border-t border-zinc-800/80 flex items-center justify-between text-xs text-zinc-400">
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
            <div className="mt-4 pt-3 border-t border-zinc-800/80 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2">
              <button
                onClick={() => onStartSafeCheckinWithVenue(haven)}
                className="min-h-[38px] px-3 py-1.5 text-xs font-medium text-zinc-300 hover:text-white bg-zinc-800 hover:bg-zinc-700 rounded-xl border border-zinc-700 transition-colors cursor-pointer"
              >
                Set Safety Beacon Here
              </button>

              <button
                onClick={() => onSelectVenueForPulse(haven)}
                className="min-h-[38px] flex items-center justify-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-black bg-amber-400 hover:bg-amber-300 rounded-xl transition-colors cursor-pointer"
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
