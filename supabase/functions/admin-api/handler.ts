// GAYZE admin API: portable, dependency-injected request handler.
//
// Contract (all requests are POST, JSON in, JSON out):
//   request  { action: string, ...params }
//   success  200 { ok: true,  data: ... }
//   failure  4xx/5xx { ok: false, error: { code: string, message: string } }
//
// Authorisation is decided here, on the server, for every request:
//   1. the bearer token must verify with Supabase Auth (never trusted from the body);
//   2. the verified user id must have the `owner` role in public.app_admins;
//   3. everything else is denied (and recorded).
// The browser can never read app_admins, so hiding a link is never the control.

export type Role = 'owner' | 'admin';
export interface Principal { id: string; email: string | null; lastAuthAt: number }
export interface RpcResult { data: unknown; error: { message: string } | null }
export interface AuditEntry {
  actor_id: string | null; action: string; target_type?: string | null; target_id?: string | null;
  outcome: 'success' | 'denied' | 'error' | 'reauth_required'; metadata?: Record<string, unknown>;
}
export interface TargetUser { id: string; email: string | null; confirmed: boolean }

export interface AdminStore {
  authenticate(token: string): Promise<Principal | null>;
  roleOf(userId: string): Promise<Role | null>;
  rateHit(actor: string, bucket: string, limit: number): Promise<boolean>;
  audit(entry: AuditEntry): Promise<boolean>;
  /** Service-role RPC. Only names in RPC_ALLOWLIST are ever passed through. */
  rpc(name: string, args: Record<string, unknown>): Promise<RpcResult>;
  targetUser(userId: string): Promise<TargetUser | null>;
  setBan(userId: string, banned: boolean): Promise<void>;
  sendPasswordReset(email: string): Promise<void>;
  resendVerification(email: string): Promise<void>;
  deleteAccount(userId: string): Promise<void>;
  config(): { key: string; label: string; configured: boolean; note?: string }[];
}

export interface AdminConfig {
  origins: string[];
  now?: () => number; // epoch seconds, injectable for tests
  reauthWindowSeconds?: number;
  readLimitPerMinute?: number;
  writeLimitPerMinute?: number;
  deniedLimitPerMinute?: number;
}

export const RPC_ALLOWLIST = new Set([
  'admin_dashboard_metrics', 'admin_list_accounts_v2', 'admin_account_detail', 'admin_set_suspension',
  'admin_delivery_failures', 'admin_failed_jobs', 'admin_revoke_sessions', 'admin_list_reports',
  'admin_update_report', 'admin_audit_search', 'admin_profile_photo_problems', 'admin_auth_events', 'admin_cron_status',
]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BODY = 8192;
const SORTS = ['created_desc', 'created_asc', 'signin_desc', 'signin_asc', 'reports_desc'] as const;
const REPORT_STATUSES = ['open', 'reviewing', 'resolved', 'dismissed'] as const;
const OUTCOMES = ['success', 'denied', 'error', 'reauth_required'] as const;

class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
const bad = (message: string) => new HttpError(400, 'invalid_request', message);

type Params = Record<string, unknown>;
const uuidParam = (p: Params, key: string): string => {
  const v = p[key];
  if (typeof v !== 'string' || !UUID.test(v)) throw bad(`${key} must be a UUID`);
  return v.toLowerCase();
};
const intParam = (p: Params, key: string, def: number, min: number, max: number): number => {
  const v = p[key];
  if (v === undefined || v === null) return def;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) throw bad(`${key} must be an integer between ${min} and ${max}`);
  return v;
};
const textParam = (p: Params, key: string, max: number, required = false): string | null => {
  const v = p[key];
  if (v === undefined || v === null || v === '') { if (required) throw bad(`${key} is required`); return null; }
  if (typeof v !== 'string' || v.length > max) throw bad(`${key} must be text up to ${max} characters`);
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v)) throw bad(`${key} contains invalid characters`);
  return v.trim();
};
const enumParam = <T extends readonly string[]>(p: Params, key: string, allowed: T, def?: T[number]): T[number] | null => {
  const v = p[key];
  if (v === undefined || v === null || v === '') { if (def !== undefined) return def; return null; }
  if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) throw bad(`${key} must be one of ${allowed.join(', ')}`);
  return v as T[number];
};

