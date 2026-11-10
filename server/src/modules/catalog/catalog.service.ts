import type { FilterQuery, Types } from 'mongoose';
import { escapeRegex } from '../../lib/http';
import { notFound } from '../../lib/errors';
import { cleanLocLine, cleanLocRich } from '../../lib/text';
import { Banner, Campaign, Category, Order, Product, ProductCollection, Review, getSettings, type ProductDoc } from '../../models';
import type { ProductListQuery } from './catalog.schemas';
import { availablePaymentMethods } from '../payments/payment.service';

export const PUBLIC_PRODUCT_FIELDS =
  'slug sku model name shortDescription category series images price compareAtPrice stock lowStockThreshold featured attributes tags isBundle dataSource createdAt';

type LeanProduct = Record<string, unknown> & { _id: Types.ObjectId; price: number; compareAtPrice?: number | null; stock: number; lowStockThreshold?: number | null };

/** Public shape: exact stock is not exposed, only availability. */
export function toPublicProduct(p: LeanProduct, defaultLowStock = 5) {
  const { stock, lowStockThreshold, ...rest } = p;
  const threshold = lowStockThreshold ?? defaultLowStock;
  const compareAt = p.compareAtPrice && p.compareAtPrice > p.price ? p.compareAtPrice : null;
  // Text saved before save-time cleaning existed is normalised here too (idempotent, see lib/text.ts).
  type Spec = { label?: { ar?: string; en?: string }; value?: { ar?: string; en?: string } };
  const text: Record<string, unknown> = { name: cleanLocLine(rest.name as never), shortDescription: cleanLocLine(rest.shortDescription as never) };
  if ('description' in rest) text.description = cleanLocRich(rest.description as never);
  if (Array.isArray(rest.specs)) text.specs = (rest.specs as Spec[]).map((x) => ({ label: cleanLocLine(x.label), value: cleanLocLine(x.value) }));
  return {
    ...rest,
    ...text,
    compareAtPrice: compareAt,
    discountPercent: compareAt ? Math.round(((compareAt - p.price) / compareAt) * 100) : 0,
    available: stock > 0,
    lowStock: stock > 0 && stock <= threshold,
  };
}

export async function listCategories() {
  const cats = await Category.find({ active: true }).sort({ sortOrder: 1 }).lean();
  const counts = await Product.aggregate<{ _id: Types.ObjectId; n: number }>([
    { $match: { status: 'active' } },
    { $group: { _id: '$category', n: { $sum: 1 } } },
  ]);
  const map = new Map(counts.map((c) => [String(c._id), c.n]));
  return cats.map((c) => ({ ...c, productCount: map.get(String(c._id)) ?? 0 }));
}

/** Available filter values for a category, limited to the filters configured for it (Q18). */
export async function categoryFacets(categoryId: Types.ObjectId, filters: string[]) {
  const match = { status: 'active', category: categoryId };
  const [agg] = await Product.aggregate([
    { $match: match },
    {
      $facet: {
        price: [{ $group: { _id: null, min: { $min: '$price' }, max: { $max: '$price' } } }],
        capacity: [{ $match: { 'attributes.capacityMah': { $gt: 0 } } }, { $group: { _id: '$attributes.capacityMah', n: { $sum: 1 } } }, { $sort: { _id: 1 } }],
        power: [{ $match: { 'attributes.powerW': { $gt: 0 } } }, { $group: { _id: '$attributes.powerW', n: { $sum: 1 } } }, { $sort: { _id: 1 } }],
        connector: [{ $unwind: '$attributes.connectors' }, { $group: { _id: '$attributes.connectors', n: { $sum: 1 } } }, { $sort: { _id: 1 } }],
        color: [
          { $match: { 'attributes.color.key': { $exists: true, $ne: '' } } },
          { $group: { _id: '$attributes.color.key', name: { $first: '$attributes.color.name' }, hex: { $first: '$attributes.color.hex' }, n: { $sum: 1 } } },
          { $sort: { _id: 1 } },
        ],
      },
    },
  ]);
  const out: Record<string, unknown> = {};
  if (filters.includes('price')) out.price = agg.price[0] ? { min: agg.price[0].min, max: agg.price[0].max } : null;
  if (filters.includes('capacityMah')) out.capacity = agg.capacity.map((x: { _id: number; n: number }) => ({ value: x._id, count: x.n }));
  if (filters.includes('powerW')) out.power = agg.power.map((x: { _id: number; n: number }) => ({ value: x._id, count: x.n }));
  if (filters.includes('connector')) out.connector = agg.connector.map((x: { _id: string; n: number }) => ({ value: x._id, count: x.n }));
  if (filters.includes('color'))
    out.color = agg.color.map((x: { _id: string; name: unknown; hex: string; n: number }) => ({ value: x._id, name: x.name, hex: x.hex, count: x.n }));
  if (filters.includes('availability')) out.availability = true;
  return out;
}

