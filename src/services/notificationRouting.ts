/**
 * GAYZE — notification deep-link routing.
 *
 * Gayze is a single-shell tab app, not a router-based app. Rather than bolt a
 * second routing system on top, a notification URL is translated into the
 * existing shell's own coordinates: a destination tab plus an optional
 * conversation to open.
 *
 * Only same-origin paths are ever honoured (the service worker already
 * normalises them), so a push payload can never navigate Gayze off-site.
 */

export type GayzeTab = 'dating' | 'right_now' | 'later' | 'swarms' | 'safe_havens' | 'profile';

export interface NotificationRoute {
  tab: GayzeTab;
  /** Conversation to open when the destination is Messages. */
  conversationId?: string;
  /** Sub-destination hint for the Profile tab. */
  openNotifications?: boolean;
}

/**
 * Map a Gayze path to a shell destination.
 * Unknown paths fall back to the default landing tab.
 */
export function routeFromPath(pathname: string): NotificationRoute {
  const clean = (pathname || '/').split('?')[0].split('#')[0].replace(/\/+$/, '') || '/';
  const segments = clean.split('/').filter(Boolean);
  const [head, second] = segments;

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
      return { tab: 'profile', openNotifications: second === 'notifications' };
    case 'notifications':
      return { tab: 'profile', openNotifications: true };
    default:
      return { tab: 'right_now' };
  }
}

/** Auth callback paths must never be treated as a notification destination. */
export function isAuthPath(pathname: string): boolean {
  return pathname.startsWith('/auth/');
}

/**
 * Replace the address bar with a path without reloading the SPA.
 * Used after a notification opens Gayze so the URL matches what is on screen.
 */
export function replacePath(path: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.history.replaceState({}, '', path);
  } catch {
    /* Non-fatal: the shell is already showing the right destination. */
  }
}

/** Message shape posted by the service worker to open windows. */
export interface ServiceWorkerAppMessage {
  source?: string;
  type?: string;
  url?: string;
  oldEndpoint?: string | null;
  payload?: unknown;
}

export function isGayzeServiceWorkerMessage(data: unknown): data is ServiceWorkerAppMessage {
  return Boolean(data) && typeof data === 'object' && (data as ServiceWorkerAppMessage).source === 'gayze-sw';
}
