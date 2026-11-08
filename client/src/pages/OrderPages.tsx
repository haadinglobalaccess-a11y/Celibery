import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { OrderDetails } from '../components/OrderDetails';
import { ErrorState, Field, Spinner } from '../components/ui';
import { useI18n } from '../i18n/I18n';
import { ApiError, get, post, qs } from '../lib/api';
import { formatPrice } from '../lib/format';
import { useSeo } from '../lib/useSeo';
import type { OrderView } from '../lib/types';
import { tokenFor } from './Checkout';
import { OrderReturns } from '../components/OrderReturns';

/** Payment return page: asks the SERVER to verify the payment with the gateway. */
export function CheckoutReturn() {
  const { t, p, lang } = useI18n();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const orderNumber = params.get('order') ?? '';
  const token = params.get('token') ?? tokenFor(orderNumber);
  const [order, setOrder] = useState<OrderView | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [retrying, setRetrying] = useState(false);
  useSeo(t.ret.verifying, undefined, { noindex: true });

  useEffect(() => {
    if (!orderNumber) return;
    let alive = true;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = async () => {
      if (!alive) return;
      try {
        const o = await post<OrderView>(`/api/orders/${orderNumber}/verify-payment`, { token: token ?? undefined });
        if (!alive) return;
        setOrder(o);
        // Gateways can take a moment to settle — poll briefly while still pending.
        if (o.paymentStatus === 'pending' && attempts++ < 5 && !params.get('cancelled')) timer = setTimeout(run, 2500);
      } catch (e) {
        if (alive) setError(e as ApiError);
      }
    };
    void run();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [orderNumber, token, params]);

  const retry = async () => {
    setRetrying(true);
    try {
      const r = await post<{ paid: boolean; redirectUrl?: string }>(`/api/orders/${orderNumber}/retry-payment`, { token: token ?? undefined });
      if (r.paid || !r.redirectUrl) return window.location.reload();
      const u = new URL(r.redirectUrl, window.location.origin);
      if (u.origin === window.location.origin) nav(u.pathname + u.search);
      else window.location.assign(r.redirectUrl);
    } catch (e) {
      setError(e as ApiError);
      setRetrying(false);
    }
  };

  if (error) return <ErrorState message={error.code === 'RESERVATION_EXPIRED' ? t.ret.expired : error.message} />;
  if (!order) return <Spinner label={t.ret.verifying} />;

  const paid = order.paymentStatus === 'paid';
  const cod = order.paymentStatus === 'cod_pending';
  const failed = ['failed', 'expired'].includes(order.paymentStatus) || order.status === 'cancelled';
  const viewLink = p(`/track${qs({ order: order.orderNumber, token: token ?? undefined })}`);

  return (
    <div className="container auth-box" style={{ maxWidth: 640 }} data-testid="checkout-return">
      <div className="state" style={{ paddingBlock: 32 }}>
        <Icon name={paid || cod ? 'check' : failed ? 'alert' : 'box'} />
        <h1 data-testid="return-title">{paid ? t.ret.success : cod ? t.ret.codSuccess : failed ? t.ret.failed : t.ret.pending}</h1>
        <p>{paid ? t.ret.successText : cod ? t.ret.codSuccessText : failed ? t.ret.failedText : t.ret.pendingText}</p>
        <p>
          {t.ret.orderNumber}: <strong className="ltr">{order.orderNumber}</strong> · {formatPrice(order.total, lang)}
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
          {failed && order.status === 'pending' ? (
            <button className="btn btn--primary" onClick={retry} disabled={retrying}>
              {t.ret.retry}
            </button>
          ) : null}
          <Link className="btn btn--outline" to={viewLink}>
            {t.ret.viewOrder}
          </Link>
        </div>
      </div>
    </div>
  );
}

/** Development sandbox "hosted payment page". Never available in production (server 404s). */
export function SandboxPay() {
  const { t, lang } = useI18n();
  const { ref } = useParams();
  const nav = useNavigate();
  const [p, setP] = useState<{ amount: number; method: string; orderNumber: string; status: string } | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    get<typeof p>(`/api/payments/sandbox/${ref}`).then(setP).catch(() => setErr(true));
  }, [ref]);
  const go = async (outcome: 'success' | 'failure' | 'cancel') => {
    const r = await post<{ redirectUrl: string }>(`/api/payments/sandbox/${ref}/complete`, { outcome });
    const u = new URL(r.redirectUrl, window.location.origin);
    nav(u.pathname + u.search);
  };
  if (err) return <ErrorState />;
  if (!p) return <Spinner />;
  return (
    <div className="container auth-box" data-testid="sandbox-pay">
      <div className="panel">
        <h1 style={{ fontSize: 22 }}>{t.sandbox.title}</h1>
        <p className="alert alert--warning">{t.sandbox.text}</p>
        <p>
          {t.sandbox.amount}: <strong>{formatPrice(p.amount, lang)}</strong>
          <br />
          {t.sandbox.method}: {t.checkout.methods[p.method] ?? p.method}
          <br />
          {t.ret.orderNumber}: <span className="ltr">{p.orderNumber}</span>
        </p>
        <div style={{ display: 'grid', gap: 8 }}>
          <button className="btn btn--primary btn--lg" onClick={() => go('success')} data-testid="sandbox-success">
            {t.sandbox.pay}
          </button>
          <button className="btn btn--outline" onClick={() => go('failure')}>
            {t.sandbox.fail}
          </button>
          <button className="btn btn--ghost" onClick={() => go('cancel')}>
            {t.sandbox.cancel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function TrackOrder() {
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const orderParam = params.get('order') ?? '';
  const tokenParam = params.get('token') ?? (orderParam ? tokenFor(orderParam) : null);
  const [orderNumber, setOrderNumber] = useState(orderParam);
  const [phone, setPhone] = useState('');
  const [order, setOrder] = useState<OrderView | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState(false);
  useSeo(t.track.title, undefined, { noindex: true });

  useEffect(() => {
    if (!orderParam || !tokenParam) return;
    setBusy(true);
    get<{ order: OrderView }>(`/api/orders/track${qs({ orderNumber: orderParam, token: tokenParam })}`)
      .then((r) => setOrder(r.order))
      .catch(() => setNotFound(true))
      .finally(() => setBusy(false));
  }, [orderParam, tokenParam]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setNotFound(false);
    try {
      const num = orderNumber.trim().toUpperCase();
      const r = await get<{ order: OrderView }>(`/api/orders/track${qs({ orderNumber: num, phone: phone.replace(/\s/g, '') })}`);
      setOrder(r.order);
      setParams({ order: num });
    } catch {
      setNotFound(true);
      setOrder(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="container" style={{ maxWidth: 820, paddingBottom: 64 }}>
      <div className="page-head">
        <h1>{t.track.title}</h1>
        {!order ? <p className="muted">{t.track.text}</p> : null}
      </div>
      {order ? (
        <>
          <OrderDetails order={order} />
          {/* Returns need the order access token (full view) — not the limited phone lookup. */}
          {tokenParam && params.get('order') === order.orderNumber ? <OrderReturns orderNumber={order.orderNumber} token={tokenParam} /> : null}
        </>
      ) : busy && tokenParam ? (
        <Spinner />
      ) : (
        <form className="panel form-grid" onSubmit={submit} style={{ maxWidth: 480 }}>
          <Field label={t.track.orderNumber}>
            <input className="input" dir="ltr" required value={orderNumber} onChange={(e) => setOrderNumber(e.target.value)} placeholder="CEL-100001" />
          </Field>
          <Field label={t.checkout.phone}>
            <input className="input" dir="ltr" type="tel" required value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="05XXXXXXXX" />
          </Field>
          {notFound ? <p className="alert alert--error">{t.track.notFound}</p> : null}
          <button className="btn btn--primary" disabled={busy}>
            {t.track.submit}
          </button>
        </form>
      )}
    </div>
  );
}
