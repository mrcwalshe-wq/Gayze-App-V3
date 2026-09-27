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
          <div className="mt-1 text-[clamp(2rem,7vw,3.3rem)] font-black tracking-[0.18em] text-[#f7f2df] leading-none">
            GAYZE
          </div>
          <div className="mt-2 text-xs sm:text-sm font-medium tracking-wide">
            <span className="text-[#9B6BFF]">Real Intent.</span>{' '}
            <span className="text-[#C9A24D]">Real Time.</span>
          </div>
        </>
      )}
    </div>
  );
};
