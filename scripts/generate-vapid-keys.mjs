#!/usr/bin/env node
/**
 * GAYZE — generate a VAPID key pair for Web Push.
 *
 *   node scripts/generate-vapid-keys.mjs
 *
 * Prints an application-server (VAPID) P-256 key pair in the base64url format
 * the Push API expects.
 *
 *   VITE_VAPID_PUBLIC_KEY  -> safe to ship to the browser (build-time env var)
 *   VAPID_PRIVATE_KEY      -> SECRET. Supabase Edge Function secret only.
 *                             Never commit it, never expose it to frontend JS.
 */

import { generateKeyPairSync } from 'node:crypto';

const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });

const jwk = privateKey.export({ format: 'jwk' });

// Uncompressed EC point: 0x04 || X (32 bytes) || Y (32 bytes)
const x = Buffer.from(jwk.x, 'base64url');
const y = Buffer.from(jwk.y, 'base64url');
const uncompressed = Buffer.concat([Buffer.from([0x04]), x, y]);

const publicKeyB64 = uncompressed.toString('base64url');
const privateKeyB64 = Buffer.from(jwk.d, 'base64url').toString('base64url');

// Sanity check: the Push API rejects anything that is not 65/32 bytes.
if (uncompressed.length !== 65) throw new Error(`Unexpected public key length: ${uncompressed.length}`);
if (Buffer.from(jwk.d, 'base64url').length !== 32) throw new Error('Unexpected private key length');

// Touch `publicKey` so the export is unambiguous to readers/linters.
void publicKey;

process.stdout.write(`
GAYZE VAPID key pair
====================

Frontend (.env / Cloudflare build env — public, safe to expose):

  VITE_VAPID_PUBLIC_KEY=${publicKeyB64}

Server (Supabase Edge Function secret — NEVER commit, NEVER send to the browser):

  VAPID_PRIVATE_KEY=${privateKeyB64}
  VAPID_PUBLIC_KEY=${publicKeyB64}
  VAPID_SUBJECT=mailto:support@gayze.co.uk

Set the server side with:

  supabase secrets set \\
    VAPID_PUBLIC_KEY=${publicKeyB64} \\
    VAPID_PRIVATE_KEY=${privateKeyB64} \\
    VAPID_SUBJECT=mailto:support@gayze.co.uk

`);
