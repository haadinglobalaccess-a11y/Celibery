import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '../i18n/I18n';
import { L, placeholderFor } from '../lib/format';
import { srcSetFor } from '../lib/media';
import type { Image, ProductCardData } from '../lib/types';
import { useCart } from '../state/cart';
import { useWishlist } from '../state/wishlist';
import { flyToCart } from '../three-d/flyToCart';
import { useTilt } from '../three-d/TiltCard';
import { Icon } from './Icon';
import { Price } from './ui';
import { useProductMotion } from '../lib/productMotion';

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
      width={500}
      height={500}
      onError={(e) => {
        const img = e.currentTarget;
        if (!img.src.endsWith(fallback)) img.src = fallback; // never show a broken image
      }}
    />
  );
}

export function ProductCard({ product, categorySlug, index }: { product: ProductCardData; categorySlug?: string; index?: number }) {
  const { lang, t, p } = useI18n();
  const cart = useCart();
  const [justAdded, setJustAdded] = useState(false);
  useEffect(() => {
    if (!justAdded) return;
    const id = setTimeout(() => setJustAdded(false), 1400);
    return () => clearTimeout(id);
  }, [justAdded]);
  const wish = useWishlist();
  // 3D: the photo panel tilts toward the pointer (mouse) or the finger press (touch). The listener
  // sits on the whole card because the title link is stretched over it (whole card clickable).
  const cardRef = useRef<HTMLElement | null>(null);
  useProductMotion(cardRef);
  useTilt(cardRef, { max: 8 });
  const name = L(product.name, lang);
  const inWish = wish.has(product._id);
  const cat = categorySlug ?? (typeof product.category === 'object' ? product.category?.slug : undefined);

  return (
    <article ref={cardRef} className="card card--3d tilt" data-testid="product-card" style={index !== undefined ? ({ '--i': index } as CSSProperties) : undefined}>
      <div className="card__media">
        <ProductImage src={product.images?.[0]?.url} image={product.images?.[0]} alt={L(product.images?.[0]?.alt, lang) || name} category={cat} />
        {product.images?.[1]?.url ? (
          <span className="card__alt" aria-hidden="true">
            <ProductImage src={product.images[1].url} image={product.images[1]} alt="" category={cat} />
          </span>
        ) : null}
        <span className="card__shine" aria-hidden="true" />
        <span className="tilt__glare" aria-hidden="true" />
        <div className="card__badges">
          {product.discountPercent > 0 ? <span className="badge badge--accent">-{product.discountPercent}%</span> : null}
          {!product.available ? <span className="badge badge--dark">{t.product.outOfStock}</span> : product.lowStock ? <span className="badge badge--warning">{t.product.lowStock}</span> : null}
          {product.dataSource === 'demo' ? <span className="badge badge--sample">{t.product.sample}</span> : null}
        </div>
        <button
          type="button"
          className="icon-btn card__wish"
          aria-pressed={inWish}
          aria-label={inWish ? t.product.removeWishlist : t.product.addWishlist}
          onClick={() => void wish.toggle(product._id)}
          style={{ zIndex: 2 }}
        >
          <Icon name="heart" />
        </button>
      </div>
      <div className="card__body">
        {product.model || product.series ? (
          <span className="card__model">
            {product.series ? <span className="card__series">{product.series}</span> : null}
            {product.model ? <span className="ltr">{product.model}</span> : null}
          </span>
        ) : null}
        <h3 className="card__title">
          <Link to={p(`/p/${product.slug}`)}>{name}</Link>
        </h3>
      </div>
      <div className="card__foot">
        <Price price={product.price} compareAt={product.compareAtPrice} />
        <button
          type="button"
          className={`card__add ${justAdded ? 'is-added' : ''}`}
          disabled={!product.available}
          aria-label={`${t.product.addToCart}: ${name}`}
          onClick={() => {
            cart.add(product, 1);
            setJustAdded(true);
            flyToCart(cardRef.current?.querySelector('.card__media'));
          }}
        >
          <Icon name={justAdded ? 'check' : 'plus'} />
        </button>
      </div>
    </article>
  );
}

export function ProductGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid--4" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i}>
          <div className="skeleton" style={{ aspectRatio: '1' }} />
          <div className="skeleton" style={{ height: 14, marginTop: 12, width: '80%' }} />
          <div className="skeleton" style={{ height: 14, marginTop: 8, width: '40%' }} />
        </div>
      ))}
    </div>
  );
}
