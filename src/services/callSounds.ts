/**
 * Call sounds: ringing, connected, ended, not answered.
 *
 * They are plain audio files made in code and played through <audio> elements, not through Web Audio. A Web Audio context
 * left open while the microphone is in use is a known cause of garbled, pitch-shifted or silent call audio on iPhones, and a
 * context that was closed could not be restarted without another tap. An <audio> element can be stopped with pause(), which
 * is what makes the ringing stop the moment a call connects.
 */
export type CallSound = 'outgoing' | 'incoming' | 'connected' | 'ended' | 'unanswered';

const RATE = 22050;

/** One note: a soft sine with a quick attack and a smooth fade so it never clicks. */
function note(buf: Float32Array, startS: number, freq: number, durS: number, level: number) {
  const start = Math.floor(startS * RATE), len = Math.floor(durS * RATE);
  for (let i = 0; i < len && start + i < buf.length; i += 1) {
    const t = i / RATE;
    const env = Math.min(1, t / 0.012) * Math.pow(1 - i / len, 1.6);
    buf[start + i] += Math.sin(2 * Math.PI * freq * t) * level * env + Math.sin(2 * Math.PI * freq * 2 * t) * level * 0.12 * env;
  }
}

/** Encode mono samples as a 16-bit WAV. */
export function encodeWav(samples: Float32Array, rate = RATE): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const text = (offset: number, s: string) => { for (let i = 0; i < s.length; i += 1) view.setUint8(offset + i, s.charCodeAt(i)); };
  text(0, 'RIFF'); view.setUint32(4, 36 + samples.length * 2, true); text(8, 'WAVE'); text(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, 'data'); view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i += 1) view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 32767, true);
  return bytes;
}

interface Recipe { seconds: number; loop: boolean; volume: number; build: (buf: Float32Array) => void }
export const RECIPES: Record<CallSound, Recipe> = {
  // Calling: the rising GAYZE ringback, repeated.
  outgoing: { seconds: 2.4, loop: true, volume: 0.55, build: (b) => { [523.25, 659.25, 783.99].forEach((f, i) => note(b, i * 0.14, f, 0.42, 0.34)); } },
  // Being called: a fuller two-phrase chime so it is clearly a ring.
  incoming: { seconds: 2.6, loop: true, volume: 0.9, build: (b) => {
    [392, 493.88, 587.33, 783.99].forEach((f, i) => { note(b, i * 0.12, f, 0.5, 0.3); note(b, 1.1 + i * 0.12, f, 0.5, 0.3); });
  } },
  connected: { seconds: 0.7, loop: false, volume: 0.7, build: (b) => { note(b, 0, 659.25, 0.22, 0.4); note(b, 0.13, 987.77, 0.45, 0.4); } },
  ended: { seconds: 0.9, loop: false, volume: 0.7, build: (b) => { note(b, 0, 587.33, 0.28, 0.38); note(b, 0.2, 392, 0.55, 0.38); } },
  // Not answered, declined or failed: three short falling beeps.
  unanswered: { seconds: 1.3, loop: false, volume: 0.7, build: (b) => { [0, 0.3, 0.6].forEach((t) => note(b, t, 440, 0.2, 0.4)); note(b, 0.9, 330, 0.34, 0.4); } },
};

const elements = new Map<CallSound, HTMLAudioElement>();
let unlocked = false;

export function renderSound(kind: CallSound): Uint8Array {
  const recipe = RECIPES[kind];
  const buf = new Float32Array(Math.floor(recipe.seconds * RATE));
  recipe.build(buf);
  return encodeWav(buf);
}

function element(kind: CallSound): HTMLAudioElement | null {
  if (typeof window === 'undefined' || typeof Audio === 'undefined') return null;
  let el = elements.get(kind);
  if (!el) {
    try {
      const wav = renderSound(kind);
      el = new Audio(URL.createObjectURL(new Blob([wav as BlobPart], { type: 'audio/wav' })));
      el.preload = 'auto';
      el.loop = RECIPES[kind].loop;
      el.volume = RECIPES[kind].volume;
      elements.set(kind, el);
    } catch { return null; }
  }
  return el;
}

/** Stop and rewind every call sound. */
export function stopCallSounds(except?: CallSound) {
  elements.forEach((el, kind) => { if (kind !== except) { try { el.pause(); el.currentTime = 0; } catch { /* already stopped */ } } });
}

export function playCallSound(kind: CallSound) {
  const el = element(kind);
  if (!el) return;
  if (RECIPES[kind].loop) stopCallSounds(kind);
  else stopCallSounds();
  try { el.currentTime = 0; } catch { /* not seekable yet */ }
  void el.play().catch(() => undefined);   // blocked until the person has touched the page once
}

/**
 * Browsers only let a sound start after the person has touched the page. The first touch plays every sound silently for a
 * moment, which is what allows a call to ring later with nobody touching anything.
 */
export function unlockCallSounds() {
  if (unlocked) return;
  (Object.keys(RECIPES) as CallSound[]).forEach((kind) => {
    const el = element(kind);
    if (!el) return;
    const volume = el.volume;
    el.volume = 0;
    void el.play().then(() => { el.pause(); el.currentTime = 0; el.volume = volume; }).catch(() => { el.volume = volume; });
  });
  unlocked = true;
}

export function installCallSoundUnlock(): () => void {
  if (typeof document === 'undefined') return () => undefined;
  const handler = () => { unlockCallSounds(); };
  const events = ['pointerdown', 'touchend', 'click', 'keydown'] as const;
  events.forEach((e) => document.addEventListener(e, handler, { once: true, capture: true }));
  return () => events.forEach((e) => document.removeEventListener(e, handler, true));
}
