import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, ChevronLeft, ChevronRight, Loader2, LogOut, RefreshCw, Search, ShieldAlert, ShieldCheck, X } from 'lucide-react';
import { getAuthRedirectUrl, supabase } from '../services/supabaseClient';
import {
  AdminApiError, adminCall, type AccountDetail, type AccountRow, type AuditRow, type Metrics, type Page, type ReportRow,
} from '../services/adminApi';
import { Insights } from './admin/Insights';
import { Broadcasts, Composer } from './admin/Broadcasts';
import { ReportBuilder } from './admin/ReportBuilder';
import { Dialog, Empty, ErrorState, Pill, ReauthBar, Spinner, Stat, fmt, humanise, num, useAsync } from './admin/ui';
import '../admin.css';

type Tab = 'dashboard' | 'insights' | 'accounts' | 'broadcasts' | 'investor' | 'reports' | 'health' | 'audit';
const TABS: { id: Tab; label: string }[] = [
  { id: 'dashboard', label: 'Dashboard' }, { id: 'insights', label: 'Insights' }, { id: 'accounts', label: 'Accounts' },
  { id: 'broadcasts', label: 'Broadcasts' }, { id: 'investor', label: 'Report builder' }, { id: 'reports', label: 'Moderation' },
  { id: 'health', label: 'Health' }, { id: 'audit', label: 'Audit log' },
];

const Dashboard: React.FC = () => {
  const { loading, data, error, reload } = useAsync(() => adminCall<Metrics>('metrics'), []);
  if (loading && !data) return <Spinner label="Loading metrics" />;
  if (error || !data) return <ErrorState error={error} onRetry={reload} />;
  const m = data;
  const deliveries = Object.entries(m.notifications?.deliveriesLast24h ?? {});
  return (
    <div className="ga-stack">
      <p className="ga-note">Live from the production database · generated {fmt(m.generatedAt)} <button type="button" className="ga-link" onClick={reload}>Refresh</button></p>
      <section aria-labelledby="g-reg"><h2 id="g-reg">Registrations</h2>
        <div className="ga-grid">
          <Stat label="Total accounts" value={m.registrations?.total} />
          <Stat label="New · 24 hours" value={m.registrations?.last24h} />
          <Stat label="New · 7 days" value={m.registrations?.last7d} />
          <Stat label="New · 30 days" value={m.registrations?.last30d} />
          <Stat label="Email unverified" value={m.registrations?.unverified} hint={m.registrations ? `${m.registrations.total - m.registrations.unverified} verified` : undefined} />
        </div>
      </section>
      <section aria-labelledby="g-act"><h2 id="g-act">Active users</h2>
        <div className="ga-grid">
          <Stat label="Seen · 24 hours" value={m.active?.last24h} />
          <Stat label="Seen · 7 days" value={m.active?.last7d} />
        </div>
        <p className="ga-note">“Active” means a profile whose last-seen time falls inside the window. Members who hide their online status, or who have not opened the app since presence tracking began, are undercounted.</p>
      </section>
      <section aria-labelledby="g-int"><h2 id="g-int">Intents</h2>
        <div className="ga-grid">
          <Stat label="Live now" value={m.intents?.live} />
          <Stat label="Paused" value={m.intents?.paused} />
          <Stat label="Expired (all time)" value={m.intents?.expired} />
          <Stat label="Created · 24 hours" value={m.intents?.createdLast24h} />
        </div>
      </section>
      <section aria-labelledby="g-msg"><h2 id="g-msg">Messaging</h2>
        <div className="ga-grid">
          <Stat label="Conversations" value={m.messaging?.conversations} />
          <Stat label="Messages · 24 hours" value={m.messaging?.messagesLast24h} />
          <Stat label="Messages · 7 days" value={m.messaging?.messagesLast7d} />
        </div>
        <p className="ga-note">Counts only. Message content is end-to-end encrypted and is never shown here. Call volume is not recorded server-side, so it is not reported.</p>
      </section>
      <section aria-labelledby="g-mod"><h2 id="g-mod">Safety</h2>
        <div className="ga-grid">
          <Stat label="Open reports" value={m.moderation?.openReports} />
          <Stat label="All reports" value={m.moderation?.totalReports} />
          <Stat label="Suspended accounts" value={m.moderation?.suspended} />
          <Stat label="Blocks" value={m.moderation?.blocks} />
        </div>
      </section>
      <section aria-labelledby="g-push"><h2 id="g-push">Notifications and jobs</h2>
        <div className="ga-grid">
          <Stat label="Push subscriptions" value={m.notifications?.pushSubscriptions} />
          <Stat label="Inbox items · 24 hours" value={m.notifications?.inboxLast24h} />
          <Stat label="Scheduled job runs · 24 hours" value={m.jobs?.cronRunsLast24h} />
          <Stat label="Failed job runs · 24 hours" value={m.jobs?.cronFailedLast24h} />
        </div>
        <div className="ga-chips" aria-label="Push deliveries in the last 24 hours by state">
          {deliveries.length === 0 ? <span className="ga-note">No push deliveries in the last 24 hours.</span>
            : deliveries.map(([state, n]) => <Pill key={state} tone={state === 'accepted' ? 'ok' : 'warn'}>{state} · {n}</Pill>)}
        </div>
        <p className="ga-note">“Accepted” means the push service accepted the message. It does not prove it reached or was shown on a device.</p>
      </section>
    </div>
  );
};

