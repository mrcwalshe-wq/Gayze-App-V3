// Generates the GAYZE auth email templates. Run: node scripts/email-templates/build.mjs
// Links go to GAYZE's own domain with a token_hash, which the app exchanges via
// supabase.auth.verifyOtp (src/services/authCallback.ts). They never contain the
// Supabase project hostname. Template variables are Supabase's Go-template syntax.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const OUT = fileURLToPath(new URL('../../supabase/templates', import.meta.url));

const shell = ({ preheader, heading, body, cta, ctaHref, footnote }) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark light">
<meta name="supported-color-schemes" content="dark light">
<title>${heading}</title>
</head>
<body style="margin:0;padding:0;background:#090a0f;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#090a0f;">${preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#090a0f;">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#11131a;border:1px solid #232634;border-top:3px solid #6F3CC3;border-radius:20px;">
<tr><td style="padding:32px 28px 8px;text-align:center;">
<div style="font:700 22px/1 -apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;letter-spacing:.28em;color:#ffffff;">GAYZE</div>
<div style="margin-top:8px;font:14px/1.4 -apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;"><span style="color:#b796f0;">Real Intent.</span> <span style="color:#C9A24D;">Real Time.</span></div>
</td></tr>
<tr><td style="padding:20px 28px 0;font:600 20px/1.3 -apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#f1f3f7;">${heading}</td></tr>
<tr><td style="padding:12px 28px 0;font:15px/1.6 -apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#b5bac7;">${body}</td></tr>
${cta ? `<tr><td align="center" style="padding:24px 28px 0;">
<a href="${ctaHref}" style="display:inline-block;background:#6F3CC3;color:#ffffff;text-decoration:none;font:600 16px/1 -apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;padding:16px 28px;border-radius:12px;">${cta}</a>
</td></tr>
<tr><td style="padding:16px 28px 0;font:12px/1.5 -apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#7f8696;text-align:center;">Button not working? Copy this link into your browser:<br><span style="color:#b796f0;word-break:break-all;">${ctaHref}</span></td></tr>` : ''}
<tr><td style="padding:24px 28px 28px;font:12px/1.6 -apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#7f8696;border-top:1px solid #232634;margin-top:24px;">${footnote}<br><br>GAYZE &middot; <a href="{{ .SiteURL }}" style="color:#C9A24D;text-decoration:none;">gayze.co.uk</a> &middot; <a href="{{ .SiteURL }}/safety.html" style="color:#7f8696;">Safety</a> &middot; <a href="{{ .SiteURL }}/privacy.html" style="color:#7f8696;">Privacy</a></td></tr>
</table>
</td></tr>
</table>
</body>
</html>
`;

const ignore = 'If you did not request this, you can safely ignore this email. Nothing will change.';
const link = (path, type) => `{{ .SiteURL }}${path}?token_hash={{ .TokenHash }}&type=${type}`;

export const TEMPLATES = {
  // Dashboard: Authentication > Emails > Confirm sign up
  confirmation: { subject: 'Confirm your GAYZE account', html: shell({
    preheader: 'One tap to confirm your email and finish creating your account.',
    heading: 'Confirm your email',
    body: 'Welcome to GAYZE. Confirm this email address to finish creating your account. The link works once and expires soon.',
    cta: 'Confirm email', ctaHref: link('/auth/confirm', 'signup'),
    footnote: `You are receiving this because someone signed up to GAYZE with ${'{{ .Email }}'}. ${ignore}` }) },
  // Reset password
  recovery: { subject: 'Reset your GAYZE password', html: shell({
    preheader: 'Use this link to choose a new password.',
    heading: 'Reset your password',
    body: 'We received a request to reset the password for your GAYZE account. Choose a new one with the button below. The link works once and expires soon.',
    cta: 'Choose a new password', ctaHref: link('/auth/reset-password', 'recovery'),
    footnote: `${ignore} Your current password stays valid until you use this link.` }) },
  // Change email address
  email_change: { subject: 'Confirm your new GAYZE email', html: shell({
    preheader: 'Confirm the change of email address on your account.',
    heading: 'Confirm your new email',
    body: 'You asked to change the email address on your GAYZE account to {{ .NewEmail }}. Confirm it below.',
    cta: 'Confirm new email', ctaHref: link('/auth/email-change', 'email_change'),
    footnote: `${ignore} If you did not make this change, reset your password straight away.` }) },
  // Magic link (only used if passwordless sign-in is switched on)
  magic_link: { subject: 'Your GAYZE sign-in link', html: shell({
    preheader: 'Tap to sign in. The link works once.',
    heading: 'Sign in to GAYZE',
    body: 'Use the button below to sign in. The link works once and expires soon.',
    cta: 'Sign in', ctaHref: link('/auth/magic-link', 'magiclink'),
    footnote: ignore }) },
  // Reauthentication code (shown as a code, no link)
  reauthentication: { subject: 'Your GAYZE confirmation code', html: shell({
    preheader: 'Your one-time confirmation code.',
    heading: 'Confirm it is you',
    body: 'Enter this code in GAYZE to continue:<br><br><span style="font:700 28px/1 ui-monospace,Menlo,monospace;letter-spacing:.3em;color:#ffffff;">{{ .Token }}</span>',
    footnote: `${ignore} Never share this code with anyone.` }) },
  // Security notifications (Dashboard > Authentication > Emails > Notifications, where available)
  password_changed_notification: { subject: 'Your GAYZE password was changed', html: shell({
    preheader: 'The password on your account was changed.',
    heading: 'Your password was changed',
    body: 'The password for the GAYZE account {{ .Email }} was just changed. If this was you, no action is needed.',
    footnote: 'If you did not do this, reset your password now from the sign-in screen and contact support at gayze.co.uk.' }) },
  email_changed_notification: { subject: 'Your GAYZE email address was changed', html: shell({
    preheader: 'The email address on your account was changed.',
    heading: 'Your email address was changed',
    body: 'The email address on your GAYZE account was changed from {{ .OldEmail }} to {{ .Email }}.',
    footnote: 'If you did not do this, reset your password now and contact support at gayze.co.uk.' }) },
};

if (import.meta.url === `file://${process.argv[1]}`) {
  fs.mkdirSync(OUT, { recursive: true });
  const manifest = {};
  for (const [name, t] of Object.entries(TEMPLATES)) {
    fs.writeFileSync(`${OUT}/${name}.html`, t.html);
    manifest[name] = t.subject;
  }
  fs.writeFileSync(`${OUT}/subjects.json`, JSON.stringify(manifest, null, 2) + '\n');
  console.log('wrote', Object.keys(TEMPLATES).length, 'templates');
}
