import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { cookieSameSite, env, isProd, jwtSecret } from '../config/env';
import { AppError, forbidden, unauthorized } from '../lib/errors';
import type { Permission } from '../lib/permissions';
import { securityEvent } from '../lib/security-log';
import { randomToken } from '../lib/tokens';
import { Role, Session, User } from '../models';

export const SESSION_COOKIE = 'cel_session';

export type AuthUser = {
  id: string;
  type: 'customer' | 'staff';
  name: string;
  email: string;
  roleKey?: string;
  permissions: Set<Permission>;
  /** Server-side session id (absent only for sessions issued before server-side sessions existed). */
  sid?: string;
  /** Staff: two-factor authentication is enabled on the account. */
  mfaEnabled?: boolean;
  /** Epoch ms of the last proof of identity in this session (sign-in or step-up re-authentication). */
  authAt?: number;
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

type TokenPayload = { sub: string; tv: number; typ: 'customer' | 'staff'; sid?: string };

const cookieSecure = () => isProd || env.COOKIE_SECURE || cookieSameSite() === 'none';
const ttlHoursFor = (type: string) => (type === 'staff' ? Math.min(env.SESSION_TTL_HOURS, 12) : env.SESSION_TTL_HOURS);

/**
 * Starts a session: a server-side Session record plus a signed, HttpOnly cookie that names it.
 * Called after every successful sign-in, registration, password change and MFA verification —
 * always with a fresh session id (no session fixation).
 */
export async function issueSession(
  res: Response,
  user: { _id: unknown; tokenVersion?: number | null; type: string },
  meta: { req?: Request; mfa?: boolean } = {},
) {
  const ttlHours = ttlHoursFor(user.type);
  const sid = randomToken(32);
  await Session.create({
    _id: sid,
    user: user._id,
    type: user.type,
    mfa: Boolean(meta.mfa),
    ip: String(meta.req?.ip ?? '').slice(0, 64),
    userAgent: String(meta.req?.get('user-agent') ?? '').slice(0, 300),
    expiresAt: new Date(Date.now() + ttlHours * 3600 * 1000),
  });
  const payload: TokenPayload = { sub: String(user._id), tv: user.tokenVersion ?? 0, typ: user.type as TokenPayload['typ'], sid };
  const token = jwt.sign(payload, jwtSecret(), { expiresIn: `${ttlHours}h`, algorithm: 'HS256' });
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: cookieSecure(),
    sameSite: cookieSameSite(),
    path: '/',
    maxAge: ttlHours * 3600 * 1000,
  });
  return sid;
}

export function clearSession(res: Response) {
  res.clearCookie(SESSION_COOKIE, { path: '/', httpOnly: true, sameSite: cookieSameSite(), secure: cookieSecure() });
}

/** Ends one server-side session (sign out). */
export async function revokeSession(sid: string | undefined) {
  if (sid) await Session.updateOne({ _id: sid, revokedAt: { $exists: false } }, { $set: { revokedAt: new Date() } });
}

/** Ends every session of a user (password change/reset, suspension, MFA change). */
export async function revokeAllSessions(userId: unknown, exceptSid?: string) {
  await Session.updateMany({ user: userId, revokedAt: { $exists: false }, ...(exceptSid ? { _id: { $ne: exceptSid } } : {}) }, { $set: { revokedAt: new Date() } });
}

