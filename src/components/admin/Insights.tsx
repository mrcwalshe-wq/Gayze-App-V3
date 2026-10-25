import React, { useState } from 'react';
import { Download } from 'lucide-react';
import { adminCall, type Insights as InsightsData } from '../../services/adminApi';
import { ErrorState, Spinner, Stat, useAsync } from './ui';
import { Columns, Delta, Funnel, HBars, Trend } from './charts';
import { WEEKDAYS, takeaways, toCsv, toRows } from './insightsText';

export const PERIODS = [7, 30, 90] as const;
const hh = (h: number) => String(h).padStart(2, '0');
const dayLabel = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

export function download(name: string, mime: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const SECTION_KEYS = [
  ['take', 'Key findings'], ['grow', 'Growth and activity'], ['when', 'When people use Gayze'], ['int', 'Intents'], ['eng', 'Engagement'],
  ['fun', 'Funnel and retention'], ['aud', 'Audience'], ['not', 'Notifications'], ['saf', 'Trust and safety'],
] as const;

export const InsightBody: React.FC<{ d: InsightsData; only?: string[] }> = ({ d, only }) => {
  const on = (k: string) => !only || only.includes(k);
  const t = d.totals;
  const hours = (rows: { hour: number; n: number }[]) => rows.map((r) => ({ label: hh(r.hour), n: r.n }));
  const intentTotal = d.intents.top.reduce((a, r) => a + r.n, 0);
  return (
    <div className="ga-stack">
      {on('take') && <section aria-labelledby="in-take"><h2 id="in-take">What the data says</h2>
        <ul className="ga-insights">{takeaways(d).map((x, i) => <li key={i}>{x}</li>)}</ul>
      </section>}

      {on('grow') && <section aria-labelledby="in-grow"><h2 id="in-grow">Growth and activity</h2>
        <div className="ga-grid">
          <Stat label="Members" value={t.members} />
          <Stat label={`New · ${d.days} days`} value={t.newInPeriod} />
          <Stat label="Active · 24 hours" value={t.active1d} />
          <Stat label="Active · 7 days" value={t.active7d} />
          <Stat label="Active · 30 days" value={t.active30d} />
          <Stat label="With push on" value={t.withPush} />
        </div>
        <div className="ga-cols ga-cols--2" style={{ marginTop: 14 }}>
          <div className="ga-panel"><h4>Sign-ups per day</h4><Trend data={d.signupsByDay.map((x) => ({ label: dayLabel(x.day), n: x.n }))} ariaLabel="Sign-ups per day" /></div>
          <div className="ga-panel"><h4>Active members per day</h4><Trend data={d.activeByDay.map((x) => ({ label: dayLabel(x.day), n: x.n }))} ariaLabel="Active members per day" /></div>
        </div>
      </section>}

      {on('when') && <section aria-labelledby="in-when"><h2 id="in-when">When people use Gayze</h2>
        <div className="ga-cols ga-cols--2">
          <div className="ga-panel"><h4>Sign-ins by hour ({d.timezone})</h4><Columns data={hours(d.signInsByHour)} ariaLabel="Sign-ins by hour of day" tickEvery={3} /></div>
          <div className="ga-panel"><h4>Activity by hour ({d.timezone})</h4><Columns data={hours(d.activityByHour)} ariaLabel="Activity by hour of day" tickEvery={3} /></div>
        </div>
        <div className="ga-panel" style={{ marginTop: 14 }}><h4>Activity by day of week</h4>
          <Columns data={d.activityByWeekday.map((x) => ({ label: WEEKDAYS[x.dow], n: x.n }))} ariaLabel="Activity by weekday" />
        </div>
        <p className="ga-note">Activity counts intents set, messages sent, Gayzes and interests sent and stories posted. Sign-ins count sessions started.</p>
      </section>}

      {on('int') && <section aria-labelledby="in-int"><h2 id="in-int">Intents</h2>
        <div className="ga-grid">
          <Stat label={`Set · ${d.days} days`} value={d.intents.createdInPeriod} />
          <Stat label="Live now" value={d.intents.liveNow} />
          <Stat label="Average length (hours)" value={d.intents.avgHours} />
          <Stat label="Can host" value={d.intents.canHost} />
          <Stat label="Will travel" value={d.intents.travelWilling} />
        </div>
        <div className="ga-cols ga-cols--2" style={{ marginTop: 14 }}>
          <div className="ga-panel"><h4>Most popular intents</h4><HBars data={d.intents.top} total={intentTotal} /></div>
          <div className="ga-panel"><h4>Most popular variants</h4><HBars data={d.intents.topVariants} total={intentTotal} /></div>
          <div className="ga-panel"><h4>Private vs social</h4><HBars data={d.intents.byMode} /></div>
          <div className="ga-panel"><h4>When intents are set ({d.timezone})</h4><Columns data={hours(d.intents.byHour)} ariaLabel="Intents set by hour" tickEvery={3} /></div>
        </div>
      </section>}

      {on('eng') && <section aria-labelledby="in-eng"><h2 id="in-eng">Engagement</h2>
        <div className="ga-grid">
          <Stat label="Gayzes sent" value={d.engagement.gayzesSent} />
          <Stat label="Interests sent" value={d.engagement.interestsSent} />
          <Stat label="Conversations started" value={d.engagement.conversationsStarted} />
          <Stat label="Messages sent" value={d.engagement.messagesSent} />
          <Stat label="Messages per active member" value={d.engagement.messagesPerActiveMember} />
          <Stat label="Gatherings hosted" value={d.gatherings.created} />
          <Stat label="Gathering RSVPs" value={d.gatherings.goingTotal} />
          <Stat label="Average gathering fill %" value={d.gatherings.avgFillPercent} />
        </div>
        <div className="ga-cols ga-cols--2" style={{ marginTop: 14 }}>
          <div className="ga-panel"><h4>What happens to interests</h4><HBars data={d.engagement.interestsByStatus} /></div>
          <div className="ga-panel"><h4>Gatherings by type</h4><HBars data={d.gatherings.byCategory} /></div>
        </div>
        <p className="ga-note">Message counts only; content is end-to-end encrypted and never visible here.</p>
      </section>}

      {on('fun') && <section aria-labelledby="in-fun"><h2 id="in-fun">Onboarding funnel and retention</h2>
        <div className="ga-cols ga-cols--2">
          <div className="ga-panel"><h4>From sign-up to first message</h4><Funnel steps={d.funnel} /></div>
          <div className="ga-panel"><h4>Do people come back?</h4>
            <div className="ga-stack" style={{ gap: 14 }}>
              <Delta part={d.retention.returnedAfterDay1} whole={d.retention.eligible} label="Came back after day 1" />
              <Delta part={d.retention.activeLast7d} whole={d.retention.eligible} label="Active in the last 7 days" />
            </div>
            <p className="ga-note">Members who joined more than 7 days ago.</p>
          </div>
        </div>
      </section>}

      {on('aud') && <section aria-labelledby="in-aud"><h2 id="in-aud">Who the members are</h2>
        <div className="ga-cols ga-cols--3">
          <div className="ga-panel"><h4>Age</h4><HBars data={d.audience.ageBands} /></div>
          <div className="ga-panel"><h4>Neighbourhoods</h4><HBars data={d.audience.neighbourhoods} /></div>
          <div className="ga-panel"><h4>Top interests</h4><HBars data={d.audience.topInterests} emptyText="Members have not added interests yet." /></div>
        </div>
        <div className="ga-cols ga-cols--3" style={{ marginTop: 14 }}>
          <div className="ga-panel"><Delta part={d.audience.profileCompleteness.withPhoto} whole={d.audience.profileCompleteness.profiles} label="Profiles with a photo" /></div>
          <div className="ga-panel"><Delta part={d.audience.profileCompleteness.withBio} whole={d.audience.profileCompleteness.profiles} label="Profiles with a bio" /></div>
          <div className="ga-panel"><Delta part={t.verifiedProfiles} whole={d.audience.profileCompleteness.profiles} label="Safety-verified profiles" /></div>
        </div>
        <p className="ga-note">Aggregates only. Sensitive profile fields (such as intimacy preferences) are deliberately never included in these insights.</p>
      </section>}

      {on('not') && <section aria-labelledby="in-not"><h2 id="in-not">Notifications</h2>
        <div className="ga-grid">
          <Stat label="Members with push" value={d.notifications.pushEnabledMembers} />
          <Stat label="Switched push off" value={d.notifications.optedOutOfPush} />
          <Stat label={`Inbox items · ${d.days} days`} value={d.notifications.inboxCreated} />
        </div>
        <div className="ga-cols ga-cols--2" style={{ marginTop: 14 }}>
          <div className="ga-panel"><h4>Switched off by type</h4>
            <HBars data={[
              { label: 'Messages', n: d.notifications.categoryOptOuts.messages }, { label: 'Intent activity', n: d.notifications.categoryOptOuts.intentActivity },
              { label: 'Connections', n: d.notifications.categoryOptOuts.connections }, { label: 'Intent expiry', n: d.notifications.categoryOptOuts.intentExpiry },
              { label: 'Safety', n: d.notifications.categoryOptOuts.safety },
            ].filter((x) => x.n > 0)} emptyText="Nobody has switched any notification type off." />
          </div>
          <div className="ga-panel"><h4>Push delivery results</h4><HBars data={d.notifications.deliveriesByState} /></div>
        </div>
      </section>}

      {on('saf') && <section aria-labelledby="in-saf"><h2 id="in-saf">Trust and safety</h2>
        <div className="ga-grid">
          <Stat label={`Reports · ${d.days} days`} value={d.safety.reportsInPeriod} />
          <Stat label="Open reports" value={d.safety.openReports} />
          <Stat label="Blocks" value={d.safety.blocks} />
          <Stat label={`Safety check-ins · ${d.days} days`} value={d.safety.checkinsInPeriod} />
          <Stat label="Suspended accounts" value={d.safety.suspended} />
        </div>
      </section>}
    </div>
  );
};

export const Insights: React.FC = () => {
  const [days, setDays] = useState<number>(30);
  const { loading, data, error, reload } = useAsync(() => adminCall<InsightsData>('insights', { days, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/London' }), [days]);
  return (
    <div className="ga-stack">
      <div className="ga-toolbar" style={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <div className="ga-seg" role="group" aria-label="Time period">
          {PERIODS.map((p) => <button key={p} type="button" className={days === p ? 'is-on' : ''} aria-pressed={days === p} onClick={() => setDays(p)}>{p} days</button>)}
        </div>
        <button type="button" className="ga-btn" disabled={!data} onClick={() => data && download(`gayze-insights-${days}d.csv`, 'text/csv', toCsv(toRows(data)))}><Download aria-hidden="true" />Download CSV</button>
      </div>
      {loading && !data ? <Spinner label="Crunching the numbers" /> : error || !data ? <ErrorState error={error} onRetry={reload} /> : <InsightBody d={data} />}
    </div>
  );
};
