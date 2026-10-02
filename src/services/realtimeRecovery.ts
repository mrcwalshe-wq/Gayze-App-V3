import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';

export type ChatConnectionState = 'connecting' | 'syncing' | 'connected' | 'reconnecting' | 'offline' | 'suspended' | 'sign-in-required';
export class SessionRequiredError extends Error {}

export interface RecoveryEnvironment {
  online(): boolean;
  visible(): boolean;
  now(): number;
  random(): number;
  later(fn: () => void, ms: number): ReturnType<typeof setTimeout>;
  cancel(timer: ReturnType<typeof setTimeout>): void;
  watch(fn: () => void): () => void;
}

export const browserRecoveryEnvironment: RecoveryEnvironment = {
  online: () => typeof navigator === 'undefined' || navigator.onLine,
  visible: () => typeof document === 'undefined' || document.visibilityState !== 'hidden',
  now: () => Date.now(), random: () => Math.random(),
  later: (fn, ms) => setTimeout(fn, ms), cancel: (timer) => clearTimeout(timer),
  watch(fn) {
    const network = (navigator as Navigator & { connection?: EventTarget }).connection;
    window.addEventListener('online', fn);
    window.addEventListener('offline', fn);
    window.addEventListener('pageshow', fn);
    document.addEventListener('visibilitychange', fn);
    network?.addEventListener('change', fn);
    return () => {
      window.removeEventListener('online', fn);
      window.removeEventListener('offline', fn);
      window.removeEventListener('pageshow', fn);
      document.removeEventListener('visibilitychange', fn);
      network?.removeEventListener('change', fn);
    };
  },
};

// Shared across mounts, not a second socket. A StrictMode remount must wait for
// the previous owner of the same Supabase topic to finish leaving it.
const transportRepairs = new WeakMap<SupabaseClient, { at: number; pending: Promise<void> }>();
const departures = new WeakMap<SupabaseClient, Map<string, Promise<void>>>();

interface RecoveryOptions {
  client: SupabaseClient;
  topic: string;
  userId?: string;
  session(signal: AbortSignal): Promise<void>;
  build(channel: RealtimeChannel, current: () => boolean, signal: AbortSignal): RealtimeChannel;
  reconcile(signal: AbortSignal, current: () => boolean, progress: () => void): Promise<void>;
  status(state: ChatConnectionState): void;
  environment?: RecoveryEnvironment;
  pollMs?: number;
  syncWhileJoining?: boolean;
  subscribed?: () => void;
  channelOptions?: Parameters<SupabaseClient['channel']>[1];
}

/** Owns only channel membership/reconciliation; the existing SDK owns the socket. */
export class RealtimeRecovery {
  private env: RecoveryEnvironment;
  private channel: RealtimeChannel | null = null;
  private generation = 0;
  private stopped = false;
  private joined = false;
  private attempt = 0;
  private state: ChatConnectionState = 'connecting';
  private retry?: ReturnType<typeof setTimeout>;
  private deadline?: ReturnType<typeof setTimeout>;
  private poll?: ReturnType<typeof setTimeout>;
  private sync?: AbortController;
  private joining?: AbortController;
  private lastAttempt = -Infinity;
  private current = () => false;
  private resyncRequested = false;
  private unwatch: () => void;
  private unAuth: () => void;

