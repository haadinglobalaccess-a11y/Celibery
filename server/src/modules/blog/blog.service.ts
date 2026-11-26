import { notFound } from '../../lib/errors';
import { BlogPost, Category, Product, getSettings } from '../../models';
import { toPublicProduct, type LeanProduct } from '../catalog/catalog.service';
import { STARTER_POSTS } from './starter-posts';

/** Published articles, newest first (public). */
export async function listPublishedPosts(page = 1, limit = 12) {
  const filter = { status: 'published', publishedAt: { $ne: null, $lte: new Date() } };
  const [items, total] = await Promise.all([
    BlogPost.find(filter).select('slug title excerpt coverImage tags author publishedAt updatedAt').sort({ publishedAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    BlogPost.countDocuments(filter),
  ]);
  return { items, total, page, pages: Math.max(1, Math.ceil(total / limit)) };
}

const PUBLIC_PRODUCT_FIELDS = 'slug name shortDescription price compareAtPrice images stock lowStockThreshold category model attributes dataSource';

/** One published article with its related products and the latest other articles. */
export async function getPublishedPost(slug: string) {
  const post = await BlogPost.findOne({ slug, status: 'published', publishedAt: { $ne: null, $lte: new Date() } }).lean();
  if (!post) throw notFound('Article');
  const settings = await getSettings();
  const low = settings?.commerce?.lowStockThreshold ?? 5;
  const [products, more] = await Promise.all([
    post.relatedProducts?.length ? Product.find({ _id: { $in: post.relatedProducts }, status: 'active' }).select(PUBLIC_PRODUCT_FIELDS).lean() : [],
    BlogPost.find({ status: 'published', publishedAt: { $ne: null, $lte: new Date() }, _id: { $ne: post._id } })
      .select('slug title excerpt coverImage publishedAt')
      .sort({ publishedAt: -1 })
      .limit(3)
      .lean(),
  ]);
  const order = new Map((post.relatedProducts ?? []).map((id, i) => [String(id), i]));
  products.sort((a, b) => (order.get(String(a._id)) ?? 0) - (order.get(String(b._id)) ?? 0));
  return { ...post, products: products.map((p) => toPublicProduct(p as unknown as LeanProduct, low)), more };
}

/**
 * Adds the starter buying guides as drafts (skips any slug that already exists). Each is linked to
 * up to four active products from its category, so the guide points to what the store sells.
 */
export async function addStarterPosts() {
  const added: string[] = [];
  for (const s of STARTER_POSTS) {
    if (await BlogPost.exists({ slug: s.slug })) continue;
    const cats = await Category.find({ slug: { $in: s.categories } }).select('_id').lean();
    const related = cats.length
      ? await Product.find({ category: { $in: cats.map((c) => c._id) }, status: 'active', dataSource: { $ne: 'demo' } }).select('_id').sort({ featured: -1, sortOrder: 1 }).limit(4).lean()
      : [];
    await BlogPost.create({ slug: s.slug, title: s.title, excerpt: s.excerpt, body: s.body, tags: s.tags, relatedProducts: related.map((p) => p._id), status: 'draft' });
    added.push(s.slug);
  }
  return { added };
}