export async function getCategory(slug: string) {
  const category = await Category.findOne({ slug, active: true }).lean();
  if (!category) throw notFound('Category');
  const facets = await categoryFacets(category._id, category.filters as string[]);
  return { category, facets };
}

export async function listProducts(q: ProductListQuery) {
  const settings = await getSettings();
  const filter: FilterQuery<ProductDoc> = { status: 'active' };
  let category = null;
  if (q.category) {
    category = await Category.findOne({ slug: q.category, active: true }).lean();
    if (!category) throw notFound('Category');
    filter.category = category._id;
  }
  if (q.collection) {
    const col = await ProductCollection.findOne({ slug: q.collection, active: true }).lean();
    if (!col) throw notFound('Collection');
    filter._id = { $in: col.products };
  }
  if (q.ids?.length) {
    const valid = q.ids.filter((id) => /^[a-f0-9]{24}$/i.test(id));
    filter._id = { $in: valid };
  }
  if (q.q) {
    const rx = new RegExp(escapeRegex(q.q), 'i');
    filter.$or = [{ 'name.ar': rx }, { 'name.en': rx }, { model: rx }, { sku: rx }, { tags: rx }, { series: rx }];
  }
  if (q.minPrice !== undefined || q.maxPrice !== undefined) {
    filter.price = {};
    if (q.minPrice !== undefined) filter.price.$gte = Math.round(q.minPrice * 100);
    if (q.maxPrice !== undefined) filter.price.$lte = Math.round(q.maxPrice * 100);
  }
  if (q.capacity?.length) filter['attributes.capacityMah'] = { $in: q.capacity };
  if (q.power?.length) filter['attributes.powerW'] = { $in: q.power };
  if (q.connector?.length) filter['attributes.connectors'] = { $in: q.connector };
  if (q.color?.length) filter['attributes.color.key'] = { $in: q.color };
  if (q.inStock) filter.stock = { $gt: 0 };

  const sort: Record<string, 1 | -1> =
    q.sort === 'price_asc'
      ? { price: 1, _id: 1 }
      : q.sort === 'price_desc'
        ? { price: -1, _id: 1 }
        : q.sort === 'newest'
          ? { createdAt: -1, _id: 1 }
          : q.sort === 'name'
            ? { [`name.${q.lang}`]: 1, _id: 1 }
            : { featured: -1, sortOrder: 1, createdAt: -1, _id: 1 };

  const skip = (q.page - 1) * q.limit;
  const [items, total] = await Promise.all([
    Product.find(filter).select(PUBLIC_PRODUCT_FIELDS).sort(sort).skip(skip).limit(q.limit).lean(),
    Product.countDocuments(filter),
  ]);
  const low = settings?.commerce?.lowStockThreshold ?? 5;
  return {
    items: items.map((p) => toPublicProduct(p as unknown as LeanProduct, low)),
    total,
    page: q.page,
    pages: Math.max(1, Math.ceil(total / q.limit)),
    category,
  };
}

