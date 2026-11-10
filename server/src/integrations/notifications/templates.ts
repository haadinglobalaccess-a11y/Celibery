import { formatSar } from '../../lib/money';

/**
 * Customer and staff messages (email + WhatsApp), editable in Admin → Settings → Notifications.
 *
 * - Each message has built-in Arabic and English defaults (below). Admin edits are stored as
 *   overrides (MessageTemplate) — an empty field falls back to the default, and "Reset" removes the
 *   override, so nothing has to be re-typed after an upgrade.
 * - Content is PLAIN TEXT with {{placeholders}}. Only the placeholders listed for a message are
 *   accepted; both the text and the substituted values are HTML-escaped when the email is built, so
 *   neither staff nor customer data can inject markup.
 * - Structural parts are added by the system and cannot be removed: the order total / tracking
 *   lines and the action button with its link (order page, password reset, invitation).
 * - WhatsApp: the message itself is the template APPROVED BY META (name + language are set in the
 *   WhatsApp integration). The website only supplies its body parameters {{1}} name, {{2}} status
 *   text, {{3}} link. The status text is editable here and must follow Meta's parameter rules.
 */

export const ORDER_EVENTS = ['order_placed', 'payment_confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'returned'] as const;
export const RETURN_EVENTS = ['return_requested', 'return_approved', 'return_rejected', 'return_received', 'return_refunded'] as const;
export type OrderEvent = (typeof ORDER_EVENTS)[number] | (typeof RETURN_EVENTS)[number];
export type Lang = 'ar' | 'en';

export type TemplateContent = { subject: string; body: string; whatsapp: string };
export type TemplateOverride = Partial<Record<Lang, Partial<TemplateContent>>> | null | undefined;

export type TemplateDef = {
  key: string;
  label: string;
  group: 'order' | 'return' | 'account';
  variables: string[];
  /** Sent to customers on WhatsApp too (status text parameter). */
  whatsapp: boolean;
  /**
   * 'param' (default): the WhatsApp text is parameter {{2}} of the Meta-approved template (one line).
   * 'chat': the WhatsApp text is the whole click-to-chat message staff send manually (line breaks allowed).
   */
  whatsappMode?: 'param' | 'chat';
  defaults: Record<Lang, TemplateContent>;
};

const ORDER_VARS = ['name', 'orderNumber', 'total', 'trackingNumber', 'storeName'];
const RETURN_VARS = ['name', 'orderNumber', 'returnNumber', 'refundAmount', 'note', 'storeName'];
const ACCOUNT_VARS = ['name', 'storeName'];
/** Order confirmation (email + prepared WhatsApp message). */
export const CONFIRMATION_VARS = ['customer_name', 'order_number', 'order_date', 'order_total', 'currency', 'payment_method', 'order_status', 'products', 'shipping_address', 'tracking_number', 'store_name'];

const order = (key: string, label: string, ar: [string, string], en: [string, string]): TemplateDef => ({
  key: `order.${key}`,
  label,
  group: 'order',
  variables: ORDER_VARS,
  whatsapp: true,
  defaults: {
    ar: { subject: ar[0], body: `مرحباً {{name}}،\n\n${ar[1]}`, whatsapp: ar[0] },
    en: { subject: en[0], body: `Hello {{name}},\n\n${en[1]}`, whatsapp: en[0] },
  },
});
const ret = (key: string, label: string, ar: [string, string], en: [string, string]): TemplateDef => ({ ...order(key, label, ar, en), group: 'return', variables: RETURN_VARS });

export const TEMPLATES: TemplateDef[] = [
  {
    key: 'order.confirmation',
    label: 'Order confirmation (email + WhatsApp message)',
    group: 'order',
    variables: CONFIRMATION_VARS,
    whatsapp: true,
    whatsappMode: 'chat',
    defaults: {
      ar: {
        subject: 'تأكيد الطلب {{order_number}} — {{store_name}}',
        body: 'مرحباً {{customer_name}}،\n\nشكراً لتسوقك من {{store_name}}! تم تأكيد طلبك رقم {{order_number}}، وتجد تفاصيله أدناه.\n\nسنبلغك فور شحن طلبك.',
        whatsapp: 'مرحباً {{customer_name}}،\n\nشكراً لتسوقك من {{store_name}}!\n\nتم استلام طلبك رقم {{order_number}} بنجاح.\n\nالمنتجات:\n{{products}}\n\nإجمالي الطلب: {{order_total}} {{currency}}\nطريقة الدفع: {{payment_method}}\n\nنقدّر ثقتك في {{store_name}}.',
      },
      en: {
        subject: 'Order confirmation {{order_number}} — {{store_name}}',
        body: 'Hello {{customer_name}},\n\nThank you for shopping with {{store_name}}! Your order {{order_number}} has been confirmed — the details are below.\n\nWe will let you know as soon as it ships.',
        whatsapp: 'Hello {{customer_name}},\n\nThank you for shopping with {{store_name}}!\n\nYour order {{order_number}} has been successfully received.\n\nItems:\n{{products}}\n\nOrder Total: {{order_total}} {{currency}}\nPayment method: {{payment_method}}\n\nWe appreciate your trust in {{store_name}}.',
      },
    },
  },
  order('order_placed', 'Order received', ['تم استلام طلبك {{orderNumber}}', 'شكراً لتسوقك معنا. استلمنا طلبك وسنبلغك بكل تحديث.'], ['We received your order {{orderNumber}}', 'Thank you for shopping with us. We have received your order and will keep you updated.']),
  order('payment_confirmed', 'Payment confirmed', ['تم تأكيد الدفع للطلب {{orderNumber}}', 'تم تأكيد الدفع بنجاح وطلبك قيد التجهيز.'], ['Payment confirmed for order {{orderNumber}}', 'Your payment has been confirmed and your order is being prepared.']),
  order('processing', 'Order being prepared', ['طلبك {{orderNumber}} قيد التجهيز', 'نقوم الآن بتجهيز طلبك للشحن.'], ['Your order {{orderNumber}} is being prepared', 'We are now preparing your order for shipping.']),
  order('shipped', 'Order shipped', ['تم شحن طلبك {{orderNumber}}', 'طلبك في الطريق إليك.'], ['Your order {{orderNumber}} has shipped', 'Your order is on its way.']),
  order('delivered', 'Order delivered', ['تم توصيل طلبك {{orderNumber}}', 'تم توصيل طلبك. نتمنى أن تستمتع بمنتجاتك.'], ['Your order {{orderNumber}} was delivered', 'Your order has been delivered. We hope you enjoy your products.']),
  order('cancelled', 'Order cancelled', ['تم إلغاء الطلب {{orderNumber}}', 'تم إلغاء طلبك. إذا كان لديك أي استفسار تواصل معنا.'], ['Order {{orderNumber}} was cancelled', 'Your order has been cancelled. Contact us if you have any questions.']),
  order('returned', 'Order returned', ['تم تسجيل إرجاع الطلب {{orderNumber}}', 'تم تسجيل إرجاع طلبك.'], ['Return recorded for order {{orderNumber}}', 'The return of your order has been recorded.']),
  ret('return_requested', 'Return requested', ['استلمنا طلب الإرجاع {{returnNumber}}', 'استلمنا طلب إرجاع لمنتجات من الطلب {{orderNumber}}. سنراجعه ونبلغك بالخطوة التالية.'], ['We received return request {{returnNumber}}', 'We received your return request for order {{orderNumber}}. We will review it and let you know the next step.']),
  ret('return_approved', 'Return approved', ['تمت الموافقة على الإرجاع {{returnNumber}}', 'تمت الموافقة على طلب الإرجاع. يرجى إرسال المنتجات وفق تعليمات سياسة الإرجاع.'], ['Return {{returnNumber}} approved', 'Your return has been approved. Please send the items back as described in our returns policy.']),
  ret('return_rejected', 'Return rejected', ['تعذّر قبول طلب الإرجاع {{returnNumber}}', 'تعذّر قبول طلب الإرجاع. السبب: {{note}}'], ['Return {{returnNumber}} could not be accepted', 'We could not accept your return request. Reason: {{note}}']),
  ret('return_received', 'Returned items received', ['استلمنا المنتجات المرتجعة {{returnNumber}}', 'استلمنا المنتجات المرتجعة وسنصدر المبلغ المسترد قريباً.'], ['We received your returned items ({{returnNumber}})', 'We received the returned items and will issue your refund shortly.']),
  ret('return_refunded', 'Return refunded', ['تم رد المبلغ للإرجاع {{returnNumber}}', 'تم رد مبلغ {{refundAmount}} إلى وسيلة الدفع الأصلية.'], ['Refund issued for return {{returnNumber}}', 'A refund of {{refundAmount}} has been issued to your original payment method.']),
  {
    key: 'auth.password_reset',
    label: 'Password reset',
    group: 'account',
    variables: ACCOUNT_VARS,
    whatsapp: false,
    defaults: {
      ar: { subject: 'إعادة تعيين كلمة المرور', body: 'مرحباً {{name}}،\n\nلإعادة تعيين كلمة المرور اضغط على الرابط التالي. ينتهي الرابط خلال ساعة واحدة. إذا لم تطلب ذلك فتجاهل هذه الرسالة.', whatsapp: '' },
      en: { subject: 'Reset your password', body: 'Hello {{name}},\n\nUse the link below to reset your password. It expires in one hour. If you did not request this, ignore this email.', whatsapp: '' },
    },
  },
  {
    key: 'staff.invite',
    label: 'Staff invitation',
    group: 'account',
    variables: ACCOUNT_VARS,
    whatsapp: false,
    defaults: {
      ar: { subject: 'تفعيل حساب لوحة التحكم', body: 'مرحباً {{name}}،\n\nتمت إضافتك إلى لوحة تحكم سيليبري. اضغط على الرابط لتعيين كلمة المرور. ينتهي الرابط خلال 72 ساعة.', whatsapp: '' },
      en: { subject: 'Activate your admin account', body: 'Hello {{name}},\n\nYou have been added to the CELIBERY admin dashboard. Use the link below to set your password. It expires in 72 hours.', whatsapp: '' },
    },
  },
];

export const templateDef = (key: string) => TEMPLATES.find((t) => t.key === key);

/** Fixed (system) wording around the editable text. */
const FIXED = {
  ar: { brand: 'سيليبري إنترناشونال', total: 'الإجمالي', tracking: 'رقم التتبع', view: 'عرض الطلب', reset: 'إعادة تعيين كلمة المرور', invite: 'تعيين كلمة المرور' },
  en: { brand: 'CELIBERY International', total: 'Total', tracking: 'Tracking number', view: 'View order', reset: 'Reset password', invite: 'Set password' },
} as const;

const PLACEHOLDER = /\{\{\s*([A-Za-z_]+)\s*\}\}/g;
export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Problems with a piece of template text (unknown or malformed placeholders). */
export function placeholderErrors(text: string, allowed: string[]): string[] {
  const errors: string[] = [];
  for (const m of text.matchAll(PLACEHOLDER)) if (!allowed.includes(m[1])) errors.push(`Unknown placeholder {{${m[1]}}} — available: ${allowed.map((v) => `{{${v}}}`).join(' ')}`);
  const stripped = text.replace(PLACEHOLDER, '');
  if (/\{\{|\}\}/.test(stripped)) errors.push('A placeholder is not written correctly — use {{name}} form');
  return errors;
}

/** Meta's rules for template body parameters (a violating parameter makes the send fail). */
export function whatsappParamErrors(text: string): string[] {
  const errors: string[] = [];
  if (/[\r\n\t]/.test(text)) errors.push('WhatsApp text cannot contain line breaks or tabs');
  if (/ {5,}/.test(text)) errors.push('WhatsApp text cannot contain more than 4 consecutive spaces');
  if (text.length > 1024) errors.push('WhatsApp text is limited to 1024 characters');
  return errors;
}

/** The whole click-to-chat message (sent by staff from WhatsApp, so line breaks are fine). */
export function whatsappChatErrors(text: string): string[] {
  const errors: string[] = [];
  if (text.length > 1024) errors.push('The WhatsApp message is limited to 1024 characters');
  return errors;
}

/** Validates an override for one template. Returns field → errors. */
export function validateOverride(def: TemplateDef, o: NonNullable<TemplateOverride>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const lang of ['ar', 'en'] as const) {
    const c = o[lang] ?? {};
    const add = (field: string, errs: string[]) => errs.length && (out[`${lang}.${field}`] = errs);
    if (c.subject != null) add('subject', [...placeholderErrors(c.subject, def.variables), ...(/[\r\n]/.test(c.subject) ? ['The subject must be one line'] : []), ...(c.subject.length > 200 ? ['The subject is limited to 200 characters'] : [])]);
    if (c.body != null) add('body', [...placeholderErrors(c.body, def.variables), ...(c.body.length > 5000 ? ['The text is limited to 5000 characters'] : [])]);
    if (c.whatsapp != null && c.whatsapp !== '') {
      if (!def.whatsapp) add('whatsapp', ['This message is not sent on WhatsApp']);
      else add('whatsapp', [...placeholderErrors(c.whatsapp, def.variables), ...(def.whatsappMode === 'chat' ? whatsappChatErrors(c.whatsapp) : whatsappParamErrors(c.whatsapp))]);
    }
  }
  return out;
}

