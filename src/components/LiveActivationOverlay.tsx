import React, { useEffect } from 'react';
import { Radio, Check, Waves, Smartphone, Zap } from 'lucide-react';
import type { TopLevelIntentMode } from '../types';

interface LiveActivationOverlayProps {
  stage: 'connecting' | 'live';
  mode: TopLevelIntentMode;
  intent: string;
  onComplete: () => void;
}

/**
 * A short, AirDrop-inspired phone-to-phone handshake. It is only shown for a
 * confirmed first-time "Right now" publish; failure paths dismiss it rather
 * than claiming that the user is live.
 */
export const LiveActivationOverlay: React.FC<LiveActivationOverlayProps> = ({
  stage, mode, intent, onComplete,
}) => {
  useEffect(() => {
    if (stage !== 'live') return;
    const timeout = window.setTimeout(onComplete, 1650);
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
          <span className="g-live-orbit__beam" />
          <span className="g-live-orbit__node g-live-orbit__node--one" />
          <span className="g-live-orbit__node g-live-orbit__node--two" />
          <span className="g-live-orbit__node g-live-orbit__node--three" />
          <span className="g-live-orbit__core">
            {isLive ? <Check size={25} strokeWidth={2.8} /> : <Radio size={25} strokeWidth={1.8} />}
          </span>
          <span className="g-live-orbit__signal"><Waves size={15} /></span>
          <span className="g-live-devices">
            <span className="g-live-device g-live-device--one"><Smartphone size={27} strokeWidth={1.8} /></span>
            <span className="g-live-device-link"><span /><Zap size={13} /></span>
            <span className="g-live-device g-live-device--two">
              {isLive ? <Check size={23} strokeWidth={2.7} /> : <Smartphone size={27} strokeWidth={1.8} />}
            </span>
          </span>
        </div>
        <div className="g-live-handshake__eyebrow">
          <span className="g-live-handshake__dot" />
          {isLive ? 'SIGNAL ESTABLISHED' : 'GAYZE NETWORK'}
        </div>
        <h2 className="g-live-handshake__title">
          {isLive ? "You're live." : 'Connecting nearby'}
        </h2>
        <p className="g-live-handshake__copy">
          {isLive ? 'Your signal is on the map.' : 'Your phone is sharing your intent with people nearby…'}
        </p>
        <span className="g-live-handshake__intent">{intent}</span>
      </div>
    </div>
  );
};
