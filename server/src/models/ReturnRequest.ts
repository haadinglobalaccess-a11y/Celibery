import { Schema, model, models, type InferSchemaType, type Model, type Types } from 'mongoose';
import { LocalizedSchema } from './common';

/**
 * Customer return requests (Saudi E-Commerce Law return right). One request covers one or more
 * units of one order and follows:
 *
 *   requested → approved → received → refunded
 *       │           │
 *       ├→ rejected └→ cancelled
 *       └→ cancelled
 *
 * The refund itself goes through the refund ledger (refund.service), so gateway refunds,
 * idempotency and reconciliation work exactly as for refunds issued from an order.
 */
export const RETURN_STATUSES = ['requested', 'approved', 'rejected', 'received', 'refunded', 'cancelled'] as const;
export type ReturnStatus = (typeof RETURN_STATUSES)[number];

export const RETURN_TRANSITIONS: Record<ReturnStatus, ReturnStatus[]> = {
  requested: ['approved', 'rejected', 'cancelled'],
  approved: ['received', 'cancelled'],
  received: ['refunded'],
  rejected: [],
  refunded: [],
  cancelled: [],
};

/** Statuses whose units still count against what can be returned (rejected/cancelled ones free them). */
export const RETURN_ACTIVE_STATUSES: ReturnStatus[] = ['requested', 'approved', 'received', 'refunded'];

export const RETURN_REASONS = ['defective', 'wrong_item', 'not_as_described', 'damaged_in_delivery', 'changed_mind', 'other'] as const;
export type ReturnReason = (typeof RETURN_REASONS)[number];

const ReturnItemSchema = new Schema(
  {
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    sku: { type: String, required: true },
    name: { type: LocalizedSchema, required: true },
    image: { type: String, default: '' },
    quantity: { type: Number, required: true, min: 1 },
    /** What the customer paid for these units (after their share of the order discount), halalas. */
    amount: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const ReturnHistorySchema = new Schema(
  {
    status: { type: String, required: true },
    note: { type: String, default: '' },
    by: { type: Schema.Types.ObjectId, ref: 'User' },
    byCustomer: { type: Boolean, default: false },
    visibleToCustomer: { type: Boolean, default: true },
    at: { type: Date, default: () => new Date() },
  },
  { _id: false },
);

const ReturnRequestSchema = new Schema(
  {
    returnNumber: { type: String, required: true, unique: true },
    order: { type: Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
    orderNumber: { type: String, required: true, index: true },
    customer: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    contact: { name: { type: String, default: '' }, email: { type: String, default: '' }, phone: { type: String, default: '' } },
    lang: { type: String, enum: ['ar', 'en'], default: 'ar' },
    items: { type: [ReturnItemSchema], required: true },
    reason: { type: String, enum: RETURN_REASONS, required: true },
    details: { type: String, default: '', maxlength: 1000 },
    status: { type: String, enum: RETURN_STATUSES, default: 'requested', index: true },
    /** Sum of item amounts — the refund proposed to staff (they may refund less, never more than the order allows). */
    requestedAmount: { type: Number, required: true, min: 0 },
    restocked: { type: Boolean, default: false },
    refund: {
      id: { type: Schema.Types.ObjectId, ref: 'Refund' },
      amount: { type: Number, min: 0 },
      status: { type: String, default: '' },
      at: { type: Date },
    },
    /** Message to the customer when rejecting (also kept in the history). */
    decisionNote: { type: String, default: '', maxlength: 500 },
    internalNotes: { type: String, default: '', maxlength: 2000 },
    history: { type: [ReturnHistorySchema], default: [] },
  },
  { timestamps: true },
);
ReturnRequestSchema.index({ status: 1, createdAt: -1 });

export type ReturnRequestDoc = InferSchemaType<typeof ReturnRequestSchema> & { _id: Types.ObjectId; createdAt: Date; updatedAt: Date };
export const ReturnRequest: Model<ReturnRequestDoc> =
  (models.ReturnRequest as Model<ReturnRequestDoc>) || model<ReturnRequestDoc>('ReturnRequest', ReturnRequestSchema);