/** Effective content: override fields that are non-empty, defaults otherwise. */
export function resolveContent(def: TemplateDef, lang: Lang, o: TemplateOverride): TemplateContent {
  const d = def.defaults[lang];
  const c = o?.[lang] ?? {};
  const pick = (k: keyof TemplateContent) => (c[k] && c[k]!.trim() ? c[k]! : d[k]);
  return { subject: pick('subject'), body: pick('body'), whatsapp: def.whatsapp ? pick('whatsapp') : '' };
}

/** Substitutes {{placeholders}} (missing values become empty). Plain text in, plain text out. */
export function fill(text: string, vars: Record<string, string | undefined>): string {
  return text.replace(PLACEHOLDER, (_, k: string) => vars[k] ?? '');
}

export function layout(lang: Lang, inner: string) {
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  return `<!doctype html><html lang="${lang}" dir="${dir}"><body style="margin:0;background:#f5f5f5;font-family:Arial,Tahoma,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden" dir="${dir}">
<tr><td style="background:#111111;color:#fff;padding:20px 24px;font-size:18px;font-weight:bold;letter-spacing:2px">CELIBERY</td></tr>
<tr><td style="padding:24px;color:#111;font-size:15px;line-height:1.7">${inner}</td></tr>
<tr><td style="padding:16px 24px;color:#777;font-size:12px;border-top:1px solid #eee">${FIXED[lang].brand}</td></tr>
</table></td></tr></table></body></html>`;
}

