import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '../i18n/I18n';
import { formatDate, L } from '../lib/format';
import type { OrderView } from '../lib/types';
import { Icon } from './Icon';
import '../styles/tracking.css';

/**
 * Order tracking at a glance (track page and account order page): where the order is now in one
 * sentence, a dated progress bar, the estimated delivery, the courier shipment with a copyable
 * tracking number and a link to the courier, and where to get help. Built only from the order record.
 */
const STEPS = ['placed', 'confirmed', 'processing', 'shipped', 'delivered'] as const;
const RANK: Record<string, number> = { pending: 0, confirmed: 1, processing: 2, shipped: 3, delivered: 4 };

const COPY = {
  en: {
    step: { placed: 'Order placed', confirmed: 'Confirmed', processing: 'Preparing', shipped: 'Shipped', delivered: 'Delivered' },
    head: {
      pending: ['Awaiting payment', 'Your order is reserved and waiting for payment to be completed.'],
      confirmed: ['Order confirmed', 'We have received your order and will start preparing it shortly.'],
      processing: ['Preparing your order', 'Your items are being picked and packed.'],
      shipped: ['On its way', 'Your order has left our warehouse and is with the courier.'],
      delivered: ['Delivered', 'Your order has been delivered. Enjoy!'],
      cancelled: ['Order cancelled', 'This order has been cancelled.'],
      returned: ['Order returned', 'This order has been returned.'],
    } as Record<string, [string, string]>,
    eta: 'Estimated delivery',
    deliveredOn: 'Delivered on',
    shipment: 'Shipment',
    courier: 'Courier',
    trackingNo: 'Tracking number',
    copy: 'Copy',
    copied: 'Copied',
    trackCourier: 'Track with the courier',
    shippedOn: 'Shipped on',
    awaitingShipment: 'Your tracking number will appear here as soon as the order ships.',
    help: 'Need help with this order?',
    contact: 'Contact support',
    progress: 'Order progress',
  },
  ar: {
    step: { placed: 'تم الطلب', confirmed: 'تم التأكيد', processing: 'قيد التجهيز', shipped: 'تم الشحن', delivered: 'تم التوصيل' },
    head: {
      pending: ['بانتظار الدفع', 'طلبك محجوز وبانتظار إتمام الدفع.'],
      confirmed: ['تم تأكيد الطلب', 'استلمنا طلبك وسنبدأ تجهيزه قريباً.'],
      processing: ['جارٍ تجهيز طلبك', 'يتم الآن تجهيز منتجاتك وتغليفها.'],
      shipped: ['طلبك في الطريق', 'غادر طلبك المستودع وهو الآن لدى شركة الشحن.'],
      delivered: ['تم التوصيل', 'تم توصيل طلبك. نتمنى أن ينال إعجابك!'],
      cancelled: ['تم إلغاء الطلب', 'تم إلغاء هذا الطلب.'],
      returned: ['تم إرجاع الطلب', 'تم إرجاع هذا الطلب.'],
    } as Record<string, [string, string]>,
    eta: 'موعد التوصيل المتوقع',
    deliveredOn: 'تم التوصيل في',
    shipment: 'الشحنة',
    courier: 'شركة الشحن',
    trackingNo: 'رقم التتبع',
    copy: 'نسخ',
    copied: 'تم النسخ',
    trackCourier: 'تتبع لدى شركة الشحن',
    shippedOn: 'تاريخ الشحن',
    awaitingShipment: 'سيظهر رقم التتبع هنا فور شحن الطلب.',
    help: 'هل تحتاج مساعدة بخصوص هذا الطلب؟',
    contact: 'تواصل مع الدعم',
    progress: 'مراحل الطلب',
  },
};

