import React from 'react';
import { GayzeLogo, GAYZE_MARK_PATH } from './GayzeLogo';
import { GayzeWatermark } from './GayzeWatermark';

interface GayzeLoadingScreenProps {
  mode?: 'startup' | 'gazing';
}

export const GayzeLoadingScreen: React.FC<GayzeLoadingScreenProps> = ({ mode = 'startup' }) => (
  <div className="fixed inset-0 z-[100] overflow-hidden bg-[#050507] flex items-center justify-center">
    <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_42%,rgba(111,60,195,0.18),transparent_34%),radial-gradient(circle_at_60%_48%,rgba(201,162,77,0.12),transparent_36%)]" />
    <GayzeWatermark width="92%" opacity={0.07} breathe />
    <div className="relative z-10 flex flex-col items-center">
      {mode === 'startup' ? (
        <div className="animate-in fade-in zoom-in-95 duration-700 px-8">
          <GayzeLogo size={140} showWordmark />
        </div>
      ) : (
        <div className="relative flex flex-col items-center">
          <div className="relative w-56 h-56 flex items-center justify-center">
            {/* One slow halo of violet light behind the mark: it breathes rather
                than spins, so the wait reads as atmosphere, not as a loading widget. */}
            <div className="g-signal-halo" aria-hidden="true" />
            <div className="relative w-40 flex items-center justify-center">
              <img
                src={GAYZE_MARK_PATH}
                alt="GAYZE"
                className="w-full h-auto object-contain drop-shadow-[0_0_24px_rgba(111,60,195,0.3)]"
                draggable={false}
              />
            </div>
          </div>
          <div className="mt-5 text-[12px] font-medium tracking-[0.24em] text-zinc-300">
            FINDING REAL PEOPLE, RIGHT NOW
          </div>
        </div>
      )}
    </div>
  </div>
);