/* -------------------------------------------------------------------- Accounts */

type Action = 'suspend' | 'reinstate' | 'revoke' | 'reset' | 'resend' | 'delete';

const AccountDialog: React.FC<{ id: string; onClose: () => void; onChanged: () => void }> = ({ id, onClose, onChanged }) => {
  const { loading, data, error, reload } = useAsync(() => adminCall<AccountDetail>('accounts.detail', { userId: id }), [id]);
  const [action, setAction] = useState<Action | null>(null);
  const [reason, setReason] = useState('');
  const [typed, setTyped] = useState('');
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const [reauth, setReauth] = useState(false);
  const [photos, setPhotos] = useState<null | { photoRows: number; missingFiles: unknown[]; avatarSet: boolean; avatarMissing: boolean }>(null);

  const reset = () => { setAction(null); setReason(''); setTyped(''); setAck(false); };
  const run = async () => {
    if (!action || !data) return;
    setBusy(true); setNotice(null); setReauth(false);
    try {
      if (action === 'suspend') await adminCall('accounts.suspend', { userId: id, reason, confirm: true });
      if (action === 'reinstate') await adminCall('accounts.reinstate', { userId: id, confirm: true });
      if (action === 'revoke') await adminCall('accounts.revokeSessions', { userId: id, confirm: true });
      if (action === 'reset') await adminCall('accounts.sendPasswordReset', { userId: id });
      if (action === 'resend') await adminCall('accounts.resendVerification', { userId: id });
      if (action === 'delete') await adminCall('accounts.delete', { userId: id, confirmEmail: typed });
      const done: Record<Action, string> = {
        suspend: 'Account suspended. Sign-in is blocked and active sessions were ended.', reinstate: 'Account reinstated. They can sign in again.',
        revoke: 'Sessions ended. Their devices must sign in again.', reset: 'Password reset email requested. Delivery is not confirmed by this action.',
        resend: 'Verification email requested. Delivery is not confirmed by this action.', delete: 'Account deleted.',
      };
      setNotice({ tone: 'ok', text: done[action] });
      reset(); onChanged();
      if (action === 'delete') { setTimeout(onClose, 1200); } else reload();
    } catch (e) {
      if (e instanceof AdminApiError && e.code === 'reauth_required') setReauth(true);
      else setNotice({ tone: 'bad', text: humanise(e) });
    } finally { setBusy(false); }
  };

  const checkPhotos = async () => {
    setBusy(true);
    try { setPhotos(await adminCall('accounts.photoProblems', { userId: id })); } catch (e) { setNotice({ tone: 'bad', text: humanise(e) }); } finally { setBusy(false); }
  };

  const [messaging, setMessaging] = useState(false);
  const isAdmin = Boolean(data?.role);
  const suspended = Boolean(data?.restriction);
  const needsReason = action === 'suspend';
  const canConfirm = !busy && (action === 'suspend' ? reason.trim().length >= 3 && ack : action === 'delete' ? typed.trim().toLowerCase() === (data?.email ?? '').toLowerCase() && Boolean(data?.email) : action === 'reinstate' || action === 'revoke' ? ack : true);

  return (
    <Dialog title="Account" onClose={onClose} wide>
      {loading && !data ? <Spinner /> : error || !data ? <ErrorState error={error} onRetry={reload} /> : (
        <div className="ga-stack">
          <div className="ga-head">
            <div><h3 className="ga-name">{data.profile?.displayName || 'No display name'}</h3><p className="ga-mono">{data.email ?? 'No email'}</p></div>
            <div className="ga-chips">
              <Pill tone={suspended ? 'bad' : 'ok'}>{suspended ? 'Suspended' : 'Active'}</Pill>
              <Pill tone={data.emailVerifiedAt ? 'ok' : 'warn'}>{data.emailVerifiedAt ? 'Email verified' : 'Email unverified'}</Pill>
              {isAdmin && <Pill tone="purple">{data.role}</Pill>}
            </div>
          </div>
          {notice && <div className={`ga-banner ga-banner--${notice.tone}`} role={notice.tone === 'bad' ? 'alert' : 'status'}>{notice.text}</div>}
          {reauth && <ReauthBar />}
          <dl className="ga-kv">
            <div><dt>User ID</dt><dd className="ga-mono">{data.id}</dd></div>
            <div><dt>Created</dt><dd>{fmt(data.createdAt)}</dd></div>
            <div><dt>Last sign-in</dt><dd>{fmt(data.lastSignInAt)}</dd></div>
            <div><dt>Providers</dt><dd>{data.providers.length ? data.providers.map((p) => p.provider).join(', ') : '—'}</dd></div>
            <div><dt>Profile</dt><dd>{data.profile ? `${data.profile.hasAvatar ? 'Photo' : 'No photo'} · ${data.profile.hasBio ? 'Bio' : 'No bio'} · ${data.profile.photos} photos${data.profile.age ? ` · ${data.profile.age}` : ''}` : 'No profile row'}</dd></div>
            <div><dt>Last seen</dt><dd>{data.profile?.hideOnlineStatus ? 'Hidden by member' : fmt(data.profile?.lastSeenAt)}</dd></div>
            {suspended && <div><dt>Suspension</dt><dd>{data.restriction?.reason || 'No reason recorded'} · {fmt(data.restriction?.createdAt)}</dd></div>}
          </dl>
          <div className="ga-grid ga-grid--tight">
            <Stat label="Live intents" value={data.counts.liveIntents} />
            <Stat label="Conversations" value={data.counts.conversations} />
            <Stat label="Push devices" value={data.counts.pushSubscriptions} />
            <Stat label="Reports against" value={data.counts.reportsAgainst} />
            <Stat label="Reports filed" value={data.counts.reportsFiled} />
            <Stat label="Blocked by" value={data.counts.blockedBy} />
          </div>
          {data.reports.length > 0 && (
            <section><h4>Reports against this account</h4>
              <ul className="ga-list">{data.reports.map((r) => <li key={r.id}><Pill tone={r.status === 'open' ? 'warn' : 'muted'}>{r.status}</Pill> {r.reason || 'No reason'} <small>{fmt(r.createdAt)}</small></li>)}</ul>
            </section>
          )}
          <section><h4>Profile photos</h4>
            {photos ? (
              <p className="ga-note">{photos.photoRows} photo rows · {photos.missingFiles.length} missing from storage{photos.avatarSet ? (photos.avatarMissing ? ' · avatar file missing' : ' · avatar OK') : ' · no avatar set'}</p>
            ) : <button type="button" className="ga-btn" onClick={() => void checkPhotos()} disabled={busy}>Check for missing photo files</button>}
          </section>

          {!isAdmin && !action && (
            <section><h4>Actions</h4>
              <div className="ga-actions">
                {suspended ? <button type="button" className="ga-btn" onClick={() => setAction('reinstate')}>Reinstate</button>
                  : <button type="button" className="ga-btn ga-btn--warn" onClick={() => setAction('suspend')}>Suspend…</button>}
                {!suspended && <button type="button" className="ga-btn" onClick={() => setMessaging(true)}>Send message…</button>}
                <button type="button" className="ga-btn" onClick={() => setAction('revoke')}>End sessions…</button>
                <button type="button" className="ga-btn" onClick={() => setAction('reset')}>Send password reset</button>
                {!data.emailVerifiedAt && <button type="button" className="ga-btn" onClick={() => setAction('resend')}>Resend verification</button>}
                <button type="button" className="ga-btn ga-btn--danger" onClick={() => setAction('delete')}>Delete account…</button>
              </div>
            </section>
          )}
          {isAdmin && <p className="ga-note">Administrator accounts cannot be managed from here.</p>}

          {action && (
            <form className="ga-confirm" onSubmit={(e) => { e.preventDefault(); if (canConfirm) void run(); }} aria-label="Confirm action">
              <h4>{{ suspend: 'Suspend this account?', reinstate: 'Reinstate this account?', revoke: 'End all sessions?', reset: 'Send a password reset email?', resend: 'Resend the verification email?', delete: 'Permanently delete this account?' }[action]}</h4>
              <p className="ga-note">{{
                suspend: 'They are signed out everywhere, cannot sign in, lose push notifications, and their live intents are paused. Reinstating does not restore the paused intents or notifications.',
                reinstate: 'They can sign in again. Paused intents stay paused and they must re-enable notifications.',
                revoke: 'Every device is signed out. Their current access can last briefly until it expires.',
                reset: 'An email goes to the address on the account. This does not confirm it was delivered.',
                resend: 'An email goes to the address on the account. This does not confirm it was delivered.',
                delete: 'This removes their sign-in, profile and photos. It cannot be undone. Reports and audit records are kept.',
              }[action]}</p>
              {needsReason && <label className="ga-field"><span>Reason (kept on the account record)</span><textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} rows={3} required /></label>}
              {action === 'delete' && <label className="ga-field"><span>Type <b className="ga-mono">{data.email}</b> to confirm</span><input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} /></label>}
              {(action === 'suspend' || action === 'reinstate' || action === 'revoke') && (
                <label className="ga-check"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /><span>I understand the effect on this member.</span></label>
              )}
              <div className="ga-actions">
                <button type="button" className="ga-btn" onClick={reset} disabled={busy}>Cancel</button>
                <button type="submit" className={`ga-btn ${action === 'delete' ? 'ga-btn--danger' : 'ga-btn--primary'}`} disabled={!canConfirm}>{busy && <Loader2 className="ga-spin" aria-hidden="true" />}Confirm</button>
              </div>
            </form>
          )}
        </div>
      )}
      {messaging && (
        <Dialog title={`Message ${data?.profile?.displayName || 'this member'}`} onClose={() => setMessaging(false)}>
          <Composer compact fixedAudience={{ scope: 'user', user: id }} recipientName={data?.profile?.displayName || 'this member'} onSent={() => setMessaging(false)} />
        </Dialog>
      )}
    </Dialog>
  );
};

