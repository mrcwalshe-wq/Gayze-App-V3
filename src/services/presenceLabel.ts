export type PresenceTone = 'online' | 'recent' | 'offline';

const MIN = 60_000;

/**
 * What to say about someone's presence. Green is only for "online now"; anyone seen in the last day is amber and says how
 * recently; everyone else is grey.
 */
export function presenceLabel(online: boolean, lastSeenAt: number | undefined, now = Date.now()): { tone: PresenceTone; text: string } {
  if (online) return { tone: 'online', text: 'Online now' };
  if (!lastSeenAt || !Number.isFinite(lastSeenAt)) return { tone: 'offline', text: 'Offline' };
  const age = Math.max(0, now - lastSeenAt);
  if (age < 5 * MIN) return { tone: 'recent', text: 'Active in the last 5 min' };
  if (age < 30 * MIN) return { tone: 'recent', text: 'Active in the last 30 min' };
  if (age < 60 * MIN) return { tone: 'recent', text: 'Active in the last hour' };
  if (age < 24 * 60 * MIN) return { tone: 'recent', text: 'Recently online' };
  return { tone: 'offline', text: `Offline · last seen ${new Date(lastSeenAt).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` };
}
