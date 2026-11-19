import { Types } from 'mongoose';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../../lib/errors';
import { escapeRegex } from '../../lib/http';
import { logger } from '../../lib/logger';
import { bumpPublicCacheVersion } from '../../lib/public-cache';
import { storage } from '../../integrations/storage';
import { MediaAsset, Order, Product, REVIEW_SOURCES, Review, User, getSettings } from '../../models';
import { completeUpload, createUpload, deleteMedia, receiveLocalPart } from '../admin/media.service';

/**
 * Customer reviews (Phase 5).
 *
 * Who may review: only a signed-in customer with a DELIVERED order containing the product (store
 * policy Q19). Every review therefore carries a real order reference and is shown as a verified
 * purchase; nothing is ever labelled verified without that order. One review per customer and
 * product (unique index). New and edited reviews wait for staff approval; only "approved" reviews
 * are public and count in ratings, which are always computed from the database.
 */

const MAX_IMAGES = 3;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

async function reviewsEnabled() {
  const s = await getSettings();
  if (!s?.reviews?.enabled) throw unprocessable('REVIEWS_DISABLED', 'Reviews are not enabled');
}

async function productBySlug(slug: string) {
  const p = await Product.findOne({ slug, status: 'active' }).select('_id').lean();
  if (!p) throw notFound('Product');
  return p;
}

/** "Sufiyan Y." from the account name — never the email or the full surname. */
export function shortName(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  return parts.length === 1 ? parts[0].slice(0, 40) : `${parts[0].slice(0, 40)} ${parts[parts.length - 1][0]}.`;
}

const deliveredOrderWith = (customerId: string, productId: unknown) =>
  Order.findOne({ customer: customerId, status: 'delivered', 'items.product': productId }).select('_id').sort({ createdAt: 1 }).lean();

/** Images the customer uploaded for reviews (owner-checked, finished, images only). */
async function ownImages(ids: string[] | undefined, customerId: string) {
  const unique = [...new Set(ids ?? [])];
  if (unique.length > MAX_IMAGES) throw badRequest('TOO_MANY_IMAGES', `Up to ${MAX_IMAGES} photos per review`);
  if (!unique.length) return [];
  const assets = await MediaAsset.find({ _id: { $in: unique }, kind: 'image', status: 'ready', createdBy: customerId, tags: 'review' }).select('url').lean();
  if (assets.length !== unique.length) throw badRequest('INVALID_IMAGE', 'A photo could not be found — upload it again');
  return unique.map((id) => ({ url: assets.find((a) => String(a._id) === id)!.url, mediaId: new Types.ObjectId(id) }));
}

async function removeImages(images: { mediaId?: unknown }[]) {
  for (const im of images) {
    if (!im.mediaId) continue;
    await deleteMedia(String(im.mediaId)).catch((e) => logger.warn('Review photo could not be deleted', { err: String((e as Error).message) }));
  }
}

const PUBLIC_FIELDS = 'rating title body displayName lang images order source createdAt editedAt';
const toPublic = (r: { _id: unknown; rating: number; title?: string | null; body?: string | null; displayName?: string | null; lang?: string | null; images?: { url: string }[] | null; order?: unknown; source?: string | null; createdAt?: Date; editedAt?: Date | null }) => ({
  id: String(r._id),
  rating: r.rating,
  title: r.title ?? '',
  body: r.body ?? '',
  displayName: r.displayName ?? '',
  lang: r.lang ?? 'ar',
  images: (r.images ?? []).map((i) => ({ url: i.url })),
  // Backed by the delivered order the review was written against (never shown otherwise).
  verifiedPurchase: Boolean(r.order),
  // 'customer' = written on this site; otherwise where the store received it (shown with the review).
  source: r.source ?? 'customer',
  createdAt: r.createdAt,
  editedAt: r.editedAt ?? null,
});

export async function publicList(slug: string, opts: { rating?: number; page: number; limit: number }) {
  const s = await getSettings();
  if (!s?.reviews?.enabled) return { items: [], total: 0 };
  const p = await Product.findOne({ slug }).select('_id').lean();
  if (!p) throw notFound('Product');
  const filter: Record<string, unknown> = { product: p._id, status: 'approved' };
  if (opts.rating) filter.rating = opts.rating;
  const [items, total] = await Promise.all([
    Review.find(filter).select(PUBLIC_FIELDS).sort({ createdAt: -1 }).skip((opts.page - 1) * opts.limit).limit(opts.limit).lean(),
    Review.countDocuments(filter),
  ]);
  return { items: items.map(toPublic), total };
}

/** The signed-in customer's own review (any status) and whether they may write one. */
export async function mine(slug: string, customerId: string) {
  const s = await getSettings();
  const p = await Product.findOne({ slug }).select('_id').lean();
  if (!p) throw notFound('Product');
  const [r, order] = await Promise.all([Review.findOne({ product: p._id, customer: customerId }).lean(), deliveredOrderWith(customerId, p._id)]);
  return {
    enabled: Boolean(s?.reviews?.enabled),
    canReview: Boolean(s?.reviews?.enabled && order && !r),
    uploadsEnabled: Boolean(storage()),
    review: r ? { ...toPublic(r), status: r.status, images: (r.images ?? []).map((i) => ({ url: i.url, mediaId: String(i.mediaId ?? '') })) } : null,
  };
}

