import type { ClientSession, Types } from 'mongoose';
import { withTx } from '../../db/tx';
import { badRequest, conflict, notFound, unprocessable } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { checkMediaUrl } from '../../lib/media-url';
import { cached } from '../../lib/public-cache';
import { classifyShowcaseUrl, embedUrlFor, fileUrlFor, providerPoster, type ShowcaseSource } from '../../lib/showcase-video';
import { HOME_VIDEO_POSITIONS, HomeVideo, HomeVideoSection, MediaAsset, type HomeVideoDoc } from '../../models';
import { deleteMedia, findMediaUsage } from '../admin/media.service';

type Loc = { ar: string; en: string };
export type HomeVideoInput = {
  sourceType: 'url' | 'upload';
  url?: string;
  mediaId?: string;
  title: Loc;
  description: Loc;
  posterUrl?: string;
  posterMediaId?: string | null;
  posterAlt: Loc;
  position?: number | null;
  active: boolean;
  display: { fit: 'cover' | 'contain'; mutedPreview: boolean; loop: boolean; startAt: number };
};

// ---------------------------------------------------------------------------------------------
// Availability (oEmbed). Only fixed provider endpoints are called — never the admin-entered URL
// itself — so this adds no server-side request forgery surface.
// ---------------------------------------------------------------------------------------------

