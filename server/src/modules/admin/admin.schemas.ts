import { z } from 'zod';
import { FILTER_KEYS } from '../../models/Category';
import { CONNECTORS } from '../../models/Product';
import { PERMISSIONS } from '../../lib/permissions';
import { cleanLocLine, cleanLocRich, hasReplacementChar, repairMojibake } from '../../lib/text';

export const objectId = z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid id');
export const idParam = z.object({ id: objectId });

/**
 * Customer-visible text typed or pasted in the Admin. Encoding damage that can be reversed exactly
 * (UTF-8 read as Windows-1252, e.g. the Arabic word for Riyadh shown as Latin "Ø/Ù" letter pairs) is repaired; text containing "\ufffd" — characters
 * already lost before they reached the store — is refused so it never goes live. Legitimate Unicode
 * (Arabic, accents, symbols, emoji) is never rejected.
 */
export const text = (max: number, min = 0, minMessage?: string) =>
  z
    .string()
    .trim()
    .min(min, minMessage)
    .max(max)
    .refine((v) => !hasReplacementChar(v), 'Contains unreadable characters (\ufffd). The text was damaged before it was pasted: copy it again from the original document.')
    .transform(repairMojibake);
export const localized = z.object({ ar: text(20000).default(''), en: text(20000).default('') });
const localizedShort = z.object({ ar: text(300).default(''), en: text(300).default('') });
const requiredLocalized = z.object({ ar: text(300, 1, 'Arabic is required'), en: text(300, 1, 'English is required') });
/**
 * Links and media URLs saved by staff: an absolute http(s) URL or a path on this site. Paths that
 * start with "//" or "/\" are refused — browsers treat them as another website (open redirect).
 */
