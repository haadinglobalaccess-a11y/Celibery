import { Schema } from 'mongoose';

/** Bilingual text. Arabic and English content are independent, never auto-translated. */
export const LocalizedSchema = new Schema(
  {
    ar: { type: String, default: '', trim: true },
    en: { type: String, default: '', trim: true },
  },
  { _id: false },
);

export type Localized = { ar: string; en: string };

/** Responsive copy of an uploaded image (WebP, generated before upload). */
export const ImageVariantSchema = new Schema(
  {
    width: { type: Number, required: true },
    url: { type: String, required: true, trim: true },
  },
  { _id: false },
);

/**
 * An image used by a product / category / collection. `url` is always present, so records
 * created before the media library (plain URLs) keep working unchanged. Uploaded images also
 * reference their media-library entry and carry responsive variants.
 */
export const ImageSchema = new Schema(
  {
    url: { type: String, required: true, trim: true },
    alt: { type: LocalizedSchema, default: () => ({}) },
    mediaId: { type: Schema.Types.ObjectId, ref: 'MediaAsset' },
    variants: { type: [ImageVariantSchema], default: undefined },
    width: { type: Number },
    height: { type: Number },
  },
  { _id: false },
);
