import { z } from 'zod';
import { cleanFaqText, faqTextProblem } from '../../lib/faq-content';
import { FAQ_STATUSES } from '../../models/Faq';
import { objectId, text } from '../admin/admin.schemas';

/** Bilingual FAQ text: cleaned, length-limited, HTML refused, links checked (lib/faq-content.ts). */
const faqText = (max: number, rich: boolean) =>
  text(max)
    .transform(cleanFaqText)
    .superRefine((v, ctx) => {
      const problem = faqTextProblem(v, { rich });
      if (problem) ctx.addIssue({ code: 'custom', message: problem });
    });
const loc = (max: number, rich = false) => z.object({ ar: faqText(max, rich).default(''), en: faqText(max, rich).default('') });

export const FAQ_LIMITS = { question: 300, answer: 6000, seoTitle: 120, seoDescription: 300 } as const;

/** A language is complete when both its question and its answer are filled in. */
export const completeLangs = (f: { question: { ar?: string; en?: string }; answer: { ar?: string; en?: string } }) =>
  (['ar', 'en'] as const).filter((l) => Boolean(f.question[l]?.trim() && f.answer[l]?.trim()));

export const faqInput = z
  .object({
    question: loc(FAQ_LIMITS.question),
    answer: loc(FAQ_LIMITS.answer, true),
    categoryId: objectId.nullable().default(null),
    status: z.enum(FAQ_STATUSES).default('draft'),
    showOnHomepage: z.boolean().default(false),
    featured: z.boolean().default(false),
    sortOrder: z.number().int().min(0).max(1_000_000).optional(),
    seoTitle: loc(FAQ_LIMITS.seoTitle).default({ ar: '', en: '' }),
    seoDescription: loc(FAQ_LIMITS.seoDescription).default({ ar: '', en: '' }),
  })
  .superRefine((f, ctx) => {
    if (!f.question.ar && !f.question.en) ctx.addIssue({ code: 'custom', path: ['question'], message: 'Write the question in at least one language' });
    for (const l of ['ar', 'en'] as const) {
      if (f.question[l] && !f.answer[l]) ctx.addIssue({ code: 'custom', path: ['answer', l], message: `The ${l === 'ar' ? 'Arabic' : 'English'} question has no answer` });
      if (f.answer[l] && !f.question[l]) ctx.addIssue({ code: 'custom', path: ['question', l], message: `The ${l === 'ar' ? 'Arabic' : 'English'} answer has no question` });
    }
  });
export type FaqInput = z.infer<typeof faqInput>;

export const faqStatusInput = z.object({ status: z.enum(FAQ_STATUSES) });
export const faqMoveInput = z.object({ direction: z.enum(['up', 'down']) });
export const faqReorderInput = z.object({
  ids: z
    .array(objectId)
    .min(1)
    .max(500)
    .refine((ids) => new Set(ids).size === ids.length, 'Each FAQ may appear only once'),
});

export const faqListQuery = z.object({
  q: z.string().trim().max(100).optional(),
  category: z.union([objectId, z.literal('none')]).optional(),
  status: z.enum(FAQ_STATUSES).optional(),
  homepage: z.enum(['1', '0']).optional(),
  sort: z.enum(['order', 'updated', 'question']).default('order'),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const faqCategoryInput = z
  .object({
    name: z.object({ ar: text(80).default(''), en: text(80).default('') }),
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9-]{2,80}$/, 'Use lowercase letters, numbers and dashes')
      .optional()
      .or(z.literal('')),
    visible: z.boolean().default(true),
    sortOrder: z.number().int().min(0).max(1_000_000).optional(),
  })
  .refine((c) => Boolean(c.name.ar || c.name.en), { message: 'Give the category a name', path: ['name'] });

export const faqCategoryDeleteQuery = z.object({ reassignTo: z.union([objectId, z.literal('none')]).optional() });
export const faqCategoryReorderInput = z.object({ ids: z.array(objectId).min(1).max(200).refine((ids) => new Set(ids).size === ids.length, 'Duplicate category') });

export const faqSettingsInput = z
  .object({
    homepageEnabled: z.boolean(),
    homepageLimit: z.number().int().min(1).max(12),
    showCategoryFilters: z.boolean(),
    title: z.object({ ar: text(120).default(''), en: text(120).default('') }),
    subtitle: z.object({ ar: text(300).default(''), en: text(300).default('') }),
    missingTranslation: z.enum(['hide', 'fallback']),
    allowMultipleOpen: z.boolean(),
  })
  .partial();
