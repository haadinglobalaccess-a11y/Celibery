import { Schema, model, models, type InferSchemaType, type Model, Types } from 'mongoose';

export const AddressSchema = new Schema(
  {
    label: { type: String, default: '', trim: true, maxlength: 60 },
    fullName: { type: String, required: true, trim: true, maxlength: 120 },
    phone: { type: String, required: true, trim: true, maxlength: 20 },
    city: { type: String, required: true, trim: true, maxlength: 80 },
    district: { type: String, required: true, trim: true, maxlength: 120 },
    street: { type: String, required: true, trim: true, maxlength: 200 },
    buildingNumber: { type: String, default: '', trim: true, maxlength: 10 },
    postalCode: { type: String, default: '', trim: true, maxlength: 10 },
    shortAddress: { type: String, default: '', trim: true, maxlength: 12 },
    notes: { type: String, default: '', trim: true, maxlength: 300 },
    isDefault: { type: Boolean, default: false },
  },
  { _id: true },
);

const UserSchema = new Schema(
  {
    type: { type: String, enum: ['customer', 'staff'], required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 200 },
    phone: { type: String, default: '', trim: true, maxlength: 20 },
    passwordHash: { type: String, select: false },
    role: { type: Schema.Types.ObjectId, ref: 'Role' },
    title: { type: String, default: '', trim: true, maxlength: 120 },
    active: { type: Boolean, default: true },
    tokenVersion: { type: Number, default: 0 },
    resetTokenHash: { type: String, select: false },
    resetTokenExpires: { type: Date, select: false },
    failedLogins: { type: Number, default: 0, select: false },
    lockUntil: { type: Date, select: false },
    lastLoginAt: { type: Date },
    lastLoginIp: { type: String, default: '', select: false },
    // Two-factor authentication (TOTP, RFC 6238) — staff accounts. Secrets are AES-256-GCM
    // encrypted with CREDENTIALS_ENCRYPTION_KEY (lib/secrets.ts); recovery codes are SHA-256 hashed.
    mfaEnabled: { type: Boolean, default: false },
    mfaSecret: { type: String, select: false },
    mfaPendingSecret: { type: String, select: false },
    /** Last accepted TOTP time step: a code can be used once (replay protection). */
    mfaLastStep: { type: Number, default: 0, select: false },
    mfaRecoveryHashes: { type: [String], default: undefined, select: false },
    preferredLang: { type: String, enum: ['ar', 'en'], default: 'ar' },
    addresses: { type: [AddressSchema], default: [] },
    wishlist: { type: [{ type: Schema.Types.ObjectId, ref: 'Product' }], default: [] },
    marketingOptIn: { type: Boolean, default: false },
  },
  { timestamps: true },
);

UserSchema.index({ type: 1, createdAt: -1 });
UserSchema.index({ name: 'text', email: 'text', phone: 'text' }, { default_language: 'none' });

export type UserDoc = InferSchemaType<typeof UserSchema> & { _id: Types.ObjectId };
export const User: Model<UserDoc> = (models.User as Model<UserDoc>) || model<UserDoc>('User', UserSchema);
