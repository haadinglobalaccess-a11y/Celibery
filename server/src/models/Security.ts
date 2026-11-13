import { Schema, model, models, type InferSchemaType, type Model } from 'mongoose';

/**
 * Server-side session record. The session cookie (a signed JWT) carries the session id (`sid`);
 * a session is valid only while this record exists and is not revoked, so signing out really
 * ends the session (a copied cookie stops working) instead of waiting for the JWT to expire.
 * Records delete themselves when they expire (TTL index).
 */
const SessionSchema = new Schema(
  {
    _id: { type: String, required: true }, // random, 32 bytes base64url
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, enum: ['customer', 'staff'], required: true },
    /** Session completed two-factor verification (staff with MFA enabled). */
    mfa: { type: Boolean, default: false },
    ip: { type: String, default: '', maxlength: 64 },
    userAgent: { type: String, default: '', maxlength: 300 },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date },
    /**
     * Last time the user re-proved their identity inside this session (password, plus a 2FA code
     * when enabled). Sign-in time (createdAt) also counts. Used by requireRecentAuth for step-up
     * authentication on high-impact admin operations. Optional: older sessions simply lack it.
     */
    reauthAt: { type: Date },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
SessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type SessionDoc = InferSchemaType<typeof SessionSchema> & { _id: string };
export const Session: Model<SessionDoc> = (models.Session as Model<SessionDoc>) || model<SessionDoc>('Session', SessionSchema);

/**
 * Shared rate-limit counter (fixed window), used by every application instance — serverless
 * functions and multiple Railway replicas count against the same limit. Expired windows are
 * removed by the TTL index.
 */
const RateLimitSchema = new Schema(
  {
    _id: { type: String, required: true }, // "<limiter>:<client key>"
    hits: { type: Number, default: 0 },
    resetAt: { type: Date, required: true },
  },
  { versionKey: false },
);
RateLimitSchema.index({ resetAt: 1 }, { expireAfterSeconds: 60 });

export type RateLimitDoc = InferSchemaType<typeof RateLimitSchema> & { _id: string };
export const RateLimitCounter: Model<RateLimitDoc> =
  (models.RateLimitCounter as Model<RateLimitDoc>) || model<RateLimitDoc>('RateLimitCounter', RateLimitSchema, 'rate_limits');

