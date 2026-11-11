import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { env, isTest, jwtSecret } from '../../config/env';
import { AppError, badRequest, conflict, unauthorized } from '../../lib/errors';
import { decryptSecret, encryptSecret } from '../../lib/secrets';
import { randomToken, safeEqual, sha256 } from '../../lib/tokens';
import { generateRecoveryCodes, generateTotpSecret, normalizeRecoveryCode, otpauthUri, verifyTotp } from '../../lib/totp';
import { sendPasswordResetEmail } from '../../integrations/notifications';
import { keyRing } from '../../integrations/credentials';
import { revokeAllSessions } from '../../middleware/auth';
import { Role, User } from '../../models';

const BCRYPT_ROUNDS = isTest ? 4 : 12;
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
let dummyHash: string | undefined;

export const hashPassword = (pw: string) => bcrypt.hash(pw, BCRYPT_ROUNDS);

export async function registerCustomer(input: { name: string; email: string; phone?: string; password: string; lang: 'ar' | 'en'; marketingOptIn?: boolean }) {
  const exists = await User.exists({ email: input.email });
  if (exists) throw conflict('EMAIL_IN_USE', 'An account with this email already exists');
  const user = await User.create({
    type: 'customer',
    name: input.name,
    email: input.email,
    phone: input.phone ?? '',
    passwordHash: await hashPassword(input.password),
    preferredLang: input.lang,
    marketingOptIn: input.marketingOptIn ?? false,
  });
  return user;
}

export type LoginOutcome = 'invalid' | 'locked' | 'disabled';
export class LoginError extends AppError {
  constructor(
    public outcome: LoginOutcome,
    message: string,
    public meta: { userId?: string; type?: string; lockedNow?: boolean } = {},
  ) {
    super(401, 'UNAUTHORIZED', message);
  }
}

/** Records one failed password/2FA attempt: 5 failures lock the account for 15 minutes. */
async function recordFailure(user: { _id: unknown; failedLogins?: number | null }) {
  const failed = (user.failedLogins ?? 0) + 1;
  const locked = failed >= MAX_FAILED;
  await User.updateOne(
    { _id: user._id },
    locked ? { $set: { failedLogins: 0, lockUntil: new Date(Date.now() + LOCK_MINUTES * 60_000) } } : { $set: { failedLogins: failed } },
  );
  return locked;
}

export async function authenticate(emailAddr: string, pw: string) {
  const user = await User.findOne({ email: emailAddr }).select('+passwordHash +failedLogins +lockUntil');
  // Same error for unknown email and wrong password (no account enumeration).
  const invalidMsg = 'Incorrect email or password';
  if (!user || !user.passwordHash) {
    dummyHash ??= await bcrypt.hash('timing-equaliser', BCRYPT_ROUNDS);
    await bcrypt.compare(pw, dummyHash); // keeps response time similar for unknown accounts
    throw new LoginError('invalid', invalidMsg);
  }
  if (user.lockUntil && user.lockUntil > new Date()) {
    throw new LoginError('locked', 'Too many failed attempts. Try again in a few minutes.', { userId: String(user._id), type: user.type });
  }
  const okPw = await bcrypt.compare(pw, user.passwordHash);
  if (!okPw) {
    const lockedNow = await recordFailure(user);
    throw new LoginError('invalid', invalidMsg, { userId: String(user._id), type: user.type, lockedNow });
  }
  if (!user.active) throw new LoginError('disabled', 'This account is disabled', { userId: String(user._id), type: user.type });
  return user;
}

/** Marks a completed sign-in (after the password and, for MFA accounts, the second factor). */
export async function recordLoginSuccess(userId: unknown, ip: string) {
  await User.updateOne({ _id: userId }, { $set: { failedLogins: 0, lastLoginAt: new Date(), lastLoginIp: ip.slice(0, 64) }, $unset: { lockUntil: 1 } });
}

/** Creates a single-use reset token (stored hashed) and returns the raw token. */
export async function createResetToken(userId: unknown, ttlMinutes: number) {
  const token = randomToken(32);
  await User.updateOne({ _id: userId }, { $set: { resetTokenHash: sha256(token), resetTokenExpires: new Date(Date.now() + ttlMinutes * 60_000) } });
  return token;
}

export function resetLink(token: string, lang: 'ar' | 'en' = 'ar', staff = false) {
  return staff ? `${env.PUBLIC_SITE_URL}/admin/set-password?token=${token}` : `${env.PUBLIC_SITE_URL}/${lang}/reset-password?token=${token}`;
}

