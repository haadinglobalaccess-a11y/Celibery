import { Router } from 'express';
import { z } from 'zod';
import { audit } from '../../lib/audit';
import { forbidden } from '../../lib/errors';
import { ah, ok } from '../../lib/http';
import { requirePermission } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { HOME_VIDEO_POSITIONS } from '../../models';
import { idParam, objectId, text } from '../admin/admin.schemas';
import * as svc from './home-video.service';

const loc = (max: number) => z.object({ ar: text(max).default(''), en: text(max).default('') });
const position = z.number().int().min(1).max(HOME_VIDEO_POSITIONS.length).nullable();

export const homeVideoInput = z
  .object({
    sourceType: z.enum(['url', 'upload']),
    url: z.string().trim().max(2000).optional(),
    mediaId: objectId.optional(),
    title: loc(120).refine((t) => Boolean(t.ar || t.en), 'Enter a title in Arabic or English'),
    description: loc(400).default({ ar: '', en: '' }),
    posterUrl: z.string().trim().max(2000).optional().default(''),
    posterMediaId: objectId.nullable().optional(),
    posterAlt: loc(200).default({ ar: '', en: '' }),
    position: position.optional(),
    active: z.boolean().default(false),
    display: z
      .object({
        fit: z.enum(['cover', 'contain']).default('cover'),
        mutedPreview: z.boolean().default(false),
        loop: z.boolean().default(false),
        startAt: z.number().int().min(0).max(86_400).default(0),
      })
      .default({ fit: 'cover', mutedPreview: false, loop: false, startAt: 0 }),
  })
  .superRefine((v, ctx) => {
    if (v.sourceType === 'url' && !v.url) ctx.addIssue({ code: 'custom', path: ['url'], message: 'Paste the video link' });
    if (v.sourceType === 'upload' && !v.mediaId) ctx.addIssue({ code: 'custom', path: ['mediaId'], message: 'Upload or choose a video file' });
  });

const slotsInput = z.object({ slots: z.array(objectId.nullable()).length(HOME_VIDEO_POSITIONS.length) });
const sectionInput = z.object({ enabled: z.boolean(), eyebrow: loc(80), title: loc(120), subtitle: loc(300) });
const inspectInput = z.object({ url: z.string().trim().min(1).max(2000) });
const label = (v: { title?: { en?: string | null; ar?: string | null } | null; provider?: string | null }) => `${v.provider ?? ''} ${v.title?.en || v.title?.ar || ''}`.trim().slice(0, 200);

/** Public: the homepage video section (active, placed videos only). Cached; admin saves refresh it. */
export const publicHomeVideoRoutes = Router();
publicHomeVideoRoutes.get('/home/videos', ah(async (_req, res) => ok(res, await svc.publicHomeVideos())));

/**
 * Admin → Website → Homepage videos. Mounted under /api/admin (staff session); every route needs
 * `content:write`. Uploading files and deleting stored files additionally need `media:write`
 * (uploads go through the existing media-library API, which enforces it).
 */
export const adminHomeVideoRoutes = Router();
adminHomeVideoRoutes.use(requirePermission('content:write'));

adminHomeVideoRoutes.get('/', ah(async (_req, res) => ok(res, { videos: await svc.listVideos(), section: await svc.sectionSettings(), positions: HOME_VIDEO_POSITIONS.length })));

adminHomeVideoRoutes.post('/inspect', validate(inspectInput), ah(async (req, res) => ok(res, await svc.inspectUrl(req.body.url))));

adminHomeVideoRoutes.put(
  '/section',
  validate(sectionInput),
  ah(async (req, res) => {
    const s = await svc.saveSectionSettings(req.body);
    await audit(req, 'update', 'home_video_section', 'home', req.body.enabled ? 'enabled' : 'disabled');
    return ok(res, s);
  }),
);

adminHomeVideoRoutes.put(
  '/slots',
  validate(slotsInput),
  ah(async (req, res) => {
    await svc.setSlots(req.body.slots);
    await audit(req, 'reorder', 'home_video', '', (req.body.slots as (string | null)[]).map((s, i) => `${i + 1}:${s ?? '—'}`).join(' '));
    return ok(res, await svc.listVideos());
  }),
);

adminHomeVideoRoutes.post(
  '/',
  validate(homeVideoInput),
  ah(async (req, res) => {
    const v = await svc.createVideo(req.body, req.user!.id);
    await audit(req, 'create', 'home_video', v._id, label(v));
    return ok(res, v, 201);
  }),
);

adminHomeVideoRoutes.put(
  '/:id',
  validate(idParam, 'params'),
  validate(homeVideoInput),
  ah(async (req, res) => {
    const v = await svc.updateVideo(req.params.id, req.body, req.user!.id);
    await audit(req, 'update', 'home_video', v._id, label(v));
    return ok(res, v);
  }),
);

adminHomeVideoRoutes.patch(
  '/:id/status',
  validate(idParam, 'params'),
  validate(z.object({ active: z.boolean() })),
  ah(async (req, res) => {
    const v = await svc.setActive(req.params.id, req.body.active, req.user!.id);
    await audit(req, req.body.active ? 'publish' : 'unpublish', 'home_video', v._id, label(v));
    return ok(res, v);
  }),
);

adminHomeVideoRoutes.patch(
  '/:id/archive',
  validate(idParam, 'params'),
  validate(z.object({ archived: z.boolean() })),
  ah(async (req, res) => {
    const v = await svc.setArchived(req.params.id, req.body.archived, req.user!.id);
    await audit(req, req.body.archived ? 'archive' : 'restore', 'home_video', v._id, label(v));
    return ok(res, v);
  }),
);

adminHomeVideoRoutes.delete(
  '/:id',
  validate(idParam, 'params'),
  ah(async (req, res) => {
    const deleteFile = req.query.deleteFile === '1';
    const canDeleteFiles = req.user!.permissions.has('media:write');
    if (deleteFile && !canDeleteFiles) throw forbidden('Deleting stored video files requires the media permission (media:write)');
    const r = await svc.deleteVideo(req.params.id, { deleteFile, canDeleteFiles });
    await audit(req, 'delete', 'home_video', req.params.id, `${r.sourceType}; file: ${r.file}`);
    return ok(res, r);
  }),
);
