import { Schema, model, models, type InferSchemaType, type Model, Types } from 'mongoose';
import { ImageSchema, LocalizedSchema } from './common';

export const CONNECTORS = ['usb-c', 'usb-a', 'lightning', 'micro-usb', 'magsafe', 'wireless', 'aux-3.5mm', 'bluetooth', 'car-12v', 'other'] as const;

const SpecSchema = new Schema(
  {
    label: { type: LocalizedSchema, required: true },
    value: { type: LocalizedSchema, required: true },
  },
  { _id: false },
);

const ColorSchema = new Schema(
  {
    key: { type: String, required: true, trim: true, lowercase: true },
    name: { type: LocalizedSchema, required: true },
    hex: { type: String, default: '', trim: true },
  },
  { _id: false },
);

/**
 * A product video shown in the product-page gallery next to the photos (Admin → Products → Videos).
 * `url` is a YouTube / Vimeo / Facebook link, an ImageKit / Cloudinary link or a direct .mp4/.webm
 * file (uploaded through the media library or linked); see lib/showcase-video.ts.
 */
const ProductVideoSchema = new Schema(
  {
    url: { type: String, required: true, trim: true, maxlength: 2000 },
    /** Uploaded file (media library), when the video was uploaded rather than linked. */
    mediaId: { type: Schema.Types.ObjectId, ref: 'MediaAsset' },
    /** Still shown in the thumbnail strip and before playback; providers' own poster is used when empty. */
    posterUrl: { type: String, default: '', trim: true, maxlength: 2000 },
    title: { type: LocalizedSchema, default: () => ({}) },
  },
  { _id: false },
);

const BundleItemSchema = new Schema(
  {
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    quantity: { type: Number, default: 1, min: 1 },
  },
  { _id: false },
);

const ProductSchema = new Schema(
  {
    slug: { type: String, required: true, unique: true, trim: true, lowercase: true },
    sku: { type: String, required: true, unique: true, trim: true, uppercase: true },
    model: { type: String, default: '', trim: true },
    name: { type: LocalizedSchema, required: true },
    shortDescription: { type: LocalizedSchema, default: () => ({}) },
    description: { type: LocalizedSchema, default: () => ({}) },
    category: { type: Schema.Types.ObjectId, ref: 'Category', required: true, index: true },
    series: { type: String, default: '', trim: true },
    images: { type: [ImageSchema], default: [] },
    /** Packaging photos (box, contents, labels) shown after the product photos in the gallery. */
    packagingImages: { type: [ImageSchema], default: [] },
    /** Product videos in the gallery; `videoPlacement` puts them right after the main photo or after all photos. */
    videos: { type: [ProductVideoSchema], default: [] },
    videoPlacement: { type: String, enum: ['after_main', 'after_photos'], default: 'after_main' },
    /** Selling price in halalas, VAT inclusive. */
    price: { type: Number, required: true, min: 0 },
    /** Optional original price in halalas, shown struck-through when higher than price. */
    compareAtPrice: { type: Number, min: 0 },
    stock: { type: Number, required: true, default: 0, min: 0 },
    lowStockThreshold: { type: Number, min: 0 },
    status: { type: String, enum: ['draft', 'active', 'archived'], default: 'draft', index: true },
    featured: { type: Boolean, default: false },
    /** Homepage Flagship section — chosen in Admin independently of `featured`. Records without it read as false. */
    flagship: { type: Boolean, default: false },
    /** Position in the Flagship section (lowest first); separate from sortOrder, which orders Featured and category lists. */
    flagshipOrder: { type: Number, default: 0, min: 0 },
    /** Filterable attributes (Q18). */
    attributes: {
      capacityMah: { type: Number, min: 0 },
      powerW: { type: Number, min: 0 },
      connectors: { type: [{ type: String, enum: CONNECTORS }], default: [] },
      color: { type: ColorSchema },
    },
    specs: { type: [SpecSchema], default: [] },
    tags: { type: [String], default: [] },
    /** Months; null/undefined → store default from Settings (2-year warranty confirmed in Q32). */
    warrantyMonths: { type: Number, min: 0 },
    isBundle: { type: Boolean, default: false },
    bundleItems: { type: [BundleItemSchema], default: [] },
    /** Optional sale window (scheduled bundles): outside it the listing cannot be bought. */
    availableFrom: { type: Date },
    availableUntil: { type: Date },
    related: { type: [{ type: Schema.Types.ObjectId, ref: 'Product' }], default: [] },
    sortOrder: { type: Number, default: 0 },
    /**
     * Provenance of the record. `demo` products come from the development seed and are
     * flagged on the storefront; `client` products come from CELIBERY's own data.
     */
    dataSource: { type: String, enum: ['client', 'demo'], default: 'client', index: true },
    seo: {
      title: { type: LocalizedSchema, default: () => ({}) },
      description: { type: LocalizedSchema, default: () => ({}) },
    },
  },
  { timestamps: true },
);

ProductSchema.index({ status: 1, category: 1, sortOrder: 1 });
ProductSchema.index({ status: 1, price: 1 });
ProductSchema.index({ status: 1, flagship: 1, flagshipOrder: 1 });
ProductSchema.index({ status: 1, createdAt: -1 });
// Default storefront sort ("featured") and the homepage Featured section: index-ordered, no in-memory
// sort of the whole active catalogue (DATABASE_PERFORMANCE_REPORT.md).
ProductSchema.index({ status: 1, featured: -1, sortOrder: 1, createdAt: -1, _id: 1 });
ProductSchema.index({ status: 1, category: 1, featured: -1, sortOrder: 1, createdAt: -1, _id: 1 });
ProductSchema.index({ 'attributes.capacityMah': 1 });
ProductSchema.index({ 'attributes.powerW': 1 });
ProductSchema.index({ 'attributes.connectors': 1 });
ProductSchema.index({ 'attributes.color.key': 1 });

export type ProductDoc = InferSchemaType<typeof ProductSchema> & { _id: Types.ObjectId };
export const Product: Model<ProductDoc> = (models.Product as Model<ProductDoc>) || model<ProductDoc>('Product', ProductSchema);
