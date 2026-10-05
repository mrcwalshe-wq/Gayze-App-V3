/**
 * GAYZE — Web Push / PWA service.
 *
 * Real, standards-based Web Push: Service Worker + Push API + Notifications
 * API with VAPID. There is no in-app-only fallback pretending to be a
 * notification — if the platform cannot deliver an OS notification this module
 * says so honestly and the UI explains why.
 *
 * iOS notes (Safari 16.4+):
 *   - Push is ONLY available once the site is installed to the Home Screen.
 *   - `Notification.requestPermission()` must be called from a user gesture.
 * Both constraints are reflected in `getPushEnvironment()`.
 */

import { supabase, isSupabaseConfigured } from './supabaseClient';

/** Path of the root-scoped production service worker. */
export const SERVICE_WORKER_URL = '/service-worker.js';

/** Public VAPID application server key (safe to expose to the browser). */
const VAPID_PUBLIC_KEY = (import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined)?.trim() || '';

// Presence remains the UI capability contract; validate encoding before any
// enrollment/permission mutation rather than changing legacy onboarding state.
export const isVapidConfigured = VAPID_PUBLIC_KEY.length > 0;
const hasValidVapidKey = (() => {
  try {
    const key = base64UrlToUint8Array(VAPID_PUBLIC_KEY);
    return key.length === 65 && key[0] === 4;
  } catch { return false; }
})();

// ---------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------

export interface NotificationPreferences {
  pushEnabled: boolean;
  messages: boolean;
  intentActivity: boolean;
  connections: boolean;
  intentExpiry: boolean;
  safety: boolean;
}

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  pushEnabled: true,
  messages: true,
  intentActivity: true,
  connections: true,
  intentExpiry: true,
  safety: true,
};

// ---------------------------------------------------------------------------
// Environment detection
// ---------------------------------------------------------------------------

export type PushBlockReason =
  | 'unsupported'
  | 'ios-needs-install'
  | 'permission-denied'
  | 'not-configured'
  | null;

export interface PushEnvironment {
  /** Service Worker + Push + Notification all present. */
  supported: boolean;
  /** Running as an installed standalone PWA. */
  standalone: boolean;
  isIos: boolean;
  isSafari: boolean;
  permission: NotificationPermission | 'unsupported';
  /** True when `subscribeToPush()` can realistically succeed right now. */
  canSubscribe: boolean;
  /** Why subscribing is not currently possible. */
  blockedBy: PushBlockReason;
}

export function isIosDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  const iosUa = /iPad|iPhone|iPod/.test(ua);
  // iPadOS 13+ reports as Macintosh but is touch-capable.
  const iPadOs = navigator.platform === 'MacIntel' && (navigator.maxTouchPoints ?? 0) > 1;
  return iosUa || iPadOs;
}

export function isSafariBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  return /^((?!chrome|android|crios|fxios|edgios).)*safari/i.test(ua);
}

/** True when Gayze is running from the Home Screen / as an installed app. */
export function isStandalonePwa(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia?.('(display-mode: standalone)').matches) return true;
  if (window.matchMedia?.('(display-mode: fullscreen)').matches) return true;
  // iOS Safari's proprietary flag — still the only reliable signal there.
  const iosStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone;
  return iosStandalone === true;
}

export function isPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

export function getPushEnvironment(): PushEnvironment {
  const supported = isPushSupported();
  const standalone = isStandalonePwa();
  const ios = isIosDevice();
  const permission: NotificationPermission | 'unsupported' =
    supported && typeof Notification !== 'undefined' ? Notification.permission : 'unsupported';

  let blockedBy: PushBlockReason = null;
  if (!supported) {
    // On iOS the APIs simply do not exist until the app is installed.
    blockedBy = ios ? 'ios-needs-install' : 'unsupported';
  } else if (ios && !standalone) {
    blockedBy = 'ios-needs-install';
  } else if (permission === 'denied') {
    blockedBy = 'permission-denied';
  } else if (!isVapidConfigured) {
    blockedBy = 'not-configured';
  }

  return {
    supported,
    standalone,
    isIos: ios,
    isSafari: isSafariBrowser(),
    permission,
    canSubscribe: blockedBy === null,
    blockedBy,
  };
}

