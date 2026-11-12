import type { Types } from 'mongoose';
import { badRequest, conflict, notFound } from '../../lib/errors';
import { escapeRegex } from '../../lib/http';
import { slugify } from '../../lib/slug';
import { Faq, FaqCategory, getSettings, type FaqDoc } from '../../models';
import { completeLangs, type FaqInput } from './faq.schemas';

/**
 * Single source of truth for FAQs: the admin API, the public /api/faq page data and the homepage
 * preview inside /api/home all read through this module.
 */

export const PUBLIC_FAQ_LIMIT = 500;
const ORDER = { sortOrder: 1, _id: 1 } as const;

export type FaqDisplaySettings = {
  homepageEnabled: boolean;
  homepageLimit: number;
  showCategoryFilters: boolean;
  title: { ar: string; en: string };
  subtitle: { ar: string; en: string };
  missingTranslation: 'hide' | 'fallback';
  allowMultipleOpen: boolean;
};

export async function faqSettings(): Promise<FaqDisplaySettings> {
  const f = (await getSettings())?.faq ?? {};
  return {
    homepageEnabled: f.homepageEnabled !== false,
    homepageLimit: Math.min(12, Math.max(1, Number(f.homepageLimit) || 6)),
    showCategoryFilters: Boolean(f.showCategoryFilters),
    title: { ar: f.title?.ar ?? '', en: f.title?.en ?? '' },
    subtitle: { ar: f.subtitle?.ar ?? '', en: f.subtitle?.en ?? '' },
    missingTranslation: f.missingTranslation === 'fallback' ? 'fallback' : 'hide',
    allowMultipleOpen: Boolean(f.allowMultipleOpen),
  };
}

// ---- Public views (published content only, allow-listed fields) ----------------------------

type PublicFaq = { id: string; question: { ar: string; en: string }; answer: { ar: string; en: string }; categoryId: string | null; featured: boolean };
type PublicCategory = { id: string; slug: string; name: { ar: string; en: string } };

const toPublicFaq = (f: Pick<FaqDoc, '_id' | 'question' | 'answer' | 'category' | 'featured'>): PublicFaq => ({
  id: String(f._id),
  question: { ar: f.question?.ar ?? '', en: f.question?.en ?? '' },
  answer: { ar: f.answer?.ar ?? '', en: f.answer?.en ?? '' },
  categoryId: f.category ? String(f.category) : null,
  featured: Boolean(f.featured),
});

/** Visible categories, in admin order. */
async function visibleCategories() {
  return FaqCategory.find({ visible: true }).sort(ORDER).select('slug name').limit(200).lean();
}

/**
 * Published FAQs whose category is visible (or that have no category). Questions in a hidden
 * category are hidden with it.
 */
async function publishedFaqs(extra: Record<string, unknown> = {}, limit = PUBLIC_FAQ_LIMIT) {
  const cats = await visibleCategories();
  const items = await Faq.find({ status: 'published', ...extra, $or: [{ category: null }, { category: { $in: cats.map((c) => c._id) } }] })
    .sort(ORDER)
    .limit(limit)
    .select('question answer category featured')
    .lean();
  return { cats, items };
}

const publicCategories = (cats: { _id: Types.ObjectId; slug: string; name?: { ar?: string; en?: string } | null }[], items: PublicFaq[]): PublicCategory[] => {
  const used = new Set(items.map((i) => i.categoryId));
  return cats.filter((c) => used.has(String(c._id))).map((c) => ({ id: String(c._id), slug: c.slug, name: { ar: c.name?.ar ?? '', en: c.name?.en ?? '' } }));
};

/** Everything the dedicated /faq page needs. */
export async function publicFaqPage() {
  const [settings, { cats, items }] = await Promise.all([faqSettings(), publishedFaqs()]);
  const faqs = items.map(toPublicFaq);
  return {
    settings: { title: settings.title, subtitle: settings.subtitle, missingTranslation: settings.missingTranslation, allowMultipleOpen: settings.allowMultipleOpen },
    categories: publicCategories(cats, faqs),
    items: faqs,
  };
}

