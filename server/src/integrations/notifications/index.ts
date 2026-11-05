import nodemailer, { type Transporter } from 'nodemailer';
import { env, isProd } from '../../config/env';
import { logger } from '../../lib/logger';
import { Notification, getSettings } from '../../models';
import { orderEmail, passwordResetEmail, staffInviteEmail, whatsappStatusText, type OrderEvent } from './templates';

/**
 * Notification providers are configured through environment variables.
 * When a provider is not configured, the attempt is recorded with status "skipped" —
 * the system never reports a message as sent unless the provider accepted it.
 */

let transporter: Transporter | null = null;
export const emailConfigured = () => Boolean(env.SMTP_HOST);
export const whatsappConfigured = () => Boolean(env.WHATSAPP_ACCESS_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID);

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,
      requireTLS: isProd && env.SMTP_PORT !== 465,
      disableFileAccess: true,
      disableUrlAccess: true,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    });
  }
  return transporter;
}

type Ctx = { template: string; order?: unknown; user?: unknown };

export async function sendEmail(to: string, content: { subject: string; html: string; text: string }, ctx: Ctx) {
  if (!emailConfigured()) {
    await Notification.create({ channel: 'email', to, template: ctx.template, order: ctx.order, user: ctx.user, status: 'skipped', detail: 'SMTP not configured' });
    return { status: 'skipped' as const };
  }
  try {
    await getTransporter().sendMail({ from: env.EMAIL_FROM, to, subject: content.subject, html: content.html, text: content.text });
    await Notification.create({ channel: 'email', to, template: ctx.template, order: ctx.order, user: ctx.user, status: 'sent' });
    return { status: 'sent' as const };
  } catch (err) {
    logger.warn('Email send failed', { template: ctx.template, err: String(err) });
    await Notification.create({ channel: 'email', to, template: ctx.template, order: ctx.order, user: ctx.user, status: 'failed', detail: String(err).slice(0, 300) });
    return { status: 'failed' as const };
  }
}

/** Normalises Saudi numbers to international format without "+" (e.g. 9665XXXXXXXX). */
export function normalizeSaudiPhone(phone: string) {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('966')) return digits;
  if (digits.startsWith('05')) return '966' + digits.slice(1);
  if (digits.startsWith('5') && digits.length === 9) return '966' + digits;
  return digits;
}

/** WhatsApp Business Cloud API — sends an approved template message. */
export async function sendWhatsAppTemplate(phone: string, lang: 'ar' | 'en', params: string[], ctx: Ctx) {
  const to = normalizeSaudiPhone(phone);
  if (!whatsappConfigured()) {
    await Notification.create({ channel: 'whatsapp', to, template: ctx.template, order: ctx.order, status: 'skipped', detail: 'WhatsApp provider not configured' });
    return { status: 'skipped' as const };
  }
  try {
    const res = await fetch(`https://graph.facebook.com/v20.0/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: {
          name: env.WHATSAPP_ORDER_TEMPLATE,
          language: { code: lang === 'ar' ? env.WHATSAPP_TEMPLATE_LANG_AR : env.WHATSAPP_TEMPLATE_LANG_EN },
          components: [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text })) }],
        },
      }),
    });
    if (!res.ok) throw new Error(`WhatsApp API ${res.status}: ${(await res.text()).slice(0, 200)}`);
    await Notification.create({ channel: 'whatsapp', to, template: ctx.template, order: ctx.order, status: 'sent' });
    return { status: 'sent' as const };
  } catch (err) {
    logger.warn('WhatsApp send failed', { err: String(err) });
    await Notification.create({ channel: 'whatsapp', to, template: ctx.template, order: ctx.order, status: 'failed', detail: String(err).slice(0, 300) });
    return { status: 'failed' as const };
  }
}

type NotifiableOrder = {
  _id: unknown;
  orderNumber: string;
  lang?: string | null;
  total: number;
  contact: { name: string; email: string; phone: string };
  delivery?: { trackingNumber?: string | null } | null;
};

/** Sends order updates by email and WhatsApp (Q28). Never throws. */
export async function notifyOrder(order: NotifiableOrder, event: OrderEvent, link: string) {
  try {
    const settings = await getSettings();
    const lang = (order.lang === 'en' ? 'en' : 'ar') as 'ar' | 'en';
    const tasks: Promise<unknown>[] = [];
    if (settings?.notifications?.emailOrderUpdates !== false) {
      const content = orderEmail(lang, event, {
        name: order.contact.name,
        orderNumber: order.orderNumber,
        total: order.total,
        trackingNumber: order.delivery?.trackingNumber ?? undefined,
        link,
      });
      tasks.push(sendEmail(order.contact.email, content, { template: `order.${event}`, order: order._id }));
    }
    if (settings?.notifications?.whatsappOrderUpdates !== false) {
      tasks.push(
        sendWhatsAppTemplate(order.contact.phone, lang, [order.contact.name, whatsappStatusText(lang, event, order.orderNumber), link], {
          template: `order.${event}`,
          order: order._id,
        }),
      );
    }
    await Promise.allSettled(tasks);
  } catch (err) {
    logger.error('notifyOrder failed', { err: String(err) });
  }
}

export async function sendPasswordResetEmail(user: { _id: unknown; name: string; email: string; preferredLang?: string | null }, link: string) {
  const lang = user.preferredLang === 'en' ? 'en' : 'ar';
  return sendEmail(user.email, passwordResetEmail(lang, user.name, link), { template: 'auth.password_reset', user: user._id });
}

export async function sendStaffInviteEmail(user: { _id: unknown; name: string; email: string }, link: string) {
  return sendEmail(user.email, staffInviteEmail('en', user.name, link), { template: 'staff.invite', user: user._id });
}
