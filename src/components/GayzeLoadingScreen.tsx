import React from 'react';
import { GayzeLogo } from './GayzeLogo';

interface GayzeLoadingScreenProps { mode?: 'startup' | 'gazing'; }

export const GayzeLoadingScreen: React.FC<GayzeLoadingScreenProps> = ({ mode = 'startup' }) => (
  <div className="fixed inset-0 z-[100] overflow-hidden bg-[#050507] flex items-center justify-center">
    <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_42%,rgba(111,60,195,0.18),transparent_34%),radial-gradient(circle_at_60%_48%,rgba(201,162,77,0.12),transparent_36%)]" />
    <div className="relative flex flex-col items-center">
      {mode === 'startup' ? (
        <div className="animate-in fade-in zoom-in-95 duration-700 px-8">
          <GayzeLogo size={150} showWordmark />
        </div>
      ) : (
        <div className="relative flex flex-col items-center">
          <div className="relative w-56 h-56 flex items-center justify-center">
            <div className="absolute inset-5 rounded-full border border-[#6F3CC3]/30 animate-[spin_7s_linear_infinite]" />
            <div className="absolute inset-10 rounded-full border border-[#C9A24D]/35 border-dashed animate-[spin_4s_linear_infinite_reverse]" />
            <div className="absolute w-32 h-32 rounded-full bg-[#6F3CC3]/10 blur-2xl animate-pulse" />
            <div className="relative w-28 h-28 rounded-full border border-[#6F3CC3]/60 bg-[#0d0b15]/90 shadow-[0_0_45px_rgba(111,60,195,0.35)] flex items-center justify-center animate-pulse">
              <img src="/gayze-roundel.svg" alt="GAYZE" className="w-24 h-24 object-contain" />
            </div>
          </div>
          <div className="mt-5 text-sm font-black tracking-[0.35em] text-white">GAYZING<span className="animate-pulse">...</span></div>
          <div className="mt-1 text-xs text-zinc-500">Finding real people, right now.</div>
        </div>
      )}
    </div>
  </div>
);