import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const modal = read('../../src/components/FullScreenCallModal.tsx');

test('both call screens use the shared HTML audio ringtone service', () => {
  assert.match(modal, /import \{ playCallSound, stopCallSounds \} from '\.\.\/services\/callSounds';/);
  assert.equal((modal.match(/playCallSound\(sound\)/g) || []).length, 4, 'both audio and video call screens start and repeat their selected ringtone');
  assert.equal((modal.match(/\[isOpen, callState, isIncoming\]/g) || []).length, 2, 'both screens stop ringing when call state changes');
  assert.doesNotMatch(modal, /getCallAudioContext|closeCallAudio|createOscillator/, 'the call UI must not use the retired Web Audio ringtone path');
  assert.match(modal, /playCallSound\('connected'\)/);
  assert.match(modal, /playCallSound\(callState === 'ended' \? 'ended' : 'unanswered'\)/);
});

test('the call screen delegates hangup to its close effect exactly once', () => {
  const handlers = modal.match(/const handleEndCall = \(\) => \{[\s\S]*?\n  \};/g) || [];
  assert.equal(handlers.length, 2, 'audio and video call screens both define a hangup handler');
  for (const handler of handlers) {
    assert.match(handler, /onClose\(\);/);
    assert.doesNotMatch(handler, /webrtcCallService\.endCall/);
  }
});

test('failed calls retain the full-screen call UI so the error is readable and can be dismissed', () => {
  const listeners = modal.match(/const unsubState = webrtcCallService\.subscribeState\([\s\S]*?\n    \}\);/g) || [];
  assert.equal(listeners.length, 2, 'audio and video screens both subscribe to call state');
  for (const listener of listeners) {
    assert.match(listener, /state === 'ended' \|\| state === 'declined' \|\| state === 'missed'/);
    assert.doesNotMatch(listener, /state === 'failed'/, 'a failed call must not auto-close back to the map');
    assert.match(listener, /onCloseRef\.current\(\)/, 'normal terminal states still close after the short transition');
  }
  assert.equal((modal.match(/<span>\{errorMessage\}<\/span>/g) || []).length, 2, 'both full-screen variants show the failure explanation');
});