const Accounts: React.FC = () => {
  const [query, setQuery] = useState('');
  const [applied, setApplied] = useState('');
  const [sort, setSort] = useState('created_desc');
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const limit = 25;
  useEffect(() => { const t = setTimeout(() => { setApplied(query.trim()); setOffset(0); }, 350); return () => clearTimeout(t); }, [query]);
  const { loading, data, error, reload } = useAsync(() => adminCall<Page<AccountRow>>('accounts.list', { query: applied, sort, limit, offset }), [applied, sort, offset]);

  return (
    <div className="ga-stack">
      <div className="ga-toolbar">
        <label className="ga-search"><Search aria-hidden="true" /><span className="ga-sr">Search accounts</span>
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Email, name, handle or user ID" maxLength={120} autoComplete="off" /></label>
        <label className="ga-select"><span className="ga-sr">Sort</span>
          <select value={sort} onChange={(e) => { setSort(e.target.value); setOffset(0); }}>
            <option value="created_desc">Newest first</option><option value="created_asc">Oldest first</option>
            <option value="signin_desc">Recent sign-in</option><option value="signin_asc">Least recent sign-in</option><option value="reports_desc">Most reports</option>
          </select></label>
      </div>
      {loading && !data ? <Spinner /> : error ? <ErrorState error={error} onRetry={reload} /> : !data || data.rows.length === 0 ? <Empty>No accounts match.</Empty> : (
        <>
          <ul className="ga-rows" aria-busy={loading}>
            {data.rows.map((a) => (
              <li key={a.id}>
                <button type="button" className="ga-row" onClick={() => setOpen(a.id)}>
                  <span className="ga-row__main"><b>{a.displayName || 'No display name'}</b><span className="ga-mono">{a.email ?? 'No email'}</span></span>
                  <span className="ga-row__meta">
                    <Pill tone={a.status === 'suspended' ? 'bad' : 'ok'}>{a.status}</Pill>
                    <Pill tone={a.emailVerified ? 'muted' : 'warn'}>{a.emailVerified ? 'verified' : 'unverified'}</Pill>
                    {a.role && <Pill tone="purple">{a.role}</Pill>}
                    {a.reportsAgainst > 0 && <Pill tone="warn">{a.reportsAgainst} report{a.reportsAgainst === 1 ? '' : 's'}</Pill>}
                    <small>{a.providers.join(', ') || 'no provider'} · {a.profileComplete ? 'profile complete' : 'profile incomplete'}</small>
                    <small>Joined {fmt(a.createdAt)} · Last sign-in {fmt(a.lastSignInAt)}</small>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <Pager total={data.total} limit={limit} offset={offset} onChange={setOffset} />
        </>
      )}
      {open && <AccountDialog id={open} onClose={() => setOpen(null)} onChanged={reload} />}
    </div>
  );
};

const Pager: React.FC<{ total: number; limit: number; offset: number; onChange: (n: number) => void }> = ({ total, limit, offset, onChange }) => (
  <nav className="ga-pager" aria-label="Pagination">
    <button type="button" className="ga-btn" disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - limit))}><ChevronLeft aria-hidden="true" />Previous</button>
    <span>{total === 0 ? '0' : `${offset + 1}–${Math.min(offset + limit, total)}`} of {total.toLocaleString()}</span>
    <button type="button" className="ga-btn" disabled={offset + limit >= total} onClick={() => onChange(offset + limit)}>Next<ChevronRight aria-hidden="true" /></button>
  </nav>
);

