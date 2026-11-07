import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { Field, PayLogos } from '../components/ui';
import { useI18n } from '../i18n/I18n';
import { ApiError, get, post, uuid } from '../lib/api';
import { formatPrice, L } from '../lib/format';
import { useSeo } from '../lib/useSeo';
import type { Address, OrderView } from '../lib/types';
import { useAuth } from '../state/auth';
import { useCart } from '../state/cart';
import { useSettings } from '../state/settings';
import { useQuote } from '../state/useQuote';
import { storeCopy } from '../storefront/copy';
import { Summary } from './CartPage';

const SA_CITIES = ['Riyadh', 'Jeddah', 'Makkah', 'Madinah', 'Dammam', 'Khobar', 'Dhahran', 'Taif', 'Tabuk', 'Abha', 'Khamis Mushait', 'Buraidah', 'Hail', 'Jazan', 'Najran', 'Al Ahsa', 'Jubail', 'Yanbu', 'Al Kharj', 'Qatif'];
const SA_CITIES_AR = ['الرياض', 'جدة', 'مكة المكرمة', 'المدينة المنورة', 'الدمام', 'الخبر', 'الظهران', 'الطائف', 'تبوك', 'أبها', 'خميس مشيط', 'بريدة', 'حائل', 'جازان', 'نجران', 'الأحساء', 'الجبيل', 'ينبع', 'الخرج', 'القطيف'];

const phoneRx = /^(\+?966|0)?5\d{8}$/;
const emailRx = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Options = {
  paymentMethods: Record<string, boolean>;
  freeDelivery: boolean;
  freeDeliveryThreshold?: number | null;
  shippingAvailable?: boolean;
  shippingUnavailableMessage?: { ar: string; en: string };
  courier: string;
  estimatedDelivery: { ar: string; en: string };
};

/** Saves guest order access tokens so the customer can return to their order on this device. */
export function rememberOrder(orderNumber: string, token: string | null) {
  if (!token) return;
  try {
    const list = JSON.parse(localStorage.getItem('cel_orders') ?? '[]') as { orderNumber: string; token: string }[];
    localStorage.setItem('cel_orders', JSON.stringify([{ orderNumber, token }, ...list.filter((o) => o.orderNumber !== orderNumber)].slice(0, 20)));
  } catch {
    /* ignore */
  }
}
export function tokenFor(orderNumber: string) {
  try {
    return (JSON.parse(localStorage.getItem('cel_orders') ?? '[]') as { orderNumber: string; token: string }[]).find((o) => o.orderNumber === orderNumber)?.token ?? null;
  } catch {
    return null;
  }
}

const emptyAddress: Address = { fullName: '', phone: '', city: '', district: '', street: '', buildingNumber: '', postalCode: '', shortAddress: '', notes: '' };

