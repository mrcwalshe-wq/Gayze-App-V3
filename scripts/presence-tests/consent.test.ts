import test from 'node:test';
import assert from 'node:assert/strict';
import { CONSENT_VERSION, CONSENT_KEY, CONSENT_AT_KEY, hasCurrentConsent, consentMetadata, withdrawnConsentMetadata } from '../../src/services/consent.ts';

test('no consent until the current version is recorded', () => {
  assert.equal(hasCurrentConsent(null), false);
  assert.equal(hasCurrentConsent({}), false);
  assert.equal(hasCurrentConsent({ [CONSENT_KEY]: 'an-older-version' }), false);
  assert.equal(hasCurrentConsent(consentMetadata()), true);
});

test('the record carries the version and the time', () => {
  const meta = consentMetadata(new Date('2026-11-08T12:00:00Z'));
  assert.equal(meta[CONSENT_KEY], CONSENT_VERSION);
  assert.equal(meta[CONSENT_AT_KEY], '2026-11-08T12:00:00.000Z');
});

test('withdrawing clears it, so the gate returns', () => {
  const after = { ...consentMetadata(), ...withdrawnConsentMetadata() };
  assert.equal(hasCurrentConsent(after), false);
});
