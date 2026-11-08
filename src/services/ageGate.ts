/** Age check at sign-up. The date of birth is used to work out the age and is not stored. */
export const MIN_AGE = 18;
const LOCK_KEY = 'gayze:age-block-until';
const LOCK_MS = 24 * 60 * 60 * 1000;

/** Whole years between a YYYY-MM-DD date of birth and `now`. Returns null if the date is missing, malformed or in the future. */
export function ageFromDob(dob: string, now: Date = new Date()): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dob.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const birth = new Date(Date.UTC(y, mo - 1, d));
  if (birth.getUTCFullYear() !== y || birth.getUTCMonth() !== mo - 1 || birth.getUTCDate() !== d) return null;
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (birth > today) return null;
  let age = today.getUTCFullYear() - y;
  if (today.getUTCMonth() < mo - 1 || (today.getUTCMonth() === mo - 1 && today.getUTCDate() < d)) age -= 1;
  return age;
}

export function isAdultDob(dob: string, now: Date = new Date()): boolean {
  const age = ageFromDob(dob, now);
  return age !== null && age >= MIN_AGE && age <= 120;
}

type Store = Pick<Storage, 'getItem' | 'setItem'>;
function store(): Store | null { try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; } }

/** After an under-18 date of birth, this device is blocked from trying again for 24 hours. */
export function recordUnderageAttempt(now = Date.now(), s: Store | null = store()): void {
  try { s?.setItem(LOCK_KEY, String(now + LOCK_MS)); } catch { /* storage unavailable */ }
}
export function underageBlockActive(now = Date.now(), s: Store | null = store()): boolean {
  try { return Number(s?.getItem(LOCK_KEY) ?? 0) > now; } catch { return false; }
}
