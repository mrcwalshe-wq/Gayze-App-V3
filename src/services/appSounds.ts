/**
 * The GAYZE sound set. One signature idea, a rising fifth in a soft bell tone (G then D), and every sound is a variation of it,
 * so the app sounds like one thing. They are made in code (no audio files), played through <audio> elements like the call sounds,
 * and unlocked by the first touch. Nothing plays during a call, or when the person has turned sounds off.
 *
 *   open        C5 > G5 > D6 soft rising bells, once, when the app opens
 *   messageIn   G5 > D6        the signature: a short two-note bell
 *   messageOut  soft tick      quiet, so sending never competes with the reply
 *   gayze       G B D G arpeggio, the signature opened up and held (someone sent you a Gayze)
 *   matched     G B D chord blooming (a request was accepted)
 *   live        rising sweep landing on the chord (your intent is live)
 *   notify      single bell (generic heads-up)
 *   error       two low, soft notes falling
 */
import { encodeWav } from './callSounds';
import { unlockElementSilently } from './audioUnlock';

export type AppSound = 'open' | 'messageIn' | 'messageOut' | 'gayze' | 'matched' | 'live' | 'notify' | 'error';

const RATE = 22050;
const G5 = 783.99, B5 = 987.77, D6 = 1174.66, G6 = 1567.98;

/** A bell: a sine with a quiet octave and a glassy upper partial that fades faster, so it rings and then clears. */
function bell(buf: Float32Array, startS: number, freq: number, durS: number, level: number) {
  const start = Math.floor(startS * RATE), len = Math.floor(durS * RATE);
  for (let i = 0; i < len && start + i < buf.length; i += 1) {
    const t = i / RATE, p = i / len;
    const attack = Math.min(1, t / 0.006);
    const body = Math.pow(1 - p, 2.2) * attack;
    const glass = Math.pow(1 - p, 5) * attack;
    buf[start + i] += level * (Math.sin(2 * Math.PI * freq * t) * body + 0.18 * Math.sin(2 * Math.PI * freq * 2 * t) * body + 0.07 * Math.sin(2 * Math.PI * freq * 3.01 * t) * glass);
  }
}

/** A short rising sweep (for going live). */
function sweep(buf: Float32Array, startS: number, from: number, to: number, durS: number, level: number) {
  const start = Math.floor(startS * RATE), len = Math.floor(durS * RATE);
  let phase = 0;
  for (let i = 0; i < len && start + i < buf.length; i += 1) {
    const p = i / len, f = from + (to - from) * p * p;
    phase += (2 * Math.PI * f) / RATE;
    buf[start + i] += Math.sin(phase) * level * Math.min(1, i / (RATE * 0.02)) * (1 - p * 0.6) * Math.pow(1 - p, 0.5);
  }
}

interface Recipe { seconds: number; volume: number; build: (buf: Float32Array) => void }
export const APP_RECIPES: Record<AppSound, Recipe> = {
  open: { seconds: 2.1, volume: 0.5, build: (b) => { bell(b, 0, 523.25, 1.0, 0.2); bell(b, 0.17, G5, 1.3, 0.2); bell(b, 0.36, D6, 1.5, 0.15); } },
  messageIn: { seconds: 0.7, volume: 0.8, build: (b) => { bell(b, 0, G5, 0.5, 0.34); bell(b, 0.11, D6, 0.55, 0.34); } },
  messageOut: { seconds: 0.18, volume: 0.45, build: (b) => { bell(b, 0, G6, 0.14, 0.3); } },
  gayze: { seconds: 1.5, volume: 0.9, build: (b) => { [G5, B5, D6].forEach((f, i) => bell(b, i * 0.09, f, 0.5, 0.28)); bell(b, 0.27, G6, 1.1, 0.3); } },
  matched: { seconds: 1.3, volume: 0.85, build: (b) => { [G5, B5, D6].forEach((f) => bell(b, 0, f, 0.9, 0.24)); bell(b, 0.12, G6, 1.1, 0.24); } },
  live: { seconds: 1.2, volume: 0.8, build: (b) => { sweep(b, 0, 392, 784, 0.45, 0.28); bell(b, 0.4, G5, 0.7, 0.28); bell(b, 0.4, D6, 0.7, 0.24); } },
  notify: { seconds: 0.6, volume: 0.7, build: (b) => { bell(b, 0, G5, 0.5, 0.36); } },
  error: { seconds: 0.7, volume: 0.6, build: (b) => { bell(b, 0, 330, 0.3, 0.34); bell(b, 0.16, 262, 0.45, 0.34); } },
};

export function renderAppSound(kind: AppSound): Uint8Array {
  const recipe = APP_RECIPES[kind];
  const buf = new Float32Array(Math.floor(recipe.seconds * RATE));
  recipe.build(buf);
  return encodeWav(buf, RATE);
}

