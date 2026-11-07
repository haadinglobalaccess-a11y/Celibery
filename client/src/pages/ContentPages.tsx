import { useParams } from 'react-router-dom';
import { ProductCard } from '../components/ProductCard';
import { Crumbs, ErrorState, NotFound, Spinner } from '../components/ui';
import { useI18n } from '../i18n/I18n';
import { L } from '../lib/format';
import { useApi } from '../lib/hooks';
import { Markdown } from '../lib/markdown';
import { useSeo } from '../lib/useSeo';
import type { Campaign, Localized } from '../lib/types';

export function PolicyPage() {
  const { slug } = useParams();
  const { t, lang, p } = useI18n();
  const { data, error, loading, reload } = useApi<{ slug: string; title: Localized; body: Localized; status: string }>(`/api/pages/${slug}`);
  useSeo(L(data?.title, lang));
  if (error?.status === 404) return <NotFound />;
  if (error) return <ErrorState onRetry={reload} />;
  if (loading || !data) return <Spinner />;
  return (
    <div className="container" style={{ paddingBottom: 64 }}>
      <div className="page-head">
        <Crumbs items={[{ label: t.common.home, to: p('/') }, { label: L(data.title, lang) }]} />
        <h1>{L(data.title, lang)}</h1>
      </div>
      <Markdown source={L(data.body, lang)} />
    </div>
  );
}

/** Saudi seasonal campaign landing page (Ramadan, Eid, National Day, Umrah & travel…). */
export function CampaignPage() {
  const { slug } = useParams();
  const { t, lang, p } = useI18n();
  const { data, error, loading, reload } = useApi<Campaign>(`/api/campaigns/${slug}`);
  useSeo(L(data?.title, lang), L(data?.description, lang));
  if (error?.status === 404) return <NotFound />;
  if (error) return <ErrorState onRetry={reload} />;
  if (loading || !data) return <Spinner />;
  return (
    <div className="container" style={{ paddingBottom: 64 }}>
      <Crumbs items={[{ label: t.common.home, to: p('/') }, { label: L(data.title, lang) }]} />
      {/* The campaign artwork is shown complete beside the copy — as a cropped background (cover) only a
          thin strip of it was visible in this wide banner. */}
      <section className={`campaign-hero ${data.heroImageUrl ? 'campaign-hero--art' : ''}`} style={{ ['--campaign-accent' as string]: data.accentColor || undefined }}>
        <div className="campaign-hero__copy">
          <h1 style={{ fontSize: 'var(--fs-3xl)' }}>{L(data.title, lang)}</h1>
          {L(data.description, lang) ? <p style={{ maxWidth: 640 }}>{L(data.description, lang)}</p> : null}
          {data.discountCode ? (
            <p>
              <span className="badge badge--light" style={{ background: '#fff', color: '#111', fontSize: 14 }}>
                <span className="ltr">{data.discountCode}</span>
              </span>
            </p>
          ) : null}
        </div>
        {data.heroImageUrl ? (
          <picture className="campaign-hero__art">
            {data.heroMobileImageUrl ? <source media="(max-width: 639px)" srcSet={data.heroMobileImageUrl} /> : null}
            <img src={data.heroImageUrl} alt="" decoding="async" />
          </picture>
        ) : null}
      </section>
      <div className="cx-grid cx-grid--4">
        {(data.products ?? []).map((pr, i) => (
          <ProductCard key={pr._id} product={pr} index={i} />
        ))}
      </div>
    </div>
  );
}
