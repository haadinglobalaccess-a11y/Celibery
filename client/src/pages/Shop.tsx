import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { ProductCard, ProductGridSkeleton } from '../components/ProductCard';
import { Crumbs, EmptyState, ErrorState, NotFound } from '../components/ui';
import { useI18n } from '../i18n/I18n';
import { api, qs } from '../lib/api';
import { connectorLabel, formatInt, L, placeholderFor } from '../lib/format';
import { useApi, useCached } from '../lib/hooks';
import { useSeo } from '../lib/useSeo';
import type { Category, Collection, Facets, HomeData, ProductCardData } from '../lib/types';
import { useTilt } from '../three-d';

type Mode = 'all' | 'category' | 'search' | 'collection';

function FiltersPanel({ facets, params, set }: { facets: Facets; params: URLSearchParams; set: (k: string, v: string | null) => void }) {
  const { t, lang } = useI18n();
  const list = (k: string) => (params.get(k) ?? '').split(',').filter(Boolean);
  const toggle = (k: string, v: string) => {
    const cur = list(k);
    const next = cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v];
    set(k, next.length ? next.join(',') : null);
  };
  const [min, setMin] = useState(params.get('minPrice') ?? '');
  const [max, setMax] = useState(params.get('maxPrice') ?? '');
  useEffect(() => {
    setMin(params.get('minPrice') ?? '');
    setMax(params.get('maxPrice') ?? '');
  }, [params]);

  return (
    <div>
      {facets.price ? (
        <div className="filter-group">
          <h3>{t.shop.price}</h3>
          <form
            className="price-range"
            onSubmit={(e) => {
              e.preventDefault();
              set('minPrice', min || null);
              set('maxPrice', max || null);
            }}
          >
            <input className="input" inputMode="numeric" aria-label={t.shop.min} placeholder={facets.price.max ? `${t.shop.min} ${Math.floor(facets.price.min / 100)}` : t.shop.min} value={min} onChange={(e) => setMin(e.target.value.replace(/[^\d.]/g, ''))} />
            <input className="input" inputMode="numeric" aria-label={t.shop.max} placeholder={facets.price.max ? `${t.shop.max} ${Math.ceil(facets.price.max / 100)}` : t.shop.max} value={max} onChange={(e) => setMax(e.target.value.replace(/[^\d.]/g, ''))} />
            <button className="btn btn--outline btn--sm">{t.shop.apply}</button>
          </form>
        </div>
      ) : null}
      {facets.capacity?.length ? (
        <div className="filter-group">
          <h3>{t.shop.capacity}</h3>
          <div className="chips">
            {facets.capacity.map((c) => (
              <button key={c.value} className="chip" aria-pressed={list('capacity').includes(String(c.value))} onClick={() => toggle('capacity', String(c.value))}>
                <span className="ltr">{formatInt(c.value, lang)}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {facets.power?.length ? (
        <div className="filter-group">
          <h3>{t.shop.power}</h3>
          <div className="chips">
            {facets.power.map((c) => (
              <button key={c.value} className="chip" aria-pressed={list('power').includes(String(c.value))} onClick={() => toggle('power', String(c.value))}>
                <span className="ltr">{c.value}W</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {facets.connector?.length ? (
        <div className="filter-group">
          <h3>{t.shop.connector}</h3>
          <div className="chips">
            {facets.connector.map((c) => (
              <button key={c.value} className="chip" aria-pressed={list('connector').includes(c.value)} onClick={() => toggle('connector', c.value)}>
                {connectorLabel(c.value, lang)}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {facets.color?.length ? (
        <div className="filter-group">
          <h3>{t.shop.color}</h3>
          <div className="chips">
            {facets.color.map((c) => (
              <button key={c.value} className="chip" aria-pressed={list('color').includes(c.value)} onClick={() => toggle('color', c.value)}>
                {c.hex ? <span className="swatch" style={{ background: c.hex }} /> : null}
                {L(c.name, lang) || c.value}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {facets.availability ? (
        <div className="filter-group">
          <h3>{t.shop.availability}</h3>
          <label className="check">
            <input type="checkbox" checked={params.get('inStock') === '1'} onChange={(e) => set('inStock', e.target.checked ? '1' : null)} />
            {t.shop.inStockOnly}
          </label>
        </div>
      ) : null}
    </div>
  );
}

/** One category in the rail: a small lit plinth with the category image, tilting on hover. */
function RailItem({ c, active }: { c: Category; active: boolean }) {
  const { lang, p } = useI18n();
  const ref = useRef<HTMLAnchorElement | null>(null);
  useTilt(ref, { max: 10 });
  return (
    <Link ref={ref} to={p(`/c/${c.slug}`)} className="rail__item tilt" aria-current={active ? 'page' : undefined}>
      <span className="rail__media" aria-hidden="true">
        <img src={c.image?.url || placeholderFor(c.slug)} alt="" loading="lazy" />
      </span>
      <span className="rail__name">{L(c.name, lang)}</span>
    </Link>
  );
}

/**
 * 3D-inspired category navigation shown above listings. Uses the category list the store layout
 * has already loaded (cached /api/home) — no extra request, nothing hard-coded.
 */
function CategoryRail({ current }: { current?: string }) {
  const { t } = useI18n();
  const { data } = useCached<HomeData>('/api/home');
  if (!data?.categories.length) return null;
  return (
    <nav className="rail" aria-label={t.home.categories}>
      {data.categories.map((c) => (
        <RailItem key={c._id} c={c} active={c.slug === current} />
      ))}
    </nav>
  );
}

export default function Shop({ mode, collectionSlug }: { mode: Mode; collectionSlug?: string }) {
  const { t, lang, p } = useI18n();
  const { slug } = useParams();
  const [params, setParams] = useSearchParams();
  const [drawer, setDrawer] = useState(false);
  const colSlug = collectionSlug ?? (mode === 'collection' ? slug : undefined);
  const q = params.get('q') ?? '';

  const cat = useApi<{ category: Category; facets: Facets }>(mode === 'category' && slug ? `/api/categories/${slug}` : null);
  const col = useApi<Collection>(colSlug ? `/api/collections/${colSlug}` : null);

  const query = useMemo(
    () =>
      qs({
        category: mode === 'category' ? slug : undefined,
        collection: colSlug,
        q: mode === 'search' ? q : undefined,
        sort: params.get('sort') ?? undefined,
        page: params.get('page') ?? undefined,
        minPrice: params.get('minPrice') ?? undefined,
        maxPrice: params.get('maxPrice') ?? undefined,
        capacity: params.get('capacity') ?? undefined,
        power: params.get('power') ?? undefined,
        connector: params.get('connector') ?? undefined,
        color: params.get('color') ?? undefined,
        inStock: params.get('inStock') ?? undefined,
        lang,
        limit: 24,
      }),
    [mode, slug, colSlug, q, params, lang],
  );

  const [state, setState] = useState<{ items: ProductCardData[]; total: number; pages: number; loading: boolean; error: boolean }>({ items: [], total: 0, pages: 1, loading: true, error: false });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (mode === 'search' && !q) {
      setState({ items: [], total: 0, pages: 1, loading: false, error: false });
      return;
    }
    const ctrl = new AbortController();
    setState((s) => ({ ...s, loading: true, error: false }));
    api<ProductCardData[]>(`/api/products${query}`, { signal: ctrl.signal })
      .then((r) => setState({ items: r.data, total: Number(r.meta?.total ?? 0), pages: Number(r.meta?.pages ?? 1), loading: false, error: false }))
      .catch((e) => {
        if ((e as Error).name !== 'AbortError') setState((s) => ({ ...s, loading: false, error: true }));
      });
    return () => ctrl.abort();
  }, [query, mode, q, nonce]);

  const set = (k: string, v: string | null) => {
    const next = new URLSearchParams(params);
    if (v === null) next.delete(k);
    else next.set(k, v);
    if (k !== 'page') next.delete('page');
    setParams(next, { replace: k !== 'page' });
  };
  const clearFilters = () => {
    const next = new URLSearchParams();
    if (q) next.set('q', q);
    setParams(next);
  };

  // Filters depend on the category (Q18). "All products" and search only offer price + availability.
  const facets: Facets = mode === 'category' ? (cat.data?.facets ?? {}) : { price: { min: 0, max: 0 }, availability: true };

  const title =
    mode === 'category'
      ? L(cat.data?.category.name, lang)
      : mode === 'collection'
        ? L(col.data?.title, lang)
        : mode === 'search'
          ? t.shop.searchFor(q)
          : t.shop.title;
  useSeo(title || t.shop.title, mode === 'category' ? L(cat.data?.category.description, lang) : undefined);

  if ((mode === 'category' && cat.error?.status === 404) || (colSlug && col.error?.status === 404)) return <NotFound />;

  const page = Number(params.get('page') ?? 1);
  const activeFilters = ['minPrice', 'maxPrice', 'capacity', 'power', 'connector', 'color', 'inStock'].some((k) => params.get(k));

  return (
    <div className="container">
      <div className="page-head page-head--3d">
        <Crumbs items={[{ label: t.common.home, to: p('/') }, ...(mode !== 'all' ? [{ label: t.nav.allProducts, to: p('/shop') }] : []), { label: title || '…' }]} />
        <h1 key={title} className="title-3d">{title || ' '}</h1>
        {mode === 'collection' && L(col.data?.description, lang) ? <p className="muted">{L(col.data?.description, lang)}</p> : null}
      </div>
      {mode === 'all' || mode === 'category' ? <CategoryRail current={mode === 'category' ? slug : undefined} /> : null}
      <div className="shop">
        <aside className="filters" aria-label={t.shop.filters}>
          <FiltersPanel facets={facets} params={params} set={set} />
          {activeFilters ? (
            <button className="btn btn--ghost btn--sm" onClick={clearFilters} style={{ marginTop: 12 }}>
              {t.shop.clear}
            </button>
          ) : null}
        </aside>
        <section aria-live="polite">
          <div className="toolbar">
            <span className="muted" data-testid="result-count">
              {state.loading ? t.common.loading : t.shop.results(state.total)}
            </span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn--outline btn--sm filters-btn" onClick={() => setDrawer(true)}>
                <Icon name="filter" /> {t.shop.filters}
              </button>
              <label className="sr-only" htmlFor="sort">
                {t.shop.sort}
              </label>
              <select id="sort" className="select" value={params.get('sort') ?? 'featured'} onChange={(e) => set('sort', e.target.value === 'featured' ? null : e.target.value)}>
                {Object.entries(t.shop.sortOptions).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {state.error ? (
            <ErrorState onRetry={() => setNonce((n) => n + 1)} />
          ) : state.loading && !state.items.length ? (
            <ProductGridSkeleton count={6} />
          ) : state.items.length === 0 ? (
            <EmptyState
              icon="search"
              title={t.shop.empty}
              text={t.shop.emptyHint}
              action={
                activeFilters ? (
                  <button className="btn btn--outline" onClick={clearFilters}>
                    {t.shop.clear}
                  </button>
                ) : (
                  <Link className="btn btn--primary" to={p('/shop')}>
                    {t.nav.allProducts}
                  </Link>
                )
              }
            />
          ) : (
            <div className="grid grid--3d" style={{ opacity: state.loading ? 0.6 : 1, transition: 'opacity .2s' }}>
              {state.items.map((pr, i) => (
                <ProductCard key={pr._id} product={pr} categorySlug={mode === 'category' ? slug : undefined} index={i} />
              ))}
            </div>
          )}
          {state.pages > 1 ? (
            <nav className="pager" aria-label="Pagination">
              <button className="btn btn--outline btn--sm" disabled={page <= 1} onClick={() => set('page', String(page - 1))}>
                {t.shop.prev}
              </button>
              <span className="muted">{t.shop.page(page, state.pages)}</span>
              <button className="btn btn--outline btn--sm" disabled={page >= state.pages} onClick={() => set('page', String(page + 1))}>
                {t.shop.next}
              </button>
            </nav>
          ) : null}
        </section>
      </div>
      {drawer ? (
        <>
          <div className="overlay" onClick={() => setDrawer(false)} />
          <aside className="drawer drawer--3d" role="dialog" aria-modal="true" aria-label={t.shop.filters}>
            <div className="drawer__head">
              <strong>{t.shop.filters}</strong>
              <button className="icon-btn" aria-label={t.nav.close} onClick={() => setDrawer(false)}>
                <Icon name="close" />
              </button>
            </div>
            <div className="drawer__body">
              <FiltersPanel facets={facets} params={params} set={set} />
            </div>
            <div className="drawer__foot" style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn--outline" onClick={clearFilters}>
                {t.shop.clear}
              </button>
              <button className="btn btn--primary btn--block" onClick={() => setDrawer(false)}>
                {t.shop.showResults} ({state.total})
              </button>
            </div>
          </aside>
        </>
      ) : null}
    </div>
  );
}
