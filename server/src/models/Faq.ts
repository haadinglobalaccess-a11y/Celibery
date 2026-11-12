import { Schema, model, models, type InferSchemaType, type Model, Types } from 'mongoose';
import { LocalizedSchema } from './common';

/**
 * FAQ categories (Admin → Website → FAQ management). Bilingual names; ordered and hideable.
 * No category is built in: the suggested starter list is only offered as a one-click option in
 * the admin, never seeded automatically.
 */
const FaqCategorySchema = new Schema(
  {
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 80 },
    name: { type: LocalizedSchema, required: true },
    visible: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true },
);
FaqCategorySchema.index({ visible: 1, sortOrder: 1 });

export type FaqCategoryDoc = InferSchemaType<typeof FaqCategorySchema> & { _id: Types.ObjectId };
export const FaqCategory: Model<FaqCategoryDoc> = (models.FaqCategory as Model<FaqCategoryDoc>) || model<FaqCategoryDoc>('FaqCategory', FaqCategorySchema);

export const FAQ_STATUSES = ['draft', 'published'] as const;
export type FaqStatus = (typeof FAQ_STATUSES)[number];

/**
 * One question and answer. Arabic and English are independent content written by staff (never
 * machine-translated). Answers use the safe text format described in lib/faq-content.ts.
 */
const FaqSchema = new Schema(
  {
    question: { type: LocalizedSchema, required: true },
    answer: { type: LocalizedSchema, required: true },
    category: { type: Schema.Types.ObjectId, ref: 'FaqCategory', default: null },
    status: { type: String, enum: FAQ_STATUSES, default: 'draft' },
    showOnHomepage: { type: Boolean, default: false },
    featured: { type: Boolean, default: false },
    sortOrder: { type: Number, default: 0 },
    seoTitle: { type: LocalizedSchema, default: () => ({}) },
    seoDescription: { type: LocalizedSchema, default: () => ({}) },
    publishedAt: { type: Date },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);
// Public page: published, in display order (optionally per category).
FaqSchema.index({ status: 1, sortOrder: 1, _id: 1 });
FaqSchema.index({ status: 1, category: 1, sortOrder: 1 });
// Homepage preview: published + homepage, in display order.
FaqSchema.index({ status: 1, showOnHomepage: 1, sortOrder: 1 });
// Admin: "last updated" sort.
FaqSchema.index({ updatedAt: -1 });

export type FaqDoc = InferSchemaType<typeof FaqSchema> & { _id: Types.ObjectId; createdAt: Date; updatedAt: Date };
export const Faq: Model<FaqDoc> = (models.Faq as Model<FaqDoc>) || model<FaqDoc>('Faq', FaqSchema);
