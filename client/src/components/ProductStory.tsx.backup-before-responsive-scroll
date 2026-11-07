import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '../i18n/I18n';
import { L } from '../lib/format';
import { useMediaQuery } from '../lib/media';
import type { ProductCardData } from '../lib/types';
import { ProductImage } from './ProductCard';
import { Price } from './ui';
import '../styles/productStory.css';

/** A separate editorial journey; existing product cards and HoloSphere stay independent. */
export function ProductStory({ products }: { products: ProductCardData[] }) {
  const { lang, p } = useI18n();
  const titleId = useId();
  const trackId = useId();
  const items = useMemo(() => Array.from(new Map(products.map(item => [item._id, item])).values()).slice(0, 5), [products]);
  const root = useRef<HTMLElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const desktop = useMediaQuery('(min-width: 960px) and (min-height: 600px)');
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  const pinned = desktop && !reduced && items.length > 1;
  const count = items.length;

  useEffect(() => {
    const section = root.current;
    if (!section) return;
    const observer = new IntersectionObserver(([entry]) => {
      section.classList.toggle('is-ready', entry.isIntersecting);
    }, { threshold: 0 });
    observer.observe(section);
    return () => observer.disconnect();
  }, [count]);

  useEffect(() => {
    const section = root.current;
    const scene = panel.current;
    const rail = track.current;
    if (!section || !scene || !rail) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      if (pinned) {
        const top = parseFloat(getComputedStyle(scene).top) || 0;
        const distance = Math.max(1, section.offsetHeight - scene.offsetHeight);
        const progress = Math.min(1, Math.max(0, (top - section.getBoundingClientRect().top) / distance));
        rail.style.transform = `translate3d(${-progress * (count - 1) * rail.clientWidth}px,0,0)`;
        section.style.setProperty('--story-progress', String(progress));
        setActive(Math.round(progress * (count - 1)));
      } else {
        rail.style.removeProperty('transform');
        const index = Math.round(rail.scrollLeft / Math.max(1, rail.clientWidth));
        setActive(Math.max(0, Math.min(count - 1, index)));
        section.style.setProperty('--story-progress', String(index / Math.max(1, count - 1)));
      }
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    const resize = new ResizeObserver(schedule);
    resize.observe(scene);
    if (pinned) window.addEventListener('scroll', schedule, { passive: true });
    else rail.addEventListener('scroll', schedule, { passive: true });
    update();
    return () => {
      window.removeEventListener('scroll', schedule);
      rail.removeEventListener('scroll', schedule);
      resize.disconnect();
      cancelAnimationFrame(frame);
      rail.style.removeProperty('transform');
    };
  }, [pinned, count]);

  const go = (index: number) => {
    const section = root.current;
    const scene = panel.current;
    const rail = track.current;
    if (!section || !scene || !rail) return;
    if (pinned) {
      const top = parseFloat(getComputedStyle(scene).top) || 0;
      window.scrollTo({ top: section.getBoundingClientRect().top + window.scrollY - top + index / Math.max(1, count - 1) * (section.offsetHeight - scene.offsetHeight), behavior: 'smooth' });
    } else rail.scrollTo({ left: index * rail.clientWidth, behavior: reduced ? 'instant' : 'smooth' });
  };

  if (!count) return null;
  return <section ref={root} className={`product-story ${pinned ? 'product-story--pinned' : ''}`} aria-labelledby={titleId} data-active-index={active} style={{ '--story-count': count } as CSSProperties}>
    <div ref={panel} className="product-story__panel">
      <div className="container product-story__inside">
        <header className="product-story__intro">
          <div>
            <span className="eyebrow eyebrow--line">{lang === 'ar' ? 'اكتشف المجموعة' : 'DISCOVER THE COLLECTION'}</span>
            <h2 id={titleId}>{lang === 'ar' ? 'اكتشف المجموعة' : 'Discover the Collection'}</h2>
            <p className="muted">{lang === 'ar' ? 'تمريرة واحدة. تجربة جديدة.' : 'One Scroll. A New Experience.'}</p>
          </div>
          <span className="product-story__hint" aria-hidden="true">{pinned ? '↓' : '↔'} <span>{lang === 'ar' ? (pinned ? 'مرّر للاستكشاف' : 'اسحب للاستكشاف') : (pinned ? 'Scroll to explore' : 'Swipe to explore')}</span></span>
        </header>
        <div className="product-story__window" dir="ltr">
          <div ref={track} id={trackId} className="product-story__track" aria-label={lang === 'ar' ? 'رحلة المنتجات' : 'Product journey'}>
            {items.map((item, index) => <article key={item._id} className="product-story__slide" data-active={active === index} aria-label={`${index + 1} / ${count}`} dir={lang === 'ar' ? 'rtl' : 'ltr'}>
              <div className="product-story__image">
                <span className="product-story__halo" aria-hidden="true" />
                <ProductImage eager src={item.images[0]?.url} image={item.images[0]} alt={L(item.images[0]?.alt, lang) || L(item.name, lang)} category={typeof item.category === 'object' ? item.category.slug : undefined} sizes="(min-width: 960px) 50vw, 90vw" />
              </div>
              <div className="product-story__copy">
                <span className="product-story__number" aria-hidden="true">{String(index + 1).padStart(2, '0')} <span>/ {String(count).padStart(2, '0')}</span></span>
                <h3>{L(item.name, lang)}</h3>
                {L(item.shortDescription, lang) ? <p className="muted">{L(item.shortDescription, lang)}</p> : null}
                <Price price={item.price} compareAt={item.compareAtPrice} />
                <Link className="btn btn--primary" to={p(`/p/${item.slug}`)} tabIndex={pinned && active !== index ? -1 : 0}>{lang === 'ar' ? 'عرض المنتج' : 'View Product'} <span aria-hidden="true">{lang === 'ar' ? '←' : '→'}</span></Link>
              </div>
            </article>)}
          </div>
        </div>
        <div className="product-story__controls" dir="ltr">
          <span className="product-story__position" aria-live="polite" aria-atomic="true">{String(active + 1).padStart(2, '0')} / {String(count).padStart(2, '0')}</span>
          <div className="product-story__steps" aria-label={lang === 'ar' ? 'اختر منتجًا' : 'Choose a product'}>
            {items.map((item, index) => <button key={item._id} type="button" aria-label={L(item.name, lang)} aria-current={active === index ? 'step' : undefined} aria-controls={trackId} onClick={() => go(index)}><span /></button>)}
          </div>
          <div className="product-story__arrows">
            <button type="button" className="icon-btn" aria-label={lang === 'ar' ? 'المنتج السابق' : 'Previous product'} disabled={!active} onClick={() => go(active - 1)}>←</button>
            <button type="button" className="icon-btn" aria-label={lang === 'ar' ? 'المنتج التالي' : 'Next product'} disabled={active === count - 1} onClick={() => go(active + 1)}>→</button>
          </div>
        </div>
      </div>
    </div>
  </section>;
}
