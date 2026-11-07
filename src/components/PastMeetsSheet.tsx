import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { IScannerControls } from '@zxing/browser';
import { Camera, Check, QrCode, RefreshCw, ShieldCheck, Trash2, Users, X } from 'lucide-react';
import { hapticLight, hapticSensitiveAction } from '../services/hapticService';
import { getProfilePhotoUrl } from '../services/profilePhotoService';
import {
  LEVEL_LABEL, issueMeetQr, loadMyReliability, loadPastMeets, pastMeetError, redeemMeetQr, revokePastMeet,
  type MeetQr, type PastMeet, type RedeemResult, type Reliability,
} from '../services/pastMeetsService';

type Tab = 'qr' | 'scan' | 'meets';

const Ring: React.FC<{ rel: Reliability; size?: number }> = ({ rel, size = 84 }) => {
  const score = rel.score ?? 0;
  const r = 20;
  return (
    <div className={`pm-ring pm-ring--${rel.level}`} style={{ width: size, height: size }}>
      <svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r={r} className="pm-ring__bg" /><circle cx="24" cy="24" r={r} className="pm-ring__fg" pathLength={100} style={{ strokeDasharray: `${rel.score == null ? 0 : score} 100` }} /></svg>
      <b>{rel.score ?? '·'}</b>
    </div>
  );
};

const Avatar: React.FC<{ name: string; path?: string }> = ({ name, path }) => {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => { let off = false; if (path) void getProfilePhotoUrl(path).then((u) => { if (!off) setUrl(u); }); return () => { off = true; }; }, [path]);
  return <span className="pm-av">{url ? <img src={url} alt="" draggable={false} /> : name.charAt(0).toUpperCase()}</span>;
};

const levelHint = (rel: Reliability) => rel.level === 'new'
  ? `Meet ${Math.max(1, 3 - rel.people)} more ${3 - rel.people === 1 ? 'person' : 'people'} in real life and confirm with a scan to earn a score.`
  : `${rel.verifiedMeets} confirmed ${rel.verifiedMeets === 1 ? 'meet' : 'meets'} with ${rel.people} ${rel.people === 1 ? 'person' : 'people'}.`;

