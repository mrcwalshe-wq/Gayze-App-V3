import type { PluginListenerHandle } from '@capacitor/core';
export interface VoipTokenEvent { token: string; environment: 'sandbox' | 'production'; deviceId?: string }
export interface AudioRoute { kind: 'speaker' | 'receiver' | 'bluetooth' | 'headphones' | 'car' | 'other'; name: string }
export interface CallKitCallEvent { callId: string; callerName?: string; callType?: 'audio' | 'video'; conversationId?: string; callerId?: string }
export interface GayzeCallKitPlugin {
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
  systemCallRinging(options: { callId: string }): Promise<{ ringing: boolean }>;
  endCall(options: { callId: string }): Promise<void>;
  endAll(): Promise<void>;
  addListener(event: 'voipToken', fn: (e: VoipTokenEvent) => void): Promise<PluginListenerHandle>;
  addListener(event: 'audioRoute', fn: (e: AudioRoute) => void): Promise<PluginListenerHandle>;
  addListener(event: 'callAnswered' | 'callDeclined' | 'callEnded', fn: (e: CallKitCallEvent) => void): Promise<PluginListenerHandle>;
}
export declare const GayzeCallKit: GayzeCallKitPlugin;
