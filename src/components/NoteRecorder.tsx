import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Mic, Video, X, Send, RotateCcw, Square, Circle } from 'lucide-react';
import type { VoiceNote } from '../types';
import { MAX_NOTE_CHARS } from '../services/meetupWire';
import { hapticLight, hapticSensitiveAction } from '../services/hapticService';

/** Kept short on purpose: the note travels inside the encrypted message, and a long clip would be too big to deliver live. */
const LIMITS = { audio: 45, video: 10 } as const;

const pickMime = (kind: 'audio' | 'video'): string | undefined => {
  const options = kind === 'video' ? ['video/mp4', 'video/webm;codecs=vp8,opus', 'video/webm'] : ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'];
  return typeof MediaRecorder !== 'undefined' ? options.find((m) => MediaRecorder.isTypeSupported(m)) : undefined;
};

const toDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(new Error('The recording could not be read.'));
  reader.readAsDataURL(blob);
});

interface NoteRecorderProps {
  isOpen: boolean;
  peerName: string;
  /** Which kind to offer first (a missed video call suggests a video note). */
  initialKind?: 'audio' | 'video';
  onClose: () => void;
  onSend: (note: VoiceNote) => Promise<void>;
}

/** Record a short voice message or video note to leave for someone who didn't pick up. */
export const NoteRecorder: React.FC<NoteRecorderProps> = ({ isOpen, peerName, initialKind = 'audio', onClose, onSend }) => {
  const [kind, setKind] = useState<'audio' | 'video'>(initialKind);
  const [phase, setPhase] = useState<'idle' | 'recording' | 'review' | 'sending'>('idle');
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ url: string; note: VoiceNote } | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const startedRef = useRef(0);
  const liveRef = useRef<HTMLVideoElement | null>(null);

  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (timerRef.current !== null) { window.clearInterval(timerRef.current); timerRef.current = null; }
  }, []);

  const reset = useCallback(() => {
    releaseStream();
    const r = recorderRef.current; recorderRef.current = null;
    if (r && r.state !== 'inactive') { r.onstop = null; try { r.stop(); } catch { /* already stopped */ } }
    setPreview(null); setPhase('idle'); setSeconds(0); setError(null);
  }, [releaseStream]);

  useEffect(() => { if (isOpen) { setKind(initialKind); } else reset(); }, [isOpen, initialKind, reset]);
  useEffect(() => () => releaseStream(), [releaseStream]);
  useEffect(() => { if (liveRef.current && streamRef.current && phase === 'recording' && kind === 'video') { liveRef.current.srcObject = streamRef.current; void liveRef.current.play().catch(() => undefined); } }, [phase, kind]);

  const stop = useCallback(() => {
    const r = recorderRef.current;
    if (r && r.state === 'recording') r.stop();
  }, []);

  const start = async () => {
    setError(null);
    hapticLight();
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') { setError('Recording isn’t supported in this browser.'); return; }
    const mime = pickMime(kind);
    try {
      // Asked straight from the tap, so the phone shows its permission prompt.
      const stream = await navigator.mediaDevices.getUserMedia(
        kind === 'video'
          ? { audio: { echoCancellation: true, noiseSuppression: true }, video: { facingMode: 'user', width: { ideal: 480 }, height: { ideal: 480 }, frameRate: { ideal: 24, max: 30 } } }
          : { audio: { echoCancellation: true, noiseSuppression: true } });
      streamRef.current = stream;
      chunksRef.current = [];
      const recorder = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), audioBitsPerSecond: 24_000, ...(kind === 'video' ? { videoBitsPerSecond: 200_000 } : {}) });
      recorderRef.current = recorder;
      recorder.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data); };
      recorder.onstop = async () => {
        const length = Math.max(1, Math.round((Date.now() - startedRef.current) / 1000));
        releaseStream();
        const base = (recorder.mimeType || mime || (kind === 'video' ? 'video/mp4' : 'audio/mp4')).split(';')[0].toLowerCase();
        const blob = new Blob(chunksRef.current, { type: base });
        try {
          const data = await toDataUrl(blob);
          if (data.length > MAX_NOTE_CHARS) { setError('That recording is too long to send. Try a shorter one.'); setPhase('idle'); return; }
          setPreview({ url: URL.createObjectURL(blob), note: { kind, mime: base, data, seconds: length } });
          setPhase('review');
        } catch (e) { setError((e as Error).message); setPhase('idle'); }
      };
      startedRef.current = Date.now();
      recorder.start(250);
      setSeconds(0); setPhase('recording');
      timerRef.current = window.setInterval(() => {
        const s = Math.round((Date.now() - startedRef.current) / 1000);
        setSeconds(s);
        if (s >= LIMITS[kind]) stop();
      }, 250);
    } catch (e) {
      releaseStream();
      const name = (e as Error)?.name;
      setError(name === 'NotAllowedError' ? `Allow ${kind === 'video' ? 'camera and microphone' : 'the microphone'} for GAYZE to record.` : 'Couldn’t start recording on this device.');
    }
  };

  const send = async () => {
    if (!preview) return;
    setPhase('sending'); setError(null);
    try { hapticSensitiveAction(); await onSend(preview.note); URL.revokeObjectURL(preview.url); setPreview(null); onClose(); }
    catch (e) { setError((e as Error)?.message || 'Couldn’t send. Try again.'); setPhase('review'); }
  };
  const close = () => { if (preview) URL.revokeObjectURL(preview.url); reset(); onClose(); };

  if (!isOpen) return null;
  const limit = LIMITS[kind];
  return createPortal(
    <div className="g-note" role="dialog" aria-modal="true" aria-label={`Leave a message for ${peerName}`} onClick={close}>
      <div className="g-note__sheet" onClick={(e) => e.stopPropagation()}>
        <header className="g-note__head">
          <div><strong>Leave a message</strong><span>for {peerName}</span></div>
          <button type="button" className="g-note__x" onClick={close} aria-label="Close"><X className="w-4 h-4" /></button>
        </header>

        {phase === 'idle' && (
          <div className="g-note__tabs" role="tablist">
            <button type="button" role="tab" aria-selected={kind === 'audio'} className={kind === 'audio' ? 'is-on' : ''} onClick={() => setKind('audio')}><Mic className="w-4 h-4" />Voice · {LIMITS.audio}s</button>
            <button type="button" role="tab" aria-selected={kind === 'video'} className={kind === 'video' ? 'is-on' : ''} onClick={() => setKind('video')}><Video className="w-4 h-4" />Video note · {LIMITS.video}s</button>
          </div>
        )}

        {phase === 'recording' && kind === 'video' && <video ref={liveRef} className="g-note__live" muted playsInline autoPlay />}
        {phase === 'review' && preview && (kind === 'video'
          ? <video className="g-note__live" src={preview.url} controls playsInline />
          : <audio className="g-note__audio" src={preview.url} controls />)}

        {(phase === 'idle' || phase === 'recording') && (
          <div className="g-note__rec">
            <div className="g-note__time" aria-live="off">{phase === 'recording' ? `${seconds}s / ${limit}s` : `Up to ${limit} seconds`}</div>
            <button type="button" className={`g-note__btn ${phase === 'recording' ? 'is-rec' : ''}`} onClick={phase === 'recording' ? stop : start} aria-label={phase === 'recording' ? 'Stop recording' : 'Start recording'}>
              {phase === 'recording' ? <Square className="w-7 h-7" /> : <Circle className="w-7 h-7" />}
            </button>
            <div className="g-note__hint">{phase === 'recording' ? 'Tap to stop' : 'Tap to record'}</div>
          </div>
        )}

        {(phase === 'review' || phase === 'sending') && (
          <div className="g-note__actions">
            <button type="button" onClick={() => { if (preview) URL.revokeObjectURL(preview.url); setPreview(null); setPhase('idle'); }} disabled={phase === 'sending'}><RotateCcw className="w-4 h-4" />Re-record</button>
            <button type="button" className="is-go" onClick={send} disabled={phase === 'sending'}><Send className="w-4 h-4" />{phase === 'sending' ? 'Sending…' : 'Send'}</button>
          </div>
        )}
        {error && <p className="g-note__error" role="alert">{error}</p>}
      </div>
    </div>, document.body);
};
