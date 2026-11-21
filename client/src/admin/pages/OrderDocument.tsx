import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useApi } from '../../lib/hooks';
import type { Localized } from '../../lib/types';
import { useAT } from '../i18n';

/**
 * Printable order documents (A4), built only from the order record and the store's own settings:
 *  - invoice: customer, addresses, every line with unit price / discount / total, the totals with the
 *    VAT included, payment and delivery details;
 *  - packing: the same order and address details without prices, with a tick column per line, the
 *    amount to collect on delivery and signature lines for the warehouse and the courier.
 * Printed in the dashboard language. Empty store details (e.g. a VAT number not registered yet) are
 * left out, never invented.
 */
export type OrderDoc = {
  _id: string;
  orderNumber: string;
  status: string;
  paymentStatus: string;
  paymentMethod: string;
  createdAt: string;
  contact: { name: string; email: string; phone: string };
  customer?: { _id: string; name: string; email: string } | null;
  shippingAddress: Record<string, string>;
  items: { sku: string; name: Localized; quantity: number; unitPrice: number; lineTotal: number; discount: number; model?: string; warrantyMonths: number }[];
  subtotal: number;
  discountTotal: number;
  discount?: { code?: string };
  deliveryFee: number;
  codFee: number;
  total: number;
  vatAmount: number;
  refundedAmount: number;
  delivery: { courier: string; trackingNumber: string; shippedAt?: string; deliveredAt?: string };
  customerNote: string;
};

type PublicSettings = {
  business?: { name?: Localized; legalName?: Localized; address?: Localized; crNumber?: string; vatNumber?: string; email?: string; phone?: string };
  brand?: { logoUrl?: string };
  commerce?: { vatRatePercent?: number; currency?: string };
};

