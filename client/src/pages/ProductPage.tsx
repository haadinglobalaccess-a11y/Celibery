import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { ProductCard } from '../components/ProductCard';
import { Crumbs, ErrorState, NotFound, Price, Quantity, Spinner } from '../components/ui';
import { useI18n } from '../i18n/I18n';
import { connectorLabel, formatInt, L } from '../lib/format';
import { useApi } from '../lib/hooks';
import { useSeo } from '../lib/useSeo';
import type { ProductDetail } from '../lib/types';
import { useCart } from '../state/cart';
import { useSettings } from '../state/settings';
import { useWishlist } from '../state/wishlist';
import { DimensionalIcon, flyToCart, InteractiveProductGallery, SpatialCarousel } from '../three-d';

export default function ProductPage() {
  const { slug } = useParams();
  const { t, lang, p } = useI18n();
  const { data, error, loading, reload } = useApi<ProductDetail>(`/api/products/${slug}`);
  const cart = useCart();
  const wish = useWishlist();
  const settings = useSettings();
  const [qty, setQty] = useState(1);
  const [justAdded, setJustAdded] = useState(false);
  const stageRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    setQty(1);
  }, [slug]);
  useEffect(() => {
    if (!justAdded) return;
    const id = setTimeout(() => setJustAdded(false), 1600);
    return () => clearTimeout(id);
  }, [justAdded]);

  const name = data ? L(data.name, lang) : '';
  useSeo(L(data?.seo?.title, lang) || name, L(data?.seo?.description, lang) || L(data?.shortDescription, lang));

  if (error?.status === 404) return <NotFound />;
  if (error) return <ErrorState onRetry={reload} />;
  if (loading || !data) return <Spinner />;

  const category = typeof data.category === 'object' ? data.category : undefined;
  const images = data.images?.length ? data.images : [{ url: '', alt: data.name }];
  const maxQ = settings?.commerce?.maxQuantityPerItem ?? 10;
  const add = () => {
    cart.add(data, qty);
    setJustAdded(true);
    flyToCart(stageRef.current);
  };
  const inWish = wish.has(data._id);
  const attrs: [string, string][] = [];
  if (data.attributes?.capacityMah) attrs.push([t.shop.capacity, formatInt(data.attributes.capacityMah, lang)]);
  if (data.attributes?.powerW) attrs.push([t.shop.power, `${data.attributes.powerW}W`]);
  if (data.attributes?.connectors?.length) attrs.push([t.shop.connector, data.attributes.connectors.map((c) => connectorLabel(c, lang)).join('، ')]);
  if (data.attributes?.color) attrs.push([t.shop.color, L(data.attributes.color.name, lang)]);

  return (
    <div className="has-sticky-buy">
      <div className="container">
        <div className="page-head" style={{ paddingBottom: 0 }}>
          <Crumbs
            items={[
              { label: t.common.home, to: p('/') },
              ...(category ? [{ label: L(category.name, lang), to: p(`/c/${category.slug}`) }] : []),
              { label: name },
            ]}
          />
        </div>
        <div className="pdp pdp--3d">
          <InteractiveProductGallery key={slug} images={images} name={name} category={category?.slug} stageRef={stageRef} />

          <div className="pdp__info">
            {data.dataSource === 'demo' ? (
              <div className="alert alert--warning" style={{ marginBottom: 16 }}>
                {t.product.sampleNote}
              </div>
            ) : null}
            <h1>{name}</h1>
            <div className="pdp__meta">
              {data.series ? (
                <span>
                  {t.product.series}: <Link to={p(`/search?q=${encodeURIComponent(data.series)}`)}>{data.series}</Link>
                </span>
              ) : null}
              {data.model ? (
                <span>
                  {t.product.model}: <span className="ltr">{data.model}</span>
                </span>
              ) : null}
              <span>
                {t.product.sku}: <span className="ltr">{data.sku}</span>
              </span>
              {data.available ? (
                <span className={`badge ${data.lowStock ? 'badge--warning' : 'badge--success'}`}>{data.lowStock ? t.product.lowStock : t.product.inStock}</span>
              ) : (
                <span className="badge badge--danger">{t.product.outOfStock}</span>
              )}
            </div>
            <div className="pdp__price">
              <Price price={data.price} compareAt={data.compareAtPrice} />
              {data.discountPercent ? (
                <span className="badge badge--accent" style={{ marginInlineStart: 8 }}>
                  {t.product.save(data.discountPercent)}
                </span>
              ) : null}
            </div>
            <small className="muted">{t.product.vatIncluded}</small>
            {L(data.shortDescription, lang) ? <p style={{ marginTop: 16 }}>{L(data.shortDescription, lang)}</p> : null}

            <div className="pdp__buy">
              <Quantity label={t.product.quantity} value={qty} onChange={setQty} max={maxQ} />
              <button className={`btn btn--primary btn--lg ${justAdded ? 'is-added' : ''}`} disabled={!data.available} onClick={add} data-testid="add-to-cart">
                {justAdded ? <Icon name="check" className="icon" /> : null}
                {!data.available ? t.product.outOfStock : justAdded ? t.product.added : t.product.addToCart}
              </button>
              <button className="icon-btn" aria-pressed={inWish} aria-label={inWish ? t.product.removeWishlist : t.product.addWishlist} onClick={() => void wish.toggle(data._id)} style={{ border: '1.5px solid var(--line)', color: inWish ? '#e11d48' : undefined }}>
                <Icon name="heart" />
              </button>
            </div>

            <div className="info-list">
              <div className="info-row d-icon-host">
                <DimensionalIcon name="truck" size="sm" />
                <div>
                  <strong>{data.delivery.free ? t.product.freeDelivery : t.product.shipping}</strong>
                  <span className="muted">
                    {data.delivery.courier ? t.product.deliveryBy(data.delivery.courier) : ''}
                    {L(data.delivery.estimate, lang) ? ` · ${L(data.delivery.estimate, lang)}` : ''}
                  </span>
                </div>
              </div>
              {data.warrantyMonths ? (
                <div className="info-row d-icon-host">
                  <DimensionalIcon name="shield" size="sm" />
                  <div>
                    <strong>{t.service.warranty(data.warrantyMonths)}</strong>
                    <Link to={p('/page/warranty')} className="muted">
                      {t.product.readPolicy}
                    </Link>
                  </div>
                </div>
              ) : null}
              <div className="info-row d-icon-host">
                <DimensionalIcon name="return" size="sm" />
                <div>
                  <strong>{t.product.returns}</strong>
                  <Link to={p('/page/returns')} className="muted">
                    {t.product.returnsText}
                  </Link>
                </div>
              </div>
            </div>

            {L(data.description, lang) ? (
              <details className="acc" open>
                <summary>{t.product.description}</summary>
                <div style={{ whiteSpace: 'pre-line' }}>{L(data.description, lang)}</div>
              </details>
            ) : null}
            {data.specs.length || attrs.length ? (
              <details className="acc" open>
                <summary>{t.product.specs}</summary>
                <div>
                  <table className="specs">
                    <tbody>
                      {attrs.map(([k, v]) => (
                        <tr key={k}>
                          <th scope="row">{k}</th>
                          <td>{v}</td>
                        </tr>
                      ))}
                      {data.specs.map((s, i) => (
                        <tr key={i}>
                          <th scope="row">{L(s.label, lang)}</th>
                          <td>{L(s.value, lang)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            ) : null}
            {data.isBundle && data.bundleContents.length ? (
              <details className="acc" open>
                <summary>{t.product.inTheBox}</summary>
                <div>
                  <ul>
                    {data.bundleContents.map((b, i) =>
                      b.product ? (
                        <li key={i}>
                          <span className="ltr">{b.quantity}×</span> <Link to={p(`/p/${b.product.slug}`)}>{L(b.product.name, lang)}</Link>
                        </li>
                      ) : null,
                    )}
                  </ul>
                </div>
              </details>
            ) : null}
          </div>
        </div>

        {data.bundles.length ? (
          <section className="section section--tight">
            <div className="section__head">
              <h2>{t.product.bundlesWith}</h2>
            </div>
            <div className="scroller">
              {data.bundles.map((b) => (
                <ProductCard key={b._id} product={b} />
              ))}
            </div>
          </section>
        ) : null}
        {data.related.length ? (
          <section className="section section--tight">
            <div className="section__head">
              <h2>{t.product.related}</h2>
            </div>
            <SpatialCarousel label={t.product.related}>
              {data.related.map((r, i) => (
                <ProductCard key={r._id} product={r} categorySlug={category?.slug} index={i} />
              ))}
            </SpatialCarousel>
          </section>
        ) : null}
      </div>

      {/* Sticky add-to-cart on phones (Saudi mobile-first recommendation) */}
      <div className="sticky-buy">
        <Price price={data.price} compareAt={data.compareAtPrice} />
        <button className="btn btn--primary" disabled={!data.available} onClick={add}>
          {data.available ? t.product.addToCart : t.product.outOfStock}
        </button>
      </div>
    </div>
  );
}
