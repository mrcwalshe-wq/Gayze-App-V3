import type { PluginListenerHandle } from '@capacitor/core';
export interface VoipTokenEvent { token: string; environment: 'sandbox' | 'production'; deviceId?: string }
export interface CallKitCallEvent { callId: string; callerName?: string; callType?: 'audio' | 'video'; conversationId?: string; callerId?: string }
export interface GayzeCallKitPlugin {
  /** Starts listening for call pushes. Resolves with the current token if iOS already issued one. */
  register(): Promise<{ token?: string; environment?: 'sandbox' | 'production'; deviceId?: string }>;
  /** Remembers who is signed in on this phone (empty string clears it), so a call you make never rings your own phone. */
  setUser(options: { userId: string }): Promise<void>;
  /** Dismisses the system call screen for one call (when the call ends inside the app). */
  endCall(options: { callId: string }): Promise<void>;
  endAll(): Promise<void>;
  addListener(event: 'voipToken', fn: (e: VoipTokenEvent) => void): Promise<PluginListenerHandle>;
  addListener(event: 'callAnswered' | 'callDeclined' | 'callEnded', fn: (e: CallKitCallEvent) => void): Promise<PluginListenerHandle>;
}
export declare const GayzeCallKit: GayzeCallKitPlugin;
