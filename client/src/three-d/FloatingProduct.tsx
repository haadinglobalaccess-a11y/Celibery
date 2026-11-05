import type { CSSProperties } from 'react';
import { ProductImage } from '../components/ProductCard';
import type { Image } from '../lib/types';
import { TILE_COLS, TILE_ROWS } from './heroIntro';

/** Deterministic pseudo-random in -1..1 (stable across renders, no Math.random in render). */
const rnd = (i: number, k: number) => {
  const x = Math.sin(i * 127.1 + k * 311.7) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
};

/**
 * A real catalogue photo presented as a physical object: a rounded slab with visible thickness
 * (stacked CSS 3D layers), a moving light glare and a reflection. It is honest about what it is —
 * a photo on a dimensional tile, not a fake 3D model. Size comes from the `--ph` custom property
 * (product height in px) set by the parent stage; orientation comes from the parent's transform.
 *
 * With `intro`, it also renders the parts used by the hero's opening sequence: the photo cut into
 * components (same image, cropped — nothing invented) for the exploded view, a wireframe overlay,
 * a rebuild scan line and a final glint. Their motion is driven by CSS variables set per frame.
 */
export function FloatingProduct({
  image,
  alt,
  category,
  active = true,
  eager = false,
  index = 0,
  intro = false,
}: {
  image?: Image | null;
  alt: string;
  category?: string;
  active?: boolean;
  eager?: boolean;
  index?: number;
  intro?: boolean;
}) {
  return (
    <div className="fp" data-active={active} aria-hidden={!active} style={{ '--fp-i': index } as CSSProperties}>
      <div className="fp__body">
        <span className="fp__edge" style={{ '--z': 1 } as CSSProperties} />
        <span className="fp__edge" style={{ '--z': 2 } as CSSProperties} />
        <span className="fp__edge" style={{ '--z': 3 } as CSSProperties} />
        <div className="fp__face">
          <ProductImage src={image?.url} image={image} alt={alt} category={category} eager={eager} sizes="(max-width: 959px) 60vw, 30vw" />
          <span className="fp__glare" />
          {intro ? <span className="fp__scan" aria-hidden="true" /> : null}
        </div>
        {intro ? (
          <>
            <div className="fp__tiles" aria-hidden="true">
              {Array.from({ length: TILE_COLS * TILE_ROWS }, (_, i) => {
                const c = i % TILE_COLS;
                const r = Math.floor(i / TILE_COLS);
                // Components fly outward from the centre, with their own spin and depth
                const cx = c - (TILE_COLS - 1) / 2;
                const cy = r - (TILE_ROWS - 1) / 2;
                const style = {
                  '--c': c,
                  '--r': r,
                  '--dx': (cx * 30 + rnd(i, 1) * 7).toFixed(1),
                  '--dy': (cy * 20 + rnd(i, 2) * 8).toFixed(1),
                  '--dz': (18 + rnd(i, 3) * 26).toFixed(1),
                  '--ax': (rnd(i, 4) * 50).toFixed(1),
                  '--ay': (rnd(i, 5) * 60).toFixed(1),
                  '--az': (rnd(i, 6) * 25).toFixed(1),
                } as CSSProperties;
                return (
                  <span key={i} className="fp__tile" style={style}>
                    <span className="fp__tile-img">
                      <ProductImage src={image?.url} image={image} alt="" category={category} sizes="(max-width: 959px) 60vw, 30vw" />
                    </span>
                  </span>
                );
              })}
            </div>
            <span className="fp__wire" aria-hidden="true" />
            <span className="fp__glint" aria-hidden="true" />
          </>
        ) : null}
      </div>
      <div className="fp__reflection" aria-hidden="true">
        <ProductImage src={image?.url} image={image} alt="" category={category} sizes="(max-width: 959px) 60vw, 30vw" />
      </div>
    </div>
  );
}
