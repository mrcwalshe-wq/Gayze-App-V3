import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Images, Lock, Plus, Trash2, X } from 'lucide-react';
import { supabase } from '../services/supabaseClient';
import {
  addAlbumPhoto, albumErrorMessage, albumsAvailable, createAlbum, deleteAlbum, listAlbumPhotos, listAlbums, listShares,
  loadOwnPhotoUrls, removeAlbumPhoto, revokeShare, MAX_ALBUMS, MAX_ALBUM_PHOTOS,
  type AlbumPhotoRow, type AlbumShareRow, type AlbumSummary,
} from '../services/albumService';
import { hapticLight } from '../services/hapticService';

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'until you stop sharing');

/** Profile > Private albums: make albums, add photos, see who has access and end it. */
export const AlbumsSheet: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [userId, setUserId] = useState<string | null>(null);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [albums, setAlbums] = useState<AlbumSummary[]>([]);
  const [open, setOpen] = useState<AlbumSummary | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try { setAlbums(await listAlbums()); } catch { setError('Could not load your albums.'); }
  }, []);

  useEffect(() => {
    let live = true;
    void (async () => {
      const { data } = (await supabase?.auth.getSession()) ?? { data: { session: null } };
      if (live) setUserId(data.session?.user.id ?? null);
      const ok = await albumsAvailable();
      if (live) { setAvailable(ok); if (ok) await refresh(); }
    })();
    return () => { live = false; };
  }, [refresh]);

  const create = async () => {
    if (!userId || !name.trim() || busy) return;
    setBusy(true); setError('');
    try { await createAlbum(userId, name); setName(''); await refresh(); hapticLight(); }
    catch (e) { setError(albumErrorMessage(e)); }
    finally { setBusy(false); }
  };

  return createPortal(
    <div className="g-plan" role="dialog" aria-modal="true" aria-label="Private albums" onClick={onClose}>
      <div className="g-plan__sheet" onClick={(e) => e.stopPropagation()}>
        <span className="g-plan__grip" aria-hidden="true" />
        <header className="g-plan__head">
          <span className="g-plan__badge"><Images className="w-5 h-5" /></span>
          <div className="g-plan__title"><small>Private</small><h3>{open ? open.name : 'Albums'}</h3></div>
          <button type="button" className="g-plan__close" onClick={onClose} aria-label="Close"><X className="w-4 h-4" /></button>
        </header>
        <div className="g-plan__body">
          {available === null && <p className="g-plan__note">Loading…</p>}
          {available === false && <p className="g-plan__note">Albums are being set up. Please try again soon.</p>}
          {available && !open && (
            <>
              <p className="g-plan__note g-alb__lead"><Lock className="inline w-3.5 h-3.5 mr-1" aria-hidden="true" />Photos are encrypted on your phone before they are uploaded. Share an album in a chat, and end access whenever you like.</p>
              <form className="g-alb__new" onSubmit={(e) => { e.preventDefault(); void create(); }}>
                <input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="New album name" aria-label="New album name" />
                <button type="submit" className="g-alb__btn" disabled={!name.trim() || busy || albums.length >= MAX_ALBUMS}><Plus className="w-4 h-4" aria-hidden="true" />Create</button>
              </form>
              {albums.length >= MAX_ALBUMS && <p className="g-plan__note g-plan__note--warn">You have {MAX_ALBUMS} albums, the most you can keep.</p>}
              {error && <p className="g-plan__note g-plan__note--warn">{error}</p>}
              <ul className="g-alb__list">
                {albums.map((a) => (
                  <li key={a.id}>
                    <button type="button" className="g-alb__row" onClick={() => { hapticLight(); setOpen(a); setError(''); }}>
                      <span><b>{a.name}</b><small>{a.count} {a.count === 1 ? 'photo' : 'photos'}</small></span>
                    </button>
                  </li>
                ))}
                {albums.length === 0 && <li className="g-alb__empty">No albums yet. Name one above to start.</li>}
              </ul>
            </>
          )}
          {available && open && userId && (
            <AlbumDetail userId={userId} album={open} onBack={() => { setOpen(null); void refresh(); }} />
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
};

const AlbumDetail: React.FC<{ userId: string; album: AlbumSummary; onBack: () => void }> = ({ userId, album, onBack }) => {
  const [photos, setPhotos] = useState<AlbumPhotoRow[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [shares, setShares] = useState<AlbumShareRow[]>([]);
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const made = useRef<string[]>([]);

  const load = useCallback(async () => {
    try {
      const rows = await listAlbumPhotos(album.id);
      setPhotos(rows);
      const u = await loadOwnPhotoUrls(userId, album.id, rows);
      made.current.forEach((x) => URL.revokeObjectURL(x));
      made.current = Object.values(u);
      setUrls(u);
      setShares(await listShares(album.id));
      setError('');
    } catch (e) { setError((e as Error).message || 'Could not open this album.'); }
  }, [album.id, userId]);

  useEffect(() => { void load(); return () => { made.current.forEach((x) => URL.revokeObjectURL(x)); made.current = []; }; }, [load]);

  const add = async (files: FileList | null) => {
    if (!files || !files.length) return;
    setWorking(true); setError('');
    try {
      let position = photos.length;
      for (const f of Array.from(files).slice(0, MAX_ALBUM_PHOTOS - photos.length)) { await addAlbumPhoto(userId, album.id, f, position); position += 1; }
      await load();
    } catch (e) { setError(albumErrorMessage(e)); }
    finally { setWorking(false); }
  };
  const remove = async (p: AlbumPhotoRow) => { setWorking(true); try { await removeAlbumPhoto(p); await load(); } catch { setError('Could not remove that photo.'); } finally { setWorking(false); } };
  const stop = async (s: AlbumShareRow) => { try { await revokeShare(s.id); setShares(await listShares(album.id)); hapticLight(); } catch { setError('Could not end access. Try again.'); } };
  const del = async () => {
    if (!confirmDelete) { setConfirmDelete(true); return; }
    setWorking(true);
    try { await deleteAlbum(album.id); onBack(); } catch { setError('Could not delete this album.'); setWorking(false); }
  };

  const active = shares.filter((s) => s.active);
  return (
    <>
      <button type="button" className="g-alb__back" onClick={onBack}><ArrowLeft className="w-4 h-4" aria-hidden="true" />All albums</button>
      {error && <p className="g-plan__note g-plan__note--warn">{error}</p>}
      <div className="g-alb__grid">
        {photos.map((p) => (
          <figure key={p.id} className="g-alb__tile">
            {urls[p.id] ? <img src={urls[p.id]} alt="" draggable={false} /> : <span className="g-alb__ph" aria-label="Photo loading">…</span>}
            <button type="button" aria-label="Remove photo" onClick={() => void remove(p)} disabled={working}><X className="w-3.5 h-3.5" /></button>
          </figure>
        ))}
        {photos.length < MAX_ALBUM_PHOTOS && (
          <label className="g-alb__add">
            <Plus className="w-5 h-5" aria-hidden="true" /><span>{working ? 'Adding…' : 'Add photos'}</span>
            <input type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" disabled={working} onChange={(e) => { void add(e.target.files); e.target.value = ''; }} />
          </label>
        )}
      </div>
      <p className="g-plan__note">{photos.length} of {MAX_ALBUM_PHOTOS} photos. Send this album from any chat with the pictures button next to the message box.</p>

      <h4 className="g-alb__h">Who can see this</h4>
      {active.length === 0 && <p className="g-plan__note">Nobody right now.</p>}
      <ul className="g-alb__list">
        {active.map((s) => (
          <li key={s.id} className="g-alb__share">
            <span><b>{s.recipientName}</b><small>Access {s.expiresAt ? `until ${when(s.expiresAt)}` : 'until you stop sharing'}</small></span>
            <button type="button" className="g-alb__btn g-alb__btn--quiet" onClick={() => void stop(s)}>End access</button>
          </li>
        ))}
      </ul>
      <p className="g-plan__note">Ending access stops anyone opening the album again. It can't remove a picture someone already saw or captured.</p>
      <button type="button" className="g-alb__btn g-alb__btn--danger" onClick={() => void del()} disabled={working}><Trash2 className="w-4 h-4" aria-hidden="true" />{confirmDelete ? 'Tap again to delete this album and its photos' : 'Delete album'}</button>
    </>
  );
};