export async function getProduct(slug: string) {
  const settings = await getSettings();
  const p = await Product.findOne({ slug, status: 'active' })
    .select(PUBLIC_PRODUCT_FIELDS + ' description specs warrantyMonths bundleItems related seo')
    .populate('category', 'slug name')
    .lean();
  if (!p) throw notFound('Product');
  const low = settings?.commerce?.lowStockThreshold ?? 5;

  const relatedIds = (p.related ?? []) as Types.ObjectId[];
  const [relatedExplicit, sameCategory, bundles, bundleItems] = await Promise.all([
    relatedIds.length ? Product.find({ _id: { $in: relatedIds }, status: 'active' }).select(PUBLIC_PRODUCT_FIELDS).limit(8).lean() : [],
    Product.find({ category: (p.category as unknown as { _id: Types.ObjectId })._id, status: 'active', _id: { $ne: p._id } })
      .select(PUBLIC_PRODUCT_FIELDS)
      .sort({ featured: -1, sortOrder: 1 })
      .limit(8)
      .lean(),
    Product.find({ isBundle: true, status: 'active', 'bundleItems.product': p._id }).select(PUBLIC_PRODUCT_FIELDS).limit(4).lean(),
    p.isBundle && p.bundleItems?.length
      ? Product.find({ _id: { $in: p.bundleItems.map((b) => b.product) } }).select('slug name images model').lean()
      : [],
  ]);
  const related = (relatedExplicit.length ? relatedExplicit : sameCategory).map((r) => toPublicProduct(r as unknown as LeanProduct, low));

  const warrantyMonths = settings?.commerce?.warrantyEnabled ? (p.warrantyMonths ?? settings.commerce.warrantyMonths ?? 0) : 0;

  let reviews = null;
  if (settings?.reviews?.enabled) {
    const stats = await Review.aggregate([{ $match: { product: p._id, status: 'approved' } }, { $group: { _id: null, avg: { $avg: '$rating' }, n: { $sum: 1 } } }]);
    reviews = stats[0] ? { average: Math.round(stats[0].avg * 10) / 10, count: stats[0].n } : { average: 0, count: 0 };
  }

  const { related: _r, bundleItems: bi, ...rest } = p as unknown as LeanProduct & { related: unknown; bundleItems: { product: Types.ObjectId; quantity: number }[] };
  return {
    ...toPublicProduct(rest as LeanProduct, low),
    warrantyMonths,
    bundleContents: (bi ?? []).map((b) => ({ quantity: b.quantity, product: bundleItems.find((x) => String(x._id) === String(b.product)) ?? null })),
    related,
    bundles: bundles.map((b) => toPublicProduct(b as unknown as LeanProduct, low)),
    reviews,
    delivery: {
      free: settings?.commerce?.freeDelivery ?? true,
      fee: settings?.commerce?.freeDelivery ? 0 : (settings?.commerce?.deliveryFee ?? 0),
      courier: settings?.commerce?.courierName ?? '',
      estimate: settings?.commerce?.estimatedDelivery ?? { ar: '', en: '' },
    },
  };
}

/** Best sellers are computed from real paid/fulfilled orders; a curated collection is the fallback. */
export async function bestSellers(limit = 8) {
  const settings = await getSettings();
  const low = settings?.commerce?.lowStockThreshold ?? 5;
  const since = new Date(Date.now() - 90 * 24 * 3600 * 1000);
  const top = await Order.aggregate<{ _id: Types.ObjectId; qty: number }>([
    { $match: { createdAt: { $gte: since }, paymentStatus: { $in: ['paid', 'cod_pending', 'cod_collected'] }, status: { $nin: ['cancelled', 'returned'] } } },
    { $unwind: '$items' },
    { $group: { _id: '$items.product', qty: { $sum: '$items.quantity' } } },
    { $sort: { qty: -1 } },
    { $limit: limit * 2 },
  ]);
  if (top.length >= 4) {
    const prods = await Product.find({ _id: { $in: top.map((t) => t._id) }, status: 'active' }).select(PUBLIC_PRODUCT_FIELDS).lean();
    const order = new Map(top.map((t, i) => [String(t._id), i]));
    prods.sort((a, b) => (order.get(String(a._id)) ?? 0) - (order.get(String(b._id)) ?? 0));
    return { source: 'orders' as const, items: prods.slice(0, limit).map((p) => toPublicProduct(p as unknown as LeanProduct, low)) };
  }
  const col = await ProductCollection.findOne({ kind: 'best_sellers', active: true }).lean();
  if (!col) return { source: 'none' as const, items: [] };
  const prods = await Product.find({ _id: { $in: col.products }, status: 'active' }).select(PUBLIC_PRODUCT_FIELDS).limit(limit).lean();
  return { source: 'curated' as const, items: prods.map((p) => toPublicProduct(p as unknown as LeanProduct, low)) };
}

