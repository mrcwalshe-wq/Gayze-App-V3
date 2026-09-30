/**
 * Vite's `import.meta.env` does not exist under plain Node, so any module that
 * reads it throws at import time. This load hook rewrites those reads to a
 * global that scripts/interaction-tests/env.mjs installs, which lets the REAL
 * source files be imported unmodified.
 *
 * Registered by register-hooks.mjs via `node --import`.
 */
const GLOBAL_NAME = 'globalThis.__GAYZE_VITE_ENV__';

function asString(source) {
  if (typeof source === 'string') return source;
  if (source instanceof Uint8Array) return Buffer.from(source).toString('utf8');
  return null;
}

export async function load(url, context, next) {
  const result = await next(url, context);
  const source = asString(result.source);
  if (source === null || !source.includes('import.meta.env')) return result;
  return { ...result, source: source.replaceAll('import.meta.env', GLOBAL_NAME) };
}
