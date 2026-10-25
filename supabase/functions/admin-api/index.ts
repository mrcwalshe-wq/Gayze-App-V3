/**
 * GAYZE admin API (Supabase Edge Function). Owner-only.
 *
 * verify_jwt is ON at the platform gate as a first layer, but a valid JWT only
 * proves someone is signed in (the public anon key is one too). The handler
 * therefore verifies the token again, never trusts the body, the user's email or
 * any client claim, and takes identity from supabase.auth.getUser(token) and the
 * role from public.app_admins, read with the service role.
 *
 * Secrets used (project-wide Edge Function secrets, never sent to the browser):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY (provided by Supabase)
 *   ADMIN_ALLOWED_ORIGINS  optional, comma-separated extra origins (e.g. a preview URL)
 *   ADMIN_SITE_URL         optional, defaults to https://gayze.co.uk (email redirect base)
 */
import { createClient } from 'npm:@supabase/supabase-js@2';
import { createAdminHandler, type AdminStore, type Principal } from './handler.ts';

const url = Deno.env.get('SUPABASE_URL') ?? '';
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const siteUrl = (Deno.env.get('ADMIN_SITE_URL') ?? 'https://gayze.co.uk').replace(/\/$/, '');

const origins = [
  'https://gayze.co.uk', 'https://www.gayze.co.uk',
  ...(Deno.env.get('ADMIN_ALLOWED_ORIGINS') ?? '').split(',').map((o) => o.trim()).filter(Boolean),
];

const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const anon = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });

// Decode (not verify) the payload of a token that getUser() has just verified.
function lastAuthAt(token: string): number {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    const amr = Array.isArray(payload.amr) ? payload.amr : [];
    const stamps = amr.map((a: { timestamp?: number }) => Number(a?.timestamp)).filter((n: number) => Number.isFinite(n));
    return stamps.length ? Math.max(...stamps) : Number(payload.iat) || 0;
  } catch { return 0; }
}

const BUCKETS = ['profile-photos', 'Photos'];
async function listFiles(bucket: string, folder: string): Promise<string[]> {
  const { data, error } = await service.storage.from(bucket).list(folder, { limit: 1000, offset: 0 });
  if (error) throw new Error(`list ${bucket}`);
  const out: string[] = [];
  for (const item of data ?? []) {
    const path = `${folder}/${item.name}`;
    if (item.id === null) out.push(...await listFiles(bucket, path)); else out.push(path);
  }
  return out;
}

const store: AdminStore = {
  async authenticate(token): Promise<Principal | null> {
    const { data, error } = await service.auth.getUser(token);
    if (error || !data.user) return null;
    return { id: data.user.id, email: data.user.email ?? null, lastAuthAt: lastAuthAt(token) };
  },
  async roleOf(userId) {
    const { data, error } = await service.from('app_admins').select('role').eq('user_id', userId).maybeSingle();
    if (error) throw new Error('role lookup failed');
    return (data?.role as 'owner' | 'admin' | undefined) ?? null;
  },
  async rateHit(actor, bucket, limit) {
    const { data, error } = await service.rpc('admin_rate_hit', { p_actor: actor, p_bucket: bucket, p_limit: limit });
    if (error) throw new Error('rate limiter unavailable'); // fail closed
    return data === true;
  },
  async audit(entry) {
    const { error } = await service.from('admin_audit_log').insert(entry);
    return !error;
  },
  async rpc(name, args) {
    const { data, error } = await service.rpc(name, args);
    return { data, error: error ? { message: error.message } : null };
  },
  async targetUser(userId) {
    const { data, error } = await service.auth.admin.getUserById(userId);
    if (error || !data.user) return null;
    return { id: data.user.id, email: data.user.email ?? null, confirmed: Boolean(data.user.email_confirmed_at) };
  },
  async setBan(userId, banned) {
    const { error } = await service.auth.admin.updateUserById(userId, { ban_duration: banned ? '876000h' : 'none' });
    if (error) throw new Error('ban update failed');
  },
  async sendPasswordReset(email) {
    const { error } = await anon.auth.resetPasswordForEmail(email, { redirectTo: `${siteUrl}/auth/reset-password` });
    if (error) throw new Error('reset email failed');
  },
  async resendVerification(email) {
    const { error } = await anon.auth.resend({ type: 'signup', email, options: { emailRedirectTo: `${siteUrl}/auth/confirm` } });
    if (error) throw new Error('resend failed');
  },
  async deleteAccount(userId) {
    for (const bucket of BUCKETS) {
      let files: string[] = [];
      try { files = await listFiles(bucket, userId); } catch (e) { if (bucket === 'Photos') continue; throw e; }
      for (let i = 0; i < files.length; i += 100) {
        const { error } = await service.storage.from(bucket).remove(files.slice(i, i + 100));
        if (error) throw new Error('storage cleanup failed');
      }
    }
    const { error } = await service.auth.admin.deleteUser(userId);
    if (error) throw new Error('auth delete failed');
    const { error: profileError } = await service.from('profiles').delete().eq('id', userId);
    if (profileError) throw new Error('profile cleanup failed');
  },
  config() {
    const has = (k: string) => Boolean(Deno.env.get(k));
    return [
      { key: 'SUPABASE_SERVICE_ROLE_KEY', label: 'Service role key (server only)', configured: has('SUPABASE_SERVICE_ROLE_KEY') },
      { key: 'SUPABASE_ANON_KEY', label: 'Publishable key available to the function', configured: has('SUPABASE_ANON_KEY') },
      { key: 'VAPID_PUBLIC_KEY', label: 'Web Push public key', configured: has('VAPID_PUBLIC_KEY') },
      { key: 'VAPID_PRIVATE_KEY', label: 'Web Push private key', configured: has('VAPID_PRIVATE_KEY') },
      { key: 'PUSH_DISPATCH_SECRET', label: 'Push dispatch secret', configured: has('PUSH_DISPATCH_SECRET') },
      { key: 'CLOUDFLARE_TURN_KEY_ID', label: 'TURN key id (calls)', configured: has('CLOUDFLARE_TURN_KEY_ID') },
      { key: 'CLOUDFLARE_TURN_API_TOKEN', label: 'TURN API token (calls)', configured: has('CLOUDFLARE_TURN_API_TOKEN') },
      { key: 'ADMIN_SITE_URL', label: 'Email redirect base', configured: has('ADMIN_SITE_URL'), note: `Using ${siteUrl}` },
      { key: 'ADMIN_ALLOWED_ORIGINS', label: 'Extra allowed admin origins', configured: has('ADMIN_ALLOWED_ORIGINS') },
    ];
  },
};

Deno.serve(createAdminHandler(store, { origins }));
