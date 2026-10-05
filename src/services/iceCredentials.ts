/** Runtime credentials only. Provider API keys/shared secrets never belong here. */
export interface IceResponse { iceServers?: RTCIceServer[]; expiresAt?: number | string; expires_at?: number | string; ttl?: number; ttlSeconds?: number; }

export function iceExpiry(response: IceResponse, requestedAt: number): number | undefined {
  const value = response.expiresAt ?? response.expires_at;
  if (typeof value === 'number' && Number.isFinite(value)) return value < 1e12 ? value * 1000 : value;
  if (typeof value === 'string') {
    const numeric = Number(value);
    const parsed = Number.isFinite(numeric) ? (numeric < 1e12 ? numeric * 1000 : numeric) : Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  const ttl = response.ttlSeconds ?? response.ttl;
  return typeof ttl === 'number' && Number.isFinite(ttl) && ttl > 0 ? requestedAt + ttl * 1000 : undefined;
}

export class IceCredentialCache {
  private cached?: RTCIceServer[];
  private refreshAt = 0;
  private pending?: Promise<RTCIceServer[]>;
  private generation = 0;
  constructor(private fetch: () => Promise<IceResponse>, private now = () => Date.now()) {}
  get nextRefreshAt() { return this.refreshAt; }
  clear() { ++this.generation; this.cached = undefined; this.refreshAt = 0; this.pending = undefined; }
  async get(force = false): Promise<RTCIceServer[]> {
    if (!force && this.cached && this.now() < this.refreshAt) return this.cached;
    if (this.pending) return this.pending;
    const generation = this.generation;
    const requestedAt = this.now();
    const pending = (async () => {
      const response = await this.fetch();
      if (generation !== this.generation) throw new Error('Call credentials were invalidated');
      if (!Array.isArray(response.iceServers) || !response.iceServers.length) throw new Error('ICE configuration unavailable');
      const servers = response.iceServers.map((server) => {
        if (!server || typeof server !== 'object') throw new Error('Invalid ICE configuration');
        const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
        if (!urls.length || urls.some((url) => typeof url !== 'string' || !/^(stun|stuns|turn|turns):/.test(url))) throw new Error('Invalid ICE configuration');
        if (urls.some((url) => /^turns?:/.test(url)) && (typeof server.username !== 'string' || !server.username || typeof server.credential !== 'string' || !server.credential)) throw new Error('Missing relay credential');
        // Only fields the browser needs; never retain provider metadata/secrets.
        return { urls: server.urls, ...(server.username ? { username: server.username } : {}), ...(server.credential ? { credential: server.credential } : {}) };
      });
      const expiresAt = iceExpiry(response, requestedAt);
      if (expiresAt !== undefined && expiresAt <= this.now() + 5000) throw new Error('Relay credentials already expiring');
      const ttl = expiresAt === undefined ? 0 : expiresAt - requestedAt;
      // Refresh with 20% / at most 60 seconds remaining. Without expiry metadata
      // never reuse credentials for another negotiation; ask the same endpoint.
      this.refreshAt = expiresAt === undefined ? this.now() : expiresAt - Math.min(60_000, ttl * 0.2);
      this.cached = expiresAt === undefined ? undefined : servers;
      return servers;
    })();
    this.pending = pending;
    try { return await pending; }
    finally { if (this.pending === pending) this.pending = undefined; }
  }
}
