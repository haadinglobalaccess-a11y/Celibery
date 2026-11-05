import { formatSar } from '../../lib/money';

export type OrderEvent = 'order_placed' | 'payment_confirmed' | 'processing' | 'shipped' | 'delivered' | 'cancelled' | 'returned';
type Lang = 'ar' | 'en';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const T = {
  ar: {
    brand: 'سيليبري إنترناشونال',
    hello: (n: string) => `مرحباً ${n}،`,
    order_placed: { s: (o: string) => `تم استلام طلبك ${o}`, b: 'شكراً لتسوقك معنا. استلمنا طلبك وسنبلغك بكل تحديث.' },
    payment_confirmed: { s: (o: string) => `تم تأكيد الدفع للطلب ${o}`, b: 'تم تأكيد الدفع بنجاح وطلبك قيد التجهيز.' },
    processing: { s: (o: string) => `طلبك ${o} قيد التجهيز`, b: 'نقوم الآن بتجهيز طلبك للشحن.' },
    shipped: { s: (o: string) => `تم شحن طلبك ${o}`, b: 'طلبك في الطريق إليك.' },
    delivered: { s: (o: string) => `تم توصيل طلبك ${o}`, b: 'تم توصيل طلبك. نتمنى أن تستمتع بمنتجاتك.' },
    cancelled: { s: (o: string) => `تم إلغاء الطلب ${o}`, b: 'تم إلغاء طلبك. إذا كان لديك أي استفسار تواصل معنا.' },
    returned: { s: (o: string) => `تم تسجيل إرجاع الطلب ${o}`, b: 'تم تسجيل إرجاع طلبك.' },
    total: 'الإجمالي',
    tracking: 'رقم التتبع',
    view: 'عرض الطلب',
    reset: { s: 'إعادة تعيين كلمة المرور', b: 'لإعادة تعيين كلمة المرور اضغط على الرابط التالي. ينتهي الرابط خلال ساعة واحدة. إذا لم تطلب ذلك فتجاهل هذه الرسالة.', cta: 'إعادة تعيين كلمة المرور' },
    invite: { s: 'تفعيل حساب لوحة التحكم', b: 'تمت إضافتك إلى لوحة تحكم سيليبري. اضغط على الرابط لتعيين كلمة المرور. ينتهي الرابط خلال 72 ساعة.', cta: 'تعيين كلمة المرور' },
  },
  en: {
    brand: 'CELIBERY International',
    hello: (n: string) => `Hello ${n},`,
    order_placed: { s: (o: string) => `We received your order ${o}`, b: 'Thank you for shopping with us. We have received your order and will keep you updated.' },
    payment_confirmed: { s: (o: string) => `Payment confirmed for order ${o}`, b: 'Your payment has been confirmed and your order is being prepared.' },
    processing: { s: (o: string) => `Your order ${o} is being prepared`, b: 'We are now preparing your order for shipping.' },
    shipped: { s: (o: string) => `Your order ${o} has shipped`, b: 'Your order is on its way.' },
    delivered: { s: (o: string) => `Your order ${o} was delivered`, b: 'Your order has been delivered. We hope you enjoy your products.' },
    cancelled: { s: (o: string) => `Order ${o} was cancelled`, b: 'Your order has been cancelled. Contact us if you have any questions.' },
    returned: { s: (o: string) => `Return recorded for order ${o}`, b: 'The return of your order has been recorded.' },
    total: 'Total',
    tracking: 'Tracking number',
    view: 'View order',
    reset: { s: 'Reset your password', b: 'Use the link below to reset your password. It expires in one hour. If you did not request this, ignore this email.', cta: 'Reset password' },
    invite: { s: 'Activate your admin account', b: 'You have been added to the CELIBERY admin dashboard. Use the link below to set your password. It expires in 72 hours.', cta: 'Set password' },
  },
} as const;

function layout(lang: Lang, inner: string) {
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  return `<!doctype html><html lang="${lang}" dir="${dir}"><body style="margin:0;background:#f5f5f5;font-family:Arial,Tahoma,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden" dir="${dir}">
<tr><td style="background:#111111;color:#fff;padding:20px 24px;font-size:18px;font-weight:bold;letter-spacing:2px">CELIBERY</td></tr>
<tr><td style="padding:24px;color:#111;font-size:15px;line-height:1.7">${inner}</td></tr>
<tr><td style="padding:16px 24px;color:#777;font-size:12px;border-top:1px solid #eee">${T[lang].brand}</td></tr>
</table></td></tr></table></body></html>`;
}

const button = (href: string, label: string) =>
  `<p><a href="${esc(href)}" style="display:inline-block;background:#111;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none">${esc(label)}</a></p>`;

export function orderEmail(
  lang: Lang,
  event: OrderEvent,
  o: { name: string; orderNumber: string; total: number; trackingNumber?: string; link: string },
) {
  const t = T[lang];
  const e = t[event];
  const subject = e.s(o.orderNumber);
  const tracking = o.trackingNumber ? `<p>${t.tracking}: <strong dir="ltr">${esc(o.trackingNumber)}</strong></p>` : '';
  const html = layout(
    lang,
    `<p>${esc(t.hello(o.name))}</p><p>${e.b}</p><p>${t.total}: <strong dir="ltr">${formatSar(o.total)}</strong></p>${tracking}${button(o.link, t.view)}`,
  );
  const text = `${t.hello(o.name)}\n${e.b}\n${t.total}: ${formatSar(o.total)}\n${o.trackingNumber ? `${t.tracking}: ${o.trackingNumber}\n` : ''}${o.link}`;
  return { subject, html, text };
}

export function passwordResetEmail(lang: Lang, name: string, link: string) {
  const t = T[lang];
  return {
    subject: t.reset.s,
    html: layout(lang, `<p>${esc(t.hello(name))}</p><p>${t.reset.b}</p>${button(link, t.reset.cta)}`),
    text: `${t.hello(name)}\n${t.reset.b}\n${link}`,
  };
}

export function staffInviteEmail(lang: Lang, name: string, link: string) {
  const t = T[lang];
  return {
    subject: t.invite.s,
    html: layout(lang, `<p>${esc(t.hello(name))}</p><p>${t.invite.b}</p>${button(link, t.invite.cta)}`),
    text: `${t.hello(name)}\n${t.invite.b}\n${link}`,
  };
}

/** Short status text used as a WhatsApp template parameter. */
export function whatsappStatusText(lang: Lang, event: OrderEvent, orderNumber: string) {
  return T[lang][event].s(orderNumber);
}
