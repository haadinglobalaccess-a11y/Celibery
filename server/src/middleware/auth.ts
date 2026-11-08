import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { cookieSameSite, env, isProd, jwtSecret } from '../config/env';
import { forbidden, unauthorized } from '../lib/errors';
import type { Permission } from '../lib/permissions';
import { Role, User } from '../models';

export const SESSION_COOKIE = 'cel_session';

export type AuthUser = {
  id: string;
  type: 'customer' | 'staff';
  name: string;
  email: string;
  roleKey?: string;
  permissions: Set<Permission>;
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

type TokenPayload = { sub: string; tv: number; typ: 'customer' | 'staff' };

export function issueSession(res: Response, user: { _id: unknown; tokenVersion?: number | null; type: string }) {
  const payload: TokenPayload = { sub: String(user._id), tv: user.tokenVersion ?? 0, typ: user.type as TokenPayload['typ'] };
  const ttlHours = user.type === 'staff' ? Math.min(env.SESSION_TTL_HOURS, 12) : env.SESSION_TTL_HOURS;
  const token = jwt.sign(payload, jwtSecret(), { expiresIn: `${ttlHours}h`, algorithm: 'HS256' });
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isProd || env.COOKIE_SECURE || cookieSameSite() === 'none',
    sameSite: cookieSameSite(),
    path: '/',
    maxAge: ttlHours * 3600 * 1000,
  });
}

export function clearSession(res: Response) {
  res.clearCookie(SESSION_COOKIE, { path: '/', httpOnly: true, sameSite: cookieSameSite(), secure: isProd || env.COOKIE_SECURE || cookieSameSite() === 'none' });
}

/** Resolves the session cookie (if any) into req.user. Never throws for anonymous visitors. */
export async function loadUser(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return next();
  try {
    const payload = jwt.verify(token, jwtSecret(), { algorithms: ['HS256'] }) as TokenPayload;
    const user = await User.findById(payload.sub).select('type name email active tokenVersion role').lean();
    if (!user || !user.active || (user.tokenVersion ?? 0) !== payload.tv || user.type !== payload.typ) {
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
    req.user = { id: String(user._id), type: user.type as AuthUser['type'], name: user.name, email: user.email, roleKey, permissions };
    return next();
  } catch {
    clearSession(res);
    return next();
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(unauthorized());
  next();
}

export function requireCustomer(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(unauthorized());
  if (req.user.type !== 'customer') return next(forbidden('Customer account required'));
  next();
}

export function requireStaff(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(unauthorized());
  if (req.user.type !== 'staff') return next(forbidden());
  next();
}

/** Backend-enforced permission check (the admin UI hiding a button is never enough). */
export const requirePermission =
  (...perms: Permission[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(unauthorized());
    if (req.user.type !== 'staff') return next(forbidden());
    for (const p of perms) if (!req.user.permissions.has(p)) return next(forbidden());
    next();
  };

/** Passes when the staff member holds at least one of the permissions. */
export const requireAnyPermission =
  (...perms: Permission[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(unauthorized());
    if (req.user.type !== 'staff') return next(forbidden());
    if (!perms.some((p) => req.user!.permissions.has(p))) return next(forbidden());
    next();
  };
