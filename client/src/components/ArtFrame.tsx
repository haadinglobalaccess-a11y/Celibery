import { useCallback, useState } from 'react';
import { placeholderFor } from '../lib/format';
import { srcSetFor } from '../lib/media';
import type { Image } from '../lib/types';

/**
 * Product photo with a branded placeholder fallback. Uploaded images carry responsive WebP variants
 * (`image.variants`), served through srcset; plain URL images are used as they are.
 */
export function ProductImage({
  src,
  alt,
  category,
  eager = false,
  image,
  sizes,
  onLoad,
}: {
  src?: string;
  alt: string;
  category?: string;
  eager?: boolean;
  image?: Image | null;
  sizes?: string;
  onLoad?: (img: HTMLImageElement) => void;
}) {
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
      onLoad={onLoad ? (e) => onLoad(e.currentTarget) : undefined}
      onError={(e) => {
        const img = e.currentTarget;
        if (!img.src.endsWith(fallback)) img.src = fallback; // never show a broken image
      }}
    />
  );
}


/**
 * Artwork shape, measured from the image itself. CELIBERY product media is mostly full-bleed
 * campaign artwork in three proportions (square 1:1, landscape 3:2, portrait ~11:12), and records do
 * not always store dimensions — so the real shape is read once the image loads.
 */
export type ArtShape = 'square' | 'landscape' | 'portrait';
export const shapeOf = (w: number, h: number): ArtShape => {
  const r = w / h;
  return r > 1.12 ? 'landscape' : r < 0.94 ? 'portrait' : 'square';
};

/**
 * ArtFrame — the one presentation primitive for storefront product imagery.
 *
 * - `fit="frame"` (default): the frame keeps the proportion its layout gives it (`--art-ratio`), so
 *   equivalent cards stay identical. The artwork is always shown complete (`object-fit: contain`);
 *   when its shape differs from the frame, a blurred, dimmed copy of the same artwork fills the
 *   margins so the frame reads as one composed image — nothing is cropped or stretched.
 * - `fit="natural"`: the frame takes the artwork's own proportion (showcase heroes), so there is no
 *   empty margin at all.
 *
 * `data-shape` (artwork proportion) and `data-kind` (`art` for full-bleed artwork, `cutout` for the
 * branded placeholder drawings) are exposed for CSS so layouts can adapt without re-rendering parents.
 */
export function ArtFrame({
  src,
  image,
  alt = '',
  category,
  sizes,
  eager,
  fit = 'frame',
  className = '',
}: {
  src?: string;
  image?: Image | null;
  alt?: string;
  category?: string;
  sizes?: string;
  eager?: boolean;
  fit?: 'frame' | 'natural';
  className?: string;
}) {
  const known = image?.width && image?.height && image.url === src ? shapeOf(image.width, image.height) : undefined;
  const [shape, setShape] = useState<ArtShape | undefined>(known);
  const [kind, setKind] = useState<'art' | 'cutout'>(src ? 'art' : 'cutout');
  const [fill, setFill] = useState('');
  const onLoad = useCallback(
    (img: HTMLImageElement) => {
      const cutout = /\.svg($|\?)/i.test(img.currentSrc || img.src);
      setKind(cutout ? 'cutout' : 'art');
      if (img.naturalWidth && img.naturalHeight) setShape(shapeOf(img.naturalWidth, img.naturalHeight));
      // The backdrop reuses the exact file the browser already chose — no extra download.
      if (fit === 'frame' && !cutout) setFill(img.currentSrc || img.src);
    },
    [fit],
  );
  return (
    <span className={`cx-art cx-art--${fit} ${className}`} data-shape={shape} data-kind={kind}>
      {fill && shape !== 'square' ? <img className="cx-art__fill" src={fill} alt="" aria-hidden="true" decoding="async" /> : null}
      <ProductImage src={src} image={image} alt={alt} category={category} sizes={sizes} eager={eager} onLoad={onLoad} />
    </span>
  );
}
