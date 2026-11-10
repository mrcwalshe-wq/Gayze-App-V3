import React, { useEffect, useState } from 'react';
import { GayzeLogo, GAYZE_LOGO_PATH } from './GayzeLogo';

interface GayzeLoadingScreenProps {
  mode?: 'startup' | 'gazing';
}

/** Honest status: it only says more as the wait gets longer, and never claims a step that isn't being done. */
function useStartupStatus() {
  const [stage, setStage] = useState(0);
  useEffect(() => {
    const a = window.setTimeout(() => setStage(1), 4000);
    const b = window.setTimeout(() => setStage(2), 10000);
    return () => { window.clearTimeout(a); window.clearTimeout(b); };
  }, []);
  return ['Opening GAYZE', 'Still connecting', 'Slow connection, hanging on'][stage];
}

const StartupStatus: React.FC = () => {
  const text = useStartupStatus();
  return (
    <div className="mt-9 flex flex-col items-center gap-3" role="status" aria-live="polite">
      <div className="g-load-track" aria-hidden="true"><span className="g-load-bead" /></div>
      <div key={text} className="g-load-text">{text}</div>
    </div>
  );
};

export const GayzeLoadingScreen: React.FC<GayzeLoadingScreenProps> = ({ mode = 'startup' }) => (
  <div className="fixed inset-0 z-[100] overflow-hidden bg-[#050507] flex items-center justify-center">
    <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_42%,rgba(111,60,195,0.18),transparent_34%),radial-gradient(circle_at_60%_48%,rgba(201,162,77,0.12),transparent_36%)]" />
    <div className="relative flex flex-col items-center">
      {mode === 'startup' ? (
        <div className="animate-in fade-in zoom-in-95 duration-700 px-8 flex flex-col items-center">
          <GayzeLogo size={140} showWordmark />
          <StartupStatus />
        </div>
      ) : (
        <div className="relative flex flex-col items-center">
          <div className="relative w-56 h-56 flex items-center justify-center">
            {/* One slow halo of violet light behind the mark: it breathes rather
                than spins, so the wait reads as atmosphere, not as a loading widget. */}
            <div className="g-signal-halo" aria-hidden="true" />
            <div className="relative w-40 aspect-[768/437] flex items-center justify-center">
              <img
                src={GAYZE_LOGO_PATH}
                alt="GAYZE"
                className="w-full h-full object-contain drop-shadow-[0_0_24px_rgba(111,60,195,0.3)]"
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
