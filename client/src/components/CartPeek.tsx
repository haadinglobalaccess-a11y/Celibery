import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useI18n } from '../i18n/I18n';
import { formatPrice, L, placeholderFor } from '../lib/format';
import { prefersReducedMotion } from '../lib/motion';
import { useCart } from '../state/cart';
import { Icon } from './Icon';

/**
 * Animated "added to cart" panel shown under the header after any add-to-cart.
 * Non-modal (no overlay), so the header and page stay usable; auto-hides after a few seconds,
 * pauses while hovered or focused, closes on Escape and on navigation.
 * The price shown is the product's listed price; the server re-quotes everything in the cart.
 */
export function CartPeek() {
  const { t, lang, p } = useI18n();
  const { peek, closePeek, count } = useCart();
  const { pathname } = useLocation();
  const [leaving, setLeaving] = useState(false);
  const hold = useRef(false);

  useEffect(() => {
    closePeek();
  }, [pathname, closePeek]);

  useEffect(() => {
    if (!peek) return;
    setLeaving(false);
    const id = setInterval(() => {
      if (!hold.current) {
        setLeaving(true);
        clearInterval(id);
      }
    }, 4500);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setLeaving(true);
    window.addEventListener('keydown', onKey);
    return () => {
      clearInterval(id);
      window.removeEventListener('keydown', onKey);
    };
  }, [peek]);

  // Without animations the exit animation never fires its end event: close directly.
  useEffect(() => {
    if (leaving && prefersReducedMotion()) closePeek();
  }, [leaving, closePeek]);

  if (!peek) return null;
  const { item, added } = peek;
  const name = L(item.snapshot.name, lang);

  return (
    <div
      key={peek.key}
      className={`cart-peek ${leaving ? 'is-leaving' : ''}`}
      role="status"
      aria-live="polite"
      onAnimationEnd={(e) => e.animationName === 'peek-out' && closePeek()}
      onMouseEnter={() => (hold.current = true)}
      onMouseLeave={() => (hold.current = false)}
      onFocus={() => (hold.current = true)}
      onBlur={() => (hold.current = false)}
      data-testid="cart-peek"
    >
      <div className="cart-peek__head">
        <span className="cart-peek__check" aria-hidden="true">
          <Icon name="check" />
        </span>
        <strong>{t.premium.addedTitle}</strong>
        <button className="icon-btn" aria-label={t.nav.close} onClick={() => setLeaving(true)}>
          <Icon name="close" />
        </button>
      </div>
      <div className="cart-peek__item">
        <img src={item.snapshot.image || placeholderFor()} alt="" width={64} height={64} />
        <div>
          <div className="cart-peek__name">{name}</div>
          <div className="muted">
            {t.premium.qty(added)} · {formatPrice(item.snapshot.price, lang)}
          </div>
        </div>
      </div>
      <p className="cart-peek__count muted">{t.premium.cartTotalItems(count)}</p>
      <div className="cart-peek__actions">
        <Link className="btn btn--outline btn--block" to={p('/cart')}>
          {t.premium.viewCart}
        </Link>
        <Link className="btn btn--primary btn--block" to={p('/checkout')}>
          {t.premium.checkout} <span className="arrow">→</span>
        </Link>
      </div>
      <span className="cart-peek__timer" aria-hidden="true" />
    </div>
  );
}
