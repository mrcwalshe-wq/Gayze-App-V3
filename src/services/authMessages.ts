/**
 * Human wording for authentication outcomes. Nothing here returns a raw provider
 * message, project hostname or error code to the screen.
 */
export type AuthContext = 'signin' | 'signup' | 'forgot' | 'reset' | 'resend' | 'oauth';

export interface AuthIssue {
  /** Short stable key for tests and analytics. */
  kind: 'invalid_credentials' | 'email_not_verified' | 'rate_limited' | 'network' | 'weak_password' | 'same_password'
    | 'link_expired' | 'oauth_cancelled' | 'oauth_failed' | 'provider_conflict' | 'session_expired' | 'unavailable';
  message: string;
  /** What the screen should offer next. */
  action?: 'resend' | 'request_reset' | 'signin';
}

const text = (e: unknown): string => {
  if (!e) return '';
  if (typeof e === 'string') return e;
  const o = e as { message?: unknown; code?: unknown; error_code?: unknown; status?: unknown; name?: unknown };
  return [o.message, o.code, o.error_code, o.name].filter((v) => typeof v === 'string').join(' ');
};
const status = (e: unknown): number => Number((e as { status?: unknown })?.status) || 0;

export function describeAuthError(error: unknown, context: AuthContext): AuthIssue {
  const raw = text(error).toLowerCase();
  const s = status(error);

  if (!raw && !s) return { kind: 'unavailable', message: 'Something went wrong. Please try again.' };
  if (/failed to fetch|networkerror|network request failed|load failed|fetch failed|authretryablefetcherror/.test(raw) || s === 0 && /fetch/.test(raw)) {
    return { kind: 'network', message: 'We could not reach GAYZE. Check your connection and try again.' };
  }
  if (s === 429 || /rate.?limit|too many|over_email_send_rate_limit|over_request_rate_limit|security purposes/.test(raw)) {
    return { kind: 'rate_limited', message: 'Too many attempts. Wait a minute, then try again.' };
  }
  if (/email not confirmed|email_not_confirmed/.test(raw)) {
    return { kind: 'email_not_verified', message: 'Confirm your email address first. We can send the link again.', action: 'resend' };
  }
  if (/invalid login credentials|invalid_credentials|invalid email or password/.test(raw)) {
    return { kind: 'invalid_credentials', message: 'That email and password do not match. Check them and try again.' };
  }
  if (/same.?password|new password should be different/.test(raw)) {
    return { kind: 'same_password', message: 'Choose a password you have not used on this account before.' };
  }
  if (/weak.?password|password should|password is known|pwned|compromised|at least \d+ char/.test(raw)) {
    return { kind: 'weak_password', message: 'Choose a stronger password: at least 8 characters, not a common or previously leaked one.' };
  }
  if (/otp_expired|expired|token has expired|invalid or has expired|flow state not found|code verifier|invalid flow state|bad_oauth_state|invalid token/.test(raw)) {
    return context === 'reset' || context === 'forgot'
      ? { kind: 'link_expired', message: 'This reset link has expired or was already used. Request a new one.', action: 'request_reset' }
      : { kind: 'link_expired', message: 'This link has expired or was already used. Request a new one.', action: context === 'signup' || context === 'resend' ? 'resend' : 'signin' };
  }
  if (/access_denied|user denied|cancel/.test(raw)) {
    return { kind: 'oauth_cancelled', message: 'Google sign-in was cancelled. You can try again whenever you like.' };
  }
  if (/identity_already_exists|already linked|already registered|user already registered|email_exists|provider_email_needs_verification|different provider/.test(raw)) {
    return { kind: 'provider_conflict', message: 'An account with this email already exists. Sign in with the method you used before, or reset your password.', action: 'signin' };
  }
  if (/session.*(missing|expired|not found)|refresh_token_not_found|invalid refresh token|jwt expired|not authenticated|auth session missing/.test(raw) || s === 401) {
    return { kind: 'session_expired', message: 'Your session has ended. Sign in again to continue.', action: 'signin' };
  }
  if (context === 'oauth' || /oauth|provider|callback/.test(raw)) {
    return { kind: 'oauth_failed', message: 'Google sign-in did not complete. Please try again, or use your email and password.' };
  }
  return { kind: 'unavailable', message: 'We could not complete that. Please try again in a moment.' };
}

/** Pure email shape check for inline validation (the server remains the authority). */
export const isPlausibleEmail = (value: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim()) && value.trim().length <= 254;

export interface PasswordCheck { ok: boolean; problems: string[] }
export function checkPassword(password: string): PasswordCheck {
  const problems: string[] = [];
  if (password.length < 8) problems.push('At least 8 characters');
  if (password.length > 72) problems.push('No more than 72 characters');
  if (!/[a-z]/i.test(password) || !/[0-9]/.test(password)) problems.push('A mix of letters and numbers');
  return { ok: problems.length === 0, problems };
}
