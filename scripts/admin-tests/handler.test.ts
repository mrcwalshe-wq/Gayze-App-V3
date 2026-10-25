import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdminHandler, RPC_ALLOWLIST, ACTION_NAMES, type AdminStore, type AuditEntry, type Role } from '../../supabase/functions/admin-api/handler.ts';

const OWNER = '00000000-0000-4000-8000-000000000001';
const ADMIN2 = '00000000-0000-4000-8000-000000000002';
const USER = '00000000-0000-4000-8000-000000000003';
const OTHER = '00000000-0000-4000-8000-000000000004';
const NOW = 1_800_000_000;

interface Opts { roles?: Record<string, Role>; rpcImpl?: (name: string, args: Record<string, unknown>) => { data: unknown; error: { message: string } | null }; rateOk?: (bucket: string) => boolean; auditOk?: boolean }
function harness(opts: Opts = {}) {
  const roles: Record<string, Role> = opts.roles ?? { [OWNER]: 'owner', [ADMIN2]: 'admin' };
  const tokens: Record<string, { id: string; email: string; lastAuthAt: number }> = {
    owner: { id: OWNER, email: 'owner@example.test', lastAuthAt: NOW - 60 },
    ownerStale: { id: OWNER, email: 'owner@example.test', lastAuthAt: NOW - 3600 },
    admin2: { id: ADMIN2, email: 'a2@example.test', lastAuthAt: NOW - 60 },
    user: { id: USER, email: 'user@example.test', lastAuthAt: NOW - 60 },
  };
  const calls: string[] = [];
  const audits: AuditEntry[] = [];
  const rpcCalls: { name: string; args: Record<string, unknown> }[] = [];
  const bans: [string, boolean][] = [];
  const suspended = new Set<string>();
  const store: AdminStore = {
    async authenticate(t) { return tokens[t] ?? null; },
    async roleOf(id) { return roles[id] ?? null; },
    async rateHit(_a, bucket) { return opts.rateOk ? opts.rateOk(bucket) : true; },
    async audit(e) { audits.push(e); return opts.auditOk ?? true; },
    async rpc(name, args) {
      rpcCalls.push({ name, args }); calls.push(`rpc:${name}`);
      if (opts.rpcImpl) return opts.rpcImpl(name, args);
      if (name === 'admin_account_detail') return { data: { id: args.p_user, restriction: suspended.has(String(args.p_user)) ? { status: 'suspended' } : null }, error: null };
      if (name === 'admin_set_suspension') { if (args.p_suspend) suspended.add(String(args.p_user)); else suspended.delete(String(args.p_user)); return { data: null, error: null }; }
      if (name === 'admin_revoke_sessions') return { data: 2, error: null };
      return { data: { ok: name }, error: null };
    },
    async targetUser(id) { return id === USER || id === OTHER ? { id, email: id === USER ? 'user@example.test' : 'other@example.test', confirmed: id === USER } : id === ADMIN2 ? { id, email: 'a2@example.test', confirmed: true } : id === OWNER ? { id, email: 'owner@example.test', confirmed: true } : null; },
    async setBan(id, b) { bans.push([id, b]); calls.push(`ban:${b}`); },
    async sendPasswordReset(email) { calls.push(`reset:${email}`); },
    async resendVerification(email) { calls.push(`resend:${email}`); },
    async deleteAccount(id) { calls.push(`delete:${id}`); },
    config: () => [{ key: 'X', label: 'x', configured: true }],
  };
  const handler = createAdminHandler(store, { origins: ['https://gayze.co.uk'], now: () => NOW });
  const call = (body: unknown, { token = 'owner', method = 'POST', origin, raw }: { token?: string | null; method?: string; origin?: string; raw?: string } = {}) =>
    handler(new Request('https://x.test/admin-api', {
      method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(origin ? { origin } : {}), 'content-type': 'application/json' },
      body: method === 'POST' ? (raw ?? JSON.stringify(body)) : undefined,
    }));
  return { call, calls, audits, rpcCalls, bans, suspended };
}
const json = async (r: Response) => r.json() as Promise<any>;

