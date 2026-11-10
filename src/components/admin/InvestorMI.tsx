import React from 'react';
import { Download, Printer } from 'lucide-react';
import { adminCall, type Frac, type InvestorMI } from '../../services/adminApi';
import { ErrorState, Spinner, useAsync } from './ui';
import { Columns, Funnel, Trend } from './charts';
import { download } from './Insights';

const pct = (f: Frac | undefined) => (f && f.eligible ? Math.round(((f.kept ?? 0) / f.eligible) * 1000) / 10 : null);
const nf = (n: number | null | undefined, d = 0) => (typeof n === 'number' ? n.toLocaleString(undefined, { maximumFractionDigits: d }) : '—');
const dayLabel = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
type Band = Record<'ok' | 'good' | 'great', number>;
/** Where a percentage sits against a16z's consumer-social bands. */
const band = (value: number | null, b: Band): { label: string; tone: 'bad' | 'warn' | 'ok' | 'purple' | 'muted' } => {
  if (value === null) return { label: 'Not enough data', tone: 'muted' };
  if (value >= b.great) return { label: 'Great', tone: 'purple' };
  if (value >= b.good) return { label: 'Good', tone: 'ok' };
  if (value >= b.ok) return { label: 'OK', tone: 'warn' };
  return { label: 'Below OK', tone: 'bad' };
};
const Chip: React.FC<{ tone: string; children: React.ReactNode }> = ({ tone, children }) => <span className={`gi-chip gi-chip--${tone}`}>{children}</span>;

const Kpi: React.FC<{ label: string; value: string; sub?: React.ReactNode; chip?: React.ReactNode }> = ({ label, value, sub, chip }) => (
  <div className="gi-kpi"><span>{label}</span><strong>{value}</strong>{chip}{sub && <small>{sub}</small>}</div>
);

/** A cohort cell: the percentage, shaded by size, with the counts in the tooltip. A cohort of fewer than 5 is marked as a small sample. */
const Cell: React.FC<{ f: Frac; small: boolean }> = ({ f, small }) => {
  const p = pct(f);
  if (p === null) return <td className="gi-cell gi-cell--na" title="Not old enough yet">—</td>;
  return <td className={`gi-cell${small ? ' is-small' : ''}`} style={{ ['--v' as string]: Math.min(100, p) }} title={`${f.kept} of ${f.eligible} members`}>{p}%</td>;
};

function toCsv(d: InvestorMI): string {
  const q = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows: unknown[][] = [
    ['GAYZE investor MI', d.generatedAt], ['Source', 'Aggregate counts from the production database. Nothing is estimated.'], [],
    ['Headline'], ...Object.entries(d.headline).map(([k, v]) => [k, v]), [],
    ['Week', 'New', 'Active', 'Retained', 'Resurrected', 'Churned', 'Quick ratio', 'Partial week'],
    ...d.weekly.map((w) => [w.week, w.new, w.active, w.retained, w.resurrected, w.churned, w.quickRatio, w.partial]), [],
    ['Cohort week', 'Size', 'D1 kept', 'D1 eligible', 'D7 kept', 'D7 eligible', 'D30 kept', 'D30 eligible'],
    ...d.cohorts.map((c) => [c.week, c.size, c.d1.kept, c.d1.eligible, c.d7.kept, c.d7.eligible, c.d30.kept, c.d30.eligible]), [],
    ['Funnel step', 'Members'], ...d.activation.steps.map((s) => [s.step, s.n]), [],
    ['Marketplace'], ...Object.entries(d.marketplace).map(([k, v]) => [k, v]), [],
    ['Adoption'], ...Object.entries(d.adoption).map(([k, v]) => [k, v]), [],
    ['Safety'], ...Object.entries(d.safety).map(([k, v]) => [k, v]),
  ];
  return rows.map((r) => r.map(q).join(',')).join('\n');
}

