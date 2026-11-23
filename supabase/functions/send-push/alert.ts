// Apple alert push for ordinary notifications (a Gayze, a message, a missed call) to the installed iPhone app, and through it to a
// paired Apple Watch. Same key and provider token as the VoIP push (voip.ts); a different topic (the bundle id, no ".voip").
// Nothing private goes through Apple: the same generic wording the Web Push uses, and ids the app needs to open the right screen.
import { providerJwt, forgetProviderJwt, type ApnsConfig } from './voip.ts';

export type AlertResult = 'sent' | 'bad_token' | 'failed';
export interface AppleAlert {
  title: string;
  body: string;
  /** iOS notification category: decides which buttons the notification shows (see GAYZE_GAZE in the app). */
  category?: string;
  /** Notifications with the same thread are grouped; a collapse id replaces an earlier one still waiting. */
  threadId?: string;
  collapseId?: string;
  data: Record<string, string>;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const clip = (value: string, max: number) => value.replace(/[\r\n\t]+/g, ' ').trim().slice(0, max);

export function alertPayload(alert: AppleAlert): Record<string, unknown> {
  const aps: Record<string, unknown> = { alert: { title: clip(alert.title, 80), body: clip(alert.body, 160) }, sound: 'default' };
  if (alert.category) aps.category = alert.category;
  if (alert.threadId) aps['thread-id'] = clip(alert.threadId, 64);
  return { aps, ...alert.data };
}

export async function sendAlertPush(
  cfg: ApnsConfig, token: string, environment: 'sandbox' | 'production', alert: AppleAlert, fetchImpl: typeof fetch = fetch, nowMs = Date.now(),
): Promise<AlertResult> {
  const jwt = await providerJwt(cfg, nowMs);
  const host = environment === 'sandbox' ? 'api.sandbox.push.apple.com' : 'api.push.apple.com';
  const headers: Record<string, string> = {
    authorization: `bearer ${jwt}`,
    'apns-push-type': 'alert',
    'apns-topic': cfg.topic,
    'apns-priority': '10',
    // Still worth showing for a few hours; a Gayze from yesterday is not.
    'apns-expiration': String(Math.floor(nowMs / 1000) + 4 * 3600),
    'content-type': 'application/json',
  };
  if (alert.collapseId) headers['apns-collapse-id'] = alert.collapseId.slice(0, 64);
  try {
    const res = await fetchImpl(`https://${host}/3/device/${token}`, { method: 'POST', headers, body: JSON.stringify(alertPayload(alert)) });
    if (res.status === 200) return 'sent';
    if (res.status === 410 || res.status === 400) {
      const reason = await res.text().catch(() => '');
      if (res.status === 410 || /BadDeviceToken|Unregistered|DeviceTokenNotForTopic/.test(reason)) return 'bad_token';
    }
    if (res.status === 403) forgetProviderJwt();
    return 'failed';
  } catch {
    return 'failed';
  }
}

export interface NoticeRow { id: string; user_id: string; category: string; event_key: string; url: string }

/** The alert for a row of the notification inbox, or null when the iPhone app should not get one. */
export function alertForNotice(notice: NoticeRow, conversationId: string | null): AppleAlert | null {
  const key = notice.event_key ?? '';
  const route = conversationId ? `/messages/${conversationId}` : notice.url;
  const suffix = `notification=${notice.id}&recipient=${notice.user_id}`;
  const url = `${route}${route.includes('?') ? '&' : '?'}${suffix}`;
  const data: Record<string, string> = { type: notice.category, notificationId: notice.id, url };
  if (conversationId) data.conversationId = conversationId;
  switch (notice.category) {
    case 'gaze': {
      if (key.endsWith(':declined')) return { title: 'Gayze update', body: 'Your Gayze was declined.', data };
      const m = /^interest:([0-9a-f-]{36}):received$/i.exec(key);
      if (m && uuid.test(m[1])) return { title: 'New Gayze', body: 'Someone sent you a Gayze.', category: 'GAYZE_GAZE', collapseId: `g-${notice.id}`, data: { ...data, interestId: m[1].toLowerCase() } };
      return { title: 'New Gayze', body: 'Someone sent you a Gayze.', data };
    }
    case 'message': return { title: 'New message', body: 'Someone sent you a message.', threadId: conversationId ? `m-${conversationId}` : undefined, data };
    case 'connection': return { title: 'New connection', body: 'You and someone nearby are both interested.', data };
    case 'missed_call': return { title: 'Missed call', body: 'You missed a GAYZE call.', data };
    case 'intent_expiring': return { title: 'Intent expiring soon', body: 'Your Right Now intent is about to expire.', data };
    case 'gathering_reminder': return { title: 'Plan reminder', body: key.endsWith(':1h') ? 'A plan you are going to starts within the hour.' : 'A plan you are going to starts tomorrow.', data };
    case 'safety': return { title: 'Safety alert', body: 'You have a new safety notification.', data };
    // Calls ring through the VoIP push (a real phone call). An alert as well would be a second, weaker notification.
    case 'call':
    default: return null;
  }
}
