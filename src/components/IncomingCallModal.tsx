import React, { useEffect, useRef, useState } from 'react';
import { Phone, PhoneOff, Video } from 'lucide-react';
import { CallAura, CallOrb, CallSecureChip } from './callUi';
import { triggerVibration, hapticSensitiveAction } from '../services/hapticService';
import type { IncomingCall } from '../services/webrtcService';

interface IncomingCallModalProps {
  incomingCall: IncomingCall | null;
  onAccept: (call: IncomingCall) => void;
  onDecline: (call: IncomingCall) => void;
}

export const IncomingCallModal: React.FC<IncomingCallModalProps> = ({
  incomingCall,
  onAccept,
  onDecline,
}) => {
  const [busy, setBusy] = useState(false);
  const activeCallKey = incomingCall ? `${incomingCall.conversationId}:${incomingCall.callId || incomingCall.timestamp}` : '';
  const handledCallRef = useRef('');

  useEffect(() => {
    setBusy(false);
    handledCallRef.current = '';
    if (!incomingCall) return;

    // Ringer vibration pattern
    triggerVibration([200, 100, 200, 100, 300, 150]);
    const interval = setInterval(() => {
      triggerVibration([200, 100, 200, 100, 300, 150]);
    }, 2400);

    return () => clearInterval(interval);
  }, [incomingCall]);

  if (!incomingCall) return null;

  const isVideo = incomingCall.callType === 'video';

  return (
    <div className="g-call g-call--incoming" data-state="ringing" role="alertdialog" aria-modal="true" aria-label={`Incoming ${isVideo ? 'video' : 'audio'} call from ${incomingCall.callerName}`}>
      <CallAura />
      <header className="g-call__top">
        <CallSecureChip />
      </header>

      <div className="g-call__center">
        <p className="g-call__kicker">{isVideo ? 'Incoming video call' : 'Incoming voice call'}</p>
        <CallOrb name={incomingCall.callerName} state="ringing" />
        <h2 className="g-call__name">{incomingCall.callerName}</h2>
        <p className="g-call__status is-pending">is calling you</p>
      </div>

      <div className="g-call__dock">
        <div className="g-answer">
          <div className="g-answer__col">
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (busy || handledCallRef.current === activeCallKey) return;
                handledCallRef.current = activeCallKey;
                setBusy(true);
                hapticSensitiveAction();
                onDecline(incomingCall);
              }}
              className="g-answer__btn g-answer__btn--decline"
              aria-label="Decline call"
            >
              <PhoneOff className="w-8 h-8" />
            </button>
            <span>Decline</span>
          </div>

          <div className="g-answer__col">
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (busy || handledCallRef.current === activeCallKey) return;
                handledCallRef.current = activeCallKey;
                setBusy(true);
                hapticSensitiveAction();
                onAccept(incomingCall);
              }}
              className="g-answer__btn g-answer__btn--accept"
              aria-label="Accept call"
            >
              {isVideo ? <Video className="w-8 h-8" /> : <Phone className="w-8 h-8" />}
            </button>
            <span>{busy ? 'Connecting…' : 'Answer'}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
