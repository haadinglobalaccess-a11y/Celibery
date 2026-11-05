import { Schema, model, models, type InferSchemaType, type Model, Types } from 'mongoose';

/** Every attempted customer notification, so staff can see what was (or was not) sent. */
const NotificationSchema = new Schema(
  {
    channel: { type: String, enum: ['email', 'whatsapp'], required: true },
    template: { type: String, required: true },
    to: { type: String, required: true },
    order: { type: Schema.Types.ObjectId, ref: 'Order', index: true },
    user: { type: Schema.Types.ObjectId, ref: 'User' },
    status: { type: String, enum: ['sent', 'failed', 'skipped'], required: true },
    detail: { type: String, default: '' },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
NotificationSchema.index({ createdAt: -1 });
export type NotificationDoc = InferSchemaType<typeof NotificationSchema> & { _id: Types.ObjectId };
export const Notification: Model<NotificationDoc> =
  (models.Notification as Model<NotificationDoc>) || model<NotificationDoc>('Notification', NotificationSchema);

const NewsletterSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    lang: { type: String, enum: ['ar', 'en'], default: 'ar' },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);
export type NewsletterDoc = InferSchemaType<typeof NewsletterSchema> & { _id: Types.ObjectId };
export const NewsletterSubscription: Model<NewsletterDoc> =
  (models.NewsletterSubscription as Model<NewsletterDoc>) || model<NewsletterDoc>('NewsletterSubscription', NewsletterSchema);

/** Reviews may only be written by customers with a delivered order for the product (Q19). */
const ReviewSchema = new Schema(
  {
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
    customer: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    order: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    title: { type: String, default: '', maxlength: 120 },
    body: { type: String, default: '', maxlength: 2000 },
    lang: { type: String, enum: ['ar', 'en'], default: 'ar' },
    displayName: { type: String, default: '', maxlength: 60 },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending', index: true },
  },
  { timestamps: true },
);
ReviewSchema.index({ product: 1, customer: 1 }, { unique: true });
export type ReviewDoc = InferSchemaType<typeof ReviewSchema> & { _id: Types.ObjectId };
export const Review: Model<ReviewDoc> = (models.Review as Model<ReviewDoc>) || model<ReviewDoc>('Review', ReviewSchema);

const AuditLogSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User' },
    userName: { type: String, default: '' },
    action: { type: String, required: true },
    entity: { type: String, required: true },
    entityId: { type: String, default: '' },
    summary: { type: String, default: '' },
    ip: { type: String, default: '' },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
AuditLogSchema.index({ createdAt: -1 });
AuditLogSchema.index({ entity: 1, entityId: 1 });
export type AuditLogDoc = InferSchemaType<typeof AuditLogSchema> & { _id: Types.ObjectId };
export const AuditLog: Model<AuditLogDoc> = (models.AuditLog as Model<AuditLogDoc>) || model<AuditLogDoc>('AuditLog', AuditLogSchema);

const CounterSchema = new Schema({ _id: { type: String, required: true }, seq: { type: Number, default: 0 } });
export const Counter = (models.Counter as Model<{ _id: string; seq: number }>) || model<{ _id: string; seq: number }>('Counter', CounterSchema);

export async function nextSequence(name: string): Promise<number> {
  const doc = await Counter.findOneAndUpdate({ _id: name }, { $inc: { seq: 1 } }, { upsert: true, new: true }).lean();
  return doc!.seq;
}
