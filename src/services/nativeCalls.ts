import { supabase } from './supabaseClient';
import { callLog, type IncomingCall } from './webrtcService';

/**
 * Real phone-call experience on the iPhone app: iOS wakes the app with a VoIP push and shows the system call screen
 * (lock screen, ringtone, Answer / Decline). Answering opens the app and hands the call to the web layer.
 * Does nothing in the browser or on Android.
 */
const isIos = (): boolean => {
  if (typeof window === 'undefined') return false;
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string } }).Capacitor;
  return Boolean(cap?.isNativePlatform?.() && cap.getPlatform?.() === 'ios');
};

export interface NativeCallHandlers {
  onAnswered: (call: Partial<IncomingCall> & { callId: string }) => void;
  onDeclined: (call: Partial<IncomingCall> & { callId: string }) => void;
}

interface CallEvent { callId: string; callerName?: string; callType?: 'audio' | 'video'; conversationId?: string; callerId?: string }
const toCall = (e: CallEvent): Partial<IncomingCall> & { callId: string } => ({
  callId: e.callId, callerName: e.callerName, callType: e.callType, conversationId: e.conversationId, callerId: e.callerId,
});

let lastToken: string | null = null;

async function saveToken(token: string, environment: 'sandbox' | 'production', deviceId?: string): Promise<void> {
  if (!supabase) return;
  lastToken = token;
  const { error } = await supabase.rpc('register_voip_token', { p_token: token, p_environment: environment, p_device: deviceId || null });
  if (error) console.warn('[GAYZE] Could not save the call token:', error.message);
}

/** Starts listening. Returns a function that stops listening. */
export async function startNativeCalls(handlers: NativeCallHandlers, userId?: string): Promise<() => void> {
  if (!isIos()) return () => undefined;
  try {
    const { GayzeCallKit } = await import('gayze-callkit');
    if (userId) await GayzeCallKit.setUser({ userId });
    const subs = await Promise.all([
      GayzeCallKit.addListener('voipToken', (e) => { void saveToken(e.token, e.environment, e.deviceId); }),
      GayzeCallKit.addListener('callAnswered', (e) => { callLog(`phone call screen: answered ${e.callId}`); handlers.onAnswered(toCall(e)); }),
      GayzeCallKit.addListener('callDeclined', (e) => { callLog(`phone call screen: declined ${e.callId}`); handlers.onDeclined(toCall(e)); }),
    ]);
    const current = await GayzeCallKit.register();
    if (current.token && current.environment) void saveToken(current.token, current.environment, current.deviceId);
    return () => { subs.forEach((s) => { void s.remove(); }); };
  } catch (error) {
    console.warn('[GAYZE] Phone-call support is unavailable:', error);
    return () => undefined;
  }
}

/** The call finished inside the app: take the system call screen down. */
export async function endNativeCalls(): Promise<void> {
  if (!isIos()) return;
  try { const { GayzeCallKit } = await import('gayze-callkit'); await GayzeCallKit.endAll(); } catch { /* nothing to end */ }
}

/** Signing out: stop this phone ringing for the account, and forget who is signed in. Bounded; never throws. */
export async function releaseNativeCallToken(): Promise<void> {
  if (!isIos()) return;
  const work = (async () => {
    try {
      if (supabase && lastToken) await supabase.rpc('unregister_voip_token', { p_token: lastToken });
      const { GayzeCallKit } = await import('gayze-callkit');
      await GayzeCallKit.setUser({ userId: '' });
    } catch { /* nothing to release */ }
  })();
  await Promise.race([work, new Promise<void>((resolve) => { window.setTimeout(resolve, 1500); })]);
}
