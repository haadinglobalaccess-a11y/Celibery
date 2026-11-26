import { Link, useParams } from 'react-router-dom';
import { ProductCard } from '../components/ProductCard';
import { RichText } from '../components/RichText';
import { Crumbs, ErrorState, NotFound, Spinner } from '../components/ui';
import { useI18n } from '../i18n/I18n';
import { L } from '../lib/format';
import { useApi } from '../lib/hooks';
import { responsiveImg } from '../lib/media';
import { absoluteUrl, useSeo } from '../lib/useSeo';
import type { Localized, ProductCardData } from '../lib/types';

/**
 * Blog / buying guides (SEO, AEO, GEO). Articles answer the questions people ask search engines and
 * AI assistants, and link to the products they mention. Same studio identity as the listing headers.
 */
type PostCard = { _id: string; slug: string; title: Localized; excerpt?: Localized; coverImage?: { url?: string; alt?: Localized }; publishedAt?: string | null; author?: string; tags?: string[] };
type Post = PostCard & { body?: Localized; updatedAt?: string; seo?: { title?: Localized; description?: Localized }; products?: ProductCardData[]; more?: PostCard[] };

const copy = (lang: string) =>
  lang === 'ar'
    ? { blog: 'المدونة', title: 'مدونة سيليبري وأدلة الشراء', lead: 'أدلة شراء ونصائح من سيليبري: كيف تختار الباور بانك والشاحن والكابل المناسب لجوالك وسفرك.', eyebrow: 'أدلة ونصائح', read: 'اقرأ المقال', empty: 'لا توجد مقالات منشورة بعد.', products: 'منتجات في هذا المقال', more: 'مقالات أخرى', all: 'كل المقالات' }
    : { blog: 'Blog', title: 'CELIBERY blog and buying guides', lead: 'Buying guides and tips from CELIBERY: how to choose the right power bank, charger and cable for your phone and travel.', eyebrow: 'Guides & tips', read: 'Read the article', empty: 'No articles published yet.', products: 'Products in this article', more: 'More articles', all: 'All articles' };

const dateText = (d: string | null | undefined, lang: string) =>
  d ? new Date(d).toLocaleDateString(lang === 'ar' ? 'ar-SA-u-ca-gregory' : 'en-GB', { year: 'numeric', month: 'long', day: 'numeric' }) : '';

function PostTile({ post }: { post: PostCard }) {
  const { lang, p } = useI18n();
  const c = copy(lang);
  return (
    <article className="cx-post">
      <Link to={p(`/blog/${post.slug}`)} className="cx-post__media" tabIndex={-1} aria-hidden="true">
        {post.coverImage?.url ? <img {...responsiveImg(post.coverImage.url, '(max-width: 767px) 100vw, 33vw', [480, 800, 1200])} alt="" loading="lazy" decoding="async" /> : <span className="cx-post__mark">CELIBERY</span>}
      </Link>
      <div className="cx-post__body">
        {post.publishedAt ? <time dateTime={post.publishedAt}>{dateText(post.publishedAt, lang)}</time> : null}
        <h2 className="cx-post__title">
          <Link to={p(`/blog/${post.slug}`)}>{L(post.title, lang)}</Link>
        </h2>
        {L(post.excerpt, lang) ? <p className="cx-post__excerpt">{L(post.excerpt, lang)}</p> : null}
        <Link to={p(`/blog/${post.slug}`)} className="cx-post__more">
          {c.read} <span aria-hidden="true">{lang === 'ar' ? '←' : '→'}</span>
        </Link>
      </div>
    </article>
  );
}

export function BlogList() {
  const { t, lang, p } = useI18n();
  const c = copy(lang);
  const { data, error, loading, reload } = useApi<PostCard[]>('/api/blog?limit=48');
  useSeo(c.title, c.lead);
  return (
    <div className="cx-blog">
      <header className="cx-listhead cx-tone-studio is-dark">
        <div className="container cx-listhead__inner">
          <div className="cx-listhead__copy">
            <Crumbs items={[{ label: t.common.home, to: p('/') }, { label: c.blog }]} />
            <span className="cx-eyebrow">{c.eyebrow}</span>
            <h1 className="cx-display cx-display--xl">{c.title}</h1>
            <p className="cx-lead">{c.lead}</p>
          </div>
        </div>
      </header>
      <div className="container cx-blog__list">
        {error ? <ErrorState onRetry={reload} /> : loading || !data ? <Spinner /> : data.length ? <div className="cx-posts">{data.map((x) => <PostTile key={x._id} post={x} />)}</div> : <p className="muted">{c.empty}</p>}
      </div>
    </div>
  );
}

