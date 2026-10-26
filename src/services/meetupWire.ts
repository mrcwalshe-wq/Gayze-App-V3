import type { MeetingEvent, MeetingProposal } from '../types';

/**
 * What goes inside the encrypted message body. Plain text stays plain text. A photo or a meetup update is JSON:
 * {"text", "mediaUrl", "meeting"}. `mediaUrl` is always present (null when empty) so app versions that predate meetups
 * still show the text and ignore the rest, instead of showing raw JSON.
 */
export interface DecodedPayload { text: string; mediaUrl?: string; meeting?: MeetingProposal }

const EVENT_STATUS: Record<MeetingEvent, MeetingProposal['status']> = {
  proposed: 'proposed', amended: 'proposed', accepted: 'accepted', declined: 'declined', cancelled: 'cancelled',
};
const EVENTS = Object.keys(EVENT_STATUS) as MeetingEvent[];

export function encodePayload(text: string, mediaUrl?: string, meeting?: MeetingProposal): string {
  if (!mediaUrl && !meeting) return text;
  return JSON.stringify({
    text, mediaUrl: mediaUrl ?? null,
    ...(meeting ? { meeting: {
      id: meeting.id, venueName: meeting.venueName, address: meeting.address, timeStr: meeting.timeStr,
      event: meeting.event ?? 'proposed', isSafeHaven: meeting.isSafeHaven, safetyTimerDurationMinutes: meeting.safetyTimerDurationMinutes,
      ...(Number.isFinite(meeting.lat) && Number.isFinite(meeting.lng) ? { lat: meeting.lat, lng: meeting.lng } : {}),
    } } : {}),
  });
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max) : '');
const coord = (v: unknown, limit: number) => (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= limit ? v : undefined);

/** Everything in a peer's meetup is untrusted input: strings are trimmed and capped, coordinates must be real numbers. */
export function sanitizeMeeting(raw: unknown, at: number): MeetingProposal | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const m = raw as Record<string, unknown>;
  const id = str(m.id, 64);
  const venueName = str(m.venueName, 120);
  const event = EVENTS.includes(m.event as MeetingEvent) ? (m.event as MeetingEvent) : 'proposed';
  if (!id || !venueName) return undefined;
  const lat = coord(m.lat, 90), lng = coord(m.lng, 180);
  const minutes = typeof m.safetyTimerDurationMinutes === 'number' && m.safetyTimerDurationMinutes > 0 ? Math.min(480, Math.round(m.safetyTimerDurationMinutes)) : 60;
  return {
    id, venueName, address: str(m.address, 200), timeStr: str(m.timeStr, 80), timestamp: at, event, status: EVENT_STATUS[event],
    isSafeHaven: m.isSafeHaven === true, safetyTimerDurationMinutes: minutes,
    ...(lat !== undefined && lng !== undefined ? { lat, lng } : {}),
  };
}

export function decodePayload(decrypted: string, at: number): DecodedPayload {
  if (decrypted.startsWith('{"') && (decrypted.includes('"mediaUrl"') || decrypted.includes('"meeting"'))) {
    try {
      const parsed = JSON.parse(decrypted);
      if (parsed && typeof parsed === 'object' && typeof parsed.text === 'string') {
        return { text: parsed.text, mediaUrl: typeof parsed.mediaUrl === 'string' && parsed.mediaUrl ? parsed.mediaUrl : undefined, meeting: sanitizeMeeting(parsed.meeting, at) };
      }
    } catch { /* not ours: show as text */ }
  }
  return { text: decrypted };
}

/** The line that appears in the chat for each event. */
export function meetingEventText(event: MeetingEvent, venue: string, when: string): string {
  switch (event) {
    case 'proposed': return `Safe meetup invitation: let's meet at ${venue}, ${when}.`;
    case 'amended': return `Meetup updated: ${venue}, ${when}.`;
    case 'accepted': return `Accepted — see you at ${venue}, ${when}.`;
    case 'declined': return `Can't make it to ${venue}.`;
    case 'cancelled': return `Meetup cancelled: ${venue}, ${when}.`;
  }
}