/* --------------------------------------------------------------------- Reports */

const Reports: React.FC = () => {
  const [status, setStatus] = useState('open');
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const limit = 25;
  const { loading, data, error, reload } = useAsync(() => adminCall<Page<ReportRow>>('reports.list', { status: status || undefined, limit, offset }), [status, offset]);
  const update = async (reportId: string, next: string) => {
    setErr(null);
    try { await adminCall('reports.update', { reportId, status: next }); reload(); } catch (e) { setErr(humanise(e)); }
  };
  return (
    <div className="ga-stack">
      <div className="ga-toolbar">
        <label className="ga-select"><span className="ga-sr">Status</span>
          <select value={status} onChange={(e) => { setStatus(e.target.value); setOffset(0); }}>
            <option value="open">Open</option><option value="reviewing">Reviewing</option><option value="resolved">Resolved</option><option value="dismissed">Dismissed</option><option value="">All</option>
          </select></label>
      </div>
      <p className="ga-note">Reports contain only what the reporter wrote. Private message content is never available to administrators.</p>
      {err && <div className="ga-banner ga-banner--bad" role="alert">{err}</div>}
      {loading && !data ? <Spinner /> : error ? <ErrorState error={error} onRetry={reload} /> : !data || data.rows.length === 0 ? <Empty>No reports in this view.</Empty> : (
        <>
          <ul className="ga-rows">
            {data.rows.map((r) => (
              <li key={r.id} className="ga-card">
                <div className="ga-card__top"><Pill tone={r.status === 'open' ? 'warn' : 'muted'}>{r.status}</Pill><b>{r.reason || 'No reason given'}</b><small>{fmt(r.createdAt)}</small></div>
                {r.details && <p className="ga-quote">{r.details}</p>}
                <p className="ga-note">
                  Reported: {r.reportedId ? <button type="button" className="ga-link" onClick={() => setOpen(r.reportedId)}>{r.reportedName || r.reportedId}</button> : 'unknown'}
                  {r.reportedSuspended && <> <Pill tone="bad">suspended</Pill></>}
                  {' · '}Reporter: {r.reporterId ? <button type="button" className="ga-link" onClick={() => setOpen(r.reporterId)}>{r.reporterName || r.reporterId}</button> : 'unknown'}
                </p>
                <label className="ga-select ga-select--inline"><span>Status</span>
                  <select value={r.status} onChange={(e) => void update(r.id, e.target.value)}>
                    <option value="open">Open</option><option value="reviewing">Reviewing</option><option value="resolved">Resolved</option><option value="dismissed">Dismissed</option>
                  </select></label>
              </li>
            ))}
          </ul>
          <Pager total={data.total} limit={limit} offset={offset} onChange={setOffset} />
        </>
      )}
      {open && <AccountDialog id={open} onClose={() => setOpen(null)} onChanged={reload} />}
    </div>
  );
};