export const button = (href: string, label: string) =>
  `<p><a href="${esc(href)}" style="display:inline-block;background:#111;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none">${esc(label)}</a></p>`;

/** Plain text → escaped HTML paragraphs (blank line = new paragraph, single newline = <br>). */
export const paragraphs = (text: string) =>
  text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`)
    .join('');

type Built = { subject: string; html: string; text: string };

/** Builds an email from a template: editable text + fixed summary lines + the action button. */
export function buildEmail(def: TemplateDef, lang: Lang, vars: Record<string, string | undefined>, o: TemplateOverride, extra: { lines?: [string, string][]; cta: { href: string; label: string } }): Built {
  const c = resolveContent(def, lang, o);
  const subject = fill(c.subject, vars).replace(/[\r\n]+/g, ' ').trim();
  const body = fill(c.body, vars);
  const lines = (extra.lines ?? []).filter(([, v]) => v);
  const html = layout(lang, `${paragraphs(body)}${lines.map(([k, v]) => `<p>${esc(k)}: <strong dir="ltr">${esc(v)}</strong></p>`).join('')}${button(extra.cta.href, extra.cta.label)}`);
  const text = `${body.trim()}\n${lines.map(([k, v]) => `${k}: ${v}\n`).join('')}${extra.cta.href}`;
  return { subject, html, text };
}

export type OrderEmailData = { name: string; orderNumber: string; total: number; trackingNumber?: string; link: string; returnNumber?: string; refundAmount?: string; note?: string };

export function orderVars(o: OrderEmailData, storeName: string = FIXED.en.brand): Record<string, string> {
  return { name: o.name, orderNumber: o.orderNumber, total: formatSar(o.total), trackingNumber: o.trackingNumber ?? '', returnNumber: o.returnNumber ?? '', refundAmount: o.refundAmount ?? '', note: o.note ?? '', storeName };
}

export function orderEmail(lang: Lang, event: OrderEvent, o: OrderEmailData, override?: TemplateOverride): Built {
  const def = templateDef(`order.${event}`)!;
  const f = FIXED[lang];
  const isReturn = def.group === 'return';
  return buildEmail(def, lang, orderVars(o, f.brand), override, {
    lines: isReturn ? [] : [[f.total, formatSar(o.total)], [f.tracking, o.trackingNumber ?? '']],
    cta: { href: o.link, label: f.view },
  });
}

export function passwordResetEmail(lang: Lang, name: string, link: string, override?: TemplateOverride): Built {
  return buildEmail(templateDef('auth.password_reset')!, lang, { name, storeName: FIXED[lang].brand }, override, { cta: { href: link, label: FIXED[lang].reset } });
}

export function staffInviteEmail(lang: Lang, name: string, link: string, override?: TemplateOverride): Built {
  return buildEmail(templateDef('staff.invite')!, lang, { name, storeName: FIXED[lang].brand }, override, { cta: { href: link, label: FIXED[lang].invite } });
}

/** Status text sent as WhatsApp template parameter {{2}}; sanitised to Meta's parameter rules. */
export function whatsappStatusText(lang: Lang, event: OrderEvent, orderNumber: string, override?: TemplateOverride, vars: Partial<OrderEmailData> = {}): string {
  const def = templateDef(`order.${event}`)!;
  const text = fill(resolveContent(def, lang, override).whatsapp, { ...orderVars({ name: '', total: 0, link: '', ...vars, orderNumber }, FIXED[lang].brand), total: vars.total != null ? formatSar(vars.total) : '' });
  return text.replace(/[\r\n\t]+/g, ' ').replace(/ {5,}/g, '    ').slice(0, 1024).trim();
}

/** Sample values for admin previews. */
export const SAMPLE_VARS: Record<string, string> = {
  name: 'Fahad',
  orderNumber: 'CEL-1042',
  total: formatSar(29800),
  trackingNumber: 'IM123456789',
  returnNumber: 'RET-00007',
  refundAmount: formatSar(14900),
  note: 'The item shows signs of use.',
  storeName: FIXED.en.brand,
};