export type Availability = { status: 'ok' | 'unverified' | 'unavailable'; message: string; title?: string; thumbnailUrl?: string };
type OEmbedFetch = (url: string, init: { signal: AbortSignal; headers: Record<string, string> }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
let oembedFetch: OEmbedFetch = (url, init) => fetch(url, init);
export function __setOEmbedFetchForTests(fn: OEmbedFetch | null) {
  oembedFetch = fn ?? ((url, init) => fetch(url, init));
}

const FACEBOOK_NOTE =
  'Facebook does not let websites check a video in advance. Only public videos whose owner allows embedding will play. Check the preview: if Facebook shows an error there, visitors will see it too.';
const FILE_NOTE = 'Direct file links are checked by the preview player in your browser. If the preview does not play, visitors will not be able to play it either.';

export async function checkAvailability(source: ShowcaseSource): Promise<Availability> {
  if (source.provider === 'facebook') return { status: 'unverified', message: FACEBOOK_NOTE };
  if (source.provider === 'file') return { status: 'unverified', message: FILE_NOTE };
  const endpoint =
    source.provider === 'youtube'
      ? `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(source.canonicalUrl)}`
      : `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(source.canonicalUrl)}`;
  const name = source.provider === 'youtube' ? 'YouTube' : 'Vimeo';
  try {
    const res = await oembedFetch(endpoint, { signal: AbortSignal.timeout(6_000), headers: { Accept: 'application/json' } });
    if (res.ok) {
      const body = (await res.json().catch(() => ({}))) as { title?: unknown; thumbnail_url?: unknown };
      return {
        status: 'ok',
        message: `${name} confirmed this video is public and can be embedded.`,
        ...(typeof body.title === 'string' ? { title: body.title.slice(0, 200) } : {}),
        ...(typeof body.thumbnail_url === 'string' && /^https:\/\//.test(body.thumbnail_url) ? { thumbnailUrl: body.thumbnail_url } : {}),
      };
    }
    if (source.provider === 'vimeo' && res.status === 403)
      return { status: 'unverified', message: 'Vimeo restricts where this video may be embedded. Make sure this website is allowed in the video’s embed settings on Vimeo, then check the preview.' };
    if ([400, 401, 403, 404].includes(res.status)) {
      const why = res.status === 401 ? 'its owner has disabled embedding on other websites' : 'it is private, deleted or the link is wrong';
      return { status: 'unavailable', message: `${name} reports this video cannot be shown on other websites (${why}).` };
    }
    return { status: 'unverified', message: `${name} could not be reached to check this video (HTTP ${res.status}). Check the preview before publishing.` };
  } catch {
    return { status: 'unverified', message: `${name} could not be reached to check this video. Check the preview before publishing.` };
  }
}

/**
 * Best 16:9 YouTube thumbnail. oEmbed and hqdefault.jpg give a 4:3 image with black bars baked in;
 * maxresdefault / hq720 are 16:9 but do not exist for every video (YouTube then answers 404), and
 * mqdefault is 16:9 and always exists. Only YouTube's fixed image host is contacted.
 */
async function youtubePoster(id: string): Promise<string> {
  for (const name of ['maxresdefault', 'hq720']) {
    const url = `https://i.ytimg.com/vi/${id}/${name}.jpg`;
    try {
      const res = await oembedFetch(url, { signal: AbortSignal.timeout(4_000), headers: { Accept: 'image/*' } });
      if (res.ok) return url;
    } catch {
      /* try the next size */
    }
  }
  return `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;
}

/** Poster used when the admin did not choose one. */
async function defaultPoster(source: ShowcaseSource, availability: Availability): Promise<string> {
  if (source.provider === 'youtube') return availability.status === 'unavailable' ? '' : youtubePoster(source.id);
  return availability.thumbnailUrl || providerPoster(source);
}

/** Admin preview: how a link will be played, without saving anything. */
export async function inspectUrl(url: string) {
  const c = classifyShowcaseUrl(url);
  if (!c.ok) return { ok: false as const, reason: c.reason };
  const availability = await checkAvailability(c.source);
  return {
    ok: true as const,
    provider: c.source.provider,
    externalId: c.source.id,
    embedUrl: embedUrlFor(c.source),
    fileUrl: c.source.provider === 'file' ? c.source.canonicalUrl : null,
    suggestedPoster: await defaultPoster(c.source, availability),
    availability,
  };
}

// ---------------------------------------------------------------------------------------------
// Create / update
// ---------------------------------------------------------------------------------------------

function checkPoster(url?: string) {
  if (!url) return;
  const c = checkMediaUrl(url);
  if (!c.ok) throw badRequest('INVALID_POSTER', `Poster image: ${c.reason}`, { fieldErrors: { posterUrl: [c.reason] } });
}

type ResolvedSource = {
  provider: ShowcaseSource['provider'];
  url: string;
  externalId: string;
  media: Types.ObjectId | null;
  durationSec: number | undefined;
  fallbackPoster: string;
  availability: { status: Availability['status']; message: string };
};

/** Resolves the playable source from the input and verifies it. */
async function resolveSource(input: HomeVideoInput): Promise<ResolvedSource> {
  if (input.sourceType === 'upload') {
    const asset = input.mediaId ? await MediaAsset.findById(input.mediaId).lean() : null;
    if (!asset || asset.kind !== 'video' || asset.source !== 'upload') throw badRequest('INVALID_MEDIA', 'Choose an uploaded video file from the media library', { fieldErrors: { mediaId: ['Choose an uploaded video'] } });
    if (asset.status !== 'ready') throw unprocessable('MEDIA_NOT_READY', 'This upload has not finished or was rejected. Upload the file again.');
    return {
      provider: 'file',
      url: asset.url,
      externalId: '',
      media: asset._id,
      durationSec: asset.durationSec ?? undefined,
      fallbackPoster: asset.posterUrl || '',
      availability: { status: 'ok', message: 'Uploaded file verified by the media library.' },
    };
  }
  const c = classifyShowcaseUrl(input.url ?? '');
  if (!c.ok) throw badRequest('UNSUPPORTED_VIDEO', c.reason, { fieldErrors: { url: [c.reason] } });
  const availability = await checkAvailability(c.source);
  if (availability.status === 'unavailable') throw unprocessable('VIDEO_UNAVAILABLE', availability.message, { fieldErrors: { url: [availability.message] } });
  return {
    provider: c.source.provider,
    url: (input.url ?? '').trim(),
    externalId: c.source.id,
    media: null,
    durationSec: undefined,
    fallbackPoster: await defaultPoster(c.source, availability),
    availability,
  };
}

function docFields(input: HomeVideoInput, src: ResolvedSource, userId: string) {
  checkPoster(input.posterUrl);
  const isFile = src.provider === 'file';
  return {
    sourceType: input.sourceType,
    provider: src.provider,
    url: src.url,
    externalId: src.externalId,
    media: src.media,
    title: input.title,
    description: input.description,
    posterUrl: input.posterUrl || src.fallbackPoster,
    posterMedia: input.posterMediaId || null,
    posterAlt: input.posterAlt,
    active: input.active,
    display: {
      fit: input.display.fit,
      // Silent previews and looping only make sense for files we play ourselves.
      mutedPreview: isFile ? input.display.mutedPreview : false,
      loop: isFile ? input.display.loop : false,
      startAt: src.provider === 'facebook' ? 0 : input.display.startAt,
    },
    availability: { ...src.availability, checkedAt: new Date() },
    ...(src.durationSec !== undefined ? { durationSec: src.durationSec } : {}),
    updatedBy: userId,
  };
}

/**
 * Places `id` in `position` (or removes it from the homepage with null). The video already in that
 * slot moves to the slot this one leaves (a swap), or is unplaced. Runs in a transaction.
 */
async function placeAt(id: string, position: number | null, session?: ClientSession) {
  const me = await HomeVideo.findById(id).session(session ?? null);
  if (!me) throw notFound('Video');
  if (me.position === position) return;
  if (position !== null && me.archived) throw conflict('VIDEO_ARCHIVED', 'Restore this video from the archive before placing it on the homepage');
  const previous = me.position ?? null;
  const occupant = position !== null ? await HomeVideo.findOne({ position, _id: { $ne: me._id } }).session(session ?? null) : null;
  // Free both slots first so the unique index never sees two videos in one position.
  await HomeVideo.updateMany({ _id: { $in: [me._id, ...(occupant ? [occupant._id] : [])] } }, { $set: { position: null } }, { session });
  if (occupant) await HomeVideo.updateOne({ _id: occupant._id }, { $set: { position: previous } }, { session });
  await HomeVideo.updateOne({ _id: me._id }, { $set: { position } }, { session });
}

export async function createVideo(input: HomeVideoInput, userId: string) {
  const src = await resolveSource(input);
  const doc = await HomeVideo.create({ ...docFields(input, src, userId), position: null, createdBy: userId });
  if (input.position) await withTx((s) => placeAt(String(doc._id), input.position ?? null, s));
  return (await HomeVideo.findById(doc._id).lean())!;
}

export async function updateVideo(id: string, input: HomeVideoInput, userId: string) {
  const current = await HomeVideo.findById(id).lean();
  if (!current) throw notFound('Video');
  if (current.archived) throw conflict('VIDEO_ARCHIVED', 'Restore this video from the archive before editing it');
  // Re-check the source only when it changed (an unchanged YouTube link is not re-fetched on every save).
  const sameSource = input.sourceType === current.sourceType && (input.sourceType === 'upload' ? String(current.media) === input.mediaId : (input.url ?? '').trim() === current.url);
  const src: ResolvedSource = sameSource
    ? {
        provider: current.provider as ResolvedSource['provider'],
        url: current.url,
        externalId: current.externalId ?? '',
        media: current.media ?? null,
        durationSec: current.durationSec ?? undefined,
        fallbackPoster: current.posterUrl ?? '',
        availability: { status: (current.availability?.status ?? 'unverified') as Availability['status'], message: current.availability?.message ?? '' },
      }
    : await resolveSource(input);
  await HomeVideo.updateOne({ _id: current._id }, { $set: docFields(input, src, userId) }, { runValidators: true });
  if (input.position !== undefined && input.position !== current.position) await withTx((s) => placeAt(id, input.position ?? null, s));
  return (await HomeVideo.findById(id).lean())!;
}

/** Sets all four slots at once: slots[i] = video id for position i+1, or null for an empty slot. */
export async function setSlots(slots: (string | null)[]) {
  const ids = slots.filter((s): s is string => Boolean(s));
  if (new Set(ids).size !== ids.length) throw badRequest('DUPLICATE_SLOT', 'A video can only be in one position');
  const found = await HomeVideo.find({ _id: { $in: ids } }).select('archived').lean();
  if (found.length !== ids.length) throw notFound('Video');
  if (found.some((v) => v.archived)) throw conflict('VIDEO_ARCHIVED', 'Archived videos cannot be placed on the homepage');
  await withTx(async (session) => {
    await HomeVideo.updateMany({ position: { $type: 'number' } }, { $set: { position: null } }, { session });
    for (let i = 0; i < HOME_VIDEO_POSITIONS.length; i++) {
      const id = slots[i];
      if (id) await HomeVideo.updateOne({ _id: id }, { $set: { position: HOME_VIDEO_POSITIONS[i] } }, { session });
    }
  });
}

export async function setActive(id: string, active: boolean, userId: string) {
  const v = await HomeVideo.findOneAndUpdate({ _id: id, archived: false }, { $set: { active, updatedBy: userId } }, { new: true }).lean();
  if (!v) throw notFound('Video');
  return v;
}

/** Archive: hidden from the homepage and freed from its slot; kept (with its file) for later. */
export async function setArchived(id: string, archived: boolean, userId: string) {
  const set = archived ? { archived: true, active: false, position: null, updatedBy: userId } : { archived: false, updatedBy: userId };
  const v = await HomeVideo.findByIdAndUpdate(id, { $set: set }, { new: true }).lean();
  if (!v) throw notFound('Video');
  return v;
}

// ---------------------------------------------------------------------------------------------
// Delete — external references and uploaded files are handled differently.
// ---------------------------------------------------------------------------------------------

export type FileOutcome = 'not_applicable' | 'kept' | 'deleted' | 'in_use' | 'failed';

/**
 * Deletes the homepage entry.
 *  - URL entries: only this database record is removed. No request of any kind is sent to
 *    YouTube, Vimeo, Facebook or the file's host — the original video is untouched.
 *  - Uploaded entries: the record is removed first. The stored file is then removed only when
 *    `deleteFile` is requested, the caller may manage media files, the asset is an internal upload,
 *    and nothing else (another video, product, banner, setting…) still references it. A failed
 *    storage deletion keeps the file in the media library so it can be retried.
 */
export async function deleteVideo(id: string, opts: { deleteFile: boolean; canDeleteFiles: boolean }): Promise<{ deleted: true; sourceType: 'url' | 'upload'; file: FileOutcome; usage?: unknown }> {
  const doc = await HomeVideo.findById(id).lean();
  if (!doc) throw notFound('Video');
  await HomeVideo.deleteOne({ _id: doc._id });
  if (doc.sourceType === 'url') return { deleted: true, sourceType: 'url', file: 'not_applicable' };
  if (!opts.deleteFile || !opts.canDeleteFiles) return { deleted: true, sourceType: 'upload', file: 'kept' };
  const asset = doc.media ? await MediaAsset.findById(doc.media).lean() : null;
  if (!asset || asset.source !== 'upload') return { deleted: true, sourceType: 'upload', file: 'not_applicable' };
  const usage = (await findMediaUsage(asset)).filter((u) => u.live);
  if (usage.length) return { deleted: true, sourceType: 'upload', file: 'in_use', usage };
  try {
    await deleteMedia(String(asset._id), { keepRecordOnStorageError: true });
    return { deleted: true, sourceType: 'upload', file: 'deleted' };
  } catch (e) {
    logger.warn('Homepage video: stored file could not be deleted; kept in the media library', { asset: String(asset._id), err: String((e as Error).message) });
    return { deleted: true, sourceType: 'upload', file: 'failed' };
  }
}

// ---------------------------------------------------------------------------------------------
// Admin listing and section settings
// ---------------------------------------------------------------------------------------------

export async function listVideos() {
  return HomeVideo.find().sort({ archived: 1, position: 1, updatedAt: -1 }).populate('media', 'filename bytes mime durationSec status').lean();
}

export async function sectionSettings() {
  return (await HomeVideoSection.findOne({ key: 'home' }).lean()) ?? { key: 'home', enabled: true, eyebrow: { ar: '', en: '' }, title: { ar: '', en: '' }, subtitle: { ar: '', en: '' } };
}

export async function saveSectionSettings(input: { enabled: boolean; eyebrow: Loc; title: Loc; subtitle: Loc }) {
  return HomeVideoSection.findOneAndUpdate({ key: 'home' }, { $set: input }, { upsert: true, new: true, setDefaultsOnInsert: true }).lean();
}

// ---------------------------------------------------------------------------------------------
// Public payload (only what the homepage renders)
// ---------------------------------------------------------------------------------------------

export type PublicHomeVideo = {
  id: string;
  position: number;
  provider: 'youtube' | 'vimeo' | 'facebook' | 'file';
  title: Loc;
  description: Loc;
  posterUrl: string;
  posterAlt: Loc;
  embedUrl: string | null;
  fileUrl: string | null;
  mime: string | null;
  fit: 'cover' | 'contain';
  mutedPreview: boolean;
  loop: boolean;
  durationSec: number | null;
  /** Uploaded files only: when the file was added (for VideoObject structured data). */
  uploadDate: string | null;
};

function toPublic(v: HomeVideoDoc & { media?: unknown }, asset: { url: string; mime?: string | null; posterUrl?: string | null; durationSec?: number | null; createdAt?: Date } | null): PublicHomeVideo | null {
  let source: ShowcaseSource;
  if (v.sourceType === 'upload') {
    if (!asset) return null; // file missing or not ready: never show a broken player
    source = { provider: 'file', id: '', canonicalUrl: asset.url };
  } else {
    const c = classifyShowcaseUrl(v.url);
    if (!c.ok) return null;
    source = c.source;
  }
  const startAt = v.display?.startAt ?? 0;
  return {
    id: String(v._id),
    position: v.position!,
    provider: source.provider,
    title: { ar: v.title?.ar ?? '', en: v.title?.en ?? '' },
    description: { ar: v.description?.ar ?? '', en: v.description?.en ?? '' },
    posterUrl: v.posterUrl || asset?.posterUrl || '',
    posterAlt: { ar: v.posterAlt?.ar ?? '', en: v.posterAlt?.en ?? '' },
    embedUrl: embedUrlFor(source, { startAt }),
    fileUrl: source.provider === 'file' ? fileUrlFor(source.canonicalUrl, startAt) : null,
    mime: asset?.mime || (source.provider === 'file' ? (/\.webm$/i.test(source.canonicalUrl.split(/[?#]/)[0]) ? 'video/webm' : 'video/mp4') : null),
    fit: (v.display?.fit as 'cover' | 'contain') ?? 'cover',
    mutedPreview: Boolean(v.display?.mutedPreview),
    loop: Boolean(v.display?.loop),
    durationSec: asset?.durationSec ?? v.durationSec ?? null,
    uploadDate: v.sourceType === 'upload' && asset?.createdAt ? asset.createdAt.toISOString() : null,
  };
}

export async function publicHomeVideos() {
  return cached('home-videos', async () => {
    const section = await sectionSettings();
    if (section.enabled === false) return { enabled: false, eyebrow: section.eyebrow, title: section.title, subtitle: section.subtitle, videos: [] as PublicHomeVideo[] };
    const docs = await HomeVideo.find({ active: true, archived: false, position: { $in: [...HOME_VIDEO_POSITIONS] } }).sort({ position: 1 }).lean();
    const mediaIds = docs.filter((d) => d.sourceType === 'upload' && d.media).map((d) => d.media);
    const assets = mediaIds.length ? await MediaAsset.find({ _id: { $in: mediaIds }, status: 'ready', source: 'upload' }).select('url mime posterUrl durationSec createdAt').lean() : [];
    const byId = new Map(assets.map((a) => [String(a._id), a]));
    const videos = docs.map((d) => toPublic(d, d.media ? (byId.get(String(d.media)) ?? null) : null)).filter((v): v is PublicHomeVideo => Boolean(v));
    return { enabled: true, eyebrow: section.eyebrow, title: section.title, subtitle: section.subtitle, videos };
  });
}