/* ---------------------------------------------------------------------- Health */

const Health: React.FC = () => {
  const deliveries = useAsync(() => adminCall<{ notificationId: string; state: string; statusCode: number | null; createdAt: string; host: string }[]>('diagnostics.deliveries', { limit: 25 }), []);
  const jobs = useAsync(() => adminCall<{ failed: { jobId: number; status: string; message: string; startedAt: string }[]; schedule: { jobId: number; name: string | null; schedule: string; active: boolean; lastRunAt: string | null; lastStatus: string | null }[] }>('diagnostics.jobs', { limit: 25 }), []);
  const auth = useAsync(() => adminCall<{ available: boolean; reason?: string; rows: { at: string; action: string | null; logType: string | null }[] }>('diagnostics.auth', { limit: 25 }), []);
  const config = useAsync(() => adminCall<{ items: { key: string; label: string; configured: boolean; note?: string }[] }>('diagnostics.config'), []);
  const errors = useAsync(() => adminCall<Page<AuditRow>>('audit.list', { outcome: 'error', limit: 10 }), []);
  const Block: React.FC<{ title: string; state: { loading: boolean; error: unknown; reload: () => void }; children: React.ReactNode }> = ({ title, state, children }) => (
    <section className="ga-panel"><h2>{title}</h2>{state.loading ? <Spinner /> : state.error ? <ErrorState error={state.error} onRetry={state.reload} /> : children}</section>
  );
  return (
    <div className="ga-stack">
      <Block title="Push delivery problems" state={deliveries}>
        {deliveries.data?.length ? <ul className="ga-list">{deliveries.data.map((d, i) => <li key={`${d.notificationId}-${i}`}><Pill tone="warn">{d.state}</Pill> {d.statusCode ?? 'no status'} · {d.host || 'unknown host'} <small>{fmt(d.createdAt)}</small></li>)}</ul> : <Empty>No failed deliveries recorded.</Empty>}
      </Block>
      <Block title="Scheduled jobs" state={jobs}>
        {jobs.data?.schedule.length ? <ul className="ga-list">{jobs.data.schedule.map((j) => <li key={j.jobId}><Pill tone={!j.active ? 'muted' : j.lastStatus === 'failed' ? 'bad' : 'ok'}>{j.active ? (j.lastStatus ?? 'not run yet') : 'inactive'}</Pill> {j.name ?? `Job ${j.jobId}`} <small className="ga-mono">{j.schedule}</small> <small>last run {fmt(j.lastRunAt)}</small></li>)}</ul> : <Empty>No scheduled jobs found.</Empty>}
        {jobs.data && jobs.data.failed.length > 0 && <><h4>Recent failures</h4><ul className="ga-list">{jobs.data.failed.map((f, i) => <li key={`${f.jobId}-${i}`}><Pill tone="bad">failed</Pill> Job {f.jobId} <small>{fmt(f.startedAt)}</small><p className="ga-quote">{f.message}</p></li>)}</ul></>}
      </Block>
      <Block title="Authentication events" state={auth}>
        {auth.data?.available ? <ul className="ga-list">{auth.data.rows.map((e, i) => <li key={i}>{e.action ?? 'event'} <small>{fmt(e.at)}</small></li>)}</ul> : <Empty>Unavailable. {auth.data?.reason ?? 'This project does not store authentication events in its database.'}</Empty>}
      </Block>
      <Block title="Admin API errors" state={errors}>
        {errors.data?.rows.length ? <ul className="ga-list">{errors.data.rows.map((e) => <li key={e.id}><Pill tone="bad">error</Pill> {e.action} <small>{fmt(e.createdAt)}</small></li>)}</ul> : <Empty>No admin API errors recorded.</Empty>}
      </Block>
      <Block title="Configuration status" state={config}>
        <p className="ga-note">Shows whether each setting is present. Values are never displayed.</p>
        <ul className="ga-list">{config.data?.items.map((c) => <li key={c.key}><Pill tone={c.configured ? 'ok' : 'warn'}>{c.configured ? 'set' : 'not set'}</Pill> {c.label} <small className="ga-mono">{c.key}</small>{c.note && <small> · {c.note}</small>}</li>)}</ul>
      </Block>
    </div>
  );
};

