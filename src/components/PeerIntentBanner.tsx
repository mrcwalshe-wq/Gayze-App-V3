import React, { useEffect, useState } from 'react';
import { Clock, Users } from 'lucide-react';
import { watchPeerIntent, type PeerIntentState } from '../services/peerIntent';
import { SparkWaterfall } from './SparkWaterfall';
import { intentDisplayLabel } from '../services/intentLabels';

/** Mounted with a room/account/peer key. Historical connectionContext is NOT current intent. */
export function PeerIntentBanner({ userId, peerId, peerName, now }: {
  userId: string; peerId: string; peerName: string; now: number;
}) {
  const [state, setState] = useState<PeerIntentState>({ status: 'loading' });
  useEffect(() => {
    const owner = watchPeerIntent(userId, peerId, setState);
    return () => owner.stop();
  }, [userId, peerId]);

  const intent = state.status === 'ready' && state.intent.peerId === peerId && state.intent.expiresAt > now ? state.intent : null;
  const later = Boolean(intent && intent.startsAt > now);
  const minutes = (at: number) => Math.max(1, Math.ceil((at - now) / 60_000));

  // Nothing to say, nothing to draw: no box announcing the absence of an intent.
  if (!intent) return null;

  return (
    <section aria-label={`${peerName}'s current intent`} aria-live="polite"
      className={`peer-intent-card peer-intent-card--social peer-intent-card--compact shrink-0`}>
      <div className="peer-intent-card__curtain" aria-hidden="true" />
      <SparkWaterfall mode="social" />
      <div className="peer-intent-card__row">
        <span className="peer-intent-card__icon"><Users aria-hidden="true" /></span>
        <div className="peer-intent-card__details">
          <span className="peer-intent-card__category">
            <span className={`peer-intent-card__state-dot ${later ? 'is-later' : ''}`} />
            {peerName} · {later ? 'LATER' : 'RIGHT NOW'}
          </span>
          <strong className="peer-intent-card__intent">{intentDisplayLabel(intent.intent)}</strong>
        </div>
        <span className="peer-intent-card__time">
          <Clock aria-hidden="true" />
          {later ? `In ${minutes(intent.startsAt)}m` : `${minutes(intent.expiresAt)}m left`}
        </span>
      </div>
    </section>
  );
}
