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
    <section aria-label={`${peerName}'s current intent`} className={`shrink-0 px-3 sm:px-4 py-2 border-b text-xs ${intent
      ? spicy ? 'border-violet-400/20 bg-violet-500/10 text-violet-200' : 'border-amber-400/20 bg-amber-500/10 text-amber-200'
      : 'border-white/[0.06] text-zinc-500'}`}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-[10px] text-zinc-400">{peerName}'s current intent</span>
        {intent ? <>
          <strong>{later ? 'LATER' : 'NOW'}</strong>
          {spicy ? <Flame className="w-3 h-3" aria-hidden="true" /> : <Users className="w-3 h-3" aria-hidden="true" />}
          <span>{spicy ? 'Spicy' : 'Social'}</span>
          <span className="truncate max-w-full">{intent.intent}</span>
          <span className="flex items-center gap-1 text-[10px] text-zinc-400">
            <Clock className="w-3 h-3" aria-hidden="true" />
            {later && `Starts in ${minutes(intent.startsAt)}m · `}Expires in {minutes(intent.expiresAt)}m
          </span>
        </> : <span>{state.status === 'loading' ? 'Loading current intent…'
          : state.status === 'unavailable' ? 'Current intent unavailable' : 'No current intent shared'}</span>}
      </div>
    </section>
  );
}
