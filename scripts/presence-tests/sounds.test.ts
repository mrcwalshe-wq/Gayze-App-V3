import test from 'node:test';
import assert from 'node:assert/strict';
import { RECIPES, renderSound, type CallSound } from '../../src/services/callSounds.ts';

test('every call sound renders a valid WAV that is audible and not clipped', () => {
  for (const kind of Object.keys(RECIPES) as CallSound[]) {
    const wav = renderSound(kind);
    const dv = new DataView(wav.buffer);
    assert.equal(String.fromCharCode(...wav.slice(0, 4)), 'RIFF');
    assert.equal(String.fromCharCode(...wav.slice(8, 12)), 'WAVE');
    assert.equal(dv.getUint32(40, true), wav.length - 44, `${kind}: data length`);
    let peak = 0;
    for (let i = 44; i < wav.length; i += 2) peak = Math.max(peak, Math.abs(dv.getInt16(i, true)));
    assert.ok(peak > 8000, `${kind}: audible (peak ${peak})`);
    assert.ok(peak < 32767, `${kind}: not clipped (peak ${peak})`);
  }
});

test('ringing sounds loop; connect, end and not-answered sounds play once', () => {
  assert.equal(RECIPES.outgoing.loop, true);
  assert.equal(RECIPES.incoming.loop, true);
  assert.equal(RECIPES.connected.loop, false);
  assert.equal(RECIPES.ended.loop, false);
  assert.equal(RECIPES.unanswered.loop, false);
});
