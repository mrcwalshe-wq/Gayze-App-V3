import React, { useEffect, useRef, useState } from 'react';
import { Phone, PhoneOff, Video, ShieldCheck, Lock } from 'lucide-react';
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
    <div className="fixed inset-0 z-[11000] flex items-center justify-center overflow-y-auto bg-[#08070f]/85 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] backdrop-blur-2xl">
      <div className="relative w-full max-w-[360px] overflow-hidden rounded-[32px] border border-white/15 bg-[#11101b]/95 p-6 text-center shadow-[0_30px_100px_rgba(0,0,0,.65)]">
        <div aria-hidden="true" className="pointer-events-none absolute -left-20 -top-24 h-56 w-56 rounded-full bg-[#6F3CC3]/30 blur-[70px]" />
        <div aria-hidden="true" className="pointer-events-none absolute -bottom-24 -right-16 h-52 w-52 rounded-full bg-[#C9A24D]/20 blur-[70px]" />
        <div className="relative space-y-6">
        {/* Security Badge */}
        <div className="mx-auto inline-flex items-center gap-2 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[.16em] text-emerald-200">
          <Lock className="w-3 h-3" />
          <span>Encrypted call</span>
        </div>

        {/* Caller Avatar */}
        <div className="relative mx-auto h-28 w-28">
          <div className="relative flex h-28 w-28 items-center justify-center rounded-full border border-white/15 bg-gradient-to-br from-[#6F3CC3]/35 via-[#171522] to-[#C9A24D]/20 text-[34px] font-semibold text-white shadow-[0_0_55px_rgba(111,60,195,.28)] before:absolute before:inset-[-8px] before:rounded-full before:border before:border-[#6F3CC3]/45 after:absolute after:inset-[-15px] after:rounded-full after:border after:border-[#C9A24D]/20">
            {incomingCall.callerName.charAt(0).toUpperCase()}
          </div>
          <div className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-emerald-500/90 border-2 border-[#0e1017] flex items-center justify-center text-white">
            {isVideo ? <Video className="w-3.5 h-3.5" /> : <Phone className="w-3.5 h-3.5" />}
          </div>
        </div>

        {/* Caller Name & Type */}
        <div className="relative space-y-2">
          <h2 className="text-[25px] font-semibold tracking-[-0.035em] text-white">{incomingCall.callerName}</h2>
          <p className="text-sm text-white/55">
            {isVideo ? 'Encrypted Video Call' : 'Encrypted Audio Call'}
          </p>
        </div>

        <div className="relative flex items-start justify-center gap-12 pt-2">
          {/* Decline */}
          <div className="flex flex-col items-center gap-2">
            <button
              disabled={busy}
              onClick={() => {
                if (busy || handledCallRef.current === activeCallKey) return;
                handledCallRef.current = activeCallKey;
                setBusy(true);
                hapticSensitiveAction();
                onDecline(incomingCall);
              }}
              className="flex h-[68px] w-[68px] cursor-pointer items-center justify-center rounded-full border border-rose-300/20 bg-gradient-to-br from-rose-500 to-rose-700 text-white shadow-[0_12px_32px_rgba(225,29,72,.25)] transition duration-200 hover:scale-105 active:scale-95 disabled:cursor-wait disabled:opacity-50"
              aria-label="Decline call"
            >
              <PhoneOff className="w-7 h-7" />
            </button>
            <span className="text-xs font-semibold text-white/55">Decline</span>
          </div>

          {/* Accept */}
          <div className="flex flex-col items-center gap-2">
            <button
              disabled={busy}
              onClick={() => {
                if (busy || handledCallRef.current === activeCallKey) return;
                handledCallRef.current = activeCallKey;
                setBusy(true);
                hapticSensitiveAction();
                onAccept(incomingCall);
              }}
              className="flex h-[68px] w-[68px] cursor-pointer items-center justify-center rounded-full border border-white/25 bg-gradient-to-br from-[#6F3CC3] via-[#8951d1] to-[#C9A24D] text-white shadow-[0_12px_36px_rgba(111,60,195,.35)] transition duration-200 hover:scale-105 active:scale-95 disabled:cursor-wait disabled:opacity-50"
              aria-label="Accept call"
            >
              {isVideo ? <Video className="w-7 h-7" /> : <Phone className="w-7 h-7" />}
            </button>
            <span className="text-xs font-semibold text-white/75">{busy ? "Connecting…" : "Answer"}</span>
          </div>
        </div>
        </div>
      </div>
    </div>
  );
};
