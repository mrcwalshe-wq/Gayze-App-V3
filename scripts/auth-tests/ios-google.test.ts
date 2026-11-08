import test from 'node:test';
import assert from 'node:assert/strict';
import { isIosPlatform } from '../../src/services/platform.ts';

test('the Google button is hidden only inside the iPhone app', () => {
  assert.equal(isIosPlatform({ isNativePlatform: () => true, getPlatform: () => 'ios' }), true);
  assert.equal(isIosPlatform({ isNativePlatform: () => true, getPlatform: () => 'android' }), false);
  assert.equal(isIosPlatform({ isNativePlatform: () => false, getPlatform: () => 'web' }), false);
  assert.equal(isIosPlatform(undefined), false);
});