interface Ctx {
  store: AdminStore;
  actor: Principal;
  params: Params;
}
interface ActionDef {
  kind: 'read' | 'write';
  sensitive?: boolean; // requires a recent real sign-in
  targetType?: string;
  run: (ctx: Ctx) => Promise<{ data: unknown; target?: string; meta?: Record<string, unknown> }>;
}

async function rpc(store: AdminStore, name: string, args: Record<string, unknown>): Promise<unknown> {
  if (!RPC_ALLOWLIST.has(name)) throw new HttpError(500, 'internal', 'Unavailable.');
  const { data, error } = await store.rpc(name, args);
  if (error) {
    const m = error.message ?? '';
    if (/report_not_found/.test(m)) throw new HttpError(404, 'not_found', 'Report not found.');
    if (/invalid_status/.test(m)) throw bad('Invalid status.');
    throw new HttpError(500, 'internal', 'The operation could not be completed.');
  }
  return data;
}

async function assertManageable(ctx: Ctx, target: string): Promise<TargetUser> {
  if (target === ctx.actor.id) throw new HttpError(409, 'target_is_self', 'You cannot perform this action on your own account.');
  const user = await ctx.store.targetUser(target);
  if (!user) throw new HttpError(404, 'not_found', 'Account not found.');
  if (await ctx.store.roleOf(target)) throw new HttpError(409, 'target_is_admin', 'Administrator accounts cannot be managed here.');
  return user;
}

