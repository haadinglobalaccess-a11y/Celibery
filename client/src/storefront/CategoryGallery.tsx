import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { ArtFrame } from '../components/ArtFrame';
import { Icon } from '../components/Icon';
import { Price } from '../components/ui';
import { useI18n } from '../i18n/I18n';
import { L } from '../lib/format';
import { useApi } from '../lib/hooks';
import { srcSetFor } from '../lib/media';
import { prefersReducedMotion } from '../lib/motion';
import type { Category, ProductCardData } from '../lib/types';
import { useCart } from '../state/cart';
import { flyToCart } from '../three-d/flyToCart';
import { storeCopy } from './copy';

/** Up to seven thumbnails — one per real product in the category, never repeated or invented. */
export const GALLERY_SIZE = 7;
const EASE = 'cubic-bezier(0.16, 0.84, 0.24, 1)';
const STAGE_SIZES = '(max-width: 959px) 92vw, 40vw';

/**
 * Category gallery (Car Essentials, Tech Essentials): one large stage + up to seven product thumbnails.
 *
 * Every thumbnail is a distinct product of the category (from the existing `/api/products`
 * listing), so the stage, the information beside it and the purchase action always refer to one and
 * the same product. Choosing a thumbnail only changes the selection: the chosen artwork slides from
 * its thumbnail into the stage and settles with a short, gentle float (FLIP, Web Animations API —
 * transform/opacity only), while the previous artwork fades back. Activating the stage is the
 * purchase action: the existing cart `add` for the product on display (availability respected),
 * with the existing fly-to-cart feedback.
 */
