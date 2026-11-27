import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { ApiError, del, patch, post, put } from '../../lib/api';
import { useApi, useDebounced } from '../../lib/hooks';
import type { Localized } from '../../lib/types';
import { useToast } from '../../state/toast';
import '../homeVideos.css';
import { MediaField, MediaPicker, fmtBytes, useMediaConfig, type MediaAsset } from '../media';
import { AHead, Card, dt, EmptyState, ErrorBox, ErrorPanel, F, LocInput, Modal, SkeletonTable, usePerms } from '../kit';

/**
 * Admin → Website → Homepage videos. Up to eight positions on the homepage (count from the server), each filled with a saved,
 * published video. Videos come from a link (YouTube, Vimeo, Facebook, ImageKit, Cloudinary, direct .mp4/.webm) or an
 * uploaded file (media library → object storage). Everything the homepage shows is read from
 * /api/home/videos, i.e. from what is saved here. Permission: content:write; uploading and
 * deleting stored files also need media:write (enforced by the API).
 */

type Provider = 'youtube' | 'vimeo' | 'facebook' | 'file';
type Availability = { status: 'ok' | 'unverified' | 'unavailable'; message: string; checkedAt?: string };
type Display = { fit: 'cover' | 'contain'; mutedPreview: boolean; loop: boolean; startAt: number };
type Video = {
  _id: string;
  sourceType: 'url' | 'upload';
  provider: Provider;
  url: string;
  media: { _id: string; filename?: string; bytes?: number; durationSec?: number; status?: string } | null;
  title: Localized;
  description: Localized;
  posterUrl: string;
  posterMedia: string | null;
  posterAlt: Localized;
  position: number | null;
  active: boolean;
  archived: boolean;
  display: Display;
  availability: Availability;
  updatedAt: string;
};
type Section = { enabled: boolean; eyebrow: Localized; title: Localized; subtitle: Localized };
type Payload = { videos: Video[]; section: Section; positions: number };
type Inspect =
  | { ok: false; reason: string }
  | { ok: true; provider: Provider; embedUrl: string | null; fileUrl: string | null; suggestedPoster: string; availability: Availability };

type Draft = {
  _id?: string;
  sourceType: 'url' | 'upload';
  url: string;
  mediaId: string;
  mediaLabel: string;
  mediaUrl: string;
  mediaPoster: string;
  title: Localized;
  description: Localized;
  posterUrl: string;
  posterMediaId: string | null;
  posterAlt: Localized;
  position: number | null;
  active: boolean;
  display: Display;
};

const EMPTY: Localized = { ar: '', en: '' };
const PROVIDER: Record<Provider, string> = { youtube: 'YouTube', vimeo: 'Vimeo', facebook: 'Facebook', file: 'Video file' };
const nameOf = (v: { title: Localized }) => v.title.en || v.title.ar || 'Untitled video';
const errText = (e: unknown) => (e instanceof ApiError ? e.message : 'Something went wrong. Please try again.');

function Chip({ tone, children }: { tone: 'ok' | 'muted' | 'bad' | 'warn'; children: string }) {
  const cls = tone === 'ok' ? 'st--paid' : tone === 'bad' ? 'st--negative' : tone === 'warn' ? 'st--cod' : 'st--neutral';
  return (
    <span className={`st ${cls}`}>
      <span className="st__dot" aria-hidden="true" />
      {children}
    </span>
  );
}
const availabilityChip = (a?: Availability) =>
  a?.status === 'ok' ? <Chip tone="ok">Checked</Chip> : a?.status === 'unavailable' ? <Chip tone="bad">Unavailable</Chip> : <Chip tone="warn">Check preview</Chip>;

function Thumb({ v }: { v: Pick<Video, 'posterUrl' | 'provider'> }) {
  const [broken, setBroken] = useState(false);
  return v.posterUrl && !broken ? (
    <img className="hv-admin__thumb" src={v.posterUrl} alt="" loading="lazy" onError={() => setBroken(true)} />
  ) : (
    <span className="hv-admin__thumb hv-admin__thumb--empty">{PROVIDER[v.provider]}</span>
  );
}

