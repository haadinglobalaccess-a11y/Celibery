import type { Request, Response } from 'express';
import { ok } from '../../lib/http';
import { clearSession, issueSession } from '../../middleware/auth';
import * as svc from './auth.service';

export async function register(req: Request, res: Response) {
  const user = await svc.registerCustomer(req.body);
  issueSession(res, user);
  return ok(res, await svc.publicProfile(String(user._id)), 201);
}

export async function login(req: Request, res: Response) {
  const user = await svc.authenticate(req.body.email, req.body.password);
  issueSession(res, user);
  return ok(res, await svc.publicProfile(String(user._id)));
}

export async function logout(_req: Request, res: Response) {
  clearSession(res);
  return ok(res, { loggedOut: true });
}

export async function me(req: Request, res: Response) {
  if (!req.user) return ok(res, null);
  return ok(res, await svc.publicProfile(req.user.id));
}

export async function forgotPassword(req: Request, res: Response) {
  await svc.requestPasswordReset(req.body.email);
  return ok(res, { message: 'If an account exists for this email, a reset link has been sent.' });
}

export async function resetPassword(req: Request, res: Response) {
  await svc.resetPassword(req.body.token, req.body.password);
  clearSession(res);
  return ok(res, { reset: true });
}

export async function changePassword(req: Request, res: Response) {
  const user = await svc.changePassword(req.user!.id, req.body.currentPassword, req.body.newPassword);
  issueSession(res, user);
  return ok(res, { changed: true });
}