type Input = { rating: number; title: string; body: string; displayName: string; lang: 'ar' | 'en'; imageIds?: string[] };

export async function submit(slug: string, customerId: string, input: Input) {
  await reviewsEnabled();
  const p = await productBySlug(slug);
  const order = await deliveredOrderWith(customerId, p._id);
  if (!order) throw unprocessable('NOT_VERIFIED_PURCHASE', 'Only customers who received this product can review it');
  if (await Review.exists({ product: p._id, customer: customerId })) throw conflict('ALREADY_REVIEWED', 'You already reviewed this product');
  const user = await User.findById(customerId).select('name').lean();
  const images = await ownImages(input.imageIds, customerId);
  try {
    const r = await Review.create({
      product: p._id,
      customer: customerId,
      order: order._id,
      rating: input.rating,
      title: input.title,
      body: input.body,
      lang: input.lang,
      displayName: input.displayName || shortName(user?.name ?? ''),
      images,
      status: 'pending',
    });
    return { id: String(r._id), status: r.status };
  } catch (e) {
    if ((e as { code?: number }).code === 11000) throw conflict('ALREADY_REVIEWED', 'You already reviewed this product');
    throw e;
  }
}

/** Editing sends the review back to moderation (an approved text must be re-approved). */
export async function edit(slug: string, customerId: string, input: Input) {
  await reviewsEnabled();
  const p = await productBySlug(slug);
  const r = await Review.findOne({ product: p._id, customer: customerId }).lean();
  if (!r) throw notFound('Review');
  const images = await ownImages(input.imageIds, customerId);
  const removed = (r.images ?? []).filter((old) => !images.some((n) => String(n.mediaId) === String(old.mediaId)));
  await Review.updateOne(
    { _id: r._id },
    { $set: { rating: input.rating, title: input.title, body: input.body, lang: input.lang, displayName: input.displayName || r.displayName, images, status: 'pending', editedAt: new Date() } },
  );
  await removeImages(removed);
  if (r.status === 'approved') await bumpPublicCacheVersion(); // the rating summary changes
  return { id: String(r._id), status: 'pending' };
}

export async function removeOwn(slug: string, customerId: string) {
  const p = await Product.findOne({ slug }).select('_id').lean();
  if (!p) throw notFound('Product');
  const r = await Review.findOneAndDelete({ product: p._id, customer: customerId }).lean();
  if (!r) throw notFound('Review');
  await removeImages(r.images ?? []);
  if (r.status === 'approved') await bumpPublicCacheVersion();
  return { deleted: true };
}

export async function report(reviewId: string, customerId: string, reason: string) {
  const r = await Review.findOne({ _id: reviewId, status: 'approved' }).select('customer reports').lean();
  if (!r) throw notFound('Review');
  if (String(r.customer) === customerId) throw forbidden('You cannot report your own review');
  const res = await Review.updateOne({ _id: reviewId, 'reports.user': { $ne: new Types.ObjectId(customerId) } }, { $push: { reports: { user: customerId, reason } }, $inc: { reportCount: 1 } });
  return { reported: true, duplicate: res.modifiedCount === 0 };
}

// ---- Review photos (customer uploads through the existing media pipeline) ----

export async function startPhotoUpload(customerId: string, input: { filename: string; contentType: string; size: number; width?: number; height?: number }) {
  await reviewsEnabled();
  if (input.size > MAX_IMAGE_BYTES) throw badRequest('INVALID_UPLOAD', 'Each photo can be up to 5 MB');
  const { assetId, uploads } = await createUpload({ kind: 'image', filename: input.filename, width: input.width, height: input.height, parts: [{ role: 'original', contentType: input.contentType, size: input.size }] }, customerId);
  await MediaAsset.updateOne({ _id: assetId }, { $set: { tags: ['review'] } });
  // Local-disk storage: the bytes go to the customer endpoint (the staff one needs media:write).
  const upload = uploads[0];
  const url = upload.direct ? upload.url : `/api/reviews/uploads/${assetId}/content?key=${encodeURIComponent(new URL(upload.url, 'http://x').searchParams.get('key') ?? '')}`;
  return { assetId, upload: { ...upload, url } };
}

async function ownPending(assetId: string, customerId: string) {
  const a = await MediaAsset.findOne({ _id: assetId, createdBy: customerId, tags: 'review' }).select('_id').lean();
  if (!a) throw notFound('Upload');
}

export async function receivePhoto(assetId: string, customerId: string, key: string, body: Buffer) {
  await ownPending(assetId, customerId);
  if (body?.length > MAX_IMAGE_BYTES) throw badRequest('INVALID_UPLOAD', 'Each photo can be up to 5 MB');
  await receiveLocalPart(assetId, key, body);
}

