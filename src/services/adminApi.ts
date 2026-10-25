import { SUPABASE_FUNCTIONS_URL, SUPABASE_PUBLISHABLE_KEY, supabase } from './supabaseClient';

/**
 * Client for the owner-only admin-api Edge Function. Authorisation is decided on
 * the server for every call; this module only carries the signed-in user's token.
 */
export type AdminErrorCode =
  | 'unauthenticated' | 'forbidden' | 'reauth_required' | 'invalid_request' | 'not_found' | 'conflict'
  | 'rate_limited' | 'network' | 'internal' | 'unknown';

export class AdminApiError extends Error {
  constructor(public code: AdminErrorCode, message: string, public status = 0) { super(message); }
}

const CODE_MAP: Record<string, AdminErrorCode> = {
  unauthenticated: 'unauthenticated', forbidden: 'forbidden', reauth_required: 'reauth_required',
  invalid_request: 'invalid_request', not_found: 'not_found', rate_limited: 'rate_limited', internal: 'internal',
  conflict: 'conflict', target_is_self: 'conflict', target_is_admin: 'conflict', already_suspended: 'conflict', not_suspended: 'conflict',
  already_verified: 'conflict', confirmation_mismatch: 'conflict', no_email: 'conflict',
};

export async function adminCall<T = unknown>(action: string, params: Record<string, unknown> = {}): Promise<T> {
  if (!supabase) throw new AdminApiError('unauthenticated', 'Not signed in.');
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new AdminApiError('unauthenticated', 'Sign in to continue.');
  let response: Response;
  try {
    response = await fetch(`${SUPABASE_FUNCTIONS_URL}/admin-api`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, apikey: SUPABASE_PUBLISHABLE_KEY },
      body: JSON.stringify({ action, ...params }),
    });
  } catch {
    throw new AdminApiError('network', 'Could not reach the server. Check your connection and try again.');
  }
  let body: { ok?: boolean; data?: T; error?: { code?: string; message?: string } } | null = null;
  try { body = await response.json(); } catch { /* non-JSON gateway error */ }
  if (response.ok && body?.ok) return body.data as T;
  const code = CODE_MAP[body?.error?.code ?? ''] ?? (response.status === 401 ? 'unauthenticated' : response.status === 403 ? 'forbidden' : response.status >= 500 ? 'internal' : 'unknown');
  throw new AdminApiError(code, body?.error?.message ?? 'The request could not be completed.', response.status);
}

export interface Page<T> { total: number; limit: number; offset: number; rows: T[] }
export interface AccountRow {
  id: string; email: string | null; displayName: string | null; handle: string | null; createdAt: string; lastSignInAt: string | null;
  emailVerified: boolean; providers: string[]; profileComplete: boolean; status: 'active' | 'suspended'; reportsAgainst: number; role: string | null;
}
export interface AccountDetail {
  id: string; email: string | null; phone: boolean; createdAt: string; lastSignInAt: string | null; emailVerifiedAt: string | null; bannedUntil: string | null;
  providers: { provider: string; createdAt: string; lastSignInAt: string | null }[];
  profile: null | { displayName: string | null; handle: string | null; age: number | null; hasAvatar: boolean; hasBio: boolean; privacy: string | null; lastSeenAt: string | null; hideOnlineStatus: boolean | null; safetyVerified: boolean | null; photos: number };
  restriction: null | { status: string; reason: string | null; createdAt: string };
  counts: Record<'liveIntents' | 'conversations' | 'pushSubscriptions' | 'reportsAgainst' | 'reportsFiled' | 'blockedBy' | 'blocking', number>;
  reports: { id: string; reason: string | null; status: string; createdAt: string }[];
  role: string | null;
}
export interface ReportRow { id: string; reason: string | null; details: string | null; status: string; createdAt: string; reporterId: string | null; reportedId: string | null; reporterName: string | null; reportedName: string | null; reportedSuspended: boolean }
export interface AuditRow { id: number; createdAt: string; action: string; outcome: string; actorId: string | null; actorEmail: string | null; targetType: string | null; targetId: string | null; metadata: Record<string, unknown> }
export interface Metrics {
  generatedAt: string;
  registrations: Record<'total' | 'last24h' | 'last7d' | 'last30d' | 'unverified', number>;
  active: { definition: string; last24h: number; last7d: number };
  intents: Record<'live' | 'paused' | 'expired' | 'createdLast24h', number>;
  messaging: Record<'conversations' | 'messagesLast24h' | 'messagesLast7d', number>;
  moderation: Record<'openReports' | 'totalReports' | 'blocks' | 'suspended', number>;
  notifications: { pushSubscriptions: number; inboxLast24h: number; deliveriesLast24h: Record<string, number> };
  jobs: { cronRunsLast24h: number; cronFailedLast24h: number };
}

export interface Labelled { label: string; n: number }
export interface Insights {
  generatedAt: string; days: number; timezone: string;
  totals: Record<'members' | 'newInPeriod' | 'activeInPeriod' | 'active1d' | 'active7d' | 'active30d' | 'withPush' | 'verifiedProfiles', number>;
  signupsByDay: { day: string; n: number }[];
  activeByDay: { day: string; n: number }[];
  signInsByHour: { hour: number; n: number }[];
  activityByHour: { hour: number; n: number }[];
  activityByWeekday: { dow: number; n: number }[];
  intents: { createdInPeriod: number; liveNow: number; byMode: Labelled[]; top: Labelled[]; topVariants: Labelled[]; byHour: { hour: number; n: number }[]; avgHours: number | null; travelWilling: number; canHost: number };
  engagement: { gayzesSent: number; interestsSent: number; interestsByStatus: Labelled[]; conversationsStarted: number; messagesSent: number; messagesPerActiveMember: number | null; storiesPosted: number };
  gatherings: { created: number; goingTotal: number; byCategory: Labelled[]; avgFillPercent: number | null };
  audience: { ageBands: Labelled[]; neighbourhoods: Labelled[]; topInterests: Labelled[]; profileCompleteness: { withPhoto: number; withBio: number; profiles: number } };
  notifications: { pushEnabledMembers: number; optedOutOfPush: number; categoryOptOuts: Record<'messages' | 'intentActivity' | 'connections' | 'intentExpiry' | 'safety', number>; inboxCreated: number; deliveriesByState: Labelled[] };
  funnel: { step: string; n: number }[];
  retention: { eligible: number; returnedAfterDay1: number; activeLast7d: number };
  safety: { reportsInPeriod: number; openReports: number; blocks: number; checkinsInPeriod: number; suspended: number };
}

export type AudienceScope = 'all' | 'active' | 'inactive' | 'intent' | 'push' | 'user';
export interface Audience { scope: AudienceScope; days?: number; intent?: string; user?: string }
export interface BroadcastRow { id: string; title: string; body: string; url: string; audience: Audience; recipient_count: number; created_at: string; read_count: number; pushed_count: number }
