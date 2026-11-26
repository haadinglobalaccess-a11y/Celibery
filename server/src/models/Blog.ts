import { Schema, model, models, type InferSchemaType, type Model, type Types } from 'mongoose';
import { LocalizedSchema } from './common';

/**
 * Blog / buying guides (SEO, AEO, GEO): articles that answer the questions people ask search engines
 * and AI assistants ("which power bank for Umrah?", "what is a GaN charger?"), in Arabic and English,
 * linked to the products they mention. Body text uses the storefront rich-text format
 * (paragraphs, "### " sub-headings, "- " lists, **bold**).
 */
const BlogPostSchema = new Schema(
  {
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    title: { type: LocalizedSchema, required: true },
    /** One or two sentences: list card, meta description and the answer summary for AI search. */
    excerpt: { type: LocalizedSchema, default: () => ({}) },
    body: { type: LocalizedSchema, default: () => ({}) },
    coverImage: { url: { type: String, default: '' }, alt: { type: LocalizedSchema, default: () => ({}) } },
    tags: { type: [String], default: [] },
    relatedProducts: [{ type: Schema.Types.ObjectId, ref: 'Product' }],
    author: { type: String, default: 'CELIBERY' },
    status: { type: String, enum: ['draft', 'published'], default: 'draft', index: true },
    publishedAt: { type: Date, default: null },
    seo: { title: { type: LocalizedSchema, default: () => ({}) }, description: { type: LocalizedSchema, default: () => ({}) } },
  },
  { timestamps: true },
);
BlogPostSchema.index({ status: 1, publishedAt: -1 });

export type BlogPostDoc = InferSchemaType<typeof BlogPostSchema> & { _id: Types.ObjectId };
export const BlogPost: Model<BlogPostDoc> = (models.BlogPost as Model<BlogPostDoc>) || model<BlogPostDoc>('BlogPost', BlogPostSchema);
