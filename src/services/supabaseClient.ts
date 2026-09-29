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

/** Branded auth callback paths used by Supabase email links. */
export const AUTH_REDIRECT_PATHS = {
  home: '/',
  resetPassword: '/auth/reset-password',
  emailConfirm: '/auth/confirm',
  emailChange: '/auth/email-change',
  magicLink: '/auth/magic-link',
} as const;

/**
 * Auth redirect target for local Vite and production.
 * Local development stays on localhost; the current Cloudflare workers.dev
 * deployment is redirected to the permanent GAYZE domain.
 */
export function getAuthRedirectUrl(path: string = AUTH_REDIRECT_PATHS.home): string {
  if (typeof window === 'undefined') return path;

  const origin = window.location.origin.replace(/\/$/, '');
  const hostname = window.location.hostname;
  const isLocalhost =
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]';
  const isCloudflareWorkersHost = hostname.endsWith('.workers.dev');

  const base =
    !isLocalhost && isCloudflareWorkersHost
      ? 'https://gayze.co.uk'
      : origin;

  const normalised = path.startsWith('/') ? path : `/${path}`;
  return `${base}${normalised}`;
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