export function CategoryGallery({ cat, initial, size = GALLERY_SIZE }: { cat: Category; initial: ProductCardData[]; size?: number }) {
  const { lang, p, t } = useI18n();
  const c = storeCopy(lang);
  const cart = useCart();
  const hintId = useId();
  // The home payload carries the first four; the category listing completes the set (same endpoint as Shop).
  const { data: more } = useApi<ProductCardData[]>(`/api/products?category=${encodeURIComponent(cat.slug)}&limit=${size}&lang=${lang}`);
  const items = useMemo(() => {
    const seen = new Set<string>();
    return [...initial, ...(more ?? [])].filter((x) => !seen.has(x._id) && seen.add(x._id)).slice(0, size);
  }, [initial, more, size]);

  const [active, setActive] = useState(0);
  const [leaving, setLeaving] = useState<number | null>(null);
  const [touched, setTouched] = useState(false);
  const [added, setAdded] = useState(false);
  const stageRef = useRef<HTMLSpanElement | null>(null);
  const thumbs = useRef<(HTMLButtonElement | null)[]>([]);
  const from = useRef<DOMRect | null>(null);
  const warmed = useRef(new Set<string>());

  useEffect(() => {
    if (!added) return;
    const id = setTimeout(() => setAdded(false), 1400);
    return () => clearTimeout(id);
  }, [added]);

  // Slide + floating entrance: the incoming artwork starts at its thumbnail, glides into the stage,
  // rises a few pixels and settles. Reduced motion: a short cross-fade in place.
  useLayoutEffect(() => {
    const stage = stageRef.current;
    const rect = from.current;
    from.current = null;
    if (!stage || leaving === null) return;
    const incoming = stage.querySelector<HTMLElement>('[data-layer="in"]');
    const outgoing = stage.querySelector<HTMLElement>('[data-layer="out"]');
    if (!incoming) {
      setLeaving(null);
      return;
    }
    let enter: Animation;
    if (prefersReducedMotion() || !rect) {
      enter = incoming.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: 'ease-out' });
      outgoing?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220, easing: 'ease-out', fill: 'forwards' });
    } else {
      const box = stage.getBoundingClientRect();
      const s = rect.width / box.width;
      const dx = rect.left + rect.width / 2 - (box.left + box.width / 2);
      const dy = rect.top + rect.height / 2 - (box.top + box.height / 2);
      enter = incoming.animate(
        [
          { transform: `translate(${dx}px, ${dy}px) scale(${s})`, opacity: 0.4, offset: 0 },
          { transform: 'translate(0, -8px) scale(1.008)', opacity: 1, offset: 0.72 },
          { transform: 'none', opacity: 1, offset: 1 },
        ],
        { duration: 760, easing: EASE },
      );
      outgoing?.animate(
        [
          { opacity: 1, transform: 'none' },
          { opacity: 0, transform: 'translate(0, 10px) scale(0.97)' },
        ],
        { duration: 420, easing: EASE, fill: 'forwards' },
      );
    }
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      setLeaving(null);
    };
    enter.finished.then(finish, finish);
    return () => enter.cancel();
  }, [active, leaving]);

  if (!items.length) return null;
  const current = items[Math.min(active, items.length - 1)];
  const name = L(current.name, lang);
  const desc = L(current.shortDescription, lang);

  /** Fetch the stage-size artwork when a thumbnail is about to be chosen (hover/focus) — never all at once. */
  const warm = (pr: ProductCardData) => {
    const im = pr.images?.[0];
    if (!im?.url || warmed.current.has(pr._id)) return;
    warmed.current.add(pr._id);
    const img = new Image();
    const srcset = srcSetFor(im);
    if (srcset) {
      img.sizes = STAGE_SIZES;
      img.srcset = srcset;
    }
    img.src = im.url;
  };

  const select = (i: number) => {
    if (i === active) return;
    from.current = thumbs.current[i]?.getBoundingClientRect() ?? null;
    setLeaving(active);
    setActive(i);
    setTouched(true);
    setAdded(false);
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const rtl = getComputedStyle(e.currentTarget).direction === 'rtl';
    const step = e.key === 'ArrowRight' ? (rtl ? -1 : 1) : e.key === 'ArrowLeft' ? (rtl ? 1 : -1) : 0;
    const to = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : step ? (active + step + items.length) % items.length : -1;
    if (to < 0) return;
    e.preventDefault();
    select(to);
    thumbs.current[to]?.focus();
  };

  const buy = () => {
    if (!current.available) return;
    cart.add(current, 1);
    setAdded(true);
    const img = stageRef.current?.querySelector('[data-layer="in"] img:not(.cx-art__fill)');
    requestAnimationFrame(() => setTimeout(() => flyToCart(img), 0));
  };

  const layer = (pr: ProductCardData, role: 'in' | 'out') => (
    <span key={pr._id} className="cx-gal__layer" data-layer={role}>
      {/* After the first selection the stage is on screen, so the chosen artwork loads immediately. */}
      <ArtFrame src={pr.images?.[0]?.url} image={pr.images?.[0]} category={cat.slug} sizes={STAGE_SIZES} eager={touched} />
    </span>
  );

  return (
    <div className="cx-gal">
      <div className="cx-gal__main">
        <button
          type="button"
          className={`cx-gal__stage ${added ? 'is-added' : ''}`}
          onClick={buy}
          disabled={!current.available}
          aria-label={current.available ? `${t.product.addToCart}: ${name}` : `${name} — ${t.product.outOfStock}`}
          aria-describedby={hintId}
        >
          <span ref={stageRef} className="cx-gal__frame">
            {leaving !== null && items[leaving] ? layer(items[leaving], 'out') : null}
            {layer(current, 'in')}
          </span>
          <span className="cx-gal__cta" aria-hidden="true">
            <Icon name={added ? 'check' : 'plus'} />
            {added ? t.product.added : current.available ? t.product.addToCart : t.product.outOfStock}
          </span>
        </button>
        {/* Keyed by product: the information re-enters with the artwork and always describes it. */}
        <div key={current._id} className="cx-gal__info" aria-live="polite">
          <div className="cx-gal__name">
            {current.model ? <span className="ltr">{current.model}</span> : null}
            <strong>{name}</strong>
          </div>
          {desc ? <p className="cx-gal__desc">{desc}</p> : null}
          <Price price={current.price} compareAt={current.compareAtPrice} className="cx-gal__price" />
          <Link className="cx-link" to={p(`/p/${current.slug}`)}>
            {c.viewDetails} <span className="cx-arrow" aria-hidden="true">→</span>
          </Link>
        </div>
        <p id={hintId} className="sr-only">
          {c.galleryTapToAdd}
        </p>
      </div>
      {items.length > 1 ? (
        <div
          className="cx-gal__thumbs"
          role="group"
          aria-label={L(cat.name, lang)}
          onKeyDown={onKey}
          style={{ '--cols': items.length <= 4 ? items.length : Math.ceil(items.length / 2) } as CSSProperties}
        >
          {items.map((pr, i) => (
            <button
              key={pr._id}
              ref={(el) => {
                thumbs.current[i] = el;
              }}
              type="button"
              className="cx-gal__thumb"
              aria-pressed={i === active}
              aria-label={c.galleryShow(L(pr.name, lang))}
              tabIndex={i === active ? 0 : -1}
              onClick={() => select(i)}
              onPointerEnter={() => warm(pr)}
              onFocus={() => warm(pr)}
            >
              <ArtFrame src={pr.images?.[0]?.url} image={pr.images?.[0]} category={cat.slug} sizes="(max-width: 639px) 120px, 220px" />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