/** Platform label stored alongside a subscription (diagnostics only). */
function platformLabel(): string {
  if (typeof navigator === 'undefined') return 'unknown';
  if (isIosDevice()) return isStandalonePwa() ? 'ios-standalone' : 'ios-browser';
  if (/Android/i.test(navigator.userAgent)) return 'android';
  return 'desktop';
}

// ---------------------------------------------------------------------------
// Service worker registration
// ---------------------------------------------------------------------------

let registrationPromise: Promise<ServiceWorkerRegistration | null> | null = null;

/**
 * Register (or reuse) the root-scoped Gayze service worker.
 * Safe to call repeatedly; the browser de-duplicates by scope.
 */
export function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return Promise.resolve(null);
  }
  if (registrationPromise) return registrationPromise;

  registrationPromise = navigator.serviceWorker
    .register(SERVICE_WORKER_URL, { scope: '/' })
    .then(async (registration) => {
      // Make sure we are talking to an active worker before subscribing.
      if (!await withTimeout(navigator.serviceWorker.ready, 10_000, null)) throw new Error('Service worker readiness timed out');
      return registration;
    })
    .catch((error) => {
      console.warn('[GAYZE] Service worker registration failed:', error);
      registrationPromise = null;
      return null;
    });

  return registrationPromise;
}

// ---------------------------------------------------------------------------
// Key helpers
// ---------------------------------------------------------------------------

