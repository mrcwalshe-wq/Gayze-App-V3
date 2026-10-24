import React, { useEffect, useRef } from 'react';
import { Lock, ShieldCheck } from 'lucide-react';
import { webrtcCallService, type CallState } from '../services/webrtcService';

/**
 * Shared presentation for audio, video and incoming calls. Nothing in here touches
 * call signalling; it only draws state the call components already hold.
 */

export const formatCallDuration = (secs: number) => {
  const hours = Math.floor(secs / 3600);
  const mins = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  const mm = mins.toString().padStart(2, '0');
  const ss = s.toString().padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
};

export const callStatusLabel = (state: CallState, kind: 'audio' | 'video', peerName: string): string => {
  switch (state) {
    case 'calling': return 'Calling';
    case 'ringing': return 'Ringing';
    case 'connecting': return 'Securing the line';
    case 'connected': return kind === 'video' ? 'Video call' : 'Voice call';
    case 'declined': return `${peerName} is unavailable`;
    case 'missed': return 'No answer';
    case 'failed': return 'Connection failed';
    default: return 'Call ended';
  }
};

export const isCallPending = (state: CallState) => state === 'calling' || state === 'ringing' || state === 'connecting';
export const isCallTerminal = (state: CallState) => state === 'declined' || state === 'missed' || state === 'failed' || state === 'ended';

/**
 * Drives `--lvl` (their voice) and `--mic` (yours) on the returned element, 0..1,
 * from Web Audio analysers. It writes CSS variables directly so the call screen
 * does not re-render sixty times a second. If the browser will not give an
 * analyser (some iOS builds), the variables stay at 0 and the idle animation
 * in CSS carries the look.
 */
export function useCallLevels<T extends HTMLElement>(active: boolean) {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    if (!active) return;
    const Ctor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;

    let ctx: AudioContext | null = null;
    try { ctx = new Ctor(); } catch { return; }
    void ctx.resume().catch(() => undefined);

    type Tap = { source: MediaStreamAudioSourceNode; analyser: AnalyserNode; data: Uint8Array<ArrayBuffer>; level: number; id: string };
    const taps: { remote: Tap | null; local: Tap | null } = { remote: null, local: null };

    const makeTap = (stream: MediaStream | null): Tap | null => {
      if (!ctx || !stream || stream.getAudioTracks().length === 0) return null;
      try {
        const source = ctx.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = 0.6;
        source.connect(analyser); // not to destination: the call element plays the audio
        return { source, analyser, data: new Uint8Array(analyser.fftSize), level: 0, id: stream.getAudioTracks().map((t) => t.id).join(',') };
      } catch {
        return null;
      }
    };

    const attach = (local: MediaStream | null, remote: MediaStream | null) => {
      const remoteId = remote ? remote.getAudioTracks().map((t) => t.id).join(',') : '';
      const localId = local ? local.getAudioTracks().map((t) => t.id).join(',') : '';
      if (taps.remote?.id !== remoteId) { taps.remote?.source.disconnect(); taps.remote = makeTap(remote); }
      if (taps.local?.id !== localId) { taps.local?.source.disconnect(); taps.local = makeTap(local); }
    };

    const unsubscribe = webrtcCallService.subscribeStreams(attach);

    const measure = (tap: Tap | null) => {
      if (!tap) return 0;
      tap.analyser.getByteTimeDomainData(tap.data);
      let sum = 0;
      for (let i = 0; i < tap.data.length; i += 1) {
        const v = (tap.data[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / tap.data.length);
      // Fast attack, slow release, so peaks pop and then settle.
      tap.level = Math.max(Math.min(1, rms * 5), tap.level * 0.9);
      return tap.level;
    };

    let raf = 0;
    const tick = () => {
      const el = ref.current;
      if (el) {
        el.style.setProperty('--lvl', measure(taps.remote).toFixed(3));
        el.style.setProperty('--mic', measure(taps.local).toFixed(3));
      }
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);

    return () => {
      window.cancelAnimationFrame(raf);
      unsubscribe();
      taps.remote?.source.disconnect();
      taps.local?.source.disconnect();
      void ctx?.close().catch(() => undefined);
    };
  }, [active]);

  return ref;
}

/** Drifting aurora in the Gayze hues; colours follow the call state via CSS. */
export const CallAura: React.FC = () => (
  <div className="g-call__aura" aria-hidden="true">
    <span className="g-call__blob g-call__blob--a" />
    <span className="g-call__blob g-call__blob--b" />
    <span className="g-call__blob g-call__blob--c" />
    <span className="g-call__grain" />
  </div>
);

interface CallOrbProps {
  name: string;
  avatar?: string;
  state: CallState;
  size?: 'lg' | 'md';
}

