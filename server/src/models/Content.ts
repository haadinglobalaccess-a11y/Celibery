import { Schema, model, models, type InferSchemaType, type Model, Types } from 'mongoose';
import { LocalizedSchema } from './common';

/** Homepage / campaign banners managed from Admin → Website content. */
const BannerSchema = new Schema(
  {
    placement: { type: String, enum: ['hero', 'lifestyle', 'promo', 'campaign'], required: true, index: true },
    title: { type: LocalizedSchema, default: () => ({}) },
    subtitle: { type: LocalizedSchema, default: () => ({}) },
    description: { type: LocalizedSchema, default: () => ({}) },
    durationSec: { type: Number, min: Number.MIN_VALUE, default: 5 },
    videoDurationSec: { type: Number, min: 0, default: 0 },
    videoFallbackSec: { type: Number, min: 2, max: 300, default: 20 },
    ctaLabel: { type: LocalizedSchema, default: () => ({}) },
    link: { type: String, default: '' },
    imageUrl: { type: LocalizedSchema, default: () => ({}) },
    mobileImageUrl: { type: LocalizedSchema, default: () => ({}) },
    /** Optional video (uploaded file, direct .mp4/.webm link, YouTube or Vimeo). Takes priority over the image. */
    videoUrl: { type: String, default: '' },
    mobileVideoUrl: { type: String, default: '' },
    /** Poster frame shown while the video loads and to visitors who prefer reduced motion. */
    posterUrl: { type: String, default: '' },
    theme: { type: String, enum: ['dark', 'light'], default: 'dark' },
    active: { type: Boolean, default: true },
    startsAt: { type: Date },
    endsAt: { type: Date },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true },
);
export type BannerDoc = InferSchemaType<typeof BannerSchema> & { _id: Types.ObjectId };
export const Banner: Model<BannerDoc> = (models.Banner as Model<BannerDoc>) || model<BannerDoc>('Banner', BannerSchema);

/** Saudi seasonal campaigns: Ramadan, Eid, National Day, Umrah & travel, gifting… */
const CampaignSchema = new Schema(
  {
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    kind: { type: String, enum: ['ramadan', 'eid', 'national_day', 'umrah_travel', 'gifting', 'seasonal'], default: 'seasonal' },
    title: { type: LocalizedSchema, required: true },
    description: { type: LocalizedSchema, default: () => ({}) },
    heroImageUrl: { type: String, default: '' },
    heroMobileImageUrl: { type: String, default: '' },
    heroVideoUrl: { type: String, default: '' },
    /** Optional accent override while the campaign is live (e.g. green for National Day). */
    accentColor: { type: String, default: '' },
    collection: { type: Schema.Types.ObjectId, ref: 'ProductCollection' },
    discountCode: { type: String, default: '' },
    active: { type: Boolean, default: false },
    showOnHome: { type: Boolean, default: true },
    startsAt: { type: Date },
    endsAt: { type: Date },
  },
  { timestamps: true },
);
export type CampaignDoc = InferSchemaType<typeof CampaignSchema> & { _id: Types.ObjectId };
export const Campaign: Model<CampaignDoc> = (models.Campaign as Model<CampaignDoc>) || model<CampaignDoc>('Campaign', CampaignSchema);

/** Legal / policy pages (Q31: we draft, the client's legal advisor approves). */
const PageSchema = new Schema(
  {
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    title: { type: LocalizedSchema, required: true },
    body: { type: LocalizedSchema, default: () => ({}) },
    status: { type: String, enum: ['draft', 'approved'], default: 'draft' },
    approvedBy: { type: String, default: '' },
    approvedAt: { type: Date },
    /** Incremented on every saved change; previous versions are kept in PageRevision. */
    version: { type: Number, default: 1 },
  },
  { timestamps: true },
);
export type PageDoc = InferSchemaType<typeof PageSchema> & { _id: Types.ObjectId };
export const Page: Model<PageDoc> = (models.Page as Model<PageDoc>) || model<PageDoc>('Page', PageSchema);
