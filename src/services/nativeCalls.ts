import { supabase, SUPABASE_FUNCTIONS_URL, SUPABASE_PUBLISHABLE_KEY } from './supabaseClient';
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

/** An audio call carried by native code: answered on the iPhone call screen, where the web view cannot run the call. */
export interface NativeCallInfo { active: boolean; callId?: string; callerName?: string; callerId?: string; conversationId?: string; state?: 'connecting' | 'connected' | 'ended' | 'failed'; muted?: boolean }

export interface NativeCallHandlers {
  onAnswered: (call: Partial<IncomingCall> & { callId: string }) => void;
  onDeclined: (call: Partial<IncomingCall> & { callId: string }) => void;
  /** A native call started, changed (connected, muted) or finished. */
  onNativeCall?: (call: NativeCallInfo) => void;
}

interface CallEvent { callId: string; callerName?: string; callType?: 'audio' | 'video'; conversationId?: string; callerId?: string }
const toCall = (e: CallEvent): Partial<IncomingCall> & { callId: string } => ({
  callId: e.callId, callerName: e.callerName, callType: e.callType, conversationId: e.conversationId, callerId: e.callerId,
});

let lastToken: string | null = null;
let lastDeviceId: string | null = null;
/** This phone's call-registration id (iPhone app only), so "sign out other devices" can keep it. */
export const thisDeviceId = (): string | null => lastDeviceId;

async function saveToken(token: string, environment: 'sandbox' | 'production', deviceId?: string): Promise<void> {
  if (!supabase) return;
  lastToken = token;
  if (deviceId) lastDeviceId = deviceId;
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
      GayzeCallKit.addListener('nativeCall', (e) => { handlers.onNativeCall?.(e); }),
    ]);
    const current = await GayzeCallKit.register();
    if (current.token && current.environment) void saveToken(current.token, current.environment, current.deviceId);
    if (current.deviceId) lastDeviceId = current.deviceId;
    // Give native code what it needs to answer a call while the web view is asleep, and keep the relay servers fresh.
    void provisionNativeCalls();
    const refresh = window.setInterval(() => { void provisionNativeCalls(); }, 6 * 3600_000);
    void GayzeCallKit.getNativeCall().then((info) => { if (info.active) handlers.onNativeCall?.(info); }).catch(() => undefined);
    return () => { window.clearInterval(refresh); subs.forEach((s) => { void s.remove(); }); };
  } catch (error) {
    console.warn('[GAYZE] Phone-call support is unavailable:', error);
    return () => undefined;
  }
}

let callKey: string | null = null;
/**
 * A locked iPhone cannot run the web view, so native code sets the call up. It has no session of its own: it gets this phone's
 * call key (issued here, while signed in), the server address and relay servers. Never throws.
 */
async function provisionNativeCalls(): Promise<void> {
  if (!isIos() || !supabase || !lastDeviceId) return;
  try {
    const { GayzeCallKit } = await import('gayze-callkit');
    if (!callKey) {
      const { data, error } = await supabase.rpc('issue_native_call_key', { p_device: lastDeviceId });
      if (error || typeof data !== 'string') return;   // server not updated yet: calls keep using the web view
      callKey = data;
    }
    let iceServers: { urls: string[]; username?: string; credential?: string }[] = [];
    try {
      const { data } = await supabase.functions.invoke('webrtc-ice-servers', { body: {} });
      const list = Array.isArray(data?.iceServers) ? data.iceServers : data?.iceServers ? [data.iceServers] : [];
      iceServers = list.map((s: { urls?: string | string[]; username?: string; credential?: string }) => ({
        urls: Array.isArray(s.urls) ? s.urls : s.urls ? [s.urls] : [], username: s.username, credential: s.credential,
      })).filter((s: { urls: string[] }) => s.urls.length > 0);
    } catch { /* direct routes only until the next refresh */ }
    await GayzeCallKit.setNativeCallConfig({
      supabaseUrl: SUPABASE_FUNCTIONS_URL.replace(/\/functions\/v1$/, ''), apiKey: SUPABASE_PUBLISHABLE_KEY, callKey, iceServers,
    });
  } catch { /* native calls stay off; the web view still handles calls */ }
}

/** Hang up the native call (the End button in the app; the system call screen has its own). */
export async function endNativeAudioCall(callId: string | undefined): Promise<void> {
  if (!isIos() || !callId) return;
  try { const { GayzeCallKit } = await import('gayze-callkit'); await GayzeCallKit.endCall({ callId }); } catch { /* already over */ }
}
export async function setNativeAudioMuted(muted: boolean): Promise<void> {
  if (!isIos()) return;
  try { const { GayzeCallKit } = await import('gayze-callkit'); await GayzeCallKit.setNativeMuted({ muted }); } catch { /* no native call */ }
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
      if (supabase && lastDeviceId) await supabase.rpc('revoke_native_call_key', { p_device: lastDeviceId });
      callKey = null;
      const { GayzeCallKit } = await import('gayze-callkit');
      await GayzeCallKit.setNativeCallConfig({ supabaseUrl: '', apiKey: '', callKey: '', iceServers: [] });
      await GayzeCallKit.setUser({ userId: '' });
    } catch { /* nothing to release */ }
  })();
  await Promise.race([work, new Promise<void>((resolve) => { window.setTimeout(resolve, 1500); })]);
}

/** The person answered in the app: answer the iOS call screen too, so it stops ringing and iOS switches the call audio on. */
export async function answerNativeCall(callId: string | undefined): Promise<void> {
  if (!isIos() || !callId) return;
  try { const { GayzeCallKit } = await import('gayze-callkit'); await GayzeCallKit.answerCall({ callId }); } catch { /* no system call screen for this call */ }
}

/** The person declined in the app: take the iOS call screen down. */
export async function declineNativeCall(callId: string | undefined): Promise<void> {
  if (!isIos() || !callId) return;
  try { const { GayzeCallKit } = await import('gayze-callkit'); await GayzeCallKit.endCall({ callId }); } catch { /* nothing to end */ }
}

/** Is the iPhone's own call screen showing this call? Always false off the iPhone app, or if it cannot tell. */
export async function systemCallRinging(callId: string | undefined): Promise<boolean> {
  if (!isIos() || !callId) return false;
  try { const { GayzeCallKit } = await import('gayze-callkit'); return (await GayzeCallKit.systemCallRinging({ callId })).ringing === true; } catch { return false; }
}

/** True in the iPhone app, where a phone-call screen can stand in for the in-app one. */
export const hasSystemCallScreen = (): boolean => isIos();