  constructor(private options: RecoveryOptions) {
    this.env = options.environment ?? browserRecoveryEnvironment;
    this.unwatch = this.env.watch(() => this.resume());
    const { data } = options.client.auth.onAuthStateChange((event, session) => {
      // Never await auth APIs inside an auth callback (SDK lock re-entry).
      if (event === 'SIGNED_OUT' || (session && options.userId && session.user.id !== options.userId)) this.park('sign-in-required');
      else if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        if (this.state === 'sign-in-required' || !this.joined) this.request();
      }
    });
    this.unAuth = () => data.subscription.unsubscribe();
    this.resume();
  }

  private report(state: ChatConnectionState) {
    this.state = state;
    if (!this.stopped) this.options.status(state);
  }
  private clear(kind: 'retry' | 'deadline' | 'poll') {
    if (this[kind] !== undefined) this.env.cancel(this[kind]!);
    this[kind] = undefined;
  }
  private retire() {
    ++this.generation; // Invalidate callbacks BEFORE unsubscribe emits CLOSED.
    this.joined = false;
    this.resyncRequested = false;
    this.current = () => false;
    this.joining?.abort();
    this.sync?.abort();
    this.joining = undefined;
    this.sync = undefined;
    this.clear('deadline'); this.clear('poll');
    const channel = this.channel;
    this.channel = null;
    if (!channel) return;
    let topics = departures.get(this.options.client);
    if (!topics) { topics = new Map(); departures.set(this.options.client, topics); }
    // SDK unsubscribe is bounded; teardown cancels its retry loop even when
    // the leave acknowledgement times out. Do not disconnect the shared socket.
    const leaving = channel.unsubscribe(3000).catch(() => undefined).then(() => { channel.teardown(); });
    topics.set(this.options.topic, leaving);
    void leaving.finally(() => { if (topics!.get(this.options.topic) === leaving) topics!.delete(this.options.topic); });
  }
  private park(state: ChatConnectionState) {
    this.clear('retry');
    this.retire();
    this.report(state);
  }
  private resume() {
    if (this.stopped) return;
    if (!this.env.online()) { this.park('offline'); return; }
    if (!this.env.visible()) { this.park('suspended'); return; }
    // Re-read online state on every resume; an `online` event can be missed
    // during iOS suspension. Even a nominally joined socket may be half-open.
    this.request();
  }
  private request(backoff = false) {
    if (this.stopped || this.retry !== undefined) return;
    if (!this.env.online()) { this.park('offline'); return; }
    if (!this.env.visible()) { this.park('suspended'); return; }
    const delay = backoff ? Math.min(30_000, 1000 * 2 ** Math.min(this.attempt++, 5)) + this.env.random() * 250 : 150;
    // Coalesce pageshow/visibility/network bursts, without continually resetting
    // the timer. Minimum attempt spacing also bounds externally-triggered storms.
    this.retry = this.env.later(() => {
      this.retry = undefined;
      void this.connect();
    }, Math.max(delay, 1000 - (this.env.now() - this.lastAttempt)));
  }
  private repairStalledTransport() {
    const client = this.options.client;
    const prior = transportRepairs.get(client);
    if (prior && this.env.now() - prior.at < 30_000) return;
    const pending = client.realtime.disconnect().then(() => {
      if (this.env.online() && this.env.visible()) client.realtime.connect();
    }).catch(() => undefined);
    transportRepairs.set(client, { at: this.env.now(), pending });
  }
  private async connect() {
    if (this.stopped) return;
    if (!this.env.online() || !this.env.visible()) { this.resume(); return; }
    this.lastAttempt = this.env.now();
    this.retire();
    const generation = this.generation;
    const abort = new AbortController();
    this.joining = abort;
    const current = () => !this.stopped && generation === this.generation && !abort.signal.aborted;
    this.current = current;
    this.report(this.attempt ? 'reconnecting' : 'connecting');
    this.deadline = this.env.later(() => {
      if (current()) {
        // A socket may still report OPEN after iOS suspension but acknowledge
        // no joins. Only a stalled JOIN (not an auth/read failure) escalates to
        // resetting the existing SDK transport, shared/coalesced across feeds.
        if (this.channel) this.repairStalledTransport();
        this.retire(); this.report('reconnecting'); this.request(true);
      }
    }, 20_000);
    try {
      await departures.get(this.options.client)?.get(this.options.topic);
      if (!current()) return;
      await this.options.session(abort.signal);
      if (!current()) return;
      const channel = this.options.client.channel(this.options.topic, this.options.channelOptions);
      this.channel = channel;
      this.options.build(channel, current, abort.signal).subscribe((status) => {
        if (!current()) return;
        if (status === 'SUBSCRIBED') {
          this.clear('deadline'); this.clear('retry');
          this.joined = true;
          this.options.subscribed?.();
          void this.reconcile(current);
        } else if (['CHANNEL_ERROR', 'ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) {
          this.joined = false;
          this.sync?.abort(); this.sync = undefined;
          this.report('reconnecting');
          // Allow the SDK a bounded opportunity to rejoin; success cancels this
          // timer. A stuck/closed channel is then explicitly replaced.
          this.request(true);
        }
      });
      // REST is authoritative even while the socket is still joining.
      if (this.options.syncWhileJoining !== false) void this.reconcile(current);
    } catch (error) {
      if (!current()) return;
      this.retire();
      if (error instanceof SessionRequiredError) this.report('sign-in-required');
      else { this.report('reconnecting'); this.request(true); }
    }
  }
  private async reconcile(current: () => boolean) {
    if (!current() || this.sync) return;
    this.clear('poll');
    const abort = new AbortController();
    this.sync = abort;
    const valid = () => current() && !abort.signal.aborted;
    if (this.state !== 'connected') this.report('syncing');
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const progress = () => {
      if (!valid()) return;
      if (deadline !== undefined) this.env.cancel(deadline);
      deadline = this.env.later(() => {
        if (!valid()) return;
        abort.abort(); this.sync = undefined;
        this.retryRead();
      }, 60_000);
    };
    progress();
    try {
      await this.options.session(abort.signal);
      if (!valid()) return;
      await this.options.reconcile(abort.signal, valid, progress);
      if (!valid()) return;
      if (this.joined) this.attempt = 0;
      this.report(this.joined ? 'connected' : this.attempt ? 'reconnecting' : 'connecting');
    } catch (error) {
      if (!valid()) return;
      if (error instanceof SessionRequiredError) this.park('sign-in-required');
      else this.retryRead();
    } finally {
      if (deadline !== undefined) this.env.cancel(deadline);
      if (this.sync === abort) this.sync = undefined;
      if (valid() && this.retry === undefined && this.poll === undefined && this.state !== 'sign-in-required') {
        const delay = this.resyncRequested ? 0 : this.options.pollMs ?? 30_000;
        this.resyncRequested = false;
        this.poll = this.env.later(() => { this.poll = undefined; void this.reconcile(current); }, delay);
      }
    }
  }
  private retryRead() {
    if (!this.joined) { this.report('reconnecting'); this.request(true); return; }
    // A REST/decrypt failure is not evidence the shared socket or presence died.
    // Keep live delivery alive while retrying the authoritative read with backoff.
    this.report('syncing');
    this.clear('poll');
    const delay = Math.min(30_000, 1000 * 2 ** Math.min(this.attempt++, 5)) + this.env.random() * 250;
    this.poll = this.env.later(() => { this.poll = undefined; void this.reconcile(this.current); }, delay);
  }
  /** Data invalidation/new observer is NOT a transport failure. Keep the
   * healthy SDK channel and coalesce a read after any in-flight reconciliation. */
  resync() {
    if (this.stopped) return;
    if (this.sync) { this.resyncRequested = true; return; }
    if (this.current()) void this.reconcile(this.current);
    else this.request();
  }
  refresh() { this.resume(); }
  stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.unwatch(); this.unAuth(); this.clear('retry'); this.retire();
  }
}

function sessionError(error: unknown): unknown {
  const failure = error as { name?: string; code?: string; status?: number };
  if (failure.name === 'AuthSessionMissingError' || failure.status === 401 || failure.status === 403 ||
    ['refresh_token_not_found', 'refresh_token_already_used', 'session_not_found'].includes(failure.code ?? '')) {
    return new SessionRequiredError('Sign in required');
  }
  return error; // Network/5xx failure is retryable, not evidence of sign-out.
}

/** SDK already propagates refreshed tokens to Realtime; validate before joining. */
export async function requireRealtimeSession(client: SupabaseClient, userId: string, signal: AbortSignal) {
  const { data, error } = await client.auth.getSession();
  if (signal.aborted) return;
  if (error) throw sessionError(error);
  let session = data.session;
  if (!session || session.user.id !== userId) throw new SessionRequiredError('Sign in required');
  if (!session.expires_at || session.expires_at * 1000 <= Date.now() + 60_000) {
    const refreshed = await client.auth.refreshSession();
    if (signal.aborted) return;
    if (refreshed.error) throw sessionError(refreshed.error);
    session = refreshed.data.session;
  }
  if (!session || session.user.id !== userId) throw new SessionRequiredError('Sign in required');
}
