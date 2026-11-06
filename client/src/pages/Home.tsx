import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ProductCard } from '../components/ProductCard';
import { RealityBreak } from '../three-d/RealityBreak';
import { ProductStory } from '../components/ProductStory';
import { AutomaticProductShowcase } from '../components/AutomaticProductShowcase';
import { ErrorState } from '../components/ui';
import { useI18n } from '../i18n/I18n';
import { post } from '../lib/api';
import { L, placeholderFor } from '../lib/format';
import { useCached } from '../lib/hooks';
import { prefersReducedMotion, Reveal } from '../lib/motion';
import { useSeo } from '../lib/useSeo';
import { BackgroundVideo, useMediaQuery } from '../lib/media';
import type { Campaign, Category, HomeData, ProductCardData } from '../lib/types';
import { useToast } from '../state/toast';
import { OrbitalShowcaseSlot } from '../three-d/OrbitalShowcaseSlot';
import { Ambient, bannerVideo, CinematicHero, DimensionalIcon, PremiumButton, ScrollScene, SpatialCarousel, TiltCard, useLinkFor, useTilt } from '../three-d';

function SectionHead({ title, eyebrow, link, text }: { title: string; eyebrow?: string; link?: string; text?: string }) {
  const { t } = useI18n();
  return (
    <Reveal className="section__head">
      <div>
        {eyebrow ? <span className="eyebrow eyebrow--line">{eyebrow}</span> : null}
        <h2>{title}</h2>
        {text ? <p className="muted section__lead">{text}</p> : null}
      </div>
      {link ? (
        <Link className="link-arrow" to={link}>
          {t.nav.viewAll} <span className="arrow">→</span>
        </Link>
      ) : null}
    </Reveal>
  );
}

function ProductRow({ title, items, link, eyebrow, surface = false }: { title: string; items: ProductCardData[]; link?: string; eyebrow?: string; surface?: boolean }) {
  if (!items.length) return null;
  return (
    <section className={`section ${surface ? 'section--surface' : ''}`}>
      <div className="container">
        <SectionHead title={title} eyebrow={eyebrow} link={link} />
        <SpatialCarousel label={title}>
          {items.map((pr, i) => (
            <ProductCard key={pr._id} product={pr} index={i} />
          ))}
        </SpatialCarousel>
      </div>
    </section>
  );
}

/** One category as a spatial panel: tilts toward the pointer, photo floats on a lit plinth. */
function BentoTile({ c, i }: { c: Category; i: number }) {
  const { t, lang, p } = useI18n();
  const ref = useRef<HTMLAnchorElement | null>(null);
  useTilt(ref, { max: 6 });
  return (
    <Link ref={ref} to={p(`/c/${c.slug}`)} className={`bento__tile tilt ${i === 0 ? 'bento__tile--hero dark' : ''}`} data-testid="category-tile">
      <span className="bento__media">
        <span className="bento__plinth" aria-hidden="true" />
        <img src={c.image?.url || placeholderFor(c.slug)} alt="" loading="lazy" />
      </span>
      <span className="bento__text">
        <span className="bento__index ltr" aria-hidden="true">
          {String(i + 1).padStart(2, '0')}
        </span>
        <strong>{L(c.name, lang)}</strong>
        {c.productCount ? <small>{t.premium.productsCount(c.productCount)}</small> : null}
      </span>
      <span className="bento__go" aria-hidden="true">
        <span className="arrow">→</span>
      </span>
      <span className="tilt__glare" aria-hidden="true" />
    </Link>
  );
}

function CategoryBento({ categories }: { categories: Category[] }) {
  const { t, p } = useI18n();
  return (
    <section className="section">
      <div className="container">
        <SectionHead title={t.home.categories} link={p('/shop')} />
        <Reveal className="bento bento--3d" stagger>
          {categories.map((c, i) => (
            <BentoTile key={c._id} c={c} i={i} />
          ))}
        </Reveal>
      </div>
    </section>
  );
}

