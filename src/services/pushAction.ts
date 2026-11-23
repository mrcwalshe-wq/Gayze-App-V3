/**
 * What the iPhone app hands over when a notification, or one of its buttons, is tapped. Pure and import-free so it can be tested on its own.
 */

export interface PushAction {
  /** Tapped the notification, or its Accept / Not now button. */
  action: 'open' | 'accept' | 'decline';
  type?: string;
  notificationId?: string;
  /** A path inside the app, never a full address. */
  url?: string;
  conversationId?: string;
  interestId?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidOrUndefined = (v: unknown): string | undefined => (typeof v === 'string' && UUID.test(v) ? v.toLowerCase() : undefined);

/**
 * What the phone hands over when a notification is tapped is data from outside this page, so only what the app can use is kept:
 * a known action, ids that are real ids, and a path that stays inside the app.
 */
export function parsePushAction(raw: unknown): PushAction | null {
  if (!raw || typeof raw !== 'object') return null;
  const e = raw as Record<string, unknown>;
  const action = e.action === 'accept' || e.action === 'decline' || e.action === 'open' ? e.action : null;
  if (!action) return null;
  const url = typeof e.url === 'string' && e.url.length <= 300 && /^\/(?!\/)[\w\-./?=&%]*$/.test(e.url) ? e.url : undefined;
  const out: PushAction = { action };
  if (typeof e.type === 'string' && /^[a-z_]{1,30}$/.test(e.type)) out.type = e.type;
  const notificationId = uuidOrUndefined(e.notificationId); if (notificationId) out.notificationId = notificationId;
  const conversationId = uuidOrUndefined(e.conversationId); if (conversationId) out.conversationId = conversationId;
  const interestId = uuidOrUndefined(e.interestId); if (interestId) out.interestId = interestId;
  if (url) out.url = url;
  // A button with nothing to act on is just a tap.
  if (out.action !== 'open' && !out.interestId) out.action = 'open';
  return out;
}
