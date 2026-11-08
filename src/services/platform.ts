export type CapacitorLike = { isNativePlatform?: () => boolean; getPlatform?: () => string } | undefined;

/** True only inside the iPhone/iPad app. */
export function isIosPlatform(cap: CapacitorLike): boolean {
  try { return Boolean(cap?.isNativePlatform?.()) && cap?.getPlatform?.() === 'ios'; } catch { return false; }
}