test('unauthenticated and invalid tokens are rejected with 401', async () => {
  const h = harness();
  assert.equal((await h.call({ action: 'whoami' }, { token: null })).status, 401);
  assert.equal((await h.call({ action: 'whoami' }, { token: 'garbage' })).status, 401);
  const r = await h.call({ action: 'whoami' }, { token: null });
  assert.deepEqual(await json(r), { ok: false, error: { code: 'unauthenticated', message: 'Sign in to continue.' } });
  assert.equal(h.rpcCalls.length, 0);
});

test('signed-in non-owner is denied 403, audited, and sees no data', async () => {
  const h = harness();
  for (const action of ['whoami', 'metrics', 'accounts.list', 'audit.list', 'diagnostics.config', 'nonsense']) {
    const r = await h.call({ action }, { token: 'user' });
    assert.equal(r.status, 403, action);
    const body = await json(r);
    assert.equal(body.ok, false);
    assert.equal(body.error.code, 'forbidden');
    assert.equal(body.data, undefined);
  }
  assert.equal(h.rpcCalls.length, 0, 'no privileged call before authorisation');
  assert.equal(h.audits.filter((a) => a.outcome === 'denied' && a.actor_id === USER).length, 6);
});

test('forged identity/role claims in the body or headers do not elevate', async () => {
  const h = harness();
  const r = await h.call({ action: 'metrics', userId: OWNER, user_id: OWNER, role: 'owner', app_metadata: { role: 'owner' }, email: 'owner@example.test', actor: OWNER }, { token: 'user' });
  assert.equal(r.status, 403);
  const r2 = await handlerWithHeaders(h);
  assert.equal(r2.status, 403);
  assert.equal(h.rpcCalls.length, 0);
});
async function handlerWithHeaders(h: ReturnType<typeof harness>) {
  const handler = createAdminHandler({
    async authenticate() { return { id: USER, email: 'owner@example.test', lastAuthAt: NOW }; }, // email lookalike
    async roleOf() { return null; }, async rateHit() { return true; }, async audit() { return true; },
    async rpc() { throw new Error('must not be called'); }, async targetUser() { return null; }, async setBan() {}, async sendPasswordReset() {}, async resendVerification() {}, async deleteAccount() {}, config: () => [],
  }, { origins: [], now: () => NOW });
  return handler(new Request('https://x.test', { method: 'POST', headers: { authorization: 'Bearer anything', 'x-user-role': 'owner', 'x-user-id': OWNER }, body: '{"action":"metrics"}' }));
}

test('an admin that is not the owner is denied (owner-only product)', async () => {
  const h = harness();
  const r = await h.call({ action: 'metrics' }, { token: 'admin2' });
  assert.equal(r.status, 403);
  assert.equal(h.audits[0].metadata?.reason, 'role_not_permitted');
});

test('owner can read; responses use the documented shape', async () => {
  const h = harness();
  const who = await json(await h.call({ action: 'whoami' }));
  assert.deepEqual(who, { ok: true, data: { userId: OWNER, role: 'owner' }, auditRecorded: true });
  const m = await json(await h.call({ action: 'metrics' }));
  assert.equal(m.ok, true);
  assert.deepEqual(m.data, { ok: 'admin_dashboard_metrics' });
  assert.equal(h.audits.some((a) => a.action === 'whoami'), false);
  assert.equal(h.audits.at(-1)?.action, 'metrics');
  assert.equal(h.audits.at(-1)?.outcome, 'success');
});

