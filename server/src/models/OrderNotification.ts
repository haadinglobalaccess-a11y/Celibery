import { Schema, model, models, type InferSchemaType, type Model, type Types } from 'mongoose';

/**
 * Delivery state of one customer notification for one order (e.g. the order confirmation email,
 * the prepared WhatsApp confirmation). Exactly one record per (order, channel, kind) — the unique
 * index is the idempotency guarantee: a retried checkout, a webhook replay or a double click can
 * never create a second email for the same order. Every attempt and staff action is appended to
 * `history` (audit trail); the existing Notification collection keeps the global delivery log.
 *
 * Email statuses:    pending → sending → sent | failed (retried with back-off) | skipped
 * WhatsApp statuses: prepared → opened → sent_manual   | skipped
 *   - "prepared": the click-to-chat message and link are ready — NOTHING has been sent.
 *   - "opened":   staff opened WhatsApp with the message — still NOT confirmed as sent.
 *   - "sent_manual": a staff member confirmed they pressed Send (WhatsApp itself does not report it).
 *   - "sent"/"failed" are reserved for a future official WhatsApp Business Platform provider that
 *     returns a real delivery result.
 */
export const NOTIFICATION_CHANNELS = ['email', 'whatsapp'] as const;
export const NOTIFICATION_KINDS = ['order_confirmation'] as const;
export const ORDER_NOTIFICATION_STATUSES = ['pending', 'sending', 'sent', 'failed', 'skipped', 'prepared', 'opened', 'sent_manual'] as const;
export type OrderNotificationStatus = (typeof ORDER_NOTIFICATION_STATUSES)[number];

const HistorySchema = new Schema(
  {
    at: { type: Date, default: () => new Date() },
    action: { type: String, required: true },
    status: { type: String, default: '' },
    detail: { type: String, default: '' },
    by: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { _id: false },
);

const OrderNotificationSchema = new Schema(
  {
    order: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
    orderNumber: { type: String, required: true },
    channel: { type: String, enum: NOTIFICATION_CHANNELS, required: true },
    kind: { type: String, enum: NOTIFICATION_KINDS, required: true },
    /** smtp | click_to_chat (future: whatsapp_cloud). */
    provider: { type: String, default: '' },
    status: { type: String, enum: ORDER_NOTIFICATION_STATUSES, required: true },
    lang: { type: String, enum: ['ar', 'en'], default: 'ar' },
    /** Email address, or WhatsApp number in international digits. */
    to: { type: String, default: '' },
    subject: { type: String, default: '' },
    /** WhatsApp: the prepared message text (plain text, as the customer will read it). */
    message: { type: String, default: '' },
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 5 },
    /** Next automatic email attempt (null = none scheduled). */
    nextAttemptAt: { type: Date, default: null },
    /** A worker holds the record until then ("sending"); an expired lock is retried. */
    lockedUntil: { type: Date, default: null },
    lastError: { type: String, default: '' },
    sentAt: { type: Date, default: null },
    preparedAt: { type: Date, default: null },
    openedAt: { type: Date, default: null },
    confirmedAt: { type: Date, default: null },
    confirmedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    history: { type: [HistorySchema], default: [] },
  },
  { timestamps: true },
);
OrderNotificationSchema.index({ order: 1, channel: 1, kind: 1 }, { unique: true });
OrderNotificationSchema.index({ channel: 1, status: 1, nextAttemptAt: 1 });

export type OrderNotificationDoc = InferSchemaType<typeof OrderNotificationSchema> & { _id: Types.ObjectId };
export const OrderNotification: Model<OrderNotificationDoc> =
  (models.OrderNotification as Model<OrderNotificationDoc>) || model<OrderNotificationDoc>('OrderNotification', OrderNotificationSchema);
