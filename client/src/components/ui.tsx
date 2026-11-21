import { type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useI18n, useMaybeI18n } from '../i18n/I18n';
import { useMoney } from '../state/currency';
import { useSettings } from '../state/settings';
import { DimensionalIcon } from '../three-d/DimensionalIcon';
import { Icon } from './Icon';

export function Price({ price, compareAt, className = '' }: { price: number; compareAt?: number | null; className?: string }) {
  const { lang } = useI18n();
  const money = useMoney();
  return (
    <span className={`price ${className}`}>
      <span className="price__now">{money(price)}</span>
      {compareAt && compareAt > price ? (
        <s className="price__was">
          <span className="sr-only">{lang === 'ar' ? 'السعر قبل الخصم' : 'Was'} </span>
          {money(compareAt)}
        </s>
      ) : null}
    </span>
  );
}

export function Spinner({ label }: { label?: string }) {
  const i18n = useMaybeI18n();
  return (
    <div className="state" role="status">
      <div className="spinner" />
      <span className="sr-only">{label ?? i18n?.t.common.loading ?? 'Loading…'}</span>
    </div>
  );
}

export function EmptyState({ title, text, action, icon = 'box' }: { title: string; text?: string; action?: ReactNode; icon?: string }) {
  return (
    <div className="state state--3d d-icon-host">
      <DimensionalIcon name={icon} size="lg" />
      <h2>{title}</h2>
      {text ? <p>{text}</p> : null}
      {action}
    </div>
  );
}

export function ErrorState({ onRetry, message }: { onRetry?: () => void; message?: string }) {
  const { t } = useI18n();
  return (
    <div className="state" role="alert">
      <Icon name="alert" />
      <h2>{t.common.error}</h2>
      {message ? <p>{message}</p> : null}
      {onRetry ? (
        <button className="btn btn--outline" onClick={onRetry}>
          {t.common.retry}
        </button>
      ) : null}
    </div>
  );
}

export function NotFound() {
  const { t, p } = useI18n();
  return (
    <div className="container not-found">
      <div className="nf3d ltr" aria-hidden="true">
        <span>4</span>
        <span className="nf3d__zero">0</span>
        <span>4</span>
      </div>
      <EmptyState
        icon="search"
        title={t.common.notFound}
        text={t.common.notFoundText}
        action={
          <Link className="btn btn--primary" to={p('/')}>
            {t.common.home}
          </Link>
        }
      />
    </div>
  );
}

export function Quantity({ value, onChange, max = 99, min = 1, label }: { value: number; onChange: (n: number) => void; max?: number; min?: number; label: string }) {
  return (
    <div className="qty" role="group" aria-label={label}>
      <button type="button" onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min} aria-label="−">
        <Icon name="minus" className="icon" />
      </button>
      {/* Re-keyed so the number rolls in on each change (visual only) */}
      <output aria-live="polite" key={value}>
        {value}
      </output>
      <button type="button" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} aria-label="+">
        <Icon name="plus" className="icon" />
      </button>
    </div>
  );
}

export function Field({ label, error, hint, children, className = '' }: { label: string; error?: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <div className={`field ${className}`}>
      <label>
        <span className="label">{label}</span>
        {children}
      </label>
      {hint && !error ? <span className="hint">{hint}</span> : null}
      {error ? (
        <span className="error" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}

/**
 * Product names with joined terms ("USB-C", "Flush-Fit", "2-in-1") never break at the hyphen, so a
 * title never ends a line with "USB-" and starts the next with "C".
 */
export function ProductName({ text }: { text: string }) {
  const parts = text.split(/(\S+-\S+)/);
  if (parts.length === 1) return <>{text}</>;
  return (
    <>
      {parts.map((part, i) =>
        i % 2 ? (
          <span key={i} style={{ whiteSpace: 'nowrap' }}>
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </>
  );
}

export function Crumbs({ items }: { items: { label: string; to?: string }[] }) {
  const i18n = useMaybeI18n();
  return (
    <nav className="crumbs" aria-label={i18n?.t.a11y.breadcrumb ?? 'Breadcrumb'}>
      {items.map((c, i) => (
        <span key={i}>
          {c.to ? <Link to={c.to}>{c.label}</Link> : <span aria-current="page">{c.label}</span>}
          {i < items.length - 1 ? <span aria-hidden="true"> / </span> : null}
        </span>
      ))}
    </nav>
  );
}

/** Logos of the payment methods the store can take right now (configured gateway + switched on in Admin). */
export function PayLogos() {
  const pay = useSettings()?.payments;
  const i18n = useMaybeI18n();
  if (!pay || !(pay.card || pay.applepay || pay.stcpay || pay.tabby)) return null;
  // Official badges (public/payment-logos/README.md), only for methods enabled in Admin → Payments.
  // Card payments run through Moyasar, which accepts mada, Visa and Mastercard.
  const brands: [boolean | undefined, string, string][] = [
    [pay.card, 'mada', 'mada'],
    [pay.card, 'visa', 'Visa'],
    [pay.card, 'mastercard', 'Mastercard'],
    [pay.applepay, 'applepay', 'Apple Pay'],
    [pay.stcpay, 'stcpay', 'STC Pay'],
    [pay.tabby, 'tabby', 'tabby'],
  ];
  return (
    <span className="pay-logos pay-brand-logos" role="list" aria-label={i18n?.t.a11y.paymentBrands ?? 'Accepted payment brands'}>
      {brands
        .filter(([on]) => on)
        .map(([, file, name]) => (
          <img key={file} role="listitem" src={`/payment-logos/${file}.svg`} alt={name} title={name} width={42} height={28} loading="lazy" decoding="async" />
        ))}
    </span>
  );
}
