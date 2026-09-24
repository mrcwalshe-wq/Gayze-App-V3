import React from 'react';
import { Zap, Calendar, Sparkles } from 'lucide-react';
import { hapticLight } from '../services/hapticService';

export type IntentTimingMode = 'right_now' | 'later';

interface IntentModeControlProps {
  mode: IntentTimingMode;
  onChange: (mode: IntentTimingMode) => void;
  activeEncountersCount?: number;
  laterPlansCount?: number;
}

export const IntentModeControl: React.FC<IntentModeControlProps> = ({
  mode,
  onChange,
  activeEncountersCount = 12,
  laterPlansCount = 6,
}) => {
  const isRightNow = mode === 'right_now';

  const handleSelect = (targetMode: IntentTimingMode) => {
    if (targetMode !== mode) {
      hapticLight();
      onChange(targetMode);
    }
  };

  return (
    <div className="w-full select-none">
      {/* Tactical Track Container */}
      <div className="relative bg-[#0d0e14] border border-white/[0.08] rounded-2xl p-2.5 sm:p-3 shadow-inner">
        {/* Upper Labels Row */}
        <div className="flex items-center justify-between px-1 mb-2">
          {/* Left: RIGHT NOW */}
          <button
            type="button"
            onClick={() => handleSelect('right_now')}
            className={`text-left transition-all duration-200 cursor-pointer group ${
              isRightNow ? 'opacity-100' : 'opacity-50 hover:opacity-80'
            }`}
          >
            <div className="flex items-center gap-1.5">
              <span
                className={`w-2 h-2 rounded-full transition-colors duration-200 ${
                  isRightNow ? 'bg-[#C9A24D] shadow-[0_0_8px_#C9A24D]' : 'bg-zinc-600'
                }`}
              />
              <span
                className={`text-xs sm:text-sm font-black tracking-wider uppercase font-sans transition-colors duration-200 ${
                  isRightNow ? 'text-[#C9A24D]' : 'text-zinc-400 group-hover:text-zinc-300'
                }`}
              >
                RIGHT NOW
              </span>
            </div>
            <p className="text-[10px] text-zinc-400 mt-0.5 font-medium hidden sm:block">
              Available immediately · Active now · Spontaneous
            </p>
          </button>

          {/* Center Indicator Badge */}
          <div className="text-[10px] font-mono uppercase tracking-widest text-zinc-400 px-2 py-0.5 rounded-full bg-white/[0.03] border border-white/[0.06] hidden md:block">
            IntentMode™
          </div>

          {/* Right: LATER */}
          <button
            type="button"
            onClick={() => handleSelect('later')}
            className={`text-right transition-all duration-200 cursor-pointer group ${
              !isRightNow ? 'opacity-100' : 'opacity-50 hover:opacity-80'
            }`}
          >
            <div className="flex items-center justify-end gap-1.5">
              <span
                className={`text-xs sm:text-sm font-black tracking-wider uppercase font-sans transition-colors duration-200 ${
                  !isRightNow ? 'text-white' : 'text-zinc-400 group-hover:text-zinc-300'
                }`}
              >
                LATER
              </span>
              <span
                className={`w-2 h-2 rounded-full transition-colors duration-200 ${
                  !isRightNow ? 'bg-[#6F3CC3] shadow-[0_0_8px_#6F3CC3]' : 'bg-zinc-600'
                }`}
              />
            </div>
            <p className="text-[10px] text-zinc-400 mt-0.5 font-medium hidden sm:block">
              Tonight · Tomorrow · Planned encounters
            </p>
          </button>
        </div>

        {/* Signature Interactive Tactical Rail:
            RIGHT NOW                         LATER
            ●━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━●
        */}
        <div className="relative h-11 w-full bg-[#07080b] rounded-xl border border-white/[0.07] px-1.5 flex items-center justify-between overflow-hidden">
          {/* Subtle connecting rail line */}
          <div className="absolute inset-x-5 top-1/2 -translate-y-1/2 h-[2px] bg-zinc-800" />
          
          {/* Illuminated Active Track Fill */}
          <div
            className={`absolute top-1/2 -translate-y-1/2 h-[2px] transition-all duration-300 ease-out ${
              isRightNow
                ? 'left-5 right-1/2 bg-gradient-to-r from-[#C9A24D] to-[#C9A24D]/20'
                : 'left-1/2 right-5 bg-gradient-to-r from-[#6F3CC3]/20 to-[#6F3CC3]'
            }`}
          />

          {/* Left Anchor Node */}
          <button
            type="button"
            onClick={() => handleSelect('right_now')}
            className={`relative z-10 flex-1 h-9 rounded-lg flex items-center justify-start pl-3 gap-2 transition-all duration-200 cursor-pointer ${
              isRightNow
                ? 'bg-[#181a24] text-white shadow-md border border-[#C9A24D]/50'
                : 'text-zinc-400 hover:text-zinc-300'
            }`}
          >
            <span
              className={`w-2.5 h-2.5 rounded-full transition-all duration-200 flex items-center justify-center ${
                isRightNow ? 'bg-[#C9A24D] scale-110 shadow-[0_0_10px_#C9A24D]' : 'bg-zinc-600'
              }`}
            >
              {isRightNow && <span className="w-1 h-1 rounded-full bg-black" />}
            </span>
            <span className="text-xs font-bold tracking-tight">
              Spontaneous ({activeEncountersCount})
            </span>
          </button>

          {/* Center Tactical Divider Node */}
          <div className="w-6 flex items-center justify-center z-10 shrink-0">
            <span className="w-1.5 h-1.5 rounded-full bg-zinc-700" />
          </div>

          {/* Right Anchor Node */}
          <button
            type="button"
            onClick={() => handleSelect('later')}
            className={`relative z-10 flex-1 h-9 rounded-lg flex items-center justify-end pr-3 gap-2 transition-all duration-200 cursor-pointer ${
              !isRightNow
                ? 'bg-[#181a24] text-white shadow-md border border-[#6F3CC3]/60'
                : 'text-zinc-400 hover:text-zinc-300'
            }`}
          >
            <span className="text-xs font-bold tracking-tight">
              Planned ({laterPlansCount})
            </span>
            <span
              className={`w-2.5 h-2.5 rounded-full transition-all duration-200 flex items-center justify-center ${
                !isRightNow ? 'bg-[#6F3CC3] scale-110 shadow-[0_0_10px_#6F3CC3]' : 'bg-zinc-600'
              }`}
            >
              {!isRightNow && <span className="w-1 h-1 rounded-full bg-black" />}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};
