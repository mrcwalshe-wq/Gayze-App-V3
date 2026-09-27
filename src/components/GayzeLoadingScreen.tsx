import React from 'react';
import { GayzeLogo, GAYZE_OFFICIAL_ROUNDEL_DATA_URI } from './GayzeLogo';

interface GayzeLoadingScreenProps {
  mode?: 'startup' | 'gazing';
}

export const GayzeLoadingScreen: React.FC<GayzeLoadingScreenProps> = ({ mode = 'startup' }) => (
  <div className="fixed inset-0 z-[100] overflow-hidden bg-[#050507] flex items-center justify-center">
    <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_42%,rgba(111,60,195,0.18),transparent_34%),radial-gradient(circle_at_60%_48%,rgba(201,162,77,0.12),transparent_36%)]" />
    <div className="relative flex flex-col items-center">
      {mode === 'startup' ? (
        <div className="animate-in fade-in zoom-in-95 duration-700 px-8">
          <GayzeLogo size={140} showWordmark />
        </div>
      ) : (
        <div className="relative flex flex-col items-center">
          <div className="relative w-56 h-56 flex items-center justify-center">
            {/* Animated container glow and rings around the authentic artwork */}
            <div className="absolute inset-4 rounded-full border border-[#6F3CC3]/30 animate-[spin_7s_linear_infinite]" />
            <div className="absolute inset-8 rounded-full border border-[#C9A24D]/35 border-dashed animate-[spin_4s_linear_infinite_reverse]" />
            <div className="absolute w-36 h-36 rounded-full bg-[#6F3CC3]/15 blur-2xl animate-pulse" />
            <div className="relative w-40 aspect-[210/108] flex items-center justify-center">
              <img
                src={GAYZE_OFFICIAL_ROUNDEL_DATA_URI}
                alt="GAYZE"
                className="w-full h-full object-contain drop-shadow-[0_0_28px_rgba(111,60,195,0.28)]"
                draggable={false}
              />
            </div>
          </div>
          <div className="mt-5 text-sm font-black tracking-[0.35em] text-white">
            GAYZING<span className="animate-pulse">...</span>
          </div>
          <div className="mt-1 text-xs text-zinc-500">Finding real people, right now.</div>
        </div>
      )}
    </div>
  </div>
);
