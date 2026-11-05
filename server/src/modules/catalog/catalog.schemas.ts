import { z } from 'zod';

const csv = z
  .string()
  .max(500)
  .transform((s) => s.split(',').map((v) => v.trim()).filter(Boolean));
const csvNum = csv.transform((arr) => arr.map(Number).filter((n) => Number.isFinite(n)));

export const productListQuery = z.object({
  category: z.string().trim().max(80).optional(),
  collection: z.string().trim().max(80).optional(),
  q: z.string().trim().max(100).optional(),
  sort: z.enum(['featured', 'newest', 'price_asc', 'price_desc', 'name']).default('featured'),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  limit: z.coerce.number().int().min(1).max(60).default(24),
  minPrice: z.coerce.number().min(0).optional(), // SAR
  maxPrice: z.coerce.number().min(0).optional(), // SAR
  capacity: csvNum.optional(),
  power: csvNum.optional(),
  connector: csv.optional(),
  color: csv.optional(),
  inStock: z.enum(['1', 'true']).optional(),
  ids: csv.optional(),
  lang: z.enum(['ar', 'en']).default('ar'),
});
export type ProductListQuery = z.infer<typeof productListQuery>;

export const slugParam = z.object({ slug: z.string().trim().toLowerCase().regex(/^[a-z0-9-]{1,100}$/) });
export const newsletterSchema = z.object({ email: z.string().trim().toLowerCase().email().max(200), lang: z.enum(['ar', 'en']).default('ar') });
export const reviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  title: z.string().trim().max(120).default(''),
  body: z.string().trim().max(2000).default(''),
  displayName: z.string().trim().max(60).default(''),
  lang: z.enum(['ar', 'en']).default('ar'),
});