/** Homepage preview (embedded in /api/home, so the homepage makes no extra request). */
export async function homepageFaq() {
  const settings = await faqSettings();
  if (!settings.homepageEnabled) return { enabled: false as const, items: [], categories: [] };
  const { cats, items } = await publishedFaqs({ showOnHomepage: true }, settings.homepageLimit);
  const faqs = items.map(toPublicFaq);
  return {
    enabled: faqs.length > 0,
    title: settings.title,
    subtitle: settings.subtitle,
    showCategoryFilters: settings.showCategoryFilters,
    missingTranslation: settings.missingTranslation,
    allowMultipleOpen: settings.allowMultipleOpen,
    categories: publicCategories(cats, faqs),
    items: faqs,
  };
}

/** Last change to published FAQ content (sitemap lastmod); null when nothing is published. */
export async function lastPublishedChange(): Promise<Date | null> {
  const f = await Faq.findOne({ status: 'published' }).sort({ updatedAt: -1 }).select('updatedAt').lean();
  return f ? (f.updatedAt as Date) : null;
}

// ---- Admin --------------------------------------------------------------------------------

async function assertCategory(id: string | null) {
  if (id && !(await FaqCategory.exists({ _id: id }))) throw badRequest('INVALID_CATEGORY', 'Category not found');
}

function assertPublishable(f: { status: string; question: { ar?: string; en?: string }; answer: { ar?: string; en?: string } }) {
  if (f.status === 'published' && completeLangs(f).length === 0) {
    throw badRequest('NOT_PUBLISHABLE', 'Add a question and its answer in at least one language before publishing');
  }
}

async function nextSortOrder() {
  const last = await Faq.findOne().sort({ sortOrder: -1 }).select('sortOrder').lean();
  return (last?.sortOrder ?? 0) + 10;
}

function toDoc(input: FaqInput) {
  return {
    question: input.question,
    answer: input.answer,
    category: input.categoryId,
    status: input.status,
    showOnHomepage: input.showOnHomepage,
    featured: input.featured,
    seoTitle: input.seoTitle,
    seoDescription: input.seoDescription,
  };
}

export async function createFaq(input: FaqInput, userId: string) {
  await assertCategory(input.categoryId);
  assertPublishable(input);
  return Faq.create({
    ...toDoc(input),
    sortOrder: input.sortOrder ?? (await nextSortOrder()),
    publishedAt: input.status === 'published' ? new Date() : undefined,
    createdBy: userId,
    updatedBy: userId,
  });
}

export async function updateFaq(id: string, input: FaqInput, userId: string) {
  await assertCategory(input.categoryId);
  assertPublishable(input);
  const existing = await Faq.findById(id).select('status publishedAt').lean();
  if (!existing) throw notFound('FAQ');
  const set: Record<string, unknown> = { ...toDoc(input), updatedBy: userId };
  if (input.sortOrder !== undefined) set.sortOrder = input.sortOrder;
  if (input.status === 'published' && existing.status !== 'published') set.publishedAt = new Date();
  return Faq.findByIdAndUpdate(id, { $set: set }, { new: true, runValidators: true }).lean();
}

export async function setFaqStatus(id: string, status: 'draft' | 'published', userId: string) {
  const f = await Faq.findById(id).lean();
  if (!f) throw notFound('FAQ');
  assertPublishable({ status, question: f.question, answer: f.answer });
  return Faq.findByIdAndUpdate(id, { $set: { status, updatedBy: userId, ...(status === 'published' && f.status !== 'published' ? { publishedAt: new Date() } : {}) } }, { new: true }).lean();
}

