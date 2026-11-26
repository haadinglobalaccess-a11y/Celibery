import { Router } from 'express';
import { z } from 'zod';
import { ah, ok } from '../../lib/http';
import { q, validate } from '../../middleware/validate';
import { slugParam } from '../catalog/catalog.schemas';
import { getPublishedPost, listPublishedPosts } from './blog.service';

/** Public blog API: published articles only. */
export const blogRoutes = Router();

const listQuery = z.object({ page: z.coerce.number().int().min(1).max(500).default(1), limit: z.coerce.number().int().min(1).max(48).default(12) });

blogRoutes.get(
  '/blog',
  validate(listQuery, 'query'),
  ah(async (req, res) => {
    const { page, limit } = q(req, listQuery);
    const r = await listPublishedPosts(page, limit);
    res.set('Cache-Control', 'public, max-age=60');
    return ok(res, r.items, 200, { total: r.total, page: r.page, pages: r.pages });
  }),
);

blogRoutes.get(
  '/blog/:slug',
  validate(slugParam, 'params'),
  ah(async (req, res) => {
    res.set('Cache-Control', 'public, max-age=60');
    return ok(res, await getPublishedPost(req.params.slug));
  }),
);
