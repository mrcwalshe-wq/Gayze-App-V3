import React, { useState } from 'react';
import { SafeHaven } from '../types';
import { 
  Calendar, 
  MapPin, 
  Clock, 
  ShieldCheck, 
  X, 
  Check, 
  Coffee, 
  Wine, 
  Shield, 
  Sparkles,
  ArrowRight
} from 'lucide-react';
import { hapticSensitiveAction } from '../services/hapticService';

interface ScheduleMeetingModalProps {
  isOpen: boolean;
  onClose: () => void;
  peerName: string;
  safeHavens: SafeHaven[];
  onConfirmMeeting: (proposal: {
    venueName: string;
    address: string;
    timeStr: string;
    isSafeHaven: boolean;
    durationMinutes: number;
    armSafetyBeacon: boolean;
  }) => void;
}

export const ScheduleMeetingModal: React.FC<ScheduleMeetingModalProps> = ({
  isOpen,
  onClose,
  peerName,
  safeHavens,
  onConfirmMeeting,
}) => {
  const [selectedHaven, setSelectedHaven] = useState<SafeHaven>(safeHavens[0] || {
    id: 'default_sh',
    name: 'Timberyard Community Cafe',
    address: '7 Upper St Martin’s Ln',
    neighborhood: 'Seven Dials',
    safetyScore: 9.7,
    features: [],
    lat: 51.5126,
    lng: -0.1268,
    openHours: '08:00 - 20:00',
    approxDistanceKm: 0.3,
    staffTrained: true,
    type: 'cafe',
  });

  const [timeOption, setTimeOption] = useState<string>('Now (~15 mins)');
  const [armSafetyBeacon, setArmSafetyBeacon] = useState<boolean>(true);
  const [durationMinutes, setDurationMinutes] = useState<number>(60);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    hapticSensitiveAction();

    onConfirmMeeting({
      venueName: selectedHaven.name,
      address: `${selectedHaven.address}, ${selectedHaven.neighborhood}`,
      timeStr: timeOption,
      isSafeHaven: true,
      durationMinutes,
      armSafetyBeacon,
    });

    onClose();
  };

  const timePresets = [
    'Now (~15 mins)',
    'In 1 hour',
    'Tonight, 20:00',
    'Tomorrow afternoon',
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/85 backdrop-blur-md animate-in fade-in">
      <div className="relative w-full max-w-md bg-[#11131a] border border-white/10 rounded-2xl overflow-hidden shadow-2xl flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-white/[0.08] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-[#C9A24D]/15 border border-[#C9A24D]/30 flex items-center justify-center text-[#C9A24D]">
              <Calendar className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm sm:text-base font-bold text-white tracking-tight">
                Plan Meetup with {peerName}
              </h3>
              <p className="text-xs text-zinc-400">
                Safe, verified venue with optional safety beacon
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-10 h-10 min-h-[44px] min-w-[44px] rounded-xl text-zinc-400 hover:text-white flex items-center justify-center hover:bg-white/[0.06] transition-colors cursor-pointer"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-4 sm:p-5 space-y-4 overflow-y-auto">
          {/* Step 1: Venue Selection */}
          <div className="space-y-2">
            <label className="text-xs font-bold text-zinc-300 uppercase tracking-wider flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              <span>Choose Verified Safe Haven</span>
            </label>
            <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
              {safeHavens.map((haven) => {
                const isSelected = haven.id === selectedHaven.id;
                return (
                  <button
                    key={haven.id}
                    type="button"
                    onClick={() => setSelectedHaven(haven)}
                    className={`w-full text-left p-3 rounded-xl border transition-all cursor-pointer flex items-center justify-between gap-3 ${
                      isSelected
                        ? 'bg-[#1c1f2b] border-[#C9A24D] text-white shadow-sm'
                        : 'bg-[#141620] border-white/[0.06] text-zinc-300 hover:border-white/20'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-white truncate flex items-center gap-1.5">
                        <span>{haven.name}</span>
                        <span className="text-[10px] text-emerald-400 font-mono">
                          ★ {haven.safetyScore}
                        </span>
                      </div>
                      <div className="text-[11px] text-zinc-400 truncate mt-0.5">
                        {haven.address} · {haven.neighborhood}
                      </div>
                    </div>

                    <div className="shrink-0">
                      {isSelected ? (
                        <div className="w-5 h-5 rounded-full bg-[#C9A24D] text-black flex items-center justify-center">
                          <Check className="w-3 h-3 stroke-[3]" />
                        </div>
                      ) : (
                        <div className="w-5 h-5 rounded-full border border-white/20" />
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Step 2: Time Selection */}
          <div className="space-y-2 pt-1 border-t border-white/[0.06]">
            <label className="text-xs font-bold text-zinc-300 uppercase tracking-wider flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-[#C9A24D]" />
              <span>Proposed Timing</span>
            </label>
            <div className="grid grid-cols-2 gap-2">
              {timePresets.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTimeOption(t)}
                  className={`h-11 min-h-[44px] px-3 rounded-xl text-xs font-semibold border transition-all cursor-pointer text-left truncate ${
                    timeOption === t
                      ? 'bg-[#C9A24D]/15 text-[#C9A24D] border-[#C9A24D]/40 font-bold'
                      : 'bg-[#141620] text-zinc-300 border-white/[0.06] hover:border-white/20'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* Step 3: Guardian Safety Beacon Integration */}
          <div className="p-3.5 rounded-xl bg-[#141620] border border-white/[0.08] space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-emerald-400" />
                <span className="text-xs font-bold text-white">Guardian Safety Beacon</span>
              </div>
              <input
                type="checkbox"
                checked={armSafetyBeacon}
                onChange={(e) => setArmSafetyBeacon(e.target.checked)}
                className="w-4 h-4 accent-[#C9A24D] rounded cursor-pointer"
                id="arm_beacon"
              />
            </div>
            <p className="text-[11px] text-zinc-400 leading-snug">
              Automatically arms an emergency safety timer for this meetup. If you do not check in, an automated encrypted alert pings your safety contacts.
            </p>

            {armSafetyBeacon && (
              <div className="flex items-center gap-2 pt-1">
                <span className="text-[11px] text-zinc-400">Duration:</span>
                {[45, 60, 90, 120].map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setDurationMinutes(m)}
                    className={`px-2.5 py-1 text-xs rounded-lg border font-mono transition-colors ${
                      durationMinutes === m
                        ? 'bg-emerald-950 text-emerald-300 border-emerald-500/50 font-bold'
                        : 'bg-[#1a1c27] text-zinc-400 border-white/5'
                    }`}
                  >
                    {m}m
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Submit Action */}
          <div className="pt-2">
            <button
              type="submit"
              className="w-full h-12 min-h-[48px] rounded-xl bg-[#C9A24D] hover:bg-[#b58f3b] text-black font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 shadow-lg transition-all active:scale-98 cursor-pointer"
            >
              <span>Send Meeting Proposal</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
