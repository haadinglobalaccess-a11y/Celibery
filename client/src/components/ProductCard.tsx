import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '../i18n/I18n';
import { L, placeholderFor } from '../lib/format';
import { srcSetFor, useMediaQuery } from '../lib/media';
import type { Image, ProductCardData } from '../lib/types';
import { useCart } from '../state/cart';
import { useWishlist } from '../state/wishlist';
import { flyToCart } from '../three-d/flyToCart';
import { Icon } from './Icon';
import { Price } from './ui';

/**
 * Product photo with a branded placeholder fallback. Uploaded images carry responsive WebP variants
 * (`image.variants`), served through srcset; plain URL images are used as they are.
 */
export function ProductImage({ src, alt, category, eager = false, image, sizes }: { src?: string; alt: string; category?: string; eager?: boolean; image?: Image | null; sizes?: string }) {
  const fallback = placeholderFor(category);
  const srcSet = image && image.url === src ? srcSetFor(image) : undefined;
  return (
    <img
      src={src || fallback}
      srcSet={srcSet}
      sizes={srcSet ? (sizes ?? '(max-width: 639px) 50vw, (max-width: 1023px) 33vw, 25vw') : undefined}
      alt={alt}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      // Real intrinsic size when the upload recorded it, so the browser reserves the right box.
      width={image?.width || 500}
      height={image?.height || 500}
      onError={(e) => {
        const img = e.currentTarget;
        if (!img.src.endsWith(fallback)) img.src = fallback; // never show a broken image
      }}
    />
  );
}

/**
 * CELIBERY product card — the product sits on a lit stage, information below in a strict hierarchy
 * (series/model · name · price). `tone="dark"` is used inside dark campaign sections.
 */
export function ProductCard({ product, categorySlug, index, tone = 'light', sizes, eager = false }: { product: ProductCardData; categorySlug?: string; index?: number; tone?: 'light' | 'dark'; sizes?: string; eager?: boolean }) {
  const { lang, t, p } = useI18n();
  const cart = useCart();
  const wish = useWishlist();
  const [justAdded, setJustAdded] = useState(false);
  const mediaRef = useRef<HTMLAnchorElement | null>(null);
  useEffect(() => {
    if (!justAdded) return;
    const id = setTimeout(() => setJustAdded(false), 1400);
    return () => clearTimeout(id);
  }, [justAdded]);

  const name = L(product.name, lang);
  const inWish = wish.has(product._id);
  const cat = categorySlug ?? (typeof product.category === 'object' ? product.category?.slug : undefined);
  const href = p(`/p/${product.slug}`);
  // The hover image is only fetched where hover exists (desktop pointers) — never on touch devices.
  const canHover = useMediaQuery('(hover: hover) and (pointer: fine)');
  const alt = canHover && product.images?.[1]?.url ? product.images[1] : null;

  return (
    <article className={`cx-card ${tone === 'dark' ? 'cx-card--dark' : ''}`} data-testid="product-card" style={index !== undefined ? ({ '--i': index } as CSSProperties) : undefined}>
      <Link ref={mediaRef} to={href} className={`cx-card__media ${alt ? 'has-alt' : ''}`} tabIndex={-1} aria-hidden="true">
        <span className="cx-card__img">
          <ProductImage src={product.images?.[0]?.url} image={product.images?.[0]} alt="" category={cat} sizes={sizes} eager={eager} />
        </span>
        {alt ? (
          <span className="cx-card__img cx-card__img--alt">
            <ProductImage src={alt.url} image={alt} alt="" category={cat} sizes={sizes} />
          </span>
        ) : null}
      </Link>

      <div className="cx-card__badges">
        {product.discountPercent > 0 ? <span className="cx-tag cx-tag--accent">-{product.discountPercent}%</span> : null}
        {!product.available ? <span className="cx-tag cx-tag--ink">{t.product.outOfStock}</span> : product.lowStock ? <span className="cx-tag cx-tag--warn">{t.product.lowStock}</span> : null}
        {product.dataSource === 'demo' ? <span className="cx-tag cx-tag--sample">{t.product.sample}</span> : null}
      </div>

      <button type="button" className="cx-card__wish" aria-pressed={inWish} aria-label={inWish ? t.product.removeWishlist : t.product.addWishlist} onClick={() => void wish.toggle(product._id)}>
        <Icon name="heart" />
      </button>

      <div className="cx-card__body">
        {product.series || product.model ? (
          <span className="cx-card__meta">
            {product.series ? <span>{product.series}</span> : null}
            {product.model ? <span className="ltr">{product.model}</span> : null}
          </span>
        ) : null}
        <h3 className="cx-card__title">
          <Link to={href}>{name}</Link>
        </h3>
        <div className="cx-card__foot">
          <Price price={product.price} compareAt={product.compareAtPrice} />
          <button
            type="button"
            className={`cx-card__add ${justAdded ? 'is-added' : ''}`}
            disabled={!product.available}
            aria-label={`${t.product.addToCart}: ${name}`}
            onClick={() => {
              cart.add(product, 1);
              setJustAdded(true);
              // Let the tap paint first (badge, peek), then start the flight — keeps the interaction fast.
              const media = mediaRef.current;
              requestAnimationFrame(() => setTimeout(() => flyToCart(media), 0));
            }}
          >
            <Icon name={justAdded ? 'check' : 'plus'} />
          </button>
        </div>
      </div>
    </article>
  );
}

export function ProductGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="cx-grid" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i}>
          <div className="skeleton" style={{ aspectRatio: '4 / 5', borderRadius: 24 }} />
          <div className="skeleton" style={{ height: 14, marginTop: 14, width: '80%' }} />
          <div className="skeleton" style={{ height: 14, marginTop: 8, width: '40%' }} />
        </div>
      ))}
    </div>
  );
}
