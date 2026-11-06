import type { CallLine, MeetingEvent, MeetingProposal, VoiceNote } from '../types';

/**
 * What goes inside the encrypted message body. Plain text stays plain text. A photo or a meetup update is JSON:
 * {"text", "mediaUrl", "meeting"}. `mediaUrl` is always present (null when empty) so app versions that predate meetups
 * still show the text and ignore the rest, instead of showing raw JSON.
 */
export interface DecodedPayload { text: string; mediaUrl?: string; meeting?: MeetingProposal; call?: CallLine; note?: VoiceNote }

const EVENT_STATUS: Record<MeetingEvent, MeetingProposal['status']> = {
  proposed: 'proposed', amended: 'proposed', accepted: 'accepted', declined: 'declined', cancelled: 'cancelled',
};
const EVENTS = Object.keys(EVENT_STATUS) as MeetingEvent[];

export function encodePayload(text: string, mediaUrl?: string, meeting?: MeetingProposal, call?: CallLine, note?: VoiceNote): string {
  if (!mediaUrl && !meeting && !call && !note) return text;
  return JSON.stringify({
    text, mediaUrl: mediaUrl ?? null,
    ...(note ? { note: { kind: note.kind, mime: note.mime, data: note.data, seconds: note.seconds } } : {}),
    ...(call ? { call: { id: call.id, callType: call.callType, outcome: call.outcome } } : {}),
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

export function sanitizeCall(raw: unknown): CallLine | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const c = raw as Record<string, unknown>;
  const id = str(c.id, 64);
  if (!id || (c.callType !== 'audio' && c.callType !== 'video')) return undefined;
  return { id, callType: c.callType, outcome: c.outcome === 'declined' ? 'declined' : 'unanswered' };
}

export const MAX_NOTE_CHARS = 900_000;
const NOTE_MIME = /^(audio\/(webm|mp4|ogg|aac|mpeg)|video\/(webm|mp4))$/;
/** A peer's voice message or video note is untrusted input: only known media types, a bounded size and a real data URL are accepted. */
export function sanitizeNote(raw: unknown): VoiceNote | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const n = raw as Record<string, unknown>;
  if (n.kind !== 'audio' && n.kind !== 'video') return undefined;
  if (typeof n.data !== 'string' || n.data.length > MAX_NOTE_CHARS) return undefined;
  const m = /^data:([a-z0-9]+\/[a-z0-9]+)(?:;codecs=[a-z0-9.,]+)?;base64,[A-Za-z0-9+/=]+$/i.exec(n.data);
  if (!m || !NOTE_MIME.test(m[1].toLowerCase()) || !m[1].toLowerCase().startsWith(n.kind + '/')) return undefined;
  const seconds = typeof n.seconds === 'number' && Number.isFinite(n.seconds) ? Math.max(1, Math.min(120, Math.round(n.seconds))) : 1;
  return { kind: n.kind, mime: m[1].toLowerCase(), data: n.data, seconds };
}

/** The line older app versions show for a voice message or video note. */
export function noteLineText(note: VoiceNote): string {
  return note.kind === 'video' ? 'Video note' : 'Voice message';
}

/** The line older app versions show for an unanswered call. */
export function callLineText(call: CallLine): string {
  return `Unanswered ${call.callType} call`;
}

export function decodePayload(decrypted: string, at: number): DecodedPayload {
  if (decrypted.startsWith('{"') && (decrypted.includes('"mediaUrl"') || decrypted.includes('"meeting"') || decrypted.includes('"call"') || decrypted.includes('"note"'))) {
    try {
      const parsed = JSON.parse(decrypted);
      if (parsed && typeof parsed === 'object' && typeof parsed.text === 'string') {
        return { text: parsed.text, mediaUrl: typeof parsed.mediaUrl === 'string' && parsed.mediaUrl ? parsed.mediaUrl : undefined, meeting: sanitizeMeeting(parsed.meeting, at), call: sanitizeCall(parsed.call), note: sanitizeNote(parsed.note) };
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