const ACTIONS: Record<string, ActionDef> = {
  whoami: { kind: 'read', run: async ({ actor }) => ({ data: { userId: actor.id, role: 'owner' } }) },

  metrics: { kind: 'read', run: async ({ store }) => ({ data: await rpc(store, 'admin_dashboard_metrics', {}) }) },

  'accounts.list': {
    kind: 'read', targetType: 'user',
    run: async ({ store, params }) => {
      const query = textParam(params, 'query', 120);
      const limit = intParam(params, 'limit', 25, 1, 100);
      const offset = intParam(params, 'offset', 0, 0, 100000);
      const sort = enumParam(params, 'sort', SORTS, 'created_desc');
      const data = await rpc(store, 'admin_list_accounts_v2', { p_query: query, p_limit: limit, p_offset: offset, p_sort: sort });
      return { data, meta: { queryLength: query?.length ?? 0, limit, offset, sort } };
    },
  },

  'accounts.detail': {
    kind: 'read', targetType: 'user',
    run: async ({ store, params }) => {
      const id = uuidParam(params, 'userId');
      const data = await rpc(store, 'admin_account_detail', { p_user: id });
      if (!data) throw new HttpError(404, 'not_found', 'Account not found.');
      return { data, target: id };
    },
  },

  'accounts.photoProblems': {
    kind: 'read', targetType: 'user',
    run: async ({ store, params }) => {
      const id = uuidParam(params, 'userId');
      return { data: await rpc(store, 'admin_profile_photo_problems', { p_user: id }), target: id };
    },
  },

  'accounts.suspend': {
    kind: 'write', sensitive: true, targetType: 'user',
    run: async (ctx) => {
      const id = uuidParam(ctx.params, 'userId');
      const reason = textParam(ctx.params, 'reason', 500, true)!;
      if (reason.length < 3) throw bad('Give a reason of at least 3 characters.');
      if (ctx.params.confirm !== true) throw bad('confirm must be true');
      await assertManageable(ctx, id);
      const detail = await rpc(ctx.store, 'admin_account_detail', { p_user: id }) as { restriction?: unknown } | null;
      if (detail?.restriction) throw new HttpError(409, 'already_suspended', 'This account is already suspended.');
      // 1) stop new sign-ins and token refreshes at the identity provider.
      await ctx.store.setBan(id, true);
      try {
        // 2) record it; the PostgREST pre-request hook now rejects the user's API calls at once.
        await rpc(ctx.store, 'admin_set_suspension', { p_user: id, p_suspend: true, p_reason: reason, p_actor: ctx.actor.id });
      } catch (e) {
        await ctx.store.setBan(id, false).catch(() => undefined);
        throw e;
      }
      // 3) end existing sessions so no device can mint another access token.
      const revoked = await rpc(ctx.store, 'admin_revoke_sessions', { p_user: id });
      return { data: { suspended: true, sessionsRevoked: revoked }, target: id, meta: { reasonLength: reason.length, sessionsRevoked: revoked } };
    },
  },

  'accounts.reinstate': {
    kind: 'write', sensitive: true, targetType: 'user',
    run: async (ctx) => {
      const id = uuidParam(ctx.params, 'userId');
      if (ctx.params.confirm !== true) throw bad('confirm must be true');
      await assertManageable(ctx, id);
      const detail = await rpc(ctx.store, 'admin_account_detail', { p_user: id }) as { restriction?: unknown } | null;
      if (!detail?.restriction) throw new HttpError(409, 'not_suspended', 'This account is not suspended.');
      await ctx.store.setBan(id, false);
      try {
        await rpc(ctx.store, 'admin_set_suspension', { p_user: id, p_suspend: false, p_reason: null, p_actor: ctx.actor.id });
      } catch (e) {
        await ctx.store.setBan(id, true).catch(() => undefined);
        throw e;
      }
      return { data: { suspended: false }, target: id };
    },
  },

  'accounts.revokeSessions': {
    kind: 'write', sensitive: true, targetType: 'user',
    run: async (ctx) => {
      const id = uuidParam(ctx.params, 'userId');
      if (ctx.params.confirm !== true) throw bad('confirm must be true');
      await assertManageable(ctx, id);
      const revoked = await rpc(ctx.store, 'admin_revoke_sessions', { p_user: id });
      return { data: { sessionsRevoked: revoked }, target: id, meta: { sessionsRevoked: revoked } };
    },
  },

  'accounts.sendPasswordReset': {
    kind: 'write', sensitive: true, targetType: 'user',
    run: async (ctx) => {
      const id = uuidParam(ctx.params, 'userId');
      const user = await assertManageable(ctx, id);
      if (!user.email) throw new HttpError(409, 'no_email', 'This account has no email address.');
      await ctx.store.sendPasswordReset(user.email);
      return { data: { requested: true }, target: id };
    },
  },

  'accounts.resendVerification': {
    kind: 'write', sensitive: true, targetType: 'user',
    run: async (ctx) => {
      const id = uuidParam(ctx.params, 'userId');
      const user = await assertManageable(ctx, id);
      if (!user.email) throw new HttpError(409, 'no_email', 'This account has no email address.');
      if (user.confirmed) throw new HttpError(409, 'already_verified', 'This email address is already verified.');
      await ctx.store.resendVerification(user.email);
      return { data: { requested: true }, target: id };
    },
  },

  'accounts.delete': {
    kind: 'write', sensitive: true, targetType: 'user',
    run: async (ctx) => {
      const id = uuidParam(ctx.params, 'userId');
      const typed = textParam(ctx.params, 'confirmEmail', 320, true)!;
      const user = await assertManageable(ctx, id);
      if (!user.email || typed.toLowerCase() !== user.email.toLowerCase()) {
        throw new HttpError(409, 'confirmation_mismatch', 'The confirmation does not match this account.');
      }
      await ctx.store.deleteAccount(id);
      return { data: { deleted: true }, target: id };
    },
  },

  'reports.list': {
    kind: 'read', targetType: 'report',
    run: async ({ store, params }) => {
      const status = enumParam(params, 'status', REPORT_STATUSES);
      const limit = intParam(params, 'limit', 25, 1, 100);
      const offset = intParam(params, 'offset', 0, 0, 100000);
      return { data: await rpc(store, 'admin_list_reports', { p_status: status, p_limit: limit, p_offset: offset }), meta: { status, limit, offset } };
    },
  },

  'reports.update': {
    kind: 'write', targetType: 'report',
    run: async ({ store, params }) => {
      const id = uuidParam(params, 'reportId');
      const status = enumParam(params, 'status', REPORT_STATUSES);
      if (!status) throw bad('status is required');
      const data = await rpc(store, 'admin_update_report', { p_report: id, p_status: status }) as { from?: string; to?: string };
      return { data, target: id, meta: { from: data?.from, to: data?.to } };
    },
  },

  'audit.list': {
    kind: 'read', targetType: 'audit',
    run: async ({ store, params }) => {
      const query = textParam(params, 'query', 120);
      const outcome = enumParam(params, 'outcome', OUTCOMES);
      const limit = intParam(params, 'limit', 50, 1, 200);
      const offset = intParam(params, 'offset', 0, 0, 100000);
      return { data: await rpc(store, 'admin_audit_search', { p_query: query, p_outcome: outcome, p_limit: limit, p_offset: offset }), meta: { queryLength: query?.length ?? 0, outcome, limit, offset } };
    },
  },

  'diagnostics.deliveries': { kind: 'read', run: async ({ store, params }) => ({ data: await rpc(store, 'admin_delivery_failures', { p_limit: intParam(params, 'limit', 50, 1, 200) }) }) },
  'diagnostics.jobs': {
    kind: 'read',
    run: async ({ store, params }) => ({
      data: {
        failed: await rpc(store, 'admin_failed_jobs', { p_limit: intParam(params, 'limit', 50, 1, 200) }),
        schedule: await rpc(store, 'admin_cron_status', {}),
      },
    }),
  },
  'diagnostics.auth': { kind: 'read', run: async ({ store, params }) => ({ data: await rpc(store, 'admin_auth_events', { p_limit: intParam(params, 'limit', 50, 1, 200) }) }) },
  'diagnostics.config': { kind: 'read', run: async ({ store }) => ({ data: { items: store.config() } }) },
};