/* ----------------------------------------------------------------------- Audit */

const Audit: React.FC = () => {
  const [query, setQuery] = useState('');
  const [applied, setApplied] = useState('');
  const [outcome, setOutcome] = useState('');
  const [offset, setOffset] = useState(0);
  const [expanded, setExpanded] = useState<number | null>(null);
  const limit = 50;
  useEffect(() => { const t = setTimeout(() => { setApplied(query.trim()); setOffset(0); }, 350); return () => clearTimeout(t); }, [query]);
  const { loading, data, error, reload } = useAsync(() => adminCall<Page<AuditRow>>('audit.list', { query: applied, outcome: outcome || undefined, limit, offset }), [applied, outcome, offset]);
  return (
    <div className="ga-stack">
      <div className="ga-toolbar">
        <label className="ga-search"><Search aria-hidden="true" /><span className="ga-sr">Search audit log</span>
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Action, target ID or actor ID" maxLength={120} autoComplete="off" /></label>
        <label className="ga-select"><span className="ga-sr">Outcome</span>
          <select value={outcome} onChange={(e) => { setOutcome(e.target.value); setOffset(0); }}>
            <option value="">All outcomes</option><option value="success">Success</option><option value="denied">Denied</option><option value="error">Error</option><option value="reauth_required">Re-auth required</option>
          </select></label>
      </div>
      <p className="ga-note">Append-only. Entries cannot be edited or removed.</p>
      {loading && !data ? <Spinner /> : error ? <ErrorState error={error} onRetry={reload} /> : !data || data.rows.length === 0 ? <Empty>No audit entries match.</Empty> : (
        <>
          <ul className="ga-rows" aria-busy={loading}>
            {data.rows.map((r) => (
              <li key={r.id} className="ga-card ga-card--tight">
                <button type="button" className="ga-audit" aria-expanded={expanded === r.id} onClick={() => setExpanded(expanded === r.id ? null : r.id)}>
                  <Pill tone={r.outcome === 'success' ? 'ok' : r.outcome === 'denied' || r.outcome === 'error' ? 'bad' : 'warn'}>{r.outcome}</Pill>
                  <b>{r.action}</b>
                  <small>{fmt(r.createdAt)}</small>
                  <small className="ga-mono">{r.actorEmail ?? (r.actorId ? r.actorId.slice(0, 8) : 'system')}{r.targetId ? ` → ${r.targetId.slice(0, 8)}` : ''}</small>
                </button>
                {expanded === r.id && <pre className="ga-pre">{JSON.stringify({ actor: r.actorId, target: r.targetId, targetType: r.targetType, metadata: r.metadata }, null, 2)}</pre>}
              </li>
            ))}
          </ul>
          <Pager total={data.total} limit={limit} offset={offset} onChange={setOffset} />
        </>
      )}
    </div>
  );
};