function base64UrlToUint8Array(base64Url: string): Uint8Array {
  const padding = '='.repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

function arrayBufferToBase64Url(buffer: ArrayBuffer | null): string {
  if (!buffer) return '';
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return window.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ---------------------------------------------------------------------------
// Subscription persistence
// ---------------------------------------------------------------------------

async function persistSubscription(subscription: PushSubscription, expectedUserId?: string): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured');

  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user?.id;
  if (!userId || (expectedUserId && userId !== expectedUserId)) throw new Error('Sign in to enable notifications for this account.');

  const p256dh = arrayBufferToBase64Url(subscription.getKey('p256dh'));
  const auth = arrayBufferToBase64Url(subscription.getKey('auth'));
  if (!p256dh || !auth) throw new Error('This browser returned an incomplete push subscription.');

  // `user_id` is always the authenticated user. RLS enforces the same thing, so
  // a device can never be attached to somebody else's account.
  const { error } = await supabase
    .from('push_subscriptions')
    .upsert(
      {
        user_id: userId,
        endpoint: subscription.endpoint,
        p256dh,
        auth,
        user_agent: navigator.userAgent.slice(0, 180),
        platform: platformLabel(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'endpoint' },
    );

  if (error) throw new Error(error.message);
}

async function removeSubscriptionRow(endpoint: string): Promise<boolean> {
  if (!supabase) return false;
  // RLS scopes this to the signed-in user's own rows, so it can only ever
  // delete a subscription that belongs to the current user.
  const { error } = await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint);
  if (error) {
    console.warn('[GAYZE] Failed to delete push subscription row:', error.message);
    return false;
  }
  return true;
}

/**
 * True only when the signed-in user owns a stored row for this endpoint.
 * RLS hides other users' rows, so a device endpoint that is (or was) registered
 * to someone else correctly reads as "not ours".
 */
async function ownsSubscriptionRow(endpoint: string): Promise<boolean> {
  if (!supabase) return false;
  const { data, error } = await supabase
    .from('push_subscriptions')
    .select('id')
    .eq('endpoint', endpoint)
    .maybeSingle();
  if (error) {
    console.warn('[GAYZE] Could not check push subscription ownership:', error.message);
    return false;
  }
  return Boolean(data);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function getExistingSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null;
  const registration = await registerServiceWorker();
  if (!registration) return null;
  return registration.pushManager.getSubscription();
}

export interface SubscribeResult {
  ok: boolean;
  /** Present when `ok` is false — a human-readable, Gayze-voiced reason. */
  reason?: string;
  blockedBy?: PushBlockReason;
}

// Registration mutations are serialized, including across tabs where Web Locks
// is available. Recovery never asks permission. Only a user's Enable action can.
let operations: Promise<unknown> = Promise.resolve();
let optInFlight: { owner?: string; work: Promise<SubscribeResult> } | null = null;
let permissionFlight: Promise<NotificationPermission> | null = null;
let authEpoch = 0;
// SIGNED_OUT invalidates enrollment but must NOT cancel the revoke initiated by
// App's earlier auth listener. Only a newer revoke/login invalidates that work.
let revocationEpoch = 0;
let authObserved = false;
let observedUser: string | null = null;
const ENROLLMENT_KEY = 'gayze_push_enrollment_v1';
type Enrollment = { userId: string; rowId: string };
function enrollment(userId: string): Enrollment | null {
  try {
    const value = JSON.parse(window.localStorage.getItem(ENROLLMENT_KEY) || 'null');
    return value?.userId === userId && typeof value.rowId === 'string' ? value : null;
  } catch { return null; }
}
function clearEnrollment() { try { window.localStorage.removeItem(ENROLLMENT_KEY); } catch { /* fail closed */ } }
function rememberEnrollment(userId: string, rowId: string) {
  // Opaque owner + DB row reference only. Never persist endpoint/auth/key material.
  try { window.localStorage.setItem(ENROLLMENT_KEY, JSON.stringify({ userId, rowId })); } catch { /* Recovery will require explicit enable if ownership is lost. */ }
}
function observePushAuth() {
  if (authObserved || !supabase?.auth.onAuthStateChange) return;
  authObserved = true;
  supabase.auth.onAuthStateChange((event, session) => {
    const next = session?.user.id ?? null;
    if (event !== 'INITIAL_SESSION' && next && next !== observedUser) revocationEpoch++;
    if (event === 'SIGNED_OUT' || (event !== 'INITIAL_SESSION' && next !== observedUser)) {
      authEpoch++;
      if (event === 'SIGNED_OUT' || !next || !enrollment(next)) clearEnrollment();
    }
    observedUser = next;
  });
}
function exclusive<T>(work: () => Promise<T>): Promise<T> {
  const next = operations.catch(() => {}).then(() => navigator.locks?.request
    ? navigator.locks.request('gayze-push-registration', work) : work());
  operations = next.catch(() => {});
  return next;
}
class PushAccountChanged extends Error {}
async function pushOwner(expected?: string, current: () => boolean = () => true) {
  observePushAuth();
  const epoch = authEpoch;
  const session = await supabase!.auth.getSession();
  const userId = session.data.session?.user.id;
  if (session.error || !userId || (expected && expected !== userId) || epoch !== authEpoch || !current()) throw new PushAccountChanged();
  const check = async () => {
    const latest = await supabase!.auth.getSession();
    if (latest.error || latest.data.session?.user.id !== userId || epoch !== authEpoch || !current()) throw new PushAccountChanged();
  };
  return { userId, check };
}
type PushOwner = Awaited<ReturnType<typeof pushOwner>>;
type StoredSubscription = { id: string; endpoint?: string; p256dh?: string; auth?: string };
async function ownedRow(owner: PushOwner, field: 'id' | 'endpoint', value: string): Promise<StoredSubscription | null> {
  await owner.check();
  const result = await supabase!.from('push_subscriptions').select('id,endpoint,p256dh,auth')
    .eq(field, value).eq('user_id', owner.userId).maybeSingle();
  await owner.check();
  // An outage is NOT evidence that an endpoint belongs to another account.
  if (result.error) throw new Error('Notification registration unavailable. Try again.');
  return result.data;
}
function keyMatches(subscription: PushSubscription): boolean {
  const key = subscription.options?.applicationServerKey;
  return !key || arrayBufferToBase64Url(key) === VAPID_PUBLIC_KEY.replace(/=+$/, '');
}
async function persistOwned(subscription: PushSubscription, owner: PushOwner) {
  await owner.check();
  await persistSubscription(subscription, owner.userId);
  await owner.check();
  const row = await ownedRow(owner, 'endpoint', subscription.endpoint);
  if (!row) throw new Error('Notification registration was not confirmed.');
  return row;
}
async function deleteOwnedRow(owner: PushOwner, rowId: string) {
  await owner.check();
  const { error } = await supabase!.from('push_subscriptions').delete().eq('id', rowId).eq('user_id', owner.userId);
  if (error) throw new Error('Old notification registration could not be removed. Retry reconciliation.');
}

/** Must be invoked directly by Enable. Permission is requested synchronously,
 * BEFORE any auth/lock/SW await; already-granted permission is never re-asked.
 */
export function subscribeToPush(expectedUserId?: string): Promise<SubscribeResult> {
  const env = getPushEnvironment();
  if (env.canSubscribe && !hasValidVapidKey) return Promise.resolve({ ok: false, blockedBy: 'not-configured',
    reason: 'Push notification configuration is invalid for this build.' });
  if (!env.canSubscribe || !supabase || !isSupabaseConfigured) return Promise.resolve({ ok: false, blockedBy: env.blockedBy,
    reason: env.blockedBy === 'ios-needs-install' ? 'Add Gayze to your Home Screen to enable notifications.'
      : env.blockedBy === 'permission-denied' ? 'Notifications are blocked for Gayze. Enable them in your device settings, then try again.'
      : env.blockedBy === 'not-configured' ? 'Push notifications are not configured for this build.' : 'Push notifications are unavailable.' });
  if (optInFlight?.owner === expectedUserId && optInFlight) return optInFlight.work;
  let permission: Promise<NotificationPermission>;
  try {
    permission = Notification.permission === 'granted' ? Promise.resolve('granted')
      : permissionFlight ?? (permissionFlight = Notification.requestPermission().finally(() => { permissionFlight = null; }));
  } catch { return Promise.resolve({ ok: false, reason: 'Could not request notification permission.' }); }
  const work = permission.then(async granted => {
    if (granted !== 'granted') return { ok: false, blockedBy: granted === 'denied' ? 'permission-denied' as const : null,
      reason: 'Notification permission was not granted. Check your device settings.' };
    return exclusive(async () => {
      const owner = await pushOwner(expectedUserId);
      const registration = await registerServiceWorker();
      if (!registration) throw new Error('Gayze could not start its notification service. Try again.');
      await owner.check();
      let subscription = await registration.pushManager.getSubscription();
      let created: PushSubscription | null = null;
      const old = subscription ? await ownedRow(owner, 'endpoint', subscription.endpoint) : null;
      const marker = enrollment(owner.userId);
      const pending = marker && marker.rowId !== old?.id ? await ownedRow(owner, 'id', marker.rowId) : null;
      // Finish an interrupted rotation before starting another one. A failed
      // cleanup keeps its old opaque pointer for the next launch/Enable retry.
      if (pending && old) await deleteOwnedRow(owner, pending.id);
      const prior = old || pending;
      if (prior) rememberEnrollment(owner.userId, prior.id);
      let persisted = false;
      if (subscription && (!old || !keyMatches(subscription))) {
        await owner.check();
        if (!await subscription.unsubscribe()) throw new Error('Could not reset this notification registration. Try again.');
        subscription = null;
      }
      try {
        if (!subscription) {
          await owner.check();
          created = subscription = await registration.pushManager.subscribe({ userVisibleOnly: true,
            applicationServerKey: base64UrlToUint8Array(VAPID_PUBLIC_KEY) as BufferSource });
        }
        const row = await persistOwned(subscription, owner);
        persisted = true;
        if (prior && prior.id !== row.id) await deleteOwnedRow(owner, prior.id);
        await owner.check();
        rememberEnrollment(owner.userId, row.id);
        setPendingRevoke(false);
        return { ok: true };
      } catch (error) {
        if (created && !persisted) await created.unsubscribe().catch(() => false);
        throw error;
      }
    });
  }).catch(error => ({ ok: false, reason: error instanceof PushAccountChanged ? 'Account changed. Enable notifications for the current account.'
    : 'Notification registration could not be confirmed. Please try again.' }));
  const entry = { owner: expectedUserId, work };
  optInFlight = entry;
  void work.finally(() => { if (optInFlight === entry) optInFlight = null; });
  return work;
}

/** Turn push off and invalidate any in-flight recovery before its next mutation. */
export async function unsubscribeFromPush(expectedUserId?: string): Promise<boolean> {
  observePushAuth();
  const epoch = ++authEpoch; clearEnrollment();
  return exclusive(async () => {
    try {
      const owner = await pushOwner(expectedUserId, () => epoch === authEpoch);
      const subscription = await getExistingSubscription();
      await owner.check();
      if (!subscription) return true;
      const revoked = await subscription.unsubscribe();
      const removed = await removeSubscriptionRow(subscription.endpoint);
      return revoked && removed;
    } catch { return false; }
  });
}

export type PushRecoveryState = 'ready' | 'needs-enable' | 'unavailable' | 'cancelled';
/** Reconcile only proven owner enrollment. An opaque local marker is a pointer,
 * NOT authority: the saved row must still exist under the current user's RLS.
 */
export async function resyncSubscription(oldEndpoint?: string | null, expectedUserId?: string,
  current: () => boolean = () => true): Promise<PushRecoveryState> {
  if (!supabase || !hasValidVapidKey || !isPushSupported()) return 'unavailable';
  return exclusive(async () => {
    let created: PushSubscription | null = null;
    let persisted = false;
    try {
      const owner = await pushOwner(expectedUserId, current);
      if (Notification.permission !== 'granted' || pendingPushRevoke()) return 'needs-enable';
      const registration = await registerServiceWorker();
      if (!registration) return 'unavailable';
      await owner.check();
      let subscription = await registration.pushManager.getSubscription();
      const existing = subscription ? await ownedRow(owner, 'endpoint', subscription.endpoint) : null;
      const marker = enrollment(owner.userId);
      const prior = oldEndpoint ? await ownedRow(owner, 'endpoint', oldEndpoint)
        : marker ? await ownedRow(owner, 'id', marker.rowId) : null;
      if (!existing && !prior) return 'needs-enable';
      if (!existing) {
        const preferences = await supabase!.from('notification_preferences').select('push_enabled').eq('user_id', owner.userId).maybeSingle();
        await owner.check();
        if (preferences.error) throw new Error('Notification preferences unavailable');
        if (preferences.data?.push_enabled === false) return 'needs-enable';
      }
      if (subscription && !keyMatches(subscription)) return 'needs-enable'; // Never silently rotate VAPID keys.
      if (!subscription) {
        await owner.check();
        created = subscription = await registration.pushManager.subscribe({ userVisibleOnly: true,
          applicationServerKey: base64UrlToUint8Array(VAPID_PUBLIC_KEY) as BufferSource });
      }
      await owner.check();
      // Retain prior cleanup evidence until replacement AND cleanup succeed.
      if (prior) rememberEnrollment(owner.userId, prior.id);
      let row = existing;
      // No-op healthy resumes; repair changed endpoint/keys before removing old row.
      if (!existing || existing.p256dh !== arrayBufferToBase64Url(subscription.getKey('p256dh'))
        || existing.auth !== arrayBufferToBase64Url(subscription.getKey('auth'))) {
        row = await persistOwned(subscription, owner);
      }
      persisted = true;
      if (prior && prior.id !== row!.id) await deleteOwnedRow(owner, prior.id);
      await owner.check();
      rememberEnrollment(owner.userId, row!.id);
      return 'ready';
    } catch (error) {
      if (created && !persisted) await created.unsubscribe().catch(() => false);
      return error instanceof PushAccountChanged ? 'cancelled' : 'unavailable';
    }
  });
}

/** Auth-scoped launch/resume owner; no permission prompts, no polling/socket. */
export function watchPushSubscriptionRecovery(userId: string, receive: (state: PushRecoveryState) => void = () => {}) {
  let stopped = false, running = false, again = false;
  const recover = async () => {
    if (stopped || document.visibilityState === 'hidden' || navigator.onLine === false) return;
    if (running) { again = true; return; }
    running = true;
    do {
      again = false;
      const state = await resyncSubscription(null, userId, () => !stopped);
      if (!stopped) {
        receive(state);
        window.dispatchEvent(new window.CustomEvent('gayze-push-recovery', { detail: { userId, state } }));
      }
    } while (!stopped && again);
    running = false;
  };
  const event = () => { void recover(); };
  document.addEventListener('visibilitychange', event);
  for (const name of ['pageshow', 'online', 'focus']) window.addEventListener(name, event);
  event();
  return () => {
    stopped = true;
    document.removeEventListener('visibilitychange', event);
    for (const name of ['pageshow', 'online', 'focus']) window.removeEventListener(name, event);
  };
}

/** True when this device currently has a live, persisted subscription. */
export async function isDeviceSubscribed(): Promise<boolean> {
  if (typeof Notification !== 'undefined' && Notification.permission !== 'granted') return false;
  const subscription = await getExistingSubscription();
  if (!subscription) return false;
  // A browser subscription registered to a different account is not "on" for
  // the current user.
  return keyMatches(subscription) && ownsSubscriptionRow(subscription.endpoint);
}

// ---------------------------------------------------------------------------
// Sign-out / shared-device safety
// ---------------------------------------------------------------------------

/**
 * localStorage flag: a sign-out could not confirm that this browser's push
 * subscription was revoked. It is deliberately NOT cleared by the sign-out
 * cache purge, and is honoured on the next app start regardless of who (if
 * anyone) is signed in.
 */
const PUSH_PENDING_REVOKE_KEY = 'gayze_push_pending_revoke';
function pendingPushRevoke(): boolean {
  try { return window.localStorage.getItem(PUSH_PENDING_REVOKE_KEY) === '1'; } catch { return false; }
}

function withTimeout<T>(work: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = window.setTimeout(() => resolve(fallback), ms);
    work.then(
      (value) => { window.clearTimeout(timer); resolve(value); },
      () => { window.clearTimeout(timer); resolve(fallback); },
    );
  });
}

