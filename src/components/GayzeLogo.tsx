import React from 'react';

export const GAYZE_LOGO_PATH = '/gayze-logo.jpg';

interface GayzeLogoProps {
  size?: number;
  showWordmark?: boolean;
  className?: string;
}

export const GayzeLogo: React.FC<GayzeLogoProps> = ({
  size = 120,
  showWordmark = true,
  className = '',
}) => {
  const height = Math.round(size * (874 / 1536));
  return (
    <div
      className={'flex flex-col items-center justify-center ' + className}
      style={{ width: showWordmark ? Math.max(size * 2.2, 180) : size }}
    >
      <img
        src={GAYZE_LOGO_PATH}
        alt="GAYZE"
        width={size}
        height={height}
        className="block object-contain"
        draggable={false}
      />
      {showWordmark && (
        <>
          <div className="mt-2 text-[clamp(1.75rem,6vw,2.75rem)] font-semibold tracking-[0.16em] text-[#f4f1ea] leading-none">
            GAYZE
          </div>
          <div className="mt-2.5 text-[13px] font-normal tracking-[0.01em]">
            <span className="text-[#b796f0]">Real Intent.</span>{' '}
            <span className="text-[#C9A24D]/90">Real Time.</span>
          </div>
        </>
      )}
    </div>
  );
};