/* ------------------------------------------------------------------------ Shell */

const NotFound: React.FC = () => (
  <main className="ga-root ga-center">
    <div className="ga-gate">
      <h1>Page not found</h1>
      <p>The page you are looking for does not exist.</p>
      <a className="ga-btn ga-btn--primary" href="/">Go to GAYZE</a>
    </div>
  </main>
);

export const AdminConsole: React.FC = () => {
  const gate = useAsync(() => adminCall<{ userId: string; role: string }>('whoami'), []);
  const [tab, setTab] = useState<Tab>(() => (TABS.find((t) => t.id === window.location.hash.slice(1))?.id ?? 'dashboard'));
  useEffect(() => { window.history.replaceState({}, '', `/admin#${tab}`); }, [tab]);
  useEffect(() => { document.title = 'GAYZE Admin'; }, []);

  if (gate.loading) return <main className="ga-root ga-center"><Spinner label="Checking access" /></main>;
  if (gate.error) {
    const code = gate.error instanceof AdminApiError ? gate.error.code : 'unknown';
    // Not an owner (or any other denial): reveal nothing about the console.
    if (code === 'forbidden' || code === 'unauthenticated') return <NotFound />;
    return <main className="ga-root ga-center"><div className="ga-gate"><ErrorState error={gate.error} onRetry={gate.reload} /></div></main>;
  }

  return (
    <main className="ga-root">
      <header className="ga-top">
        <div className="ga-brand"><ShieldCheck aria-hidden="true" /><div><strong>GAYZE</strong><span>Owner console</span></div></div>
        <div className="ga-top__actions">
          <a className="ga-btn" href="/"><ArrowLeft aria-hidden="true" />App</a>
          <button type="button" className="ga-btn" onClick={() => void supabase?.auth.signOut().then(() => { window.location.replace('/?signed_out=1'); })}><LogOut aria-hidden="true" />Sign out</button>
        </div>
      </header>
      <nav className="ga-tabs" aria-label="Admin sections">
        {TABS.map((t) => (
          <button key={t.id} type="button" className={tab === t.id ? 'is-on' : ''} aria-current={tab === t.id ? 'page' : undefined} onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </nav>
      <div className="ga-content">
        <h1 className="ga-title">{TABS.find((t) => t.id === tab)?.label}</h1>
        {tab === 'dashboard' && <Dashboard />}
        {tab === 'insights' && <Insights />}
        {tab === 'accounts' && <Accounts />}
        {tab === 'broadcasts' && <Broadcasts />}
        {tab === 'investor' && <ReportBuilder />}
        {tab === 'reports' && <Reports />}
        {tab === 'health' && <Health />}
        {tab === 'audit' && <Audit />}
      </div>
    </main>
  );
};

export default AdminConsole;