/** Resolves the session cookie (if any) into req.user. Never throws for anonymous visitors. */
export async function loadUser(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token || typeof token !== 'string') return next();
  try {
    const payload = jwt.verify(token, jwtSecret(), { algorithms: ['HS256'] }) as TokenPayload;
    const user = await User.findById(payload.sub).select('type name email active tokenVersion role mfaEnabled').lean();
    if (!user || !user.active || (user.tokenVersion ?? 0) !== payload.tv || user.type !== payload.typ) {
      clearSession(res);
      return next();
    }
    let authAt: number | undefined;
    if (payload.sid) {
      const s = await Session.findOne({ _id: payload.sid, user: user._id }).select('revokedAt expiresAt mfa createdAt reauthAt').lean();
      if (!s || s.revokedAt || s.expiresAt <= new Date()) {
        securityEvent('auth.session_rejected', req, { reason: s ? 'revoked_or_expired' : 'unknown_session', userId: String(user._id) });
        clearSession(res);
        return next();
      }
      // An account that turned on two-factor authentication only accepts sessions that passed it.
      if (user.type === 'staff' && user.mfaEnabled && !s.mfa) {
        clearSession(res);
        return next();
      }
      const signedIn = s.createdAt ? new Date(s.createdAt).getTime() : 0;
      const reauth = s.reauthAt ? new Date(s.reauthAt).getTime() : 0;
      authAt = Math.max(signedIn, reauth) || undefined;
    } else if (user.type === 'staff') {
      // Staff sessions issued before server-side sessions existed cannot be revoked: sign in again.
      clearSession(res);
      return next();
    }
    let permissions = new Set<Permission>();
    let roleKey: string | undefined;
    if (user.type === 'staff' && user.role) {
      const role = await Role.findById(user.role).lean();
      if (role) {
        permissions = new Set(role.permissions as Permission[]);
        roleKey = role.key;
      }
    }
    req.user = {
      id: String(user._id),
      type: user.type as AuthUser['type'],
      name: user.name,
      email: user.email,
      roleKey,
      permissions,
      sid: payload.sid,
      mfaEnabled: Boolean(user.mfaEnabled),
      authAt,
    };
    return next();
  } catch {
    clearSession(res);
    return next();
  }
}

function deny(req: Request, next: NextFunction, reason: string, err: AppError = forbidden()) {
  securityEvent('authz.denied', req, { reason, roleKey: req.user?.roleKey });
  return next(err);
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(unauthorized());
  next();
}

export function requireCustomer(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(unauthorized());
  if (req.user.type !== 'customer') return deny(req, next, 'customer_required', forbidden('Customer account required'));
  next();
}

/** True when the staff member must enrol two-factor authentication before using the admin. */
export const mfaEnrollmentPending = (user: AuthUser | undefined) => Boolean(user && user.type === 'staff' && env.STAFF_MFA_REQUIRED && !user.mfaEnabled);

export function requireStaff(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(unauthorized());
  if (req.user.type !== 'staff') return deny(req, next, 'staff_required');
  if (mfaEnrollmentPending(req.user)) {
    securityEvent('mfa.enrollment_required', req);
    return next(new AppError(403, 'MFA_ENROLLMENT_REQUIRED', 'Set up two-factor authentication to use the admin dashboard'));
  }
  next();
}

/** Backend-enforced permission check (the admin UI hiding a button is never enough). */
export const requirePermission =
  (...perms: Permission[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(unauthorized());
    if (req.user.type !== 'staff') return deny(req, next, 'staff_required');
    for (const p of perms) if (!req.user.permissions.has(p)) return deny(req, next, `missing:${p}`);
    next();
  };

/** Passes when the staff member holds at least one of the permissions. */
export const requireAnyPermission =
  (...perms: Permission[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(unauthorized());
    if (req.user.type !== 'staff') return deny(req, next, 'staff_required');
    if (!perms.some((p) => req.user!.permissions.has(p))) return deny(req, next, `missing_any:${perms.join('|')}`);
    next();
  };

/** How long a sign-in or step-up re-authentication keeps high-impact admin operations unlocked. */
export const REAUTH_WINDOW_MINUTES = 15;

/**
 * Step-up authentication for high-impact operations (payment credentials, staff and roles).
 * A stolen or unattended staff session is not enough: unless the user signed in or re-entered
 * their password (and 2FA code) within the last REAUTH_WINDOW_MINUTES, the request is refused
 * with REAUTH_REQUIRED and the admin asks for the password, then retries.
 */
export function requireRecentAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(unauthorized());
  const fresh = req.user.authAt !== undefined && Date.now() - req.user.authAt <= REAUTH_WINDOW_MINUTES * 60_000;
  if (fresh) return next();
  securityEvent('auth.reauth_required', req, { userId: req.user.id });
  return next(new AppError(403, 'REAUTH_REQUIRED', 'Confirm your password to continue'));
}

/** requireRecentAuth for state-changing requests only; reading stays available. */
export function requireRecentAuthForWrites(req: Request, res: Response, next: NextFunction) {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  return requireRecentAuth(req, res, next);
}
