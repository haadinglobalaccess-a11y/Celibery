import { Schema, model, models, type InferSchemaType, type Model, Types } from 'mongoose';
import { LocalizedSchema } from './common';

const DiscountSchema = new Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true, maxlength: 40 },
    description: { type: LocalizedSchema, default: () => ({}) },
    type: { type: String, enum: ['percent', 'fixed'], required: true },
    /** percent: 1–100; fixed: halalas */
    value: { type: Number, required: true, min: 0 },
    /** Cap for percentage discounts, in halalas (optional). */
    maxDiscount: { type: Number, min: 0 },
    minOrderTotal: { type: Number, default: 0, min: 0 },
    startsAt: { type: Date },
    endsAt: { type: Date },
    usageLimit: { type: Number, min: 0 },
    usedCount: { type: Number, default: 0, min: 0 },
    perCustomerLimit: { type: Number, min: 0 },
    /** Eligibility: when non-empty, the discount applies only to these categories/products. */
    categories: { type: [{ type: Schema.Types.ObjectId, ref: 'Category' }], default: [] },
    products: { type: [{ type: Schema.Types.ObjectId, ref: 'Product' }], default: [] },
    active: { type: Boolean, default: true },
    campaign: { type: Schema.Types.ObjectId, ref: 'Campaign' },
  },
  { timestamps: true },
);

export type DiscountDoc = InferSchemaType<typeof DiscountSchema> & { _id: Types.ObjectId };
export const Discount: Model<DiscountDoc> = (models.Discount as Model<DiscountDoc>) || model<DiscountDoc>('Discount', DiscountSchema);
