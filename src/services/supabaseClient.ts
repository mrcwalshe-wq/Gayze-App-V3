import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

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

