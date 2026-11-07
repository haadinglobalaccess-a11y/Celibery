import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { ProductCard, ProductImage } from '../components/ProductCard';
import { Crumbs, ErrorState, NotFound, Price, Quantity, Spinner } from '../components/ui';
import { useI18n } from '../i18n/I18n';
import { connectorLabel, formatInt, L } from '../lib/format';
import { useApi } from '../lib/hooks';
import { useSeo } from '../lib/useSeo';
import type { ProductDetail } from '../lib/types';
import { useCart } from '../state/cart';
import { useSettings } from '../state/settings';
import { useWishlist } from '../state/wishlist';
import { storeCopy } from '../storefront/copy';
import { Kinetic, TheatreStage } from '../storefront/motion';
import { ProductRail } from '../storefront/ProductRail';
import { flyToCart, InteractiveProductGallery } from '../three-d';

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

  const c = storeCopy(lang);
  const specRows: [string, string][] = [...attrs, ...data.specs.map((s) => [L(s.label, lang), L(s.value, lang)] as [string, string])];

  return (
    <div className="has-sticky-buy cx-pdp">
      <section className="cx-pdp__hero">
        <div className="container">
          <Crumbs
            items={[
              { label: t.common.home, to: p('/') },
              ...(category ? [{ label: L(category.name, lang), to: p(`/c/${category.slug}`) }] : []),
              { label: name },
            ]}
          />
          <div className="pdp cx-pdp__grid">
            <div className="cx-pdp__stage">
              <span className="cx-pdp__halo" aria-hidden="true" />
              <InteractiveProductGallery key={slug} images={images} name={name} category={category?.slug} stageRef={stageRef} />
            </div>

            <div className="pdp__info cx-pdp__info">
              {data.dataSource === 'demo' ? <div className="cx-note">{t.product.sampleNote}</div> : null}
              <div className="cx-pdp__kicker">
                {category ? (
                  <Link to={p(`/c/${category.slug}`)} className="cx-eyebrow">
                    {L(category.name, lang)}
                  </Link>
                ) : null}
                {data.series ? (
                  <Link className="cx-pdp__series" to={p(`/search?q=${encodeURIComponent(data.series)}`)}>
                    {t.product.series}: {data.series}
                  </Link>
                ) : null}
              </div>
              <h1 className="cx-pdp__title">{name}</h1>
              {L(data.shortDescription, lang) ? <p className="cx-pdp__lead">{L(data.shortDescription, lang)}</p> : null}

              <div className="pdp__meta cx-pdp__meta">
                {data.model ? (
                  <span>
                    {t.product.model} <span className="ltr">{data.model}</span>
                  </span>
                ) : null}
                <span>
                  {t.product.sku} <span className="ltr">{data.sku}</span>
                </span>
                {data.available ? (
                  <span className={`cx-stock ${data.lowStock ? 'cx-stock--low' : ''}`}>{data.lowStock ? t.product.lowStock : t.product.inStock}</span>
                ) : (
                  <span className="cx-stock cx-stock--out">{t.product.outOfStock}</span>
                )}
              </div>

              <div className="cx-pdp__purchase">
                <div className="pdp__price cx-pdp__price">
                  <Price price={data.price} compareAt={data.compareAtPrice} />
                  {data.discountPercent ? <span className="cx-tag cx-tag--accent">{t.product.save(data.discountPercent)}</span> : null}
                </div>
                <small className="cx-pdp__vat">{t.product.vatIncluded}</small>

                <div className="pdp__buy cx-buy">
                  <Quantity label={t.product.quantity} value={qty} onChange={setQty} max={maxQ} />
                  <button className={`cx-btn cx-btn--solid cx-buy__add ${justAdded ? 'is-added' : ''}`} disabled={!data.available} onClick={add} data-testid="add-to-cart">
                    {justAdded ? <Icon name="check" className="icon" /> : <Icon name="bag" className="icon" />}
                    {!data.available ? t.product.outOfStock : justAdded ? t.product.added : t.product.addToCart}
                  </button>
                  <button className="cx-buy__wish" aria-pressed={inWish} aria-label={inWish ? t.product.removeWishlist : t.product.addWishlist} onClick={() => void wish.toggle(data._id)}>
                    <Icon name="heart" />
                  </button>
                </div>

                <ul className="cx-services" aria-label={c.services}>
                  <li>
                    <Icon name="truck" />
                    <div>
                      <strong>{data.delivery.free ? t.product.freeDelivery : t.product.shipping}</strong>
                      <span>
                        {data.delivery.courier ? t.product.deliveryBy(data.delivery.courier) : ''}
                        {L(data.delivery.estimate, lang) ? ` · ${L(data.delivery.estimate, lang)}` : ''}
                      </span>
                    </div>
                  </li>
                  {data.warrantyMonths ? (
                    <li>
                      <Icon name="shield" />
                      <div>
                        <strong>{t.service.warranty(data.warrantyMonths)}</strong>
                        <Link to={p('/page/warranty')}>{t.product.readPolicy}</Link>
                      </div>
                    </li>
                  ) : null}
                  <li>
                    <Icon name="return" />
                    <div>
                      <strong>{t.product.returns}</strong>
                      <Link to={p('/page/returns')}>{t.product.returnsText}</Link>
                    </div>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Below-the-fold product story: animated by the theatre; the purchase area above is never hidden. */}
      <TheatreStage>
      {attrs.length ? (
        <section className="cx-facts is-dark" aria-label={c.keyFacts}>
          <div className="container">
            <span className="cx-eyebrow" data-fx="rise">{c.keyFacts}</span>
            <dl className="cx-facts__grid" data-fx="stagger">
              {attrs.map(([k, v]) => (
                <div key={k} className="cx-facts__item">
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>
      ) : null}

      {L(data.description, lang) ? (
        <section className="cx-pdp__section cx-overview">
          <div className="container cx-split">
            <div>
              <span className="cx-eyebrow">{c.overview}</span>
              <Kinetic text={t.product.description} className="cx-display" />
            </div>
            <div className="cx-overview__text" data-fx="rise">{L(data.description, lang)}</div>
          </div>
        </section>
      ) : null}

      {specRows.length ? (
        <section className="cx-pdp__section cx-specs" aria-labelledby="cx-specs-title">
          <div className="container cx-split">
            <div>
              <span className="cx-eyebrow">{c.techSpecs}</span>
              <Kinetic id="cx-specs-title" text={t.product.specs} className="cx-display" />
            </div>
            <dl className="cx-specs__list" data-fx="stagger">
              {specRows.map(([k, v], i) => (
                <div key={`${k}-${i}`} className="cx-specs__row">
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>
      ) : null}

      {data.isBundle && data.bundleContents.length ? (
        <section className="cx-pdp__section cx-inbox" aria-labelledby="cx-inbox-title">
          <div className="container cx-split">
            <div>
              <span className="cx-eyebrow">{c.inTheBox}</span>
              <h2 id="cx-inbox-title" className="cx-display">
                {t.product.inTheBox}
              </h2>
            </div>
            <ul className="cx-inbox__list" data-fx="stagger">
              {data.bundleContents.map((b, i) =>
                b.product ? (
                  <li key={i}>
                    <Link to={p(`/p/${b.product.slug}`)} className="cx-inbox__item">
                      <span className="cx-inbox__thumb">
                        <ProductImage src={b.product.images?.[0]?.url} image={b.product.images?.[0]} alt="" sizes="80px" />
                      </span>
                      <span className="cx-inbox__name">{L(b.product.name, lang)}</span>
                      <span className="cx-inbox__qty ltr">{b.quantity}×</span>
                    </Link>
                  </li>
                ) : null,
              )}
            </ul>
          </div>
        </section>
      ) : null}

      {data.bundles.length ? (
        <section className="cx-pdp__section cx-pdp__more">
          <div className="container">
            <div className="cx-head">
              <h2 className="cx-display">{t.product.bundlesWith}</h2>
            </div>
            <ProductRail label={t.product.bundlesWith}>
              {data.bundles.map((b) => (
                <ProductCard key={b._id} product={b} />
              ))}
            </ProductRail>
          </div>
        </section>
      ) : null}
      {data.related.length ? (
        <section className="cx-pdp__section cx-pdp__more">
          <div className="container">
            <div className="cx-head">
              <h2 className="cx-display">{t.product.related}</h2>
            </div>
            <ProductRail label={t.product.related}>
              {data.related.map((r, i) => (
                <ProductCard key={r._id} product={r} categorySlug={category?.slug} index={i} sizes="(max-width: 639px) 74vw, (max-width: 1023px) 42vw, 25vw" />
              ))}
            </ProductRail>
          </div>
        </section>
      ) : null}

      </TheatreStage>

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
