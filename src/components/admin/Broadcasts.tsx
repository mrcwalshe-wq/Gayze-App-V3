import React, { useEffect, useState } from 'react';
import { Bell, Loader2, Send } from 'lucide-react';
import { AdminApiError, adminCall, type Audience, type AudienceScope, type BroadcastRow } from '../../services/adminApi';
import { Dialog, Empty, ErrorState, Pill, ReauthBar, Spinner, fmt, humanise, useAsync } from './ui';

const SCOPES: { id: AudienceScope; label: string; hint: string }[] = [
  { id: 'all', label: 'Everyone', hint: 'Every member who is not suspended' },
  { id: 'active', label: 'Active recently', hint: 'Opened the app in the last few days' },
  { id: 'inactive', label: 'Gone quiet', hint: 'Not seen for a while — a win-back message' },
  { id: 'intent', label: 'Has a live intent', hint: 'Right now, optionally for one intent type' },
  { id: 'push', label: 'Has push on', hint: 'Members with a notification-enabled device' },
];
const LINKS = [
  { v: '/', label: 'Opens the app' }, { v: '/later', label: 'Opens Later (gatherings)' },
  { v: '/right-now', label: 'Opens Intents' }, { v: '/messages', label: 'Opens Messages' }, { v: '/profile', label: 'Opens Profile' },
];

const describe = (a: Audience) => {
  switch (a.scope) {
    case 'all': return 'everyone';
    case 'active': return `members active in the last ${a.days ?? 30} days`;
    case 'inactive': return `members not seen in ${a.days ?? 30} days`;
    case 'intent': return a.intent ? `members with a live “${a.intent}” intent` : 'members with a live intent';
    case 'push': return 'members with push on';
    default: return 'one member';
  }
};

