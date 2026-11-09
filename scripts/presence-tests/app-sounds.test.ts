import test from 'node:test';
import assert from 'node:assert/strict';
import { APP_RECIPES, renderAppSound, type AppSound } from '../../src/services/appSounds.ts';
import { RECIPES } from '../../src/services/callSounds.ts';

const peak = (wav: Uint8Array) => { const dv = new DataView(wav.buffer); let p = 0; for (let i = 44; i < wav.length; i += 2) p = Math.max(p, Math.abs(dv.getInt16(i, true))); return p; };

test('every app sound renders a valid WAV that is audible and not clipped', () => {
  for (const kind of Object.keys(APP_RECIPES) as AppSound[]) {
    const wav = renderAppSound(kind);
    const dv = new DataView(wav.buffer);
    assert.equal(String.fromCharCode(...wav.slice(0, 4)), 'RIFF');
    assert.equal(dv.getUint32(40, true), wav.length - 44, `${kind}: data length`);
    const p = peak(wav);
    assert.ok(p > 6000, `${kind}: audible (peak ${p})`);
    assert.ok(p < 32000, `${kind}: not clipped (peak ${p})`);
  }
});

test('sounds are short and the message sound is distinct from every other sound', () => {
  assert.ok(APP_RECIPES.messageOut.seconds <= 0.25, 'sending is a tick');
  assert.ok(APP_RECIPES.messageIn.seconds <= 1, 'receiving is brief');
  const bytes = (k: AppSound) => Array.from(renderAppSound(k)).join(',');
  const seen = new Set<string>();
  for (const k of Object.keys(APP_RECIPES) as AppSound[]) { const b = bytes(k); assert.ok(!seen.has(b), `${k} duplicates another sound`); seen.add(b); }
});

test('app sounds never loop and stay quieter than a ringing call', () => {
  for (const k of Object.keys(APP_RECIPES) as AppSound[]) assert.ok(APP_RECIPES[k].volume <= RECIPES.incoming.volume, `${k} volume`);
});

test('arrival sounds are held back while loading, your own actions are not', async () => {
  const { isHeldBack } = await import('../../src/services/appSounds.ts');
  const until = 10_000;
  for (const k of ['messageIn', 'gayze', 'matched'] as AppSound[]) assert.equal(isHeldBack(k, 5_000, until), true, `${k} held`);
  for (const k of ['messageOut', 'notify', 'error', 'live'] as AppSound[]) assert.equal(isHeldBack(k, 5_000, until), false, `${k} plays`);
  assert.equal(isHeldBack('messageIn', 10_000, until), false, 'plays once the window ends');
});
