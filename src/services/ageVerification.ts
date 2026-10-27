import { supabase } from './supabaseClient';
import { isNativeApp } from './nativeAuth';

/**
 * Yoti age check (over 18). Off until VITE_AGE_VERIFICATION_ENABLED=true is set at build
 * time, so the code can ship before Yoti is configured without locking anyone out.
 * Only the age-verify edge functions can mark a member verified; this file just reads and triggers.
 */
export const AGE_VERIFICATION_ENABLED =
  (import.meta.env.VITE_AGE_VERIFICATION_ENABLED as string | undefined)?.trim() === 'true';

export type AgeVerificationStatus = 'verified' | 'pending' | 'failed' | 'none';

/** Reads the member's own row (row-level security limits it to their own). */
export async function getAgeVerificationStatus(userId: string): Promise<AgeVerificationStatus> {
  if (!supabase) return 'none';
  const { data, error } = await supabase
    .from('age_verifications')
    .select('status')
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !data) return 'none';
  return data.status === 'verified' || data.status === 'failed' ? data.status : 'pending';
}

/** Asks the server to read the Yoti result and record it. */
export async function checkAgeVerification(): Promise<AgeVerificationStatus> {
  if (!supabase) return 'none';
  const { data, error } = await supabase.functions.invoke('age-verify-check', { method: 'POST', body: {} });
  if (error) throw new Error(error.message || 'Could not check your age verification.');
  const status = (data as { status?: string } | null)?.status;
  return status === 'verified' || status === 'failed' || status === 'pending' ? status : 'none';
}

/** Creates a Yoti session and opens it: the system browser in the app, a redirect on the web. */
export async function startAgeVerification(): Promise<AgeVerificationStatus> {
  if (!supabase) throw new Error('Age verification is not available.');
  const native = isNativeApp();
  const { data, error } = await supabase.functions.invoke('age-verify-start', {
    method: 'POST',
    body: { platform: native ? 'native' : 'web' },
  });
  if (error) throw new Error(error.message || 'Could not start age verification.');
  const result = data as { status?: string; url?: string; error?: string } | null;
  if (result?.status === 'verified') return 'verified';
  if (!result?.url) throw new Error(result?.error || 'Could not start age verification.');

  if (native) {
    const { Browser } = await import('@capacitor/browser');
    await Browser.open({ url: result.url });
  } else {
    window.location.assign(result.url);
  }
  return 'pending';
}
