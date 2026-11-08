/**
 * Explicit consent to process information that can reveal sexual orientation (UK GDPR Article 9(2)(a)).
 * It is recorded in the account's own metadata with the policy version and the time, and asked again if the version changes.
 */
export const CONSENT_VERSION = '2026-11-v1';
export const CONSENT_KEY = 'consent_special_category_v';
export const CONSENT_AT_KEY = 'consent_special_category_at';

export function hasCurrentConsent(metadata: Record<string, unknown> | null | undefined): boolean {
  return Boolean(metadata) && metadata![CONSENT_KEY] === CONSENT_VERSION;
}

export function consentMetadata(now = new Date()): Record<string, string> {
  return { [CONSENT_KEY]: CONSENT_VERSION, [CONSENT_AT_KEY]: now.toISOString() };
}

/** Withdrawing clears the record; the gate then appears again. */
export function withdrawnConsentMetadata(): Record<string, null> {
  return { [CONSENT_KEY]: null, [CONSENT_AT_KEY]: null };
}
