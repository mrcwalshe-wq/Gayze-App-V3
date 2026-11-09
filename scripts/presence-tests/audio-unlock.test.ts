import test from 'node:test';
import assert from 'node:assert/strict';
import { unlockElementSilently } from '../../src/services/audioUnlock.ts';

/** A stand-in for iOS: `volume` is read-only (always 1); only `muted` controls loudness. */
function iosAudio() {
  const log: { event: string; audible: boolean }[] = [];
  const el: any = {
    muted: false, currentTime: 5, paused: true,
    get volume() { return 1; }, set volume(_v: number) { /* ignored on iOS */ },
    play() { el.paused = false; log.push({ event: 'play', audible: !el.muted }); return Promise.resolve(); },
    pause() { el.paused = true; log.push({ event: 'pause', audible: !el.muted }); },
  };
  return { el: el as HTMLAudioElement, log };
}

test('unlocking never starts a sound audibly, even where volume cannot be changed', async () => {
  const { el, log } = iosAudio();
  unlockElementSilently(el);
  await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(log.map((l) => l.event), ['play', 'pause']);
  assert.equal(log[0].audible, false, 'the play() call must be muted');
});

test('the element is left stopped, rewound and un-muted so it can play for real later', async () => {
  const { el } = iosAudio();
  unlockElementSilently(el);
  await Promise.resolve(); await Promise.resolve();
  assert.equal(el.paused, true);
  assert.equal(el.currentTime, 0);
  assert.equal(el.muted, false);
});

test('an element that was already muted stays muted', async () => {
  const { el } = iosAudio();
  el.muted = true;
  unlockElementSilently(el);
  await Promise.resolve(); await Promise.resolve();
  assert.equal(el.muted, true);
});

test('a blocked play() restores the element instead of leaving it muted', async () => {
  const { el } = iosAudio();
  (el as any).play = () => Promise.reject(new Error('NotAllowedError'));
  unlockElementSilently(el);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(el.muted, false);
});
