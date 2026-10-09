import React, { useEffect, useRef } from 'react';
import { Check, Radio } from 'lucide-react';
import type { TopLevelIntentMode } from '../types';

interface LiveActivationOverlayProps {
  stage: 'connecting' | 'live';
  mode: TopLevelIntentMode;
  intent: string;
  onComplete: () => void;
}

/**
 * A restrained, spatial signal transition. Keep the connection phase visible
 * long enough to feel intentional, then hold the confirmed state before
 * returning to the map. "Live" is only supplied after the backend confirms it.
 */
export const LiveActivationOverlay: React.FC<LiveActivationOverlayProps> = ({
  stage, mode, intent, onComplete,
}) => {
  const mountedAt = useRef(Date.now());

  useEffect(() => {
    if (stage !== 'live') return;
    const elapsed = Date.now() - mountedAt.current;
    const minimumConnectMs = 1900;
    const liveHoldMs = 2400;
    const timeout = window.setTimeout(
      onComplete,
      Math.max(0, minimumConnectMs - elapsed) + liveHoldMs,
    );
    return () => window.clearTimeout(timeout);
  }, [stage, onComplete]);

  const tone = mode === 'private' ? 'private' : 'social';
  const isLive = stage === 'live';

  return (
    <div
      className={`g-live-handshake g-live-handshake--${tone} ${isLive ? 'is-live' : 'is-connecting'}`}
      role="status"
      aria-live="polite"
      aria-label={isLive ? 'Your intent is live' : 'Connecting your live intent'}
    >
      <div className="g-live-handshake__backdrop" />
      <div className="g-live-handshake__content">
        <div className="g-live-orbit" aria-hidden="true">
          <span className="g-live-orbit__ring g-live-orbit__ring--outer" />
          <span className="g-live-orbit__ring g-live-orbit__ring--middle" />
          <span className="g-live-orbit__ring g-live-orbit__ring--inner" />
          <span className="g-live-orbit__core">
            {isLive ? <Check size={25} strokeWidth={2} /> : <Radio size={25} strokeWidth={1.55} />}
          </span>
        </div>
        <div className="g-live-handshake__eyebrow">
          <span className="g-live-handshake__dot" />
          {isLive ? 'SIGNAL ACTIVE' : 'GAYZE · RIGHT NOW'}
        </div>
        <h2 className="g-live-handshake__title">
          {isLive ? "You're live." : 'Tuning your signal'}
        </h2>
        <p className="g-live-handshake__copy">
          {isLive ? 'You’re now visible on the map.' : 'Making your intent visible nearby'}
        </p>
        <span className="g-live-handshake__intent">{intent}</span>
      </div>
    </div>
  );
};
