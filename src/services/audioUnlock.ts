/**
 * Browsers only let an <audio> element start on its own after a touch has started it once. We do that for every
 * sound on the first touch so a message chime or an incoming-call ring can play later with nobody touching anything.
 *
 * It has to be SILENT. iOS ignores `volume` on audio elements (it always reads 1), so "play it at volume 0" plays the
 * sound out loud: every sound at once, the moment someone enters the app. `muted` is respected everywhere.
 */
export function unlockElementSilently(el: HTMLAudioElement): void {
  const wasMuted = el.muted;
  el.muted = true;
  const restore = () => {
    try { el.pause(); el.currentTime = 0; } catch { /* already stopped */ }
    el.muted = wasMuted;
    releaseSource(el);
  };
  try {
    void el.play().then(restore, restore);
  } catch {
    el.muted = wasMuted;
  }
}

/**
 * iOS lists any <audio> element that has played as "now playing", and keeps it on the lock screen (title, scrubber, play button),
 * even when it is only a one-second chime that has been rewound. So a sound element is only given its audio while it is playing:
 * once it stops or ends, the source is removed and the element is empty again. It is the same element throughout, so the touch
 * that unlocked it still counts and it can ring later with nobody touching the phone.
 */
const sources = new WeakMap<HTMLAudioElement, string>();
export function rememberSource(el: HTMLAudioElement, url: string): void { sources.set(el, url); }
export function ensureSource(el: HTMLAudioElement): void {
  const url = sources.get(el);
  if (url && !el.getAttribute('src')) el.src = url;
}
export function releaseSource(el: HTMLAudioElement): void {
  if (!sources.has(el)) return;
  try { el.pause(); } catch { /* already stopped */ }
  try { el.removeAttribute('src'); el.load(); } catch { /* nothing to release */ }
}
