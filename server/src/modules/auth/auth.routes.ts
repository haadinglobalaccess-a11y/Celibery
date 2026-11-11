import { Router, type NextFunction, type Request, type Response } from 'express';
import { forbidden, unauthorized } from '../../lib/errors';
import { ah } from '../../lib/http';
import { requireAuth } from '../../middleware/auth';
import { authLimiter, loginAccountLimiter, mfaLimiter, resetEmailLimiter } from '../../middleware/security';
import { validate } from '../../middleware/validate';
import * as c from './auth.controller';
import { changePasswordSchema, forgotSchema, loginSchema, mfaCodeSchema, mfaDisableSchema, mfaPasswordSchema, mfaVerifySchema, registerSchema, resetSchema } from './auth.schemas';

export const authRoutes = Router();

/** Staff session (also while two-factor enrolment is still pending — that is what these routes are for). */
function staffSession(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(unauthorized());
  if (req.user.type !== 'staff') return next(forbidden());
  next();
}

authRoutes.post('/register', authLimiter, validate(registerSchema), ah(c.register));
authRoutes.post('/login', authLimiter, validate(loginSchema), loginAccountLimiter, ah(c.login));
authRoutes.post('/mfa/verify', mfaLimiter, validate(mfaVerifySchema), ah(c.verifyMfa));
authRoutes.post('/logout', ah(c.logout));
authRoutes.get('/me', ah(c.me));
authRoutes.post('/forgot-password', authLimiter, validate(forgotSchema), resetEmailLimiter, ah(c.forgotPassword));
authRoutes.post('/reset-password', authLimiter, validate(resetSchema), ah(c.resetPassword));
authRoutes.post('/change-password', requireAuth, authLimiter, validate(changePasswordSchema), ah(c.changePassword));

authRoutes.get('/mfa', staffSession, ah(c.mfaStatus));
authRoutes.post('/mfa/setup', staffSession, authLimiter, validate(mfaPasswordSchema), ah(c.mfaSetup));
authRoutes.post('/mfa/enable', staffSession, mfaLimiter, validate(mfaCodeSchema), ah(c.mfaEnable));
authRoutes.post('/mfa/disable', staffSession, authLimiter, validate(mfaDisableSchema), ah(c.mfaDisable));
