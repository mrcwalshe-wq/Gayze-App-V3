import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const REPO = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');
export const MIGRATION = `${REPO}/supabase/migrations/20260929120000_push_notifications.sql`;
export const MIGRATION_URL_FIX = `${REPO}/supabase/migrations/20261002090000_push_dispatch_url_fix.sql`;

// The sandbox DB has no pgcrypto/pg_net extension binaries wired up: the two
// `create extension` lines are stripped and replaced by stubs in `bootstrap`.
export function migrationSql() {
  const clean = (file) => fs.readFileSync(file, 'utf8')
    .replace(/^create extension if not exists pgcrypto;$/m, '-- (stubbed in test)')
    .replace(/^create extension if not exists pg_net with schema extensions;$/m, '-- (stubbed in test)');
  // Applied in filename order, exactly as Supabase applies them.
  return clean(MIGRATION) + '\n' + clean(MIGRATION_URL_FIX);
}

export async function bootstrap(db, { netFails = false } = {}) {
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    create schema auth; create schema extensions; create schema net; create schema vault;
    grant usage on schema auth to anon, authenticated, service_role;
    create table auth.users (id uuid primary key default gen_random_uuid());
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant execute on function auth.uid() to anon, authenticated, service_role;
    create table vault.decrypted_secrets (name text, decrypted_secret text);
    create table public.__net_calls (id serial primary key, url text, body jsonb, headers jsonb);
    create function net.http_post(url text, headers jsonb default '{}', body jsonb default '{}', timeout_milliseconds int default 1000)
      returns bigint language plpgsql as $$
      begin
        ${netFails ? "raise exception 'pg_net exploded';" : ''}
        insert into public.__net_calls(url, body, headers) values (url, body, headers);
        return 1;
      end $$;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  `);
}

// Base schema as EVIDENCED BY CLIENT CALL SITES (not by any DDL in the repo).
export async function baseSchema(db) {
  await db.exec(`
    create table public.profiles (id uuid primary key, display_name text);
    create table public.conversations (id uuid primary key default gen_random_uuid(), created_at timestamptz default now());
    create table public.conversation_members (conversation_id uuid references public.conversations(id), user_id uuid);
    create table public.messages (id uuid primary key default gen_random_uuid(), conversation_id uuid, sender_id uuid,
      ciphertext text, nonce text, created_at timestamptz default now(), expires_at timestamptz, burned_at timestamptz);
    create table public.intents (id uuid primary key default gen_random_uuid(), user_id uuid, expires_at timestamptz, is_paused boolean default false);
    create table public.safety_checkins (id uuid primary key default gen_random_uuid(), user_id uuid, status text, expires_at timestamptz);
  `);
}

export async function newDb(opts = {}) {
  const db = new PGlite();
  await bootstrap(db, opts);
  return db;
}

export const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export async function addUsers(db, ...ids) {
  for (const id of ids) await db.query('insert into auth.users(id) values ($1)', [id]);
}

// ---- tiny supabase-js look-alike over PGlite, executing under a real role ----
export function makeClient(db, getCtx, { invoke } = {}) {
  class B {
    constructor(table) { this.t = table; this.op = 'select'; this.cols = '*'; this.f = []; this.single = null; this.ret = false; }
    select(c = '*') { if (this.op === 'select') this.cols = c; else this.ret = c; return this; }
    insert(o) { this.op = 'insert'; this.o = o; return this; }
    upsert(o, opt = {}) { this.op = 'upsert'; this.o = o; this.oc = opt.onConflict; return this; }
    update(o) { this.op = 'update'; this.o = o; return this; }
    delete() { this.op = 'delete'; return this; }
    eq(c, v) { this.f.push([c, '=', v]); return this; }
    neq(c, v) { this.f.push([c, '<>', v]); return this; }
    in(c, v) { this.f.push([c, 'in', v]); return this; }
    maybeSingle() { this.single = 'maybe'; return this; }
    then(res, rej) { return this.run().then(res, rej); }
    async run() {
      const ctx = getCtx();
      const params = []; const p = (v) => { params.push(v); return `$${params.length}`; };
      const where = this.f.length ? ' where ' + this.f.map(([c, o, v]) => o === 'in' ? `${c} = any(${p(v)})` : `${c} ${o} ${p(v)}`).join(' and ') : '';
      let sql;
      if (this.op === 'select') sql = `select ${this.cols} from public.${this.t}${where}`;
      else if (this.op === 'delete') sql = `delete from public.${this.t}${where}`;
      else if (this.op === 'update') {
        sql = `update public.${this.t} set ${Object.keys(this.o).map((k) => `${k} = ${p(this.o[k])}`).join(', ')}${where}`;
      } else {
        const ks = Object.keys(this.o);
        sql = `insert into public.${this.t} (${ks.join(',')}) values (${ks.map((k) => p(this.o[k])).join(',')})`;
        if (this.op === 'upsert') sql += ` on conflict (${this.oc}) do update set ${ks.filter((k) => k !== this.oc).map((k) => `${k} = excluded.${k}`).join(', ')}`;
      }
      try {
        let rows;
        await db.transaction(async (tx) => {
          if (ctx.role === 'authenticated') {
            await tx.query('set local role authenticated');
            await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [ctx.sub]);
          }
          rows = (await tx.query(sql, params)).rows;
        });
        if (this.single === 'maybe') return { data: rows[0] ?? null, error: null };
        return { data: rows, error: null };
      } catch (e) {
        return { data: null, error: { message: e.message, code: e.code } };
      }
    }
  }
  return {
    from: (t) => new B(t),
    async rpc(name, args) {
      const ctx = getCtx(); const keys = Object.keys(args);
      try {
        let rows;
        await db.transaction(async (tx) => {
          if (ctx.role === 'authenticated') { await tx.query('set local role authenticated'); await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [ctx.sub]); }
          rows = (await tx.query(`select public.${name}(${keys.map((k, i) => `${k} => $${i + 1}`).join(',')}) as r`, keys.map((k) => args[k]))).rows;
        });
        return { data: rows[0].r, error: null };
      } catch (e) { return { data: null, error: { message: e.message, code: e.code } }; }
    },
    auth: {
      async getSession() { const c = getCtx(); return { data: { session: c.sub ? { user: { id: c.sub }, access_token: `tok:${c.sub}` } : null } }; },
      async getUser(token) { const m = /^tok:(.+)$/.exec(token || ''); return m ? { data: { user: { id: m[1] } }, error: null } : { data: { user: null }, error: { message: 'bad jwt' } }; },
    },
    functions: { invoke: async (name, { body }) => invoke(name, body) },
  };
}

export function assert(cond, msg) { if (!cond) { console.error('  ✗ FAIL:', msg); process.exitCode = 1; } else console.log('  ✓', msg); }
