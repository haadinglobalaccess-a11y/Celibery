import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ProductImage } from '../components/ProductCard';
import { EmptyState, Quantity } from '../components/ui';
import { useI18n } from '../i18n/I18n';
import { formatPrice, L } from '../lib/format';
import { useSeo } from '../lib/useSeo';
import type { Quote } from '../lib/types';
import { useCart } from '../state/cart';
import { useSettings } from '../state/settings';
import { useQuote } from '../state/useQuote';
import { storeCopy } from '../storefront/copy';

export function Summary({ quote, children, showCode = true }: { quote: Quote | null; children?: ReactNode; showCode?: boolean }) {
  const { t, lang } = useI18n();
  const cart = useCart();
  const [code, setCode] = useState(cart.discountCode);
  const apply = () => {
    const next = code.trim().toUpperCase();
    if (next) cart.setDiscountCode(next);
  };
  return (
    <aside className="summary" aria-label={t.checkout.summary}>
      <h2>{t.checkout.summary}</h2>
      {showCode ? (
        <>
          {/* Not a <form>: on Checkout this summary sits inside the checkout <form>, and a nested
              form submits natively (full page reload) instead of applying the code. */}
          <div className="code-form" role="group" aria-label={t.cart.code}>
            <label className="sr-only" htmlFor="code">
              {t.cart.code}
            </label>
            <input
              id="code"
              className="input"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return;
                // Enter applies the code; it must never submit (place) the surrounding checkout form.
                e.preventDefault();
                if (!cart.discountCode) apply();
              }}
              placeholder={t.cart.code}
              autoComplete="off"
              enterKeyHint="done"
            />
            {cart.discountCode ? (
              <button
                type="button"
                className="btn btn--outline"
                onClick={() => {
                  setCode('');
                  cart.setDiscountCode('');
                }}
              >
                {t.cart.removeCode}
              </button>
            ) : (
              <button type="button" className="btn btn--outline" onClick={apply}>
                {t.cart.applyCode}
              </button>
            )}
          </div>
          {quote?.discountError ? <p className="alert alert--error">{quote.discountError}</p> : null}
        </>
      ) : null}
      {quote ? (
        <div data-testid="summary">
          <div className="sum-row">
            <span>{t.cart.subtotal}</span>
            <span>{formatPrice(quote.subtotal, lang)}</span>
          </div>
          {quote.discountTotal ? (
            <div className="sum-row" style={{ color: 'var(--success)' }}>
              <span>
                {t.cart.discount} <span className="ltr">({quote.discount?.code})</span>
              </span>
              <span>−{formatPrice(quote.discountTotal, lang)}</span>
            </div>
          ) : null}
          <div className="sum-row">
            <span>{t.cart.delivery}</span>
            <span>{quote.deliveryFee ? formatPrice(quote.deliveryFee, lang) : t.cart.free}</span>
          </div>
          {quote.codFee ? (
            <div className="sum-row">
              <span>{t.cart.codFee}</span>
              <span>{formatPrice(quote.codFee, lang)}</span>
            </div>
          ) : null}
          <div className="sum-row sum-row--total">
            <span>{t.cart.total}</span>
            <span data-testid="total">{formatPrice(quote.total, lang)}</span>
          </div>
          {quote.vatRate ? (
            <small className="muted">
              {t.cart.vat(quote.vatRate)} ({formatPrice(quote.vatAmount, lang)})
            </small>
          ) : null}
        </div>
      ) : (
        <div className="skeleton" style={{ height: 120 }} />
      )}
      <div style={{ marginTop: 16 }}>{children}</div>
    </aside>
  );
}