export const isSafeLink = (v: string) => v === '' || /^https?:\/\/[^\s/\\]+(?:[/?#][^\s]*)?$/i.test(v) || /^\/(?![/\\])[^\s]*$/.test(v);
const url = z.string().trim().max(1000).refine(isSafeLink, 'Must be a URL (https://…) or a site path (/…)');
const slug = z.string().trim().toLowerCase().regex(/^[a-z0-9-]{1,100}$/, 'Use lowercase letters, numbers and dashes');
/** Product / category / collection image: a URL (external or uploaded) plus optional media-library metadata. */
const image = z.object({
  url: url.refine((v) => v !== '', 'Image URL is required'),
  alt: localizedShort.default({ ar: '', en: '' }),
  mediaId: z.string().regex(/^[a-f0-9]{24}$/i).nullable().optional(),
  variants: z.array(z.object({ width: z.number().int().min(16).max(8000), url: url.refine((v) => v !== '', 'Variant URL is required') })).max(6).optional(),
  width: z.number().int().min(1).max(20000).nullable().optional(),
  height: z.number().int().min(1).max(20000).nullable().optional(),
});
const sar = z.number().min(0).max(1_000_000); // input in SAR, stored in halalas
const hex = z.string().trim().regex(/^(#[0-9a-fA-F]{6})?$/, 'Use a hex colour like #1A2B3C');

export const productInput = z.object({
  slug,
  sku: z.string().trim().toUpperCase().min(2).max(60),
  model: z.string().trim().max(80).default(''),
  // Product text is normalised on save (lib/text.ts): no HTML, entities, encoding damage or stray markup.
  name: requiredLocalized.transform(cleanLocLine),
  shortDescription: localizedShort.transform(cleanLocLine).default({ ar: '', en: '' }),
  description: localized.transform(cleanLocRich).default({ ar: '', en: '' }),
  category: objectId,
  series: z.string().trim().max(80).default(''),
  images: z.array(image).max(12).default([]),
  price: sar,
  compareAtPrice: sar.nullable().optional(),
  lowStockThreshold: z.number().int().min(0).nullable().optional(),
  status: z.enum(['draft', 'active', 'archived']).default('draft'),
  featured: z.boolean().default(false),
  flagship: z.boolean().default(false),
  flagshipOrder: z.number().int().min(0).max(9999).default(0),
  attributes: z
    .object({
      capacityMah: z.number().int().min(0).max(100000).nullable().optional(),
      powerW: z.number().min(0).max(1000).nullable().optional(),
      connectors: z.array(z.enum(CONNECTORS)).max(10).default([]),
      color: z.object({ key: z.string().trim().toLowerCase().max(40), name: localizedShort, hex }).nullable().optional(),
    })
    .default({ connectors: [] }),
  specs: z.array(z.object({ label: localizedShort.transform(cleanLocLine), value: localizedShort.transform(cleanLocLine) })).max(40).default([]),
  tags: z.array(z.string().trim().max(40)).max(30).default([]),
  warrantyMonths: z.number().int().min(0).max(120).nullable().optional(),
  isBundle: z.boolean().default(false),
  bundleItems: z.array(z.object({ product: objectId, quantity: z.number().int().min(1).max(20) })).max(20).default([]),
  related: z.array(objectId).max(12).default([]),
  sortOrder: z.number().int().default(0),
  seo: z.object({ title: localizedShort, description: localizedShort }).partial().optional(),
});
export const productCreate = productInput.extend({ stock: z.number().int().min(0).max(1_000_000).default(0) });
// Zod 4 applies defaults inside optional fields. A patch must never reset omitted data.
export const productUpdate = z.object(Object.fromEntries(Object.entries(productInput.shape).map(([key, field]) => [
  key, (field instanceof z.ZodDefault ? field.removeDefault() : field).optional(),
])));

export const productListAdmin = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(['draft', 'active', 'archived']).optional(),
  category: objectId.optional(),
  lowStock: z.enum(['1', 'true']).optional(),
  /** Homepage placement — independent of status (a product can be both draft and flagship). */
  placement: z.enum(['featured', 'flagship']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(25),
});

export const categoryInput = z.object({
  slug,
  name: requiredLocalized,
  description: localizedShort.default({ ar: '', en: '' }),
  image: image.nullable().optional(),
  sortOrder: z.number().int().default(0),
  active: z.boolean().default(true),
  filters: z.array(z.enum(FILTER_KEYS)).default(['price', 'color', 'availability']),
  seo: z.object({ title: localizedShort, description: localizedShort }).partial().optional(),
});

export const stockAdjust = z
  .object({
    mode: z.enum(['delta', 'set']),
    value: z.number().int().min(-1_000_000).max(1_000_000),
    reason: z.string().trim().min(2).max(300),
    type: z.enum(['adjustment', 'restock']).default('adjustment'),
  })
  .refine((v) => v.mode === 'delta' || v.value >= 0, { message: 'Stock cannot be negative', path: ['value'] });

export const discountInput = z
  .object({
    code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{3,40}$/, 'Use 3–40 letters, numbers, - or _'),
    description: localizedShort.default({ ar: '', en: '' }),
    type: z.enum(['percent', 'fixed']),
    value: z.number().min(0), // percent (1–100) or SAR for fixed
    maxDiscount: sar.nullable().optional(),
    minOrderTotal: sar.default(0),
    startsAt: z.coerce.date().nullable().optional(),
    endsAt: z.coerce.date().nullable().optional(),
    usageLimit: z.number().int().min(0).nullable().optional(),
    perCustomerLimit: z.number().int().min(0).nullable().optional(),
    categories: z.array(objectId).default([]),
    products: z.array(objectId).default([]),
    active: z.boolean().default(true),
  })
  .refine((d) => d.type !== 'percent' || (d.value > 0 && d.value <= 100), { message: 'Percentage must be between 1 and 100', path: ['value'] })
  .refine((d) => !d.startsAt || !d.endsAt || d.startsAt < d.endsAt, { message: 'End date must be after start date', path: ['endsAt'] });

export const bannerInput = z.object({
  placement: z.enum(['hero', 'lifestyle', 'promo', 'campaign']),
  title: localizedShort.default({ ar: '', en: '' }),
  subtitle: localizedShort.default({ ar: '', en: '' }),
  description: localizedShort.default({ ar: '', en: '' }),
  durationSec: z.number().finite().positive().default(5),
  videoDurationSec: z.number().finite().nonnegative().default(0),
  videoFallbackSec: z.number().min(2).max(300).default(20),
  ctaLabel: localizedShort.default({ ar: '', en: '' }),
  link: url.default(''),
  imageUrl: z.object({ ar: url.default(''), en: url.default('') }).default({ ar: '', en: '' }),
  mobileImageUrl: z.object({ ar: url.default(''), en: url.default('') }).default({ ar: '', en: '' }),
  videoUrl: url.default(''),
  mobileVideoUrl: url.default(''),
  posterUrl: url.default(''),
  theme: z.enum(['dark', 'light']).default('dark'),
  active: z.boolean().default(true),
  startsAt: z.coerce.date().nullable().optional(),
  endsAt: z.coerce.date().nullable().optional(),
  sortOrder: z.number().int().default(0),
});

export const collectionInput = z.object({
  slug,
  kind: z.enum(['featured', 'best_sellers', 'bundles', 'use_case', 'series', 'campaign', 'custom']).default('custom'),
  title: requiredLocalized,
  description: localizedShort.default({ ar: '', en: '' }),
  image: image.nullable().optional(),
  products: z.array(objectId).max(200).default([]),
  active: z.boolean().default(true),
  showOnHome: z.boolean().default(false),
  sortOrder: z.number().int().default(0),
});

export const campaignInput = z.object({
  slug,
  kind: z.enum(['ramadan', 'eid', 'national_day', 'umrah_travel', 'gifting', 'seasonal']).default('seasonal'),
  title: requiredLocalized,
  description: localized.default({ ar: '', en: '' }),
  heroImageUrl: url.default(''),
  heroMobileImageUrl: url.default(''),
  heroVideoUrl: url.default(''),
  accentColor: hex.default(''),
  collection: objectId.nullable().optional(),
  discountCode: z.string().trim().toUpperCase().max(40).default(''),
  active: z.boolean().default(false),
  showOnHome: z.boolean().default(true),
  startsAt: z.coerce.date().nullable().optional(),
  endsAt: z.coerce.date().nullable().optional(),
});

export const pageInput = z.object({
  title: requiredLocalized,
  body: localized,
  status: z.enum(['draft', 'approved']).default('draft'),
  approvedBy: z.string().trim().max(120).default(''),
  /** Short note stored with the version history (e.g. "Legal advisor comments 5 Nov"). */
  reason: z.string().trim().max(300).default(''),
});

export const staffCreate = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email(),
  title: z.string().trim().max(120).default(''),
  roleId: objectId,
});
export const staffUpdate = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  title: z.string().trim().max(120).optional(),
  roleId: objectId.optional(),
  active: z.boolean().optional(),
});
export const roleInput = z.object({
  key: z.string().trim().toLowerCase().regex(/^[a-z_]{2,40}$/),
  name: requiredLocalized,
  permissions: z.array(z.enum(PERMISSIONS)).default([]),
});

export const reportQuery = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  format: z.enum(['json', 'csv']).default('json'),
});

export const customerListQuery = z.object({
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const reviewModerate = z.object({ status: z.enum(['approved', 'rejected', 'pending']) });

export const customerStatus = z.object({
  active: z.boolean(),
  /** Optional note for the audit log (e.g. "fraud report", "customer asked to close account"). */
  reason: z.string().trim().max(200).default(''),
});