export const ACTION_NAMES = Object.keys(ACTIONS);

async function readBody(request: Request): Promise<Params> {
  const reader = request.body?.getReader();
  if (!reader) throw bad('A JSON body is required.');
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for (;;) {
    const part = await reader.read();
    if (part.done) break;
    bytes += part.value.length;
    if (bytes > MAX_BODY) { await reader.cancel(); throw new HttpError(413, 'too_large', 'Request body too large.'); }
    chunks.push(part.value);
  }
  const joined = new Uint8Array(bytes);
  let offset = 0;
  for (const c of chunks) { joined.set(c, offset); offset += c.length; }
  let value: unknown;
  try { value = JSON.parse(new TextDecoder().decode(joined)); } catch { throw bad('Body must be valid JSON.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw bad('Body must be a JSON object.');
  return value as Params;
}

export function createAdminHandler(store: AdminStore, config: AdminConfig) {
  const now = config.now ?? (() => Math.floor(Date.now() / 1000));
  const reauthWindow = config.reauthWindowSeconds ?? 900;
  const readLimit = config.readLimitPerMinute ?? 120;
  const writeLimit = config.writeLimitPerMinute ?? 20;
  const deniedLimit = config.deniedLimitPerMinute ?? 10;

  return async (request: Request): Promise<Response> => {
    const origin = request.headers.get('origin');
    const headers: Record<string, string> = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Vary: 'Origin' };
    if (origin && config.origins.includes(origin)) headers['Access-Control-Allow-Origin'] = origin;
    const respond = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers });
    const fail = (status: number, code: string, message: string) => respond(status, { ok: false, error: { code, message } });

    if (origin && !config.origins.includes(origin)) return fail(403, 'origin_not_allowed', 'Origin not allowed.');
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: { ...headers, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Max-Age': '600' } });
    }
    if (request.method !== 'POST') return fail(405, 'method_not_allowed', 'POST required.');

    try {
      // 1) Authenticate: the token is verified by Supabase Auth; nothing in the body is an identity.
      const token = request.headers.get('authorization')?.match(/^Bearer (\S+)$/i)?.[1];
      const actor = token ? await store.authenticate(token) : null;
      if (!actor) return fail(401, 'unauthenticated', 'Sign in to continue.');

      // 2) Authorise: owner only. Everything else is denied and recorded (bounded).
      const role = await store.roleOf(actor.id);
      if (role !== 'owner') {
        if (!await store.rateHit(actor.id, 'deny', deniedLimit)) return fail(429, 'rate_limited', 'Too many requests.');
        await store.audit({ actor_id: actor.id, action: 'admin.access', outcome: 'denied', metadata: { reason: role ? 'role_not_permitted' : 'not_an_admin' } }).catch(() => false);
        return fail(403, 'forbidden', 'Not found.');
      }

      // 3) Parse and validate.
      const params = await readBody(request);
      const name = typeof params.action === 'string' ? params.action : '';
      const def = Object.prototype.hasOwnProperty.call(ACTIONS, name) ? ACTIONS[name] : undefined;
      if (!def) return fail(400, 'unknown_action', 'Unknown action.');

      // 4) Rate limit by kind.
      const limit = def.kind === 'write' ? writeLimit : readLimit;
      if (!await store.rateHit(actor.id, def.kind, limit)) {
        await store.audit({ actor_id: actor.id, action: name, outcome: 'error', metadata: { reason: 'rate_limited' } }).catch(() => false);
        return fail(429, 'rate_limited', 'Too many requests. Slow down and try again shortly.');
      }

      // 5) Sensitive operations need a real sign-in within the reauth window.
      if (def.sensitive && now() - actor.lastAuthAt > reauthWindow) {
        await store.audit({ actor_id: actor.id, action: name, target_type: def.targetType ?? null, target_id: typeof params.userId === 'string' && UUID.test(params.userId) ? params.userId : null, outcome: 'reauth_required' }).catch(() => false);
        return fail(403, 'reauth_required', 'Confirm it is you: sign in again to continue.');
      }

      // 6) Execute and audit.
      const shouldAudit = name !== 'whoami';
      try {
        const { action: _drop, ...args } = params;
        void _drop;
        const result = await def.run({ store, actor, params: args });
        let auditRecorded = true;
        if (shouldAudit) {
          auditRecorded = await store.audit({ actor_id: actor.id, action: name, target_type: def.targetType ?? null, target_id: result.target ?? null, outcome: 'success', metadata: result.meta ?? {} }).catch(() => false);
          if (!auditRecorded) console.error('[admin-api] audit write failed for', name);
        }
        return respond(200, { ok: true, data: result.data, auditRecorded });
      } catch (e) {
        const status = e instanceof HttpError ? e.status : 500;
        const code = e instanceof HttpError ? e.code : 'internal';
        const message = e instanceof HttpError ? e.message : 'The operation could not be completed.';
        if (!(e instanceof HttpError)) console.error('[admin-api]', name, e instanceof Error ? e.message : 'unknown error');
        await store.audit({
          actor_id: actor.id, action: name, target_type: def.targetType ?? null,
          target_id: typeof params.userId === 'string' && UUID.test(params.userId) ? params.userId : null,
          outcome: 'error', metadata: { code },
        }).catch(() => false);
        return fail(status, code, message);
      }
    } catch (e) {
      if (e instanceof HttpError) return fail(e.status, e.code, e.message);
      console.error('[admin-api] unhandled', e instanceof Error ? e.message : 'unknown error');
      return fail(500, 'internal', 'The operation could not be completed.');
    }
  };
}
