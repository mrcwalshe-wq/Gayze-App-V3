import React from 'react';
import { hapticLight } from '../services/hapticService';

export type IntentTimingMode = 'right_now' | 'later';

interface IntentModeProps {
  mode: IntentTimingMode;
  onChangeMode: (mode: IntentTimingMode) => void;
  activeCount?: number;
  plannedCount?: number;
}

export const IntentMode: React.FC<IntentModeProps> = ({
  mode,
  onChangeMode,
  activeCount = 12,
  plannedCount = 6,
}) => {
  const isRightNow = mode === 'right_now';

  const handleModeSwitch = (targetMode: IntentTimingMode) => {
    if (targetMode !== mode) {
      hapticLight();
      onChangeMode(targetMode);
    }
  };

  return (
    <div className="w-full select-none space-y-1.5">
      {/* Timing switch. Live intent is purple because it is present tense and on
          the map; "Later" stays quiet obsidian because nothing is happening yet.
          44px+ touch targets for thumbs. */}
      <div className="relative w-full max-w-md mx-auto bg-[#0a0b11]/90 border border-white/[0.07] rounded-[14px] p-1">
        {/* Sliding indicator plate — inset highlight instead of a glow. */}
        <div
          aria-hidden="true"
          className="absolute top-1 bottom-1 rounded-[11px] transition-all duration-300 ease-out pointer-events-none"
          style={{
            width: 'calc(50% - 4px)',
            left: isRightNow ? '4px' : 'calc(50%)',
            background: isRightNow
              ? 'linear-gradient(180deg, rgba(111,60,195,0.22) 0%, rgba(111,60,195,0.10) 100%)'
              : 'linear-gradient(180deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%)',
            border: isRightNow
              ? '1px solid rgba(111, 60, 195, 0.45)'
              : '1px solid rgba(255, 255, 255, 0.09)',
            boxShadow: isRightNow
              ? 'inset 0 1px 0 rgba(170, 132, 245, 0.14)'
              : 'inset 0 1px 0 rgba(255, 255, 255, 0.05)',
          }}
        />

        {/* Two Native Touch Target Buttons (min 44px height) */}
        <div className="relative grid grid-cols-2 gap-1 z-10">
          {/* RIGHT NOW */}
          <button
            type="button"
            onClick={() => handleModeSwitch('right_now')}
            className={`h-11 sm:h-12 rounded-[11px] flex items-center justify-center gap-2 transition-colors duration-300 cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-[#6F3CC3] ${
              isRightNow
                ? 'text-white'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
            aria-pressed={isRightNow}
          >
            <span
              className={`w-[6px] h-[6px] rounded-full transition-colors duration-300 ${
                isRightNow ? 'bg-[#b796f0]' : 'bg-zinc-600'
              }`}
            />
            <span className={`text-[13px] sm:text-sm ${isRightNow ? 'font-semibold' : 'font-medium'}`}>
              Right now
            </span>
          </button>

          {/* LATER */}
          <button
            type="button"
            onClick={() => handleModeSwitch('later')}
            className={`h-11 sm:h-12 rounded-[11px] flex items-center justify-center gap-2 transition-colors duration-300 cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-white/20 ${
              !isRightNow
                ? 'text-white'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
            aria-pressed={!isRightNow}
          >
            <span className={`text-[13px] sm:text-sm ${!isRightNow ? 'font-semibold' : 'font-medium'}`}>
              Later
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};
