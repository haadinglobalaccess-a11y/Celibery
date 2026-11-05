import { Schema, model, models, type Model, type InferSchemaType, type Types } from 'mongoose';

/**
 * Credentials for one external integration (Moyasar, Tabby, I Mile…), managed from the admin
 * dashboard. Test and live credentials are kept separately; `activeMode` decides which set
 * the platform uses. Secret values are AES-256-GCM ciphertexts (lib/secrets.ts) and are
 * excluded from every query unless explicitly selected (`select: false`).
 */
const VerificationSchema = new Schema(
  {
    status: { type: String, enum: ['unverified', 'ok', 'failed', 'unsupported'], default: 'unverified' },
    message: { type: String, default: '', maxlength: 300 },
    checkedAt: { type: Date },
    /** Fingerprint of the secret that was verified — a later key change invalidates the result. */
    fingerprint: { type: String, default: '' },
  },
  { _id: false },
);

const SecretMetaSchema = new Schema(
  {
    masked: { type: String, default: '' },
    fingerprint: { type: String, default: '' },
    updatedAt: { type: Date },
  },
  { _id: false },
);

const ModeSchema = new Schema(
  {
    /** Non-secret values (publishable key, merchant code…). */
    values: { type: Map, of: String, default: () => new Map() },
    /** Encrypted secret values. Never selected by default. */
    secrets: { type: Map, of: String, default: () => new Map(), select: false },
    /** Masked preview + fingerprint of each stored secret, safe to show in the admin. */
    secretMeta: { type: Map, of: SecretMetaSchema, default: () => new Map() },
    verification: { type: VerificationSchema, default: () => ({}) },
  },
  { _id: false },
);

const IntegrationCredentialSchema = new Schema(
  {
    provider: { type: String, required: true, unique: true },
    enabled: { type: Boolean, default: false },
    activeMode: { type: String, enum: ['test', 'live'], default: 'test' },
    modes: {
      test: { type: ModeSchema, default: () => ({}) },
      live: { type: ModeSchema, default: () => ({}) },
    },
    liveConfirmedBy: { type: String, default: '' },
    liveConfirmedAt: { type: Date },
    updatedBy: { type: String, default: '' },
  },
  { timestamps: true },
);

export type IntegrationCredentialDoc = InferSchemaType<typeof IntegrationCredentialSchema> & { _id: Types.ObjectId };
export const IntegrationCredential: Model<IntegrationCredentialDoc> =
  (models.IntegrationCredential as Model<IntegrationCredentialDoc>) || model<IntegrationCredentialDoc>('IntegrationCredential', IntegrationCredentialSchema);

/** Fields to add to a query when the decrypted secrets are needed (server-side only). */
export const WITH_SECRETS = '+modes.test.secrets +modes.live.secrets';
