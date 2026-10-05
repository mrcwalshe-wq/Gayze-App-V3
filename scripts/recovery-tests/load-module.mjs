import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

/** Compile the real source with only the network/auth boundary replaced.
 * No test can connect to the production fallback Supabase project. */
export async function loadModule(entry, backend = null, environment = {}) {
  const result = await build({
    entryPoints: [entry], absWorkingDir: fileURLToPath(new URL('../../', import.meta.url)),
    bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external',
    define: { 'import.meta.env': JSON.stringify(environment) },
    plugins: [{ name: 'test-network-boundary', setup(builder) {
      builder.onResolve({ filter: /\/supabaseClient$/ }, () => ({ path: 'client', namespace: 'test' }));
      builder.onResolve({ filter: /\/analyticsService$/ }, () => ({ path: 'analytics', namespace: 'test' }));
      builder.onLoad({ filter: /.*/, namespace: 'test' }, ({ path }) => ({ contents: path === 'client'
        ? 'export const supabase = globalThis.__gayzeRecoveryTestBackend; export const isSupabaseConfigured = true;'
        : 'export const analytics = { logEvent() {} };', loader: 'js' }));
    } }],
  });
  globalThis.__gayzeRecoveryTestBackend = backend;
  const module = { exports: {} };
  const require = createRequire(new URL('../../package.json', import.meta.url));
  new Function('require', 'module', 'exports', result.outputFiles[0].text)(require, module, module.exports);
  delete globalThis.__gayzeRecoveryTestBackend;
  return module.exports;
}
