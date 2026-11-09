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
  };
  try {
    void el.play().then(restore, restore);
  } catch {
    el.muted = wasMuted;
  }
}
