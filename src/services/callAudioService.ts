let callAudioContext: AudioContext | null = null;

const getCtor = () => window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

export const getCallAudioContext = (): AudioContext | null => {
  if (typeof window === 'undefined') return null;
  const Ctor = getCtor();
  if (!Ctor) return null;
  if (!callAudioContext || callAudioContext.state === 'closed') callAudioContext = new Ctor();
  return callAudioContext;
};

/** Must be called directly from the user's call/accept tap so iOS/Safari grants audio activation. */
export const primeCallAudio = (): void => {
  const ctx = getCallAudioContext();
  if (!ctx) return;
  void ctx.resume().catch(() => undefined);
};

export const closeCallAudio = (): void => {
  const ctx = callAudioContext;
  callAudioContext = null;
  if (ctx) void ctx.close().catch(() => undefined);
};
