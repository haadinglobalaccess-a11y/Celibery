import { logger } from '../../lib/logger';
import { Notification, getSettings, templateOverride } from '../../models';
import { integration } from '../credentials';
import { activeSmtp, activeWhatsApp, smtpTransport, whatsappMessagesUrl } from './providers';
import { orderEmail, passwordResetEmail, staffInviteEmail, whatsappStatusText, type OrderEvent } from './templates';

/**
 * Email (SMTP) and WhatsApp credentials are managed in Admin → Settings → Notifications
 * (encrypted at rest), with the legacy SMTP_* / WHATSAPP_* environment variables as fallback.
 * When a provider is not configured or is disabled, the attempt is recorded with status
 * "skipped" — the system never reports a message as sent unless the provider accepted it.
 */

/** Synchronous status (the credentials snapshot is refreshed on every API request). */
export const emailConfigured = () => integration('smtp').enabled;
export const whatsappConfigured = () => integration('whatsapp').enabled;

type Ctx = { template: string; order?: unknown; user?: unknown };

export async function sendEmail(to: string, content: { subject: string; html: string; text: string }, ctx: Ctx) {
  const smtp = await activeSmtp();
  if (!smtp) {
    await Notification.create({ channel: 'email', to, template: ctx.template, order: ctx.order, user: ctx.user, status: 'skipped', detail: 'Email (SMTP) not configured or disabled' });
    return { status: 'skipped' as const };
  }
  try {
    await smtpTransport(smtp).sendMail({ from: smtp.from, to, subject: content.subject, html: content.html, text: content.text });
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
  const wa = await activeWhatsApp();
  if (!wa) {
    await Notification.create({ channel: 'whatsapp', to, template: ctx.template, order: ctx.order, status: 'skipped', detail: 'WhatsApp not configured or disabled' });
    return { status: 'skipped' as const };
  }
  try {
    const res = await fetch(whatsappMessagesUrl(wa), {
      method: 'POST',
      headers: { Authorization: `Bearer ${wa.accessToken}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: {
          name: wa.orderTemplate,
          language: { code: lang === 'ar' ? wa.langAr : wa.langEn },
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
export async function notifyOrder(order: NotifiableOrder, event: OrderEvent, link: string, extra: { returnNumber?: string; refundAmount?: string; note?: string } = {}) {
  try {
    const settings = await getSettings();
    const lang = (order.lang === 'en' ? 'en' : 'ar') as 'ar' | 'en';
    const tasks: Promise<unknown>[] = [];
    // Admin-edited wording (Settings → Notifications → Message templates), defaults otherwise.
    const override = await templateOverride(`order.${event}`);
    if (settings?.notifications?.emailOrderUpdates !== false) {
      const content = orderEmail(lang, event, {
        name: order.contact.name,
        orderNumber: order.orderNumber,
        total: order.total,
        trackingNumber: order.delivery?.trackingNumber ?? undefined,
        link,
        ...extra,
      }, override);
      tasks.push(sendEmail(order.contact.email, content, { template: `order.${event}`, order: order._id }));
    }
    if (settings?.notifications?.whatsappOrderUpdates !== false) {
      tasks.push(
        sendWhatsAppTemplate(order.contact.phone, lang, [order.contact.name, whatsappStatusText(lang, event, order.orderNumber, override, { name: order.contact.name, total: order.total, trackingNumber: order.delivery?.trackingNumber ?? undefined, ...extra }), link], {
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
  return sendEmail(user.email, passwordResetEmail(lang, user.name, link, await templateOverride('auth.password_reset')), { template: 'auth.password_reset', user: user._id });
}

export async function sendStaffInviteEmail(user: { _id: unknown; name: string; email: string }, link: string) {
  return sendEmail(user.email, staffInviteEmail('en', user.name, link, await templateOverride('staff.invite')), { template: 'staff.invite', user: user._id });
}
