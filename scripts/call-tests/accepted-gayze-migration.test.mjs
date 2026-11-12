import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../../supabase/migrations/20261112100000_calls_require_accepted_gayze.sql', import.meta.url), 'utf8');

test('call initiation requires an accepted GAYZE in either direction', () => {
  assert.match(migration, /i\.status\s*=\s*'mutual'/);
  assert.match(migration, /i\.from_user_id\s*=\s*uid\s+and\s+i\.to_user_id\s*=\s*p_callee/);
  assert.match(migration, /i\.from_user_id\s*=\s*p_callee\s+and\s+i\.to_user_id\s*=\s*uid/);
  assert.match(migration, /raise exception 'accepted Gayze required'/);
});

test('call initiation still requires both users in the same conversation', () => {
  assert.match(migration, /caller_member\.conversation_id\s*=\s*p_conversation/);
  assert.match(migration, /callee_member\.user_id\s*=\s*p_callee/);
});

test('ringing-call recovery independently rechecks mutual acceptance and membership', () => {
  const recovery = migration.slice(migration.indexOf('create or replace function public.get_ringing_call()'));
  assert.match(recovery, /i\.status\s*=\s*'mutual'/);
  assert.match(recovery, /caller_member\.conversation_id\s*=\s*s\.conversation_id/);
  assert.match(recovery, /callee_member\.user_id\s*=\s*s\.callee_id/);
});