export async function requestPasswordReset(emailAddr: string) {
  const user = await User.findOne({ email: emailAddr, active: true }).select('name email type preferredLang');
  if (!user) return; // respond identically whether or not the account exists
  const token = await createResetToken(user._id, 60);
  await sendPasswordResetEmail(user, resetLink(token, (user.preferredLang as 'ar' | 'en') ?? 'ar', user.type === 'staff'));
}

export async function resetPassword(token: string, newPassword: string) {
  const passwordHash = await hashPassword(newPassword);
  const user = await User.findOneAndUpdate(
    { resetTokenHash: sha256(token), resetTokenExpires: { $gt: new Date() } },
    { $set: { passwordHash, failedLogins: 0 }, $unset: { resetTokenHash: 1, resetTokenExpires: 1, lockUntil: 1 }, $inc: { tokenVersion: 1 } },
    { new: true },
  );
  if (!user) {
    throw badRequest('INVALID_TOKEN', 'This link is invalid or has expired');
  }
  await revokeAllSessions(user._id);
  return user;
}

export async function changePassword(userId: string, current: string, next: string) {
  const user = await User.findById(userId).select('+passwordHash');
  if (!user || !user.passwordHash || !(await bcrypt.compare(current, user.passwordHash))) {
    throw badRequest('WRONG_PASSWORD', 'Current password is incorrect');
  }
  user.passwordHash = await hashPassword(next);
  user.tokenVersion = (user.tokenVersion ?? 0) + 1;
  await user.save();
  await revokeAllSessions(user._id);
  return user;
}

export async function publicProfile(userId: string) {
  const user = await User.findById(userId).select('type name email phone preferredLang role title addresses marketingOptIn createdAt mfaEnabled').lean();
  if (!user) return null;
  let role: { key: string; name: unknown; permissions: string[] } | null = null;
  if (user.type === 'staff' && user.role) {
    const r = await Role.findById(user.role).lean();
    if (r) role = { key: r.key, name: r.name, permissions: r.permissions as string[] };
  }
  const { mfaEnabled, ...rest } = user;
  return { ...rest, role, ...(user.type === 'staff' ? { mfa: { enabled: Boolean(mfaEnabled), required: env.STAFF_MFA_REQUIRED } } : {}) };
}

// ---- Two-factor authentication (staff) ---------------------------------------------------

const MFA_CHALLENGE_MINUTES = 5;
const mfaContext = (userId: unknown) => `user:${String(userId)}:mfa`;

/** Short-lived proof that the password step passed; exchanged for a session with a valid code. */
export function mfaChallengeToken(user: { _id: unknown; tokenVersion?: number | null }) {
  return jwt.sign({ sub: String(user._id), tv: user.tokenVersion ?? 0, typ: 'mfa' }, jwtSecret(), { expiresIn: `${MFA_CHALLENGE_MINUTES}m`, algorithm: 'HS256', audience: 'celibery-mfa' });
}

function mfaRing() {
  const ring = keyRing();
  if (!ring) throw new AppError(503, 'ENCRYPTION_KEY_MISSING', 'Two-factor authentication needs CREDENTIALS_ENCRYPTION_KEY on the server');
  return ring;
}

/** Second step of a staff sign-in. Wrong codes count towards the account lock-out. */
export async function verifyMfaChallenge(token: string, code: string) {
  let payload: { sub: string; tv: number; typ: string };
  try {
    payload = jwt.verify(token, jwtSecret(), { algorithms: ['HS256'], audience: 'celibery-mfa' }) as typeof payload;
  } catch {
    throw new LoginError('invalid', 'Your sign-in expired. Enter your email and password again.');
  }
  if (payload.typ !== 'mfa') throw new LoginError('invalid', 'Your sign-in expired. Enter your email and password again.');
  const user = await User.findById(payload.sub).select('+mfaSecret +mfaLastStep +mfaRecoveryHashes +failedLogins +lockUntil');
  if (!user || !user.active || (user.tokenVersion ?? 0) !== payload.tv || !user.mfaEnabled || !user.mfaSecret) {
    throw new LoginError('invalid', 'Your sign-in expired. Enter your email and password again.');
  }
  if (user.lockUntil && user.lockUntil > new Date()) {
    throw new LoginError('locked', 'Too many failed attempts. Try again in a few minutes.', { userId: String(user._id), type: user.type });
  }
  const secret = decryptSecret(user.mfaSecret, mfaRing(), mfaContext(user._id));
  const step = verifyTotp(secret, code, { afterStep: user.mfaLastStep ?? 0 });
  if (step !== null) {
    // Conditional update: the same code cannot be accepted twice, even by two parallel requests.
    const r = await User.updateOne({ _id: user._id, $or: [{ mfaLastStep: { $lt: step } }, { mfaLastStep: { $exists: false } }] }, { $set: { mfaLastStep: step } });
    if (r.modifiedCount === 1) return { user, usedRecoveryCode: false };
  } else {
    const hash = sha256(normalizeRecoveryCode(code));
    const hashes = user.mfaRecoveryHashes ?? [];
    if (normalizeRecoveryCode(code).length === 12 && hashes.some((h) => safeEqual(h, hash))) {
      const r = await User.updateOne({ _id: user._id, mfaRecoveryHashes: hash }, { $pull: { mfaRecoveryHashes: hash } });
      if (r.modifiedCount === 1) return { user, usedRecoveryCode: true };
    }
  }
  const lockedNow = await recordFailure(user);
  throw new LoginError('invalid', 'The verification code is not valid', { userId: String(user._id), type: user.type, lockedNow });
}

