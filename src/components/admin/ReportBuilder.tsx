import React, { useState } from 'react';
import { Copy, Download, Printer } from 'lucide-react';
import { adminCall, type Insights as InsightsData } from '../../services/adminApi';
import { ErrorState, Spinner, useAsync } from './ui';
import { InsightBody, PERIODS, SECTION_KEYS, download } from './Insights';
import { takeaways, toCsv, toRows } from './insightsText';

/** A branded, print-ready report built from live aggregate data. "Save as PDF" is the browser's
 *  print dialog, so the file is always generated on the owner's device and nothing is uploaded. */
export const ReportBuilder: React.FC = () => {
  const [days, setDays] = useState<number>(30);
  const [title, setTitle] = useState('Gayze performance report');
  const [preparedFor, setPreparedFor] = useState('');
  const [only, setOnly] = useState<string[]>(SECTION_KEYS.map(([k]) => k));
  const [copied, setCopied] = useState(false);
  const { loading, data, error, reload } = useAsync(() => adminCall<InsightsData>('insights', { days, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/London' }), [days]);
  const toggle = (k: string) => setOnly((cur) => (cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]));

  const summary = (d: InsightsData) => `${title}\nGenerated ${new Date(d.generatedAt).toLocaleString()} · last ${d.days} days\n\n${takeaways(d).map((x) => `• ${x}`).join('\n')}`;
  const copy = async (d: InsightsData) => {
    try { await navigator.clipboard.writeText(summary(d)); setCopied(true); window.setTimeout(() => setCopied(false), 2000); } catch { /* clipboard blocked */ }
  };

  return (
    <div className="ga-stack">
      <div className="ga-panel ga-noprint">
        <div className="ga-cols ga-cols--2">
          <div>
            <label className="ga-field"><span>Report title</span><input value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} /></label>
            <label className="ga-field"><span>Prepared for (optional)</span><input value={preparedFor} maxLength={80} onChange={(e) => setPreparedFor(e.target.value)} placeholder="e.g. Investor update, board meeting" /></label>
            <div className="ga-seg" role="group" aria-label="Time period">
              {PERIODS.map((p) => <button key={p} type="button" className={days === p ? 'is-on' : ''} aria-pressed={days === p} onClick={() => setDays(p)}>{p} days</button>)}
            </div>
          </div>
          <fieldset className="ga-fieldset"><legend>Include</legend>
            {SECTION_KEYS.map(([k, label]) => (
              <label key={k} className="ga-check"><input type="checkbox" checked={only.includes(k)} onChange={() => toggle(k)} /><span>{label}</span></label>
            ))}
          </fieldset>
        </div>
        <div className="ga-actions" style={{ marginTop: 12 }}>
          <button type="button" className="ga-btn ga-btn--primary" disabled={!data} onClick={() => window.print()}><Printer aria-hidden="true" />Print / save as PDF</button>
          <button type="button" className="ga-btn" disabled={!data} onClick={() => data && download(`gayze-report-${days}d.csv`, 'text/csv', toCsv(toRows(data)))}><Download aria-hidden="true" />Data (CSV)</button>
          <button type="button" className="ga-btn" disabled={!data} onClick={() => data && void copy(data)}><Copy aria-hidden="true" />{copied ? 'Copied' : 'Copy summary'}</button>
        </div>
        <p className="ga-note">In the print dialog choose “Save as PDF”. Turn on “Background graphics” for the full branding.</p>
      </div>

      {loading && !data ? <Spinner label="Building the report" /> : error || !data ? <ErrorState error={error} onRetry={reload} /> : (
        <article className="ga-report" aria-label="Report preview">
          <header className="ga-report__cover">
            <img src="/brand/gayze-nav-v3.svg" alt="GAYZE" width={112} height={56} />
            <div>
              <h1>{title || 'Gayze performance report'}</h1>
              <p>{preparedFor ? `Prepared for ${preparedFor} · ` : ''}Last {data.days} days · generated {new Date(data.generatedAt).toLocaleString(undefined, { dateStyle: 'long', timeStyle: 'short' })}</p>
              <p className="ga-report__tag">Real Intent. Real Time.</p>
            </div>
          </header>
          <InsightBody d={data} only={only} />
          <footer className="ga-report__foot">
            <b>How to read this report.</b> Figures come straight from the production database at the time shown. “Active” means a member did something in the app (set an intent, sent a message, Gayze or interest, or posted a story). Everything is an aggregate: no individual’s data, message content or sensitive profile field appears. Small numbers move quickly while the community is young; read trends over weeks, not days.
          </footer>
        </article>
      )}
    </div>
  );
};
