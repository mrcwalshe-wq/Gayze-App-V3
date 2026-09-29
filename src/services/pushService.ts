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

export const isVapidConfigured = VAPID_PUBLIC_KEY.length > 0;

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
      await navigator.serviceWorker.ready;
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

async function persistSubscription(subscription: PushSubscription): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured');

  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user?.id;
  if (!userId) throw new Error('You need to be signed in to enable notifications.');

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

/**
 * Full opt-in flow. MUST be called from a user gesture (iOS requires it).
 *
 *   1. capability check -> 2. register SW -> 3. request permission
 *   -> 4. subscribe with VAPID -> 5. persist to Supabase
 */
export async function subscribeToPush(): Promise<SubscribeResult> {
  const env = getPushEnvironment();

  if (!env.supported) {
    return env.isIos
      ? { ok: false, blockedBy: 'ios-needs-install', reason: 'Add Gayze to your Home Screen to enable notifications.' }
      : { ok: false, blockedBy: 'unsupported', reason: 'This browser does not support push notifications.' };
  }
  if (env.blockedBy === 'ios-needs-install') {
    return { ok: false, blockedBy: 'ios-needs-install', reason: 'Add Gayze to your Home Screen to enable notifications.' };
  }
  if (env.blockedBy === 'permission-denied') {
    return {
      ok: false,
      blockedBy: 'permission-denied',
      reason: 'Notifications are blocked for Gayze. Enable them in your device settings, then try again.',
    };
  }
  if (!isVapidConfigured) {
    return { ok: false, blockedBy: 'not-configured', reason: 'Push notifications are not configured for this build.' };
  }
  if (!isSupabaseConfigured || !supabase) {
    return { ok: false, reason: 'Gayze cannot reach its backend right now.' };
  }

  try {
    const registration = await registerServiceWorker();
    if (!registration) return { ok: false, reason: 'Gayze could not start its notification service.' };

    // Step 3 — permission (user gesture required on iOS).
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      return {
        ok: false,
        blockedBy: permission === 'denied' ? 'permission-denied' : null,
        reason: permission === 'denied'
          ? 'Notifications are blocked for Gayze. Enable them in your device settings, then try again.'
          : 'Notification permission was not granted.',
      };
    }

    // Step 4 — subscribe. Reuse the browser's existing subscription ONLY when
    // the signed-in user already owns it. A subscription left behind by another
    // account (sign-out cleanup could not run) is revoked and replaced with a
    // fresh endpoint, so the previous account's row can never receive this
    // user's notifications and this user never has to claim someone else's row.
    let subscription = await registration.pushManager.getSubscription();
    if (subscription && !(await ownsSubscriptionRow(subscription.endpoint))) {
      const revoked = await subscription.unsubscribe();
      if (!revoked) {
        return { ok: false, reason: 'Gayze could not reset this device\u2019s notification registration. Try again.' };
      }
      subscription = null;
    }
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
      });
    }

    // Step 5 — persist.
    await persistSubscription(subscription);
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Enabling notifications failed.';
    console.warn('[GAYZE] Push subscribe failed:', error);
    return { ok: false, reason: message };
  }
}

/** Turn push off on this device and forget the endpoint server-side. */
export async function unsubscribeFromPush(): Promise<boolean> {
  try {
    const subscription = await getExistingSubscription();
    if (!subscription) return true;
    const { endpoint } = subscription;
    await subscription.unsubscribe();
    await removeSubscriptionRow(endpoint);
    return true;
  } catch (error) {
    console.warn('[GAYZE] Push unsubscribe failed:', error);
    return false;
  }
}

/**
 * Re-subscribe after the browser rotated the endpoint
 * (`pushsubscriptionchange`) and replace the stored row.
 */
export async function resyncSubscription(oldEndpoint?: string | null): Promise<void> {
  if (!isVapidConfigured || !supabase) return;
  try {
    const registration = await registerServiceWorker();
    if (!registration) return;
    if (typeof Notification !== 'undefined' && Notification.permission !== 'granted') return;

    // Only re-register a device this user actually opted in. Browser permission
    // is per-device, not per-account, so on a shared device a different signed-in
    // user must not be silently enrolled just because permission was granted.
    const existing = await registration.pushManager.getSubscription();
    const ownsOld = oldEndpoint ? await ownsSubscriptionRow(oldEndpoint) : false;
    const ownsCurrent = existing ? await ownsSubscriptionRow(existing.endpoint) : false;
    if (!ownsOld && !ownsCurrent) return;

    const subscription =
      existing ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
      }));

    if (oldEndpoint && oldEndpoint !== subscription.endpoint) await removeSubscriptionRow(oldEndpoint);
    await persistSubscription(subscription);
  } catch (error) {
    console.warn('[GAYZE] Push resync failed:', error);
  }
}

/** True when this device currently has a live, persisted subscription. */
export async function isDeviceSubscribed(): Promise<boolean> {
  if (typeof Notification !== 'undefined' && Notification.permission !== 'granted') return false;
  const subscription = await getExistingSubscription();
  if (!subscription) return false;
  // A browser subscription registered to a different account is not "on" for
  // the current user.
  return ownsSubscriptionRow(subscription.endpoint);
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
  if (typeof window === 'undefined') return;

  const work = async (): Promise<boolean> => {
    const subscription = await currentBrowserSubscription();
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
    const clean = await withTimeout(work(), timeoutMs, false);
    // Only a confirmed-clean release clears the retry marker.
    setPendingRevoke(!clean);
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
  try {
    const subscription = await currentBrowserSubscription();
    if (subscription) {
      const ok = await subscription.unsubscribe();
      if (!ok) { setPendingRevoke(true); return; }
    }
    setPendingRevoke(false);
  } catch (error) {
    console.warn('[GAYZE] Local push revoke failed:', error);
    setPendingRevoke(true);
  }
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
 * sent from here: `send-push` derives it from `conversation_members`, verifies
 * the caller belongs to that two-person conversation, enforces the recipient's
 * notification preferences, and claims a once-per-conversation ledger slot.
 * Fire-and-forget: it never throws and never affects the interest flow.
 */
export async function requestConnectionPush(conversationId: string): Promise<void> {
  if (!supabase || !conversationId) return;
  try {
    const { error } = await supabase.functions.invoke('send-push', {
      body: { action: 'connection', conversationId },
    });
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

export async function saveNotificationPreferences(prefs: NotificationPreferences): Promise<boolean> {
  if (!supabase) return false;
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user?.id;
  if (!userId) return false;

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
    if (error) return { ok: false, reason: error.message };
    const delivered = (data as { delivered?: number } | null)?.delivered ?? 0;
    if (delivered === 0) {
      return { ok: false, reason: 'No subscribed device found for your account on the server.' };
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
