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
    return () => owner.stop();
  }, [userId, peerId]);
  const intent = state.status === 'ready' && state.intent.peerId === peerId && state.intent.expiresAt > now ? state.intent : null;
  const later = Boolean(intent && intent.startsAt > now);
  const spicy = intent?.mode === 'private';
  const minutes = (at: number) => Math.max(1, Math.ceil((at - now) / 60_000));
  return (
    <section
      aria-label={`${peerName}'s current intent`}
      className={`shrink-0 px-3 py-1.5 border-b text-[10.5px] ${
        intent
          ? spicy
            ? 'border-violet-300/20 bg-violet-500/[0.07] text-violet-100'
            : 'border-amber-300/20 bg-amber-500/[0.07] text-amber-100'
          : 'border-white/[0.045] bg-white/[0.012] text-zinc-500'
      }`}
    >
      <div className="flex min-h-[28px] items-center gap-2 min-w-0">
        <span className="shrink-0 text-[9px] uppercase tracking-[0.11em] text-zinc-500">Intent</span>
        {intent ? (
          <>
            <span className={`shrink-0 inline-flex items-center gap-1 rounded-full px-2 py-1 text-[9px] font-bold ${
              spicy ? 'bg-violet-400/10 text-violet-200 border border-violet-300/15' : 'bg-amber-300/10 text-amber-200 border border-amber-300/15'
            }`}>
              {spicy ? <Flame className="w-3 h-3" aria-hidden="true" /> : <Users className="w-3 h-3" aria-hidden="true" />}
              {later ? 'LATER' : 'NOW'}
            </span>
            <span className="truncate font-medium">{intent.intent}</span>
            <span className="ml-auto shrink-0 inline-flex items-center gap-1 text-[9px] text-zinc-500">
              <Clock className="w-3 h-3" aria-hidden="true" />
              {later ? `Starts ${minutes(intent.startsAt)}m` : `Expires ${minutes(intent.expiresAt)}m`}
            </span>
          </>
        ) : (
          <span className="truncate">
            {state.status === 'loading' ? 'Loading current intent…'
              : state.status === 'unavailable' ? 'Current intent unavailable'
              : 'No current intent shared'}
          </span>
        )}
      </div>
    </section>
  )}
