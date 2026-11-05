import { Router } from 'express';
import { audit } from '../../lib/audit';
import { forbidden, notFound } from '../../lib/errors';
import { videoUrlError } from '../../lib/media-url';
import { ah, ok } from '../../lib/http';
import { requirePermission } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { Banner, Campaign, Page, PageRevision, ProductCollection, Review } from '../../models';
import { bannerInput, campaignInput, collectionInput, idParam, pageInput, reviewModerate } from './admin.schemas';
import { z } from 'zod';
import type { NextFunction, Request, Response } from 'express';
import { badRequest } from '../../lib/errors';
import { crudRouter } from './crud';

export const adminContentRoutes = Router();

/** Rejects video links the storefront cannot play (only direct .mp4/.webm, YouTube, Vimeo). */
const checkVideos =
  (...fields: string[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    for (const f of fields) {
      const v = req.body?.[f];
      const e = typeof v === 'string' ? videoUrlError(v) : null;
      if (e) return next(badRequest('VALIDATION_ERROR', `${f}: ${e}`, { fieldErrors: { [f]: [e] } }));
    }
    next();
  };
adminContentRoutes.use('/banners', (req, res, next) => (['POST', 'PUT', 'PATCH'].includes(req.method) ? checkVideos('videoUrl', 'mobileVideoUrl')(req, res, next) : next()));
adminContentRoutes.use('/campaigns', (req, res, next) => (['POST', 'PUT', 'PATCH'].includes(req.method) ? checkVideos('heroVideoUrl')(req, res, next) : next()));

adminContentRoutes.use(
  '/banners',
  crudRouter(Banner, bannerInput, { entity: 'banner', readPermission: 'content:write', writePermission: 'content:write', sort: { placement: 1, sortOrder: 1, _id: 1 }, summary: (d) => String(d.placement) }),
);
adminContentRoutes.use(
  '/collections',
  crudRouter(ProductCollection, collectionInput, { entity: 'collection', readPermission: 'products:read', writePermission: 'content:write', sort: { sortOrder: 1 } }),
);
adminContentRoutes.use(
  '/campaigns',
  crudRouter(Campaign, campaignInput, { entity: 'campaign', readPermission: 'content:write', writePermission: 'content:write', sort: { startsAt: -1 } }),
);

// Legal / policy pages: fixed set of slugs, editable and approvable (Q31).
adminContentRoutes.get(
  '/pages',
  requirePermission('content:write'),
  ah(async (_req, res) => ok(res, await Page.find().sort({ slug: 1 }).lean())),
);
/**
 * Saving a policy: the previous version is stored in PageRevision first (history is never lost).
 * Approving — or editing an already approved policy — needs `business:write`: content editors can
 * prepare drafts, but only someone with legal/business authority publishes them as approved.
 * Any text change to an approved policy puts it back to draft until it is approved again.
 */
adminContentRoutes.put(
  '/pages/:id',
  requirePermission('content:write'),
  validate(idParam, 'params'),
  validate(pageInput),
  ah(async (req, res) => {
    const current = await Page.findById(req.params.id).lean();
    if (!current) throw notFound('Page');
    const canApprove = req.user!.permissions.has('business:write');
    const { reason, ...input } = req.body as z.infer<typeof pageInput>;
    const textChanged = JSON.stringify([current.title, current.body]) !== JSON.stringify([input.title, input.body]);
    let status = input.status;
    if (status === 'approved' && current.status !== 'approved' && !canApprove) throw forbidden('Approving a policy requires the legal & business permission (business:write)');
    if (current.status === 'approved' && textChanged && status === 'approved' && !canApprove) status = 'draft';
    const set: Record<string, unknown> = { title: input.title, body: input.body, status };
    if (status === 'approved' && (current.status !== 'approved' || textChanged)) Object.assign(set, { approvedAt: new Date(), approvedBy: input.approvedBy || req.user!.name });
    if (status === 'draft') Object.assign(set, { approvedBy: '', approvedAt: null });

    await PageRevision.create({
      page: current._id,
      slug: current.slug,
      title: current.title,
      body: current.body,
      status: current.status,
      approvedBy: current.approvedBy ?? '',
      approvedAt: current.approvedAt,
      savedBy: req.user!.id,
      savedByName: req.user!.name,
      reason: reason || (status !== current.status ? `Status ${current.status} → ${status}` : 'Edited'),
    });
    const p = await Page.findByIdAndUpdate(req.params.id, { $set: set, $inc: { version: 1 } }, { new: true }).lean();
    await audit(req, 'update', 'page', req.params.id, `${p!.slug} v${p!.version} (${p!.status})${reason ? ` — ${reason}` : ''}`);
    return ok(res, p);
  }),
);

adminContentRoutes.get(
  '/pages/:id/revisions',
  requirePermission('content:write'),
  validate(idParam, 'params'),
  ah(async (req, res) => ok(res, await PageRevision.find({ page: req.params.id }).sort({ createdAt: -1 }).limit(100).lean())),
);

/** Restores an earlier version as a new DRAFT (the current text is kept in the history too). */
adminContentRoutes.post(
  '/pages/:id/revisions/:revisionId/restore',
  requirePermission('content:write'),
  validate(z.object({ id: z.string().regex(/^[a-f0-9]{24}$/i), revisionId: z.string().regex(/^[a-f0-9]{24}$/i) }), 'params'),
  ah(async (req, res) => {
    const [current, rev] = await Promise.all([Page.findById(req.params.id).lean(), PageRevision.findOne({ _id: req.params.revisionId, page: req.params.id }).lean()]);
    if (!current || !rev) throw notFound('Version');
    await PageRevision.create({
      page: current._id,
      slug: current.slug,
      title: current.title,
      body: current.body,
      status: current.status,
      approvedBy: current.approvedBy ?? '',
      approvedAt: current.approvedAt,
      savedBy: req.user!.id,
      savedByName: req.user!.name,
      reason: `Before restoring the version of ${rev.createdAt?.toISOString().slice(0, 10) ?? ''}`,
    });
    const p = await Page.findByIdAndUpdate(current._id, { $set: { title: rev.title, body: rev.body, status: 'draft', approvedBy: '', approvedAt: null }, $inc: { version: 1 } }, { new: true }).lean();
    await audit(req, 'restore', 'page', req.params.id, `${current.slug} restored to version saved ${rev.createdAt?.toISOString() ?? ''} (as draft)`);
    return ok(res, p);
  }),
);

// Reviews moderation (only verified-purchase reviews can exist).
adminContentRoutes.get(
  '/reviews',
  requirePermission('reviews:moderate'),
  ah(async (_req, res) => ok(res, await Review.find().populate('product', 'sku name slug').populate('customer', 'name email').sort({ createdAt: -1 }).limit(200).lean())),
);
adminContentRoutes.patch(
  '/reviews/:id',
  requirePermission('reviews:moderate'),
  validate(idParam, 'params'),
  validate(reviewModerate),
  ah(async (req, res) => {
    const r = await Review.findByIdAndUpdate(req.params.id, { $set: { status: req.body.status } }, { new: true }).lean();
    if (!r) throw notFound('Review');
    await audit(req, 'moderate', 'review', req.params.id, req.body.status);
    return ok(res, r);
  }),
);