/** Composer used for broadcasts and, with a fixed audience, for a message to one member. */
export const Composer: React.FC<{ fixedAudience?: Audience; recipientName?: string; onSent?: () => void; compact?: boolean }> = ({ fixedAudience, recipientName, onSent, compact }) => {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [url, setUrl] = useState('/');
  const [scope, setScope] = useState<AudienceScope>('all');
  const [days, setDays] = useState(30);
  const [intent, setIntent] = useState('');
  const audience: Audience = fixedAudience ?? { scope, ...(scope === 'active' || scope === 'inactive' ? { days } : {}), ...(scope === 'intent' && intent.trim() ? { intent: intent.trim() } : {}) };
  const audienceKey = JSON.stringify(audience);

  const [count, setCount] = useState<number | null>(null);
  const [countErr, setCountErr] = useState<unknown>(null);
  useEffect(() => {
    let live = true;
    setCount(null); setCountErr(null);
    const t = window.setTimeout(() => {
      adminCall<{ recipients: number }>('broadcast.audienceCount', { audience: JSON.parse(audienceKey) })
        .then((r) => { if (live) setCount(r.recipients); }).catch((e) => { if (live) setCountErr(e); });
    }, 300);
    return () => { live = false; window.clearTimeout(t); };
  }, [audienceKey]);

  const [confirming, setConfirming] = useState(false);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [done, setDone] = useState<string | null>(null);
  const valid = title.trim().length > 0 && body.trim().length > 0 && count !== null && count > 0;

  const send = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await adminCall<{ recipients: number }>('broadcast.send', { title: title.trim(), body: body.trim(), url, audience, confirm: true, expectedRecipients: count });
      setDone(`Sent to ${r.recipients.toLocaleString()} ${r.recipients === 1 ? 'person' : 'people'}. Push goes to anyone with it switched on; everyone else sees it in their notifications.`);
      setConfirming(false); setAck(false); setTitle(''); setBody('');
      onSent?.();
    } catch (e) { setErr(e); setConfirming(e instanceof AdminApiError && e.code === 'reauth_required' ? true : false); }
    finally { setBusy(false); }
  };

  return (
    <div className="ga-stack">
      {done && <div className="ga-banner ga-banner--ok" role="status">{done}</div>}
      <div className={compact ? '' : 'ga-cols ga-cols--2'}>
        <div className="ga-panel">
          {!fixedAudience && (
            <>
              <label className="ga-field"><span>Who gets it</span>
                <span className="ga-select"><select value={scope} onChange={(e) => setScope(e.target.value as AudienceScope)}>{SCOPES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></span>
              </label>
              <p className="ga-note" style={{ marginTop: -4 }}>{SCOPES.find((s) => s.id === scope)?.hint}</p>
              {(scope === 'active' || scope === 'inactive') && (
                <label className="ga-field"><span>Window</span>
                  <span className="ga-select"><select value={days} onChange={(e) => setDays(Number(e.target.value))}>{[3, 7, 14, 30, 60, 90].map((d) => <option key={d} value={d}>{d} days</option>)}</select></span>
                </label>
              )}
              {scope === 'intent' && (
                <label className="ga-field"><span>Intent type (optional, e.g. Drinks)</span><input value={intent} maxLength={40} onChange={(e) => setIntent(e.target.value)} /></label>
              )}
            </>
          )}
          <label className="ga-field"><span>Title <small>({title.length}/80)</small></span><input value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} placeholder="Short and clear" /></label>
          <label className="ga-field"><span>Message <small>({body.length}/500)</small></span><textarea rows={4} value={body} maxLength={500} onChange={(e) => setBody(e.target.value)} placeholder="What do you want them to know or do?" /></label>
          <label className="ga-field"><span>When they tap it</span>
            <span className="ga-select"><select value={url} onChange={(e) => setUrl(e.target.value)}>{LINKS.map((l) => <option key={l.v} value={l.v}>{l.label}</option>)}</select></span>
          </label>
          <p className="ga-note">{countErr ? humanise(countErr) : count === null ? 'Counting recipients…' : <><b>{count.toLocaleString()}</b> {count === 1 ? 'person' : 'people'} · {recipientName ?? describe(audience)}. Suspended accounts and admins are never included.</>}</p>
          {err != null && !confirming && <div className="ga-banner ga-banner--bad" role="alert">{humanise(err)}</div>}
          <div className="ga-actions" style={{ marginTop: 12 }}>
            <button type="button" className="ga-btn ga-btn--primary" disabled={!valid} onClick={() => { setDone(null); setErr(null); setAck(false); setConfirming(true); }}><Send aria-hidden="true" />Review and send</button>
          </div>
        </div>
        <div className="ga-panel">
          <h4>Preview</h4>
          <div className="ga-phone" aria-label="Notification preview">
            <Bell aria-hidden="true" />
            <div><b>{title.trim() || 'Your title'}</b><span>{body.trim() || 'Your message appears here.'}</span><small>GAYZE · now</small></div>
          </div>
          <p className="ga-note">Members see this on their lock screen if push is on, and always in Messages → Notifications → From Gayze.</p>
        </div>
      </div>

      {confirming && (
        <Dialog title="Send this message?" onClose={() => !busy && setConfirming(false)}>
          <div className="ga-stack">
            <div className="ga-phone"><Bell aria-hidden="true" /><div><b>{title.trim()}</b><span>{body.trim()}</span><small>GAYZE · now</small></div></div>
            <p>This goes to <b>{count?.toLocaleString()}</b> {count === 1 ? 'person' : 'people'} ({recipientName ?? describe(audience)}). It cannot be recalled once sent.</p>
            {err instanceof AdminApiError && err.code === 'reauth_required' ? <ReauthBar /> : err != null ? <div className="ga-banner ga-banner--bad" role="alert">{humanise(err)}</div> : null}
            <label className="ga-check"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /><span>I have read it and I want to send it now.</span></label>
            <div className="ga-actions">
              <button type="button" className="ga-btn" disabled={busy} onClick={() => setConfirming(false)}>Back</button>
              <button type="button" className="ga-btn ga-btn--primary" disabled={!ack || busy} onClick={() => void send()}>{busy && <Loader2 className="ga-spin" aria-hidden="true" />}Send now</button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
};

export const Broadcasts: React.FC = () => {
  const { loading, data, error, reload } = useAsync(() => adminCall<BroadcastRow[]>('broadcast.list', { limit: 25 }), []);
  return (
    <div className="ga-stack">
      <section aria-labelledby="bc-new"><h2 id="bc-new">New broadcast</h2><Composer onSent={reload} /></section>
      <section aria-labelledby="bc-hist"><h2 id="bc-hist">Sent</h2>
        {loading && !data ? <Spinner /> : error || !data ? <ErrorState error={error} onRetry={reload} /> : data.length === 0 ? <Empty>Nothing sent yet.</Empty> : (
          <ul className="ga-rows">
            {data.map((b) => (
              <li key={b.id} className="ga-card">
                <div className="ga-card__top"><b>{b.title}</b><Pill tone="purple">{describe(b.audience)}</Pill><small>{fmt(b.created_at)}</small></div>
                <p className="ga-quote">{b.body}</p>
                <div className="ga-chips">
                  <Pill>{b.recipient_count.toLocaleString()} recipients</Pill>
                  <Pill tone={b.read_count > 0 ? 'ok' : 'muted'}>{b.read_count.toLocaleString()} opened</Pill>
                  <Pill tone={b.pushed_count > 0 ? 'ok' : 'muted'}>{b.pushed_count.toLocaleString()} pushed</Pill>
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="ga-note">“Pushed” means a push service accepted the message. “Opened” means the member opened it in the app.</p>
      </section>
    </div>
  );
};
