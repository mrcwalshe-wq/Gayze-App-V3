import test from 'node:test';
import assert from 'node:assert/strict';
import { isIosPlatform, appleSignInAvailable, googleSignInAllowed } from '../../src/services/platform.ts';
import { appleDisplayName, isAppleCancel, randomNonce, sha256Hex } from '../../src/services/appleAuth.ts';

const ios = { isNativePlatform: () => true, getPlatform: () => 'ios' };
const android = { isNativePlatform: () => true, getPlatform: () => 'android' };
const web = { isNativePlatform: () => false, getPlatform: () => 'web' };

test('platform detection', () => {
  assert.equal(isIosPlatform(ios), true);
  assert.equal(isIosPlatform(android), false);
  assert.equal(isIosPlatform(web), false);
  assert.equal(isIosPlatform(undefined), false);
});
test('Apple sign-in is offered only inside the iPhone app', () => {
  assert.equal(appleSignInAvailable(ios), true);
  assert.equal(appleSignInAvailable(android), false);
  assert.equal(appleSignInAvailable(web), false);
  assert.equal(appleSignInAvailable(ios, false), false);
});
test('Google is shown in the iPhone app only while Apple sign-in is offered (App Review 4.8)', () => {
  assert.equal(googleSignInAllowed(ios, true), true);
  assert.equal(googleSignInAllowed(ios, false), false);
  assert.equal(googleSignInAllowed(web, false), true);
  assert.equal(googleSignInAllowed(android, false), true);
});
test('nonce hashing matches a known SHA-256 value and nonces are random', async () => {
  assert.equal(await sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.notEqual(randomNonce(), randomNonce());
  assert.equal(randomNonce().length, 64);
});
test('Apple name and cancel handling', () => {
  assert.equal(appleDisplayName(' Sam ', 'Lee'), 'Sam Lee');
  assert.equal(appleDisplayName(null, undefined), null);
  assert.equal(isAppleCancel(new Error('The operation was cancelled')), true);
  assert.equal(isAppleCancel({ code: 'cancelled' }), true);
  assert.equal(isAppleCancel(new Error('boom')), false);
});
