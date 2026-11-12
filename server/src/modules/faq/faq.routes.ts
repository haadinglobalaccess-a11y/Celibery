import { Router, type Request, type Response } from 'express';
import { audit } from '../../lib/audit';
import { notFound } from '../../lib/errors';
import { ah, ok } from '../../lib/http';
import { requirePermission } from '../../middleware/auth';
import { q, validate } from '../../middleware/validate';
import { Faq, Settings, getSettings } from '../../models';
import { idParam } from '../admin/admin.schemas';
import {
  faqCategoryDeleteQuery,
  faqCategoryInput,
  faqCategoryReorderInput,
  faqInput,
  faqListQuery,
  faqMoveInput,
  faqReorderInput,
  faqSettingsInput,
  faqStatusInput,
} from './faq.schemas';
import * as svc from './faq.service';

/** Public: the dedicated FAQ page (published content only). Revalidated on every load (ETag). */
export async function publicFaq(_req: Request, res: Response) {
  res.set('Cache-Control', 'no-cache');
  return ok(res, await svc.publicFaqPage());
}

/**
 * Admin → Website → FAQ management. Mounted under /api/admin (staff session required); every
 * route also requires `content:write` — the same permission as the rest of the website content.
 * Static paths (/categories, /settings, /reorder) are declared before /:id.
 */
export const adminFaqRoutes = Router();
adminFaqRoutes.use(requirePermission('content:write'));

const summary = (f: { question?: { en?: string | null; ar?: string | null } | null }) => String(f.question?.en || f.question?.ar || '').slice(0, 120);

// ---- Display settings ----
adminFaqRoutes.get('/settings', ah(async (_req, res) => ok(res, await svc.faqSettings())));
adminFaqRoutes.put(
  '/settings',
  validate(faqSettingsInput),
  ah(async (req, res) => {
    await getSettings();
    const set = Object.fromEntries(Object.entries(req.body as Record<string, unknown>).map(([k, v]) => [`faq.${k}`, v]));
    if (Object.keys(set).length) await Settings.updateOne({ key: 'store' }, { $set: set }, { runValidators: true });
    await audit(req, 'update', 'faq_settings', 'store', Object.keys(req.body).join(', '));
    return ok(res, await svc.faqSettings());
  }),
);

// ---- Categories ----
adminFaqRoutes.get('/categories', ah(async (_req, res) => ok(res, await svc.listCategoriesWithCounts())));
adminFaqRoutes.post(
  '/categories',
  validate(faqCategoryInput),
  ah(async (req, res) => {
    const c = await svc.createCategory(req.body);
    await audit(req, 'create', 'faq_category', c._id, c.slug);
    return ok(res, c.toObject(), 201);
  }),
);
adminFaqRoutes.post(
  '/categories/reorder',
  validate(faqCategoryReorderInput),
  ah(async (req, res) => {
    const r = await svc.reorderCategories(req.body.ids);
    await audit(req, 'reorder', 'faq_category', '', `${r.reordered} categories`);
    return ok(res, r);
  }),
);
adminFaqRoutes.put(
  '/categories/:id',
  validate(idParam, 'params'),
  validate(faqCategoryInput),
  ah(async (req, res) => {
    const c = await svc.updateCategory(req.params.id, req.body);
    await audit(req, 'update', 'faq_category', req.params.id, c.slug);
    return ok(res, c);
  }),
);
adminFaqRoutes.delete(
  '/categories/:id',
  validate(idParam, 'params'),
  validate(faqCategoryDeleteQuery, 'query'),
  ah(async (req, res) => {
    const { reassignTo } = q(req, faqCategoryDeleteQuery);
    const r = await svc.deleteCategory(req.params.id, reassignTo);
    await audit(req, 'delete', 'faq_category', req.params.id, `${r.name?.en || r.name?.ar || ''}${r.moved ? ` — ${r.moved} FAQ(s) moved to ${reassignTo}` : ''}`);
    return ok(res, { deleted: true, moved: r.moved });
  }),
);

// ---- FAQs ----
adminFaqRoutes.get(
  '/',
  validate(faqListQuery, 'query'),
  ah(async (req, res) => {
    const r = await svc.adminListFaqs(q(req, faqListQuery));
    const query = q(req, faqListQuery);
    return ok(res, r.items, 200, { total: r.total, page: query.page, pages: r.pages, stats: r.stats });
  }),
);
adminFaqRoutes.post(
  '/',
  validate(faqInput),
  ah(async (req, res) => {
    const f = await svc.createFaq(req.body, req.user!.id);
    await audit(req, 'create', 'faq', f._id, `${f.status}: ${summary(f)}`);
    return ok(res, f.toObject(), 201);
  }),
);
adminFaqRoutes.post(
  '/reorder',
  validate(faqReorderInput),
  ah(async (req, res) => {
    const r = await svc.reorderFaqs(req.body.ids);
    await audit(req, 'reorder', 'faq', '', `${r.reordered} FAQs`);
    return ok(res, r);
  }),
);
adminFaqRoutes.get(
  '/:id',
  validate(idParam, 'params'),
  ah(async (req, res) => {
    const f = await Faq.findById(req.params.id).populate('category', 'name slug visible').lean();
    if (!f) throw notFound('FAQ');
    return ok(res, f);
  }),
);
adminFaqRoutes.put(
  '/:id',
  validate(idParam, 'params'),
  validate(faqInput),
  ah(async (req, res) => {
    const f = await svc.updateFaq(req.params.id, req.body, req.user!.id);
    await audit(req, 'update', 'faq', req.params.id, `${f?.status}: ${summary(f ?? {})}`);
    return ok(res, f);
  }),
);
adminFaqRoutes.patch(
  '/:id/status',
  validate(idParam, 'params'),
  validate(faqStatusInput),
  ah(async (req, res) => {
    const f = await svc.setFaqStatus(req.params.id, req.body.status, req.user!.id);
    await audit(req, req.body.status === 'published' ? 'publish' : 'unpublish', 'faq', req.params.id, summary(f ?? {}));
    return ok(res, f);
  }),
);
adminFaqRoutes.post(
  '/:id/move',
  validate(idParam, 'params'),
  validate(faqMoveInput),
  ah(async (req, res) => {
    const r = await svc.moveFaq(req.params.id, req.body.direction);
    if (r.moved) await audit(req, 'reorder', 'faq', req.params.id, `moved ${req.body.direction}`);
    return ok(res, r);
  }),
);
adminFaqRoutes.post(
  '/:id/duplicate',
  validate(idParam, 'params'),
  ah(async (req, res) => {
    const f = await svc.duplicateFaq(req.params.id, req.user!.id);
    await audit(req, 'duplicate', 'faq', f._id, `copy of ${req.params.id}`);
    return ok(res, f.toObject(), 201);
  }),
);
adminFaqRoutes.delete(
  '/:id',
  validate(idParam, 'params'),
  ah(async (req, res) => {
    const f = await Faq.findByIdAndDelete(req.params.id).lean();
    if (!f) throw notFound('FAQ');
    await audit(req, 'delete', 'faq', req.params.id, summary(f));
    return ok(res, { deleted: true });
  }),
);
