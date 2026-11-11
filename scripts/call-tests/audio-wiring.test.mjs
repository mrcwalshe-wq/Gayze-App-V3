import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const modal = read('../../src/components/FullScreenCallModal.tsx');
const service = read('../../src/services/webrtcService.ts');
const bridge = read('../../src/services/callAudioService.ts');

test('both call screens use the shared HTML audio ringtone service', () => {
  assert.match(modal, /import \{ playCallSound, stopCallSounds \} from '\.\.\/services\/callSounds';/);
  assert.equal((modal.match(/playCallSound\(sound\)/g) || []).length, 4, 'both audio and video call screens start and repeat their selected ringtone');
  assert.equal((modal.match(/\[isOpen, callState, isIncoming\]/g) || []).length, 2, 'both screens stop ringing when call state changes');
  assert.doesNotMatch(modal, /getCallAudioContext|closeCallAudio|createOscillator/, 'the call UI must not use the retired Web Audio ringtone path');
  assert.match(modal, /playCallSound\('connected'\)/);
  assert.match(modal, /playCallSound\(callState === 'ended' \? 'ended' : 'unanswered'\)/);
});

test('call-screen hangup does not independently close and trigger a second teardown', () => {
  assert.doesNotMatch(modal, /webrtcCallService\.endCall\(\);\s*onClose\(\)/);
  assert.equal((modal.match(/void webrtcCallService\.endCall\(\);/g) || []).length, 2, 'both call screens delegate closure to the service state transition');
});

test('WebRTC teardown is guarded before its first asynchronous operation', () => {
  assert.match(service, /private endingCallGeneration: number \| null = null;/);
  assert.match(service, /if \(this\.endingCallGeneration === generation\)/);
  assert.match(service, /ignored overlapping endCall/);
  assert.match(service, /ignored duplicate endCall/);
});


test('call notification bridge deduplicates concurrent teardown side effects', () => {
  assert.match(bridge, /const endingCallIds = new Set<string>\(\);/);
  assert.match(bridge, /if \(call && endingCallIds\.has\(call\.callId\)\) return;/);
  assert.match(bridge, /if \(call\) endingCallIds\.add\(call\.callId\);/);
  assert.match(bridge, /if \(call\) endingCallIds\.delete\(call\.callId\);/);
});
