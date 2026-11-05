import { Schema, model, models, type InferSchemaType, type Model, Types } from 'mongoose';
import { LocalizedSchema } from './common';

/**
 * Media library entry. Either an uploaded file (stored in object storage — never in MongoDB)
 * or a reference to an external image/video URL. Uploaded images can carry resized WebP
 * variants (generated in the admin's browser before upload) for responsive delivery.
 */
const VariantSchema = new Schema(
  {
    width: { type: Number, required: true },
    url: { type: String, required: true },
    key: { type: String, default: '' },
    mime: { type: String, default: '' },
    bytes: { type: Number, default: 0 },
  },
  { _id: false },
);

const PartSchema = new Schema(
  {
    role: { type: String, required: true }, // "original" | "w480" | "w960" | "w1600" | "poster"
    key: { type: String, required: true },
    mime: { type: String, required: true },
    declaredBytes: { type: Number, required: true },
    width: { type: Number },
  },
  { _id: false },
);

const MediaAssetSchema = new Schema(
  {
    kind: { type: String, enum: ['image', 'video'], required: true, index: true },
    source: { type: String, enum: ['upload', 'external'], required: true },
    status: { type: String, enum: ['pending', 'ready', 'rejected'], default: 'ready', index: true },
    url: { type: String, required: true },
    /** Storage provider + object key (uploads only). */
    storage: { type: String, default: '' },
    key: { type: String, default: '' },
    mime: { type: String, default: '' },
    bytes: { type: Number, default: 0 },
    width: { type: Number },
    height: { type: Number },
    durationSec: { type: Number },
    variants: { type: [VariantSchema], default: [] },
    /** Poster image (videos). */
    posterUrl: { type: String, default: '' },
    /** Upload parts awaiting verification (pending uploads only). */
    parts: { type: [PartSchema], default: [] },
    /** Detected provider for external videos: file | youtube | vimeo. */
    videoProvider: { type: String, default: '' },
    filename: { type: String, default: '', maxlength: 200 },
    title: { type: String, default: '', maxlength: 200 },
    alt: { type: LocalizedSchema, default: () => ({}) },
    tags: { type: [String], default: [] },
    rejectReason: { type: String, default: '' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);
MediaAssetSchema.index({ createdAt: -1 });
MediaAssetSchema.index({ url: 1 });
MediaAssetSchema.index({ title: 'text', filename: 'text', tags: 'text' }, { default_language: 'none' });

export type MediaAssetDoc = InferSchemaType<typeof MediaAssetSchema> & { _id: Types.ObjectId };
export const MediaAsset: Model<MediaAssetDoc> = (models.MediaAsset as Model<MediaAssetDoc>) || model<MediaAssetDoc>('MediaAsset', MediaAssetSchema);