/** Avatar with an orbiting hue ring and voice-reactive halos. */
export const CallOrb: React.FC<CallOrbProps> = ({ name, avatar, state, size = 'lg' }) => (
  <div className={`g-orb g-orb--${size}`} data-state={state}>
    <span className="g-orb__halo g-orb__halo--3" aria-hidden="true" />
    <span className="g-orb__halo g-orb__halo--2" aria-hidden="true" />
    <span className="g-orb__halo g-orb__halo--1" aria-hidden="true" />
    <span className="g-orb__ripple" aria-hidden="true" />
    <span className="g-orb__ripple g-orb__ripple--2" aria-hidden="true" />
    <span className="g-orb__ripple g-orb__ripple--3" aria-hidden="true" />
    <span className="g-orb__spin" aria-hidden="true" />
    <span className="g-orb__face">
      <span aria-hidden="true">{name.charAt(0).toUpperCase() || 'G'}</span>
      {avatar && (
        <img
          src={avatar}
          alt=""
          onError={(event) => { event.currentTarget.style.display = 'none'; }}
        />
      )}
    </span>
    {state === 'connected' && (
      <span className="g-orb__shield" aria-hidden="true"><ShieldCheck className="w-4 h-4" /></span>
    )}
  </div>
);

/** Reactive equaliser ribbon for voice calls. */
export const CallVoiceBars: React.FC = () => (
  <div className="g-voice" aria-hidden="true">
    {Array.from({ length: 15 }, (_, i) => (
      <span key={i} style={{ ['--i' as string]: i, ['--k' as string]: (0.55 + ((i * 7) % 9) / 9).toFixed(2) }} />
    ))}
  </div>
);

export const CallSecureChip: React.FC<{ label?: string }> = ({ label = 'End-to-end encrypted' }) => (
  <span className="g-call__chip"><Lock className="w-3 h-3" />{label}</span>
);

interface DockButtonProps {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  off?: boolean;
  danger?: boolean;
  ariaLabel?: string;
}

export const CallDockButton: React.FC<DockButtonProps> = ({ label, icon, onClick, off, danger, ariaLabel }) => (
  <button
    type="button"
    className={`g-dock__btn ${off ? 'is-off' : ''} ${danger ? 'is-danger' : ''}`}
    onClick={(event) => { event.stopPropagation(); onClick(); }}
    aria-label={ariaLabel ?? label}
    aria-pressed={off === undefined ? undefined : off}
  >
    <span className="g-dock__icon">{icon}</span>
    <span className="g-dock__label">{label}</span>
  </button>
);

/**
 * Self-view that can be dragged and snaps to the nearest corner when released.
 * The video element itself is supplied by the caller so its ref stays theirs.
 */
export const DraggablePip: React.FC<{ hidden?: boolean; children: React.ReactNode; label?: string }> = ({ hidden, children, label = 'You' }) => {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number; moved: boolean } | null>(null);
  const corner = useRef({ right: true, bottom: false });

  const place = (animate: boolean) => {
    const box = boxRef.current;
    if (!box) return;
    const parent = box.parentElement;
    if (!parent) return;
    const margin = 14;
    const topInset = 86;
    const bottomInset = 190;
    const { width: pw, height: ph } = parent.getBoundingClientRect();
    const x = corner.current.right ? pw - box.offsetWidth - margin : margin;
    const y = corner.current.bottom ? ph - box.offsetHeight - bottomInset : topInset;
    box.style.transition = animate ? 'transform .35s cubic-bezier(.2,.9,.25,1.1)' : 'none';
    box.style.transform = `translate(${x}px, ${y}px)`;
  };

  useEffect(() => {
    place(false);
    const onResize = () => place(false);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  });

  const onDown = (event: React.PointerEvent) => {
    event.stopPropagation();
    const box = boxRef.current;
    if (!box) return;
    const rect = box.getBoundingClientRect();
    const parentRect = box.parentElement?.getBoundingClientRect();
    drag.current = { x: event.clientX, y: event.clientY, ox: rect.left - (parentRect?.left ?? 0), oy: rect.top - (parentRect?.top ?? 0), moved: false };
    box.setPointerCapture?.(event.pointerId);
    box.style.transition = 'none';
  };
  const onMove = (event: React.PointerEvent) => {
    const state = drag.current;
    const box = boxRef.current;
    if (!state || !box) return;
    state.moved = true;
    box.style.transform = `translate(${state.ox + event.clientX - state.x}px, ${state.oy + event.clientY - state.y}px)`;
  };
  const onUp = (event: React.PointerEvent) => {
    event.stopPropagation();
    const state = drag.current;
    const box = boxRef.current;
    drag.current = null;
    if (!state || !box) return;
    const parent = box.parentElement?.getBoundingClientRect();
    if (parent) {
      const centerX = state.ox + event.clientX - state.x + box.offsetWidth / 2;
      const centerY = state.oy + event.clientY - state.y + box.offsetHeight / 2;
      corner.current = { right: centerX > parent.width / 2, bottom: centerY > parent.height / 2 };
    }
    place(true);
  };

  return (
    <div
      ref={boxRef}
      className={`g-pip ${hidden ? 'is-hidden' : ''}`}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onClick={(event) => event.stopPropagation()}
    >
      {children}
      <span className="g-pip__label">{label}</span>
    </div>
  );
};
