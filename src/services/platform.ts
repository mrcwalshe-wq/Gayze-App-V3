export type CapacitorLike = { isNativePlatform?: () => boolean; getPlatform?: () => string } | undefined;

/** True only inside the iPhone/iPad app. */
export function isIosPlatform(cap: CapacitorLike): boolean {
  try { return Boolean(cap?.isNativePlatform?.()) && cap?.getPlatform?.() === 'ios'; } catch { return false; }
}

/**
 * Kill switch for "Sign in with Apple" in the iPhone app. If it ever has to come out (for example a bad build),
 * set this to false: the Apple button AND the Google button are then both hidden in the iPhone app, because
 * App Review rule 4.8 requires Apple sign-in whenever another social login is offered.
 */
export const APPLE_SIGN_IN_ENABLED = true;

export function appleSignInAvailable(cap: CapacitorLike, enabled: boolean = APPLE_SIGN_IN_ENABLED): boolean {
  return enabled && isIosPlatform(cap);
}

/** Google stays everywhere, except inside the iPhone app when Apple sign-in is not offered there. */
export function googleSignInAllowed(cap: CapacitorLike, enabled: boolean = APPLE_SIGN_IN_ENABLED): boolean {
  return !isIosPlatform(cap) || enabled;
}
