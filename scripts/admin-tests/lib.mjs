import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const REPO = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');
export const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const migration = (name) => fs.readFileSync(`${REPO}/supabase/migrations/${name}`, 'utf8');

/**
 * A database shaped like the hosted project for everything the admin migrations touch,
 * with Supabase's default grants (anon/authenticated can execute functions and touch
 * tables unless a migration revokes it), then the REAL admin migrations applied in order.
 */
export async function adminDb() {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create role authenticator nologin;
    create schema auth; create schema cron; create schema storage; create schema extensions;
    grant usage on schema public, auth to anon, authenticated, service_role;
    create table auth.users (id uuid primary key default gen_random_uuid(), email text, email_confirmed_at timestamptz,
      banned_until timestamptz, deleted_at timestamptz, last_sign_in_at timestamptz, phone text, created_at timestamptz default now());
    create table auth.identities (id uuid primary key default gen_random_uuid(), user_id uuid references auth.users(id) on delete cascade,
      provider text, created_at timestamptz default now(), last_sign_in_at timestamptz);
    create table auth.sessions (id uuid primary key default gen_random_uuid(), user_id uuid references auth.users(id) on delete cascade);
    create table auth.audit_log_entries (id uuid primary key default gen_random_uuid(), payload jsonb, created_at timestamptz default now());
    create table cron.job (jobid serial primary key, jobname text, schedule text, active boolean default true);
    create table cron.job_run_details (runid serial primary key, jobid int, status text, return_message text, start_time timestamptz default now());
    create table storage.objects (id uuid default gen_random_uuid(), bucket_id text, name text);
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub','')::uuid $$;

    create table public.profiles (id uuid primary key, handle text, display_name text, bio text, avatar_path text, age smallint,
      privacy_setting text, safety_verified boolean default false, last_seen_at timestamptz, hide_online_status boolean default false);
    create table public.reports (id uuid primary key default gen_random_uuid(), reporter_id uuid, reported_id uuid, conversation_id uuid,
      reason text, details text, created_at timestamptz default now(),
      status text default 'open' check (status in ('open','reviewing','resolved','dismissed')));
    create table public.blocks (blocker_id uuid, blocked_id uuid, created_at timestamptz default now());
    create table public.intents (id uuid primary key default gen_random_uuid(), user_id uuid, expires_at timestamptz, is_paused boolean default false, created_at timestamptz default now());
    create table public.conversations (id uuid primary key default gen_random_uuid(), created_at timestamptz default now());
    create table public.conversation_members (conversation_id uuid, user_id uuid);
    create table public.messages (id uuid primary key default gen_random_uuid(), conversation_id uuid, created_at timestamptz default now());
    create table public.push_subscriptions (id uuid primary key default gen_random_uuid(), user_id uuid, endpoint text);
    create table public.gayze_notifications (id uuid primary key default gen_random_uuid(), created_at timestamptz default now());
    create table public.gayze_notification_deliveries (notification_id uuid, endpoint text, state text, status_code int, created_at timestamptz default now());
    create table public.profile_photos (id uuid primary key default gen_random_uuid(), user_id uuid, storage_path text, sort_order int, is_primary boolean);
  `);
  for (const name of [
    '20261025100000_admin_console.sql',
    '20261025110000_admin_enforcement.sql',
    '20261025120000_suspension_write_guards.sql',
  ]) await db.exec(migration(name));
  return db;
}

/** Run SQL as a Supabase role with given JWT claims, in a rolled-back-safe transaction. */
export async function as(db, role, claims, sql, params = []) {
  let out;
  await db.transaction(async (tx) => {
    if (role !== 'postgres') await tx.query(`set local role ${role}`);
    await tx.query("select set_config('request.jwt.claims', $1, true)", [claims ? JSON.stringify(claims) : '']);
    out = await tx.query(sql, params);
  });
  return out;
}

export async function addUser(db, n, { email, verified = true, banned = null, provider = 'google' } = {}) {
  const id = uuid(n);
  await db.query('insert into auth.users (id, email, email_confirmed_at, banned_until) values ($1,$2,$3,$4)',
    [id, email ?? `user${n}@example.test`, verified ? new Date().toISOString() : null, banned]);
  if (provider) await db.query('insert into auth.identities (user_id, provider) values ($1,$2)', [id, provider]);
  await db.query('insert into public.profiles (id, display_name) values ($1,$2)', [id, `User ${n}`]);
  return id;
}
