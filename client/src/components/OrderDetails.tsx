import { useI18n } from '../i18n/I18n';
import { formatDate, formatPrice, L } from '../lib/format';
import type { OrderView } from '../lib/types';
import { ProductImage } from './ProductCard';

const STEPS = ['confirmed', 'processing', 'shipped', 'delivered'];

export function OrderDetails({ order }: { order: OrderView }) {
  const { t, lang } = useI18n();
  const reached = (s: string) => {
    if (['cancelled', 'returned'].includes(order.status)) return false;
    const idx = STEPS.indexOf(order.status);
    return idx >= STEPS.indexOf(s);
  };
  return (
    <div data-testid="order-details">
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
        <h2 style={{ margin: 0 }}>
          <span className="ltr">{order.orderNumber}</span>
        </h2>
        <span className={`badge ${order.status === 'cancelled' ? 'badge--danger' : order.status === 'delivered' ? 'badge--success' : 'badge--dark'}`} data-testid="order-status">
          {t.order.status[order.status] ?? order.status}
        </span>
        <span className="badge">{t.order.payment[order.paymentStatus] ?? order.paymentStatus}</span>
      </div>
      <p className="muted" style={{ marginTop: 8 }}>
        {t.order.placedOn}: {formatDate(order.createdAt, lang, true)}
      </p>

      {!['cancelled', 'returned', 'pending'].includes(order.status) ? (
        <div className="status-steps" aria-hidden="true">
          {STEPS.map((s) => (
            <div key={s} data-done={reached(s)}>
              {t.order.status[s]}
            </div>
          ))}
        </div>
      ) : null}

      {order.delivery?.trackingNumber ? (
        <div className="info-row" style={{ marginBlock: 16 }}>
          <div>
            <strong>
              {t.order.tracking}: <span className="ltr">{order.delivery.trackingNumber}</span>
            </strong>
            <span className="muted">
              {t.order.courier}: {order.delivery.courier}
            </span>
            {order.delivery.trackingUrl ? (
              <div>
                <a href={order.delivery.trackingUrl} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'underline' }}>
                  {t.order.trackShipment} ↗
                </a>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      <h3 style={{ marginTop: 24 }}>{t.order.items}</h3>
      {order.items.map((i, idx) => (
        <div className="line" key={idx}>
          <ProductImage src={i.image} alt={L(i.name, lang)} />
          <div>
            <div className="line__top">
              <span className="line__name">{L(i.name, lang)}</span>
              {i.lineTotal !== undefined ? <strong>{formatPrice(i.lineTotal, lang)}</strong> : null}
            </div>
            <span className="muted ltr">×{i.quantity}</span>
          </div>
        </div>
      ))}

      <div style={{ maxWidth: 380, marginTop: 16 }}>
        {order.subtotal !== undefined ? (
          <div className="sum-row">
            <span>{t.cart.subtotal}</span>
            <span>{formatPrice(order.subtotal, lang)}</span>
          </div>
        ) : null}
        {order.discountTotal ? (
          <div className="sum-row">
            <span>{t.cart.discount}</span>
            <span>−{formatPrice(order.discountTotal, lang)}</span>
          </div>
        ) : null}
        {order.deliveryFee !== undefined ? (
          <div className="sum-row">
            <span>{t.cart.delivery}</span>
            <span>{order.deliveryFee ? formatPrice(order.deliveryFee, lang) : t.cart.free}</span>
          </div>
        ) : null}
        {order.codFee ? (
          <div className="sum-row">
            <span>{t.cart.codFee}</span>
            <span>{formatPrice(order.codFee, lang)}</span>
          </div>
        ) : null}
        <div className="sum-row sum-row--total">
          <span>{t.cart.total}</span>
          <span>{formatPrice(order.total, lang)}</span>
        </div>
        {order.vatRate ? (
          <small className="muted">
            {t.cart.vat(order.vatRate)} ({formatPrice(order.vatAmount ?? 0, lang)})
          </small>
        ) : null}
      </div>

      {order.shippingAddress ? (
        <>
          <h3 style={{ marginTop: 24 }}>{t.order.shipTo}</h3>
          <p>
            {order.shippingAddress.fullName} · <span className="ltr">{order.shippingAddress.phone}</span>
            <br />
            {[order.shippingAddress.street, order.shippingAddress.buildingNumber, order.shippingAddress.district, order.shippingAddress.city, order.shippingAddress.postalCode].filter(Boolean).join('، ')}
          </p>
        </>
      ) : null}
      {order.paymentMethod ? (
        <p>
          {t.order.paymentMethod}: {t.checkout.methods[order.paymentMethod] ?? order.paymentMethod}
        </p>
      ) : null}

      {order.history?.length ? (
        <>
          <h3 style={{ marginTop: 24 }}>{t.order.timeline}</h3>
          <ol className="timeline">
            {[...order.history].reverse().map((h, i) => (
              <li key={i}>
                <strong>{t.order.status[h.status] ?? h.status}</strong>
                <div className="muted" style={{ fontSize: 13 }}>
                  {formatDate(h.at, lang, true)} {h.note ? `· ${h.note}` : ''}
                </div>
              </li>
            ))}
          </ol>
        </>
      ) : null}
    </div>
  );
}
