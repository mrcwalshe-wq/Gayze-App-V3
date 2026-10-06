import React from 'react';

/**
 * The GAYZE mark is a wide (2.05:1) almond badge holding the eye-and-G
 * artwork. It ships as a transparent WebP master built by
 * `scripts/build-brand-assets.mjs` from the single source logo, with its
 * near-black body lifted so the whole silhouette survives on the app's
 * obsidian surfaces (25% of it used to vanish).
 */
export const GAYZE_MARK_PATH = '/gayze-mark.webp';

/** Legacy name — kept so existing imports and docs keep resolving. */
export const GAYZE_LOGO_PATH = GAYZE_MARK_PATH;

/** width / height of the master asset. */
export const GAYZE_MARK_RATIO = 942 / 459;

interface GayzeLogoProps {
  size?: number;
  showWordmark?: boolean;
  className?: string;
  /** Halo of violet light behind the mark so it reads on any surface. */
  glow?: boolean;
}

export const GayzeLogo: React.FC<GayzeLogoProps> = ({
  size = 120,
  showWordmark = true,
  className = '',
  glow = true,
}) => {
  const height = Math.round(size / GAYZE_MARK_RATIO);
  return (
    <div
      className={'flex flex-col items-center justify-center ' + className}
      style={{ width: showWordmark ? Math.max(size * 2.2, 180) : size }}
    >
      <span className="g-mark-lockup" style={{ width: size }}>
        {glow && <span className="g-mark-glow" aria-hidden="true" />}
        <img
          src={GAYZE_MARK_PATH}
          alt="GAYZE"
          width={size}
          height={height}
          className="g-mark"
          draggable={false}
        />
      </span>
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

/**
 * The mark sized for inline use inside buttons — the Gaze action carries the
 * brand itself rather than a generic eye glyph. `size` is the rendered height,
 * matching the optical weight of the 14px lucide icons beside it.
 */
export const GayzeMarkIcon: React.FC<{ size?: number; className?: string }> = ({
  size = 13,
  className = '',
}) => (
  <img
    src={GAYZE_MARK_PATH}
    alt=""
    aria-hidden="true"
    width={Math.round(size * GAYZE_MARK_RATIO)}
    height={size}
    className={'g-mark-icon ' + className}
    style={{ width: Math.round(size * GAYZE_MARK_RATIO), height: size }}
    draggable={false}
  />
);
