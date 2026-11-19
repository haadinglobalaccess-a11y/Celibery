import { useMemo, useState, type CSSProperties, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ArtFrame } from '../components/ArtFrame';
import { ProductCard } from '../components/ProductCard';
import { InlineArrow } from '../components/Icon';
import { PayLogos, Price } from '../components/ui';
import { useI18n } from '../i18n/I18n';
import { post } from '../lib/api';
import { errorText } from '../lib/apiErrors';
import { L, placeholderFor } from '../lib/format';
import { useMoney } from '../state/currency';
import { BackgroundVideo, cloudinarySrcSet, responsiveImg, useMediaQuery } from '../lib/media';
import { prefersReducedMotion } from '../lib/motion';
import type { Category, HomeData, ProductCardData } from '../lib/types';
import { useSettings } from '../state/settings';
import { useToast } from '../state/toast';
import { bannerVideo, useLinkFor } from '../three-d';
import { storeCopy } from './copy';
import { Kinetic } from './motion';
import { ProductRail } from './ProductRail';

/* Responsive image hints per layout, so the browser picks the right uploaded WebP variant. */
const SIZES_RAIL = '(max-width: 639px) 74vw, (max-width: 1023px) 42vw, 25vw';
const SIZES_STRIP = '(max-width: 639px) 62vw, (max-width: 959px) 46vw, 25vw';

const catSlug = (pr: ProductCardData) => (typeof pr.category === 'object' ? pr.category?.slug : undefined);
const itemsFor = (data: HomeData, c: Category) => data.categoryProducts.find((x) => x.categoryId === c._id)?.items ?? [];
/** Category visual: the category image from Admin, else its first product photo, else the branded placeholder. */
const visualFor = (data: HomeData, c: Category) => {
  if (c.image?.url) return { url: c.image.url, image: c.image };
  const pr = itemsFor(data, c).find((x) => x.images?.[0]?.url);
  return pr ? { url: pr.images[0].url, image: pr.images[0] } : { url: placeholderFor(c.slug), image: null };
};

function Arrow() {
  return (
    <span className="cx-arrow" aria-hidden="true">
      <InlineArrow />
    </span>
  );
}

function Head({ eyebrow, title, lead, link, linkLabel, id, center = false }: { eyebrow?: string; title: string; lead?: string; link?: string; linkLabel?: string; id?: string; center?: boolean }) {
  return (
    <div className={`cx-head${center ? ' cx-head--center' : ''}`}>
      <div className="cx-head__text">
        {eyebrow ? (
          <span className="cx-eyebrow" data-fx="rise">
            {eyebrow}
          </span>
        ) : null}
        <Kinetic id={id} text={title} className="cx-display" />
        {lead ? (
          <p className="cx-lead" data-fx="rise" style={{ '--d': '280ms' } as CSSProperties}>
            {lead}
          </p>
        ) : null}
      </div>
      {link && linkLabel ? (
        <Link className="cx-link" to={link} data-fx="rise" style={{ '--d': '360ms' } as CSSProperties}>
          {linkLabel} <Arrow />
        </Link>
      ) : null}
    </div>
  );
}

/* ───────────────────────── 01 · Category lineup — one uniform row of category cards ───────────────────────── */
/** Every category on the same light card (product cut-outs need a light stage), centred heading,
 *  six across on desktop, a swipeable row on phones. Categories, images and counts come from /api/home. */
