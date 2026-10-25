import type { Insights, Labelled } from '../../services/adminApi';

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);
const hourLabel = (h: number) => `${String(h).padStart(2, '0')}:00`;
export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const peak = <T extends { n: number }>(rows: T[]): T | null => rows.reduce<T | null>((best, r) => (r.n > 0 && (!best || r.n > best.n) ? r : best), null);

/** Plain-English findings derived only from the aggregate numbers. */
export function takeaways(d: Insights): string[] {
  const out: string[] = [];
  const t = d.totals;
  if (t.members > 0) out.push(`${t.members.toLocaleString()} members; ${t.activeInPeriod.toLocaleString()} (${pct(t.activeInPeriod, t.members)}%) were active in the last ${d.days} days and ${t.active7d.toLocaleString()} in the last 7.`);
  if (t.newInPeriod > 0) out.push(`${t.newInPeriod.toLocaleString()} people joined in the last ${d.days} days.`);
  const hr = peak(d.activityByHour.map((r) => ({ ...r })));
  if (hr) out.push(`Busiest hour is ${hourLabel(hr.hour)} (${d.timezone}); ${peak(d.signInsByHour) ? `most sign-ins happen around ${hourLabel(peak(d.signInsByHour)!.hour)}.` : 'no sign-in pattern yet.'}`);
  const wd = peak(d.activityByWeekday);
  if (wd) out.push(`${WEEKDAYS[wd.dow]} is the most active day of the week.`);
  const top = d.intents.top[0];
  const intentTotal = d.intents.top.reduce((a, r) => a + r.n, 0);
  if (top) out.push(`“${top.label}” is the most popular intent (${pct(top.n, intentTotal)}% of intents set).`);
  const mode = d.intents.byMode;
  const modeTotal = mode.reduce((a, r) => a + r.n, 0);
  if (modeTotal > 0 && mode[0]) out.push(`${pct(mode[0].n, modeTotal)}% of intents are ${mode[0].label}-mode.`);
  if (d.intents.avgHours) out.push(`The average intent runs ${d.intents.avgHours} hours.`);
  const r = d.retention;
  if (r.eligible > 0) out.push(`${pct(r.returnedAfterDay1, r.eligible)}% of members who joined over a week ago came back after their first day; ${pct(r.activeLast7d, r.eligible)}% were active in the last 7 days.`);
  const f = d.funnel;
  if (f.length > 1 && f[0].n > 0) {
    let worst = 1, worstKept = 101;
    for (let i = 1; i < f.length; i++) { const kept = pct(f[i].n, f[i - 1].n); if (f[i - 1].n > 0 && kept < worstKept) { worstKept = kept; worst = i; } }
    if (worstKept <= 100) out.push(`Biggest drop-off: “${f[worst - 1].step}” to “${f[worst].step}” keeps ${worstKept}% — the best place to improve onboarding.`);
  }
  if (t.members > 0) out.push(`${pct(t.withPush, t.members)}% of members have push notifications on a device.`);
  const mutual = d.engagement.interestsByStatus.find((x) => x.label === 'mutual');
  const interestTotal = d.engagement.interestsByStatus.reduce((a, x) => a + x.n, 0);
  if (mutual && interestTotal > 0) out.push(`${pct(mutual.n, interestTotal)}% of interests become mutual connections.`);
  return out;
}

/** Flat rows (section, metric, value) for CSV export. */
export function toRows(d: Insights): string[][] {
  const rows: string[][] = [['Section', 'Metric', 'Value']];
  const add = (section: string, metric: string, value: string | number | null | undefined) => rows.push([section, metric, value === null || value === undefined ? '' : String(value)]);
  const list = (section: string, items: Labelled[]) => items.forEach((i) => add(section, i.label, i.n));
  add('Report', 'Generated', d.generatedAt); add('Report', 'Period (days)', d.days); add('Report', 'Timezone', d.timezone);
  (Object.entries(d.totals) as [string, number][]).forEach(([k, v]) => add('Members', k, v));
  d.signupsByDay.forEach((x) => add('Sign-ups by day', x.day, x.n));
  d.activeByDay.forEach((x) => add('Active members by day', x.day, x.n));
  d.signInsByHour.forEach((x) => add('Sign-ins by hour', hourLabel(x.hour), x.n));
  d.activityByHour.forEach((x) => add('Activity by hour', hourLabel(x.hour), x.n));
  d.activityByWeekday.forEach((x) => add('Activity by weekday', WEEKDAYS[x.dow], x.n));
  add('Intents', 'Created in period', d.intents.createdInPeriod); add('Intents', 'Live now', d.intents.liveNow);
  add('Intents', 'Average length (hours)', d.intents.avgHours); add('Intents', 'Can host', d.intents.canHost); add('Intents', 'Willing to travel', d.intents.travelWilling);
  list('Intents by mode', d.intents.byMode); list('Top intents', d.intents.top); list('Top intent variants', d.intents.topVariants);
  d.intents.byHour.forEach((x) => add('Intents set by hour', hourLabel(x.hour), x.n));
  (Object.entries(d.engagement) as [string, unknown][]).forEach(([k, v]) => { if (typeof v === 'number' || v === null) add('Engagement', k, v as number | null); });
  list('Interest outcomes', d.engagement.interestsByStatus);
  add('Gatherings', 'Created', d.gatherings.created); add('Gatherings', 'Going (RSVPs)', d.gatherings.goingTotal); add('Gatherings', 'Average fill %', d.gatherings.avgFillPercent);
  list('Gatherings by category', d.gatherings.byCategory);
  list('Age bands', d.audience.ageBands); list('Neighbourhoods', d.audience.neighbourhoods); list('Top interests', d.audience.topInterests);
  add('Profiles', 'With photo', d.audience.profileCompleteness.withPhoto); add('Profiles', 'With bio', d.audience.profileCompleteness.withBio); add('Profiles', 'Total', d.audience.profileCompleteness.profiles);
  add('Notifications', 'Members with push', d.notifications.pushEnabledMembers); add('Notifications', 'Opted out of push', d.notifications.optedOutOfPush);
  (Object.entries(d.notifications.categoryOptOuts) as [string, number][]).forEach(([k, v]) => add('Notification opt-outs', k, v));
  list('Push delivery states', d.notifications.deliveriesByState);
  d.funnel.forEach((x) => add('Funnel', x.step, x.n));
  (Object.entries(d.retention) as [string, number][]).forEach(([k, v]) => add('Retention', k, v));
  (Object.entries(d.safety) as [string, number][]).forEach(([k, v]) => add('Safety', k, v));
  return rows;
}

/** RFC 4180 CSV, with a guard against spreadsheet formula injection. */
export function toCsv(rows: string[][]): string {
  const cell = (v: string) => {
    const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return rows.map((r) => r.map(cell).join(',')).join('\r\n');
}
