import { supabase } from './supabaseClient';

/**
 * Google sign-in inside the Capacitor app (iOS and Android).
 *
 * The web flow redirects the whole page, which cannot return to the app. In the
 * native shell we open Google in the system browser (Safari View Controller /
 * Chrome Custom Tabs, which Google allows), and Supabase sends the user back to
 * the app through the `gayze://` link below. The PKCE code in that link is then
 * exchanged for a session. The web app is unchanged.
 *
 * Supabase Dashboard > Authentication > URL Configuration must list
 * NATIVE_AUTH_CALLBACK in the Redirect URLs.
 */
export const NATIVE_AUTH_SCHEME = 'gayze';
export const NATIVE_AUTH_CALLBACK = `${NATIVE_AUTH_SCHEME}://auth/callback`;

export function isNativeApp(): boolean {
  if (typeof window === 'undefined') return false;
  return Boolean(
    (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } })
      .Capacitor?.isNativePlatform?.(),
  );
}

/** Starts Google sign-in in the system browser. Resolves once the browser is open. */
export async function startNativeGoogleSignIn(): Promise<void> {
  if (!supabase) throw new Error('Authentication is not configured.');
  const { Browser } = await import('@capacitor/browser');
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: NATIVE_AUTH_CALLBACK, skipBrowserRedirect: true },
  });
  if (error) throw error;
  if (!data?.url) throw new Error('Google sign-in could not be started.');
  await Browser.open({ url: data.url });
}

let listening = false;

/**
 * Listens for the `gayze://auth/callback` link and completes sign-in.
 * Safe to call more than once. Returns a cleanup function.
 */
export async function initNativeAuthDeepLinks(
  onResult?: (result: { ok: true } | { ok: false; message: string }) => void,
): Promise<() => void> {
  if (!isNativeApp() || listening || !supabase) return () => {};
  listening = true;

  const [{ App }, { Browser }] = await Promise.all([
    import('@capacitor/app'),
    import('@capacitor/browser'),
  ]);

  const handle = await App.addListener('appUrlOpen', async ({ url }) => {
    if (!url || !url.startsWith(`${NATIVE_AUTH_SCHEME}://auth/callback`)) return;
    try { await Browser.close(); } catch { /* already closed (Android) */ }

    // supabase-js puts the code in the query; errors may arrive in query or hash.
    const parsed = new URL(url.replace(`${NATIVE_AUTH_SCHEME}://`, 'https://gayze.invalid/'));
    const hash = new URLSearchParams(parsed.hash.replace(/^#/, ''));
    const code = parsed.searchParams.get('code');
    const failure =
      parsed.searchParams.get('error_description') ??
      parsed.searchParams.get('error') ??
      hash.get('error_description') ??
      hash.get('error');

    if (failure) { onResult?.({ ok: false, message: failure }); return; }
    if (!code) { onResult?.({ ok: false, message: 'Sign-in was cancelled.' }); return; }

    const { error } = await supabase!.auth.exchangeCodeForSession(code);
    onResult?.(error ? { ok: false, message: error.message } : { ok: true });
  });

  return () => { listening = false; void handle.remove(); };
}
