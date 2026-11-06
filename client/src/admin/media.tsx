import { useCallback, useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { ApiError, apiUrl, del, get, patch, post, qs } from '../lib/api';
import { classifyVideoUrl } from '../lib/media';
import type { Localized } from '../lib/types';
import { useToast } from '../state/toast';
import { dt, ErrorBox, F, LocInput, Modal, Pager, Tabs, usePerms } from './kit';

/**
 * Media management for the admin: every image/video field accepts BOTH a direct upload from the
 * computer AND an external URL, plus re-use from the media library.
 *
 * Uploads: images are decoded in the browser and resized WebP copies (480/960/1600 px) are made
 * for fast responsive delivery; videos get a poster frame. The server then checks every file by
 * its real content (magic bytes) before it becomes usable.
 */
export type MediaAsset = {
  _id: string;
  kind: 'image' | 'video';
  source: 'upload' | 'external';
  status?: string;
  url: string;
  posterUrl?: string;
  variants?: { width: number; url: string; bytes?: number }[];
  width?: number;
  height?: number;
  durationSec?: number;
  bytes?: number;
  mime?: string;
  title?: string;
  filename?: string;
  alt?: Localized;
  videoProvider?: string;
  createdAt?: string;
};

export type GalleryImage = { url: string; alt: Localized; mediaId?: string | null; variants?: { width: number; url: string }[]; width?: number | null; height?: number | null };

type MediaConfig = { provider: string; uploadsEnabled: boolean; reason: string; maxImageMb: number; maxVideoMb: number; imageTypes: string[]; videoTypes: string[] };

let configPromise: Promise<MediaConfig> | null = null;
export function useMediaConfig() {
  const [cfg, setCfg] = useState<MediaConfig | null>(null);
  useEffect(() => {
    configPromise ??= get<MediaConfig>('/api/admin/media/config').catch((e) => {
      configPromise = null;
      throw e;
    });
    configPromise.then(setCfg).catch(() => setCfg(null));
  }, []);
  return cfg;
}

const emptyL: Localized = { ar: '', en: '' };
const MB = 1024 * 1024;
export const fmtBytes = (b?: number) => (!b ? '' : b >= MB ? `${(b / MB).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

// ---------------------------------------------------------------------------------------------
// Upload pipeline
// ---------------------------------------------------------------------------------------------

type Part = { role: string; blob: Blob; contentType: string; width?: number };

const VARIANT_WIDTHS = [480, 960, 1600];

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), type, quality));
}

/** Decodes the image and creates resized WebP variants (skipped for GIF and when unsupported). */
async function prepareImage(file: File): Promise<{ parts: Part[]; width?: number; height?: number }> {
  const parts: Part[] = [{ role: 'original', blob: file, contentType: file.type }];
  if (file.type === 'image/gif' || typeof createImageBitmap !== 'function') return { parts };
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file);
  } catch {
    return { parts }; // the server will judge the file itself
  }
  const { width, height } = bmp;
  for (const w of VARIANT_WIDTHS.filter((x) => x < width)) {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = Math.round((height * w) / width);
    const ctx = canvas.getContext('2d');
    if (!ctx) break;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await canvasToBlob(canvas, 'image/webp', 0.82);
    if (!blob || blob.type !== 'image/webp') break; // browser cannot encode WebP: keep original only
    parts.push({ role: `w${w}`, blob, contentType: 'image/webp', width: w });
  }
  bmp.close?.();
  return { parts, width, height };
}

/** Reads duration and grabs a poster frame (JPEG) from a video file. */
async function prepareVideo(file: File): Promise<{ parts: Part[]; width?: number; height?: number; durationSec?: number }> {
  const parts: Part[] = [{ role: 'original', blob: file, contentType: file.type }];
  const url = URL.createObjectURL(file);
  try {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.src = url;
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve();
      video.onerror = () => reject(new Error('Video could not be read'));
      setTimeout(() => reject(new Error('timeout')), 15000);
    });
    const durationSec = Number.isFinite(video.duration) ? Math.round(video.duration * 10) / 10 : undefined;
    video.currentTime = Math.min(1, (video.duration || 2) / 2);
    await new Promise<void>((resolve) => {
      video.onseeked = () => resolve();
      setTimeout(resolve, 4000);
    });
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0);
    const poster = canvas.width ? await canvasToBlob(canvas, 'image/jpeg', 0.85) : null;
    if (poster) parts.push({ role: 'poster', blob: poster, contentType: 'image/jpeg', width: canvas.width });
    return { parts, width: video.videoWidth || undefined, height: video.videoHeight || undefined, durationSec };
  } catch {
    return { parts };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function putFile(target: { url: string; headers: Record<string, string>; direct: boolean }, blob: Blob, onProgress: (loaded: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', target.direct ? target.url : apiUrl(target.url));
    xhr.withCredentials = !target.direct; // never send our session cookie to the storage bucket
    for (const [k, v] of Object.entries(target.headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => onProgress(e.loaded);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      let msg = `Upload failed (${xhr.status})`;
      try {
        msg = JSON.parse(xhr.responseText)?.error?.message ?? msg;
      } catch {
        /* storage XML error */
      }
      reject(new ApiError(xhr.status, 'UPLOAD_FAILED', msg));
    };
    xhr.onerror = () => reject(new ApiError(0, 'NETWORK', target.direct ? 'Upload to storage failed â€” check the bucket CORS settings (see docs/MEDIA-GUIDE.md)' : 'Network error during upload'));
    xhr.send(blob);
  });
}

export function acceptFor(kind: 'image' | 'video') {
  return kind === 'image' ? 'image/jpeg,image/png,image/webp,image/avif,image/gif' : 'video/mp4,video/webm';
}

export async function uploadMedia(file: File, kind: 'image' | 'video', cfg: MediaConfig | null, onProgress: (pct: number) => void): Promise<MediaAsset> {
  const allowed = kind === 'image' ? (cfg?.imageTypes ?? []) : (cfg?.videoTypes ?? []);
  const type = file.type === 'image/jpg' ? 'image/jpeg' : file.type;
  if (allowed.length && !allowed.includes(type)) throw new ApiError(400, 'TYPE', kind === 'image' ? 'Use a JPEG, PNG, WebP, AVIF or GIF image (SVG is not accepted for uploads).' : 'Use an MP4 or WebM video (convert .mov files to MP4 first).');
  const max = (kind === 'image' ? (cfg?.maxImageMb ?? 10) : (cfg?.maxVideoMb ?? 100)) * MB;
  if (file.size > max) throw new ApiError(400, 'SIZE', `File is too large â€” maximum ${Math.round(max / MB)} MB`);
  onProgress(1);
  const prepared = kind === 'image' ? await prepareImage(file) : await prepareVideo(file);
  const parts = prepared.parts;
  const created = await post<{ assetId: string; uploads: { role: string; url: string; headers: Record<string, string>; direct: boolean }[] }>('/api/admin/media/uploads', {
    kind,
    filename: file.name,
    title: file.name.replace(/\.[^.]+$/, ''),
    width: prepared.width,
    height: prepared.height,
    durationSec: (prepared as { durationSec?: number }).durationSec,
    parts: parts.map((p) => ({ role: p.role, contentType: p.contentType === 'image/jpg' ? 'image/jpeg' : p.contentType, size: p.blob.size, width: p.width })),
  });
  const total = parts.reduce((s, p) => s + p.blob.size, 0);
  const loaded: Record<string, number> = {};
  await Promise.all(
    created.uploads.map((u) => {
      const part = parts.find((p) => p.role === u.role)!;
      return putFile(u, part.blob, (n) => {
        loaded[u.role] = n;
        onProgress(Math.min(98, Math.round((Object.values(loaded).reduce((a, b) => a + b, 0) / total) * 100)));
      });
    }),
  );
  const asset = await post<MediaAsset>(`/api/admin/media/${created.assetId}/complete`);
  onProgress(100);
  return asset;
}

export function toGalleryImage(a: MediaAsset, alt?: Localized): GalleryImage {
  return {
    url: a.url,
    alt: alt && (alt.ar || alt.en) ? alt : (a.alt ?? emptyL),
    mediaId: a._id,
    variants: (a.variants ?? []).map((v) => ({ width: v.width, url: v.url })),
    width: a.width ?? null,
    height: a.height ?? null,
  };
}

// ---------------------------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------------------------

export function MediaPreview({ url, kind, poster, className = 'media-preview' }: { url: string; kind: 'image' | 'video'; poster?: string; className?: string }) {
  if (!url) return <div className={`${className} media-preview--empty`}>No {kind} selected</div>;
  if (kind === 'image') return <img className={className} src={url} alt="" loading="lazy" />;
  const v = classifyVideoUrl(url);
  if (!v) return <div className={`${className} media-preview--empty`}>Unsupported video link</div>;
  if (v.type === 'file') return <video className={className} src={v.url} poster={poster || undefined} muted controls playsInline preload="metadata" />;
  return <iframe className={className} src={v.embedUrl} title="Video preview" allow="autoplay; encrypted-media" loading="lazy" />;
}

// ---------------------------------------------------------------------------------------------
// Picker modal: Library | Upload | URL
// ---------------------------------------------------------------------------------------------

type PickTab = 'library' | 'upload' | 'url';

export function MediaPicker({ kind, onPick, onClose, initialTab = 'library', multiple = false }: { kind: 'image' | 'video'; onPick: (assets: MediaAsset[]) => void; onClose: () => void; initialTab?: PickTab; multiple?: boolean }) {
  const perms = usePerms();
  const canWrite = perms.has('media:write');
  const cfg = useMediaConfig();
  const [tab, setTab] = useState<PickTab>(initialTab === 'upload' && !canWrite ? 'url' : initialTab);
  const tabs: [PickTab, string][] = [['library', 'Media library'], ...(canWrite ? ([['upload', 'Upload from computer']] as [PickTab, string][]) : []), ['url', 'Use a URL']];
  return (
    <Modal title={kind === 'image' ? 'Choose image' : 'Choose video'} onClose={onClose} wide>
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'library' ? <LibraryGrid kind={kind} pickMode multiple={multiple} onPick={onPick} /> : null}
      {tab === 'upload' ? <UploadPanel kind={kind} cfg={cfg} multiple={multiple} onDone={onPick} /> : null}
      {tab === 'url' ? <UrlPanel kind={kind} canWrite={canWrite} onDone={(a) => onPick([a])} /> : null}
    </Modal>
  );
}

type UploadItem = { id: string; name: string; preview: string; pct: number; error?: string; asset?: MediaAsset };

function UploadPanel({ kind, cfg, multiple, onDone }: { kind: 'image' | 'video'; cfg: MediaConfig | null; multiple: boolean; onDone: (assets: MediaAsset[]) => void }) {
  const [items, setItems] = useState<UploadItem[]>([]);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const start = async (files: File[]) => {
    const list = (multiple ? files : files.slice(0, 1)).map((f) => ({ id: Math.random().toString(36).slice(2), file: f }));
    setItems((cur) => [...cur, ...list.map((it) => ({ id: it.id, name: it.file.name, preview: kind === 'image' ? URL.createObjectURL(it.file) : '', pct: 0 }))]);
    const done: MediaAsset[] = [];
    await Promise.all(
      list.map(async (it) => {
        try {
          const asset = await uploadMedia(it.file, kind, cfg, (pct) => setItems((cur) => cur.map((x) => (x.id === it.id ? { ...x, pct } : x))));
          done.push(asset);
          setItems((cur) => cur.map((x) => (x.id === it.id ? { ...x, pct: 100, asset } : x)));
        } catch (e) {
          setItems((cur) => cur.map((x) => (x.id === it.id ? { ...x, error: (e as Error).message } : x)));
        }
      }),
    );
    if (done.length) onDone(done);
  };
  if (cfg && !cfg.uploadsEnabled) return <p className="alert alert--warning">{cfg.reason}</p>;
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    void start([...e.dataTransfer.files]);
  };
  return (
    <div>
      <div
        className={`dropzone ${drag ? 'is-over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
        onClick={() => input.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
      >
        <strong>{multiple ? `Drop ${kind}s here or click to choose` : `Drop ${kind === 'image' ? 'an image' : 'a video'} here or click to choose`}</strong>
        <span className="muted">
          {kind === 'image' ? `JPEG, PNG, WebP, AVIF or GIF Â· up to ${cfg?.maxImageMb ?? 10} MB Â· resized WebP copies are created automatically` : `MP4 or WebM Â· up to ${cfg?.maxVideoMb ?? 100} MB Â· a poster frame is captured automatically`}
        </span>
        <input ref={input} type="file" hidden accept={acceptFor(kind)} multiple={multiple} onChange={(e) => e.target.files && void start([...e.target.files])} />
      </div>
      {items.length ? (
        <ul className="upload-list">
          {items.map((it) => (
            <li key={it.id}>
              {it.preview ? <img src={it.preview} alt="" /> : <span className="upload-list__icon">â–¶</span>}
              <div>
                <div className="upload-list__name">{it.name}</div>
                {it.error ? <div className="alert alert--error">{it.error}</div> : <progress max={100} value={it.pct} aria-label={`Upload progress ${it.name}`} />}
              </div>
              <span className="muted">{it.error ? 'Failed' : it.pct >= 100 ? 'Ready' : `${it.pct}%`}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function UrlPanel({ kind, canWrite, onDone }: { kind: 'image' | 'video'; canWrite: boolean; onDone: (a: MediaAsset) => void }) {
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [poster, setPoster] = useState('');
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const videoProblem = kind === 'video' && url.trim() && !classifyVideoUrl(url) ? 'Use an https link to an .mp4/.webm file, a YouTube video or a Vimeo video.' : '';
  const imageProblem = kind === 'image' && url.trim() && !/^(https:\/\/|\/(?!\/))/.test(url.trim()) ? 'Use a secure https:// link (or a site path starting with /).' : '';
  const submit = async () => {
    setErr(null);
    if (videoProblem || imageProblem || !url.trim()) return;
    if (!canWrite) {
      // No library permission: use the link directly without saving it to the library.
      onDone({ _id: '', kind, source: 'external', url: url.trim(), posterUrl: poster.trim() });
      return;
    }
    setBusy(true);
    try {
      onDone(await post<MediaAsset>('/api/admin/media/external', { kind, url: url.trim(), title: title.trim() || undefined, posterUrl: poster.trim() || undefined }));
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="form-grid form-grid--2">
      <div className="span-2">
        <ErrorBox error={err} />
      </div>
      <F label={kind === 'image' ? 'Image URL' : 'Video URL'} hint={kind === 'video' ? 'Direct .mp4/.webm link, YouTube or Vimeo. The link is checked, never downloaded by the server.' : 'https:// link to a JPEG, PNG, WebP, AVIF, GIF or SVG image.'} span>
        <input className="input ltr" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" />
        {videoProblem || imageProblem ? <span className="field-error">{videoProblem || imageProblem}</span> : null}
      </F>
      {kind === 'video' ? (
        <F label="Poster image URL (optional)" span>
          <input className="input ltr" value={poster} onChange={(e) => setPoster(e.target.value)} placeholder="https://" />
        </F>
      ) : null}
      {canWrite ? (
        <F label="Title in the library (optional)" span>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
        </F>
      ) : null}
      {url.trim() && !videoProblem && !imageProblem ? (
        <div className="span-2">
          <MediaPreview url={url.trim()} kind={kind} poster={poster} />
        </div>
      ) : null}
      <button type="button" className="btn btn--primary span-2" disabled={busy || !url.trim() || Boolean(videoProblem || imageProblem)} onClick={() => void submit()}>
        {canWrite ? 'Add to library and use' : 'Use this URL'}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Library grid (picker + library page)
// ---------------------------------------------------------------------------------------------

function LibraryGrid({ kind, pickMode, multiple, onPick, onOpen, refreshKey = 0 }: { kind?: 'image' | 'video'; pickMode?: boolean; multiple?: boolean; onPick?: (a: MediaAsset[]) => void; onOpen?: (a: MediaAsset) => void; refreshKey?: number }) {
  const [q, setQ] = useState('');
  const [source, setSource] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ items: MediaAsset[]; pages: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<MediaAsset[]>([]);
  useEffect(() => {
    const t = setTimeout(() => {
      fetch(apiUrl(`/api/admin/media${qs({ kind, q, source, page, limit: 40 })}`), { credentials: 'include', headers: { 'X-Requested-With': 'celibery' } })
        .then((r) => r.json())
        .then((j) => {
          if (!j.ok) throw new Error(j.error?.message ?? 'Could not load media');
          setData({ items: j.data, pages: j.meta?.pages ?? 1, total: j.meta?.total ?? j.data.length });
          setError(null);
        })
        .catch((e) => setError((e as Error).message));
    }, 200);
    return () => clearTimeout(t);
  }, [kind, q, source, page, refreshKey]);
  const toggle = (a: MediaAsset) => {
    if (!multiple) return onPick?.([a]);
    setSelected((cur) => (cur.some((x) => x._id === a._id) ? cur.filter((x) => x._id !== a._id) : [...cur, a]));
  };
  return (
    <div>
      <div className="toolbar">
        <input className="input" placeholder="Search by title, file name or URLâ€¦" value={q} onChange={(e) => (setQ(e.target.value), setPage(1))} aria-label="Search media" />
        <select className="select" value={source} onChange={(e) => (setSource(e.target.value), setPage(1))} aria-label="Source">
          <option value="">Uploads and URLs</option>
          <option value="upload">Uploaded files</option>
          <option value="external">External URLs</option>
        </select>
      </div>
      {error ? <p className="alert alert--error">{error}</p> : null}
      {!data ? <p className="muted">Loadingâ€¦</p> : null}
      {data && !data.items.length ? (
        <div className="empty-state">
          <strong>No {kind ?? 'media'} yet</strong>
          <span className="muted">Upload files or add links â€” they appear here and can be reused across products, banners and pages.</span>
        </div>
      ) : null}
      <div className="media-grid">
        {data?.items.map((a) => {
          const isSel = selected.some((x) => x._id === a._id);
          return (
            <button type="button" key={a._id} className={`media-tile ${isSel ? 'is-selected' : ''}`} onClick={() => (pickMode ? toggle(a) : onOpen?.(a))} title={a.title || a.url}>
              {a.kind === 'image' ? <img src={a.variants?.[0]?.url || a.url} alt="" loading="lazy" /> : a.posterUrl ? <img src={a.posterUrl} alt="" loading="lazy" /> : <span className="media-tile__video">â–¶ {a.videoProvider || 'video'}</span>}
              <span className="media-tile__meta">
                <span className="media-tile__title">{a.title || a.filename || a.url}</span>
                <span className="muted">
                  {a.source === 'upload' ? 'Upload' : 'URL'} {a.width && a.height ? `Â· ${a.width}Ã—${a.height}` : ''} {a.bytes ? `Â· ${fmtBytes(a.bytes)}` : ''}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      {data ? <Pager page={page} pages={data.pages} onPage={setPage} /> : null}
      {pickMode && multiple ? (
        <button type="button" className="btn btn--primary" disabled={!selected.length} onClick={() => onPick?.(selected)} style={{ marginTop: 12 }}>
          Use {selected.length || ''} selected
        </button>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// MediaField â€” one image or video, upload OR URL OR library
// ---------------------------------------------------------------------------------------------

export function MediaField({
  label,
  kind,
  value,
  onChange,
  hint,
  poster,
  span = true,
}: {
  label: string;
  kind: 'image' | 'video';
  value: string;
  onChange: (url: string, asset?: MediaAsset) => void;
  hint?: ReactNode;
  poster?: string;
  span?: boolean;
}) {
  const [picker, setPicker] = useState<PickTab | null>(null);
  const perms = usePerms();
  const videoProblem = kind === 'video' && value.trim() && !classifyVideoUrl(value) ? 'Unsupported video link â€” use .mp4/.webm, YouTube or Vimeo' : '';
  return (
    <div className={`field media-field ${span ? 'span-2' : ''}`}>
      <span className="label">{label}</span>
      <div className="media-field__row">
        <MediaPreview url={videoProblem ? '' : value} kind={kind} poster={poster} />
        <div className="media-field__controls">
          <div className="media-field__buttons">
            {perms.has('media:write') ? (
              <button type="button" className="btn btn--outline btn--sm" onClick={() => setPicker('upload')}>
                Upload
              </button>
            ) : null}
            <button type="button" className="btn btn--outline btn--sm" onClick={() => setPicker('library')}>
              Library
            </button>
            {value ? (
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => onChange('')}>
                Remove
              </button>
            ) : null}
          </div>
          <input className="input ltr" value={value} placeholder={kind === 'video' ? 'or paste a video URL (https://â€¦)' : 'or paste an image URL (https://â€¦)'} onChange={(e) => onChange(e.target.value)} aria-label={`${label} URL`} />
          {videoProblem ? <span className="field-error">{videoProblem}</span> : null}
          {hint ? <span className="hint">{hint}</span> : null}
        </div>
      </div>
      {picker ? (
        <MediaPicker
          kind={kind}
          initialTab={picker}
          onClose={() => setPicker(null)}
          onPick={(assets) => {
            const a = assets[0];
            if (a) onChange(a.url, a);
            setPicker(null);
          }}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Product gallery â€” multiple images, primary, reorder, replace, remove, alt text
// ---------------------------------------------------------------------------------------------

export function ImageGallery({ images, onChange, max = 12 }: { images: GalleryImage[]; onChange: (next: GalleryImage[]) => void; max?: number }) {
  const [picker, setPicker] = useState<{ tab: PickTab; replace?: number } | null>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [editAlt, setEditAlt] = useState<number | null>(null);
  const [uploading, setUploading] = useState<{ id: string; preview: string; pct: number; error?: string }[]>([]);
  const perms = usePerms();
  const cfg = useMediaConfig();
  const toast = useToast();
  const latest = useRef(images);
  latest.current = images;

  const move = (from: number, to: number) => {
    if (to < 0 || to >= images.length || from === to) return;
    const next = [...images];
    const [x] = next.splice(from, 1);
    next.splice(to, 0, x);
    onChange(next);
  };
  const add = useCallback(
    (list: GalleryImage[]) => {
      const merged = [...latest.current, ...list.filter((g) => !latest.current.some((x) => x.url === g.url))].slice(0, max);
      latest.current = merged;
      onChange(merged);
    },
    [max, onChange],
  );
  const uploadFiles = async (files: File[]) => {
    const room = max - images.length;
    if (room <= 0) return toast(`A product can have up to ${max} images`, 'error');
    for (const file of files.slice(0, room)) {
      const id = Math.random().toString(36).slice(2);
      setUploading((u) => [...u, { id, preview: URL.createObjectURL(file), pct: 0 }]);
      try {
        const asset = await uploadMedia(file, 'image', cfg, (pct) => setUploading((u) => u.map((x) => (x.id === id ? { ...x, pct } : x))));
        add([toGalleryImage(asset)]);
        setUploading((u) => u.filter((x) => x.id !== id));
      } catch (e) {
        setUploading((u) => u.map((x) => (x.id === id ? { ...x, error: (e as Error).message } : x)));
      }
    }
  };
  const onDropFiles = (e: DragEvent) => {
    if (!e.dataTransfer.files.length) return;
    e.preventDefault();
    if (!perms.has('media:write')) return toast('You need the media permission to upload files', 'error');
    void uploadFiles([...e.dataTransfer.files].filter((f) => f.type.startsWith('image/')));
  };

  return (
    <div className="gallery-editor" onDragOver={(e) => e.dataTransfer.types.includes('Files') && e.preventDefault()} onDrop={onDropFiles}>
      <div className="gallery-editor__grid">
        {images.map((im, i) => (
          <div
            key={`${im.url}-${i}`}
            className={`gallery-tile ${dragFrom === i ? 'is-dragging' : ''}`}
            draggable
            onDragStart={() => setDragFrom(i)}
            onDragEnd={() => setDragFrom(null)}
            onDragOver={(e) => dragFrom !== null && e.preventDefault()}
            onDrop={(e) => {
              if (dragFrom === null) return;
              e.preventDefault();
              e.stopPropagation();
              move(dragFrom, i);
              setDragFrom(null);
            }}
          >
            <img src={im.variants?.[0]?.url || im.url} alt={im.alt?.en || ''} loading="lazy" />
            {i === 0 ? <span className="gallery-tile__badge">Main photo</span> : null}
            {!im.variants?.length && /^http:\/\//.test(im.url) ? <span className="gallery-tile__warn" title="Insecure http:// link â€” browsers may block it">http</span> : null}
            <div className="gallery-tile__actions">
              <button type="button" className="icon-btn" aria-label="Move earlier" disabled={i === 0} onClick={() => move(i, i - 1)}>
                â€¹
              </button>
              <button type="button" className="icon-btn" aria-label="Move later" disabled={i === images.length - 1} onClick={() => move(i, i + 1)}>
                â€º
              </button>
              {i !== 0 ? (
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => move(i, 0)}>
                  Make main
                </button>
              ) : null}
            </div>
            <div className="gallery-tile__actions">
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setPicker({ tab: 'library', replace: i })}>
                Replace
              </button>
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setEditAlt(editAlt === i ? null : i)}>
                Alt text
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--sm danger"
                onClick={() => {
                  if (window.confirm('Remove this image from the product? (The file stays in the media library.)')) onChange(images.filter((_, j) => j !== i));
                }}
              >
                Remove
              </button>
            </div>
          </div>
        ))}
        {uploading.map((u) => (
          <div key={u.id} className="gallery-tile is-uploading">
            <img src={u.preview} alt="" />
            {u.error ? (
              <div className="alert alert--error" style={{ fontSize: 12 }}>
                {u.error}{' '}
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => setUploading((x) => x.filter((y) => y.id !== u.id))}>
                  Dismiss
                </button>
              </div>
            ) : (
              <progress max={100} value={u.pct} aria-label="Upload progress" />
            )}
          </div>
        ))}
        {images.length < max ? (
          <div className="gallery-tile gallery-tile--add">
            {perms.has('media:write') ? (
              <label className="btn btn--outline btn--sm">
                Upload images
                <input type="file" hidden multiple accept={acceptFor('image')} onChange={(e) => e.target.files && void uploadFiles([...e.target.files])} />
              </label>
            ) : null}
            <button type="button" className="btn btn--outline btn--sm" onClick={() => setPicker({ tab: 'library' })}>
              From library
            </button>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setPicker({ tab: 'url' })}>
              Add URL
            </button>
            <span className="muted" style={{ fontSize: 12 }}>
              or drop image files here
            </span>
          </div>
        ) : null}
      </div>
      {editAlt !== null && images[editAlt] ? (
        <div className="form-grid form-grid--2" style={{ marginTop: 12 }}>
          <LocInput label={`Alt text â€” image ${editAlt + 1} (describes the photo for screen readers and search engines)`} value={images[editAlt].alt} onChange={(v) => onChange(images.map((x, j) => (j === editAlt ? { ...x, alt: v } : x)))} />
        </div>
      ) : null}
      {picker ? (
        <MediaPicker
          kind="image"
          initialTab={picker.tab}
          multiple={picker.replace === undefined}
          onClose={() => setPicker(null)}
          onPick={(assets) => {
            if (picker.replace !== undefined) {
              const a = assets[0];
              if (a) onChange(images.map((x, j) => (j === picker.replace ? { ...(a._id ? toGalleryImage(a, x.alt) : { url: a.url, alt: x.alt }) } : x)));
            } else add(assets.map((a) => (a._id ? toGalleryImage(a) : { url: a.url, alt: emptyL })));
            setPicker(null);
          }}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Media library page
// ---------------------------------------------------------------------------------------------

type Usage = { type: string; id: string; label: string; field: string; live: boolean }[];

export function MediaLibraryPage() {
  const [kind, setKind] = useState<'image' | 'video'>('image');
  const [refresh, setRefresh] = useState(0);
  const [open, setOpen] = useState<MediaAsset | null>(null);
  const [adding, setAdding] = useState<PickTab | null>(null);
  const cfg = useMediaConfig();
  return (
    <>
      <div className="a-head">
        <h1>Media library</h1>
        <div className="actions">
          <button className="btn btn--primary btn--sm" onClick={() => setAdding('upload')} disabled={cfg ? !cfg.uploadsEnabled : false}>
            Upload {kind}s
          </button>
          <button className="btn btn--outline btn--sm" onClick={() => setAdding('url')}>
            Add {kind} URL
          </button>
        </div>
      </div>
      {cfg && !cfg.uploadsEnabled ? <p className="alert alert--warning">{cfg.reason}</p> : null}
      <Tabs
        tabs={[
          ['image', 'Images'],
          ['video', 'Videos'],
        ]}
        value={kind}
        onChange={setKind}
      />
      <section className="a-card media-library-card">
        <LibraryGrid kind={kind} onOpen={setOpen} refreshKey={refresh} />
      </section>
      {adding ? (
        <MediaPicker
          kind={kind}
          initialTab={adding}
          multiple
          onClose={() => setAdding(null)}
          onPick={() => {
            setAdding(null);
            setRefresh((n) => n + 1);
          }}
        />
      ) : null}
      {open ? (
        <AssetDetails
          asset={open}
          onClose={() => setOpen(null)}
          onChanged={() => {
            setOpen(null);
            setRefresh((n) => n + 1);
          }}
        />
      ) : null}
    </>
  );
}

function AssetDetails({ asset, onClose, onChanged }: { asset: MediaAsset; onClose: () => void; onChanged: () => void }) {
  const [title, setTitle] = useState(asset.title ?? '');
  const [alt, setAlt] = useState<Localized>(asset.alt ?? emptyL);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const toast = useToast();
  useEffect(() => {
    get<Usage>(`/api/admin/media/${asset._id}/usage`)
      .then(setUsage)
      .catch(() => setUsage([]));
  }, [asset._id]);
  const save = async () => {
    setErr(null);
    try {
      await patch(`/api/admin/media/${asset._id}`, { title, alt });
      toast('Saved');
      onChanged();
    } catch (e) {
      setErr(e);
    }
  };
  const remove = async (confirmOrders = false) => {
    setErr(null);
    try {
      await del(`/api/admin/media/${asset._id}${confirmOrders ? '?confirmOrders=1' : ''}`);
      toast('Deleted');
      onChanged();
    } catch (e) {
      const ex = e as ApiError;
      if (ex.code === 'MEDIA_IN_ORDER_HISTORY' && window.confirm(`${ex.message}\n\nDelete anyway?`)) return remove(true);
      setErr(e);
    }
  };
  const live = (usage ?? []).filter((u) => u.live);
  return (
    <Modal title={asset.title || 'Media details'} onClose={onClose} wide>
      <ErrorBox error={err} />
      <div className="asset-details">
        <MediaPreview url={asset.url} kind={asset.kind} poster={asset.posterUrl} className="media-preview media-preview--large" />
        <div className="form-grid">
          <dl className="kv">
            <dt>Source</dt>
            <dd>{asset.source === 'upload' ? 'Uploaded file' : `External URL${asset.videoProvider ? ` (${asset.videoProvider})` : ''}`}</dd>
            <dt>URL</dt>
            <dd className="ltr" style={{ wordBreak: 'break-all' }}>
              {asset.url}{' '}
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => void navigator.clipboard?.writeText(asset.url).then(() => toast('URL copied'))}>
                Copy
              </button>
            </dd>
            {asset.width ? (
              <>
                <dt>Dimensions</dt>
                <dd>
                  {asset.width}Ã—{asset.height}
                </dd>
              </>
            ) : null}
            {asset.bytes ? (
              <>
                <dt>Size</dt>
                <dd>
                  {fmtBytes(asset.bytes)} {asset.mime ? `Â· ${asset.mime}` : ''}
                </dd>
              </>
            ) : null}
            {asset.variants?.length ? (
              <>
                <dt>Responsive copies</dt>
                <dd>{asset.variants.map((v) => `${v.width}px`).join(', ')} (WebP)</dd>
              </>
            ) : null}
            <dt>Added</dt>
            <dd>{dt(asset.createdAt)}</dd>
          </dl>
          <F label="Title">
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
          </F>
          <LocInput label="Default alt text" value={alt} onChange={setAlt} />
          <div className="field">
            <span className="label">Where it is used</span>
            {usage === null ? <span className="muted">Checkingâ€¦</span> : usage.length ? (
              <ul className="usage-list">
                {usage.map((u, i) => (
                  <li key={i}>
                    <span className={`badge ${u.live ? 'badge--warning' : ''}`}>{u.type}</span> {u.label}
                  </li>
                ))}
              </ul>
            ) : (
              <span className="muted">Not used anywhere</span>
            )}
          </div>
          <div className="actions">
            <button type="button" className="btn btn--primary btn--sm" onClick={() => void save()}>
              Save details
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--sm danger"
              disabled={live.length > 0}
              title={live.length ? 'Replace it where it is used before deleting' : undefined}
              onClick={() => {
                if (window.confirm(asset.source === 'upload' ? 'Delete this file permanently?' : 'Remove this link from the library? (Content that uses the link is not changed.)')) void remove();
              }}
            >
              Delete
            </button>
          </div>
          {live.length ? <p className="muted" style={{ fontSize: 13 }}>In use â€” replace it in the places above before deleting, so nothing on the website breaks.</p> : null}
        </div>
      </div>
    </Modal>
  );
}


