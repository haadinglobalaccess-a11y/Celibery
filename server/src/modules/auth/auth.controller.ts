import type { Request, Response } from 'express';
import { audit } from '../../lib/audit';
import { ok } from '../../lib/http';
import { maskEmail, securityEvent } from '../../lib/security-log';
import { clearSession, issueSession, revokeSession } from '../../middleware/auth';
import * as svc from './auth.service';

export async function register(req: Request, res: Response) {
  const user = await svc.registerCustomer(req.body);
  await issueSession(res, user, { req });
  return ok(res, await svc.publicProfile(String(user._id)), 201);
}

/** Logs a failed sign-in step and re-throws it (same message to the client as before). */
function failed(req: Request, err: unknown, email?: string): never {
  if (err instanceof svc.LoginError) {
    securityEvent(err.outcome === 'locked' ? 'auth.account_locked' : 'auth.login_failed', req, {
      outcome: err.outcome,
      email: maskEmail(email),
      targetUserId: err.meta.userId,
      accountType: err.meta.type,
    });
    if (err.meta.lockedNow) securityEvent('auth.account_locked', req, { email: maskEmail(email), targetUserId: err.meta.userId, accountType: err.meta.type, justLocked: true });
  }
  throw err;
}

export async function login(req: Request, res: Response) {
  let user;
  try {
    user = await svc.authenticate(req.body.email, req.body.password);
  } catch (err) {
    failed(req, err, req.body.email);
  }
  // Staff with two-factor authentication: no session yet — the client must send a code first.
  if (user.type === 'staff' && user.mfaEnabled) {
    return ok(res, { mfaRequired: true, mfaToken: svc.mfaChallengeToken(user) });
  }
  await svc.recordLoginSuccess(user._id, req.ip ?? '');
  await issueSession(res, user, { req });
  securityEvent('auth.login_success', req, { targetUserId: String(user._id), accountType: user.type, mfa: false });
  return ok(res, await svc.publicProfile(String(user._id)));
}

export async function verifyMfa(req: Request, res: Response) {
  let r;
  try {
    r = await svc.verifyMfaChallenge(req.body.mfaToken, req.body.code);
  } catch (err) {
    if (err instanceof svc.LoginError) securityEvent('mfa.challenge_failed', req, { targetUserId: err.meta.userId, outcome: err.outcome });
    failed(req, err);
  }
  await svc.recordLoginSuccess(r.user._id, req.ip ?? '');
  await issueSession(res, r.user, { req, mfa: true });
  securityEvent('mfa.challenge_passed', req, { targetUserId: String(r.user._id), recoveryCode: r.usedRecoveryCode });
  if (r.usedRecoveryCode) {
    securityEvent('mfa.recovery_code_used', req, { targetUserId: String(r.user._id) });
    req.user = { id: String(r.user._id), type: 'staff', name: r.user.name, email: r.user.email, permissions: new Set() };
    await audit(req, 'mfa_recovery_code_used', 'staff', r.user._id);
  }
  return ok(res, await svc.publicProfile(String(r.user._id)));
}

export async function logout(req: Request, res: Response) {
  await revokeSession(req.user?.sid);
  if (req.user) securityEvent('auth.logout', req);
  clearSession(res);
  return ok(res, { loggedOut: true });
}

export async function me(req: Request, res: Response) {
  if (!req.user) return ok(res, null);
  return ok(res, await svc.publicProfile(req.user.id));
}

export async function forgotPassword(req: Request, res: Response) {
  securityEvent('auth.password_reset_requested', req, { email: maskEmail(req.body.email) });
  await svc.requestPasswordReset(req.body.email);
  return ok(res, { message: 'If an account exists for this email, a reset link has been sent.' });
}

export async function resetPassword(req: Request, res: Response) {
  const user = await svc.resetPassword(req.body.token, req.body.password);
  securityEvent('auth.password_reset', req, { targetUserId: String(user._id), accountType: user.type });
  clearSession(res);
  return ok(res, { reset: true });
}

/** Runs an in-session password/code re-check and records failed attempts as security events. */
async function recheck<T>(req: Request, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof svc.RecheckError) {
      securityEvent('auth.password_check_failed', req, { userId: req.user?.id, path: req.path, reason: err.code, lockedNow: err.lockedNow });
      if (err.lockedNow) securityEvent('auth.account_locked', req, { userId: req.user?.id, via: 'in_session_recheck' });
    }
    throw err;
  }
}

export async function changePassword(req: Request, res: Response) {
  const user = await recheck(req, () => svc.changePassword(req.user!.id, req.body.currentPassword, req.body.newPassword, req.user!.sid));
  // Every other session ended; this browser gets a new one (it keeps the 2FA it already passed).
  await issueSession(res, user, { req, mfa: Boolean(user.mfaEnabled) });
  securityEvent('auth.password_changed', req);
  return ok(res, { changed: true });
}

// ---- Two-factor authentication (staff) ---------------------------------------------------

export async function mfaStatus(req: Request, res: Response) {
  const p = await svc.publicProfile(req.user!.id);
  return ok(res, (p as { mfa?: unknown })?.mfa ?? { enabled: false, required: false });
}

export async function mfaSetup(req: Request, res: Response) {
  return ok(res, await recheck(req, () => svc.startMfaSetup(req.user!.id, req.body.password, req.user!.sid)));
}

/** Step-up re-authentication (password + 2FA code when enabled) for high-impact admin operations. */
export async function reauth(req: Request, res: Response) {
  try {
    const at = await recheck(req, () => svc.stepUp(req.user!.id, req.user!.sid, req.body.password, req.body.code));
    securityEvent('auth.reauth_success', req, { userId: req.user!.id });
    return ok(res, { reauthenticatedAt: at });
  } catch (err) {
    securityEvent('auth.reauth_failed', req, { userId: req.user?.id });
    throw err;
  }
}

export async function mfaEnable(req: Request, res: Response) {
  const { recoveryCodes, user } = await svc.confirmMfaSetup(req.user!.id, req.body.code);
  await issueSession(res, user!, { req, mfa: true });
  securityEvent('mfa.enabled', req);
  await audit(req, 'mfa_enable', 'staff', req.user!.id);
  return ok(res, { enabled: true, recoveryCodes });
}

export async function mfaDisable(req: Request, res: Response) {
  await recheck(req, () => svc.disableMfa(req.user!.id, req.body.password, req.body.code, req.user!.sid));
  securityEvent('mfa.disabled', req);
  await audit(req, 'mfa_disable', 'staff', req.user!.id);
  return ok(res, { enabled: false });
}
