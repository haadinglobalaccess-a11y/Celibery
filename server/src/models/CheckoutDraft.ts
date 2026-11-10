import { Schema, model, models, type InferSchemaType, type Model, type Types } from 'mongoose';
import { LocalizedSchema } from './common';

/**
 * A checkout the customer started but has not (yet) turned into an order — saved progressively
 * while they type so the store can show it in Admin → Abandoned checkouts and the customer can
 * resume it later.
 *
 * Privacy by design:
 *  - only an allow-list of contact / delivery fields is stored; card numbers, CVV and passwords are
 *    never part of the checkout form (payment happens on the gateway's page) and anything that looks
 *    like a card number is stripped before saving (checkout-draft.service.ts);
 *  - the browser holds a random 256-bit token; only its SHA-256 hash is stored, so a database copy
 *    cannot be used to read or change a draft;
 *  - every draft expires (`expiresAt`, TTL index) after the retention period set in
 *    Admin → Settings → Checkout recovery.
 * A draft never creates an order. When the checkout succeeds it is linked to the order (`converted`).
 */
export const DRAFT_STATUSES = ['in_progress', 'abandoned', 'recovered', 'converted'] as const;
export type DraftStatus = (typeof DRAFT_STATUSES)[number];

/** Fields whose completion makes up "checkout progress" (the same ones the checkout form requires). */
export const DRAFT_PROGRESS_FIELDS = ['name', 'email', 'phone', 'fullName', 'addressPhone', 'city', 'district', 'street', 'paymentMethod'] as const;
export type DraftProgressField = (typeof DRAFT_PROGRESS_FIELDS)[number];

const DraftItemSchema = new Schema(
  {
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    sku: { type: String, default: '' },
    slug: { type: String, default: '' },
    model: { type: String, default: '' },
    name: { type: LocalizedSchema, default: () => ({}) },
    image: { type: String, default: '' },
    /** Server price at the time of the last save (halalas) — never taken from the browser. */
    unitPrice: { type: Number, required: true, min: 0 },
    quantity: { type: Number, required: true, min: 1 },
    lineTotal: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const CheckoutDraftSchema = new Schema(
  {
    /** SHA-256 of the secret token kept by the customer's browser. */
    tokenHash: { type: String, required: true, unique: true },
    /** Signed-in customer, when there is one. Guests are identified by the token only. */
    customer: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    status: { type: String, enum: DRAFT_STATUSES, default: 'in_progress', index: true },
    contact: {
      name: { type: String, default: '' },
      email: { type: String, default: '' },
      phone: { type: String, default: '' },
    },
    shippingAddress: {
      fullName: { type: String, default: '' },
      phone: { type: String, default: '' },
      city: { type: String, default: '' },
      district: { type: String, default: '' },
      street: { type: String, default: '' },
      buildingNumber: { type: String, default: '' },
      postalCode: { type: String, default: '' },
      shortAddress: { type: String, default: '' },
    },
    /** Payment METHOD only (e.g. "card", "cod") — never any payment details. */
    paymentMethod: { type: String, default: '' },
    discountCode: { type: String, default: '' },
    lang: { type: String, enum: ['ar', 'en'], default: 'ar' },
    items: { type: [DraftItemSchema], default: [] },
    currency: { type: String, default: 'SAR' },
    subtotal: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
    /** Which progress fields are complete, and the resulting percentage (0–100). */
    completedFields: { type: [String], default: [] },
    progress: { type: Number, default: 0, min: 0, max: 100 },
    lastActivityAt: { type: Date, default: () => new Date(), index: true },
    /** When the inactivity threshold passed (written by the scheduled job; null while active). */
    abandonedAt: { type: Date },
    /** Number of times the customer came back after the checkout had been abandoned. */
    returnCount: { type: Number, default: 0, min: 0 },
    recoveredAt: { type: Date },
    convertedAt: { type: Date },
    order: { type: Schema.Types.ObjectId, ref: 'Order' },
    orderNumber: { type: String, default: '' },
    /** Retention: MongoDB removes the draft at this time (TTL index below). */
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);

CheckoutDraftSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
CheckoutDraftSchema.index({ status: 1, lastActivityAt: -1 });
CheckoutDraftSchema.index({ order: 1 }, { unique: true, partialFilterExpression: { order: { $type: 'objectId' } } });

export type CheckoutDraftDoc = InferSchemaType<typeof CheckoutDraftSchema> & { _id: Types.ObjectId; createdAt: Date; updatedAt: Date };
export const CheckoutDraft: Model<CheckoutDraftDoc> =
  (models.CheckoutDraft as Model<CheckoutDraftDoc>) || model<CheckoutDraftDoc>('CheckoutDraft', CheckoutDraftSchema);
