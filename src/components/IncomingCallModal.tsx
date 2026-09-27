import React, { useEffect } from 'react';
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
  useEffect(() => {
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in">
      <div className="relative w-full max-w-sm bg-[#0e1017] border border-white/10 rounded-3xl p-6 shadow-2xl space-y-6 text-center">
        {/* Security Badge */}
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-950/60 border border-emerald-500/40 text-emerald-300 text-xs font-mono">
          <Lock className="w-3 h-3 text-emerald-400" />
          <span>INCOMING ENCRYPTED CALL</span>
        </div>

        {/* Caller Avatar */}
        <div className="relative mx-auto w-24 h-24">
          <div className="w-24 h-24 rounded-full bg-[#181a24] border-2 border-[#C9A24D] flex items-center justify-center text-3xl font-bold text-[#C9A24D] shadow-xl animate-pulse">
            {incomingCall.callerName.charAt(0).toUpperCase()}
          </div>
          <div className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-emerald-500 border-2 border-[#0e1017] flex items-center justify-center text-white">
            {isVideo ? <Video className="w-3.5 h-3.5" /> : <Phone className="w-3.5 h-3.5" />}
          </div>
        </div>

        {/* Caller Name & Type */}
        <div className="space-y-1">
          <h2 className="text-xl font-bold text-white tracking-wide">{incomingCall.callerName}</h2>
          <p className="text-xs text-zinc-400">
            {isVideo ? 'Encrypted Video Call' : 'Encrypted Audio Call'}
          </p>
        </div>

        <div className="pt-2 flex items-center justify-center gap-8">
          {/* Decline */}
          <div className="flex flex-col items-center gap-2">
            <button
              onClick={() => {
                hapticSensitiveAction();
                onDecline(incomingCall);
              }}
              className="w-16 h-16 rounded-full bg-rose-600 hover:bg-rose-500 text-white flex items-center justify-center shadow-lg shadow-rose-950/60 transition-transform active:scale-95 cursor-pointer"
              aria-label="Decline call"
            >
              <PhoneOff className="w-7 h-7" />
            </button>
            <span className="text-xs font-semibold text-zinc-400">Decline</span>
          </div>

          {/* Accept */}
          <div className="flex flex-col items-center gap-2">
            <button
              onClick={() => {
                hapticSensitiveAction();
                onAccept(incomingCall);
              }}
              className="w-16 h-16 rounded-full bg-emerald-500 hover:bg-emerald-400 text-black flex items-center justify-center shadow-lg shadow-emerald-950/60 transition-transform active:scale-95 cursor-pointer animate-bounce"
              aria-label="Accept call"
            >
              {isVideo ? <Video className="w-7 h-7" /> : <Phone className="w-7 h-7" />}
            </button>
            <span className="text-xs font-semibold text-emerald-400">Accept</span>
          </div>
        </div>
      </div>
    </div>
  );
};
