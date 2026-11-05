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
    /** Selling price in halalas, VAT inclusive. */
    price: { type: Number, required: true, min: 0 },
    /** Optional original price in halalas, shown struck-through when higher than price. */
    compareAtPrice: { type: Number, min: 0 },
    stock: { type: Number, required: true, default: 0, min: 0 },
    lowStockThreshold: { type: Number, min: 0 },
    status: { type: String, enum: ['draft', 'active', 'archived'], default: 'draft', index: true },
    featured: { type: Boolean, default: false },
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
ProductSchema.index({ status: 1, createdAt: -1 });
ProductSchema.index({ 'attributes.capacityMah': 1 });
ProductSchema.index({ 'attributes.powerW': 1 });
ProductSchema.index({ 'attributes.connectors': 1 });
ProductSchema.index({ 'attributes.color.key': 1 });

export type ProductDoc = InferSchemaType<typeof ProductSchema> & { _id: Types.ObjectId };
export const Product: Model<ProductDoc> = (models.Product as Model<ProductDoc>) || model<ProductDoc>('Product', ProductSchema);
