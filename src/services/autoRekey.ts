/**
 * When this device can never open a chat's key (it was never shared, or this device's private key is gone),
 * the chat is stuck: nothing new can be sent or read. Rather than leave the member on a "Retry" button that
 * cannot help, the app starts a fresh key version by itself. This module decides WHEN that is allowed.
 *
 * Old messages stay stored and stay readable on devices that hold the old key; this device shows them as
 * "can't decrypt". A cool-down stops a failing chat from re-keying in a loop.
 */
export interface AutoRekeyAttempt { at: number; ok: boolean }

export const AUTO_REKEY_AFTER_SUCCESS_MS = 24 * 60 * 60 * 1000;
export const AUTO_REKEY_AFTER_FAILURE_MS = 10 * 60 * 1000;

type KeyOutcome = { key: unknown; canRekey?: boolean; code?: string; transient?: boolean };

/** True only for permanent "this device cannot open the current key" outcomes. */
export function isStuckWithoutKey(result: KeyOutcome): boolean {
  return !result.key && Boolean(result.canRekey) && !result.transient
    && (result.code === 'key_not_shared' || result.code === 'cannot_unwrap');
}

export function autoRekeyDue(result: KeyOutcome, last: AutoRekeyAttempt | null, now: number): boolean {
  if (!isStuckWithoutKey(result)) return false;
  if (!last) return true;
  return now - last.at >= (last.ok ? AUTO_REKEY_AFTER_SUCCESS_MS : AUTO_REKEY_AFTER_FAILURE_MS);
}

const storageKey = (userId: string, roomId: string) => `gayze:auto-rekey:${userId}:${roomId}`;

export function readAutoRekeyAttempt(userId: string, roomId: string): AutoRekeyAttempt | null {
  try {
    const raw = localStorage.getItem(storageKey(userId, roomId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AutoRekeyAttempt;
    return typeof parsed?.at === 'number' ? { at: parsed.at, ok: Boolean(parsed.ok) } : null;
  } catch { return null; }
}

export function writeAutoRekeyAttempt(userId: string, roomId: string, attempt: AutoRekeyAttempt): void {
  try { localStorage.setItem(storageKey(userId, roomId), JSON.stringify(attempt)); } catch { /* storage unavailable: no cool-down record */ }
}