export default function CartPage() {
  const { t, lang, p } = useI18n();
  const cart = useCart();
  const settings = useSettings();
  const { quote } = useQuote();
  useSeo(t.cart.title, undefined, { noindex: true });

  if (!cart.items.length) {
    return (
      <div className="container cx-bag cx-bag--empty">
        <EmptyState
          icon="bag"
          title={t.cart.empty}
          text={t.cart.emptyHint}
          action={
            <Link className="btn btn--primary" to={p('/shop')}>
              {t.cart.continue}
            </Link>
          }
        />
      </div>
    );
  }

  const lineFor = (id: string) => quote?.lines.find((l) => l.productId === id);
  const blocked = Boolean(quote?.issues.length);

  const sc = storeCopy(lang);
  const count = cart.items.reduce((n, i) => n + i.quantity, 0);

  return (
    <div className="container cx-bag">
      <header className="cx-pagehead">
        <span className="cx-eyebrow">{sc.bag}</span>
        <h1 className="cx-display cx-display--xl">{t.cart.title}</h1>
        <p className="cx-pagehead__meta">{sc.items(count)}</p>
      </header>
      <div className="cart-layout cx-bag__layout">
        <section className="cx-bag__lines">
          {blocked ? (
            <p className="alert alert--warning" role="alert">
              {t.cart.changed}
            </p>
          ) : null}
          {cart.items.map((i) => {
            const line = lineFor(i.productId);
            const issue = quote?.issues.find((x) => x.productId === i.productId);
            const name = L(line?.name ?? i.snapshot.name, lang);
            // Current product data from the server quote; the saved snapshot only fills in until it arrives.
            const slug = line?.slug || i.snapshot.slug;
            const model = line ? line.model : i.snapshot.model;
            const max = Math.max(1, Math.min(line?.maxQuantity ?? 99, settings?.commerce?.maxQuantityPerItem ?? 10));
            return (
              <div className="line cx-bagline" key={i.productId} data-testid="cart-line">
                <Link to={p(`/p/${slug}`)} className="cx-bagline__media" tabIndex={-1} aria-hidden="true">
                  <ProductImage src={line?.image || i.snapshot.image} alt={name} />
                </Link>
                <div>
                  <div className="line__top">
                    <div>
                      <Link className="line__name" to={p(`/p/${slug}`)}>
                        {name}
                      </Link>
                      {model ? <div className="cx-bagline__model ltr">{model}</div> : null}
                    </div>
                    <strong>{formatPrice(line ? line.unitPrice * i.quantity : i.snapshot.price * i.quantity, lang)}</strong>
                  </div>
                  {issue ? (
                    <p className="alert alert--warning" style={{ marginTop: 8 }}>
                      {issue.code === 'QUANTITY_LIMITED' ? t.cart.onlyLeft(line?.maxQuantity ?? 0) : t.cart.unavailable}
                    </p>
                  ) : null}
                  <div className="line__actions">
                    <Quantity
                      label={t.product.quantity}
                      value={i.quantity}
                      max={max}
                      onChange={(n) => cart.setQty(i.productId, n)}
                    />
                    <button className="link-btn cx-bagline__remove" onClick={() => cart.remove(i.productId)}>
                      {t.cart.remove}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
          <Link to={p('/shop')} className="cx-link cx-bag__continue">
            <span className="cx-arrow cx-arrow--back" aria-hidden="true">
              ←
            </span>{' '}
            {t.cart.continue}
          </Link>
        </section>
        <Summary quote={quote}>
          {blocked ? (
            <button
              className="btn btn--outline btn--block"
              onClick={() => {
                for (const is of quote!.issues) {
                  const l = lineFor(is.productId ?? '');
                  if (!l || !l.available) cart.remove(is.productId ?? '');
                  else cart.setQty(l.productId, l.maxQuantity);
                }
              }}
            >
              {lang === 'ar' ? 'تحديث السلة' : 'Update cart'}
            </button>
          ) : (
            <Link className="btn btn--primary btn--block btn--lg" to={p('/checkout')} data-testid="go-checkout">
              {t.cart.checkout}
            </Link>
          )}
        </Summary>
      </div>
    </div>
  );
}
