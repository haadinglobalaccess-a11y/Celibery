import express, { Router } from 'express';
import { z } from 'zod';
import { audit } from '../../lib/audit';
import { ah, ok } from '../../lib/http';
import { requireCustomer, requirePermission } from '../../middleware/auth';
import { limiter, reviewLimiter } from '../../middleware/security';
import { q, validate } from '../../middleware/validate';
import { idParam, objectId, text } from '../admin/admin.schemas';
import * as svc from './review.service';

const slugParam = z.object({ slug: z.string().trim().toLowerCase().regex(/^[a-z0-9-]{1,120}$/) });
const reviewInput = z.object({
  rating: z.number().int().min(1, 'Choose a rating from 1 to 5').max(5, 'Choose a rating from 1 to 5'),
  title: text(120).default(''),
  body: text(2000).default(''),
  displayName: text(60).default(''),
  lang: z.enum(['ar', 'en']).default('ar'),
  imageIds: z.array(objectId).max(3).default([]),
});
const listQuery = z.object({ rating: z.coerce.number().int().min(1).max(5).optional(), page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(50).default(20) });
const photoInput = z.object({ filename: z.string().trim().min(1).max(200), contentType: z.string().max(100), size: z.number().int().min(1), width: z.number().int().min(1).max(20000).optional(), height: z.number().int().min(1).max(20000).optional() });
const photoLimiter = limiter(60 * 60_000, 30, 'review-photo');
const reportLimiter = limiter(60 * 60_000, 20, 'review-report');

/** Storefront + signed-in customers (mounted under /api). */
export const publicReviewRoutes = Router();
publicReviewRoutes.get(
  '/products/:slug/reviews',
  validate(slugParam, 'params'),
  validate(listQuery, 'query'),
  ah(async (req, res) => {
    const r = await svc.publicList(req.params.slug, q(req, listQuery));
    return ok(res, r.items, 200, { total: r.total }); // array as before; total in meta
  }),
);
publicReviewRoutes.get('/products/:slug/reviews/mine', requireCustomer, validate(slugParam, 'params'), ah(async (req, res) => ok(res, await svc.mine(req.params.slug, req.user!.id))));
publicReviewRoutes.post('/products/:slug/reviews', requireCustomer, reviewLimiter, validate(slugParam, 'params'), validate(reviewInput), ah(async (req, res) => ok(res, await svc.submit(req.params.slug, req.user!.id, req.body), 201)));
publicReviewRoutes.put('/products/:slug/reviews/mine', requireCustomer, reviewLimiter, validate(slugParam, 'params'), validate(reviewInput), ah(async (req, res) => ok(res, await svc.edit(req.params.slug, req.user!.id, req.body))));
publicReviewRoutes.delete('/products/:slug/reviews/mine', requireCustomer, validate(slugParam, 'params'), ah(async (req, res) => ok(res, await svc.removeOwn(req.params.slug, req.user!.id))));
publicReviewRoutes.post('/reviews/:id/report', requireCustomer, reportLimiter, validate(idParam, 'params'), validate(z.object({ reason: text(300).default('') })), ah(async (req, res) => ok(res, await svc.report(req.params.id, req.user!.id, req.body.reason))));

// Review photos: same verified-upload pipeline as the media library, owner-checked.
publicReviewRoutes.post('/reviews/uploads', requireCustomer, photoLimiter, validate(photoInput), ah(async (req, res) => ok(res, await svc.startPhotoUpload(req.user!.id, req.body), 201)));
publicReviewRoutes.put(
  '/reviews/uploads/:id/content',
  requireCustomer,
  photoLimiter,
  validate(idParam, 'params'),
  express.raw({ type: () => true, limit: '5mb' }),
  ah(async (req, res) => {
    await svc.receivePhoto(req.params.id, req.user!.id, String(req.query.key ?? ''), req.body as Buffer);
    return ok(res, { received: true });
  }),
);
publicReviewRoutes.post('/reviews/uploads/:id/complete', requireCustomer, validate(idParam, 'params'), ah(async (req, res) => ok(res, await svc.finishPhoto(req.params.id, req.user!.id))));

/** Staff moderation (mounted under /api/admin/reviews). */
export const adminReviewRoutes = Router();
adminReviewRoutes.use(requirePermission('reviews:moderate'));
const adminQuery = z.object({
  status: z.enum(['pending', 'approved', 'rejected', 'hidden']).optional(),
  rating: z.coerce.number().int().min(1).max(5).optional(),
  product: objectId.optional(),
  q: z.string().trim().max(100).optional(),
  reported: z.enum(['1', 'true']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
adminReviewRoutes.get(
  '/',
  validate(adminQuery, 'query'),
  ah(async (req, res) => {
    const x = q(req, adminQuery);
    return ok(res, await svc.adminList({ ...x, reported: Boolean(x.reported) }));
  }),
);
adminReviewRoutes.patch(
  '/:id',
  validate(idParam, 'params'),
  validate(z.object({ status: z.enum(['approved', 'rejected', 'hidden']), note: text(300).default('') })),
  ah(async (req, res) => {
    const r = await svc.moderate(req.params.id, req.body.status, req.user!.id, req.body.note);
    await audit(req, 'moderate', 'review', req.params.id, `${req.body.status}${req.body.note ? ` — ${req.body.note}` : ''}`);
    return ok(res, r);
  }),
);
adminReviewRoutes.delete(
  '/:id',
  validate(idParam, 'params'),
  ah(async (req, res) => {
    const r = await svc.adminDelete(req.params.id);
    await audit(req, 'delete', 'review', req.params.id);
    return ok(res, r);
  }),
);
