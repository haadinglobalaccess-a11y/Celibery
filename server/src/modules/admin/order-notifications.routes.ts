import { Router } from 'express';
import { z } from 'zod';
import { audit } from '../../lib/audit';
import { ah, ok } from '../../lib/http';
import { requirePermission } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import {
  adminPrepareWhatsApp,
  adminSendConfirmationEmail,
  adminWhatsAppConfirmSent,
  adminWhatsAppOpened,
  orderNotificationsView,
  prepareTestWhatsApp,
  sendTestConfirmationEmail,
} from '../../integrations/notifications/order-confirmation';
import { email } from '../auth/auth.schemas';
import { idParam } from './admin.schemas';

/**
 * Order confirmation notifications (email + prepared WhatsApp message).
 *  - per order (Admin → Orders → order): status, send / resend email, prepare / open / confirm WhatsApp
 *  - settings test actions (Admin → Settings → Notifications → Order confirmation)
 * No SMTP or other credentials are ever returned.
 */
export const adminOrderNotificationRoutes = Router();
const lang = z.enum(['ar', 'en']);

adminOrderNotificationRoutes.get(
  '/orders/:id',
  requirePermission('orders:read'),
  validate(idParam, 'params'),
  ah(async (req, res) => ok(res, await orderNotificationsView(req.params.id))),
);

adminOrderNotificationRoutes.post(
  '/orders/:id/email',
  requirePermission('orders:write'),
  validate(idParam, 'params'),
  validate(z.object({ resend: z.boolean().optional() })),
  ah(async (req, res) => {
    const view = await adminSendConfirmationEmail(req.params.id, req.user!.id, { resend: req.body.resend });
    await audit(req, req.body.resend ? 'confirmation_email_resend' : 'confirmation_email_send', 'order', req.params.id, view.email?.status ?? '');
    return ok(res, view);
  }),
);

adminOrderNotificationRoutes.post(
  '/orders/:id/whatsapp/prepare',
  requirePermission('orders:write'),
  validate(idParam, 'params'),
  validate(z.object({ again: z.boolean().optional() })),
  ah(async (req, res) => {
    const view = await adminPrepareWhatsApp(req.params.id, req.user!.id, { again: req.body.again });
    await audit(req, 'whatsapp_prepare', 'order', req.params.id, view.whatsapp?.status ?? '');
    return ok(res, view);
  }),
);

adminOrderNotificationRoutes.post(
  '/orders/:id/whatsapp/opened',
  requirePermission('orders:write'),
  validate(idParam, 'params'),
  ah(async (req, res) => {
    const view = await adminWhatsAppOpened(req.params.id, req.user!.id);
    await audit(req, 'whatsapp_opened', 'order', req.params.id);
    return ok(res, view);
  }),
);

adminOrderNotificationRoutes.post(
  '/orders/:id/whatsapp/confirm-sent',
  requirePermission('orders:write'),
  validate(idParam, 'params'),
  ah(async (req, res) => {
    const view = await adminWhatsAppConfirmSent(req.params.id, req.user!.id);
    await audit(req, 'whatsapp_confirm_sent', 'order', req.params.id);
    return ok(res, view);
  }),
);

adminOrderNotificationRoutes.post(
  '/test-email',
  requirePermission('settings:write'),
  validate(z.object({ to: email, lang })),
  ah(async (req, res) => {
    const r = await sendTestConfirmationEmail(req.body.to, req.body.lang);
    await audit(req, 'confirmation_test_email', 'settings', 'orderNotifications', req.body.to);
    return ok(res, r);
  }),
);

adminOrderNotificationRoutes.post(
  '/test-whatsapp',
  requirePermission('settings:write'),
  validate(z.object({ phone: z.string().trim().min(5).max(24), lang })),
  ah(async (req, res) => ok(res, await prepareTestWhatsApp(req.body.phone, req.body.lang))),
);
