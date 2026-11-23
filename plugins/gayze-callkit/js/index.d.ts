import type { PluginListenerHandle } from '@capacitor/core';
export interface VoipTokenEvent { token: string; environment: 'sandbox' | 'production'; deviceId?: string }
export interface AudioRoute { kind: 'speaker' | 'receiver' | 'bluetooth' | 'headphones' | 'car' | 'other'; name: string }
export interface CallKitCallEvent { callId: string; callerName?: string; callType?: 'audio' | 'video'; conversationId?: string; callerId?: string }
export interface NativeIceServer { urls: string[]; username?: string; credential?: string }
/** An audio call carried by native code (answered on the iPhone call screen, possibly while locked). */
export interface NativeCallInfo { active: boolean; callId?: string; callerName?: string; callerId?: string; conversationId?: string; state?: 'connecting' | 'connected' | 'ended' | 'failed'; muted?: boolean }
/** What the person tapped on a notification (or one of its buttons, on the phone or the watch). */
export interface PushActionEvent { action: 'open' | 'accept' | 'decline'; type?: string; notificationId?: string; url?: string; conversationId?: string; interestId?: string }
export interface PushTokenEvent { token: string; environment: 'sandbox' | 'production'; deviceId?: string }
export interface GayzeCallKitPlugin {
  /** Asks permission to show notifications and registers with Apple. The token arrives as a `pushToken` event. */
  registerForPush(): Promise<{ granted: boolean; token?: string; environment?: 'sandbox' | 'production'; deviceId?: string }>;
  /** Hands native code what it needs to set a call up with the web view asleep. An empty callKey clears it. */
  setNativeCallConfig(options: { supabaseUrl: string; apiKey: string; callKey: string; iceServers: NativeIceServer[] }): Promise<void>;
  /** The native call in progress, if any. */
  getNativeCall(): Promise<NativeCallInfo>;
  setNativeMuted(options: { muted: boolean }): Promise<void>;
  /** Starts listening for call pushes. Resolves with the current token if iOS already issued one. */
  register(): Promise<{ token?: string; environment?: 'sandbox' | 'production'; deviceId?: string }>;
  /** Remembers who is signed in on this phone (empty string clears it), so a call you make never rings your own phone. */
  setUser(options: { userId: string }): Promise<void>;
  /** Dismisses the system call screen for one call (when the call ends inside the app). */
  /** Reports where the call sound is going. It no longer changes the audio session: the web view owns the call audio. */
  configureAudio(options: { video: boolean }): Promise<AudioRoute>;
  getAudioRoute(): Promise<AudioRoute>;
  /** Opens the iOS audio output picker. */
  showRoutePicker(): Promise<void>;
  /** The call was answered inside the app: answer the system call screen to match (switches the call audio on, stops the ringing). */
  answerCall(options: { callId: string }): Promise<void>;
  /** True while iOS's own call screen or banner is showing this call (not yet answered). */
  systemCallRinging(options: { callId: string }): Promise<{ ringing: boolean; known?: boolean; answered?: boolean }>;
  endCall(options: { callId: string }): Promise<void>;
  endAll(): Promise<void>;
  addListener(event: 'voipToken', fn: (e: VoipTokenEvent) => void): Promise<PluginListenerHandle>;
  addListener(event: 'pushToken', fn: (e: PushTokenEvent) => void): Promise<PluginListenerHandle>;
  addListener(event: 'pushAction', fn: (e: PushActionEvent) => void): Promise<PluginListenerHandle>;
  addListener(event: 'pushError', fn: (e: { message: string }) => void): Promise<PluginListenerHandle>;
  addListener(event: 'audioRoute', fn: (e: AudioRoute) => void): Promise<PluginListenerHandle>;
  addListener(event: 'nativeCall', fn: (e: NativeCallInfo) => void): Promise<PluginListenerHandle>;
  addListener(event: 'callAnswered' | 'callDeclined' | 'callEnded', fn: (e: CallKitCallEvent) => void): Promise<PluginListenerHandle>;
}
export declare const GayzeCallKit: GayzeCallKitPlugin;
