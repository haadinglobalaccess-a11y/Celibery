import { useEffect, useId, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '../i18n/I18n';
import { L } from '../lib/format';
import type { ProductCardData } from '../lib/types';
import { ProductImage } from './ProductCard';
import { Price } from './ui';
import '../styles/automaticShowcase.css';

export function AutomaticProductShowcase({ products }: { products: ProductCardData[] }) {
  const { lang, p } = useI18n();
  const titleId = useId();
  const root = useRef<HTMLElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const items = useMemo(() => Array.from(new Map(products.map(item => [item._id, item])).values()).slice(0, 5), [products]);

  useEffect(() => {
    const section = root.current;
    const window = viewport.current;
    if (!section || !window) return;
    let visible = false;
    const sync = () => section.classList.toggle('is-running', visible && !document.hidden);
    const presence = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; sync(); });
    const entrance = new IntersectionObserver(entries => {
      entries.forEach(entry => entry.target.classList.toggle('is-in-view', entry.isIntersecting));
    }, { root: window, threshold: .15 });
    presence.observe(section);
    section.querySelectorAll('.auto-showcase__slide').forEach(slide => entrance.observe(slide));
    document.addEventListener('visibilitychange', sync);
    return () => { presence.disconnect(); entrance.disconnect(); document.removeEventListener('visibilitychange', sync); };
  }, [items]);

  if (!items.length) return null;
  return <section ref={root} className="auto-showcase section" aria-labelledby={titleId}>
    <header className="container section__head">
      <div>
        <span className="eyebrow eyebrow--line">{lang === 'ar' ? 'اكتشف المجموعة' : 'DISCOVER THE COLLECTION'}</span>
        <h2 id={titleId}>{lang === 'ar' ? 'تجربة متواصلة' : 'A continuous discovery'}</h2>
      </div>
    </header>
    <div ref={viewport} className="auto-showcase__viewport" dir="ltr" onPointerDown={() => root.current?.classList.add('is-touching')} onPointerUp={() => root.current?.classList.remove('is-touching')} onPointerCancel={() => root.current?.classList.remove('is-touching')} onPointerLeave={() => root.current?.classList.remove('is-touching')}>
      <div className="auto-showcase__track">
        {[0, 1].map(copy => <div className="auto-showcase__group" key={copy} aria-hidden={copy === 1 ? true : undefined}>
          {items.map(item => <article className="auto-showcase__slide" key={item._id} dir={lang === 'ar' ? 'rtl' : 'ltr'}>
            <div className="auto-showcase__image">
              <ProductImage eager src={item.images[0]?.url} image={item.images[0]} alt={copy ? '' : L(item.images[0]?.alt, lang) || L(item.name, lang)} category={typeof item.category === 'object' ? item.category.slug : undefined} sizes="(max-width: 639px) 85vw, 50vw" />
            </div>
            <div className="auto-showcase__copy">
              <h3>{L(item.name, lang)}</h3>
              {L(item.shortDescription, lang) ? <p className="muted">{L(item.shortDescription, lang)}</p> : null}
              <Price price={item.price} compareAt={item.compareAtPrice} />
              <Link className="btn btn--primary" to={p(`/p/${item.slug}`)} tabIndex={copy ? -1 : 0}>{lang === 'ar' ? 'عرض المنتج' : 'View Product'} <span aria-hidden="true">{lang === 'ar' ? '←' : '→'}</span></Link>
            </div>
          </article>)}
        </div>)}
      </div>
    </div>
  </section>;
}
