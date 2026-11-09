import { supabase } from './supabaseClient';
import { appleSignInAvailable, googleSignInAllowed, type CapacitorLike } from './platform';
import { appleDisplayName, randomNonce, sha256Hex } from './appleAuth';

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

const capacitor = (): CapacitorLike => (typeof window === 'undefined' ? undefined : (window as unknown as { Capacitor?: CapacitorLike }).Capacitor);

/** Google: everywhere, except the iPhone app when Apple sign-in is switched off (App Review 4.8). */
export function googleSignInAvailable(): boolean { return googleSignInAllowed(capacitor()); }

/** Apple: inside the iPhone app only. */
export function appleSignInOffered(): boolean { return appleSignInAvailable(capacitor()); }

/** Native Sign in with Apple, then exchange Apple's token for a Supabase session. Throws on failure; cancelling is reported by the caller. */
export async function signInWithApple(): Promise<void> {
  if (!supabase) throw new Error('Authentication is not configured.');
  const { GayzeAppleSignIn } = await import('gayze-apple-sign-in');
  const rawNonce = randomNonce();
  const result = await GayzeAppleSignIn.authorize({ nonce: await sha256Hex(rawNonce) });
  const { error } = await supabase.auth.signInWithIdToken({ provider: 'apple', token: result.identityToken, nonce: rawNonce });
  if (error) throw error;
  const name = appleDisplayName(result.givenName, result.familyName);
  if (name) { try { await supabase.auth.updateUser({ data: { display_name: name } }); } catch { /* name is a convenience */ } }
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