export function CategoryUniverse({ data }: { data: HomeData }) {
  const { t, lang, p } = useI18n();
  if (!data.categories.length) return null;
  return (
    <section className="cx-section cx-lineup" aria-labelledby="cx-universe-title">
      <div className="container">
        <Head id="cx-universe-title" title={t.home.categories} link={p('/shop')} linkLabel={t.nav.viewAll} center />
        <div className="cx-lineup__track">
          {data.categories.map((cat, i) => {
            const v = visualFor(data, cat);
            return (
              <Link key={cat._id} to={p(`/c/${cat.slug}`)} className="cx-lineup__card" data-testid="category-tile" data-fx="rise" style={{ '--d': `${i * 70}ms` } as CSSProperties}>
                <span className="cx-lineup__media" aria-hidden="true">
                  <ArtFrame src={v.url} image={v.image} category={cat.slug} sizes="(max-width: 639px) 80vw, (max-width: 1023px) 46vw, 420px" />
                </span>
                {/* Name, count and arrow under the artwork, as on the range tiles. */}
                <span className="cx-lineup__copy">
                  <span>
                    <strong className="cx-lineup__name">{L(cat.name, lang)}</strong>
                    {cat.productCount ? <span className="cx-lineup__count">{t.premium.productsCount(cat.productCount)}</span> : null}
                  </span>
                  <span className="cx-lineup__go cx-arrow" aria-hidden="true">
                    <InlineArrow />
                  </span>
                </span>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* ───────────────────────── 04 · Category range — bento grid ───────────────────────── */
/** One section for the whole range instead of a full chapter per category: two large tiles, then the
 *  rest in a row. Name, Admin description and visual are the category's own; the CTA opens its page. */

export function CategoryRange({ data }: { data: HomeData }) {
  const { lang, p } = useI18n();
  const c = storeCopy(lang);
  const cats = data.categories.filter((cat) => itemsFor(data, cat).length || cat.image?.url);
  if (!cats.length) return null;
  const rest = Math.max(0, cats.length - 2);
  return (
    <section className="cx-section cx-range" aria-labelledby="cx-range-title">
      <div className="container">
        <Head id="cx-range-title" title={c.rangeTitle} lead={c.rangeLead} center />
        <div className="cx-range__grid" data-rest={Math.min(rest, 4)}>
          {cats.map((cat, i) => {
            const v = visualFor(data, cat);
            const name = L(cat.name, lang);
            const desc = L(cat.description, lang);
            return (
              <Link
                key={cat._id}
                to={p(`/c/${cat.slug}`)}
                className={`cx-range__tile cx-range__tile--${i < 2 ? 'lg' : 'sm'}`}
                aria-labelledby={`cx-range-${cat.slug}`}
                data-fx="rise"
                style={{ '--d': `${(i % 4) * 90}ms` } as CSSProperties}
              >
                <span className="cx-range__copy">
                  <strong id={`cx-range-${cat.slug}`} className="cx-range__name">
                    {name}
                  </strong>
                  {desc ? <span className="cx-range__desc">{desc}</span> : null}
                  <span className="cx-range__cta">
                    {c.shopNow} <Arrow />
                  </span>
                </span>
                <span className="cx-range__media" aria-hidden="true">
                  <ArtFrame src={v.url} image={v.image} category={cat.slug} sizes={i < 2 ? '(max-width: 959px) 92vw, 46vw' : '(max-width: 959px) 46vw, 23vw'} />
                </span>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* ───────────────────────── 02 · Flagship campaigns — square art frame + showroom depth ───────────────────────── */
export function FlagshipCampaigns({ data }: { data: HomeData }) {
  const { lang, p } = useI18n();
  const c = storeCopy(lang);
  // Only products the Admin selected with "Show in Flagship section", in the Admin's Flagship order.
  // Featured products and best sellers are never pulled in; with none selected the section is hidden.
  const items = useMemo(() => (data.flagship ?? []).filter((pr) => pr.images?.[0]?.url).slice(0, 3), [data]);
  if (!items.length) return null;
  return (
    <section className="cx-flagships" aria-label={c.flagshipEyebrow}>
      {items.map((pr, i) => {
        // Client-approved hybrid theme (Q1): flagships are premium sections, so every one is dark.
        const variant = 'dark';
        const name = L(pr.name, lang);
        const desc = L(pr.shortDescription, lang);
        const cat = typeof pr.category === 'object' ? pr.category : undefined;
        return (
          <article key={pr._id} className={`cx-flag cx-flag--${variant} ${i % 2 ? 'cx-flag--flip' : ''}`}>
            <div className="container cx-flag__inner">
              <div className="cx-flag__copy">
                <span className="cx-eyebrow" data-fx="rise">
                  {c.flagshipEyebrow}
                  {cat ? ` · ${L(cat.name, lang)}` : ''}
                </span>
                <Kinetic text={name} className="cx-flag__title" />
                {desc ? (
                  <p className="cx-flag__desc" data-fx="rise" style={{ '--d': '420ms' } as CSSProperties}>
                    {desc}
                  </p>
                ) : null}
                <div data-fx="rise" style={{ '--d': '520ms' } as CSSProperties}>
                  <Price price={pr.price} compareAt={pr.compareAtPrice} className="cx-flag__price" />
                  <div className="cx-actions">
                    <Link className="cx-btn cx-btn--solid" to={p(`/p/${pr.slug}`)}>
                      {c.discover} <Arrow />
                    </Link>
                    {cat ? (
                      <Link className="cx-btn cx-btn--ghost" to={p(`/c/${cat.slug}`)}>
                        {L(cat.name, lang)}
                      </Link>
                    ) : null}
                  </div>
                </div>
              </div>
              <div className="cx-flag__stage" data-fx="spotlight">
                <span className="cx-flag__floor" aria-hidden="true" />
                {pr.model ? (
                  <span className="cx-flag__model ltr" aria-hidden="true">
                    {pr.model}
                  </span>
                ) : null}
                <Link to={p(`/p/${pr.slug}`)} className="cx-flag__media" tabIndex={-1} aria-hidden="true">
                  <ArtFrame className="cx-flag__art" src={pr.images[0].url} image={pr.images[0]} category={catSlug(pr)} sizes="(max-width: 959px) 92vw, 46vw" />
                  <span className="cx-flag__sweep" aria-hidden="true" />
                </Link>
              </div>
            </div>
          </article>
        );
      })}
    </section>
  );
}

/* Admin-managed campaigns and lifestyle banners — complete artwork, never cropped. */
export function CampaignGallery({ data }: { data: HomeData }) {
  const { t, lang, p } = useI18n();
  const c = storeCopy(lang);
  const linkFor = useLinkFor();
  const isPhone = useMediaQuery('(max-width: 639px)');
  const banners = [...data.promoBanners, ...data.lifestyleBanners];
  if (!data.campaigns.length && !banners.length) return null;
  return (
    <section className="cx-section cx-campaigns" aria-labelledby="cx-campaigns-title">
      <div className="container">
        <Head id="cx-campaigns-title" eyebrow={c.campaignsEyebrow} title={t.home.campaigns} />
        <div className="cx-campaigns__grid">
          {data.campaigns.map((cp) => (
            <Link key={cp._id} to={p(`/campaign/${cp.slug}`)} className="cx-campaign" data-fx="split" style={cp.accentColor ? ({ '--cx-campaign': cp.accentColor } as CSSProperties) : undefined}>
              <picture className="cx-campaign__media">
                {cp.heroMobileImageUrl ? <source media="(max-width: 639px)" srcSet={cloudinarySrcSet(cp.heroMobileImageUrl, [480, 800, 1200]) || cp.heroMobileImageUrl} sizes="100vw" /> : null}
                <img {...responsiveImg(cp.heroImageUrl || '/placeholders/lifestyle.svg', '(max-width: 959px) 100vw, 50vw')} alt="" loading="lazy" decoding="async" />
              </picture>
              <span className="cx-campaign__body">
                <strong>{L(cp.title, lang)}</strong>
                {L(cp.description, lang) ? <span className="cx-campaign__desc">{L(cp.description, lang)}</span> : null}
                <span className="cx-link">
                  {t.home.explore} <Arrow />
                </span>
              </span>
            </Link>
          ))}
          {banners.map((b) => (
            <Link key={b._id} to={linkFor(b.link)} className={`cx-campaign ${b.theme === 'light' ? 'cx-campaign--light' : ''}`} data-fx="split">
              <span className="cx-campaign__media">
                {bannerVideo(b, isPhone) ? (
                  <BackgroundVideo className="cx-campaign__video" src={bannerVideo(b, isPhone)} poster={b.posterUrl || L(b.imageUrl, lang)} reduced={prefersReducedMotion()} />
                ) : (
                  <picture>
                    {L(b.mobileImageUrl, lang) ? <source media="(max-width: 639px)" srcSet={cloudinarySrcSet(L(b.mobileImageUrl, lang), [480, 800, 1200]) || L(b.mobileImageUrl, lang)} sizes="100vw" /> : null}
                    <img {...responsiveImg(L(b.imageUrl, lang) || '/placeholders/lifestyle.svg', '(max-width: 959px) 100vw, 50vw')} alt="" loading="lazy" decoding="async" />
                  </picture>
                )}
              </span>
              <span className="cx-campaign__body">
                <strong>{L(b.title, lang)}</strong>
                {L(b.subtitle, lang) ? <span className="cx-campaign__desc">{L(b.subtitle, lang)}</span> : null}
                {L(b.ctaLabel, lang) ? (
                  <span className="cx-link">
                    {L(b.ctaLabel, lang)} <Arrow />
                  </span>
                ) : null}
              </span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ───────────────────────── 03 · Explore the collection ───────────────────────── */
const USE_CASES = ['for-travel', 'for-work', 'for-fitness', 'for-home'];

export function ExploreCollection({ data }: { data: HomeData }) {
  const { t, lang, p } = useI18n();
  // Tabs are built only from data that exists: featured, best sellers, Admin collections, use cases.
  const tabs = useMemo(() => {
    const list: { key: string; label: string; items: ProductCardData[]; link?: string }[] = [];
    if (data.featured.length) list.push({ key: 'featured', label: t.home.featured, items: data.featured, link: p('/shop') });
    if (data.bestSellers.items.length) list.push({ key: 'best', label: t.home.bestSellers, items: data.bestSellers.items });
    for (const col of data.collections) {
      if (col.kind === 'bundles' || USE_CASES.includes(col.slug) || !col.products.length) continue;
      // The "Best sellers" tab above already falls back to this curated collection — one tab, not two.
      if (col.kind === 'best_sellers' && data.bestSellers.items.length) continue;
      list.push({ key: `col-${col.slug}`, label: L(col.title, lang), items: col.products, link: p(`/collection/${col.slug}`) });
    }
    for (const k of USE_CASES) {
      const collection = data.collections.find((x) => x.slug === k);
      if (collection?.products.length) list.push({ key: k, label: L(collection.title, lang) || t.home.useCaseNames[k] || k, items: collection.products, link: p(`/collection/${k}`) });
    }
    return list;
  }, [data, t, lang, p]);
  const [tab, setTab] = useState(tabs[0]?.key ?? '');
  const current = tabs.find((x) => x.key === tab) ?? tabs[0];

  if (!current) return null;
  const items = current.items;
  return (
    <section className="cx-section cx-collection" aria-labelledby="cx-collection-title">
      <div className="container">
        <Head id="cx-collection-title" title={t.premium.exploreTitle} link={current.link} linkLabel={current.link ? t.nav.viewAll : undefined} center />
        <div className="cx-tabs" role="tablist" aria-label={t.premium.exploreTitle} data-fx="rise">
          {tabs.map((x) => (
            <button key={x.key} type="button" role="tab" id={`cx-tab-${x.key}`} aria-selected={x.key === current.key} aria-controls="cx-collection-panel" onClick={() => setTab(x.key)}>
              {x.label}
            </button>
          ))}
        </div>
        <div key={current.key} id="cx-collection-panel" role="tabpanel" aria-labelledby={`cx-tab-${current.key}`} className="cx-collection__panel" data-fx="stagger">
          {items === undefined ? (
            <div className="cx-rail__track" aria-hidden="true">
              {Array.from({ length: 4 }, (_, i) => (
                <div key={i} className="cx-rail__item">
                  <div className="skeleton" style={{ aspectRatio: '4 / 5', borderRadius: 24 }} />
                </div>
              ))}
            </div>
          ) : items.length ? (
            <ProductRail label={current.label}>
              {items.map((pr, i) => (
                <ProductCard key={pr._id} product={pr} index={i} sizes={SIZES_RAIL} />
              ))}
            </ProductRail>
          ) : (
            <p className="cx-muted">{lang === 'ar' ? 'ستتم إضافة المنتجات قريباً.' : 'Products coming soon.'}</p>
          )}
        </div>
      </div>
    </section>
  );
}

/* ───────────────────────── 05 · Ecosystem (bundles) — circuit draw ───────────────────────── */
export function Ecosystem({ data }: { data: HomeData }) {
  const { t, lang, p } = useI18n();
  const c = storeCopy(lang);
  const bundles = data.collections.find((x) => x.kind === 'bundles');
  if (!bundles?.products.length) return null;
  const items = bundles.products.slice(0, 3);
  return (
    <section className="cx-section cx-eco is-dark" aria-labelledby="cx-eco-title">
      <span className="cx-eco__grid" aria-hidden="true" />
      <div className="container cx-eco__inner">
        <div className="cx-eco__copy">
          <span className="cx-eyebrow" data-fx="rise">
            {c.ecosystemEyebrow}
          </span>
          <Kinetic id="cx-eco-title" text={L(bundles.title, lang) || t.home.bundles} className="cx-display" />
          <p className="cx-lead" data-fx="rise" style={{ '--d': '300ms' } as CSSProperties}>
            {L(bundles.description, lang) || t.home.bundlesText}
          </p>
          <Link className="cx-btn cx-btn--light" to={p('/bundles')} data-fx="rise" style={{ '--d': '380ms' } as CSSProperties}>
            {t.nav.viewAll} <Arrow />
          </Link>
        </div>
        <div className={`cx-eco__board cx-eco__board--${items.length}`} data-fx="stagger">
          <svg className="cx-eco__wires" viewBox="0 0 600 400" preserveAspectRatio="none" aria-hidden="true" data-fx="draw">
            <path pathLength={1} d="M100 200 C 220 60, 380 60, 500 200" />
            <path pathLength={1} d="M100 200 C 220 340, 380 340, 500 200" />
            <circle cx="300" cy="200" r="6" />
          </svg>
          {items.map((pr, i) => (
            <div key={pr._id} className="cx-eco__node">
              <ProductCard product={pr} index={i} tone="dark" sizes={SIZES_STRIP} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ───────────────────────── 06 · Why CELIBERY — drawn hairlines ───────────────────────── */
export function WhyCelibery() {
  const { t, lang } = useI18n();
  const money = useMoney();
  const c = storeCopy(lang);
  const settings = useSettings();
  const commerce = settings?.commerce;
  // Every promise follows Admin → Settings: nothing is claimed that the store cannot deliver.
  const [delivery, warranty, payment, support] = t.home.why;
  const deliveryItem = !commerce || commerce.freeDelivery !== false
    ? delivery
    : {
        t: t.product.shipping,
        d: commerce.freeDeliveryThreshold
          ? t.checkout.freeFrom(money(commerce.freeDeliveryThreshold))
          : L(commerce.estimatedDelivery, lang) || (commerce.courierName ? t.product.deliveryBy(commerce.courierName) : ''),
      };
  const pay = settings?.payments;
  const methods = pay ? (['card', 'applepay', 'stcpay', 'tabby', 'cod'] as const).filter((m) => pay[m]).map((m) => t.home.payNames[m]) : [];
  const why: { key: string; t: string; d: string }[] = [
    { key: 'delivery', ...deliveryItem },
    ...(commerce?.warrantyEnabled && commerce.warrantyMonths ? [{ key: 'warranty', t: t.service.warranty(commerce.warrantyMonths), d: warranty.d }] : []),
    ...(methods.length ? [{ key: 'payment', t: payment.t, d: `${methods.join(t.home.listJoin)}.` }] : []),
    ...(settings?.business?.whatsappNumber ? [{ key: 'support', ...support }] : []),
  ];
  return (
    <section className="cx-section cx-why" aria-labelledby="cx-why-title">
      <div className="container cx-why__inner">
        <div className="cx-why__intro">
          <span className="cx-eyebrow" data-fx="rise">
            {c.whyEyebrow}
          </span>
          <Kinetic id="cx-why-title" text={t.home.whyTitle} className="cx-display cx-display--xl" />
          <span className="cx-why__mark ltr" aria-hidden="true" data-fx="chrome">
            C
          </span>
        </div>
        <ol className="cx-why__list">
          {why.map((w, i) => (
            <li key={w.key} className="cx-why__item" data-fx="line" style={{ '--i': i } as CSSProperties}>
              <span className="cx-why__num ltr">{String(i + 1).padStart(2, '0')}</span>
              <div>
                <h3>{w.t}</h3>
                <p>{w.d}</p>
                {w.key === 'payment' ? <PayLogos /> : null}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* ───────────────────────── 07 · Brand story — complete photograph, split reveal ───────────────────────── */
export function BrandStory({ data }: { data: HomeData }) {
  const { t, lang } = useI18n();
  const c = storeCopy(lang);
  return (
    <section className="cx-story is-dark" id="story" aria-labelledby="cx-story-title">
      <div className="container cx-story__inner">
        <div className="cx-story__copy">
          {/* Brand signature above the story copy, centred in this column: the full name in outline, its
              two E's the lightning-cut letters from the official logo (public/brand/story-e*.png). */}
          <div className="cx-story__sign ltr" aria-hidden="true" data-fx="rise">
            <span>C</span>
            <span className="cx-story__e cx-story__e--1" />
            <span>LIB</span>
            <span className="cx-story__e cx-story__e--2" />
            <span>RY</span>
          </div>
          <span className="cx-eyebrow" data-fx="rise">
            {t.nav.ourStory || c.storyEyebrow}
          </span>
          <Kinetic id="cx-story-title" text={t.home.storyTitle} className="cx-display cx-display--xl" />
          <p className="cx-story__text" data-fx="rise" style={{ '--d': '360ms' } as CSSProperties}>
            {L(data.brandStory.text, lang) || t.home.storyFallback}
          </p>
        </div>
        <figure className="cx-story__media" data-fx="split">
          <img {...responsiveImg(data.brandStory.imageUrl || '/placeholders/lifestyle.svg', '(max-width: 959px) 100vw, 50vw')} alt="" loading="lazy" decoding="async" />
        </figure>
      </div>
    </section>
  );
}

/* ───────────────────────── 08 · Closing campaign + newsletter ───────────────────────── */
export function ClosingCampaign({ data }: { data: HomeData }) {
  const { t, lang, p } = useI18n();
  const c = storeCopy(lang);
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await post('/api/newsletter', { email, lang });
      toast(t.home.subscribed);
      setEmail('');
    } catch (err) {
      toast(errorText(err, t, lang), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="cx-section cx-closing" aria-labelledby="cx-closing-title">
      <div className="container">
        <div className="cx-closing__panel" data-fx="iris">
          <span className="cx-closing__orb" aria-hidden="true" />
          <span className="cx-eyebrow">{c.closingEyebrow}</span>
          <Kinetic id="cx-closing-title" text={data.newsletterEnabled ? t.home.newsletterTitle : t.home.heroTitle} className="cx-display cx-display--xl" />
          <p className="cx-lead">{data.newsletterEnabled ? t.home.newsletterText : t.home.heroSubtitle}</p>
          {data.newsletterEnabled ? (
            <form className="cx-closing__form" onSubmit={submit}>
              <label className="sr-only" htmlFor="nl-email">
                {t.home.emailPlaceholder}
              </label>
              <input id="nl-email" className="cx-input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t.home.emailPlaceholder} />
              <button className="cx-btn cx-btn--solid" disabled={busy}>
                {t.home.subscribe} <Arrow />
              </button>
            </form>
          ) : null}
          <Link className="cx-link" to={p('/shop')}>
            {c.closingCta} <Arrow />
          </Link>
        </div>
      </div>
    </section>
  );
}
