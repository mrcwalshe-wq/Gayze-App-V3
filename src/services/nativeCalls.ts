import { supabase } from './supabaseClient';
import type { IncomingCall } from './webrtcService';

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

async function saveToken(token: string, environment: 'sandbox' | 'production'): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.rpc('register_voip_token', { p_token: token, p_environment: environment });
  if (error) console.warn('[GAYZE] Could not save the call token:', error.message);
}

/** Starts listening. Returns a function that stops listening. */
export async function startNativeCalls(handlers: NativeCallHandlers): Promise<() => void> {
  if (!isIos()) return () => undefined;
  try {
    const { GayzeCallKit } = await import('gayze-callkit');
    const subs = await Promise.all([
      GayzeCallKit.addListener('voipToken', (e) => { void saveToken(e.token, e.environment); }),
      GayzeCallKit.addListener('callAnswered', (e) => handlers.onAnswered(toCall(e))),
      GayzeCallKit.addListener('callDeclined', (e) => handlers.onDeclined(toCall(e))),
    ]);
    const current = await GayzeCallKit.register();
    if (current.token && current.environment) void saveToken(current.token, current.environment);
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