/** This browser's current push subscription, WITHOUT waiting on a worker to become ready. */
async function currentBrowserSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null;
  const registration = await navigator.serviceWorker.getRegistration('/');
  return registration ? registration.pushManager.getSubscription() : null;
}

function setPendingRevoke(pending: boolean): void {
  try {
    if (pending) window.localStorage.setItem(PUSH_PENDING_REVOKE_KEY, '1');
    else window.localStorage.removeItem(PUSH_PENDING_REVOKE_KEY);
  } catch {
    /* Storage unavailable — nothing more we can do. */
  }
}

/**
 * Release this device's push subscription when the user signs out.
 *
 * MUST run BEFORE the Supabase session is removed: deleting the row needs the
 * signed-in user's JWT so it passes (unchanged) RLS. Steps:
 *   1. unsubscribe this browser from PushManager (kills the endpoint at the push service);
 *   2. delete this endpoint's row for the signed-in user.
 * Both are attempted independently. It NEVER throws and is bounded by
 * `timeoutMs`, so a failed or slow cleanup can never block sign-out. If either
 * step could not be confirmed, a pending-revoke flag is left so the browser
 * subscription is revoked on the next app start.
 */
export async function releasePushOnSignOut(timeoutMs = 2500): Promise<void> {
  observePushAuth();
  authEpoch++;
  const epoch = ++revocationEpoch; clearEnrollment();
  if (typeof window === 'undefined') return;

  const work = async (): Promise<boolean> => {
    const subscription = await currentBrowserSubscription();
    if (epoch !== revocationEpoch) return false;
    if (!subscription) return true; // nothing on this device to release
    const { endpoint } = subscription;

    const [unsubscribed, rowRemoved] = await Promise.all([
      subscription.unsubscribe().catch(() => false),
      removeSubscriptionRow(endpoint).catch(() => false),
    ]);
    // `unsubscribed` is the security-critical half (it makes the endpoint
    // undeliverable even if the server row lingers).
    return unsubscribed && rowRemoved;
  };

  try {
    setPendingRevoke(true);
    const clean = await withTimeout(exclusive(work), timeoutMs, false);
    // A late release must not overwrite a subsequent account's enrollment.
    if (epoch === revocationEpoch) setPendingRevoke(!clean);
  } catch (error) {
    console.warn('[GAYZE] Push release on sign-out failed:', error);
    setPendingRevoke(true);
  }
}