const activeWindow = () => {
  const now = new Date();
  return {
    $and: [
      { $or: [{ startsAt: null }, { startsAt: { $exists: false } }, { startsAt: { $lte: now } }] },
      { $or: [{ endsAt: null }, { endsAt: { $exists: false } }, { endsAt: { $gte: now } }] },
    ],
  };
};

export async function collectionWithProducts(slug: string) {
  const settings = await getSettings();
  const low = settings?.commerce?.lowStockThreshold ?? 5;
  const col = await ProductCollection.findOne({ slug, active: true }).lean();
  if (!col) throw notFound('Collection');
  const prods = await Product.find({ _id: { $in: col.products }, status: 'active' }).select(PUBLIC_PRODUCT_FIELDS).lean();
  const order = new Map(col.products.map((id, i) => [String(id), i]));
  prods.sort((a, b) => (order.get(String(a._id)) ?? 0) - (order.get(String(b._id)) ?? 0));
  return { ...col, products: prods.map((p) => toPublicProduct(p as unknown as LeanProduct, low)) };
}

/** The Flagship section shows up to three products (its design has three campaign slots). */
export const FLAGSHIP_SLOTS = 3;

export async function homePayload() {
  const settings = await getSettings();
  const low = settings?.commerce?.lowStockThreshold ?? 5;
  const [heroBanners, lifestyleBanners, promoBanners, categories, featured, flagship, best, collections, campaigns] = await Promise.all([
    Banner.find({ placement: 'hero', active: true, ...activeWindow() }).sort({ sortOrder: 1, _id: 1 }).lean(),
    Banner.find({ placement: 'lifestyle', active: true, ...activeWindow() }).sort({ sortOrder: 1 }).lean(),
    Banner.find({ placement: 'promo', active: true, ...activeWindow() }).sort({ sortOrder: 1 }).lean(),
    listCategories(),
    Product.find({ status: 'active', featured: true }).select(PUBLIC_PRODUCT_FIELDS).sort({ sortOrder: 1 }).limit(8).lean(),
    // Flagship: ONLY products the Admin selected (never Featured or Best Sellers), active, with a photo, in Admin order.
    // First image must have a real URL ($type + $ne; a $nin: ['', null] filter on this path matches the opposite set).
    Product.find({ status: 'active', flagship: true, 'images.0.url': { $type: 'string', $ne: '' } })
      .select(PUBLIC_PRODUCT_FIELDS)
      .sort({ flagshipOrder: 1, createdAt: 1, _id: 1 })
      .limit(FLAGSHIP_SLOTS)
      .lean(),
    bestSellers(8),
    ProductCollection.find({ active: true, showOnHome: true }).sort({ sortOrder: 1 }).lean(),
    Campaign.find({ active: true, showOnHome: true, ...activeWindow() }).sort({ startsAt: 1 }).lean(),
  ]);

  const colIds = collections.flatMap((c) => c.products);
  const colProducts = colIds.length ? await Product.find({ _id: { $in: colIds }, status: 'active' }).select(PUBLIC_PRODUCT_FIELDS).lean() : [];
  const byId = new Map(colProducts.map((p) => [String(p._id), toPublicProduct(p as unknown as LeanProduct, low)]));

  // A few products per category for the six category sections.
  const perCategory = await Promise.all(
    categories.map(async (c) => ({
      categoryId: String(c._id),
      items: (await Product.find({ status: 'active', category: c._id }).select(PUBLIC_PRODUCT_FIELDS).sort({ featured: -1, sortOrder: 1 }).limit(4).lean()).map((p) =>
        toPublicProduct(p as unknown as LeanProduct, low),
      ),
    })),
  );

  return {
    hero: {
      enabled: settings?.homepage?.heroEnabled !== false,
      sortOrder: settings?.homepage?.heroSortOrder ?? -1,
      durationSec: settings?.homepage?.heroDurationSec ?? 5,
      videoDurationSec: settings?.homepage?.heroVideoDurationSec ?? 0,
      videoFallbackSec: settings?.homepage?.heroVideoFallbackSec ?? 20,
      description: settings?.homepage?.heroDescription ?? { ar: '', en: '' },
      videoUrl: settings?.homepage?.heroVideoUrl ?? '',
      posterUrl: settings?.homepage?.heroPosterUrl ?? '',
      mobileVideoUrl: settings?.homepage?.heroMobileVideoUrl ?? '',
      mobilePosterUrl: settings?.homepage?.heroMobilePosterUrl ?? '',
      ctaLabel: settings?.homepage?.heroCtaLabel ?? { ar: '', en: '' },
      ctaLink: settings?.homepage?.heroCtaLink ?? '',
      title: settings?.homepage?.heroTitle ?? { ar: '', en: '' },
      subtitle: settings?.homepage?.heroSubtitle ?? { ar: '', en: '' },
      banners: heroBanners.map(banner => ({ ...banner, durationSec: banner.durationSec ?? 5, videoDurationSec: banner.videoDurationSec ?? 0 })),
    },
    lifestyleBanners,
    promoBanners,
    categories,
    categoryProducts: perCategory,
    featured: featured.map((p) => toPublicProduct(p as unknown as LeanProduct, low)),
    flagship: flagship.map((p) => toPublicProduct(p as unknown as LeanProduct, low)),
    bestSellers: best,
    collections: collections.map((c) => ({ ...c, products: c.products.map((id) => byId.get(String(id))).filter(Boolean) })),
    campaigns,
    brandStory: { text: settings?.homepage?.brandStory ?? { ar: '', en: '' }, imageUrl: settings?.homepage?.brandStoryImageUrl ?? '' },
    newsletterEnabled: settings?.homepage?.newsletterEnabled ?? true,
  };
}