test('request validation: methods, bodies, actions, pagination, uuids, enums', async () => {
  const h = harness();
  assert.equal((await h.call(null, { method: 'GET' })).status, 405);
  assert.equal((await h.call(null, { raw: 'not json' })).status, 400);
  assert.equal((await h.call(null, { raw: '[]' })).status, 400);
  assert.equal((await h.call({ action: 'drop table' })).status, 400);
  assert.equal((await h.call({ action: '__proto__' })).status, 400);
  assert.equal((await h.call({ action: 'toString' })).status, 400);
  assert.equal((await h.call({ action: 'accounts.list', limit: 101 })).status, 400);
  assert.equal((await h.call({ action: 'accounts.list', limit: 0 })).status, 400);
  assert.equal((await h.call({ action: 'accounts.list', limit: '10' })).status, 400);
  assert.equal((await h.call({ action: 'accounts.list', limit: 1.5 })).status, 400);
  assert.equal((await h.call({ action: 'accounts.list', offset: -1 })).status, 400);
  assert.equal((await h.call({ action: 'accounts.list', offset: 1e9 })).status, 400);
  assert.equal((await h.call({ action: 'accounts.list', sort: 'name; drop table users' })).status, 400);
  assert.equal((await h.call({ action: 'accounts.list', query: 'x'.repeat(121) })).status, 400);
  assert.equal((await h.call({ action: 'accounts.list', query: 'a\u0000b' })).status, 400);
  assert.equal((await h.call({ action: 'accounts.detail', userId: 'not-a-uuid' })).status, 400);
  assert.equal((await h.call({ action: 'accounts.detail', userId: `${USER}'; --` })).status, 400);
  assert.equal((await h.call({ action: 'reports.list', status: 'weird' })).status, 400);
  assert.equal((await h.call({ action: 'audit.list', outcome: 'weird' })).status, 400);
  assert.equal((await h.call(null, { raw: JSON.stringify({ action: 'metrics', pad: 'x'.repeat(9000) }) })).status, 413);
  assert.equal(h.rpcCalls.length, 0, 'invalid input never reaches the database');
});

test('hostile search text is passed as a bound parameter, never interpolated or logged', async () => {
  const h = harness();
  const evil = "' OR 1=1; DROP TABLE users; --";
  const r = await h.call({ action: 'accounts.list', query: evil, limit: 100, offset: 100000, sort: 'reports_desc' });
  assert.equal(r.status, 200);
  assert.deepEqual(h.rpcCalls[0], { name: 'admin_list_accounts', args: { p_query: evil, p_limit: 100, p_offset: 100000, p_sort: 'reports_desc' } });
  assert.equal(JSON.stringify(h.audits).includes('DROP TABLE'), false, 'search text is not stored in the audit log');
  assert.equal(h.audits.at(-1)?.metadata?.queryLength, evil.length);
});

test('CORS: allowed origin echoed, others refused, preflight answered', async () => {
  const h = harness();
  const ok = await h.call({ action: 'whoami' }, { origin: 'https://gayze.co.uk' });
  assert.equal(ok.headers.get('access-control-allow-origin'), 'https://gayze.co.uk');
  const evil = await h.call({ action: 'whoami' }, { origin: 'https://evil.example' });
  assert.equal(evil.status, 403);
  assert.equal(evil.headers.get('access-control-allow-origin'), null);
  const pre = await h.call(null, { method: 'OPTIONS', origin: 'https://gayze.co.uk', token: null });
  assert.equal(pre.status, 204);
  assert.match(pre.headers.get('access-control-allow-headers') ?? '', /authorization/);
  const preEvil = await h.call(null, { method: 'OPTIONS', origin: 'https://evil.example', token: null });
  assert.equal(preEvil.headers.get('access-control-allow-origin'), null);
  assert.equal(ok.headers.get('cache-control'), 'no-store');
});

test('rate limiting: reads, writes and denied probes', async () => {
  const h = harness({ rateOk: (b) => b === 'read' ? false : true });
  const r = await h.call({ action: 'metrics' });
  assert.equal(r.status, 429);
  assert.equal(h.audits.at(-1)?.outcome, 'error');
  const w = harness({ rateOk: (b) => b !== 'write' });
  assert.equal((await w.call({ action: 'reports.update', reportId: USER, status: 'resolved' })).status, 429);
  const d = harness({ rateOk: (b) => b !== 'deny' });
  const before = d.audits.length;
  assert.equal((await d.call({ action: 'metrics' }, { token: 'user' })).status, 429);
  assert.equal(d.audits.length, before, 'throttled probes do not flood the audit log');
});