/** One section with a tab per category (replaces six stacked rows; same products, less scrolling). */
function ExploreCategories({ data }: { data: HomeData }) {
  const { t, lang, p } = useI18n();
  const withItems = data.categories.filter((c) => data.categoryProducts.find((x) => x.categoryId === c._id)?.items.length);
  const [tab, setTab] = useState(withItems[0]?._id ?? '');
  if (!withItems.length) return null;
  const cat = withItems.find((c) => c._id === tab) ?? withItems[0];
  const items = data.categoryProducts.find((x) => x.categoryId === cat._id)?.items ?? [];
  return (
    <section className="section section--surface">
      <div className="container">
        <SectionHead title={t.premium.exploreTitle} text={t.premium.exploreText} />
        <Reveal>
          <div className="seg" role="tablist" aria-label={t.premium.exploreTitle}>
            {withItems.map((c) => (
              <button key={c._id} role="tab" id={`tab-${c._id}`} aria-selected={c._id === cat._id} aria-controls="explore-panel" onClick={() => setTab(c._id)}>
                {L(c.name, lang)}
              </button>
            ))}
          </div>
          <div key={cat._id} id="explore-panel" role="tabpanel" aria-labelledby={`tab-${cat._id}`} className="seg__panel seg__panel--3d">
            <SpatialCarousel>
              {items.map((pr, i) => (
                <ProductCard key={pr._id} product={pr} categorySlug={cat.slug} index={i} />
              ))}
            </SpatialCarousel>
            <Link className="link-arrow seg__all" to={p(`/c/${cat.slug}`)}>
              {t.nav.viewAll}: {L(cat.name, lang)} <span className="arrow">→</span>
            </Link>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function Bundles({ data }: { data: HomeData }) {
  const { t, lang, p } = useI18n();
  const bundles = data.collections.find((c) => c.kind === 'bundles');
  if (!bundles?.products.length) return null;
  return (
    <section className="section">
      <div className="container">
        <Reveal variant="depth" className="editorial editorial--3d dark">
          <Ambient />
          <div className="editorial__copy">
            <span className="eyebrow eyebrow--line">{t.premium.bundlesEyebrow}</span>
            <h2>{L(bundles.title, lang) || t.home.bundles}</h2>
            <p className="muted">{t.home.bundlesText}</p>
            <PremiumButton to={p('/bundles')} variant="light">
              {t.nav.viewAll} <span className="arrow">→</span>
            </PremiumButton>
          </div>
          <div className="editorial__items editorial__fan anim-in">
            {bundles.products.slice(0, 3).map((pr, i) => (
              <ProductCard key={pr._id} product={pr} index={i} />
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function UseCases({ data }: { data: HomeData }) {
  const { t, lang } = useI18n();
  const [tab, setTab] = useState('for-travel');
  const [items, setItems] = useState<Record<string, ProductCardData[]>>({});
  const tabs = ['for-travel', 'for-work', 'for-fitness', 'for-home'];
  useEffect(() => {
    if (items[tab]) return;
    const fromHome = data.collections.find((c) => c.slug === tab);
    if (fromHome) {
      setItems((s) => ({ ...s, [tab]: fromHome.products }));
      return;
    }
    import('../lib/api')
      .then((m) => m.get<{ products: ProductCardData[] }>(`/api/collections/${tab}`))
      .then((c) => setItems((s) => ({ ...s, [tab]: c.products })))
      .catch(() => setItems((s) => ({ ...s, [tab]: [] })));
  }, [tab, items, data.collections]);
  const list = items[tab];
  return (
    <section className="section">
      <div className="container">
        <SectionHead title={t.home.useCases} />
        <Reveal>
          <div className="seg" role="tablist">
            {tabs.map((k) => (
              <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>
                {t.home.useCaseNames[k]}
              </button>
            ))}
          </div>
          <div key={tab} className="seg__panel seg__panel--3d" role="tabpanel">
            {list === undefined ? (
              <div className="scroller" aria-hidden="true">
                {Array.from({ length: 4 }, (_, i) => (
                  <div key={i} className="skeleton" style={{ aspectRatio: '1' }} />
                ))}
              </div>
            ) : list.length ? (
              <SpatialCarousel>
                {list.map((pr, i) => (
                  <ProductCard key={pr._id} product={pr} index={i} />
                ))}
              </SpatialCarousel>
            ) : (
              <p className="muted">{lang === 'ar' ? 'ستتم إضافة المنتجات قريباً.' : 'Products coming soon.'}</p>
            )}
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function Newsletter() {
  const { t, lang } = useI18n();
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
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="section">
      <div className="container">
        <Reveal variant="depth" className="newsletter newsletter--3d">
          <span className="newsletter__orbit" aria-hidden="true">
            <i />
            <i />
          </span>
          <div>
            <h2>{t.home.newsletterTitle}</h2>
            <p className="muted">{t.home.newsletterText}</p>
          </div>
          <form onSubmit={submit}>
            <label className="sr-only" htmlFor="nl-email">
              {t.home.emailPlaceholder}
            </label>
            <input id="nl-email" className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t.home.emailPlaceholder} />
            <PremiumButton variant="primary" disabled={busy}>
              {t.home.subscribe} <span className="arrow">→</span>
            </PremiumButton>
          </form>
        </Reveal>
      </div>
    </section>
  );
}

/** Campaign as a layered spatial panel: artwork behind, title plane in front, accent edge light. */
function CampaignPanel({ c }: { c: Campaign }) {
  const { t, lang, p } = useI18n();
  return (
    <TiltCard
      as={Link}
      max={5}
      to={p(`/campaign/${c.slug}`)}
      className="banner banner--3d campaign-panel"
      style={{ minHeight: 240, ...(c.accentColor ? ({ '--campaign-accent': c.accentColor } as CSSProperties) : {}) }}
    >
      <picture>
        {c.heroMobileImageUrl ? <source media="(max-width: 639px)" srcSet={c.heroMobileImageUrl} /> : null}
        <img className="parallax" src={c.heroImageUrl || '/placeholders/lifestyle.svg'} alt="" loading="lazy" />
      </picture>
      <span className="campaign-panel__rings" aria-hidden="true" />
      <div className="banner__body">
        <h3>{L(c.title, lang)}</h3>
        <span className="link-arrow">
          {t.home.explore} <span className="arrow">→</span>
        </span>
      </div>
    </TiltCard>
  );
}

function HomeSkeleton() {
  return (
    <>
      <section className="cine dark" aria-busy="true">
        <Ambient />
        <div className="container cine__inner">
          <div className="cine__copy">
            <div className="skeleton skeleton--dark" style={{ height: 14, width: 220 }} />
            <div className="skeleton skeleton--dark" style={{ height: 64, width: '90%', marginTop: 24 }} />
            <div className="skeleton skeleton--dark" style={{ height: 64, width: '70%', marginTop: 12 }} />
            <div className="skeleton skeleton--dark" style={{ height: 48, width: 300, marginTop: 32, borderRadius: 999 }} />
          </div>
        </div>
      </section>
      <div className="container section">
        <div className="scroller" aria-hidden="true">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="skeleton" style={{ aspectRatio: '1' }} />
          ))}
        </div>
      </div>
    </>
  );
}

export default function Home() {
  const { t, lang, p } = useI18n();
  const linkFor = useLinkFor();
  const { data, error } = useCached<HomeData>('/api/home');
  const isPhone = useMediaQuery('(max-width: 639px)');
  useSeo(t.home.heroTitle, t.home.heroSubtitle);

  if (error) return <ErrorState onRetry={() => window.location.reload()} />;
  if (!data) return <HomeSkeleton />;

  const showcaseProducts = Array.from(new Map([
    ...data.featured,
    ...data.categoryProducts.flatMap(category => category.items),
    ...data.bestSellers.items,
    ...data.collections.flatMap(collection => collection.products),
  ].filter(product => product.images?.[0]?.url).map(product => [product._id, product])).values()).slice(0, 10);

  return (
    <>
      {data.hero.enabled !== false ? <CinematicHero data={data} /> : null}

      <CategoryBento categories={data.categories} />

      {showcaseProducts.length > 0 ? <div className="container"><OrbitalShowcaseSlot products={showcaseProducts} loading={false} /></div> : null}

      {showcaseProducts[0] ? <RealityBreak product={showcaseProducts[0]} /> : null}

      <ProductStory products={[
        ...data.featured,
        ...data.categoryProducts.flatMap(category => category.items),
        ...data.bestSellers.items,
        ...data.collections.flatMap(collection => collection.products),
      ]} />

      <ProductRow eyebrow={t.premium.featuredEyebrow} title={t.home.featured} items={data.featured} link={p('/shop')} />

      <AutomaticProductShowcase products={[
        ...data.featured,
        ...data.categoryProducts.flatMap(category => category.items),
        ...data.bestSellers.items,
        ...data.collections.flatMap(collection => collection.products),
      ]} />

      {data.campaigns.length ? (
        <section className="section section--tight">
          <div className="container">
            <SectionHead title={t.home.campaigns} />
            <Reveal className="grid campaigns-3d" stagger>
              {data.campaigns.map((c) => (
                <CampaignPanel key={c._id} c={c} />
              ))}
            </Reveal>
          </div>
        </section>
      ) : null}

      <ExploreCategories data={data} />

      {data.bestSellers.items.length ? <ProductRow title={t.home.bestSellers} items={data.bestSellers.items} /> : null}

      {/* Lifestyle banners (client photography, Q15) */}
      {data.lifestyleBanners.length ? (
        <section className="section section--tight">
          <Reveal className="container lifestyle" stagger>
            {data.lifestyleBanners.map((b) => (
              <TiltCard as={Link} max={4} key={b._id} to={linkFor(b.link)} className={`banner banner--3d ${b.theme === 'light' ? 'banner--light' : ''}`}>
                {bannerVideo(b, isPhone) ? (
                  <BackgroundVideo className="banner__video" src={bannerVideo(b, isPhone)} poster={b.posterUrl || L(b.imageUrl, lang)} reduced={prefersReducedMotion()} />
                ) : (
                  <picture>
                    {L(b.mobileImageUrl, lang) ? <source media="(max-width: 639px)" srcSet={L(b.mobileImageUrl, lang)} /> : null}
                    <img className="parallax" src={L(b.imageUrl, lang) || '/placeholders/lifestyle.svg'} alt="" loading="lazy" />
                  </picture>
                )}
                <div className="banner__body">
                  <h3>{L(b.title, lang)}</h3>
                  {L(b.subtitle, lang) ? <p>{L(b.subtitle, lang)}</p> : null}
                  {L(b.ctaLabel, lang) ? <span className="btn btn--light btn--sm">{L(b.ctaLabel, lang)}</span> : null}
                </div>
              </TiltCard>
            ))}
          </Reveal>
        </section>
      ) : null}

      {/* Bundles & gift kits (Q17) */}
      <Bundles data={data} />

      {/* Why CELIBERY — premium dark */}
      <section className="section dark why">
        <Ambient />
        <div className="container">
          <SectionHead title={t.home.whyTitle} />
          <Reveal className="why-grid why-grid--3d" stagger>
            {t.home.why.map((w, i) => (
              <TiltCard className="why-item d-icon-host" key={i} max={5}>
                <span className="why-item__icon">
                  <DimensionalIcon name={['truck', 'shield', 'lock', 'chat'][i]} tone="accent" size="lg" />
                </span>
                <h3>{w.t}</h3>
                <p className="muted">{w.d}</p>
              </TiltCard>
            ))}
          </Reveal>
        </div>
      </section>

      <UseCases data={data} />

      {/* Brand story — premium dark (only confirmed claims, Q32) */}
      <ScrollScene as="section" className="section dark story-scene" id="story">
        <span className="story-scene__word" aria-hidden="true">
          CELIBERY
        </span>
        <div className="container story">
          <Reveal variant="start" className="story__copy">
            <span className="eyebrow eyebrow--line">{t.nav.ourStory}</span>
            <h2 className="story__title" data-text={t.home.storyTitle}>
              {t.home.storyTitle}
            </h2>
            <p>{L(data.brandStory.text, lang) || t.home.storyFallback}</p>
          </Reveal>
          <Reveal variant="end" className="story__media story__media--3d">
            <span className="story__frame" aria-hidden="true" />
            <img src={data.brandStory.imageUrl || '/placeholders/lifestyle.svg'} alt="" loading="lazy" />
          </Reveal>
        </div>
      </ScrollScene>

      {data.newsletterEnabled ? <Newsletter /> : null}
    </>
  );
}