const KEY = 'gayze_sounds_enabled';
export const areSoundsEnabled = (): boolean => {
  try { const v = localStorage.getItem(KEY); return v === null ? true : JSON.parse(v) !== false; } catch { return true; }
};
export const setSoundsEnabled = (enabled: boolean): void => { try { localStorage.setItem(KEY, JSON.stringify(enabled)); } catch { /* ignore */ } };

const elements = new Map<AppSound, HTMLAudioElement>();
const lastPlayed = new Map<AppSound, number>();
let unlocked = false;

function element(kind: AppSound): HTMLAudioElement | null {
  if (typeof window === 'undefined' || typeof Audio === 'undefined') return null;
  let el = elements.get(kind);
  if (!el) {
    try {
      el = new Audio(URL.createObjectURL(new Blob([renderAppSound(kind) as BlobPart], { type: 'audio/wav' })));
      el.preload = 'auto';
      el.volume = APP_RECIPES[kind].volume;
      elements.set(kind, el);
    } catch { return null; }
  }
  return el;
}

const inCall = (): boolean => typeof document !== 'undefined' && Boolean(document.querySelector('[data-gayze-call-screen="true"], .g-call'));

/** Sounds that announce something arriving. They stay silent while the app is still loading what was already there. */
const ARRIVAL_SOUNDS: readonly AppSound[] = ['messageIn', 'gayze', 'matched'];
export const STARTUP_QUIET_MS = 15_000;
/** Arrival sounds never overlap: a burst (the backlog loading in) makes one sound, not a run of them. */
export const ARRIVAL_GAP_MS = 2500;
let quietUntil = Date.now() + STARTUP_QUIET_MS;
let lastArrivalAt = 0;
let openPending = false;
let openPlayed = false;

/** Pure rule, so it can be tested: is this sound held back right now? */
export function isHeldBack(kind: AppSound, now: number, until: number): boolean {
  return ARRIVAL_SOUNDS.includes(kind) && now < until;
}

/** Call at login or app start: history that loads now is not news, so arrival sounds wait. */
export function quietArrivalSounds(ms: number = STARTUP_QUIET_MS): void { quietUntil = Math.max(quietUntil, Date.now() + ms); }

/** A message older than this is history, not something that just arrived. */
export const FRESH_MESSAGE_MS = 60_000;

/** Plays one sound. Quietly does nothing when sounds are off, a call is on screen, the app is still loading, or the same sound just played. */
export function playAppSound(kind: AppSound): void {
  if (!areSoundsEnabled() || inCall()) return;
  const now = Date.now();
  if (isHeldBack(kind, now, quietUntil)) return;
  if (now - (lastPlayed.get(kind) ?? 0) < 350) return;
  if (ARRIVAL_SOUNDS.includes(kind)) {
    if (now - lastArrivalAt < ARRIVAL_GAP_MS) return;
    lastArrivalAt = now;
  }
  lastPlayed.set(kind, now);
  const el = element(kind);
  if (!el) return;
  try { el.currentTime = 0; } catch { /* not seekable yet */ }
  void el.play().catch(() => undefined);
}

/** The one sound when the app opens. Plays once per start; if the phone will not play it without a touch yet, it plays on the first touch. */
export function playOpenSound(): void {
  if (openPlayed || !areSoundsEnabled() || inCall()) return;
  const el = element('open');
  if (!el) return;
  try { el.currentTime = 0; } catch { /* not seekable yet */ }
  void el.play().then(() => { openPlayed = true; openPending = false; }, () => { openPending = true; });
}

/** Browsers allow sound only after a touch: the first one plays every sound MUTED for a moment so later ones can play on their own (muted, not volume 0: iOS ignores volume). */
export function installAppSoundUnlock(): () => void {
  if (typeof document === 'undefined') return () => undefined;
  const handler = () => {
    if (unlocked) return;
    unlocked = true;
    (Object.keys(APP_RECIPES) as AppSound[]).forEach((kind) => {
      if (kind === 'open' && openPending && !openPlayed) return;   // about to be played for real
      const el = element(kind);
      if (!el) return;
      unlockElementSilently(el);
    });
    if (openPending && !openPlayed) window.setTimeout(playOpenSound, 0);
  };
  const events = ['pointerdown', 'touchend', 'click', 'keydown'] as const;
  events.forEach((e) => document.addEventListener(e, handler, { once: true, capture: true }));
  // Coming back to the app loads the backlog again: that is not news either.
  const onVisible = () => { if (document.visibilityState === 'visible') quietArrivalSounds(6000); };
  document.addEventListener('visibilitychange', onVisible);
  return () => { events.forEach((e) => document.removeEventListener(e, handler, true)); document.removeEventListener('visibilitychange', onVisible); };
}
