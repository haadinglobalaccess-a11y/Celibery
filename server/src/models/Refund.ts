import { Schema, model, models, type InferSchemaType, type Model, Types } from 'mongoose';
import { REFUND_STATUSES } from '../modules/payments/refund-state';

/**
 * Refund ledger: one document per refund request, with its full lifecycle
 * (requested → reserved → processing → succeeded | failed | reconciliation_required).
 * See modules/payments/refund-state.ts for the rules.
 */
const RefundHistorySchema = new Schema(
  {
    status: { type: String, required: true },
    note: { type: String, default: '' },
    by: { type: Schema.Types.ObjectId, ref: 'User' },
    at: { type: Date, default: () => new Date() },
  },
  { _id: false },
);

const RefundSchema = new Schema(
  {
    order: { type: Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
    payment: { type: Schema.Types.ObjectId, ref: 'Payment' },
    provider: { type: String, required: true },
    amount: { type: Number, required: true, min: 1 },
    currency: { type: String, default: 'SAR' },
    reason: { type: String, default: '', maxlength: 300 },
    /** Client-supplied key: a repeated submission returns the same refund instead of a second one. */
    idempotencyKey: { type: String, required: true, unique: true },
    status: { type: String, enum: REFUND_STATUSES, default: 'requested', index: true },
    providerRefundId: { type: String, default: '' },
    providerAttemptedAt: { type: Date },
    completedAt: { type: Date },
    lastError: { type: String, default: '' },
    requestedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    /** Created by the migration from Payment.refunds recorded before the ledger existed. */
    legacy: { type: Boolean, default: false },
    history: { type: [RefundHistorySchema], default: [] },
  },
  { timestamps: true },
);
RefundSchema.index({ status: 1, updatedAt: 1 });

export type RefundDoc = InferSchemaType<typeof RefundSchema> & { _id: Types.ObjectId };
export const Refund: Model<RefundDoc> = (models.Refund as Model<RefundDoc>) || model<RefundDoc>('Refund', RefundSchema);
