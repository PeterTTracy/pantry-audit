import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';

// Swipeable photo library for one product. Owns its own list (so it's
// independent of the audit form's save flow): captured/added photos persist
// immediately and sync in the background. Blobs load lazily — a fresh pull only
// brings photo metadata, and each image is fetched from cloud Storage on first
// view and cached on-device.
export default function PhotoGallery({ productId }) {
  const [items, setItems] = useState(null); // null = loading
  const [urls, setUrls] = useState({});     // id -> objectURL | null (resolved)
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [lightbox, setLightbox] = useState(-1); // index into items, or -1
  const urlsRef = useRef({});                 // id -> resolved objectURL|null (mirror of state, for revoking)

  const load = useCallback(async () => {
    const list = await api.listPhotos(productId);
    setItems(list);
    return list;
  }, [productId]);

  useEffect(() => { setItems(null); load().catch((e) => setErr(e.message)); }, [load]);

  // Lazily resolve an object URL for every item not yet resolved. Dedup keys
  // off urlsRef (the resolved value), not a "started" flag, so a StrictMode
  // mount→unmount→remount can't strand an item on its placeholder.
  useEffect(() => {
    let active = true;
    (async () => {
      if (!items) return;
      for (const it of items) {
        if (urlsRef.current[it.id] !== undefined) continue;
        const url = await api.photoUrl(it.id).catch(() => null);
        if (!active) { if (url) URL.revokeObjectURL(url); return; }
        urlsRef.current[it.id] = url || null;
        setUrls((u) => ({ ...u, [it.id]: url || null }));
      }
    })();
    return () => { active = false; };
  }, [items]);

  // Revoke every object URL when the gallery unmounts.
  useEffect(() => () => {
    Object.values(urlsRef.current).forEach((u) => u && URL.revokeObjectURL(u));
  }, []);

  const onFiles = async (e, source) => {
    const files = [...(e.target.files || [])];
    e.target.value = '';
    if (!files.length) return;
    setBusy(true); setErr('');
    try { await api.addPhotos(productId, files, source); await load(); }
    catch (e2) { setErr(e2.message); }
    finally { setBusy(false); }
  };

  const onDelete = async (id) => {
    if (!window.confirm('Delete this photo?')) return;
    setBusy(true); setErr('');
    try {
      await api.deletePhoto(id);
      const u = urlsRef.current[id];
      if (u) URL.revokeObjectURL(u);
      delete urlsRef.current[id];
      setUrls((m) => { const n = { ...m }; delete n[id]; return n; });
      await load();
    } catch (e2) { setErr(e2.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="card photo-gallery">
      <div className="photo-gallery-head">
        <h3>Photos{items?.length ? ` (${items.length})` : ''}</h3>
        <div className="photo-actions">
          <label className={`btn btn-ghost btn-sm ${busy ? 'is-disabled' : ''}`}>
            📷 Take photo
            <input type="file" accept="image/*" capture="environment" hidden
              disabled={busy} onChange={(e) => onFiles(e, 'camera')} />
          </label>
          <label className={`btn btn-ghost btn-sm ${busy ? 'is-disabled' : ''}`}>
            ＋ Add
            <input type="file" accept="image/*" multiple hidden
              disabled={busy} onChange={(e) => onFiles(e, 'upload')} />
          </label>
        </div>
      </div>

      {items === null ? (
        <p className="muted small">Loading photos…</p>
      ) : items.length === 0 ? (
        <p className="muted small">No photos yet. Use “Take photo” to capture a label, ingredient panel, or nutrition facts.</p>
      ) : (
        <div className="photo-strip">
          {items.map((it, i) => {
            const url = urls[it.id];
            const resolved = it.id in urls;
            return (
              <div className="photo-thumb" key={it.id}>
                {url ? (
                  <img src={url} alt={it.name || 'photo'} loading="lazy" onClick={() => setLightbox(i)} />
                ) : (
                  <div className={`photo-ph ${resolved ? 'photo-ph-missing' : ''}`}>
                    {resolved ? '⚠' : '…'}
                  </div>
                )}
                {it.source && it.source !== 'upload' && <span className="photo-badge">{it.source}</span>}
                <button type="button" className="photo-del" title="Delete photo"
                  onClick={() => onDelete(it.id)} disabled={busy}>✕</button>
              </div>
            );
          })}
        </div>
      )}

      {err && <div className="alert alert-error">{err}</div>}

      {lightbox >= 0 && items?.[lightbox] && (
        <div className="photo-lightbox" onClick={() => setLightbox(-1)}>
          <button type="button" className="lb-close" onClick={() => setLightbox(-1)}>✕</button>
          {lightbox > 0 && (
            <button type="button" className="lb-nav lb-prev"
              onClick={(e) => { e.stopPropagation(); setLightbox(lightbox - 1); }}>‹</button>
          )}
          {urls[items[lightbox].id]
            ? <img src={urls[items[lightbox].id]} alt={items[lightbox].name || 'photo'}
                onClick={(e) => e.stopPropagation()} />
            : <div className="lb-missing" onClick={(e) => e.stopPropagation()}>Image unavailable offline</div>}
          {lightbox < items.length - 1 && (
            <button type="button" className="lb-nav lb-next"
              onClick={(e) => { e.stopPropagation(); setLightbox(lightbox + 1); }}>›</button>
          )}
        </div>
      )}
    </div>
  );
}
