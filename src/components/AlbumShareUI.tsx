import { playAppSound } from '../services/appSounds';
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, Clock, Images, Lock, X } from 'lucide-react';
import type { AlbumShare } from '../types';
import { albumErrorMessage, listAlbums, openSharedAlbum, revokeShare, shareIsOpen, type AlbumSummary, type SharedAlbumResult } from '../services/albumService';
import { hapticLight } from '../services/hapticService';

const DURATIONS: { label: string; ms: number | null }[] = [
  { label: '1 hour', ms: 3600e3 }, { label: '24 hours', ms: 86400e3 }, { label: '7 days', ms: 7 * 86400e3 }, { label: 'Until I stop', ms: null },
];

/** Chat: choose an album and how long they can open it. */
export const AlbumPickerSheet: React.FC<{ isOpen: boolean; onClose: () => void; peerName: string; onSend: (album: AlbumSummary, expiresAt: Date | null) => Promise<void>; onManage?: () => void }> = ({ isOpen, onClose, peerName, onSend, onManage }) => {
  const [albums, setAlbums] = useState<AlbumSummary[] | null>(null);
  const [pick, setPick] = useState<string>('');
  const [dur, setDur] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    let live = true; setAlbums(null); setError(''); setBusy(false);
    listAlbums().then((a) => { if (live) { const usable = a.filter((x) => x.count > 0); setAlbums(usable); setPick(usable[0]?.id ?? ''); } }, () => { if (live) { setAlbums([]); setError('Could not load your albums.'); } });
    return () => { live = false; };
  }, [isOpen]);

  if (!isOpen) return null;
  const send = async () => {
    const album = albums?.find((a) => a.id === pick);
    if (!album || busy) return;
    setBusy(true); setError('');
    try { const ms = DURATIONS[dur].ms; await onSend(album, ms ? new Date(Date.now() + ms) : null); onClose(); }
    catch (e) { setError(albumErrorMessage(e)); setBusy(false); }
  };
  return createPortal(
    <div className="g-plan" role="dialog" aria-modal="true" aria-label={`Send a private album to ${peerName}`} onClick={onClose}>
      <div className="g-plan__sheet" onClick={(e) => e.stopPropagation()}>
        <span className="g-plan__grip" aria-hidden="true" />
        <header className="g-plan__head">
          <span className="g-plan__badge"><Images className="w-5 h-5" /></span>
          <div className="g-plan__title"><small>Private album</small><h3>Send to {peerName}</h3></div>
          <button type="button" className="g-plan__close" onClick={onClose} aria-label="Close"><X className="w-4 h-4" /></button>
        </header>
        <div className="g-plan__body">
          {onManage && <button type="button" className="g-alb__back" onClick={() => { onClose(); onManage(); }}><Images className="w-4 h-4" aria-hidden="true" />Manage my albums: add photos, edit, end access</button>}
          {albums === null && <p className="g-plan__note">Loading…</p>}
          {albums && albums.length === 0 && <p className="g-plan__note">You have no albums with photos yet. Make one in Profile, under Private albums.</p>}
          {albums && albums.length > 0 && (<>
            <ul className="g-alb__list" role="radiogroup" aria-label="Album">
              {albums.map((a) => (
                <li key={a.id}><button type="button" role="radio" aria-checked={pick === a.id} className="g-alb__row" onClick={() => setPick(a.id)}><span><b>{a.name}</b><small>{a.count} {a.count === 1 ? 'photo' : 'photos'}</small></span></button></li>
              ))}
            </ul>
            <h4 className="g-alb__h">They can open it for</h4>
            <div className="g-alb__dur" role="radiogroup" aria-label="How long">
              {DURATIONS.map((d, i) => <button key={d.label} type="button" role="radio" aria-checked={dur === i} onClick={() => setDur(i)}>{d.label}</button>)}
            </div>
            <p className="g-plan__note">You can end access at any time, or unsend the message. {peerName} can't save the photos from GAYZE, but nothing can stop a screenshot or a picture of the screen.</p>
            {error && <p className="g-plan__note g-plan__note--warn">{error}</p>}
            <button type="button" className="g-plan__send" disabled={!pick || busy} onClick={() => void send()}><span>{busy ? 'Sending…' : 'Send album'}</span></button>
          </>)}
        </div>
      </div>
    </div>,
    document.body,
  );
};

const leftText = (ms: number) => {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 60) return `${Math.max(1, m)} min left`;
  if (m < 48 * 60) return `${Math.round(m / 60)} h left`;
  return `${Math.round(m / 1440)} days left`;
};

