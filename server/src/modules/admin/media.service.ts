import { env } from '../../config/env';
import { badRequest, conflict, notFound, serviceUnavailable, unprocessable } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { checkMediaUrl, classifyVideoUrl } from '../../lib/media-url';
import { canonicalMime, imageDimensions, mediaKey, sniffMedia, EXT_FOR_MIME } from '../../lib/media-sniff';
import { validateUploadParts, type PartInput } from '../../lib/media-rules';
import { randomToken } from '../../lib/tokens';
import { storage, storageStatus } from '../../integrations/storage';
import { Banner, Campaign, Category, MediaAsset, Order, Product, ProductCollection, Settings } from '../../models';

export type UploadInput = {
  kind: 'image' | 'video';
  filename: string;
  title?: string;
  alt?: { ar: string; en: string };
  width?: number;
  height?: number;
  durationSec?: number;
  parts: PartInput[];
};

const MB = 1024 * 1024;
export const limitFor = (kind: 'image' | 'video') => (kind === 'image' ? env.MEDIA_MAX_IMAGE_MB : env.MEDIA_MAX_VIDEO_MB) * MB;
const SNIFF_BYTES = 64 * 1024;

const limits = () => ({ imageBytes: limitFor('image'), videoBytes: limitFor('video') });

export async function createUpload(input: UploadInput, userId: string) {
  const store = storage();
  if (!store) throw serviceUnavailable('UPLOADS_DISABLED', storageStatus().reason || 'Direct uploads are not available');
  const problem = validateUploadParts(input.kind, input.parts, limits());
  if (problem) throw badRequest('INVALID_UPLOAD', problem);

  const random = randomToken(12).replace(/[^A-Za-z0-9_-]/g, '');
  const parts = input.parts.map((p) => {
    const mime = canonicalMime(p.contentType);
    const base = mediaKey(p.role === 'original' ? input.kind : 'image', EXT_FOR_MIME[mime], p.role === 'poster' ? `${random}p` : random);
    const key = p.role.startsWith('w') ? base.replace(/\.([a-z0-9]+)$/, `-${p.role}.$1`) : base;
    return { role: p.role, key, mime, declaredBytes: p.size, width: p.width };
  });
  const original = parts.find((p) => p.role === 'original')!;
  const asset = await MediaAsset.create({
    kind: input.kind,
    source: 'upload',
    status: 'pending',
    url: store.publicUrl(original.key),
    storage: store.name,
    key: original.key,
    mime: original.mime,
    bytes: original.declaredBytes,
    width: input.width,
    height: input.height,
    durationSec: input.durationSec,
    parts,
    filename: input.filename.slice(0, 200),
    title: (input.title || input.filename).slice(0, 200),
    alt: input.alt ?? { ar: '', en: '' },
    createdBy: userId,
  });
  const uploads = await Promise.all(parts.map(async (p) => ({ role: p.role, ...(await store.uploadTarget(p.key, p.mime, String(asset._id))) })));
  return { assetId: String(asset._id), uploads };
}

/** Local storage only: receives the bytes of one part, checks them and writes them to disk. */
export async function receiveLocalPart(assetId: string, key: string, body: Buffer) {
  const store = storage();
  if (!store || store.name !== 'local') throw notFound('Upload');
  const asset = await MediaAsset.findOne({ _id: assetId, status: 'pending' }).lean();
  const part = asset?.parts?.find((p) => p.key === key);
  if (!asset || !part) throw notFound('Upload');
  if (!body?.length) throw badRequest('EMPTY_FILE', 'File is empty');
  if (body.length !== part.declaredBytes) throw badRequest('SIZE_MISMATCH', 'The file size does not match the upload request');
  const sniffed = sniffMedia(body);
  if (!sniffed || sniffed.mime !== part.mime) throw unprocessable('FILE_TYPE_MISMATCH', 'The file content does not match its type — it may be renamed or damaged');
  await store.put(key, body, part.mime);
}

async function deleteObjects(asset: { storage?: string | null; parts?: { key: string }[] | null; key?: string | null; variants?: { key?: string | null }[] | null }) {
  const store = storage();
  if (!store || (asset.storage && asset.storage !== store.name)) return;
  const keys = new Set<string>([...(asset.parts ?? []).map((p) => p.key), asset.key ?? '', ...(asset.variants ?? []).map((v) => v.key ?? '')].filter(Boolean));
  for (const k of keys) {
    try {
      await store.delete(k);
    } catch (e) {
      logger.warn('Could not delete stored media object', { key: k, err: String((e as Error).message) });
    }
  }
}

