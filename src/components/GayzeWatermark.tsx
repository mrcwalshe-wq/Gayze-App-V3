import React from 'react';
import { GAYZE_MARK_PATH, GAYZE_MARK_RATIO } from './GayzeLogo';

interface GayzeWatermarkProps {
  /** Mark width as any CSS length — a percentage of the host surface reads best. */
  width?: string;
  /** Peak opacity. Kept very low: this is light in the air, not a sticker. */
  opacity?: number;
  /** Slow 14s breathe, matching the app's other atmospheric motion. */
  breathe?: boolean;
  className?: string;
}

/**
 * A faint GAYZE mark behind a screen. Purely decorative: never focusable,
 * never clickable, never announced. It shares the cached master asset with
 * <GayzeLogo>, so it costs no extra request.
 */
export const GayzeWatermark: React.FC<GayzeWatermarkProps> = ({
  width = '72%',
  opacity = 0.06,
  breathe = false,
  className = '',
}) => (
  <div
    aria-hidden="true"
    className={`g-watermark${breathe ? ' g-watermark--breathe' : ''}${className ? ' ' + className : ''}`}
    style={{ '--g-watermark-peak': opacity } as React.CSSProperties}
  >
    <img
      src={GAYZE_MARK_PATH}
      alt=""
      width={Math.round(942)}
      height={Math.round(459)}
      style={{ width, aspectRatio: `${GAYZE_MARK_RATIO} / 1` }}
      draggable={false}
    />
  </div>
);
