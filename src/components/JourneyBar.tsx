import React from 'react';
import { ArrowUp, Check, Loader2, X } from 'lucide-react';
import { formatMeters } from '../services/journey';
import type { JourneyLive } from '../services/useJourney';

interface JourneyBarProps {
  venueName: string;
  peerName: string;
  share: boolean;
  live: JourneyLive;
  onStop: () => void;
}

const headline = (live: JourneyLive): { text: string; sub: string } => {
  if (live.arrived) return { text: 'You’ve arrived', sub: 'Have a great time.' };
  if (live.gpsError && live.distM == null) return { text: 'Finding you…', sub: live.gpsError };
  if (live.direction === 'unknown') {
    return live.compass === 'denied'
      ? { text: 'Compass is off', sub: 'Allow motion access in Settings, or just start walking and we’ll use your direction of travel.' }
      : { text: 'Finding your direction…', sub: 'Walk a few steps, or hold your phone flat.' };
  }
  const side = (live.turn ?? 0) > 0 ? 'right' : 'left';
  if (live.direction === 'good') return { text: 'Right way', sub: 'Keep going.' };
  if (live.direction === 'near') return { text: `Veer ${side}`, sub: 'Nearly there — a small turn.' };
  return { text: Math.abs(live.turn ?? 0) > 140 ? 'Wrong way — turn around' : `Wrong way — turn ${side}`, sub: 'Your destination is not that way.' };
};

/** A find-my-style guide at the top of the screen: green when you face the place, red when you do not. */
export const JourneyBar: React.FC<JourneyBarProps> = ({ venueName, peerName, share, live, onStop }) => {
  const { text, sub } = headline(live);
  const state = live.arrived ? 'arrived' : live.direction;
  const eta = live.etaMin == null ? '' : live.etaMin < 1 ? 'under a minute' : `about ${Math.round(live.etaMin)} min`;
  return (
    <section className={`g-jbar g-jbar--${state}`} role="status" aria-live="polite" aria-label={`Heading to ${venueName}`}>
      <span className="g-jbar__dial" aria-hidden="true">
        {live.arrived ? <Check className="w-6 h-6" /> : live.direction === 'unknown'
          ? <Loader2 className="w-6 h-6 g-place__spin" />
          : <ArrowUp className="w-7 h-7" style={{ transform: `rotate(${live.turn ?? 0}deg)` }} />}
      </span>
      <div className="g-jbar__main">
        <strong>{text}</strong>
        <small>{sub}</small>
        <span className="g-jbar__meta">
          <b>{venueName}</b>
          {live.distM != null && !live.arrived && <> · {formatMeters(live.distM)}{eta ? ` · ${eta}` : ''}</>}
        </span>
        {live.sendError && <span className="g-jbar__warn">Couldn’t send your update to {peerName}. Retrying.</span>}
        {share && !live.sendError && !live.arrived && <span className="g-jbar__fine">Keeping {peerName} posted</span>}
      </div>
      <button type="button" className="g-jbar__stop" onClick={onStop} aria-label="Stop"><X className="w-4 h-4" /></button>
    </section>
  );
};
