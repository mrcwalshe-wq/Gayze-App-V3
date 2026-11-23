import { supabase } from './supabaseClient';
import { isIos } from './nativeCalls';

/**
 * Ordinary notifications on the iPhone app (a Gayze, a message, a missed call), and so on a paired Apple Watch.
 * The installed app cannot receive Web Push; it registers with Apple here, and the server sends to that token.
 * Does nothing in the browser or on Android.
 */

export { parsePushAction, type PushAction } from './pushAction';
import type { PushAction } from './pushAction';
import { parsePushAction } from './pushAction';

let lastToken: string | null = null;

async function saveToken(token: string, environment: 'sandbox' | 'production', deviceId?: string): Promise<void> {
  if (!supabase) return;
  lastToken = token;
  const { error } = await supabase.rpc('register_apns_token', { p_token: token, p_environment: environment, p_device: deviceId || null });
  if (error) console.warn('[GAYZE] Could not save the notification token:', error.message);
}

/** Starts receiving notifications on this phone. Returns a function that stops listening. */
export async function startNativePush(onAction: (action: PushAction) => void): Promise<() => void> {
  if (!isIos()) return () => undefined;
  try {
    const { GayzeCallKit } = await import('gayze-callkit');
    const subs = await Promise.all([
      GayzeCallKit.addListener('pushToken', (e) => { void saveToken(e.token, e.environment, e.deviceId); }),
      GayzeCallKit.addListener('pushAction', (e) => { const action = parsePushAction(e); if (action) onAction(action); }),
      GayzeCallKit.addListener('pushError', (e) => { console.warn('[GAYZE] Notifications could not be registered:', e.message); }),
    ]);
    // iOS asks for permission the first time only; later calls just report the answer and refresh the token.
    // A few seconds in, so the question does not land on top of the app opening.
    const timer = window.setTimeout(() => {
      void GayzeCallKit.registerForPush().then((r) => { if (r.token && r.environment) void saveToken(r.token, r.environment, r.deviceId); }).catch(() => undefined);
    }, 3000);
    return () => { window.clearTimeout(timer); subs.forEach((s) => { void s.remove(); }); };
  } catch (error) {
    console.warn('[GAYZE] Notifications are unavailable:', error);
    return () => undefined;
  }
}

/** Signing out: stop this phone getting the account's notifications. Bounded; never throws. */
export async function releaseNativePush(): Promise<void> {
  if (!isIos() || !supabase || !lastToken) return;
  const token = lastToken;
  lastToken = null;
  const work = Promise.resolve(supabase.rpc('unregister_apns_token', { p_token: token })).then(() => undefined, () => undefined);
  await Promise.race([work, new Promise<void>((resolve) => { window.setTimeout(resolve, 1500); })]);
}
