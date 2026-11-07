import { Schema, model, models, type InferSchemaType, type Model, type Types } from 'mongoose';

/**
 * Admin edits of a customer/staff message (integrations/notifications/templates.ts holds the
 * built-in defaults). Only overridden fields are stored; empty = use the default.
 */
const ContentSchema = new Schema(
  {
    subject: { type: String, default: '', maxlength: 200 },
    body: { type: String, default: '', maxlength: 5000 },
    whatsapp: { type: String, default: '', maxlength: 1024 },
  },
  { _id: false },
);

const MessageTemplateSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    ar: { type: ContentSchema, default: () => ({}) },
    en: { type: ContentSchema, default: () => ({}) },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

export type MessageTemplateDoc = InferSchemaType<typeof MessageTemplateSchema> & { _id: Types.ObjectId };
export const MessageTemplate: Model<MessageTemplateDoc> =
  (models.MessageTemplate as Model<MessageTemplateDoc>) || model<MessageTemplateDoc>('MessageTemplate', MessageTemplateSchema);

/** The stored override for a template key (null when the defaults are used). */
export async function templateOverride(key: string) {
  return MessageTemplate.findOne({ key }).select('ar en').lean();
}