export default function Checkout() {
  const { t, lang, p } = useI18n();
  const nav = useNavigate();
  const cart = useCart();
  const { user } = useAuth();
  const settings = useSettings();
  const [options, setOptions] = useState<Options | null>(null);
  const [saved, setSaved] = useState<Address[]>([]);
  const [contact, setContact] = useState({ name: '', email: '', phone: '' });
  const [addr, setAddr] = useState<Address>(emptyAddress);
  const [method, setMethod] = useState('');
  const [note, setNote] = useState('');
  const [saveAddress, setSaveAddress] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [cityForQuote, setCityForQuote] = useState('');
  const { quote, loading: quoteLoading, error: quoteError } = useQuote(method, contact.email, cityForQuote);
  useSeo(t.checkout.title);

  const isCustomer = user?.type === 'customer';

  useEffect(() => {
    get<Options>('/api/checkout/options').then(setOptions).catch(() => setOptions(null));
  }, []);
  useEffect(() => {
    if (!isCustomer || !user) return;
    setContact((c) => ({ name: c.name || user.name, email: c.email || user.email, phone: c.phone || user.phone || '' }));
    get<Address[]>('/api/me/addresses')
      .then((list) => {
        setSaved(list);
        const def = list.find((a) => a.isDefault) ?? list[0];
        if (def) setAddr({ ...emptyAddress, ...def });
      })
      .catch(() => undefined);
  }, [isCustomer, user]);

  // Re-quote with the delivery city shortly after typing stops (COD city rules).
  useEffect(() => {
    const id = setTimeout(() => setCityForQuote(addr.city), 400);
    return () => clearTimeout(id);
  }, [addr.city]);
  const shippingPaused = options?.shippingAvailable === false || quote?.shippingAvailable === false;
  const codNote =
    options?.paymentMethods?.cod && quote && !quote.codAvailable
      ? { below_min: t.checkout.codBelowMin, above_max: t.checkout.codAboveMax, city: t.checkout.codCity }[quote.codUnavailableReason ?? ''] ?? ''
      : '';

  const methods = useMemo(() => {
    const m = options?.paymentMethods ?? {};
    return (['card', 'applepay', 'stcpay', 'tabby', 'cod'] as const).filter((k) => m[k] && (k !== 'cod' || quote?.codAvailable !== false));
  }, [options, quote?.codAvailable]);
  useEffect(() => {
    if (!method && methods.length) setMethod(methods[0]);
    if (method && methods.length && !methods.includes(method as (typeof methods)[number])) setMethod(methods[0]);
  }, [methods, method]);

  // One idempotency key per checkout attempt (protects against double-clicks and retries).
  const [idemKey] = useState(() => {
    try {
      const k = sessionStorage.getItem('cel_checkout_key');
      if (k) return k;
      const n = uuid();
      sessionStorage.setItem('cel_checkout_key', n);
      return n;
    } catch {
      return uuid();
    }
  });

  if (!cart.items.length && !submitted) return <Navigate to={p('/cart')} replace />;

  const validate = () => {
    const e: Record<string, string> = {};
    const req = t.common.required;
    if (contact.name.trim().length < 2) e.name = req;
    if (!emailRx.test(contact.email.trim())) e.email = req;
    if (!phoneRx.test(contact.phone.replace(/\s/g, ''))) e.phone = t.checkout.phoneHint;
    if (addr.fullName.trim().length < 2) e.fullName = req;
    if (!phoneRx.test(addr.phone.replace(/\s/g, ''))) e.addrPhone = t.checkout.phoneHint;
    if (addr.city.trim().length < 2) e.city = req;
    if (addr.district.trim().length < 2) e.district = req;
    if (addr.street.trim().length < 2) e.street = req;
    if (addr.postalCode && !/^\d{5}$/.test(addr.postalCode)) e.postalCode = '12345';
    if (addr.shortAddress && !/^[A-Za-z]{4}\d{4}$/.test(addr.shortAddress)) e.shortAddress = 'ABCD1234';
    if (!method) e.method = req;
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    setServerError(null);
    if (!validate()) {
      document.querySelector('[aria-invalid="true"]')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }
    setBusy(true);
    try {
      const res = await post<{ order: OrderView; accessToken: string | null; redirectUrl: string | null; paymentError?: string }>('/api/checkout', {
        idempotencyKey: idemKey,
        items: cart.items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
        contact: { name: contact.name.trim(), email: contact.email.trim(), phone: contact.phone.replace(/\s/g, '') },
        shippingAddress: {
          fullName: addr.fullName.trim(),
          phone: addr.phone.replace(/\s/g, ''),
          city: addr.city.trim(),
          district: addr.district.trim(),
          street: addr.street.trim(),
          buildingNumber: addr.buildingNumber.trim(),
          postalCode: addr.postalCode.trim(),
          shortAddress: addr.shortAddress.trim(),
          notes: addr.notes.trim(),
        },
        paymentMethod: method,
        discountCode: cart.discountCode || undefined,
        customerNote: note,
        lang,
        saveAddress: isCustomer && saveAddress && !addr._id,
      });
      const { order, accessToken, redirectUrl } = res;
      rememberOrder(order.orderNumber, accessToken);
      try {
        sessionStorage.removeItem('cel_checkout_key');
      } catch {
        /* ignore */
      }
      // Router navigation may be deferred; clearing the cart must not redirect back to /cart.
      setSubmitted(true);
      cart.clear();
      const token = accessToken ?? tokenFor(order.orderNumber);
      const ret = p(`/checkout/return?order=${order.orderNumber}${token ? `&token=${token}` : ''}`);
      if (redirectUrl) {
        const u = new URL(redirectUrl, window.location.origin);
        if (u.origin === window.location.origin) nav(u.pathname + u.search);
        else window.location.assign(redirectUrl); // hosted payment page (Moyasar / Tabby)
      } else nav(ret + (method === 'cod' ? '&cod=1' : ''));
    } catch (e) {
      const err = e as ApiError;
      setServerError(err.code === 'CART_CHANGED' || err.code === 'OUT_OF_STOCK' ? t.cart.changed : err.message);
      setBusy(false);
    }
  };

  const cities = lang === 'ar' ? SA_CITIES_AR : SA_CITIES;
  const a = (k: keyof Address) => ({
    value: (addr[k] as string) ?? '',
    onChange: (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setAddr((s) => ({ ...s, [k]: e.target.value, _id: undefined })),
  });

  return (
    <div className="container cx-checkout">
      <div className="cx-pagehead">
        <span className="cx-eyebrow">{storeCopy(lang).secureCheckout}</span>
        <h1 className="cx-display cx-display--xl">{t.checkout.title}</h1>
        {!user ? (
          <p className="cx-pagehead__meta">
            {t.checkout.guestNote} <Link to={p('/login?next=/checkout')} style={{ textDecoration: 'underline' }}>{t.checkout.loginLink}</Link>
          </p>
        ) : null}
      </div>
      <form className="cart-layout" onSubmit={submit} noValidate>
        <div>
          <section className="panel">
            <h2>
              <span className="step-num">1</span> {t.checkout.contact}
            </h2>
            <div className="form-grid form-grid--2">
              <Field label={t.checkout.name} error={errors.name} className="span-2">
                <input className="input" autoComplete="name" value={contact.name} aria-invalid={!!errors.name} onChange={(e) => setContact({ ...contact, name: e.target.value })} name="name" />
              </Field>
              <Field label={t.checkout.email} error={errors.email}>
                <input className="input" type="email" autoComplete="email" dir="ltr" value={contact.email} aria-invalid={!!errors.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} name="email" />
              </Field>
              <Field label={t.checkout.phone} error={errors.phone} hint={t.checkout.phoneHint}>
                <input
                  className="input"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  dir="ltr"
                  value={contact.phone}
                  aria-invalid={!!errors.phone}
                  onChange={(e) => {
                    const v = e.target.value;
                    setContact({ ...contact, phone: v });
                    setAddr((s) => (s.phone ? s : { ...s, phone: v }));
                  }}
                  name="phone"
                />
              </Field>
            </div>
          </section>

          <section className="panel">
            <h2>
              <span className="step-num">2</span> {t.checkout.address}
            </h2>
            {saved.length ? (
              <div className="address-cards">
                <span className="label">{t.checkout.savedAddresses}</span>
                {saved.map((s) => (
                  <label key={s._id} className="pay-option">
                    <input type="radio" name="saved" checked={addr._id === s._id} onChange={() => setAddr({ ...emptyAddress, ...s })} />
                    <span>
                      {s.fullName} — {s.city}, {s.district}, {s.street}
                    </span>
                  </label>
                ))}
              </div>
            ) : null}
            <div className="form-grid form-grid--2">
              <Field label={t.checkout.name} error={errors.fullName}>
                <input className="input" autoComplete="shipping name" aria-invalid={!!errors.fullName} {...a('fullName')} name="fullName" />
              </Field>
              <Field label={t.checkout.phone} error={errors.addrPhone}>
                <input className="input" type="tel" dir="ltr" autoComplete="shipping tel" aria-invalid={!!errors.addrPhone} {...a('phone')} name="addrPhone" />
              </Field>
              <Field label={t.checkout.city} error={errors.city}>
                <input className="input" list="sa-cities" autoComplete="shipping address-level2" aria-invalid={!!errors.city} {...a('city')} name="city" />
                <datalist id="sa-cities">
                  {cities.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </Field>
              <Field label={t.checkout.district} error={errors.district}>
                <input className="input" autoComplete="shipping address-level3" aria-invalid={!!errors.district} {...a('district')} name="district" />
              </Field>
              <Field label={t.checkout.street} error={errors.street} className="span-2">
                <input className="input" autoComplete="shipping address-line1" aria-invalid={!!errors.street} {...a('street')} name="street" />
              </Field>
              <Field label={t.checkout.building}>
                <input className="input" inputMode="numeric" dir="ltr" {...a('buildingNumber')} name="buildingNumber" />
              </Field>
              <Field label={t.checkout.postal} error={errors.postalCode}>
                <input className="input" inputMode="numeric" dir="ltr" autoComplete="shipping postal-code" aria-invalid={!!errors.postalCode} {...a('postalCode')} name="postalCode" />
              </Field>
              <Field label={t.checkout.shortAddress} error={errors.shortAddress}>
                <input className="input" dir="ltr" aria-invalid={!!errors.shortAddress} {...a('shortAddress')} name="shortAddress" />
              </Field>
              <Field label={t.checkout.notes} className="span-2">
                <textarea className="textarea" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
              </Field>
            </div>
            {isCustomer && !addr._id ? (
              <label className="check" style={{ marginTop: 12 }}>
                <input type="checkbox" checked={saveAddress} onChange={(e) => setSaveAddress(e.target.checked)} /> {t.checkout.saveAddress}
              </label>
            ) : null}
            <div className="info-row" style={{ marginTop: 16 }}>
              <strong>
                {options?.freeDelivery !== false || (quote && quote.deliveryFee === 0) ? t.checkout.deliveryFree : t.checkout.delivery}
                {options?.freeDelivery === false && options.freeDeliveryThreshold && quote && quote.deliveryFee > 0 ? ` · ${t.checkout.freeFrom(formatPrice(options.freeDeliveryThreshold, lang))}` : ''}
              </strong>
              <span className="muted">
                {options?.courier ? `· ${options.courier}` : ''} {L(options?.estimatedDelivery, lang) ? `· ${L(options?.estimatedDelivery, lang)}` : ''}
              </span>
            </div>
          </section>

          <section className="panel">
            <h2>
              <span className="step-num">3</span> {t.checkout.payment}
            </h2>
            {settings?.payments?.sandbox ? <p className="alert alert--warning">{t.checkout.sandboxNote}</p> : null}
            {methods.length ? (
              <div className="pay-options" role="radiogroup" aria-label={t.checkout.payment}>
                {methods.map((m) => (
                  <label key={m} className="pay-option" data-testid={`pay-${m}`}>
                    <input type="radio" name="method" value={m} checked={method === m} onChange={() => setMethod(m)} />
                    <span>{t.checkout.methods[m]}</span>
                    {m === 'card' ? (
                      <span className="pay-logos" aria-hidden="true">
                        <span className="pay-logo">mada</span>
                        <span className="pay-logo">VISA</span>
                        <span className="pay-logo">Mastercard</span>
                      </span>
                    ) : null}
                  </label>
                ))}
              </div>
            ) : options ? (
              <p className="alert alert--error">{t.checkout.noMethods}</p>
            ) : (
              <div className="skeleton" style={{ height: 120 }} />
            )}
            {codNote ? <p className="muted" style={{ fontSize: 13 }}>{codNote}</p> : null}
            {errors.method ? <p className="error">{errors.method}</p> : null}
          </section>
        </div>

        <Summary quote={quote}>
          <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 16px', fontSize: 13 }}>
            {quote?.lines.map((l) => (
              <li key={l.productId} className="sum-row">
                <span>
                  {L(l.name, lang)} <span className="ltr muted">×{l.quantity}</span>
                </span>
                <span>{formatPrice(l.lineTotal, lang)}</span>
              </li>
            ))}
          </ul>
          {shippingPaused ? (
            <p className="alert alert--warning" role="alert">
              {L(options?.shippingUnavailableMessage, lang) || t.checkout.shippingPaused}
            </p>
          ) : null}
          {serverError || quoteError ? (
            <p className="alert alert--error" role="alert">
              {serverError || quoteError} {serverError === t.cart.changed ? <Link to={p('/cart')}>{t.cart.title} →</Link> : null}
            </p>
          ) : null}
          <button className="btn btn--primary btn--block btn--lg" disabled={busy || quoteLoading || Boolean(quoteError) || shippingPaused || !methods.length || !quote || Boolean(quote.issues.length)} data-testid="place-order">
            {busy ? t.checkout.processing : method === 'cod' ? t.checkout.placeOrderCod : t.checkout.placeOrder}
          </button>
          <p className="muted" style={{ fontSize: 12, marginTop: 12 }}>
            {t.checkout.agree}
          </p>
          <PayLogos />
        </Summary>
      </form>
    </div>
  );
}