/** A shared album as a chat card. The recipient opens it; the sender can end access. */
export const AlbumCard: React.FC<{ share: AlbumShare; mine: boolean; peerName: string }> = ({ share, mine, peerName }) => {
  const [viewing, setViewing] = useState(false);
  const [ended, setEnded] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if (!share.expiresAt) return; const t = window.setInterval(() => setNow(Date.now()), 30000); return () => window.clearInterval(t); }, [share.expiresAt]);
  // The sender's card follows the server: ending access from the album screen, or by unsending, shows here too.
  useEffect(() => { if (!mine) return; let live = true; void shareIsOpen(share.shareId).then((open) => { if (live && !open) setEnded(true); }); return () => { live = false; }; }, [mine, share.shareId]);
  const expired = !!share.expiresAt && share.expiresAt <= now;
  const over = ended || expired;
  const stop = async () => { try { await revokeShare(share.shareId); playAppSound('unsend'); setEnded(true); hapticLight(); } catch { /* stays active */ } };
  return (
    <article className={`g-albcard ${over ? 'is-over' : ''}`} aria-label={`Private album ${share.name}`}>
      <span className="g-albcard__ico" aria-hidden="true"><Lock className="w-4 h-4" /></span>
      <div className="g-albcard__body">
        <b>{share.name}</b>
        <small>{share.count} {share.count === 1 ? 'photo' : 'photos'} · {over ? 'No longer available' : share.expiresAt ? <><Clock className="inline w-3 h-3" aria-hidden="true" /> {leftText(share.expiresAt - now)}</> : 'Open until stopped'}</small>
      </div>
      {!over && !mine && <button type="button" className="g-alb__btn" onClick={() => { hapticLight(); setViewing(true); }}>View</button>}
      {!over && mine && <button type="button" className="g-alb__btn g-alb__btn--quiet" onClick={() => void stop()} aria-label={`End access to ${share.name}`}>End access</button>}
      {over && mine && <small className="g-albcard__ended">Access ended</small>}
      {viewing && <AlbumViewer share={share} from={peerName} onClose={() => setViewing(false)} />}
    </article>
  );
};

/** Full-screen viewer. No save button; hides when the app leaves the screen; closes itself when time runs out. */
export const AlbumViewer: React.FC<{ share: AlbumShare; from: string; onClose: () => void }> = ({ share, from, onClose }) => {
  const [res, setRes] = useState<SharedAlbumResult | null>(null);
  const [i, setI] = useState(0);
  const [hidden, setHidden] = useState(false);
  const urls = useRef<string[]>([]);

  useEffect(() => {
    let live = true;
    openSharedAlbum(share).then((r) => {
      if (!live) { if (r.status === 'ok') r.photos.forEach((p) => URL.revokeObjectURL(p.url)); return; }
      if (r.status === 'ok') urls.current = r.photos.map((p) => p.url);
      setRes(r);
    }, () => { if (live) setRes({ status: 'unavailable' }); });
    return () => { live = false; urls.current.forEach((u) => URL.revokeObjectURL(u)); urls.current = []; };
  }, [share]);

  useEffect(() => {
    const vis = () => setHidden(document.visibilityState !== 'visible');
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); if (e.key === 'ArrowRight') setI((n) => n + 1); if (e.key === 'ArrowLeft') setI((n) => Math.max(0, n - 1)); };
    const blur = () => setHidden(true);
    document.addEventListener('visibilitychange', vis); window.addEventListener('blur', blur); window.addEventListener('focus', vis);
    window.addEventListener('keydown', key);
    return () => { document.removeEventListener('visibilitychange', vis); window.removeEventListener('blur', blur); window.removeEventListener('focus', vis); window.removeEventListener('keydown', key); };
  }, [onClose]);

  useEffect(() => {
    const until = res?.status === 'ok' ? res.expiresAt : share.expiresAt ?? null;
    if (!until) return;
    const t = window.setInterval(() => { if (Date.now() >= until) { setRes({ status: 'unavailable' }); urls.current.forEach((u) => URL.revokeObjectURL(u)); urls.current = []; } }, 5000);
    return () => window.clearInterval(t);
  }, [res, share.expiresAt]);

  const photos = res?.status === 'ok' ? res.photos : [];
  const idx = Math.min(i, Math.max(0, photos.length - 1));
  return createPortal(
    <div className="g-albview" role="dialog" aria-modal="true" aria-label={`${share.name}, a private album from ${from}`} onContextMenu={(e) => e.preventDefault()}>
      <header>
        <span>{res?.status === 'ok' ? `${res.name} · ${idx + 1} of ${photos.length}` : share.name}</span>
        <button type="button" onClick={onClose} aria-label="Close"><X className="w-5 h-5" /></button>
      </header>
      <div className={`g-albview__stage ${hidden ? 'is-hidden' : ''}`}>
        {res === null && <p>Opening…</p>}
        {res?.status === 'unavailable' && <p>This album is no longer available. {from} may have ended access, it may have expired, or the message was unsent.</p>}
        {photos[idx] && <img src={photos[idx].url} alt={`Photo ${idx + 1} of ${photos.length}`} draggable={false} />}
        {hidden && <p className="g-albview__shield">Hidden while GAYZE is in the background</p>}
      </div>
      {photos.length > 1 && (
        <footer>
          <button type="button" onClick={() => setI(Math.max(0, idx - 1))} disabled={idx === 0} aria-label="Previous photo"><ChevronLeft className="w-6 h-6" /></button>
          <button type="button" onClick={() => setI(Math.min(photos.length - 1, idx + 1))} disabled={idx === photos.length - 1} aria-label="Next photo"><ChevronRight className="w-6 h-6" /></button>
        </footer>
      )}
      <p className="g-albview__note">Private album from {from}. Please don't screenshot or share it.</p>
    </div>,
    document.body,
  );
};