/** Plain-English findings, written from the numbers, with the sample size stated. */
function narrative(d: InvestorMI): string[] {
  const h = d.headline, out: string[] = [];
  out.push(`${nf(h.members)} members so far. This is an early-stage base, so every percentage below is on small numbers and moves a lot with one person.`);
  if (h.newPrev7d > 0 || h.new7d > 0) out.push(`${nf(h.new7d)} joined in the last 7 days (${nf(h.newPrev7d)} the week before).`);
  if (h.stickinessDauMau !== null) out.push(`Stickiness (average daily users over monthly users) is ${h.stickinessDauMau}%. ${band(h.stickinessDauMau, d.benchmarks.stickiness).label} against consumer-social benchmarks (OK 30, Good 40, Great 50).`);
  const r1 = pct(d.retentionAll.d1), r7 = pct(d.retentionAll.d7), r30 = pct(d.retentionAll.d30);
  if (r1 !== null) out.push(`Day-1 return is ${r1}% (${d.retentionAll.d1.kept} of ${d.retentionAll.d1.eligible}); day 7 is ${r7 ?? 'not yet measurable'}${r7 !== null ? '%' : ''}; day 30 is ${r30 ?? 'not yet measurable'}${r30 !== null ? '%' : ''}. ${d.dataQuality.measuredDays < 14 ? 'Early days are inferred from actions, so these undercount people who only opened the app.' : ''}`.trim());
  const m = d.marketplace;
  if (m.interestsSent30d > 0) out.push(`${Math.round((m.interestsMutual30d / m.interestsSent30d) * 100)}% of interests sent in the last 30 days became mutual (${m.interestsMutual30d} of ${m.interestsSent30d}).`);
  if (m.conversationsStarted30d > 0) out.push(`${Math.round((m.conversationsReplied24h30d / m.conversationsStarted30d) * 100)}% of conversations started in the last 30 days got a reply within 24 hours.`);
  out.push('There is no revenue yet, so revenue, ARPU, CAC and LTV are not shown.');
  return out;
}

