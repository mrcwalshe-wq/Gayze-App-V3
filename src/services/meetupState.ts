import type { MeetingProposal } from '../types';

export interface MeetupState { msgId: string; meeting: MeetingProposal; at: number; proposedByMe: boolean; proposalAt: number }
interface Msg { id: string; timestamp: number; meetingData?: MeetingProposal; senderKey: string }

/**
 * The latest state of every meetup in a chat. `proposedByMe` is who wrote the latest proposed or amended event: after a
 * decline, whoever suggests another time or place becomes the proposer, and the other person is the one who answers.
 */
export function latestMeetups(messages: Msg[], isMine: (m: Msg) => boolean): Map<string, MeetupState> {
  const map = new Map<string, MeetupState>();
  for (const m of messages) {
    if (!m.meetingData) continue;
    const prev = map.get(m.meetingData.id);
    const at = m.timestamp;
    const newest = !prev || at >= prev.at;
    const event = m.meetingData.event;
    const isProposal = !event || event === 'proposed' || event === 'amended';
    const newestProposal = isProposal && (!prev || at >= prev.proposalAt);
    map.set(m.meetingData.id, {
      msgId: newest ? m.id : prev!.msgId,
      meeting: newest ? m.meetingData : prev!.meeting,
      at: newest ? at : prev!.at,
      proposedByMe: newestProposal ? isMine(m) : prev ? prev.proposedByMe : isMine(m),
      proposalAt: newestProposal ? at : prev ? prev.proposalAt : -1,
    });
  }
  return map;
}
