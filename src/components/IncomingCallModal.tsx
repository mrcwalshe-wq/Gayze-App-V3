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
      <div className="g-panel relative w-full max-w-sm p-6 !rounded-[22px] space-y-6 text-center">
        {/* Security Badge */}
        <div className="g-badge g-badge--verify">
          <Lock className="w-3 h-3" />
          <span>Encrypted call</span>
        </div>

        {/* Caller Avatar */}
        <div className="relative mx-auto w-24 h-24">
          <div className="g-ring-breathe w-24 h-24 rounded-full bg-[#151720] flex items-center justify-center text-[30px] font-semibold text-[#C9A24D]">
            {incomingCall.callerName.charAt(0).toUpperCase()}
          </div>
          <div className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-emerald-500/90 border-2 border-[#0e1017] flex items-center justify-center text-white">
            {isVideo ? <Video className="w-3.5 h-3.5" /> : <Phone className="w-3.5 h-3.5" />}
          </div>
        </div>

        {/* Caller Name & Type */}
        <div className="space-y-1">
          <h2 className="text-[19px] font-semibold text-white tracking-[-0.015em]">{incomingCall.callerName}</h2>
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
              className="w-16 h-16 rounded-full bg-emerald-500 hover:bg-emerald-400 text-black flex items-center justify-center transition-transform active:scale-95 cursor-pointer"
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