const COPY = {
  en: {
    invoice: 'Invoice',
    packing: 'Packing slip',
    invoiceNo: 'Invoice no.',
    orderNo: 'Order no.',
    orderDate: 'Order date',
    printed: 'Printed',
    cr: 'CR no.',
    vat: 'VAT no.',
    billTo: 'Customer',
    shipTo: 'Ship to',
    account: 'Account',
    registered: 'Registered customer',
    guest: 'Guest checkout',
    payment: 'Payment',
    method: 'Method',
    paymentStatus: 'Payment status',
    orderStatus: 'Order status',
    shipping: 'Delivery',
    courier: 'Courier',
    tracking: 'Tracking no.',
    shipped: 'Shipped',
    delivered: 'Delivered',
    country: 'Saudi Arabia',
    nationalAddress: 'National address',
    deliveryNotes: 'Delivery notes',
    head: ['#', 'SKU', 'Product', 'Qty', 'Unit price', 'Discount', 'Total'],
    packHead: ['#', 'SKU', 'Product', 'Qty', 'Packed'],
    model: 'Model',
    warranty: (m: number) => `${m}-month warranty`,
    subtotal: 'Subtotal',
    discount: 'Discount',
    deliveryFee: 'Delivery',
    codFee: 'Cash-on-delivery fee',
    total: 'Total (VAT included)',
    vatIncl: (r: number) => `Includes VAT ${r}%`,
    refunded: 'Refunded',
    paid: 'Amount paid',
    due: 'Amount to collect on delivery',
    free: 'Free',
    items: (n: number) => (n === 1 ? '1 item' : `${n} items`),
    note: 'Customer note',
    packedBy: 'Packed by',
    checkedBy: 'Checked by',
    receivedBy: 'Received by (courier)',
    signature: 'Name / signature / date',
    thanks: 'Thank you for shopping with us.',
    pricesNote: 'All prices in Saudi riyals and include VAT.',
  },
  ar: {
    invoice: 'فاتورة',
    packing: 'قائمة التغليف',
    invoiceNo: 'رقم الفاتورة',
    orderNo: 'رقم الطلب',
    orderDate: 'تاريخ الطلب',
    printed: 'تاريخ الطباعة',
    cr: 'السجل التجاري',
    vat: 'الرقم الضريبي',
    billTo: 'العميل',
    shipTo: 'عنوان الشحن',
    account: 'الحساب',
    registered: 'عميل مسجل',
    guest: 'طلب كزائر',
    payment: 'الدفع',
    method: 'طريقة الدفع',
    paymentStatus: 'حالة الدفع',
    orderStatus: 'حالة الطلب',
    shipping: 'التوصيل',
    courier: 'شركة الشحن',
    tracking: 'رقم التتبع',
    shipped: 'تاريخ الشحن',
    delivered: 'تاريخ التسليم',
    country: 'المملكة العربية السعودية',
    nationalAddress: 'العنوان الوطني',
    deliveryNotes: 'ملاحظات التوصيل',
    head: ['#', 'رمز المنتج', 'المنتج', 'الكمية', 'سعر الوحدة', 'الخصم', 'الإجمالي'],
    packHead: ['#', 'رمز المنتج', 'المنتج', 'الكمية', 'تم التغليف'],
    model: 'الموديل',
    warranty: (m: number) => `ضمان ${m} شهراً`,
    subtotal: 'المجموع الفرعي',
    discount: 'الخصم',
    deliveryFee: 'التوصيل',
    codFee: 'رسوم الدفع عند الاستلام',
    total: 'الإجمالي (شامل الضريبة)',
    vatIncl: (r: number) => `يشمل ضريبة القيمة المضافة ${r}%`,
    refunded: 'المبلغ المسترد',
    paid: 'المبلغ المدفوع',
    due: 'المبلغ المطلوب تحصيله عند الاستلام',
    free: 'مجاني',
    items: (n: number) => (n === 1 ? 'منتج واحد' : n === 2 ? 'منتجان' : `${n} منتجات`),
    note: 'ملاحظة العميل',
    packedBy: 'تم التغليف بواسطة',
    checkedBy: 'تمت المراجعة بواسطة',
    receivedBy: 'استلمه (المندوب)',
    signature: 'الاسم / التوقيع / التاريخ',
    thanks: 'شكراً لتسوقكم معنا.',
    pricesNote: 'جميع الأسعار بالريال السعودي وشاملة ضريبة القيمة المضافة.',
  },
};