test('suspension requires confirm, recent sign-in, a manageable target; orders ban -> record -> revoke', async () => {
  const h = harness();
  const base = { action: 'accounts.suspend', userId: USER, reason: 'harassment reports' };
  assert.equal((await h.call({ ...base })).status, 400, 'confirm required');
  assert.equal((await h.call({ ...base, confirm: true, reason: 'x' })).status, 400, 'reason too short');
  const stale = await h.call({ ...base, confirm: true }, { token: 'ownerStale' });
  assert.equal(stale.status, 403);
  assert.equal((await json(stale)).error.code, 'reauth_required');
  assert.equal(h.audits.at(-1)?.outcome, 'reauth_required');
  assert.equal(h.bans.length, 0);
  assert.equal((await h.call({ ...base, userId: OWNER, confirm: true })).status, 409);
  assert.equal((await json(await h.call({ ...base, userId: ADMIN2, confirm: true }))).error.code, 'target_is_admin');
  assert.equal((await h.call({ ...base, userId: '00000000-0000-4000-8000-0000000000ff', confirm: true })).status, 404);

  h.calls.length = 0;
  const ok = await h.call({ ...base, confirm: true });
  assert.equal(ok.status, 200);
  assert.deepEqual((await json(ok)).data, { suspended: true, sessionsRevoked: 2 });
  assert.deepEqual(h.calls.filter((c) => c.startsWith('ban') || c.includes('set_suspension') || c.includes('revoke')), ['ban:true', 'rpc:admin_set_suspension', 'rpc:admin_revoke_sessions']);
  const set = h.rpcCalls.find((c) => c.name === 'admin_set_suspension')!;
  assert.deepEqual(set.args, { p_user: USER, p_suspend: true, p_reason: 'harassment reports', p_actor: OWNER });
  assert.equal(h.audits.at(-1)?.action, 'accounts.suspend');
  assert.equal(h.audits.at(-1)?.target_id, USER);
  assert.equal(JSON.stringify(h.audits.at(-1)).includes('harassment'), false, 'free-text reason is kept in the restriction row, not duplicated');

  assert.equal((await json(await h.call({ ...base, confirm: true }))).error.code, 'already_suspended');

  const re = await h.call({ action: 'accounts.reinstate', userId: USER, confirm: true });
  assert.equal(re.status, 200);
  assert.equal(h.bans.at(-1)?.[1], false);
  assert.equal(h.suspended.has(USER), false);
  assert.equal((await json(await h.call({ action: 'accounts.reinstate', userId: USER, confirm: true }))).error.code, 'not_suspended');
});

test('a failed database step after the ban rolls the ban back and reports a generic 500', async () => {
  const h = harness({ rpcImpl: (name) => name === 'admin_account_detail' ? { data: { restriction: null }, error: null } : name === 'admin_set_suspension' ? { data: null, error: { message: 'relation "public.account_restrictions" does not exist' } } : { data: null, error: null } });
  const r = await h.call({ action: 'accounts.suspend', userId: USER, reason: 'spam network', confirm: true });
  assert.equal(r.status, 500);
  const body = await json(r);
  assert.equal(body.error.code, 'internal');
  assert.equal(JSON.stringify(body).includes('account_restrictions'), false, 'raw database errors are never returned');
  assert.deepEqual(h.bans, [[USER, true], [USER, false]]);
  assert.equal(h.audits.at(-1)?.outcome, 'error');
});

test('revoke sessions, password reset and verification use server-side lookups, not body data', async () => {
  const h = harness();
  assert.equal((await json(await h.call({ action: 'accounts.revokeSessions', userId: USER, confirm: true }))).data.sessionsRevoked, 2);
  assert.equal((await h.call({ action: 'accounts.revokeSessions', userId: USER })).status, 400);
  await h.call({ action: 'accounts.sendPasswordReset', userId: USER, email: 'attacker@example.test' });
  assert.ok(h.calls.includes('reset:user@example.test'));
  assert.equal(h.calls.some((c) => c.includes('attacker')), false);
  assert.equal((await json(await h.call({ action: 'accounts.resendVerification', userId: USER }))).error.code, 'already_verified');
  await h.call({ action: 'accounts.resendVerification', userId: OTHER });
  assert.ok(h.calls.includes('resend:other@example.test'));
  assert.equal((await h.call({ action: 'accounts.sendPasswordReset', userId: ADMIN2 })).status, 409);
});