export function BlogPost() {
  const { slug } = useParams();
  const { t, lang, p } = useI18n();
  const c = copy(lang);
  const { data, error, loading, reload } = useApi<Post>(`/api/blog/${slug}`);
  const title = L(data?.title, lang);
  const excerpt = L(data?.excerpt, lang);
  const jsonLd = data
    ? {
        '@context': 'https://schema.org',
        '@type': 'BlogPosting',
        headline: title.slice(0, 110),
        ...(excerpt ? { description: excerpt } : {}),
        url: window.location.href.split('?')[0],
        inLanguage: lang === 'ar' ? 'ar-SA' : 'en-SA',
        ...(data.coverImage?.url ? { image: [absoluteUrl(data.coverImage.url)] } : {}),
        ...(data.publishedAt ? { datePublished: data.publishedAt } : {}),
        ...(data.updatedAt ? { dateModified: data.updatedAt } : {}),
        author: { '@type': 'Organization', name: data.author || 'CELIBERY' },
        publisher: { '@type': 'Organization', name: 'CELIBERY International' },
      }
    : null;
  useSeo(L(data?.seo?.title, lang) || title, L(data?.seo?.description, lang) || excerpt, { image: data?.coverImage?.url || data?.products?.[0]?.images?.[0]?.url, jsonLd });
  if (error?.status === 404) return <NotFound />;
  if (error) return <ErrorState onRetry={reload} />;
  if (loading || !data) return <Spinner />;
  return (
    <article className="cx-blog cx-article">
      <header className="cx-listhead cx-tone-studio is-dark cx-article__head">
        <div className="container cx-article__narrow">
          <Crumbs items={[{ label: t.common.home, to: p('/') }, { label: c.blog, to: p('/blog') }, { label: title }]} />
          <span className="cx-eyebrow">{c.eyebrow}</span>
          <h1 className="cx-display cx-display--xl">{title}</h1>
          <p className="cx-article__meta">
            {data.publishedAt ? <time dateTime={data.publishedAt}>{dateText(data.publishedAt, lang)}</time> : null}
            {data.author ? <span> · {data.author}</span> : null}
          </p>
        </div>
      </header>
      <div className="container cx-article__narrow">
        {data.coverImage?.url ? (
          <figure className="cx-article__cover">
            <img {...responsiveImg(data.coverImage.url, '(max-width: 960px) 100vw, 860px', [800, 1200, 1600])} alt={L(data.coverImage.alt, lang) || title} decoding="async" {...{ fetchpriority: 'high' }} />
          </figure>
        ) : null}
        {/* The direct answer first (what AI search quotes), then the full article. */}
        {excerpt ? <p className="cx-article__answer">{excerpt}</p> : null}
        <RichText className="cx-article__body" text={L(data.body, lang)} />
      </div>
      {data.products?.length ? (
        <section className="cx-pdp__section cx-article__products">
          <div className="container">
            <h2 className="cx-display">{c.products}</h2>
            <div className="cx-grid">
              {data.products.map((x, i) => (
                <ProductCard key={x._id} product={x} index={i} />
              ))}
            </div>
          </div>
        </section>
      ) : null}
      {data.more?.length ? (
        <section className="container cx-article__more">
          <h2 className="cx-display">{c.more}</h2>
          <div className="cx-posts">{data.more.map((x) => <PostTile key={x._id} post={x} />)}</div>
          <p>
            <Link to={p('/blog')} className="cx-post__more">
              {c.all} <span aria-hidden="true">{lang === 'ar' ? '←' : '→'}</span>
            </Link>
          </p>
        </section>
      ) : null}
    </article>
  );
}
