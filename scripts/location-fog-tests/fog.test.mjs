// Runs fog.test.sql against a throwaway PostgreSQL database.
//
//   FOG_TEST_DATABASE_URL=postgres://user@localhost:5432/fogtest npm run test:location-fog
//
// The database must be empty or disposable: the test creates the private schema,
// the fog secret table and two roles. It needs psql on the PATH and plain
// PostgreSQL 14+ (no PostGIS; the PostGIS wiring in part 2 of the migration is
// checked separately against a real Supabase database).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');
const URL_ = process.env.FOG_TEST_DATABASE_URL;

test('location fog snapping (plain PostgreSQL)', { skip: URL_ ? false : 'set FOG_TEST_DATABASE_URL to run' }, () => {
  const run = spawnSync('psql', [URL_, '-X', '-v', 'ON_ERROR_STOP=1', '-f', 'scripts/location-fog-tests/fog.test.sql'], {
    cwd: REPO,
    encoding: 'utf8',
  });
  process.stdout.write(run.stdout || '');
  assert.equal(run.status, 0, run.stderr || 'psql failed');
  assert.doesNotMatch(run.stdout, /\bFAIL\b/);
});
