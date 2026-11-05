import { Schema, model, models, type InferSchemaType, type Model, Types } from 'mongoose';
import { ImageSchema, LocalizedSchema } from './common';

/**
 * Curated product groups: featured, best sellers (manual fallback), bundles & gift kits,
 * use cases (travel / work / fitness / home), series and campaign collections.
 */
const CollectionSchema = new Schema(
  {
    slug: { type: String, required: true, unique: true, trim: true, lowercase: true },
    kind: { type: String, enum: ['featured', 'best_sellers', 'bundles', 'use_case', 'series', 'campaign', 'custom'], default: 'custom', index: true },
    title: { type: LocalizedSchema, required: true },
    description: { type: LocalizedSchema, default: () => ({}) },
    image: { type: ImageSchema },
    products: { type: [{ type: Schema.Types.ObjectId, ref: 'Product' }], default: [] },
    active: { type: Boolean, default: true },
    showOnHome: { type: Boolean, default: false },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true },
);

export type CollectionDoc = InferSchemaType<typeof CollectionSchema> & { _id: Types.ObjectId };
export const ProductCollection: Model<CollectionDoc> =
  (models.ProductCollection as Model<CollectionDoc>) || model<CollectionDoc>('ProductCollection', CollectionSchema);