export function HomeVideosAdmin() {
  const [nonce, setNonce] = useState(0);
  const { data, error, loading, reload } = useApi<Payload>(`/api/admin/home-videos?r=${nonce}`);
  const [editing, setEditing] = useState<Draft | null>(null);
  const [deleting, setDeleting] = useState<Video | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const refresh = () => setNonce((n) => n + 1);

  const videos = useMemo(() => data?.videos ?? [], [data]);
  const positions = data?.positions ?? 4;
  const slots = useMemo(() => Array.from({ length: positions }, (_, i) => videos.find((v) => v.position === i + 1) ?? null), [videos, positions]);
  const unplaced = videos.filter((v) => !v.archived && v.position == null);
  const archived = videos.filter((v) => v.archived);

  const run = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await fn();
      toast(done);
      refresh();
    } catch (e) {
      toast(errText(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  const saveSlots = (next: (string | null)[]) => run(() => put('/api/admin/home-videos/slots', { slots: next }), 'Homepage order saved');
  const slotIds = () => slots.map((s) => s?._id ?? null);
  const move = (from: number, to: number) => {
    const next = slotIds();
    [next[from], next[to]] = [next[to], next[from]];
    void saveSlots(next);
  };
  const placeIn = (index: number, id: string | null) => {
    const next = slotIds().map((x) => (x === id ? null : x));
    next[index] = id;
    void saveSlots(next);
  };

  const newDraft = (position: number | null = null): Draft => ({
    sourceType: 'url',
    url: '',
    mediaId: '',
    mediaLabel: '',
    mediaUrl: '',
    mediaPoster: '',
    title: { ...EMPTY },
    description: { ...EMPTY },
    posterUrl: '',
    posterMediaId: null,
    posterAlt: { ...EMPTY },
    position,
    active: false,
    display: { fit: 'cover', mutedPreview: false, loop: false, startAt: 0 },
  });
  const editDraft = (v: Video): Draft => ({
    _id: v._id,
    sourceType: v.sourceType,
    url: v.sourceType === 'url' ? v.url : '',
    mediaId: v.media?._id ?? '',
    mediaLabel: v.media?.filename ?? '',
    mediaUrl: v.sourceType === 'upload' ? v.url : '',
    mediaPoster: '',
    title: { ...EMPTY, ...v.title },
    description: { ...EMPTY, ...v.description },
    posterUrl: v.posterUrl,
    posterMediaId: v.posterMedia,
    posterAlt: { ...EMPTY, ...v.posterAlt },
    position: v.position,
    active: v.active,
    display: { ...{ fit: 'cover' as const, mutedPreview: false, loop: false, startAt: 0 }, ...v.display },
  });

  return (
    <div className="a-page" data-testid="admin-home-videos">
      <AHead title="Homepage videos">
        <button className="btn btn--primary" onClick={() => setEditing(newDraft())} data-testid="hv-add">
          Add video
        </button>
      </AHead>
      <p className="a-muted" style={{ marginTop: -8 }}>
        The video section on the homepage (
        <a href="/en" target="_blank" rel="noreferrer">
          view store
        </a>
        ). Up to {positions} positions. Only <strong>published</strong> videos placed in a position are shown; empty positions are simply left out.
      </p>

      {error ? <ErrorPanel onRetry={reload} /> : null}
      {loading && !data ? <SkeletonTable rows={4} cols={4} /> : null}

      {data ? (
        <>
          <SectionSettings section={data.section} onSaved={refresh} />

          <Card title="Positions on the homepage">
            <ol className="hv-admin__slots" data-testid="hv-slots">
              {slots.map((v, i) => (
                <li key={i} className={`hv-admin__slot ${v ? '' : 'is-empty'}`} data-testid={`hv-slot-${i + 1}`}>
                  <div className="hv-admin__slot-head">
                    <strong>Position {i + 1}</strong>
                    <span className="hv-admin__move">
                      <button type="button" className="btn btn--ghost btn--sm" disabled={busy || !v || i === 0} onClick={() => move(i, i - 1)} aria-label={`Move position ${i + 1} earlier`}>
                        ←
                      </button>
                      <button type="button" className="btn btn--ghost btn--sm" disabled={busy || !v || i === positions - 1} onClick={() => move(i, i + 1)} aria-label={`Move position ${i + 1} later`}>
                        →
                      </button>
                    </span>
                  </div>
                  {v ? (
                    <>
                      <Thumb v={v} />
                      <div className="hv-admin__title">{nameOf(v)}</div>
                      <div className="hv-admin__chips">
                        {v.active ? <Chip tone="ok">Published</Chip> : <Chip tone="muted">Draft — not shown</Chip>}
                        <Chip tone="muted">{PROVIDER[v.provider]}</Chip>
                        {availabilityChip(v.availability)}
                      </div>
                      <div className="hv-admin__actions">
                        <button type="button" className="btn btn--outline btn--sm" onClick={() => setEditing(editDraft(v))}>
                          Edit
                        </button>
                        <button type="button" className="btn btn--outline btn--sm" disabled={busy} onClick={() => run(() => patch(`/api/admin/home-videos/${v._id}/status`, { active: !v.active }), v.active ? 'Hidden from the homepage' : 'Published')}>
                          {v.active ? 'Unpublish' : 'Publish'}
                        </button>
                        <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => placeIn(i, null)}>
                          Remove from position
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className="hv-admin__empty">
                      <span className="a-muted">Empty — nothing is shown here.</span>
                      {unplaced.length ? (
                        <select className="a-select" value="" disabled={busy} onChange={(e) => e.target.value && placeIn(i, e.target.value)} aria-label={`Place a video in position ${i + 1}`}>
                          <option value="">Place a saved video…</option>
                          {unplaced.map((u) => (
                            <option key={u._id} value={u._id}>
                              {nameOf(u)} ({PROVIDER[u.provider]}{u.active ? '' : ', draft'})
                            </option>
                          ))}
                        </select>
                      ) : null}
                      <button type="button" className="btn btn--outline btn--sm" onClick={() => setEditing(newDraft(i + 1))}>
                        Add a new video here
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ol>
          </Card>

          <Card title="Saved videos not on the homepage">
            {unplaced.length ? <VideoTable videos={unplaced} busy={busy} onEdit={(v) => setEditing(editDraft(v))} onDelete={setDeleting} onArchive={(v) => run(() => patch(`/api/admin/home-videos/${v._id}/archive`, { archived: true }), 'Archived')} /> : <p className="a-muted">None. Videos you remove from a position stay here until you delete or archive them.</p>}
          </Card>

          {archived.length ? (
            <Card title="Archive">
              <VideoTable videos={archived} busy={busy} archivedList onDelete={setDeleting} onRestore={(v) => run(() => patch(`/api/admin/home-videos/${v._id}/archive`, { archived: false }), 'Restored (as a draft, not placed)')} />
            </Card>
          ) : null}

          {!videos.length ? <EmptyState title="No videos yet" text="Add a YouTube, Vimeo, Facebook, ImageKit or Cloudinary link, a direct video file link, or upload a video. Nothing appears on the homepage until you publish a video and place it in a position." /> : null}
        </>
      ) : null}

      {editing ? (
        <VideoEditor
          draft={editing}
          positions={positions}
          occupied={slots}
          onClose={() => setEditing(null)}
          onSaved={(msg) => {
            setEditing(null);
            toast(msg);
            refresh();
          }}
        />
      ) : null}
      {deleting ? (
        <DeleteDialog
          video={deleting}
          onClose={() => setDeleting(null)}
          onDone={(msg, kind) => {
            setDeleting(null);
            toast(msg, kind);
            refresh();
          }}
        />
      ) : null}
    </div>
  );
}

function VideoTable({ videos, busy, archivedList = false, onEdit, onDelete, onArchive, onRestore }: { videos: Video[]; busy: boolean; archivedList?: boolean; onEdit?: (v: Video) => void; onDelete: (v: Video) => void; onArchive?: (v: Video) => void; onRestore?: (v: Video) => void }) {
  return (
    <div className="a-table-wrap">
      <table className="a-table">
        <thead>
          <tr>
            <th>Video</th>
            <th>Source</th>
            <th>Status</th>
            <th>Updated</th>
            <th aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {videos.map((v) => (
            <tr key={v._id}>
              <td>
                <span className="hv-admin__row">
                  <Thumb v={v} />
                  <span>{nameOf(v)}</span>
                </span>
              </td>
              <td>{v.sourceType === 'upload' ? `Uploaded file${v.media?.bytes ? ` · ${fmtBytes(v.media.bytes)}` : ''}` : PROVIDER[v.provider]}</td>
              <td>{archivedList ? <Chip tone="muted">Archived</Chip> : v.active ? <Chip tone="ok">Published</Chip> : <Chip tone="muted">Draft</Chip>}</td>
              <td className="a-muted">{dt(v.updatedAt)}</td>
              <td>
                <span className="hv-admin__actions">
                  {onEdit ? (
                    <button type="button" className="btn btn--outline btn--sm" onClick={() => onEdit(v)}>
                      Edit
                    </button>
                  ) : null}
                  {onArchive ? (
                    <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => onArchive(v)}>
                      Archive
                    </button>
                  ) : null}
                  {onRestore ? (
                    <button type="button" className="btn btn--outline btn--sm" disabled={busy} onClick={() => onRestore(v)}>
                      Restore
                    </button>
                  ) : null}
                  <button type="button" className="btn btn--ghost btn--sm hv-admin__danger" disabled={busy} onClick={() => onDelete(v)}>
                    Delete
                  </button>
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SectionSettings({ section, onSaved }: { section: Section; onSaved: () => void }) {
  const [s, setS] = useState<Section>(section);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const toast = useToast();
  useEffect(() => setS(section), [section]);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await put('/api/admin/home-videos/section', s);
      toast('Section saved');
      onSaved();
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Card title="Section heading">
      <form className="form-grid form-grid--2" onSubmit={save} data-testid="hv-section">
        <label className="check span-2">
          <input type="checkbox" checked={s.enabled} onChange={(e) => setS({ ...s, enabled: e.target.checked })} /> Show the video section on the homepage
        </label>
        <LocInput label="Small label above the heading (optional)" value={s.eyebrow} onChange={(v) => setS({ ...s, eyebrow: v })} />
        <LocInput label="Heading" value={s.title} onChange={(v) => setS({ ...s, title: v })} hint="Leave empty to show the videos without a visible heading." />
        <LocInput label="Introduction (optional)" value={s.subtitle} onChange={(v) => setS({ ...s, subtitle: v })} textarea />
        {error ? <ErrorBox error={error} /> : null}
        <div className="span-2">
          <button className="btn btn--primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save section'}
          </button>
        </div>
      </form>
    </Card>
  );
}

/** Live player preview — exactly the source the homepage will play. */
function PlayerPreview({ embedUrl, fileUrl, poster }: { embedUrl: string | null; fileUrl: string | null; poster?: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [embedUrl, fileUrl]);
  if (embedUrl)
    return (
      <div className="hv-admin__preview">
        <iframe src={embedUrl.replace('autoplay=1', 'autoplay=0').replace('autoplay=true', 'autoplay=false')} title="Video preview" allow="encrypted-media; picture-in-picture; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />
      </div>
    );
  if (fileUrl)
    return (
      <div className="hv-admin__preview">
        {failed ? (
          <p className="alert alert--error" role="alert">
            This file could not be played. Check that the link opens the video itself (not a web page) and that it is MP4 or WebM.
          </p>
        ) : (
          <video src={fileUrl} poster={poster || undefined} controls playsInline preload="metadata" onError={() => setFailed(true)} data-testid="hv-preview-video" />
        )}
      </div>
    );
  return null;
}

function VideoEditor({ draft, positions, occupied, onClose, onSaved }: { draft: Draft; positions: number; occupied: (Video | null)[]; onClose: () => void; onSaved: (msg: string) => void }) {
  const [d, setD] = useState<Draft>(draft);
  const [picker, setPicker] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [inspect, setInspect] = useState<Inspect | null>(null);
  const [checking, setChecking] = useState(false);
  const perms = usePerms();
  const cfg = useMediaConfig();
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const setDisplay = <K extends keyof Display>(k: K, v: Display[K]) => setD((x) => ({ ...x, display: { ...x.display, [k]: v } }));
  const url = useDebounced(d.url.trim(), 500);

  useEffect(() => {
    if (d.sourceType !== 'url' || !url) {
      setInspect(null);
      return;
    }
    let alive = true;
    setChecking(true);
    post<Inspect>('/api/admin/home-videos/inspect', { url })
      .then((r) => alive && setInspect(r))
      .catch((e) => alive && setInspect({ ok: false, reason: errText(e) }))
      .finally(() => alive && setChecking(false));
    return () => {
      alive = false;
    };
  }, [url, d.sourceType]);

  const isFile = d.sourceType === 'upload' || (inspect?.ok && inspect.provider === 'file');
  const isFacebook = d.sourceType === 'url' && inspect?.ok && inspect.provider === 'facebook';
  const unavailable = d.sourceType === 'url' && inspect?.ok && inspect.availability.status === 'unavailable';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const body = {
      sourceType: d.sourceType,
      ...(d.sourceType === 'url' ? { url: d.url.trim() } : { mediaId: d.mediaId }),
      title: d.title,
      description: d.description,
      posterUrl: d.posterUrl,
      posterMediaId: d.posterMediaId,
      posterAlt: d.posterAlt,
      position: d.position,
      active: d.active,
      display: d.display,
    };
    try {
      if (d._id) await put(`/api/admin/home-videos/${d._id}`, body);
      else await post('/api/admin/home-videos', body);
      onSaved(d.active && d.position ? `Saved and published in position ${d.position}` : d.active ? 'Saved (published, but not placed in a position yet)' : 'Saved as a draft');
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  };

  const occupantName = (p: number) => {
    const o = occupied[p - 1];
    return o && o._id !== d._id ? ` — replaces “${nameOf(o)}” (it moves to this video’s current place)` : o && o._id === d._id ? ' — current' : ' — empty';
  };

  return (
    <Modal title={d._id ? 'Edit homepage video' : 'Add homepage video'} onClose={onClose} wide>
      <form className="form-grid form-grid--2" onSubmit={submit} data-testid="hv-editor">
        <div className="field span-2">
          <span className="label">Video source</span>
          <div className="hv-admin__seg" role="radiogroup" aria-label="Video source">
            {(
              [
                ['url', 'Video link (YouTube, Vimeo, Facebook, ImageKit, Cloudinary, .mp4/.webm)'],
                ['upload', 'Upload a video file'],
              ] as const
            ).map(([k, label]) => (
              <label key={k} className={`hv-admin__seg-item ${d.sourceType === k ? 'is-on' : ''}`}>
                <input type="radio" name="sourceType" value={k} checked={d.sourceType === k} onChange={() => set('sourceType', k)} />
                {label}
              </label>
            ))}
          </div>
        </div>

        {d.sourceType === 'url' ? (
          <div className="field span-2">
            <span className="label">Video link *</span>
            <input className="input ltr" value={d.url} onChange={(e) => set('url', e.target.value)} placeholder="https://www.youtube.com/watch?v=…" data-testid="hv-url" />
            <span className="hint">The video stays on its platform; deleting it here never deletes it there. Facebook: use the full video address (facebook.com/…/videos/…), not fb.watch or share links.</span>
            {checking ? <span className="hint">Checking…</span> : null}
            {inspect && !checking ? (
              inspect.ok ? (
                <p className={`alert ${inspect.availability.status === 'ok' ? 'alert--success' : inspect.availability.status === 'unavailable' ? 'alert--error' : 'alert--warning'}`} data-testid="hv-availability">
                  <strong>{PROVIDER[inspect.provider]}.</strong> {inspect.availability.message}
                </p>
              ) : (
                <p className="alert alert--error" role="alert" data-testid="hv-availability">
                  {inspect.reason}
                </p>
              )
            ) : null}
            {inspect?.ok && !unavailable ? <PlayerPreview embedUrl={inspect.embedUrl} fileUrl={inspect.fileUrl} poster={d.posterUrl} /> : null}
          </div>
        ) : (
          <div className="field span-2">
            <span className="label">Video file *</span>
            {cfg && !cfg.uploadsEnabled ? (
              <p className="alert alert--warning">Uploads are not available: {cfg.reason || 'no persistent media storage is configured'}. You can still choose a file already in the media library, or use a video link.</p>
            ) : null}
            {!perms.has('media:write') ? <p className="a-muted">Your role cannot upload files; you can choose a video already in the media library.</p> : null}
            <div className="hv-admin__row">
              <button type="button" className="btn btn--outline btn--sm" onClick={() => setPicker(true)} data-testid="hv-pick-file">
                {d.mediaId ? 'Replace file' : perms.has('media:write') ? 'Upload or choose a video file' : 'Choose a video file'}
              </button>
              {d.mediaLabel ? <span className="a-muted">{d.mediaLabel}</span> : null}
            </div>
            <span className="hint">MP4 or WebM, up to {cfg?.maxVideoMb ?? 100} MB. Every file is checked by its real content before it can be used.</span>
            {d.mediaUrl ? <PlayerPreview embedUrl={null} fileUrl={d.mediaUrl} poster={d.posterUrl || d.mediaPoster} /> : null}
          </div>
        )}

        <LocInput label="Title" value={d.title} onChange={(v) => set('title', v)} hint="At least one language. Shown on the card and used as the player’s accessible name." />
        <LocInput label="Description (optional)" value={d.description} onChange={(v) => set('description', v)} textarea />

        <MediaField
          label="Poster image"
          kind="image"
          value={d.posterUrl}
          onChange={(u, asset) => setD((x) => ({ ...x, posterUrl: u, posterMediaId: asset?._id ?? null }))}
          hint={
            d.sourceType === 'url' && inspect?.ok && inspect.suggestedPoster && inspect.suggestedPoster !== d.posterUrl ? (
              <>
                Shown before the video plays. Empty = the platform’s own thumbnail (YouTube/Vimeo/ImageKit/Cloudinary) or a frame from the video itself.{' '}
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => setD((x) => ({ ...x, posterUrl: inspect.suggestedPoster, posterMediaId: null }))}>
                  Use the platform thumbnail
                </button>
              </>
            ) : (
              'Shown before the video plays. Empty = the platform’s own thumbnail (YouTube/Vimeo/ImageKit/Cloudinary) or a frame from the video itself. Facebook videos have no automatic poster.'
            )
          }
        />
        <LocInput label="Poster description (alt text)" value={d.posterAlt} onChange={(v) => set('posterAlt', v)} hint="Describe what the poster shows, for visitors using screen readers." />

        <F label="Position on the homepage">
          <select className="a-select" value={d.position ?? ''} onChange={(e) => set('position', e.target.value ? Number(e.target.value) : null)} data-testid="hv-position">
            <option value="">Not on the homepage</option>
            {Array.from({ length: positions }, (_, i) => i + 1).map((p) => (
              <option key={p} value={p}>
                Position {p}
                {occupantName(p)}
              </option>
            ))}
          </select>
        </F>
        <F label="Status">
          <select className="a-select" value={d.active ? 'published' : 'draft'} onChange={(e) => set('active', e.target.value === 'published')} data-testid="hv-status">
            <option value="draft">Draft — not shown</option>
            <option value="published">Published</option>
          </select>
        </F>

        <fieldset className="span-2 hv-admin__fieldset">
          <legend>Display settings</legend>
          <div className="form-grid form-grid--2">
            <F label="Poster fit">
              <select className="a-select" value={d.display.fit} onChange={(e) => setDisplay('fit', e.target.value as Display['fit'])}>
                <option value="cover">Fill the frame (may crop the edges)</option>
                <option value="contain">Show the whole image</option>
              </select>
            </F>
            <F label="Start at (seconds)" hint={isFacebook ? 'Not supported by Facebook’s player.' : undefined}>
              <input className="a-input ltr" type="number" min={0} max={86400} value={d.display.startAt} disabled={Boolean(isFacebook)} onChange={(e) => setDisplay('startAt', Math.max(0, Math.floor(Number(e.target.value) || 0)))} />
            </F>
            <label className="check">
              <input type="checkbox" checked={d.display.mutedPreview} disabled={!isFile} onChange={(e) => setDisplay('mutedPreview', e.target.checked)} /> Silent preview while on screen (muted, files only; never with reduced motion)
            </label>
            <label className="check">
              <input type="checkbox" checked={d.display.loop} disabled={!isFile} onChange={(e) => setDisplay('loop', e.target.checked)} /> Loop playback (files only)
            </label>
          </div>
        </fieldset>

        {error ? <ErrorBox error={error} /> : null}
        <div className="span-2 hv-admin__actions">
          <button className="btn btn--primary" disabled={saving || Boolean(unavailable) || (d.sourceType === 'url' ? !d.url.trim() : !d.mediaId)} data-testid="hv-save">
            {saving ? 'Saving…' : d.active ? 'Save and publish' : 'Save draft'}
          </button>
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
      {picker ? (
        <MediaPicker
          kind="video"
          initialTab={perms.has('media:write') && cfg?.uploadsEnabled !== false ? 'upload' : 'library'}
          onClose={() => setPicker(false)}
          onPick={(assets: MediaAsset[]) => {
            const a = assets[0];
            setPicker(false);
            if (!a) return;
            if (a.source === 'external') {
              // A link saved in the media library: use it as a link (never treated as our file).
              setD((x) => ({ ...x, sourceType: 'url', url: a.url }));
              return;
            }
            setD((x) => ({ ...x, mediaId: a._id, mediaLabel: `${a.filename || a.title || 'video'}${a.bytes ? ` · ${fmtBytes(a.bytes)}` : ''}`, mediaUrl: a.url, mediaPoster: a.posterUrl ?? '' }));
          }}
        />
      ) : null}
    </Modal>
  );
}

function DeleteDialog({ video, onClose, onDone }: { video: Video; onClose: () => void; onDone: (msg: string, kind?: 'success' | 'error' | 'info') => void }) {
  const perms = usePerms();
  const canFiles = perms.has('media:write');
  const isUpload = video.sourceType === 'upload';
  const [deleteFile, setDeleteFile] = useState(isUpload && canFiles);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await del<{ file: 'not_applicable' | 'kept' | 'deleted' | 'in_use' | 'failed' }>(`/api/admin/home-videos/${video._id}${deleteFile ? '?deleteFile=1' : ''}`);
      const msg: Record<typeof r.file, [string, 'success' | 'info' | 'error']> = {
        not_applicable: [isUpload ? 'Video removed from the website.' : `Removed from the website. The video on ${PROVIDER[video.provider]} was not touched.`, 'success'],
        kept: ['Video removed from the website. The file stays in the media library.', 'success'],
        deleted: ['Video removed and its file deleted from storage.', 'success'],
        in_use: ['Video removed. Its file is still used elsewhere on the website, so it was kept.', 'info'],
        failed: ['Video removed, but the file could not be deleted from storage. It is kept in the media library — try deleting it there later.', 'error'],
      };
      onDone(...msg[r.file]);
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  };
  return (
    <Modal title="Delete homepage video" onClose={onClose}>
      <div data-testid="hv-delete">
        <p>
          Delete <strong>{nameOf(video)}</strong> from the homepage videos?
        </p>
        {isUpload ? (
          <>
            <label className="check">
              <input type="checkbox" checked={deleteFile} disabled={!canFiles} onChange={(e) => setDeleteFile(e.target.checked)} data-testid="hv-delete-file" /> Also delete the uploaded file from storage
            </label>
            <p className="a-muted">
              {canFiles
                ? 'The file is deleted only if nothing else on the website (another video, a product, a banner…) uses it. This cannot be undone.'
                : 'Your role cannot delete stored files; the file will stay in the media library.'}
            </p>
          </>
        ) : (
          <p className="a-muted">
            Only this website entry is deleted. The original video on {PROVIDER[video.provider]}
            {video.provider === 'file' ? ' (the linked file)' : ''} is not touched — nothing is sent to {video.provider === 'file' ? 'its host' : PROVIDER[video.provider]}.
          </p>
        )}
        {error ? <ErrorBox error={error} /> : null}
        <div className="hv-admin__actions" style={{ marginTop: 16 }}>
          <button className="btn btn--primary hv-admin__danger-solid" disabled={busy} onClick={confirm} data-testid="hv-delete-confirm">
            {busy ? 'Deleting…' : 'Delete'}
          </button>
          <button className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  );
}
