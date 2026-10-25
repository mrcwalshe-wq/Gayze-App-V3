import test from 'node:test';
import assert from 'node:assert/strict';
import { describeAuthError, isPlausibleEmail, checkPassword } from '../../src/services/authMessages.ts';
import { consumeAuthCallback, readCallbackParams } from '../../src/services/authCallback.ts';

const loc = (pathname: string, search = '', hash = '') => ({ pathname, search, hash });
const client = (result: { error: unknown } = { error: null }) => {
  const calls: unknown[] = [];
  return { calls, auth: { verifyOtp: async (args: unknown) => { calls.push(args); return result; } } } as never as { calls: unknown[]; auth: never };
};

test('error wording never leaks provider text, hostnames or codes', () => {
  const cases: [unknown, string][] = [
    [{ message: 'Invalid login credentials', status: 400 }, 'invalid_credentials'],
    [{ message: 'Email not confirmed', code: 'email_not_confirmed' }, 'email_not_verified'],
    [{ message: 'email rate limit exceeded', status: 429 }, 'rate_limited'],
    [new TypeError('Failed to fetch'), 'network'],
    [{ message: 'Password should be at least 8 characters' }, 'weak_password'],
    [{ message: 'New password should be different from the old password.' }, 'same_password'],
    [{ message: 'Email link is invalid or has expired', code: 'otp_expired' }, 'link_expired'],
    [{ message: 'access_denied' }, 'oauth_cancelled'],
    [{ message: 'User already registered' }, 'provider_conflict'],
    [{ message: 'Auth session missing!' }, 'session_expired'],
    [{ message: 'something at qdewyupsqmtonkloqxsh.supabase.co exploded', status: 500 }, 'unavailable'],
    [undefined, 'unavailable'],
  ];
  for (const [err, kind] of cases) {
    const issue = describeAuthError(err, 'signin');
    assert.equal(issue.kind, kind, JSON.stringify(err));
    assert.equal(/supabase|qdewyup|postgres|jwt|otp|stack/i.test(issue.message), false, issue.message);
  }
  assert.equal(describeAuthError({ message: 'otp_expired' }, 'reset').action, 'request_reset');
  assert.equal(describeAuthError({ message: 'Email not confirmed' }, 'signin').action, 'resend');
});

test('validators', () => {
  assert.equal(isPlausibleEmail('a@b.co'), true);
  for (const bad of ['', 'a', 'a@b', 'a b@c.com', '@x.com', 'a@b.c']) assert.equal(isPlausibleEmail(bad), false, bad);
  assert.equal(checkPassword('abc12345').ok, true);
  assert.equal(checkPassword('short1').ok, false);
  assert.equal(checkPassword('onlyletters').ok, false);
  assert.equal(checkPassword('x'.repeat(80) + '1').ok, false);
});

test('token_hash links are exchanged on the GAYZE domain and the URL is cleaned', async () => {
  const c = client(); let cleaned = '';
  const r = await consumeAuthCallback(c, loc('/auth/reset-password', '?token_hash=abc123&type=recovery'), (p) => { cleaned = p; });
  assert.deepEqual(r, { kind: 'recovery' });
  assert.deepEqual(c.calls, [{ token_hash: 'abc123', type: 'recovery' }]);
  assert.equal(cleaned, '/auth/reset-password', 'token no longer in the URL');
  const c2 = client(); let cleaned2 = '';
  assert.deepEqual(await consumeAuthCallback(c2, loc('/auth/confirm', '?token_hash=zzz&type=signup'), (p) => { cleaned2 = p; }), { kind: 'verified' });
  assert.equal(cleaned2, '/');
  assert.deepEqual(await consumeAuthCallback(client(), loc('/auth/email-change', '?token_hash=q&type=email_change'), () => {}), { kind: 'email_changed' });
});

test('expired or reused links become a recoverable state, not a raw error', async () => {
  const r = await consumeAuthCallback(client({ error: { message: 'Email link is invalid or has expired', status: 403 } }), loc('/auth/reset-password', '?token_hash=old&type=recovery'), () => {});
  assert.equal(r.kind, 'error');
  if (r.kind === 'error') { assert.equal(r.issue.kind, 'link_expired'); assert.equal(r.issue.action, 'request_reset'); assert.equal(r.flow, 'recovery'); }
});

test('provider errors in the URL hash or query are understood (expired recovery, cancelled Google)', async () => {
  let cleaned = '';
  const expired = await consumeAuthCallback(client(), loc('/auth/reset-password', '', '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired'), (p) => { cleaned = p; });
  assert.equal(expired.kind, 'error');
  if (expired.kind === 'error') assert.equal(expired.issue.kind, 'link_expired');
  assert.equal(cleaned, '/auth/reset-password');
  const cancelled = await consumeAuthCallback(client(), loc('/', '?error=access_denied&error_description=User+denied+access'), () => {});
  assert.equal(cancelled.kind === 'error' && cancelled.issue.kind, 'oauth_cancelled');
  const failed = await consumeAuthCallback(client(), loc('/', '?error=server_error&error_description=Unable+to+exchange+external+code'), () => {});
  assert.equal(failed.kind === 'error' && failed.flow, 'oauth');
});

test('ordinary page loads and unrelated query strings are untouched', async () => {
  const c = client();
  assert.deepEqual(await consumeAuthCallback(c, loc('/', '?notification=abc'), () => assert.fail('must not rewrite the URL')), { kind: 'none' });
  assert.deepEqual(await consumeAuthCallback(c, loc('/admin', '', '#dashboard'), () => assert.fail('must not rewrite')), { kind: 'none' });
  assert.equal(c.calls.length, 0);
  assert.equal(readCallbackParams(loc('/', '?token_hash=a&type=recovery')).hasRecoveryHint, true);
});
