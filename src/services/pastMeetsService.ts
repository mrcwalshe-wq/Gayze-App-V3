import { supabase } from './supabaseClient';

export type ReliabilityLevel = 'new' | 'building' | 'reliable' | 'highly_reliable';
export interface Reliability { verifiedMeets: number; people: number; score: number | null; level: ReliabilityLevel; }
export interface MeetQr { token: string; expiresAt: number; }
export interface PastMeet { peerId: string; name: string; avatarPath?: string; lastMeetAt: number; meetCount: number; reliability: Reliability; }
export interface RedeemResult { repeat: boolean; peerId: string; peerName: string; peerAvatarPath?: string; mine: Reliability; }

/** Errors the server raises on purpose, turned into words a person can act on. */
const MESSAGES: Record<string, string> = {
  QR_INVALID: 'That code is not valid any more. Ask them to open a fresh one.',
  QR_EXPIRED: 'That code has expired. Ask them to open a fresh one.',
  QR_OWN: 'That is your own code. Ask the other person to show theirs.',
  QR_RATE_LIMIT: 'Too many scans for now. Try again later.',
};
export function pastMeetError(error: unknown): string {
  const text = String((error as { message?: string })?.message ?? error ?? '');
  const key = Object.keys(MESSAGES).find((k) => text.includes(k));
  return key ? MESSAGES[key] : 'That did not work. Check your connection and try again.';
}

const rel = (v: unknown): Reliability => {
  const r = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const level = r.level;
  return {
    verifiedMeets: typeof r.verified_meets === 'number' ? r.verified_meets : 0,
    people: typeof r.people === 'number' ? r.people : 0,
    score: typeof r.score === 'number' ? r.score : null,
    level: level === 'building' || level === 'reliable' || level === 'highly_reliable' ? level : 'new',
  };
};

export async function issueMeetQr(): Promise<MeetQr> {
  if (!supabase) throw new Error('offline');
  const { data, error } = await supabase.rpc('issue_meet_qr');
  if (error) throw error;
  const d = data as { token: string; expires_at: string };
  return { token: d.token, expiresAt: Date.parse(d.expires_at) };
}

export async function redeemMeetQr(token: string): Promise<RedeemResult> {
  if (!supabase) throw new Error('offline');
  const { data, error } = await supabase.rpc('redeem_meet_qr', { p_token: token });
  if (error) throw error;
  const d = data as Record<string, unknown>;
  return { repeat: d.repeat === true, peerId: String(d.peer_id), peerName: String(d.peer_name || 'Gayze member'), peerAvatarPath: typeof d.peer_avatar_path === 'string' ? d.peer_avatar_path : undefined, mine: rel(d.mine) };
}

export async function loadMyReliability(): Promise<Reliability> {
  if (!supabase) return rel(null);
  const { data, error } = await supabase.rpc('reliability_summary', { p_user: null });
  return error ? rel(null) : rel(data);
}

export async function loadPastMeets(): Promise<PastMeet[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc('get_my_past_meets');
  if (error || !Array.isArray(data)) return [];
  return data.map((r: Record<string, unknown>) => ({
    peerId: String(r.peer_id), name: String(r.display_name || 'Gayze member'), avatarPath: typeof r.avatar_path === 'string' ? r.avatar_path : undefined,
    lastMeetAt: Date.parse(String(r.last_meet_at)), meetCount: Number(r.meet_count) || 1, reliability: rel(r.reliability),
  }));
}

export async function revokePastMeet(peerId: string): Promise<boolean> {
  if (!supabase) return false;
  const { data, error } = await supabase.rpc('revoke_past_meet', { p_peer: peerId });
  return !error && data === true;
}

export const LEVEL_LABEL: Record<ReliabilityLevel, string> = { new: 'New', building: 'Building', reliable: 'Reliable', highly_reliable: 'Highly reliable' };