export async function finishPhoto(assetId: string, customerId: string) {
  await ownPending(assetId, customerId);
  const a = await completeUpload(assetId);
  return { id: String(a!._id), url: a!.url };
}

// ---- Staff moderation ----

export type AdminQuery = { status?: string; rating?: number; product?: string; q?: string; reported?: boolean; page: number; limit: number };

export async function adminList(q: AdminQuery) {
  const filter: Record<string, unknown> = {};
  if (q.status) filter.status = q.status;
  if (q.rating) filter.rating = q.rating;
  if (q.product) filter.product = q.product;
  if (q.reported) filter.reportCount = { $gt: 0 };
  if (q.q) {
    const rx = new RegExp(escapeRegex(q.q), 'i');
    const products = await Product.find({ $or: [{ sku: rx }, { 'name.en': rx }, { 'name.ar': rx }] }).select('_id').limit(200).lean();
    filter.$or = [{ title: rx }, { body: rx }, { displayName: rx }, { product: { $in: products.map((p) => p._id) } }];
  }
  const [items, total, counts] = await Promise.all([
    Review.find(filter).populate('product', 'sku slug name').populate('customer', 'name email').populate('order', 'orderNumber').sort({ createdAt: -1 }).skip((q.page - 1) * q.limit).limit(q.limit).lean(),
    Review.countDocuments(filter),
    Review.aggregate<{ _id: string; n: number }>([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
  ]);
  const reported = await Review.countDocuments({ reportCount: { $gt: 0 } });
  return { items, total, page: q.page, pages: Math.max(1, Math.ceil(total / q.limit)), counts: { ...Object.fromEntries(counts.map((c) => [c._id, c.n])), reported } };
}

export async function moderate(id: string, status: 'approved' | 'rejected' | 'hidden', staffId: string, note: string) {
  const r = await Review.findByIdAndUpdate(id, { $set: { status, moderatedBy: staffId, moderatedAt: new Date(), moderationNote: note, ...(status === 'approved' ? { reports: [], reportCount: 0 } : {}) } }, { new: true }).lean();
  if (!r) throw notFound('Review');
  return r;
}

export async function adminDelete(id: string) {
  const r = await Review.findByIdAndDelete(id).lean();
  if (!r) throw notFound('Review');
  await removeImages(r.images ?? []);
  return { deleted: true };
}

// ---- Staff-entered reviews (real customer reviews received on WhatsApp, Instagram, by phone…) ----

export type StaffReviewInput = {
  productId: string;
  displayName: string;
  rating: number;
  title: string;
  body: string;
  lang: 'ar' | 'en';
  source: Exclude<(typeof REVIEW_SOURCES)[number], 'customer'>;
  receivedAt?: Date | null;
  evidenceUrl: string;
  imageUrls: string[];
};

/**
 * A real review a customer gave the store outside the site, entered by staff. It is published at
 * once, counts in ratings like any approved review, is never labelled "verified purchase" (there is
 * no order) and always shows where it came from (e.g. "Shared on WhatsApp").
 */
export async function adminCreate(input: StaffReviewInput, staffId: string) {
  const p = await Product.findById(input.productId).select('_id').lean();
  if (!p) throw notFound('Product');
  const now = new Date();
  const doc = await Review.create({
    product: p._id,
    customer: new Types.ObjectId(), // unique reviewer key — not a user account
    order: null,
    source: input.source,
    rating: input.rating,
    title: input.title,
    body: input.body,
    lang: input.lang,
    displayName: input.displayName,
    images: input.imageUrls.slice(0, MAX_IMAGES).map((url) => ({ url })),
    evidenceUrl: input.evidenceUrl,
    addedBy: staffId,
    status: 'approved',
    moderatedBy: staffId,
    moderatedAt: now,
  });
  // Show the date the customer actually gave the review (never in the future).
  if (input.receivedAt && input.receivedAt < now) {
    await Review.collection.updateOne({ _id: doc._id }, { $set: { createdAt: input.receivedAt } });
  }
  bumpPublicCacheVersion();
  return Review.findById(doc._id).lean();
}

/** Corrects a staff-entered review (customer-written reviews are never edited by staff). */
export async function adminUpdate(id: string, input: Omit<StaffReviewInput, 'productId'>) {
  const r = await Review.findById(id).select('source').lean();
  if (!r) throw notFound('Review');
  if (!r.source || r.source === 'customer') throw forbidden('Reviews written by customers cannot be edited');
  await Review.updateOne(
    { _id: id },
    {
      $set: {
        source: input.source,
        rating: input.rating,
        title: input.title,
        body: input.body,
        lang: input.lang,
        displayName: input.displayName,
        images: input.imageUrls.slice(0, MAX_IMAGES).map((url) => ({ url })),
        evidenceUrl: input.evidenceUrl,
        editedAt: new Date(),
      },
    },
  );
  if (input.receivedAt && input.receivedAt < new Date()) await Review.collection.updateOne({ _id: new Types.ObjectId(id) }, { $set: { createdAt: input.receivedAt } });
  bumpPublicCacheVersion();
  return Review.findById(id).lean();
}