/** Past Meets: show your code, scan someone else's, and see who you have really met. A scan proves two signed-in people met. */
export const PastMeetsSheet: React.FC<{ isOpen: boolean; onClose: () => void; onOpenPeer?: (id: string, name: string) => void }> = ({ isOpen, onClose, onOpenPeer }) => {
  const [tab, setTab] = useState<Tab>('qr');
  const [mine, setMine] = useState<Reliability | null>(null);
  const [meets, setMeets] = useState<PastMeet[]>([]);
  const [qr, setQr] = useState<MeetQr | null>(null);
  const [qrImg, setQrImg] = useState<string | null>(null);
  const [qrErr, setQrErr] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [scanErr, setScanErr] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [done, setDone] = useState<RedeemResult | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const busyRef = useRef(false);

  const refresh = useCallback(() => { void loadMyReliability().then(setMine); void loadPastMeets().then(setMeets); }, []);

  const newQr = useCallback(async () => {
    setQrErr(null);
    try {
      const next = await issueMeetQr();
      const QR = await import('qrcode');
      const img = await QR.toDataURL(next.token, { margin: 1, width: 560, color: { dark: '#12091f', light: '#ffffff' } });
      setQr(next); setQrImg(img);
    } catch (e) { setQrErr(pastMeetError(e)); }
  }, []);

  useEffect(() => { if (isOpen) { setTab('qr'); setDone(null); setScanErr(null); setConfirming(null); refresh(); } }, [isOpen, refresh]);

  // The code rotates: a new one before the old one lapses, and only while the QR tab is showing.
  useEffect(() => {
    if (!isOpen || tab !== 'qr') return;
    void newQr();
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(tick);
  }, [isOpen, tab, newQr]);
  useEffect(() => { if (tab === 'qr' && qr && qr.expiresAt - now < 8000 && !qrErr) { void newQr(); } }, [now, qr, tab, qrErr, newQr]);

  const stopCamera = useCallback(() => { controlsRef.current?.stop(); controlsRef.current = null; setScanning(false); }, []);
  useEffect(() => { if (!isOpen || tab !== 'scan') stopCamera(); }, [isOpen, tab, stopCamera]);
  useEffect(() => stopCamera, [stopCamera]);

  const startCamera = async () => {
    setScanErr(null); setDone(null);
    if (!navigator.mediaDevices?.getUserMedia || !videoRef.current) { setScanErr('This device cannot open the camera here.'); return; }
    try {
      const { BrowserQRCodeReader } = await import('@zxing/browser');
      controlsRef.current = await new BrowserQRCodeReader().decodeFromConstraints(
        { video: { facingMode: { ideal: 'environment' } }, audio: false }, videoRef.current,
        (result, _e, controls) => {
          if (!result || busyRef.current) return;
          busyRef.current = true; controlsRef.current = controls;
          const text = result.getText();
          void redeemMeetQr(text).then((r) => { stopCamera(); hapticSensitiveAction(); setDone(r); refresh(); })
            .catch((e) => { setScanErr(pastMeetError(e)); window.setTimeout(() => { busyRef.current = false; }, 2500); })
            .finally(() => { if (!controlsRef.current) busyRef.current = false; });
        },
      );
      setScanning(true);
    } catch { setScanErr('Camera permission was denied or is unavailable.'); }
  };

  useEffect(() => {
    if (!isOpen) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [isOpen, onClose]);

  if (!isOpen) return null;
  const left = qr ? Math.max(0, Math.ceil((qr.expiresAt - now) / 1000)) : 0;

  return createPortal(
    <div className="g-plan pm" role="dialog" aria-modal="true" aria-label="Past meets" onClick={onClose}>
      <div className="g-plan__sheet pm__sheet" onClick={(e) => e.stopPropagation()}>
        <span className="g-plan__grip" aria-hidden="true" />
        <header className="pm__head">
          <div><small>Real life, confirmed</small><h3>Past meets</h3></div>
          <button type="button" className="g-plan__close" onClick={onClose} aria-label="Close"><X className="w-4 h-4" /></button>
        </header>

        <div className="pm__score">
          <Ring rel={mine ?? { verifiedMeets: 0, people: 0, score: null, level: 'new' }} />
          <div>
            <strong>{mine ? LEVEL_LABEL[mine.level] : 'Reliability'}</strong>
            <p>{mine ? levelHint(mine) : 'Loading…'}</p>
          </div>
        </div>

        <div className="pm__tabs" role="tablist">
          {([['qr', 'My code', QrCode], ['scan', 'Scan', Camera], ['meets', 'People', Users]] as const).map(([id, label, Icon]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'is-on' : ''} onClick={() => { hapticLight(); setTab(id); setDone(null); }}><Icon className="w-4 h-4" aria-hidden="true" />{label}</button>
          ))}
        </div>

        <div className="pm__body">
          {tab === 'qr' && (
            <div className="pm__qr">
              <div className="pm__qrbox">{qrImg ? <img src={qrImg} alt="Your meet code. Show it to the person you are meeting." draggable={false} /> : <span className="pm__spin" aria-label="Making your code" />}</div>
              {qrErr ? <p className="pm__err" role="alert">{qrErr}</p> : <p className="pm__hint">Show this to the person you are meeting. It works once, then changes{qr ? ` · new code in ${left}s` : ''}. It holds no personal details.</p>}
              <button type="button" className="pm__btn" onClick={() => { hapticLight(); void newQr(); }}><RefreshCw className="w-4 h-4" aria-hidden="true" />New code</button>
            </div>
          )}

          {tab === 'scan' && (
            <div className="pm__scan">
              {done ? (
                <div className="pm__done" role="status">
                  <span className="pm__tick"><Check className="w-6 h-6" strokeWidth={3} /></span>
                  <Avatar name={done.peerName} />
                  <strong>{done.repeat ? `Already confirmed with ${done.peerName}` : `Confirmed: you met ${done.peerName}`}</strong>
                  <p>{done.repeat ? 'Repeat scans within a week do not add to your score.' : 'You both have a verified meet now.'}</p>
                  <button type="button" className="pm__btn" onClick={() => { setDone(null); busyRef.current = false; }}>Scan another</button>
                </div>
              ) : (
                <>
                  <div className={`pm__cam ${scanning ? 'is-live' : ''}`}>
                    <video ref={videoRef} muted playsInline />
                    {!scanning && <div className="pm__cam-idle"><Camera className="w-7 h-7" aria-hidden="true" /><span>Scan the code on their phone</span></div>}
                    {scanning && <i className="pm__frame" aria-hidden="true" />}
                  </div>
                  {scanErr && <p className="pm__err" role="alert">{scanErr}</p>}
                  <button type="button" className="pm__btn pm__btn--primary" onClick={() => { hapticLight(); scanning ? stopCamera() : void startCamera(); }}>{scanning ? 'Stop camera' : 'Open camera'}</button>
                </>
              )}
            </div>
          )}

          {tab === 'meets' && (
            meets.length === 0 ? (
              <div className="pm__empty"><ShieldCheck className="w-7 h-7" aria-hidden="true" /><strong>No confirmed meets yet</strong><p>When you meet someone, scan each other's codes. Both of you get a verified meet.</p></div>
            ) : (
              <ul className="pm__list">
                {meets.map((m) => (
                  <li key={m.peerId}>
                    <button type="button" className="pm__row" onClick={() => onOpenPeer?.(m.peerId, m.name)} disabled={!onOpenPeer}>
                      <Avatar name={m.name} path={m.avatarPath} />
                      <span className="pm__who"><strong>{m.name}</strong><small>{m.meetCount} {m.meetCount === 1 ? 'meet' : 'meets'} · last {new Date(m.lastMeetAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</small></span>
                      <span className={`pm__lvl pm__lvl--${m.reliability.level}`}>{LEVEL_LABEL[m.reliability.level]}</span>
                    </button>
                    {confirming === m.peerId ? (
                      <div className="pm__confirm">
                        <span>Remove {m.name} from your past meets? It lowers both scores.</span>
                        <button type="button" onClick={() => setConfirming(null)}>Keep</button>
                        <button type="button" className="is-danger" onClick={() => { void revokePastMeet(m.peerId).then((ok) => { if (ok) { setConfirming(null); refresh(); } }); }}>Remove</button>
                      </div>
                    ) : (
                      <button type="button" className="pm__rm" aria-label={`Remove ${m.name} from past meets`} onClick={() => setConfirming(m.peerId)}><Trash2 className="w-4 h-4" /></button>
                    )}
                  </li>
                ))}
              </ul>
            )
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
};