export const InvestorMIView: React.FC = () => {
  const s = useAsync(() => adminCall<InvestorMI>('investor.metrics', { weeks: 12 }), []);
  if (s.loading) return <Spinner label="Working out the numbers" />;
  if (s.error || !s.data) return <ErrorState error={s.error} onRetry={s.reload} />;
  const d = s.data, h = d.headline;
  const wow = h.newPrev7d > 0 ? Math.round(((h.new7d - h.newPrev7d) / h.newPrev7d) * 100) : null;
  const sticky = band(h.stickinessDauMau, d.benchmarks.stickiness);
  const adoption = d.adoption, mk = d.marketplace;
  const rate = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : '—');
  const per1k = h.mau > 0 ? ((d.safety.reports30d / h.mau) * 1000).toFixed(1) : '—';
  return (
    <div className="ga-stack gi">
      <div className="gi-bar">
        <p className="ga-note">Generated {new Date(d.generatedAt).toLocaleString()}. Aggregate counts only, straight from the database. Nothing is estimated.</p>
        <div className="gi-actions">
          <button type="button" className="ga-btn" onClick={() => download(`gayze-investor-mi-${d.generatedAt.slice(0, 10)}.csv`, 'text/csv', toCsv(d))}><Download aria-hidden="true" />CSV</button>
          <button type="button" className="ga-btn ga-btn--primary" onClick={() => window.print()}><Printer aria-hidden="true" />Print investor pack</button>
        </div>
      </div>

      <section className="gi-quality" aria-label="About this data">
        <b>How to read this.</b> {d.dataQuality.members} members, so treat every rate as indicative. Daily activity is measured from the app's heartbeat {d.dataQuality.measuredFrom ? `since ${dayLabel(d.dataQuality.measuredFrom)} (${d.dataQuality.measuredDays} day${d.dataQuality.measuredDays === 1 ? '' : 's'})` : 'from now on (no measured days yet)'}; earlier days are inferred from actions. {d.dataQuality.inferredBefore}
      </section>

      <section aria-labelledby="mi-take"><h2 id="mi-take">The story in plain English</h2>
        <ul className="ga-insights">{narrative(d).map((x, i) => <li key={i}>{x}</li>)}</ul>
      </section>

      <section aria-labelledby="mi-kpi"><h2 id="mi-kpi">Headline</h2>
        <div className="gi-kpis">
          <Kpi label="Members" value={nf(h.members)} sub={`${nf(h.new30d)} joined in 30 days`} />
          <Kpi label="New this week" value={nf(h.new7d)} sub={wow === null ? 'No sign-ups the week before' : `${wow >= 0 ? '+' : ''}${wow}% on last week`} />
          <Kpi label="Daily users (7-day average)" value={nf(h.dauAvg7d, 1)} sub={`${nf(h.dauToday)} today`} />
          <Kpi label="Weekly users" value={nf(h.wau)} sub={`${nf(h.mau)} monthly`} />
          <Kpi label="Stickiness (daily / monthly)" value={h.stickinessDauMau === null ? '—' : `${h.stickinessDauMau}%`} chip={<Chip tone={sticky.tone}>{sticky.label}</Chip>} sub="OK 30 · Good 40 · Great 50" />
          <Kpi label="Weekly / monthly" value={h.stickinessWauMau === null ? '—' : `${h.stickinessWauMau}%`} sub="Better fit for a weekly habit" />
        </div>
        <div className="ga-panel" style={{ marginTop: 14 }}><h4>Daily users, last 30 days</h4><Trend data={d.dau30.map((x) => ({ label: dayLabel(x.day), n: x.n }))} ariaLabel="Daily users over 30 days" /></div>
      </section>

      <section aria-labelledby="mi-ret"><h2 id="mi-ret">Retention by sign-up week</h2>
        <p className="ga-note">The share of each week's new members who came back exactly 1, 7 and 30 days after joining (the strict "n-day" measure investors use). Hover a cell for the counts. Pale rows are fewer than 5 members.</p>
        <div className="gi-scroll">
          <table className="gi-table" aria-label="Retention cohorts">
            <thead><tr><th>Joined week of</th><th>Members</th><th>Day 1</th><th>Day 7</th><th>Day 30</th></tr></thead>
            <tbody>
              {d.cohorts.length === 0 && <tr><td colSpan={5}>No cohorts in this window.</td></tr>}
              {d.cohorts.map((c) => (
                <tr key={c.week} className={c.size < 5 ? 'is-small' : ''}><th scope="row">{dayLabel(c.week)}</th><td>{c.size}</td><Cell f={c.d1} small={c.size < 5} /><Cell f={c.d7} small={c.size < 5} /><Cell f={c.d30} small={c.size < 5} /></tr>
              ))}
              <tr className="gi-total"><th scope="row">All members</th><td>{d.dataQuality.members}</td>
                {(['d1', 'd7', 'd30'] as const).map((k) => <td key={k}><b>{pct(d.retentionAll[k]) ?? '—'}{pct(d.retentionAll[k]) !== null ? '%' : ''}</b> <Chip tone={band(pct(d.retentionAll[k]), d.benchmarks[k]).tone}>{band(pct(d.retentionAll[k]), d.benchmarks[k]).label}</Chip></td>)}
              </tr>
            </tbody>
          </table>
        </div>
        <p className="ga-note">Benchmarks: a16z social-app bands, Day 1 {d.benchmarks.d1.ok}/{d.benchmarks.d1.good}/{d.benchmarks.d1.great}%, Day 7 {d.benchmarks.d7.ok}/{d.benchmarks.d7.good}/{d.benchmarks.d7.great}%, Day 30 {d.benchmarks.d30.ok}/{d.benchmarks.d30.good}/{d.benchmarks.d30.great}% (OK/Good/Great). A typical mobile app sees about {d.benchmarks.typicalApp.d1}% / {d.benchmarks.typicalApp.d7}% / {d.benchmarks.typicalApp.d30}% ({d.benchmarks.typicalApp.source}). Investors weigh the shape of the curve and whether it flattens more than any one number.</p>
      </section>

      <section aria-labelledby="mi-grow"><h2 id="mi-grow">Growth accounting, by week</h2>
        <div className="ga-cols ga-cols--2">
          <div className="ga-panel"><h4>Active members per week</h4><Columns data={d.weekly.map((w) => ({ label: dayLabel(w.week), n: w.active }))} ariaLabel="Active members per week" tickEvery={2} /></div>
          <div className="ga-panel"><h4>New members per week</h4><Columns data={d.weekly.map((w) => ({ label: dayLabel(w.week), n: w.new }))} ariaLabel="New members per week" tickEvery={2} /></div>
        </div>
        <div className="gi-scroll" style={{ marginTop: 14 }}>
          <table className="gi-table" aria-label="Weekly growth accounting">
            <thead><tr><th>Week of</th><th>New</th><th>Retained</th><th>Resurrected</th><th>Churned</th><th>Quick ratio</th></tr></thead>
            <tbody>{d.weekly.slice(-8).map((w) => <tr key={w.week}><th scope="row">{dayLabel(w.week)}{w.partial ? ' (so far)' : ''}</th><td>{w.new}</td><td>{w.retained}</td><td>{w.resurrected}</td><td>{w.churned}</td><td>{w.quickRatio ?? '—'}</td></tr>)}</tbody>
          </table>
        </div>
        <p className="ga-note">Retained: active this week and last. Resurrected: active this week, not last, joined earlier. Churned: active last week, not this week. Quick ratio = (new + resurrected) ÷ churned; above 1 means the base is growing. The current week is incomplete, so its churn is overstated.</p>
      </section>

      <section aria-labelledby="mi-act"><h2 id="mi-act">Activation</h2>
        <div className="ga-cols ga-cols--2">
          <div className="ga-panel"><h4>From sign-up to first message</h4><Funnel steps={d.activation.steps} /></div>
          <div className="ga-panel"><h4>How fast people reach the point</h4>
            <div className="gi-kpis gi-kpis--2">
              <Kpi label="Median time to first intent" value={d.activation.medianHoursToFirstIntent === null ? '—' : d.activation.medianHoursToFirstIntent >= 48 ? `${nf(d.activation.medianHoursToFirstIntent / 24, 1)} days` : `${nf(d.activation.medianHoursToFirstIntent, 1)} h`} sub="Setting an intent is the core action" />
              <Kpi label="Median time to first message" value={d.activation.medianHoursToFirstMessage === null ? '—' : `${nf(d.activation.medianHoursToFirstMessage, 1)} h`} />
            </div>
          </div>
        </div>
      </section>

      <section aria-labelledby="mi-mkt"><h2 id="mi-mkt">Marketplace health (last 30 days)</h2>
        <div className="gi-kpis">
          <Kpi label="Live intents right now" value={nf(mk.liveIntentsNow)} sub={`${nf(mk.membersWithIntentLast7d)} members set one in 7 days`} />
          <Kpi label="Interests that became mutual" value={rate(mk.interestsMutual30d, mk.interestsSent30d)} sub={`${mk.interestsMutual30d} of ${mk.interestsSent30d}`} />
          <Kpi label="Conversations answered in 24 h" value={rate(mk.conversationsReplied24h30d, mk.conversationsStarted30d)} sub={`${mk.conversationsReplied24h30d} of ${mk.conversationsStarted30d} started`} />
          <Kpi label="Messages sent" value={nf(mk.messages30d)} sub={h.mau > 0 ? `${nf(mk.messages30d / h.mau, 1)} per monthly user` : undefined} />
          <Kpi label="Gayzes sent" value={nf(mk.gazesSent30d)} />
        </div>
      </section>

      <section aria-labelledby="mi-ad"><h2 id="mi-ad">Feature adoption (last 30 days)</h2>
        <div className="gi-kpis">
          <Kpi label="Calls started" value={nf(adoption.callsStarted30d)} sub={`${rate(adoption.callsAnswered30d, adoption.callsStarted30d)} answered · ${adoption.callUsers30d} members`} />
          <Kpi label="Plans and events created" value={nf(adoption.gatheringsCreated30d)} sub={`${adoption.gatheringRsvps30d} RSVPs`} />
          <Kpi label="Safety check-ins" value={nf(adoption.safetyCheckins30d)} />
          <Kpi label="Private albums" value={nf(adoption.albumsCreated)} sub={`${adoption.albumShares30d} shared`} />
          <Kpi label="Notifications on" value={rate(adoption.pushEnabledMembers, h.members)} sub={`${adoption.pushEnabledMembers} of ${h.members} members`} />
        </div>
      </section>

      <section aria-labelledby="mi-saf"><h2 id="mi-saf">Trust and safety</h2>
        <div className="gi-kpis">
          <Kpi label="Reports (30 days)" value={nf(d.safety.reports30d)} sub={`${per1k} per 1,000 monthly users`} />
          <Kpi label="Open reports" value={nf(d.safety.openReports)} />
          <Kpi label="Blocks" value={nf(d.safety.blocks)} />
          <Kpi label="Suspended accounts" value={nf(d.safety.suspended)} />
        </div>
      </section>

      <section aria-labelledby="mi-rev"><h2 id="mi-rev">Revenue</h2>
        <div className="gi-quality"><b>Not monetised.</b> {d.revenue.note}</div>
      </section>
    </div>
  );
};