export async function getCampaign(slug: string) {
  const c = await Campaign.findOne({ slug, active: true, ...activeWindow() }).lean();
  if (!c) throw notFound('Campaign');
  let products: unknown[] = [];
  if (c.collection) {
    const col = await ProductCollection.findById(c.collection).lean();
    if (col) products = (await collectionWithProducts(col.slug)).products;
  }
  return { ...c, products };
}

/** Settings safe to expose publicly (no secrets, no internal-only values). */
export async function publicSettings() {
  const s = await getSettings();
  const paymentsConfigured = availablePaymentMethods(s);
  return {
    business: s?.business,
    brand: s?.brand,
    commerce: {
      currency: s?.commerce?.currency,
      vatRatePercent: s?.commerce?.vatRatePercent,
      freeDelivery: s?.commerce?.freeDelivery,
      deliveryFee: s?.commerce?.deliveryFee,
      freeDeliveryThreshold: s?.commerce?.freeDelivery ? null : (s?.commerce?.freeDeliveryThreshold ?? null),
      shippingAvailable: s?.commerce?.shippingAvailable !== false,
      courierName: s?.commerce?.courierName,
      estimatedDelivery: s?.commerce?.estimatedDelivery,
      warrantyEnabled: s?.commerce?.warrantyEnabled,
      warrantyMonths: s?.commerce?.warrantyMonths,
      maxQuantityPerItem: s?.commerce?.maxQuantityPerItem,
    },
    payments: paymentsConfigured,
    reviewsEnabled: s?.reviews?.enabled ?? false,
    /** Checkout progress is saved (with a notice) only while this is on. */
    checkoutRecovery: { enabled: s?.checkoutRecovery?.enabled !== false },
    seo: s?.seo,
    announcement: s?.announcement ?? { enabled: true, text: { ar: '', en: '' }, link: '' },
  };
}