/**
 * Revoke this browser's push subscription locally (no server call, no session
 * needed). Used when a session ends without our sign-out handler having run
 * (remote/global sign-out, invalid refresh token) and to finish an interrupted
 * `releasePushOnSignOut`. The now-dead endpoint is pruned server-side on its
 * next 404/410.
 */
export async function revokeLocalPushSubscription(): Promise<void> {
  observePushAuth();
  authEpoch++;
  const epoch = ++revocationEpoch; clearEnrollment();
  setPendingRevoke(true);
  return exclusive(async () => {
    try {
      const subscription = await currentBrowserSubscription();
      if (epoch !== revocationEpoch) return;
      if (subscription) {
        const ok = await subscription.unsubscribe();
        if (!ok) return;
      }
      if (epoch === revocationEpoch) setPendingRevoke(false);
    } catch (error) {
      console.warn('[GAYZE] Local push revoke failed:', error);
    }
  });
}

/** Run once at startup: finish any revoke a previous sign-out could not confirm. */
export async function finishPendingPushRevoke(): Promise<void> {
  if (typeof window === 'undefined') return;
  let pending = false;
  try { pending = window.localStorage.getItem(PUSH_PENDING_REVOKE_KEY) === '1'; } catch { /* ignore */ }
  if (pending) await revokeLocalPushSubscription();
}

