import React, { useEffect, useState } from 'react';
import { Clock, Flame, Users } from 'lucide-react';
import { watchPeerIntent, type PeerIntentState } from '../services/peerIntent';

/** Mounted with a room/account/peer key. Historical connectionContext is NOT current intent. */
export function PeerIntentBanner({ userId, peerId, peerName, now }: {
  userId: string; peerId: string; peerName: string; now: number;
}) {
  const [state, setState] = useState<PeerIntentState>({ status: 'loading' });
  useEffect(() => {
    const owner = watchPeerIntent(userId, peerId, setState);
    return (
    <section aria-label={`${peerName}'s current intent`} aria-live="polite"
      className={`peer-intent-card peer-intent-card--${intent ? spicy ? 'private' : 'social' : 'quiet'} shrink-0`}>
      {intent && <div className="peer-intent-card__sparks" aria-hidden="true">
        {Array.from({ length: 14 }, (_, i) => <i key={i} style={{ '--spark-index': i } as React.CSSProperties} />)}
      </div>}
      <div className="peer-intent-card__content">
        <div className="peer-intent-card__topline">
          <span className="peer-intent-card__eyebrow">{peerName}'s live intent</span>
          {intent ? <span className={`peer-intent-card__state ${later ? 'is-later' : 'is-live'}`}>
            <span className="peer-intent-card__state-dot" />{later ? 'COMING UP' : 'LIVE NOW'}
          </span> : <span className="peer-intent-card__state is-quiet">
            {state.status === 'loading' ? 'CHECKING' : state.status === 'unavailable' ? 'UNAVAILABLE' : 'NO ACTIVE INTENT'}
          </span>}
        </div>
        {intent ? <>
          <div className="peer-intent-card__main">
            <span className="peer-intent-card__icon">{spicy ? <Flame aria-hidden="true" /> : <Users aria-hidden="true" />}</span>
            <div className="peer-intent-card__details">
              <span className="peer-intent-card__category">{spicy ? 'PRIVATE' : 'SOCIAL'} · {later ? 'LATER' : 'RIGHT NOW'}</span>
              <strong className="peer-intent-card__intent">{intent.intent}</strong>
            </div>
          </div>
          <div className="peer-intent-card__footer">
            <span className="peer-intent-card__sparkline" aria-hidden="true">✦</span>
            <span>{later && `Starts in ${minutes(intent.startsAt)}m · `}Expires in {minutes(intent.expiresAt)}m</span>
            <Clock aria-hidden="true" />
          </div>
        </> : <div className="peer-intent-card__empty">
          {state.status === 'loading' ? 'Checking for their current signal…'
            : state.status === 'unavailable' ? 'Live intent status could not be refreshed.'
            : 'No active signal shared right now.'}
        </div>}
      </div>
    </section>
  );
}
