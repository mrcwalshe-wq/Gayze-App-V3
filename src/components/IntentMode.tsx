import React from 'react';
import { hapticLight } from '../services/hapticService';

export type IntentTimingMode = 'right_now' | 'later';

interface IntentModeProps {
  mode: IntentTimingMode;
  onChangeMode: (mode: IntentTimingMode) => void;
  // Time selection for active mode
  selectedTime?: string;
  onSelectTime?: (time: string) => void;
}

export const IntentMode: React.FC<IntentModeProps> = ({
  mode,
  onChangeMode,
  selectedTime,
  onSelectTime,
}) => {
  const isRightNow = mode === 'right_now';

  const handleModeSwitch = (targetMode: IntentTimingMode) => {
    if (targetMode !== mode) {
      hapticLight();
      onChangeMode(targetMode);
    }
  };

  return (
    <div className="w-full select-none space-y-2">
      {/* Centered Distinctive Feature Header */}
      <div className="flex items-center justify-center">
        <span className="text-[10px] sm:text-[11px] font-mono uppercase tracking-[0.25em] text-[#C9A24D] font-bold">
          INTENTMODE™
        </span>
      </div>

      {/* Signature Tactile Switch Control:
              RIGHT NOW  ━━━━━━━━━  LATER
          With smooth sliding thumb, mobile-native 44px+ touch targets
      */}
      <div className="relative w-full max-w-md mx-auto bg-[#07080b] border border-white/[0.08] rounded-2xl p-1 shadow-inner">
        {/* Background track line */}
        <div className="absolute inset-x-8 top-1/2 -translate-y-1/2 h-[2px] bg-zinc-800/80 pointer-events-none" />

        {/* Sliding Amber/Purple Indicator Plate */}
        <div
          aria-hidden="true"
          className="absolute top-1 bottom-1 rounded-xl transition-all duration-200 ease-out pointer-events-none"
          style={{
            width: 'calc(50% - 4px)',
            left: isRightNow ? '4px' : 'calc(50%)',
            background: isRightNow
              ? 'linear-gradient(180deg, #1f1b13 0%, #151410 100%)'
              : 'linear-gradient(180deg, #191424 0%, #121019 100%)',
            border: isRightNow
              ? '1px solid rgba(201, 162, 77, 0.45)'
              : '1px solid rgba(111, 60, 195, 0.45)',
            boxShadow: isRightNow
              ? '0 0 16px rgba(201, 162, 77, 0.15)'
              : '0 0 16px rgba(111, 60, 195, 0.15)',
          }}
        />

        {/* Two Native Touch Target Buttons (min 44px height) */}
        <div className="relative grid grid-cols-2 gap-1 z-10">
          {/* RIGHT NOW */}
          <button
            type="button"
            onClick={() => handleModeSwitch('right_now')}
            className={`h-11 sm:h-12 rounded-xl flex items-center justify-center gap-2 transition-all duration-200 cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-[#C9A24D] ${
              isRightNow
                ? 'text-[#C9A24D]'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
            aria-pressed={isRightNow}
          >
            <span
              className={`w-2 h-2 rounded-full transition-all duration-200 ${
                isRightNow
                  ? 'bg-[#C9A24D] shadow-[0_0_8px_#C9A24D] scale-110'
                  : 'bg-zinc-600'
              }`}
            />
            <span className="text-xs sm:text-sm font-black tracking-wider uppercase font-sans">
              RIGHT NOW
            </span>
          </button>

          {/* LATER */}
          <button
            type="button"
            onClick={() => handleModeSwitch('later')}
            className={`h-11 sm:h-12 rounded-xl flex items-center justify-center gap-2 transition-all duration-200 cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-[#6F3CC3] ${
              !isRightNow
                ? 'text-white'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
            aria-pressed={!isRightNow}
          >
            <span className="text-xs sm:text-sm font-black tracking-wider uppercase font-sans">
              LATER
            </span>
            <span
              className={`w-2 h-2 rounded-full transition-all duration-200 ${
                !isRightNow
                  ? 'bg-[#6F3CC3] shadow-[0_0_8px_#6F3CC3] scale-110'
                  : 'bg-zinc-600'
              }`}
            />
          </button>
        </div>
      </div>
    </div>
  );
};
