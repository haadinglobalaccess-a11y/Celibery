import { Router } from 'express';
import { ah } from '../../lib/http';
import { requireAuth } from '../../middleware/auth';
import { authLimiter } from '../../middleware/security';
import { validate } from '../../middleware/validate';
import * as c from './auth.controller';
import { changePasswordSchema, forgotSchema, loginSchema, registerSchema, resetSchema } from './auth.schemas';

export const authRoutes = Router();

authRoutes.post('/register', authLimiter, validate(registerSchema), ah(c.register));
authRoutes.post('/login', authLimiter, validate(loginSchema), ah(c.login));
authRoutes.post('/logout', ah(c.logout));
authRoutes.get('/me', ah(c.me));
authRoutes.post('/forgot-password', authLimiter, validate(forgotSchema), ah(c.forgotPassword));
authRoutes.post('/reset-password', authLimiter, validate(resetSchema), ah(c.resetPassword));
authRoutes.post('/change-password', requireAuth, authLimiter, validate(changePasswordSchema), ah(c.changePassword));
