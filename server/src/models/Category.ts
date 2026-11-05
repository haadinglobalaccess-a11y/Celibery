import { Schema, model, models, type InferSchemaType, type Model, Types } from 'mongoose';
import { ImageSchema, LocalizedSchema } from './common';

/** Filters a category can expose on the storefront (Q18: proposed per category, pending client approval). */
export const FILTER_KEYS = ['price', 'capacityMah', 'powerW', 'connector', 'color', 'availability'] as const;
export type FilterKey = (typeof FILTER_KEYS)[number];

const CategorySchema = new Schema(
  {
    slug: { type: String, required: true, unique: true, trim: true, lowercase: true },
    name: { type: LocalizedSchema, required: true },
    description: { type: LocalizedSchema, default: () => ({}) },
    image: { type: ImageSchema },
    sortOrder: { type: Number, default: 0 },
    active: { type: Boolean, default: true },
    filters: { type: [{ type: String, enum: FILTER_KEYS }], default: ['price', 'color', 'availability'] },
    seo: {
      title: { type: LocalizedSchema, default: () => ({}) },
      description: { type: LocalizedSchema, default: () => ({}) },
    },
  },
  { timestamps: true },
);

CategorySchema.index({ active: 1, sortOrder: 1 });

export type CategoryDoc = InferSchemaType<typeof CategorySchema> & { _id: Types.ObjectId };
export const Category: Model<CategoryDoc> = (models.Category as Model<CategoryDoc>) || model<CategoryDoc>('Category', CategorySchema);
