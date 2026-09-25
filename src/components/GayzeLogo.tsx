import React from 'react';

interface GayzeLogoProps {
  size?: number;
  showWordmark?: boolean;
  className?: string;
}

export const GayzeLogo: React.FC<GayzeLogoProps> = ({ size = 120, showWordmark = true, className = '' }) => (
  <div className={`flex flex-col items-center justify-center ${className}`} style={{ width: showWordmark ? Math.max(size * 2.2, 180) : size }}>
    <svg width={size} height={size * 0.62} viewBox="0 0 220 136" fill="none" aria-label="GAYZE">
      <defs>
        <linearGradient id="gayzeLogoGradient" x1="18" y1="68" x2="202" y2="68" gradientUnits="userSpaceOnUse">
          <stop stopColor="#7C3AED"/>
          <stop offset="0.5" stopColor="#E879F9"/>
          <stop offset="1" stopColor="#C9A24D"/>
        </linearGradient>
        <filter id="gayzeLogoGlow" x="-30%" y="-40%" width="160%" height="180%">
          <feGaussianBlur stdDeviation="4" result="blur"/>
          <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>
      <g filter="url(#gayzeLogoGlow)">
        <path d="M16 68C52 22 84 12 110 12C142 12 172 25 204 68C172 111 142 124 110 124C78 124 48 112 16 68Z" stroke="url(#gayzeLogoGradient)" strokeWidth="8" strokeLinejoin="round"/>
        <path d="M98 38C82 42 72 55 72 69C72 84 82 96 98 99C88 91 84 82 84 69C84 55 89 45 98 38Z" fill="url(#gayzeLogoGradient)"/>
        <path d="M111 40C96 40 87 51 87 68C87 85 96 96 111 96C123 96 132 88 136 77H119V68H148V96H138V89C131 96 122 100 111 100C90 100 75 87 75 68C75 49 90 36 111 36C124 36 135 42 142 51L133 59C128 47 120 40 111 40Z" fill="url(#gayzeLogoGradient)"/>
        <path d="M150 40C165 48 171 58 171 69C171 80 165 91 151 99C159 91 161 81 161 69C161 57 159 48 150 40Z" fill="url(#gayzeLogoGradient)"/>
      </g>
    </svg>
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