/** Verifies every uploaded part by its real content before the asset becomes usable. */
export async function completeUpload(assetId: string) {
  const store = storage();
  if (!store) throw serviceUnavailable('UPLOADS_DISABLED', storageStatus().reason);
  const asset = await MediaAsset.findById(assetId).lean();
  if (!asset) throw notFound('Upload');
  if (asset.status === 'ready') return asset;
  if (asset.status === 'rejected') throw unprocessable('UPLOAD_REJECTED', asset.rejectReason || 'This upload was rejected');

  const reject = async (reason: string) => {
    await deleteObjects(asset);
    await MediaAsset.updateOne({ _id: asset._id }, { $set: { status: 'rejected', rejectReason: reason } });
    throw unprocessable('UPLOAD_REJECTED', reason);
  };

  let dims: { width: number; height: number } | null = null;
  for (const part of asset.parts ?? []) {
    const obj = await store.head(part.key, SNIFF_BYTES);
    if (!obj) return reject(`The ${part.role} file was not received`);
    const max = limitFor(part.role === 'original' ? (asset.kind as 'image' | 'video') : 'image');
    if (obj.size > max) return reject('The uploaded file is larger than allowed');
    if (obj.size !== part.declaredBytes) return reject('The uploaded file size does not match the upload request');
    const sniffed = sniffMedia(obj.head);
    if (!sniffed || sniffed.mime !== part.mime) return reject('The file content does not match its declared type — only genuine JPEG, PNG, WebP, AVIF, GIF, MP4 and WebM files are accepted');
    if (obj.contentType && canonicalMime(obj.contentType) !== part.mime) return reject('Stored content type does not match the file');
    if (part.role === 'original' && sniffed.kind === 'image') dims = imageDimensions(obj.head);
  }
  const variants = (asset.parts ?? [])
    .filter((p) => /^w\d+$/.test(p.role))
    .map((p) => ({ width: p.width ?? Number(p.role.slice(1)), url: store.publicUrl(p.key), key: p.key, mime: p.mime, bytes: p.declaredBytes }))
    .sort((a, b) => a.width - b.width);
  const poster = (asset.parts ?? []).find((p) => p.role === 'poster');
  const updated = await MediaAsset.findOneAndUpdate(
    { _id: asset._id, status: 'pending' },
    {
      $set: {
        status: 'ready',
        variants,
        posterUrl: poster ? store.publicUrl(poster.key) : '',
        ...(dims ? { width: dims.width, height: dims.height } : {}),
      },
      $unset: { parts: 1 },
    },
    { new: true },
  ).lean();
  return updated ?? (await MediaAsset.findById(asset._id).lean());
}

export async function addExternal(input: { kind: 'image' | 'video'; url: string; title?: string; alt?: { ar: string; en: string }; posterUrl?: string }, userId: string) {
  const check = checkMediaUrl(input.url);
  if (!check.ok) throw badRequest('INVALID_URL', check.reason);
  let videoProvider = '';
  if (input.kind === 'video') {
    const v = classifyVideoUrl(input.url);
    if (!v) throw badRequest('UNSUPPORTED_VIDEO', 'Use a direct .mp4/.webm file link, a YouTube link or a Vimeo link');
    videoProvider = v.type;
  }
  if (input.posterUrl) {
    const pc = checkMediaUrl(input.posterUrl);
    if (!pc.ok) throw badRequest('INVALID_URL', `Poster: ${pc.reason}`);
  }
  const existing = await MediaAsset.findOne({ source: 'external', url: input.url.trim() }).lean();
  if (existing) return existing;
  const doc = await MediaAsset.create({
    kind: input.kind,
    source: 'external',
    status: 'ready',
    url: input.url.trim(),
    videoProvider,
    posterUrl: input.posterUrl ?? '',
    title: (input.title || input.url).slice(0, 200),
    alt: input.alt ?? { ar: '', en: '' },
    createdBy: userId,
  });
  return doc.toObject();
}

export type MediaUsage = { type: string; id: string; label: string; field: string; live: boolean }[];

