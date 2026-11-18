import { Schema, model, models, type InferSchemaType, type Model, Types } from 'mongoose';
import { LocalizedSchema } from './common';

export const HOME_VIDEO_POSITIONS = [1, 2, 3, 4] as const;

/**
 * One video of the homepage video showcase (Admin → Website → Homepage videos).
 *
 * `sourceType` keeps the two kinds strictly apart:
 *  - 'url'    — a reference to a video hosted elsewhere (YouTube, Vimeo, Facebook, a direct file
 *               link). Deleting the entry deletes only this record; the platform is never contacted.
 *  - 'upload' — a file uploaded through the media library (`media` → MediaAsset, stored in object
 *               storage). Its storage object may be removed when the entry is deleted, but only if
 *               nothing else references it.
 *
 * `position` (1–4) is the slot on the homepage; null = kept in the list but not placed. The partial
 * unique index guarantees one video per slot.
 */
const DisplaySchema = new Schema(
  {
    /** How the poster/video fills the slot. */
    fit: { type: String, enum: ['cover', 'contain'], default: 'cover' },
    /** Uploaded/direct files only: muted, looping silent preview while the card is on screen. */
    mutedPreview: { type: Boolean, default: false },
    /** Uploaded/direct files only: loop playback. */
    loop: { type: Boolean, default: false },
    /** Start playback at this second (not supported by Facebook's player). */
    startAt: { type: Number, min: 0, max: 86_400, default: 0 },
  },
  { _id: false },
);

const HomeVideoSchema = new Schema(
  {
    sourceType: { type: String, enum: ['url', 'upload'], required: true },
    provider: { type: String, enum: ['youtube', 'vimeo', 'facebook', 'file'], required: true },
    /** The link as entered (url) or the uploaded file's public URL (upload). */
    url: { type: String, required: true, trim: true, maxlength: 2000 },
    /** Provider video id (YouTube/Vimeo/Facebook). */
    externalId: { type: String, default: '' },
    /** Uploaded file (sourceType 'upload'). */
    media: { type: Schema.Types.ObjectId, ref: 'MediaAsset', default: null },
    title: { type: LocalizedSchema, default: () => ({}) },
    description: { type: LocalizedSchema, default: () => ({}) },
    posterUrl: { type: String, default: '', trim: true, maxlength: 2000 },
    posterMedia: { type: Schema.Types.ObjectId, ref: 'MediaAsset', default: null },
    posterAlt: { type: LocalizedSchema, default: () => ({}) },
    position: { type: Number, min: 1, max: HOME_VIDEO_POSITIONS.length, default: null, validate: { validator: (v: unknown) => v == null || Number.isInteger(v), message: 'Position must be 1–4' } },
    /** Published (shown when placed) vs draft. */
    active: { type: Boolean, default: false },
    archived: { type: Boolean, default: false },
    display: { type: DisplaySchema, default: () => ({}) },
    /** Result of the last availability check (YouTube/Vimeo oEmbed; others cannot be checked server-side). */
    availability: {
      status: { type: String, enum: ['ok', 'unverified', 'unavailable'], default: 'unverified' },
      message: { type: String, default: '' },
      checkedAt: { type: Date },
    },
    durationSec: { type: Number, min: 0 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);
HomeVideoSchema.index({ position: 1 }, { unique: true, partialFilterExpression: { position: { $type: 'number' } } });
HomeVideoSchema.index({ media: 1 });
HomeVideoSchema.index({ archived: 1, updatedAt: -1 });

export type HomeVideoDoc = InferSchemaType<typeof HomeVideoSchema> & { _id: Types.ObjectId };
export const HomeVideo: Model<HomeVideoDoc> = (models.HomeVideo as Model<HomeVideoDoc>) || model<HomeVideoDoc>('HomeVideo', HomeVideoSchema);

/** Section heading and switch (single document, key "home"). */
const HomeVideoSectionSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, default: 'home' },
    enabled: { type: Boolean, default: true },
    eyebrow: { type: LocalizedSchema, default: () => ({}) },
    title: { type: LocalizedSchema, default: () => ({}) },
    subtitle: { type: LocalizedSchema, default: () => ({}) },
  },
  { timestamps: true },
);
export type HomeVideoSectionDoc = InferSchemaType<typeof HomeVideoSectionSchema> & { _id: Types.ObjectId };
export const HomeVideoSection: Model<HomeVideoSectionDoc> =
  (models.HomeVideoSection as Model<HomeVideoSectionDoc>) || model<HomeVideoSectionDoc>('HomeVideoSection', HomeVideoSectionSchema);
