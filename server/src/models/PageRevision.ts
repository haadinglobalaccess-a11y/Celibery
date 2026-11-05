import { Schema, model, models, type InferSchemaType, type Model, Types } from 'mongoose';
import { LocalizedSchema } from './common';

/**
 * Previous versions of legal / policy pages. A snapshot is written before every change, so an
 * approved policy can always be traced and restored.
 */
const PageRevisionSchema = new Schema(
  {
    page: { type: Schema.Types.ObjectId, ref: 'Page', required: true, index: true },
    slug: { type: String, required: true },
    title: { type: LocalizedSchema, required: true },
    body: { type: LocalizedSchema, default: () => ({}) },
    status: { type: String, default: 'draft' },
    approvedBy: { type: String, default: '' },
    approvedAt: { type: Date },
    savedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    savedByName: { type: String, default: '' },
    reason: { type: String, default: '' },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
PageRevisionSchema.index({ page: 1, createdAt: -1 });

export type PageRevisionDoc = InferSchemaType<typeof PageRevisionSchema> & { _id: Types.ObjectId };
export const PageRevision: Model<PageRevisionDoc> = (models.PageRevision as Model<PageRevisionDoc>) || model<PageRevisionDoc>('PageRevision', PageRevisionSchema);
