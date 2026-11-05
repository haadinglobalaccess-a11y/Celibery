import bcrypt from 'bcryptjs';
import { env, isTest } from '../../config/env';
import { badRequest, conflict, unauthorized } from '../../lib/errors';
import { randomToken, sha256 } from '../../lib/tokens';
import { sendPasswordResetEmail } from '../../integrations/notifications';
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

export async function authenticate(emailAddr: string, pw: string) {
  const user = await User.findOne({ email: emailAddr }).select('+passwordHash +failedLogins +lockUntil');
  // Same error for unknown email and wrong password (no account enumeration).
  const invalid = unauthorized('Incorrect email or password');
  if (!user || !user.passwordHash) {
    dummyHash ??= await bcrypt.hash('timing-equaliser', BCRYPT_ROUNDS);
    await bcrypt.compare(pw, dummyHash); // keeps response time similar for unknown accounts
    throw invalid;
  }
  if (user.lockUntil && user.lockUntil > new Date()) {
    throw unauthorized('Too many failed attempts. Try again in a few minutes.');
  }
  const okPw = await bcrypt.compare(pw, user.passwordHash);
  if (!okPw) {
    const failed = (user.failedLogins ?? 0) + 1;
    user.failedLogins = failed >= MAX_FAILED ? 0 : failed;
    if (failed >= MAX_FAILED) user.lockUntil = new Date(Date.now() + LOCK_MINUTES * 60_000);
    await user.save();
    throw invalid;
  }
  if (!user.active) throw unauthorized('This account is disabled');
  user.failedLogins = 0;
  user.lockUntil = undefined;
  user.lastLoginAt = new Date();
  await user.save();
  return user;
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
  return user;
}

export async function publicProfile(userId: string) {
  const user = await User.findById(userId).select('type name email phone preferredLang role title addresses marketingOptIn createdAt').lean();
  if (!user) return null;
  let role: { key: string; name: unknown; permissions: string[] } | null = null;
  if (user.type === 'staff' && user.role) {
    const r = await Role.findById(user.role).lean();
    if (r) role = { key: r.key, name: r.name, permissions: r.permissions as string[] };
  }
  return { ...user, role };
}