export function OrderDocument({ order: o, variant, onReady }: { order: OrderDoc; variant: 'invoice' | 'packing'; onReady?: () => void }) {
  const { t, lang, n, sar, dt, d } = useAT();
  const c = COPY[lang];
  const { data: s, error } = useApi<PublicSettings>('/api/settings/public');
  const [logoDone, setLogoDone] = useState(false);
  const fired = useRef(false);
  // Ready once the store details answered (or failed) and the logo finished loading (or failed).
  useEffect(() => {
    if (fired.current || !(s || error) || !logoDone) return;
    fired.current = true;
    const id = setTimeout(() => onReady?.(), 50);
    return () => clearTimeout(id);
  }, [s, error, logoDone, onReady]);
  const pick = (l?: Localized | null) => (l ? (lang === 'ar' ? l.ar || l.en : l.en || l.ar) : '') || '';
  const b = s?.business ?? {};
  const store = pick(b.legalName) || pick(b.name) || 'CELIBERY International';
  const logo = s?.brand?.logoUrl || '/brand/celibery-logo-480.png';
  const vatRate = s?.commerce?.vatRatePercent ?? 15;
  const a = o.shippingAddress ?? {};
  const isCod = o.paymentMethod === 'cod';
  const units = o.items.reduce((sum, i) => sum + i.quantity, 0);
  const st = (v: string) => (t.status as Record<string, string>)[v] ?? v;
  const due = isCod && o.paymentStatus !== 'cod_collected' ? o.total : 0;
  const invoice = variant === 'invoice';

  // Rendered straight under <body>: printing hides everything else completely (no blank pages).
  return createPortal(
    <div className={`a-print a-doc a-doc--${variant}`} dir={lang === 'ar' ? 'rtl' : 'ltr'} aria-hidden="true">
      <header className="a-doc__head">
        <div className="a-doc__brand">
          <img src={logo} alt="" className="a-doc__logo" onLoad={() => setLogoDone(true)} onError={() => setLogoDone(true)} />
          <div className="a-doc__store">
            <strong>{store}</strong>
            {pick(b.address) ? <span>{pick(b.address)}</span> : null}
            {b.phone || b.email ? (
              <span className="ltr">{[b.phone, b.email].filter(Boolean).join(' · ')}</span>
            ) : null}
            {b.crNumber ? (
              <span>
                {c.cr}: <span className="ltr">{b.crNumber}</span>
              </span>
            ) : null}
            {b.vatNumber ? (
              <span>
                {c.vat}: <span className="ltr">{b.vatNumber}</span>
              </span>
            ) : null}
          </div>
        </div>
        <div className="a-doc__title">
          <h1>{invoice ? c.invoice : c.packing}</h1>
          <dl>
            <dt>{invoice ? c.invoiceNo : c.orderNo}</dt>
            <dd>
              <span className="ltr">{o.orderNumber}</span>
            </dd>
            <dt>{c.orderDate}</dt>
            <dd>{dt(o.createdAt)}</dd>
            <dt>{c.printed}</dt>
            <dd>{d(new Date())}</dd>
          </dl>
        </div>
      </header>

      <section className="a-doc__parties">
        <div>
          <h2>{c.billTo}</h2>
          <p>
            <strong>{o.contact.name}</strong>
            <br />
            <span className="ltr">{o.contact.phone}</span>
            <br />
            <span className="ltr">{o.contact.email}</span>
            <br />
            {c.account}: {o.customer ? c.registered : c.guest}
          </p>
        </div>
        <div>
          <h2>{c.shipTo}</h2>
          <p>
            <strong>{a.fullName || o.contact.name}</strong>
            <br />
            <span className="ltr">{a.phone || o.contact.phone}</span>
            <br />
            {[a.street, a.buildingNumber].filter(Boolean).join(' ')}
            {a.district ? `، ${a.district}` : ''}
            <br />
            {[a.city, a.postalCode].filter(Boolean).join(' ')}
            {a.city ? ` — ${c.country}` : c.country}
            {a.shortAddress ? (
              <>
                <br />
                {c.nationalAddress}: <span className="ltr">{a.shortAddress}</span>
              </>
            ) : null}
            {a.notes ? (
              <>
                <br />
                {c.deliveryNotes}: {a.notes}
              </>
            ) : null}
          </p>
        </div>
        <div>
          <h2>{c.payment}</h2>
          <dl className="a-doc__kv">
            <dt>{c.method}</dt>
            <dd>{t.method[o.paymentMethod] ?? o.paymentMethod}</dd>
            <dt>{c.paymentStatus}</dt>
            <dd>{st(o.paymentStatus)}</dd>
            <dt>{c.orderStatus}</dt>
            <dd>{st(o.status)}</dd>
          </dl>
          {o.delivery?.courier || o.delivery?.trackingNumber ? (
            <>
              <h2>{c.shipping}</h2>
              <dl className="a-doc__kv">
                {o.delivery.courier ? (
                  <>
                    <dt>{c.courier}</dt>
                    <dd>{o.delivery.courier}</dd>
                  </>
                ) : null}
                {o.delivery.trackingNumber ? (
                  <>
                    <dt>{c.tracking}</dt>
                    <dd>
                      <span className="ltr">{o.delivery.trackingNumber}</span>
                    </dd>
                  </>
                ) : null}
                {o.delivery.shippedAt ? (
                  <>
                    <dt>{c.shipped}</dt>
                    <dd>{d(o.delivery.shippedAt)}</dd>
                  </>
                ) : null}
                {o.delivery.deliveredAt ? (
                  <>
                    <dt>{c.delivered}</dt>
                    <dd>{d(o.delivery.deliveredAt)}</dd>
                  </>
                ) : null}
              </dl>
            </>
          ) : null}
        </div>
      </section>

      <table className="a-doc__items">
        <thead>
          <tr>
            {(invoice ? c.head : c.packHead).map((h, i) => (
              <th key={i}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {o.items.map((i, idx) => (
            <tr key={`${i.sku}-${idx}`}>
              <td>{n(idx + 1)}</td>
              <td>
                <span className="ltr">{i.sku}</span>
              </td>
              <td>
                {pick(i.name)}
                {i.model || i.warrantyMonths ? (
                  <small>
                    {[i.model ? `${c.model}: ${i.model}` : '', i.warrantyMonths ? c.warranty(i.warrantyMonths) : ''].filter(Boolean).join(' · ')}
                  </small>
                ) : null}
              </td>
              <td className="a-doc__num">{n(i.quantity)}</td>
              {invoice ? (
                <>
                  <td className="a-doc__num">{sar(i.unitPrice)}</td>
                  <td className="a-doc__num">{i.discount ? `−${sar(i.discount)}` : '—'}</td>
                  <td className="a-doc__num">{sar(i.lineTotal)}</td>
                </>
              ) : (
                <td className="a-doc__check">☐</td>
              )}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={3}>{c.items(units)}</td>
            <td className="a-doc__num">{n(units)}</td>
            <td colSpan={invoice ? 3 : 1} />
          </tr>
        </tfoot>
      </table>

      {invoice ? (
        <section className="a-doc__totals">
          <dl>
            <dt>{c.subtotal}</dt>
            <dd>{sar(o.subtotal)}</dd>
            {o.discountTotal ? (
              <>
                <dt>
                  {c.discount}
                  {o.discount?.code ? <span className="ltr"> ({o.discount.code})</span> : null}
                </dt>
                <dd>−{sar(o.discountTotal)}</dd>
              </>
            ) : null}
            <dt>{c.deliveryFee}</dt>
            <dd>{o.deliveryFee ? sar(o.deliveryFee) : c.free}</dd>
            {o.codFee ? (
              <>
                <dt>{c.codFee}</dt>
                <dd>{sar(o.codFee)}</dd>
              </>
            ) : null}
            <dt className="a-doc__grand">{c.total}</dt>
            <dd className="a-doc__grand">{sar(o.total)}</dd>
            <dt className="a-doc__muted">{c.vatIncl(vatRate)}</dt>
            <dd className="a-doc__muted">{sar(o.vatAmount)}</dd>
            {o.refundedAmount ? (
              <>
                <dt>{c.refunded}</dt>
                <dd>−{sar(o.refundedAmount)}</dd>
              </>
            ) : null}
            <dt className="a-doc__strong">{due ? c.due : c.paid}</dt>
            <dd className="a-doc__strong">{sar(due || o.total - (o.refundedAmount || 0))}</dd>
          </dl>
        </section>
      ) : (
        <section className="a-doc__pack">
          {due ? (
            <p className="a-doc__cod">
              {c.due}: <strong>{sar(due)}</strong>
            </p>
          ) : null}
          <div className="a-doc__signs">
            {[c.packedBy, c.checkedBy, c.receivedBy].map((label) => (
              <div key={label}>
                <span>{label}</span>
                <i />
                <small>{c.signature}</small>
              </div>
            ))}
          </div>
        </section>
      )}

      {o.customerNote ? (
        <p className="a-doc__note">
          <strong>{c.note}:</strong> {o.customerNote}
        </p>
      ) : null}

      <footer className="a-doc__foot">
        {invoice ? <p>{c.pricesNote}</p> : null}
        <p>{c.thanks}</p>
      </footer>
    </div>,
    document.body,
  );
}
