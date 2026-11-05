import express, { Router } from 'express';
import { z } from 'zod';
import { env } from '../../config/env';
import { audit } from '../../lib/audit';
import { notFound } from '../../lib/errors';
import { ah, escapeRegex, ok } from '../../lib/http';
import { ALLOWED_IMAGE_MIME, ALLOWED_VIDEO_MIME } from '../../lib/media-sniff';
import { requireAnyPermission, requirePermission } from '../../middleware/auth';
import { limiter } from '../../middleware/security';
import { q, validate } from '../../middleware/validate';
import { storageStatus } from '../../integrations/storage';
import { MediaAsset } from '../../models';
import { idParam } from './admin.schemas';
import * as svc from './media.service';

/**
 * Media library API. Reading/picking is available to anyone who edits products or content;
 * uploading, editing and deleting requires `media:write`.
 */
export const adminMediaRoutes = Router();

const loc = z.object({ ar: z.string().trim().max(300).default(''), en: z.string().trim().max(300).default('') });
const listQuery = z.object({
  kind: z.enum(['image', 'video']).optional(),
  source: z.enum(['upload', 'external']).optional(),
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(40),
});
const uploadInput = z.object({
  kind: z.enum(['image', 'video']),
  filename: z.string().trim().min(1).max(200),
  title: z.string().trim().max(200).optional(),
  alt: loc.optional(),
  width: z.number().int().min(1).max(20000).optional(),
  height: z.number().int().min(1).max(20000).optional(),
  durationSec: z.number().min(0).max(3600).optional(),
  parts: z
    .array(z.object({ role: z.string().max(10), contentType: z.string().max(100), size: z.number().int().min(1), width: z.number().int().min(1).max(20000).optional() }))
    .min(1)
    .max(6),
});
const externalInput = z.object({
  kind: z.enum(['image', 'video']),
  url: z.string().trim().max(2000),
  title: z.string().trim().max(200).optional(),
  alt: loc.optional(),
  posterUrl: z.string().trim().max(2000).optional(),
});
const patchInput = z.object({ title: z.string().trim().max(200).optional(), alt: loc.optional(), tags: z.array(z.string().trim().max(40)).max(20).optional() });

const uploadLimiter = limiter(10 * 60_000, 120);

adminMediaRoutes.get(
  '/config',
  requireAnyPermission('media:write', 'products:write', 'content:write', 'settings:write'),
  ah(async (_req, res) => ok(res, { ...storageStatus(), imageTypes: ALLOWED_IMAGE_MIME, videoTypes: ALLOWED_VIDEO_MIME })),
);

adminMediaRoutes.get(
  '/',
  requireAnyPermission('media:write', 'products:write', 'content:write', 'settings:write'),
  validate(listQuery, 'query'),
  ah(async (req, res) => {
    const query = q(req, listQuery);
    const filter: Record<string, unknown> = { status: 'ready' };
    if (query.kind) filter.kind = query.kind;
    if (query.source) filter.source = query.source;
    if (query.q) {
      const rx = new RegExp(escapeRegex(query.q), 'i');
      filter.$or = [{ title: rx }, { filename: rx }, { url: rx }, { tags: rx }];
    }
    const [items, total] = await Promise.all([
      MediaAsset.find(filter).sort({ createdAt: -1 }).skip((query.page - 1) * query.limit).limit(query.limit).lean(),
      MediaAsset.countDocuments(filter),
    ]);
    return ok(res, items, 200, { total, page: query.page, pages: Math.max(1, Math.ceil(total / query.limit)) });
  }),
);

adminMediaRoutes.post(
  '/uploads',
  requirePermission('media:write'),
  uploadLimiter,
  validate(uploadInput),
  ah(async (req, res) => ok(res, await svc.createUpload(req.body, req.user!.id), 201)),
);

// Local-disk storage only: the browser PUTs the raw bytes here (S3 uploads go straight to the bucket).
adminMediaRoutes.put(
  '/:id/content',
  requirePermission('media:write'),
  uploadLimiter,
  validate(idParam, 'params'),
  express.raw({ type: () => true, limit: `${Math.max(env.MEDIA_MAX_IMAGE_MB, env.MEDIA_MAX_VIDEO_MB)}mb` }),
  ah(async (req, res) => {
    const key = String(req.query.key ?? '');
    await svc.receiveLocalPart(req.params.id, key, req.body as Buffer);
    return ok(res, { received: true });
  }),
);

adminMediaRoutes.post(
  '/:id/complete',
  requirePermission('media:write'),
  validate(idParam, 'params'),
  ah(async (req, res) => {
    const asset = await svc.completeUpload(req.params.id);
    await audit(req, 'upload', 'media', req.params.id, `${asset?.kind} ${asset?.filename ?? ''}`);
    return ok(res, asset);
  }),
);

adminMediaRoutes.post(
  '/external',
  requirePermission('media:write'),
  validate(externalInput),
  ah(async (req, res) => {
    const asset = await svc.addExternal(req.body, req.user!.id);
    await audit(req, 'add_url', 'media', asset._id, `${asset.kind} ${asset.url}`.slice(0, 300));
    return ok(res, asset, 201);
  }),
);

adminMediaRoutes.get(
  '/:id/usage',
  requireAnyPermission('media:write', 'products:write', 'content:write'),
  validate(idParam, 'params'),
  ah(async (req, res) => {
    const asset = await MediaAsset.findById(req.params.id).lean();
    if (!asset) throw notFound('Media');
    return ok(res, await svc.findMediaUsage(asset));
  }),
);

adminMediaRoutes.patch(
  '/:id',
  requirePermission('media:write'),
  validate(idParam, 'params'),
  validate(patchInput),
  ah(async (req, res) => {
    const a = await MediaAsset.findByIdAndUpdate(req.params.id, { $set: req.body }, { new: true }).lean();
    if (!a) throw notFound('Media');
    return ok(res, a);
  }),
);

adminMediaRoutes.delete(
  '/:id',
  requirePermission('media:write'),
  validate(idParam, 'params'),
  ah(async (req, res) => {
    const r = await svc.deleteMedia(req.params.id, { confirmOrders: req.query.confirmOrders === '1' });
    await audit(req, 'delete', 'media', req.params.id);
    return ok(res, r);
  }),
);