/** Copy as a new draft, placed right after the original, not on the homepage. */
export async function duplicateFaq(id: string, userId: string) {
  const f = await Faq.findById(id).lean();
  if (!f) throw notFound('FAQ');
  await Faq.updateMany({ sortOrder: { $gt: f.sortOrder } }, { $inc: { sortOrder: 1 } });
  return Faq.create({
    question: f.question,
    answer: f.answer,
    category: f.category,
    status: 'draft',
    showOnHomepage: false,
    featured: false,
    sortOrder: f.sortOrder + 1,
    seoTitle: f.seoTitle,
    seoDescription: f.seoDescription,
    createdBy: userId,
    updatedBy: userId,
  });
}

/** Swaps the FAQ with its neighbour in the global display order. */
export async function moveFaq(id: string, direction: 'up' | 'down') {
  const f = await Faq.findById(id).select('sortOrder').lean();
  if (!f) throw notFound('FAQ');
  const neighbour = await Faq.findOne(
    direction === 'up'
      ? { $or: [{ sortOrder: { $lt: f.sortOrder } }, { sortOrder: f.sortOrder, _id: { $lt: f._id } }] }
      : { $or: [{ sortOrder: { $gt: f.sortOrder } }, { sortOrder: f.sortOrder, _id: { $gt: f._id } }] },
  )
    .sort(direction === 'up' ? { sortOrder: -1, _id: -1 } : { sortOrder: 1, _id: 1 })
    .select('sortOrder')
    .lean();
  if (!neighbour) return { moved: false };
  // Equal sort orders (e.g. imported data) would not change anything when swapped: spread them first.
  const a = f.sortOrder;
  const b = neighbour.sortOrder === a ? a + (direction === 'up' ? -1 : 1) : neighbour.sortOrder;
  await Faq.bulkWrite([
    { updateOne: { filter: { _id: f._id }, update: { $set: { sortOrder: Math.max(0, b) } } } },
    { updateOne: { filter: { _id: neighbour._id }, update: { $set: { sortOrder: Math.max(0, a) } } } },
  ]);
  return { moved: true };
}

/** Sets the display order of the given FAQs to the order of the list (10, 20, 30…). */
export async function reorderFaqs(ids: string[]) {
  const found = await Faq.countDocuments({ _id: { $in: ids } });
  if (found !== ids.length) throw badRequest('UNKNOWN_FAQ', 'One or more FAQs no longer exist. Reload and try again.');
  await Faq.bulkWrite(ids.map((id, i) => ({ updateOne: { filter: { _id: id }, update: { $set: { sortOrder: (i + 1) * 10 } } } })));
  return { reordered: ids.length };
}

export async function adminListFaqs(q: { q?: string; category?: string; status?: 'draft' | 'published'; homepage?: '1' | '0'; sort: 'order' | 'updated' | 'question'; page: number; limit: number }) {
  const filter: Record<string, unknown> = {};
  if (q.status) filter.status = q.status;
  if (q.homepage) filter.showOnHomepage = q.homepage === '1';
  if (q.category) filter.category = q.category === 'none' ? null : q.category;
  if (q.q) {
    const rx = new RegExp(escapeRegex(q.q), 'i');
    filter.$or = [{ 'question.en': rx }, { 'question.ar': rx }, { 'answer.en': rx }, { 'answer.ar': rx }];
  }
  const sort: Record<string, 1 | -1> = q.sort === 'updated' ? { updatedAt: -1, _id: 1 } : q.sort === 'question' ? { 'question.en': 1, _id: 1 } : { ...ORDER };
  const [items, total, stats] = await Promise.all([
    Faq.find(filter).sort(sort).skip((q.page - 1) * q.limit).limit(q.limit).populate('category', 'name slug visible').lean(),
    Faq.countDocuments(filter),
    faqStats(),
  ]);
  return { items, total, pages: Math.max(1, Math.ceil(total / q.limit)), stats };
}

export async function faqStats() {
  const [total, published, draft, homepage, categories] = await Promise.all([
    Faq.countDocuments({}),
    Faq.countDocuments({ status: 'published' }),
    Faq.countDocuments({ status: 'draft' }),
    Faq.countDocuments({ status: 'published', showOnHomepage: true }),
    FaqCategory.countDocuments({}),
  ]);
  return { total, published, draft, homepage, categories };
}

