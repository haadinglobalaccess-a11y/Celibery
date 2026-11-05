import { Schema, model, models, type InferSchemaType, type Model, Types } from 'mongoose';

const PaymentSchema = new Schema(
  {
    order: { type: Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
    provider: { type: String, enum: ['sandbox', 'moyasar', 'tabby', 'cod'], required: true },
    method: { type: String, required: true },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'SAR' },
    status: {
      type: String,
      enum: ['initiated', 'pending', 'authorized', 'paid', 'failed', 'cancelled', 'expired', 'refunded', 'partially_refunded'],
      default: 'initiated',
      index: true,
    },
    /** Gateway-side identifier (Moyasar invoice/payment id, Tabby payment id, sandbox id). */
    providerRef: { type: String, index: true },
    redirectUrl: { type: String, default: '' },
    /** Set once when a capture is requested (authorise-then-capture gateways) so it is never sent twice. */
    captureRequestedAt: { type: Date },
    failureReason: { type: String, default: '' },
    refundedAmount: { type: Number, default: 0 },
    refunds: {
      type: [
        new Schema(
          {
            amount: Number,
            providerRefundId: String,
            reason: String,
            by: { type: Schema.Types.ObjectId, ref: 'User' },
            /** Refund ledger entry this line belongs to (exactly-once guard). */
            refund: { type: Schema.Types.ObjectId, ref: 'Refund' },
            at: { type: Date, default: () => new Date() },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    events: {
      type: [new Schema({ type: String, source: String, status: String, at: { type: Date, default: () => new Date() } }, { _id: false })],
      default: [],
    },
  },
  { timestamps: true },
);

PaymentSchema.index({ provider: 1, providerRef: 1 }, { unique: true, partialFilterExpression: { providerRef: { $type: 'string' } } });

export type PaymentDoc = InferSchemaType<typeof PaymentSchema> & { _id: Types.ObjectId };
export const Payment: Model<PaymentDoc> = (models.Payment as Model<PaymentDoc>) || model<PaymentDoc>('Payment', PaymentSchema);

/**
 * Webhook deliveries and their processing state (see modules/payments/webhook-lifecycle.ts).
 * An event is "processed" only after its handler finished, so a failed attempt can be retried
 * by the provider instead of being dropped as a duplicate. Records written before this lifecycle
 * existed have no status and are treated as processed.
 */
const ProcessedEventSchema = new Schema(
  {
    provider: { type: String, required: true },
    eventId: { type: String, required: true },
    status: { type: String, enum: ['processing', 'processed', 'failed', 'ignored'] },
    attempts: { type: Number, default: 0 },
    lockedUntil: { type: Date },
    lastError: { type: String, default: '' },
    result: { type: String, default: '' },
    processedAt: { type: Date },
  },
  { timestamps: true },
);
ProcessedEventSchema.index({ status: 1, updatedAt: -1 });
ProcessedEventSchema.index({ provider: 1, eventId: 1 }, { unique: true });
type ProcessedEventDoc = InferSchemaType<typeof ProcessedEventSchema> & { _id: Types.ObjectId };
export const ProcessedEvent: Model<ProcessedEventDoc> = (models.ProcessedEvent as Model<ProcessedEventDoc>) || model<ProcessedEventDoc>('ProcessedEvent', ProcessedEventSchema);
