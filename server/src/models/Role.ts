import { Schema, model, models, type InferSchemaType, type Model, Types } from 'mongoose';
import { PERMISSIONS } from '../lib/permissions';
import { LocalizedSchema } from './common';

const RoleSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, trim: true, lowercase: true },
    name: { type: LocalizedSchema, required: true },
    permissions: { type: [{ type: String, enum: PERMISSIONS }], default: [] },
    system: { type: Boolean, default: false },
  },
  { timestamps: true },
);

export type RoleDoc = InferSchemaType<typeof RoleSchema> & { _id: Types.ObjectId };
export const Role: Model<RoleDoc> = (models.Role as Model<RoleDoc>) || model<RoleDoc>('Role', RoleSchema);