// ---------------------------------------------------------------------------
// Connection push (mutual interest)
// ---------------------------------------------------------------------------

/**
 * Tell the backend that the signed-in user's `submit_interest` call just made a
 * mutual connection, so the OTHER member can be notified. The recipient is never
 * sent from here: the authenticated notification RPC derives it from
 * conversation_members and persists a unique recipient/conversation record.
 * The server sender separately enforces preferences and per-endpoint claims.
 * Fire-and-forget: it never throws and never affects the interest flow.
 */
export async function requestConnectionPush(conversationId: string): Promise<void> {
  if (!supabase || !conversationId) return;
  try {
    // Persist independently of HTTP/provider availability. RPC derives recipient
    // and verifies the caller's membership; the notification INSERT dispatches.
    const { error } = await supabase.rpc('gayze_connection_notification', { p_conversation: conversationId });
    if (error) console.warn('[GAYZE] Connection push request failed:', error.message);
  } catch (error) {
    console.warn('[GAYZE] Connection push request failed:', error);
  }
}

// ---------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------

export async function loadNotificationPreferences(): Promise<NotificationPreferences> {
  if (!supabase) return DEFAULT_NOTIFICATION_PREFERENCES;
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user?.id;
  if (!userId) return DEFAULT_NOTIFICATION_PREFERENCES;

  const { data, error } = await supabase
    .from('notification_preferences')
    .select('push_enabled,messages,intent_activity,connections,intent_expiry,safety')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    console.warn('[GAYZE] Notification preferences unavailable:', error.message);
    return DEFAULT_NOTIFICATION_PREFERENCES;
  }
  if (!data) return DEFAULT_NOTIFICATION_PREFERENCES;

  return {
    pushEnabled: data.push_enabled ?? true,
    messages: data.messages ?? true,
    intentActivity: data.intent_activity ?? true,
    connections: data.connections ?? true,
    intentExpiry: data.intent_expiry ?? true,
    safety: data.safety ?? true,
  };
}

