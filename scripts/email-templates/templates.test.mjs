import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { TEMPLATES } from './build.mjs';

const dir = new URL('../../supabase/templates/', import.meta.url);

test('committed templates match the generator', () => {
  for (const [name, t] of Object.entries(TEMPLATES)) assert.equal(fs.readFileSync(new URL(`${name}.html`, dir), 'utf8'), t.html, `${name}.html is stale; run node scripts/email-templates/build.mjs`);
});

test('every template is branded, responsive, free of infrastructure hostnames and secrets', () => {
  for (const [name, t] of Object.entries(TEMPLATES)) {
    assert.match(t.html, /#6F3CC3/i, name);
    assert.match(t.html, /#C9A24D/i, name);
    assert.match(t.html, /Real Intent\./, name);
    assert.match(t.html, /name="viewport"/, name);
    assert.doesNotMatch(t.html, /supabase\.co|qdewyup|ConfirmationURL|service_role|apikey/i, name);
    assert.ok(Buffer.byteLength(t.html) < 12000, `${name} stays small enough for Gmail clipping`);
    assert.ok(t.subject.length < 60 && /gayze/i.test(t.subject), name);
  }
});

test('link templates use GAYZE-domain token_hash links and the right OTP type', () => {
  const expect = { confirmation: ['/auth/confirm', 'signup'], recovery: ['/auth/reset-password', 'recovery'], email_change: ['/auth/email-change', 'email_change'], magic_link: ['/auth/magic-link', 'magiclink'] };
  for (const [name, [path, type]] of Object.entries(expect)) {
    assert.ok(TEMPLATES[name].html.includes(`{{ .SiteURL }}${path}?token_hash={{ .TokenHash }}&type=${type}`), name);
  }
  assert.ok(TEMPLATES.reauthentication.html.includes('{{ .Token }}'));
  assert.doesNotMatch(TEMPLATES.reauthentication.html, /token_hash/);
});
