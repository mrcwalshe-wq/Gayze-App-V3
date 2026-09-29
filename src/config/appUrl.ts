/**
 * Canonical Gayze origins.
 *
 * Production notification click-through, manifest start_url and service-worker
 * navigation must never resolve to localhost. Anything user-visible that leaves
 * the browser tab (a push payload URL, an OAuth redirect) is built from
 * `appOrigin()`, which resolves to the real origin the app is running on and
 * falls back to the production origin when there is no window (SSR / worker).
 *
 * Local development on http://localhost:3000 keeps working because
 * `window.location.origin` is used verbatim while the host is a known dev host.
 */

/** The single production origin for Gayze. */
export const PRODUCTION_ORIGIN = 'https://gayze.co.uk';

/**
 * Hosts that are legitimate development origins. Only these are allowed to
 * produce a non-production absolute URL.
 */
const DEV_HOSTNAMES = new Set(['localhost', '127.0.0.1', '0.0.0.0', '[::1]']);

/** True when the given hostname is a local development host. */
export function isDevHostname(hostname: string): boolean {
  if (DEV_HOSTNAMES.has(hostname)) return true;
  // Vite/Arena preview sandboxes and LAN testing.
  if (hostname.endsWith('.local')) return true;
  if (/^192\.168\./.test(hostname) || /^10\./.test(hostname)) return true;
  return false;
}

/** True when the app is currently running on a development host. */
export function isDevEnvironment(): boolean {
  if (typeof window === 'undefined') return false;
  return isDevHostname(window.location.hostname);
}

/**
 * The origin to build absolute Gayze URLs from.
 *
 * In the browser this is always the real current origin, so a user testing on
 * localhost gets localhost links and a user on https://gayze.co.uk gets
 * production links. Outside the browser it is always the production origin —
 * never localhost.
 */
export function appOrigin(): string {
  if (typeof window === 'undefined') return PRODUCTION_ORIGIN;
  return window.location.origin.replace(/\/$/, '');
}

/** Build an absolute Gayze URL for a same-origin path. */
export function appUrl(path: string = '/'): string {
  const normalised = path.startsWith('/') ? path : `/${path}`;
  return `${appOrigin()}${normalised}`;
}
