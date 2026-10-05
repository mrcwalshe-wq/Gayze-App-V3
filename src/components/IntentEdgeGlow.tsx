import React from 'react';
import type { UserActiveIntent } from './SetIntentSheet';

interface IntentEdgeGlowProps {
  intent?: UserActiveIntent | null;
}

/**
 * Full-viewport intent signal inspired by the iPhone Siri edge treatment.
 * It is visual-only, never captures pointer events, and respects reduced motion.
 */
export const IntentEdgeGlow: React.FC<IntentEdgeGlowProps> = ({ intent }) => {
  if (!intent || intent.isPaused) return null;

  const isSocial = intent.mode === 'social';
  const colour = isSocial ? 'var(--brand-amber)' : 'var(--brand-purple)';
  const rgb = isSocial ? '201, 162, 77' : '111, 60, 195';

  return (
    <div
      aria-hidden="true"
      className="g-intent-edge-glow"
      style={{
        '--intent-glow': colour,
        '--intent-rgb': rgb,
      } as React.CSSProperties}
      data-intent={isSocial ? 'social' : 'private'}
    >
      <span className="g-intent-edge-glow__a" />
      <span className="g-intent-edge-glow__b" />
      <span className="g-intent-edge-glow__c" />
    </div>
  );
};