async function checkPassword(userId: string, password: string) {
  const user = await User.findById(userId).select('+passwordHash +mfaSecret +mfaPendingSecret +mfaLastStep +mfaRecoveryHashes');
  if (!user || !user.passwordHash || !(await bcrypt.compare(password, user.passwordHash))) throw badRequest('WRONG_PASSWORD', 'Current password is incorrect');
  return user;
}

/** Starts enrolment: a new secret, stored encrypted as "pending" until a first code confirms it. */
export async function startMfaSetup(userId: string, password: string) {
  const user = await checkPassword(userId, password);
  if (user.type !== 'staff') throw badRequest('NOT_STAFF', 'Two-factor authentication is available for staff accounts');
  if (user.mfaEnabled) throw conflict('MFA_ALREADY_ENABLED', 'Two-factor authentication is already on');
  const secret = generateTotpSecret();
  await User.updateOne({ _id: user._id }, { $set: { mfaPendingSecret: encryptSecret(secret, mfaRing(), mfaContext(user._id)) } });
  return { secret, otpauthUrl: otpauthUri(secret, user.email) };
}

/** Confirms enrolment with a code from the app; returns one-time recovery codes (shown once). */
export async function confirmMfaSetup(userId: string, code: string) {
  const user = await User.findById(userId).select('+mfaPendingSecret');
  if (!user || !user.mfaPendingSecret) throw badRequest('MFA_SETUP_NOT_STARTED', 'Start the set-up again');
  const secret = decryptSecret(user.mfaPendingSecret, mfaRing(), mfaContext(user._id));
  const step = verifyTotp(secret, code);
  if (step === null) throw badRequest('INVALID_CODE', 'The verification code is not valid. Check the time on your phone and try again.');
  const codes = generateRecoveryCodes();
  await User.updateOne(
    { _id: user._id },
    {
      $set: { mfaEnabled: true, mfaSecret: user.mfaPendingSecret, mfaLastStep: step, mfaRecoveryHashes: codes.map((c) => sha256(normalizeRecoveryCode(c))) },
      $unset: { mfaPendingSecret: 1 },
      $inc: { tokenVersion: 1 }, // every other session (without 2FA) ends now
    },
  );
  await revokeAllSessions(user._id);
  return { recoveryCodes: codes, user: await User.findById(user._id) };
}

/** Turns two-factor authentication off (password + a current code). Refused while it is mandatory. */
export async function disableMfa(userId: string, password: string, code: string) {
  if (env.STAFF_MFA_REQUIRED) throw new AppError(403, 'MFA_REQUIRED', 'Two-factor authentication is mandatory for staff accounts');
  const user = await checkPassword(userId, password);
  if (!user.mfaEnabled || !user.mfaSecret) throw badRequest('MFA_NOT_ENABLED', 'Two-factor authentication is not on');
  const secret = decryptSecret(user.mfaSecret, mfaRing(), mfaContext(user._id));
  if (verifyTotp(secret, code, { afterStep: user.mfaLastStep ?? 0 }) === null) throw badRequest('INVALID_CODE', 'The verification code is not valid');
  await User.updateOne({ _id: user._id }, { $set: { mfaEnabled: false }, $unset: { mfaSecret: 1, mfaPendingSecret: 1, mfaRecoveryHashes: 1, mfaLastStep: 1 } });
}

/** Administrator recovery for a staff member who lost their phone: MFA off, every session ends. */
export async function resetMfaForUser(userId: unknown) {
  await User.updateOne(
    { _id: userId, type: 'staff' },
    { $set: { mfaEnabled: false }, $unset: { mfaSecret: 1, mfaPendingSecret: 1, mfaRecoveryHashes: 1, mfaLastStep: 1 }, $inc: { tokenVersion: 1 } },
  );
  await revokeAllSessions(userId);
}