// ---- Categories ---------------------------------------------------------------------------

export async function listCategoriesWithCounts() {
  const [cats, counts] = await Promise.all([
    FaqCategory.find().sort(ORDER).limit(200).lean(),
    Faq.aggregate<{ _id: Types.ObjectId | null; total: number; published: number }>([
      { $group: { _id: '$category', total: { $sum: 1 }, published: { $sum: { $cond: [{ $eq: ['$status', 'published'] }, 1, 0] } } } },
    ]),
  ]);
  const by = new Map(counts.map((c) => [String(c._id), c]));
  return {
    categories: cats.map((c) => ({ ...c, faqCount: by.get(String(c._id))?.total ?? 0, publishedCount: by.get(String(c._id))?.published ?? 0 })),
    uncategorised: by.get('null')?.total ?? 0,
  };
}

async function uniqueSlug(base: string, exceptId?: string) {
  const root = (slugify(base) || 'category').slice(0, 70);
  let slug = root;
  for (let i = 2; await FaqCategory.exists({ slug, ...(exceptId ? { _id: { $ne: exceptId } } : {}) }); i++) slug = `${root}-${i}`;
  return slug;
}

type CategoryInput = { name: { ar: string; en: string }; slug?: string; visible: boolean; sortOrder?: number };

export async function createCategory(input: CategoryInput) {
  const last = await FaqCategory.findOne().sort({ sortOrder: -1 }).select('sortOrder').lean();
  if (input.slug && (await FaqCategory.exists({ slug: input.slug }))) throw conflict('DUPLICATE', 'Another category already uses this web address');
  return FaqCategory.create({
    name: input.name,
    slug: input.slug || (await uniqueSlug(input.name.en || input.name.ar)),
    visible: input.visible,
    sortOrder: input.sortOrder ?? (last?.sortOrder ?? 0) + 10,
  });
}

export async function updateCategory(id: string, input: CategoryInput) {
  if (input.slug && (await FaqCategory.exists({ slug: input.slug, _id: { $ne: id } }))) throw conflict('DUPLICATE', 'Another category already uses this web address');
  const set: Record<string, unknown> = { name: input.name, visible: input.visible };
  if (input.slug) set.slug = input.slug;
  if (input.sortOrder !== undefined) set.sortOrder = input.sortOrder;
  const c = await FaqCategory.findByIdAndUpdate(id, { $set: set }, { new: true, runValidators: true }).lean();
  if (!c) throw notFound('Category');
  return c;
}

/**
 * Deletes a category. A category that still holds FAQs is only deleted when the caller says
 * where those FAQs go: another category, or "none" (uncategorised). Nothing is lost silently.
 */
export async function deleteCategory(id: string, reassignTo?: string) {
  const c = await FaqCategory.findById(id).lean();
  if (!c) throw notFound('Category');
  const count = await Faq.countDocuments({ category: c._id });
  if (count > 0) {
    if (!reassignTo) throw conflict('CATEGORY_IN_USE', `This category still has ${count} FAQ(s). Move them to another category first.`, { count });
    if (reassignTo === id) throw badRequest('INVALID_CATEGORY', 'Choose a different category');
    if (reassignTo !== 'none') await assertCategory(reassignTo);
    await Faq.updateMany({ category: c._id }, { $set: { category: reassignTo === 'none' ? null : reassignTo } });
  }
  await FaqCategory.deleteOne({ _id: c._id });
  return { deleted: true, moved: count, name: c.name };
}

export async function reorderCategories(ids: string[]) {
  const found = await FaqCategory.countDocuments({ _id: { $in: ids } });
  if (found !== ids.length) throw badRequest('UNKNOWN_CATEGORY', 'One or more categories no longer exist. Reload and try again.');
  await FaqCategory.bulkWrite(ids.map((id, i) => ({ updateOne: { filter: { _id: id }, update: { $set: { sortOrder: (i + 1) * 10 } } } })));
  return { reordered: ids.length };
}
