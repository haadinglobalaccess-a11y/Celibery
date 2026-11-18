import { Schema, model, models, type InferSchemaType, type Model, Types } from 'mongoose';

export const RESTOCK_STATUSES = ['active', 'sending', 'notified', 'failed', 'cancelled'] as const;
export type RestockStatus = (typeof RESTOCK_STATUSES)[number];

/**
 * "Notify me when restocked" request for one product (each SKU is its own product — the catalogue
 * has no separate variant records).
 *
 * Lifecycle: active → sending (claimed atomically by one worker) → notified | active (retry later) |
 * failed (gave up). `open` is true while the request still waits for an email; the partial unique
 * index allows one open request per product and email, so repeated sign-ups never duplicate, and a
 * customer can ask again after being notified (the next restock is a new event).
 */
const RestockSubscriptionSchema = new Schema(
  {
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    email: { type: String, required: true, lowercase: true, trim: true, maxlength: 254 },
    user: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    lang: { type: String, enum: ['ar', 'en'], default: 'ar' },
    status: { type: String, enum: RESTOCK_STATUSES, default: 'active' },
    open: { type: Boolean, default: true },
    attempts: { type: Number, default: 0 },
    lastError: { type: String, default: '' },
    /** Earliest time the next delivery attempt may run (backoff after a failure). */
    nextAttemptAt: { type: Date, default: () => new Date() },
    claimedAt: { type: Date },
    notifiedAt: { type: Date },
  },
  { timestamps: true },
);
RestockSubscriptionSchema.index({ product: 1, email: 1 }, { unique: true, partialFilterExpression: { open: true } });
RestockSubscriptionSchema.index({ status: 1, nextAttemptAt: 1 });
RestockSubscriptionSchema.index({ product: 1, createdAt: -1 });

export type RestockSubscriptionDoc = InferSchemaType<typeof RestockSubscriptionSchema> & { _id: Types.ObjectId };
export const RestockSubscription: Model<RestockSubscriptionDoc> =
  (models.RestockSubscription as Model<RestockSubscriptionDoc>) || model<RestockSubscriptionDoc>('RestockSubscription', RestockSubscriptionSchema);
