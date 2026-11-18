import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { GayzeWarp } from './GayzeWarp';
import { hapticSensitiveAction, triggerVibration } from '../services/hapticService';
import { playAppSound } from '../services/appSounds';
import './GayzeArrival.css';

/**
 * The moment a received Gayze is opened. The chat is already open underneath; this plays on top of it:
 *   1. charge  – stars rush in, the Gayze eye glows into view at the centre
 *   2. burst   – sparks erupt, "You've been Gayzed" lands with the sender's name
 *   3. whoosh  – the eye zooms past the viewer in a flash of light and the dark field blows away to reveal the chat
 * About 2.3 s in total. Tapping skips straight to the whoosh. Reduced motion gets a short fade with no zoom.
 */
const BURST_MS = 650;
const WHOOSH_MS = 1550;
/** Safety net only: the overlay normally closes when the whoosh animation itself ends. */
const WHOOSH_FALLBACK_MS = 1400;
const REDUCED_DONE_MS = 900;

interface GayzeArrivalProps {
  /** Who sent the Gayze; omitted when unknown. */
  peerName?: string;
  onDone: () => void;
}

export const GayzeArrival: React.FC<GayzeArrivalProps> = ({ peerName, onDone }) => {
  const onDoneRef = useRef(onDone);
  useEffect(() => { onDoneRef.current = onDone; }, [onDone]);

  const reduced = typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  const [phase, setPhase] = useState<'charge' | 'burst' | 'whoosh'>(reduced ? 'burst' : 'charge');
  const finished = useRef(false);
  const timers = useRef<number[]>([]);
  const ended = useRef(new Set<string>());

  const finish = () => {
    if (finished.current) return;
    finished.current = true;
    onDoneRef.current();
  };

  const whoosh = () => {
    setPhase('whoosh');
    triggerVibration([12, 30, 40]);
    timers.current.push(window.setTimeout(finish, WHOOSH_FALLBACK_MS));
  };

  useEffect(() => {
    hapticSensitiveAction();
    playAppSound('gayze');
    if (reduced) {
      timers.current.push(window.setTimeout(finish, REDUCED_DONE_MS));
    } else {
      timers.current.push(window.setTimeout(() => { setPhase('burst'); triggerVibration([20, 40, 90]); }, BURST_MS));
      timers.current.push(window.setTimeout(whoosh, WHOOSH_MS));
    }
    const list = timers.current;
    return () => { list.forEach((t) => window.clearTimeout(t)); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const skip = () => {
    if (reduced) { finish(); return; }
    if (phase === 'whoosh') return;
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
    whoosh();
  };

  const name = peerName?.trim();
  const title = "You've been Gayzed";

  return createPortal(
    <div
      className={`g-arrive is-${phase}${reduced ? ' is-reduced' : ''}`}
      role="status"
      aria-live="polite"
      aria-label={name ? `${title} by ${name}. Opening your conversation.` : `${title}. Opening your conversation.`}
      onClick={skip}
      // Close once both the eye's zoom and the veil have finished, so a busy phone never cuts the whoosh short.
      onAnimationEnd={(e) => {
        if (e.animationName !== 'ga-veil-out' && e.animationName !== 'ga-eye-whoosh') return;
        ended.current.add(e.animationName);
        if (ended.current.size === 2) finish();
      }}
    >
      <div className="g-arrive__veil" aria-hidden="true">
        <div className="g-arrive__aurora" />
        {!reduced && <GayzeWarp burst={phase !== 'charge'} />}
      </div>
      {!reduced && <div className="g-arrive__flash" aria-hidden="true" />}
      <div className="g-arrive__stage" aria-hidden="true">
        <div className="g-arrive__eye">
          {phase !== 'charge' && <><span className="g-arrive__ring g-arrive__ring--a" /><span className="g-arrive__ring g-arrive__ring--b" /></>}
          <span className="g-arrive__halo" />
          <img className="g-arrive__logo" src="/brand/gayze-nav-v3.svg?v=20261008-1" alt="" width={168} height={84} draggable={false} />
        </div>
        <div className="g-arrive__copy">
          <h2 className="g-arrive__title">
            {Array.from(title).map((ch, i) => (
              <span key={i} className="g-arrive__ch" style={{ animationDelay: `${0.05 + i * 0.03}s` }}>{ch === ' ' ? ' ' : ch}</span>
            ))}
          </h2>
          {name && <p className="g-arrive__sub"><span>by</span> {name}</p>}
        </div>
      </div>
    </div>,
    document.body,
  );
};
