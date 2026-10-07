import { supabase } from './supabaseClient';

/**
 * GAYZE — notification deep-link routing.
 *
 * Same-origin notification routes are additionally guarded by the recipient
 * identity carried in the service-worker click message. A notification for
 * account A must never be routed into an already-signed-in account B.
 */

export type GayzeTab = 'dating' | 'right_now' | 'later' | 'swarms' | 'safe_havens' | 'profile';

export interface NotificationRoute {
  tab: GayzeTab;
  conversationId?: string;
  openNotifications?: boolean;
  messagesSubtab?: 'chats' | 'notifications';
}

let currentAuthUserId: string | null = null;
let authGuardInstalled = false;
if (supabase?.auth) {
  authGuardInstalled = true;
  void supabase.auth.getSession().then(({ data }) => {
    currentAuthUserId = data.session?.user?.id ?? null;
  }).catch(() => {});
  supabase.auth.onAuthStateChange((_event, session) => {
    currentAuthUserId = session?.user?.id ?? null;
  });
}

/**
 * Returns false when a notification is explicitly addressed to another
 * authenticated account. Missing recipient identity is allowed for legacy
 * non-account-specific routes and for the cold-launch/login handoff.
 */
export function notificationRecipientMatches(recipientId: string | null | undefined): boolean {
  if (!recipientId || !authGuardInstalled) return true;
  if (!currentAuthUserId) return true;
  return recipientId === currentAuthUserId;
}

/**
 * Intercept a service-worker click before the normal App message handler when
 * the click belongs to a different signed-in account. We acknowledge the
 * worker handshake as handled without navigating, preventing its fallback
 * navigate/openWindow path from carrying the foreign destination forward.
 */
if (typeof window !== 'undefined') {
  window.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || data.source !== 'gayze-sw' || data.type !== 'NOTIFICATION_CLICK') return;
    const payload = data.data as { recipientId?: string | null } | undefined;
    if (notificationRecipientMatches(payload?.recipientId)) return;
    event.stopImmediatePropagation();
    event.ports?.[0]?.postMessage({ handled: true });
  }, true);
}

/** Map a Gayze path to a shell destination. */
export function routeFromPath(pathname: string): NotificationRoute {
  const clean = (pathname || '/').split('#')[0] || '/';
  const url = (() => {
    try { return new URL(clean, 'https://gayze.local'); } catch { return null; }
  })();
  const pathOnly = (url?.pathname || clean).replace(/\/+$/, '') || '/';
  const segments = pathOnly.split('/').filter(Boolean);
  const [head, second] = segments;

  // Query recipient is intentionally checked here too, covering cold-launch
  // paths retained through sessionStorage after authentication is restored.
  const recipientId = url?.searchParams.get('recipient') || null;
  if (!notificationRecipientMatches(recipientId)) return { tab: 'right_now' };

  switch (head) {
    case undefined:
      return { tab: 'right_now' };
    case 'messages':
    case 'chat':
      return { tab: 'swarms', conversationId: second };
    case 'right-now':
    case 'right_now':
      return { tab: 'right_now' };
    case 'discover':
    case 'dating':
      return { tab: 'dating' };
    case 'later':
    case 'gatherings':
      return { tab: 'later' };
    case 'safe-havens':
    case 'safe_havens':
      return { tab: 'safe_havens' };
    case 'profile':
      return second === 'notifications'
        ? { tab: 'swarms', messagesSubtab: 'notifications' }
        : { tab: 'profile' };
    case 'notifications':
      return { tab: 'swarms', messagesSubtab: 'notifications' };
    default:
      return { tab: 'right_now' };
  }
}

export function isAuthPath(pathname: string): boolean {
  return pathname.startsWith('/auth/');
}

export function replacePath(path: string): void {
  if (typeof window === 'undefined') return;
  try { window.history.replaceState({}, '', path); } catch { /* non-fatal */ }
}

export interface ServiceWorkerAppMessage {
  source?: string;
  type?: string;
  url?: string;
  oldEndpoint?: string | null;
  navigationExpiresAt?: number;
  payload?: unknown;
  data?: unknown;
}

export function isGayzeServiceWorkerMessage(data: unknown): data is ServiceWorkerAppMessage {
  return Boolean(data) && typeof data === 'object' && (data as ServiceWorkerAppMessage).source === 'gayze-sw';
}

const PENDING_NOTIFICATION_PATH = 'gayze_notification_destination';
export function rememberNotificationPath(raw: string): void {
  if (typeof window === 'undefined') return;
  try {
    const url = new URL(raw, window.location.origin);
    if (url.origin !== window.location.origin || isAuthPath(url.pathname)) return;
    if (!/^\/(notifications|profile(?:\/notifications)?|messages\/[0-9a-f-]{36})\/?$/i.test(url.pathname)) return;
    window.sessionStorage.setItem(PENDING_NOTIFICATION_PATH, url.pathname + url.search);
  } catch { /* Private browsing can deny storage. */ }
}
export function consumeNotificationPath(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(PENDING_NOTIFICATION_PATH);
    window.sessionStorage.removeItem(PENDING_NOTIFICATION_PATH);
    if (!raw) return null;
    const url = new URL(raw, window.location.origin);
    if (url.origin !== window.location.origin || !/^\/(notifications|profile(?:\/notifications)?|messages\/[0-9a-f-]{36})\/?$/i.test(url.pathname)) return null;
    const recipientId = url.searchParams.get('recipient');
    return notificationRecipientMatches(recipientId) ? url.pathname + url.search : null;
  } catch { return null; }
}