export function TrackingPanel({ order }: { order: OrderView }) {
  const { lang, p } = useI18n();
  const c = COPY[lang];
  const [copied, setCopied] = useState(false);
  const stopped = order.status === 'cancelled' || order.status === 'returned';
  const rank = RANK[order.status] ?? 0;
  const [title, sentence] = c.head[order.status] ?? [order.status, ''];
  const d = order.delivery ?? {};
  const eta = L(d.estimatedDelivery, lang);

  // The date each step was reached: the order date for "placed", otherwise the first matching history entry.
  const reachedAt = (s: (typeof STEPS)[number]) => {
    if (s === 'placed') return order.createdAt;
    const h = order.history?.find((x) => x.status === s);
    if (h) return h.at;
    if (s === 'shipped') return d.shippedAt;
    if (s === 'delivered') return d.deliveredAt;
    return undefined;
  };
  const done = (i: number) => !stopped && (i === 0 || rank >= i);
  const current = stopped ? -1 : order.status === 'pending' ? 0 : rank;

  const copy = async () => {
    if (!d.trackingNumber) return;
    try {
      await navigator.clipboard.writeText(d.trackingNumber);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked: the number stays visible to copy by hand */
    }
  };

  return (
    <section className={`trk trk--${order.status}`} data-testid="tracking-panel" aria-labelledby="trk-title">
      <div className="trk__head">
        <h2 id="trk-title" className="trk__title" data-testid="tracking-headline">
          {title}
        </h2>
        {sentence ? <p className="trk__sub">{sentence}</p> : null}
        {order.status === 'delivered' && reachedAt('delivered') ? (
          <p className="trk__eta">
            <Icon name="check" /> {c.deliveredOn} {formatDate(reachedAt('delivered'), lang)}
          </p>
        ) : !stopped && eta ? (
          <p className="trk__eta" data-testid="tracking-eta">
            <Icon name="truck" /> {c.eta}: <strong>{eta}</strong>
          </p>
        ) : null}
      </div>

      {!stopped ? (
        <ol className="trk__steps" aria-label={c.progress}>
          {STEPS.map((s, i) => {
            const at = reachedAt(s);
            const isDone = done(i);
            return (
              <li key={s} className={`trk__step ${isDone ? 'is-done' : ''} ${i === current ? 'is-current' : ''}`} aria-current={i === current ? 'step' : undefined}>
                <span className="trk__dot" aria-hidden="true">
                  {isDone ? <Icon name="check" /> : null}
                </span>
                <span className="trk__label">{c.step[s]}</span>
                {isDone && at ? <span className="trk__date">{formatDate(at, lang)}</span> : null}
              </li>
            );
          })}
        </ol>
      ) : null}

      {d.trackingNumber ? (
        <div className="trk__ship" data-testid="tracking-shipment">
          <div className="trk__ship-icon" aria-hidden="true">
            <Icon name="box" />
          </div>
          <dl className="trk__ship-info">
            {d.courier ? (
              <div>
                <dt>{c.courier}</dt>
                <dd>{d.courier}</dd>
              </div>
            ) : null}
            <div>
              <dt>{c.trackingNo}</dt>
              <dd className="trk__number">
                <span className="ltr" data-testid="tracking-number">
                  {d.trackingNumber}
                </span>
                <button type="button" className="trk__copy" onClick={() => void copy()} aria-live="polite">
                  {copied ? c.copied : c.copy}
                </button>
              </dd>
            </div>
            {d.shippedAt ? (
              <div>
                <dt>{c.shippedOn}</dt>
                <dd>{formatDate(d.shippedAt, lang)}</dd>
              </div>
            ) : null}
          </dl>
          {d.trackingUrl ? (
            <a className="btn btn--primary trk__courier" href={d.trackingUrl} target="_blank" rel="noopener noreferrer" data-testid="tracking-courier-link">
              {c.trackCourier} <Icon name="external" className="icon icon--inline icon--flip-rtl" />
            </a>
          ) : null}
        </div>
      ) : !stopped && rank < RANK.shipped ? (
        <p className="trk__wait">
          <Icon name="clock" /> {c.awaitingShipment}
        </p>
      ) : null}

      <p className="trk__help">
        {c.help} <Link to={p('/support')}>{c.contact}</Link>
      </p>
    </section>
  );
}