test('account deletion needs the exact email typed and refuses admins', async () => {
  const h = harness();
  assert.equal((await json(await h.call({ action: 'accounts.delete', userId: USER, confirmEmail: 'wrong@example.test' }))).error.code, 'confirmation_mismatch');
  assert.equal((await h.call({ action: 'accounts.delete', userId: USER })).status, 400);
  assert.equal((await h.call({ action: 'accounts.delete', userId: OWNER, confirmEmail: 'owner@example.test' })).status, 409);
  assert.equal(h.calls.some((c) => c.startsWith('delete:')), false);
  assert.equal((await h.call({ action: 'accounts.delete', userId: USER, confirmEmail: 'USER@example.test' })).status, 200);
  assert.ok(h.calls.includes(`delete:${USER}`));
});

test('reports: status changes validated and audited with before/after', async () => {
  const h = harness({ rpcImpl: (name, args) => name === 'admin_update_report' ? { data: { id: args.p_report, from: 'open', to: args.p_status }, error: null } : { data: [], error: null } });
  const r = await h.call({ action: 'reports.update', reportId: USER, status: 'resolved' });
  assert.equal(r.status, 200);
  assert.deepEqual(h.audits.at(-1)?.metadata, { from: 'open', to: 'resolved' });
  assert.equal((await h.call({ action: 'reports.update', reportId: USER, status: 'banned' })).status, 400);
  assert.equal((await h.call({ action: 'reports.update', status: 'resolved' })).status, 400);
  const nf = harness({ rpcImpl: () => ({ data: null, error: { message: 'report_not_found' } }) });
  assert.equal((await nf.call({ action: 'reports.update', reportId: USER, status: 'resolved' })).status, 404);
});

test('missing database dependency or outage yields a generic error, an audit record, and no crash', async () => {
  const h = harness({ rpcImpl: () => ({ data: null, error: { message: 'function admin_dashboard_metrics() does not exist at position 8; host db.qdewyupsqmtonkloqxsh.supabase.co' } }) });
  const r = await h.call({ action: 'metrics' });
  assert.equal(r.status, 500);
  const text = JSON.stringify(await json(r));
  assert.equal(/supabase\.co|does not exist|position/.test(text), false);
  assert.equal(h.audits.at(-1)?.outcome, 'error');
});

test('infrastructure failures in auth/role lookup fail closed', async () => {
  const mk = (over: Partial<AdminStore>) => createAdminHandler({
    async authenticate() { return { id: OWNER, email: null, lastAuthAt: NOW }; }, async roleOf() { return 'owner'; }, async rateHit() { return true; }, async audit() { return true; },
    async rpc() { return { data: 1, error: null }; }, async targetUser() { return null; }, async setBan() {}, async sendPasswordReset() {}, async resendVerification() {}, async deleteAccount() {}, config: () => [], ...over,
  }, { origins: [], now: () => NOW });
  const req = () => new Request('https://x.test', { method: 'POST', headers: { authorization: 'Bearer t' }, body: '{"action":"metrics"}' });
  assert.equal((await mk({ roleOf: async () => { throw new Error('db down'); } })(req())).status, 500);
  assert.equal((await mk({ rateHit: async () => { throw new Error('limiter down'); } })(req())).status, 500);
  assert.equal((await mk({ authenticate: async () => { throw new Error('auth down'); } })(req())).status, 500);
});

test('audit write failure is reported, not hidden', async () => {
  const h = harness({ auditOk: false });
  const body = await json(await h.call({ action: 'metrics' }));
  assert.equal(body.ok, true);
  assert.equal(body.auditRecorded, false);
});

test('only allow-listed RPCs are reachable and every action maps to one', () => {
  assert.ok(RPC_ALLOWLIST.size >= 13);
  for (const bad of ['admin_bootstrap_owner', 'admin_rate_hit', 'admin_audit_log_immutable', 'pg_sleep', 'exec_sql']) assert.equal(RPC_ALLOWLIST.has(bad), false, bad);
  assert.ok(ACTION_NAMES.includes('accounts.suspend'));
  assert.equal(ACTION_NAMES.includes('owner.grant'), false, 'there is no API to grant roles');
});
