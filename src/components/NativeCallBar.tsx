import React, { useEffect, useState } from 'react';
import { Mic, MicOff, PhoneOff } from 'lucide-react';
import { hapticLight, hapticSensitiveAction } from '../services/hapticService';
import type { NativeCallInfo } from '../services/nativeCalls';

interface Props {
  call: NativeCallInfo | null;
  onEnd: () => void;
  onToggleMute: (muted: boolean) => void;
}

/**
 * A voice call answered on the iPhone call screen is carried by the phone itself, not by this page. When the app is open during
 * such a call, this bar shows it and offers Mute and End; the iPhone call screen has the same controls.
 */
export const NativeCallBar: React.FC<Props> = ({ call, onEnd, onToggleMute }) => {
  const [seconds, setSeconds] = useState(0);
  const connected = call?.state === 'connected';
  useEffect(() => {
    if (!connected) { setSeconds(0); return; }
    const started = Date.now();
    const t = window.setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(t);
  }, [connected, call?.callId]);
  if (!call?.active) return null;
  const time = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  return (
    <section className="g-ncall" role="status" aria-live="polite" aria-label={`Voice call with ${call.callerName ?? 'Gayze member'}`}>
      <span className="g-ncall__dot" aria-hidden="true" />
      <div className="g-ncall__main">
        <strong>{call.callerName ?? 'Gayze member'}</strong>
        <small>{connected ? `Voice call · ${time}` : 'Connecting…'}</small>
      </div>
      <button type="button" className="g-ncall__btn" aria-pressed={Boolean(call.muted)} aria-label={call.muted ? 'Unmute' : 'Mute'}
        onClick={() => { hapticLight(); onToggleMute(!call.muted); }}>
        {call.muted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
      </button>
      <button type="button" className="g-ncall__btn g-ncall__btn--end" aria-label="End call" onClick={() => { hapticSensitiveAction(); onEnd(); }}>
        <PhoneOff className="w-5 h-5" />
      </button>
    </section>
  );
};
