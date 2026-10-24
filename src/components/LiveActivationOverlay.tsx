import React, { useEffect, useRef, useState } from 'react';
import type { TopLevelIntentMode } from '../types';
import { hapticSensitiveAction, triggerVibration } from '../services/hapticService';
import { GayzeWarp } from './GayzeWarp';

interface LiveActivationOverlayProps {
  stage: 'connecting' | 'live';
  mode: TopLevelIntentMode;
  intent: string;
  onComplete: () => void;
}

/** The go-live event: the Gayze mark rushes out of deep space into the viewer, shockwaves
 *  roll out, and "You're live" lands. Only shown for a confirmed first-time publish;
 *  failure paths dismiss it rather than claiming that the user is live. */
const ARRIVAL_MS = 1100;
const HOLD_MS = 2600;

export const LiveActivationOverlay: React.FC<LiveActivationOverlayProps> = ({ stage, mode, intent, onComplete }) => {
  // Keep the latest callback without restarting the dismissal timer on every parent render.
  const onCompleteRef = useRef(onComplete);
  useEffect(() => { onCompleteRef.current = onComplete; }, [onComplete]);

  // The logo needs its arrival even when the backend answers instantly.
  const [arrived, setArrived] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setArrived(true), ARRIVAL_MS);
    return () => window.clearTimeout(t);
  }, []);

  const isLive = stage === 'live' && arrived;
  useEffect(() => {
    if (!isLive) return;
    hapticSensitiveAction();
    triggerVibration([20, 40, 90]);
    const t = window.setTimeout(() => onCompleteRef.current(), HOLD_MS);
    return () => window.clearTimeout(t);
  }, [isLive]);

  const tone = mode === 'private' ? 'private' : 'social';
  const logo = tone === 'private' ? '/brand/gayze-nav-private.svg?v=20261008-1' : '/brand/gayze-nav-social.svg?v=20261008-1';

  return (
    <div
      className={`g-golive g-golive--${tone} ${isLive ? 'is-live' : 'is-connecting'}`}
      role="status"
      aria-live="polite"
      aria-label={isLive ? 'Your intent is live' : 'Connecting your live intent'}
      onClick={() => { if (isLive) onCompleteRef.current(); }}
    >
      <div className="g-golive__aurora" aria-hidden="true" />
      <GayzeWarp burst={isLive} />
      <div className="g-golive__stage">
        <div className="g-golive__mark" aria-hidden="true">
          {isLive && <><span className="g-golive__shock g-golive__shock--a" /><span className="g-golive__shock g-golive__shock--b" /><span className="g-golive__shock g-golive__shock--c" /></>}
          <span className="g-golive__ring" />
          <span className="g-golive__halo" />
          <img className="g-golive__logo" src={logo} alt="" width={168} height={84} draggable={false} />
        </div>
        <div className="g-golive__copy">
          <div className="g-golive__eyebrow">{isLive ? 'SIGNAL ESTABLISHED' : 'GAYZE NETWORK'}</div>
          <h2 className="g-golive__title" key={isLive ? 'live' : 'connecting'}>
            {isLive ? "You're live." : 'Going live'}
          </h2>
          <p className="g-golive__sub">{isLive ? 'Your signal is on the map.' : 'Reaching the people around you…'}</p>
          {isLive && <span className="g-golive__intent">{intent}</span>}
          {isLive && <span className="g-golive__tap">Tap to continue</span>}
        </div>
      </div>
    </div>
  );
};
