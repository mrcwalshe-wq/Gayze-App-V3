import { createClient } from '@supabase/supabase-js';

// Production-safe fallback: these are Supabase browser publishable credentials,
// not service-role secrets. Keeping them here prevents a Cloudflare Pages build
// from silently falling back to demo mode when build-time env injection is absent.
// Environment variables still take precedence for local/staging overrides.
const DEFAULT_SUPABASE_URL = 'https://qdewyupsqmtonkloqxsh.supabase.co';
const DEFAULT_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_TeBAtLH6YljGFKbz4pvNtg_1JH6TbYO';

const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() || DEFAULT_SUPABASE_URL;
const supabasePublishableKey = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined)?.trim() || DEFAULT_SUPABASE_PUBLISHABLE_KEY;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabasePublishableKey);

// Keep the browser auth session in one deterministic GAYZE-owned storage key.
// This makes sign-out reliable even if Supabase changes its default key format.
export const GAYZE_AUTH_STORAGE_KEY = 'gayze-auth-token';

/** Auth redirect target for local Vite and Vercel/production. */
export function getAuthRedirectUrl(path = '/'): string {
  if (typeof window === 'undefined') return path;
  const base = window.location.origin.replace(/\/$/, '');
  const normalised = path.startsWith('/') ? path : `/${path}`;
  return `${base}${normalised === '/' ? '/' : normalised}`;
}

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl!, supabasePublishableKey!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: 'pkce',
        storageKey: GAYZE_AUTH_STORAGE_KEY,
      },
    })
  : null;

