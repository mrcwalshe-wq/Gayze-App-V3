import React, { useEffect, useRef, useState } from 'react';
import type { TopLevelIntentMode } from '../types';
import { hapticSensitiveAction, triggerVibration } from '../services/hapticService';
import { GayzeWarp } from './GayzeWarp';

interface LiveActivationOverlayProps {
  stage: 'connecting' | 'live';
  mode: TopLevelIntentMode;
  intent: string;
  /** A signal planned for later wears gold; anything within a day wears purple. */
  later?: boolean;
  /** When it starts, e.g. "Right now", "Tonight" or a date. */
  detail?: string;
  onComplete: () => void;
}

/** The go-live event: the Gayze mark rushes out of deep space into the viewer, shockwaves
 *  roll out, and "You're live" lands. Only shown for a confirmed first-time publish;
 *  failure paths dismiss it rather than claiming that the user is live. */
const ARRIVAL_MS = 1100;
const HOLD_MS = 2600;

export const LiveActivationOverlay: React.FC<LiveActivationOverlayProps> = ({ stage, intent, later = false, detail, onComplete }) => {
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

  const tone = later ? 'social' : 'private';
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
      <GayzeWarp burst={isLive} tone={tone} />
      <div className="g-golive__stage">
        <div className="g-golive__mark" aria-hidden="true">
          {isLive && <><span className="g-golive__shock g-golive__shock--a" /><span className="g-golive__shock g-golive__shock--b" /><span className="g-golive__shock g-golive__shock--c" /></>}
          {/* The signal "locks on": a ring draws itself around the mark, then nearby members appear as dots on a radar */}
          <svg className="g-golive__lock" viewBox="0 0 200 200" focusable="false">
            <circle className="g-golive__lock-track" cx="100" cy="100" r="92" />
            <circle className="g-golive__lock-draw" cx="100" cy="100" r="92" pathLength="100" />
            {Array.from({ length: 24 }, (_, i) => <line key={i} className="g-golive__tick" x1="100" y1="2" x2="100" y2={i % 6 === 0 ? 14 : 8} transform={`rotate(${i * 15} 100 100)`} style={{ animationDelay: `${0.5 + i * 0.025}s` }} />)}
          </svg>
          {isLive && [[-92, -34], [78, -70], [104, 38], [-70, 86], [24, 112], [-118, 20], [60, 96]].map(([x, y], i) => (
            <span key={i} className="g-golive__blip" style={{ ['--x' as string]: `${x}px`, ['--y' as string]: `${y}px`, animationDelay: `${0.55 + i * 0.16}s` }} />
          ))}
          <span className="g-golive__halo" />
          <img className="g-golive__logo" src={logo} alt="" width={168} height={84} draggable={false} />
        </div>
        <div className="g-golive__copy">
          <div className="g-golive__eyebrow">{isLive ? 'SIGNAL ESTABLISHED' : 'GAYZE NETWORK'}</div>
          <h2 className="g-golive__title" key={isLive ? 'live' : 'connecting'} aria-label={isLive ? "You're live." : 'Going live'}>
            {isLive
              ? Array.from("You're live.").map((ch, i) => <span key={i} className="g-golive__ch" aria-hidden="true" style={{ animationDelay: `${0.12 + i * 0.045}s` }}>{ch === ' ' ? '\u00a0' : ch}</span>)
              : 'Going live'}
          </h2>
          <p className="g-golive__sub">{isLive ? 'Your signal is on the map.' : 'Reaching the people around you…'}</p>
          {isLive && <span className="g-golive__intent"><b>{intent}</b>{detail && <i>{detail}</i>}</span>}
          {isLive && <span className="g-golive__tap">Tap to continue</span>}
          {isLive && <span className="g-golive__time" aria-hidden="true" style={{ animationDuration: `${HOLD_MS}ms` }} />}
        </div>
      </div>
    </div>
  );
};
