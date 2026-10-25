import test from 'node:test';
import assert from 'node:assert/strict';
import { takeaways, toCsv, toRows } from '../../src/components/admin/insightsText.ts';

const base: any = {
  generatedAt: '2026-10-25T00:00:00Z', days: 30, timezone: 'Europe/London',
  totals: { members: 10, newInPeriod: 4, activeInPeriod: 5, active1d: 1, active7d: 3, active30d: 5, withPush: 6, verifiedProfiles: 0 },
  signupsByDay: [], activeByDay: [], signInsByHour: [{ hour: 21, n: 3 }], activityByHour: [{ hour: 8, n: 9 }], activityByWeekday: [{ dow: 3, n: 5 }],
  intents: { createdInPeriod: 5, liveNow: 1, byMode: [{ label: 'private', n: 3 }, { label: 'social', n: 2 }], top: [{ label: 'Drinks', n: 5 }], topVariants: [], byHour: [], avgHours: 1.5, travelWilling: 0, canHost: 0 },
  engagement: { gayzesSent: 1, interestsSent: 4, interestsByStatus: [{ label: 'mutual', n: 2 }, { label: 'pending', n: 2 }], conversationsStarted: 1, messagesSent: 5, messagesPerActiveMember: 1, storiesPosted: 0 },
  gatherings: { created: 0, goingTotal: 0, byCategory: [], avgFillPercent: null },
  audience: { ageBands: [], neighbourhoods: [], topInterests: [], profileCompleteness: { withPhoto: 0, withBio: 0, profiles: 0 } },
  notifications: { pushEnabledMembers: 6, optedOutOfPush: 0, categoryOptOuts: { messages: 0, intentActivity: 0, connections: 0, intentExpiry: 0, safety: 0 }, inboxCreated: 0, deliveriesByState: [] },
  funnel: [{ step: 'Signed up', n: 10 }, { step: 'Added a photo', n: 4 }],
  retention: { eligible: 8, returnedAfterDay1: 4, activeLast7d: 3 },
  safety: { reportsInPeriod: 0, openReports: 0, blocks: 0, checkinsInPeriod: 0, suspended: 0 },
};

test('takeaways are derived from the numbers, not hardcoded', () => {
  const t = takeaways(base).join('\n');
  assert.match(t, /10 members; 5 \(50%\)/);
  assert.match(t, /“Drinks” is the most popular intent \(100%/);
  assert.match(t, /50% of interests become mutual/);
  const changed = takeaways({ ...base, intents: { ...base.intents, top: [{ label: 'Meet', n: 2 }] } }).join('\n');
  assert.match(changed, /“Meet” is the most popular/);
});

test('CSV neutralises spreadsheet formulas and quotes correctly', () => {
  const csv = toCsv([['a', '=HYPERLINK("http://x")'], ['b,c', '+1'], ['d', 'line\nbreak']]);
  assert.match(csv, /'=HYPERLINK/);
  assert.match(csv, /'\+1/);
  assert.match(csv, /"b,c"/);
  assert.match(csv, /"line\nbreak"/);
  assert.ok(toRows(base).every((r) => r.length === 3));
});
