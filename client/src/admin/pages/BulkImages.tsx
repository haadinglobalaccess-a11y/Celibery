import { useMemo, useState } from 'react';
import { ApiError, post } from '../../lib/api';
import type { Localized } from '../../lib/types';
import { ErrorBox, Modal, usePerms } from '../kit';
import { acceptFor, uploadMedia, useMediaConfig } from '../media';

/**
 * Bulk product photos. The graphics team names each file after the product SKU
 * (CEL-PB-20000-1.jpg, CEL-PB-20000-2.jpg, …), drops all files here at once, checks the list, and
 * every photo is uploaded and put on its product in number order. Nothing else on the product changes.
 */
type Match = { file: string; sku: string | null; position?: number; productId?: string; name?: Localized; currentImages?: number };
type Line = Match & { f: File; duplicate: boolean; state: 'waiting' | 'uploading' | 'done' | 'failed'; error?: string; mediaId?: string };
type Result = { sku: string; ok: boolean; images?: number; error?: string };

const CONCURRENCY = 3;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function BulkImagesModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const cfg = useMediaConfig();
  const canUpload = usePerms().has('media:write');
  const [lines, setLines] = useState<Line[]>([]);
  const [mode, setMode] = useState<'replace' | 'append'>('replace');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [results, setResults] = useState<Result[] | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const pick = async (list: FileList | File[]) => {
    const files = [...list].filter((f) => f.type.startsWith('image/')).slice(0, 500);
    if (!files.length) return;
    setErr(null);
    setResults(null);
    setBusy(true);
    try {
      const matches = await post<Match[]>('/api/admin/products/images/match', { files: files.map((f) => f.name) });
      const seen = new Set<string>();
      const next = matches.map((m, i) => {
        const key = `${m.sku}#${m.position}`;
        const duplicate = Boolean(m.sku) && seen.has(key);
        if (m.sku) seen.add(key);
        return { ...m, f: files[i], duplicate, state: 'waiting' as const };
      });
      next.sort((a, b) => (a.sku ?? '￿').localeCompare(b.sku ?? '￿') || (a.position ?? 0) - (b.position ?? 0));
      setLines(next);
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  };

  const ready = lines.filter((l) => l.sku && !l.duplicate);
  const products = useMemo(() => {
    const m = new Map<string, { name?: Localized; current: number; files: number }>();
    for (const l of ready) {
      const p = m.get(l.sku!) ?? { name: l.name, current: l.currentImages ?? 0, files: 0 };
      p.files++;
      m.set(l.sku!, p);
    }
    return m;
  }, [ready]);
  const withPhotos = [...products.values()].filter((p) => p.current > 0).length;
  const unmatched = lines.filter((l) => !l.sku).length;
  const duplicates = lines.filter((l) => l.duplicate).length;
  const done = lines.filter((l) => l.state === 'done').length;

  const setLine = (file: File, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.f === file ? { ...l, ...patch } : l)));

  const uploadOne = async (l: Line): Promise<string | null> => {
    setLine(l.f, { state: 'uploading', error: undefined });
    for (let attempt = 1; ; attempt++) {
      try {
        const asset = await uploadMedia(l.f, 'image', cfg, () => undefined);
        setLine(l.f, { state: 'done', mediaId: asset._id });
        return asset._id;
      } catch (e) {
        // Busy server or rate limit: wait and try again (twice); anything else is reported on the line.
        if (attempt < 3 && e instanceof ApiError && (e.status === 429 || e.status === 0 || e.status >= 500)) {
          await wait(attempt * 4000);
          continue;
        }
        setLine(l.f, { state: 'failed', error: e instanceof Error ? e.message : 'Upload failed' });
        return null;
      }
    }
  };

  const run = async () => {
    setBusy(true);
    setErr(null);
    setResults(null);
    try {
      const ids = new Map<File, string>();
      const queue = ready.filter((l) => l.state !== 'done' || !l.mediaId);
      for (const l of ready) if (l.state === 'done' && l.mediaId) ids.set(l.f, l.mediaId);
      let next = 0;
      await Promise.all(
        Array.from({ length: CONCURRENCY }, async () => {
          while (next < queue.length) {
            const l = queue[next++];
            const id = await uploadOne(l);
            if (id) ids.set(l.f, id);
          }
        }),
      );
      // A product is changed only when every one of its photos uploaded (no half-replaced galleries).
      const bySku = new Map<string, Line[]>();
      for (const l of ready) bySku.set(l.sku!, [...(bySku.get(l.sku!) ?? []), l]);
      const items: { sku: string; mediaIds: string[] }[] = [];
      const skipped: Result[] = [];
      for (const [sku, ls] of bySku) {
        const sorted = [...ls].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
        if (sorted.every((l) => ids.has(l.f))) items.push({ sku, mediaIds: sorted.map((l) => ids.get(l.f)!) });
        else skipped.push({ sku, ok: false, error: 'A photo failed to upload, so this product was not changed. Press “Upload and attach” again to retry.' });
      }
      const attached = items.length ? await post<Result[]>('/api/admin/products/images/attach', { mode, items }) : [];
      setResults([...attached, ...skipped]);
      if (attached.some((r) => r.ok)) onDone();
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  };

  const okCount = results?.filter((r) => r.ok).length ?? 0;

  return (
    <Modal title="Bulk product photos" onClose={busy ? () => undefined : onClose} wide>
      <p className="muted">
        Name each photo after the product SKU and its number: <code>CEL-PB-20000-1.jpg</code>, <code>CEL-PB-20000-2.jpg</code> … Photo 1 is the main photo. A file named just <code>CEL-PB-20000.jpg</code> counts as photo 1. Select or drop all photos at once; only the photos of each product change.
      </p>
      {!canUpload ? <p className="alert alert--warning">Your role cannot upload media. Ask an administrator for the “media” permission.</p> : null}
      {cfg && !cfg.uploadsEnabled ? <p className="alert alert--warning">Uploads are not available: {cfg.reason}</p> : null}

      <label
        className="a-card"
        style={{ display: 'block', textAlign: 'center', padding: 24, border: `2px dashed ${dragOver ? 'var(--a-accent, #1f3a5f)' : 'var(--a-line, #cfd6df)'}`, cursor: busy ? 'default' : 'pointer', marginTop: 12 }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (!busy) void pick(e.dataTransfer.files);
        }}
      >
        <input type="file" multiple accept={acceptFor('image')} disabled={busy || !canUpload} style={{ display: 'none' }} onChange={(e) => e.target.files && void pick(e.target.files)} />
        <strong>Drop photos here or click to choose</strong>
        <div className="muted" style={{ marginTop: 4 }}>JPEG, PNG, WebP or AVIF · up to 500 files</div>
      </label>

      <ErrorBox error={err} />

      {lines.length ? (
        <>
          <div className="alert" style={{ marginTop: 12 }}>
            {ready.length} photos for {products.size} products
            {unmatched ? <> · <strong>{unmatched} not matched</strong> (no product has that SKU: rename the file)</> : null}
            {duplicates ? <> · <strong>{duplicates} duplicate numbers</strong> (two files with the same SKU and number: only the first is used)</> : null}
            {busy && done ? <> · uploaded {done} of {ready.length}</> : null}
          </div>

          <fieldset style={{ border: 0, padding: 0, margin: '12px 0' }}>
            <legend className="muted" style={{ marginBottom: 4 }}>Products that already have photos ({withPhotos})</legend>
            <label style={{ marginInlineEnd: 16 }}>
              <input type="radio" name="bulk-mode" checked={mode === 'replace'} onChange={() => setMode('replace')} disabled={busy} /> Replace their photos with these
            </label>
            <label>
              <input type="radio" name="bulk-mode" checked={mode === 'append'} onChange={() => setMode('append')} disabled={busy} /> Keep their photos and add these after them
            </label>
          </fieldset>

          <div className="a-table-wrap" style={{ maxHeight: 320, overflow: 'auto' }}>
            <table className="a-table">
              <thead>
                <tr>
                  <th>File</th>
                  <th>Product</th>
                  <th className="num">Photo #</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.file + (l.f.lastModified ?? '')}>
                    <td style={{ wordBreak: 'break-all' }}>{l.file}</td>
                    <td>{l.sku ? <>{l.sku} <span className="muted">{l.name?.en || l.name?.ar}</span></> : <strong style={{ color: 'var(--danger, #b42318)' }}>No product with this SKU</strong>}</td>
                    <td className="num">{l.position ?? '—'}</td>
                    <td>
                      {l.duplicate ? 'Skipped (duplicate)' : !l.sku ? 'Skipped' : l.state === 'uploading' ? 'Uploading…' : l.state === 'done' ? 'Uploaded' : l.state === 'failed' ? <span style={{ color: 'var(--danger, #b42318)' }}>{l.error}</span> : l.currentImages ? `Has ${l.currentImages} photo${l.currentImages === 1 ? '' : 's'}` : 'Ready'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {results ? (
        <div className={`alert ${results.every((r) => r.ok) ? 'alert--success' : 'alert--warning'}`} style={{ marginTop: 12 }}>
          Photos saved on {okCount} product{okCount === 1 ? '' : 's'}.
          {results.some((r) => !r.ok) ? (
            <ul>
              {results.filter((r) => !r.ok).map((r) => (
                <li key={r.sku}>
                  {r.sku}: {r.error}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <div className="actions" style={{ marginTop: 16 }}>
        <button className="btn btn--outline" disabled={busy} onClick={onClose}>
          {results ? 'Close' : 'Cancel'}
        </button>
        <button className="btn btn--primary" disabled={busy || !ready.length || !canUpload || (cfg ? !cfg.uploadsEnabled : true)} onClick={() => void run()}>
          {busy ? 'Working…' : `Upload and attach ${ready.length} photo${ready.length === 1 ? '' : 's'}`}
        </button>
      </div>
    </Modal>
  );
}