/** Everywhere the asset's URLs are referenced (products, banners, settings, orders…). */
export async function findMediaUsage(asset: { _id: unknown; url: string; posterUrl?: string | null; variants?: { url: string }[] | null }): Promise<MediaUsage> {
  const urls = [asset.url, asset.posterUrl ?? '', ...(asset.variants ?? []).map((v) => v.url)].filter(Boolean);
  const inUrls = { $in: urls };
  const out: MediaUsage = [];
  const [products, categories, collections, banners, campaigns, settings, orders] = await Promise.all([
    Product.find({ $or: [{ 'images.url': inUrls }, { 'images.mediaId': asset._id }, { 'images.variants.url': inUrls }] }).select('sku name').limit(50).lean(),
    Category.find({ $or: [{ 'image.url': inUrls }, { 'image.mediaId': asset._id }] }).select('slug').lean(),
    ProductCollection.find({ $or: [{ 'image.url': inUrls }, { 'image.mediaId': asset._id }] }).select('slug').lean(),
    Banner.find({
      $or: [{ 'imageUrl.ar': inUrls }, { 'imageUrl.en': inUrls }, { 'mobileImageUrl.ar': inUrls }, { 'mobileImageUrl.en': inUrls }, { videoUrl: inUrls }, { mobileVideoUrl: inUrls }, { posterUrl: inUrls }],
    })
      .select('placement title')
      .lean(),
    Campaign.find({ heroImageUrl: inUrls }).select('slug').lean(),
    Settings.findOne({ key: 'store' }).lean(),
    Order.countDocuments({ 'items.image': inUrls }),
  ]);
  products.forEach((p) => out.push({ type: 'product', id: String(p._id), label: p.sku, field: 'images', live: true }));
  categories.forEach((c) => out.push({ type: 'category', id: String(c._id), label: c.slug, field: 'image', live: true }));
  collections.forEach((c) => out.push({ type: 'collection', id: String(c._id), label: c.slug, field: 'image', live: true }));
  banners.forEach((b) => out.push({ type: 'banner', id: String(b._id), label: `${b.placement} banner ${b.title?.en || b.title?.ar || ''}`.trim(), field: 'media', live: true }));
  campaigns.forEach((c) => out.push({ type: 'campaign', id: String(c._id), label: c.slug, field: 'heroImageUrl', live: true }));
  const s = settings as Record<string, Record<string, Record<string, unknown> | unknown>> | null;
  const settingFields: [string, unknown][] = [
    ['homepage.heroVideoUrl', s?.homepage && (s.homepage as Record<string, unknown>).heroVideoUrl],
    ['homepage.heroPosterUrl', s?.homepage && (s.homepage as Record<string, unknown>).heroPosterUrl],
    ['homepage.heroMobileVideoUrl', s?.homepage && (s.homepage as Record<string, unknown>).heroMobileVideoUrl],
    ['homepage.heroMobilePosterUrl', s?.homepage && (s.homepage as Record<string, unknown>).heroMobilePosterUrl],
    ['homepage.brandStoryImageUrl', s?.homepage && (s.homepage as Record<string, unknown>).brandStoryImageUrl],
    ['brand.logoUrl', s?.brand && (s.brand as Record<string, unknown>).logoUrl],
    ['brand.logoDarkUrl', s?.brand && (s.brand as Record<string, unknown>).logoDarkUrl],
    ['business.sbcBadgeImageUrl', s?.business && (s.business as Record<string, unknown>).sbcBadgeImageUrl],
  ];
  for (const [field, value] of settingFields) if (typeof value === 'string' && urls.includes(value)) out.push({ type: 'settings', id: 'store', label: field, field, live: true });
  if (orders) out.push({ type: 'orders', id: '', label: `${orders} past order(s) show this image`, field: 'items.image', live: false });
  return out;
}

export async function deleteMedia(assetId: string, opts: { confirmOrders?: boolean } = {}) {
  const asset = await MediaAsset.findById(assetId).lean();
  if (!asset) throw notFound('Media');
  if (asset.source === 'upload' && asset.status === 'ready') {
    const usage = await findMediaUsage(asset);
    const live = usage.filter((u) => u.live);
    if (live.length) throw conflict('MEDIA_IN_USE', 'This file is used on the website. Replace it there first.', { usage });
    if (usage.length && !opts.confirmOrders) throw conflict('MEDIA_IN_ORDER_HISTORY', 'This image appears in past orders. Deleting it removes the picture from those order records.', { usage });
    await deleteObjects(asset);
  } else if (asset.source === 'upload') {
    await deleteObjects(asset);
  }
  await MediaAsset.deleteOne({ _id: asset._id });
  return { deleted: true };
}

/** Removes uploads that were never completed (or were rejected) — run by cron. */
export async function cleanupAbandonedUploads(olderThanHours = 24, limit = 200) {
  const before = new Date(Date.now() - olderThanHours * 3600_000);
  const stale = await MediaAsset.find({ status: { $in: ['pending', 'rejected'] }, updatedAt: { $lt: before } }).limit(limit).lean();
  for (const a of stale) {
    await deleteObjects(a);
    await MediaAsset.deleteOne({ _id: a._id, status: { $in: ['pending', 'rejected'] } });
  }
  return { removed: stale.length };
}
