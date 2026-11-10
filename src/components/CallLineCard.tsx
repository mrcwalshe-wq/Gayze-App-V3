import React from 'react';
import { PhoneMissed, PhoneOff, RotateCcw, Video, Phone, Mic } from 'lucide-react';
import type { CallLine } from '../types';
import { hapticLight } from '../services/hapticService';

interface CallLineCardProps {
  call: CallLine;
  /** Whether this person placed the call. */
  isCaller: boolean;
  peerName: string;
  time: number;
  /** Only the newest call in the chat offers a retry. */
  canRetry: boolean;
  onRetry: (callType: 'audio' | 'video') => void;
  /** Offered to the caller of an unanswered call: record a voice message or video note instead. */
  onLeaveNote?: (kind: 'audio' | 'video') => void;
  /** How many calls in a row this line stands for (a run of the same missed call is shown once). */
  count?: number;
}

/** "Unanswered call" for the person who rang, "Missed call" for the person who was rung, with a way back in. */
export const CallLineCard: React.FC<CallLineCardProps> = ({ call, isCaller, peerName, time, canRetry, onRetry, onLeaveNote, count = 1 }) => {
  const kind = call.callType === 'video' ? 'video' : 'voice';
  const declined = call.outcome === 'declined';
  const title = isCaller ? (declined ? 'Call declined' : 'Unanswered call') : 'Missed call';
  const _sub = isCaller
    ? (declined ? `${peerName} couldn't pick up` : `${peerName} didn't pick up`)
    : `${peerName} tried to reach you`;
  const Icon = isCaller && declined ? PhoneOff : PhoneMissed;
  const Kind = call.callType === 'video' ? Video : Phone;
  const when = new Date(time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <article className={`g-calln ${isCaller ? 'g-calln--out' : 'g-calln--in'}`} aria-label={`${title}, ${kind} call, ${when}`}>
      <span className="g-calln__orb" aria-hidden="true"><Icon className="w-5 h-5" /></span>
      <div className="g-calln__body">
        <p className="g-calln__title">{title}{count > 1 && <span className="g-calln__count">×{count}</span>}</p>
        <p className="g-calln__hint"><Kind className="w-3 h-3" aria-hidden="true" />{kind === 'video' ? 'Video' : 'Voice'} · {when}</p>
      </div>
      {canRetry && (
        <div className="g-calln__actions">
          {isCaller && !declined && onLeaveNote && (
            <button type="button" className="g-calln__retry g-calln__retry--lead" onClick={() => { hapticLight(); onLeaveNote(call.callType); }}>
              <Mic className="w-3.5 h-3.5" aria-hidden="true" />Leave a message
            </button>
          )}
          <button type="button" className="g-calln__retry g-calln__retry--quiet" onClick={() => { hapticLight(); onRetry(call.callType); }}>
            <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />{isCaller ? 'Try again' : 'Call back'}
          </button>
        </div>
      )}
    </article>
  );
};
