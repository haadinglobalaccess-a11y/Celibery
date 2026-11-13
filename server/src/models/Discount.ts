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

/**
 * Per-customer coupon usage, one record per (discount, identity). Identity keys are "c:<customerId>",
 * "e:<email>" and "p:<last 9 phone digits>", so a limit holds across sign-in, guest checkout and
 * re-typed contact details. The unique index plus a conditional increment make the limit hold even
 * when several checkouts arrive at the same moment (finding: parallel checkouts reused a
 * "1 per customer" code). Counts are decremented when an order releases its stock (cancel/expiry).
 */
const DiscountRedemptionSchema = new Schema(
  {
    discount: { type: Schema.Types.ObjectId, ref: 'Discount', required: true },
    key: { type: String, required: true, maxlength: 220 },
    count: { type: Number, required: true, default: 0, min: 0 },
  },
  { timestamps: true },
);
DiscountRedemptionSchema.index({ discount: 1, key: 1 }, { unique: true });

export type DiscountRedemptionDoc = InferSchemaType<typeof DiscountRedemptionSchema> & { _id: Types.ObjectId };
export const DiscountRedemption: Model<DiscountRedemptionDoc> =
  (models.DiscountRedemption as Model<DiscountRedemptionDoc>) || model<DiscountRedemptionDoc>('DiscountRedemption', DiscountRedemptionSchema);
