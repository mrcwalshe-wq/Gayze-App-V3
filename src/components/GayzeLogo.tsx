import React from 'react';

interface GayzeLogoProps {
  size?: number;
  showWordmark?: boolean;
  className?: string;
}

const GAYZE_ROUNDEL = 'data:image/webp;base64,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';

export const GayzeLogo: React.FC<GayzeLogoProps> = ({ size = 120, showWordmark = true, className = '' }) => (
  <div className={`flex flex-col items-center justify-center ${className}`} style={{ width: showWordmark ? Math.max(size * 2.2, 180) : size }}>
    <img
      src={GAYZE_ROUNDEL}
      alt="GAYZE"
      className="block object-contain"
      style={{ width: size, height: size * 0.62 }}
      draggable={false}
    />
    {showWordmark && (
      <>
        <div className="mt-1 text-[clamp(2rem,7vw,3.3rem)] font-black tracking-[0.18em] text-[#f7f2df] leading-none">GAYZE</div>
        <div className="mt-2 text-xs sm:text-sm font-medium tracking-wide">
          <span className="text-[#9B6BFF]">Real Intent.</span>{' '}
          <span className="text-[#C9A24D]">Real Time.</span>
        </div>
      </>
    )}
  </div>
);