export async function saveNotificationPreferences(prefs: NotificationPreferences, expectedUserId?: string): Promise<boolean> {
  if (!supabase) return false;
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user?.id;
  if (!userId || (expectedUserId && userId !== expectedUserId)) return false;

  const { error } = await supabase.from('notification_preferences').upsert(
    {
      user_id: userId,
      push_enabled: prefs.pushEnabled,
      messages: prefs.messages,
      intent_activity: prefs.intentActivity,
      connections: prefs.connections,
      intent_expiry: prefs.intentExpiry,
      safety: prefs.safety,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  );

  if (error) {
    console.warn('[GAYZE] Saving notification preferences failed:', error.message);
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Test push (developer / admin only — see NotificationsModal gating)
// ---------------------------------------------------------------------------

export async function sendTestNotification(): Promise<{ ok: boolean; reason?: string }> {
  if (!supabase) return { ok: false, reason: 'Gayze cannot reach its backend right now.' };
  try {
    const { data, error } = await supabase.functions.invoke('send-push', {
      body: { action: 'test' },
    });
    if (error) {
      const status = (error as { context?: { status?: number } }).context?.status;
      return { ok: false, reason: status === 403
        ? 'Server policy refused the test. Operator access and an allowed app origin are required.'
        : status === 503 ? 'The server Web Push configuration is unavailable.' : 'The push test request failed. Check the server diagnostics.' };
    }
    if ((data as { skipped?: string } | null)?.skipped === 'preferences') return { ok: false, reason: 'Push notifications are disabled in your preferences.' };
    const delivered = (data as { delivered?: number } | null)?.delivered ?? 0;
    if (delivered === 0) {
      return { ok: false, reason: 'No provider accepted this test. Check device registration and server diagnostics. Repeated tests within one minute are deduplicated.' };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : 'Test notification failed.' };
  }
}

// ---------------------------------------------------------------------------
// Badging API
// ---------------------------------------------------------------------------

type BadgeNavigator = Navigator & {
  setAppBadge?: (count?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
};

export function isBadgingSupported(): boolean {
  return typeof navigator !== 'undefined' && 'setAppBadge' in navigator;
}

/** Reflect real unread state on the Home Screen icon. */
export function updateAppBadge(count: number): void {
  if (typeof navigator === 'undefined') return;
  const nav = navigator as BadgeNavigator;
  try {
    if (count > 0) void nav.setAppBadge?.(count);
    else void nav.clearAppBadge?.();
  } catch {
    /* Badging is a progressive enhancement; never surface an error. */
  }
}

export function clearAppBadge(): void {
  updateAppBadge(0);
}
