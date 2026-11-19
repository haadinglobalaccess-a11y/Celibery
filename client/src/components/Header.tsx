import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useI18n } from '../i18n/I18n';
import { L, placeholderFor } from '../lib/format';
import { cloudinaryAt } from '../lib/media';
import { useCached } from '../lib/hooks';
import { useScrolled } from '../lib/motion';
import type { HomeData } from '../lib/types';
import { useAuth } from '../state/auth';
import { useCart } from '../state/cart';
import { useMoney } from '../state/currency';
import { useSettings } from '../state/settings';
import { useWishlist } from '../state/wishlist';
import { CartPeek } from './CartPeek';
import { storeCopy } from '../storefront/copy';
import { CurrencySelect } from './CurrencySelect';
import { Chevron, Icon } from './Icon';
import { Logo } from './Logo';
import { Price } from './ui';

function SearchBox({ onDone, autoFocus = false }: { onDone?: () => void; autoFocus?: boolean }) {
  const { t, p } = useI18n();
  const nav = useNavigate();
  const loc = useLocation();
  const [q, setQ] = useState(() => new URLSearchParams(loc.search).get('q') ?? '');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const v = q.trim();
    if (!v) return;
    nav(p(`/search?q=${encodeURIComponent(v)}`));
    onDone?.();
  };
  return (
    <form role="search" className="searchbox" onSubmit={submit}>
      <Icon name="search" />
      <label className="sr-only" htmlFor={autoFocus ? 'search-m' : 'search-d'}>
        {t.nav.search}
      </label>
      <input
        id={autoFocus ? 'search-m' : 'search-d'}
        className="input"
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={t.nav.searchPlaceholder}
        autoFocus={autoFocus}
        enterKeyHint="search"
      />
    </form>
  );
}

export function Header() {
  const { t, p, lang, switchHref } = useI18n();
  const money = useMoney();
  const { count } = useCart();
  const wish = useWishlist();
  const { user } = useAuth();
  const settings = useSettings();
  const { data: home } = useCached<HomeData>('/api/home');
  const [mega, setMega] = useState(false);
  const [megaCat, setMegaCat] = useState<string | null>(null);
  const [mobile, setMobile] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const loc = useLocation();
  const megaRef = useRef<HTMLDivElement>(null);
  const mobileRef = useRef<HTMLElement>(null);
  const scrolled = useScrolled(40);
  const [heroOverlay, setHeroOverlay] = useState(false);

  useEffect(() => {
    setHeroOverlay(Boolean(document.querySelector('.campaign-hero-slider')));
  }, [loc.pathname, home]);

  useEffect(() => {
    setMega(false);
    setMobile(false);
    setSearchOpen(false);
  }, [loc.pathname, loc.search]);

  useEffect(() => {
    if (!mobile) return;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    mobileRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const items = mobileRef.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input');
      if (!items?.length) return;
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', trap);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener('keydown', trap);
      if (previous?.isConnected) previous.focus();
    };
  }, [mobile]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMega(false);
        setMobile(false);
        setSearchOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const categories = home?.categories ?? [];
  const productsFor = (id: string) => home?.categoryProducts.find((c) => c.categoryId === id)?.items ?? [];
  const copy = storeCopy(lang);
  const activeCat = categories.find((c) => c._id === megaCat) ?? categories[0];
  const months = settings?.commerce?.warrantyMonths ?? 0;

  return (
    <>
      <Announcement
        fallback={[
          // Only claim free delivery when Admin → Settings → Shipping says so.
          settings?.commerce?.freeDelivery !== false
            ? t.service.delivery
            : settings.commerce.freeDeliveryThreshold
              ? t.checkout.freeFrom(money(settings.commerce.freeDeliveryThreshold))
              : '',
          settings?.commerce?.warrantyEnabled && months ? t.service.warranty(months) : '',
        ]
          .filter(Boolean)
          .join(' · ')}
      />
      <header className={`header ${scrolled ? 'is-scrolled' : ''}`} onMouseLeave={() => setMega(false)}>
        <div className="container header__bar">
          <button className="icon-btn mobile-only" aria-label={t.nav.menu} aria-expanded={mobile} onClick={() => setMobile(true)}>
            <Icon name="menu" />
          </button>
          <Link to={p('/')} className="header__brand" aria-label={t.a11y.home}>
            <Logo onDark={heroOverlay && !scrolled} />
          </Link>
          <nav className="header__nav" aria-label={t.a11y.mainNav}>
            <button aria-expanded={mega} aria-controls="mega" onClick={() => setMega((v) => !v)} onMouseEnter={() => setMega(true)} onFocus={() => setMega(true)}>
              {t.nav.shop} <Icon name="chevronDown" className="icon" />
            </button>
            <Link to={p('/bundles')}>{t.nav.bundles}</Link>
            <Link to={p('/track')}>{t.nav.track}</Link>
            <Link to={p('/faq')}>{t.footer.help}</Link>
          </nav>
          <div className="header__actions">
            <Link className="lang-switch" to={switchHref} hrefLang={lang === 'ar' ? 'en' : 'ar'} lang={lang === 'ar' ? 'en' : 'ar'} data-testid="lang-switch" aria-label={t.nav.language}>
              <span className="hide-sm">{t.nav.language}</span>
              <span className="show-sm" aria-hidden="true">
                {t.nav.languageShort}
              </span>
            </Link>
            <CurrencySelect />
            <button className="icon-btn" aria-label={t.nav.search} aria-expanded={searchOpen} data-testid="search-toggle" onClick={() => setSearchOpen((v) => !v)}>
              <Icon name="search" />
            </button>
            <Link className="icon-btn hide-sm" to={p('/wishlist')} aria-label={t.nav.wishlist}>
              <Icon name="heart" />
              {wish.ids.size ? <span className="badge-count">{wish.ids.size}</span> : null}
            </Link>
            <Link className="icon-btn hide-sm" to={user?.type === 'customer' ? p('/account') : p('/login')} aria-label={user ? t.nav.account : t.nav.login}>
              <Icon name="user" />
            </Link>
            <Link className="icon-btn" to={p('/cart')} aria-label={`${t.nav.cart} (${count})`} data-testid="cart-link">
              <Icon name="bag" />
              {count ? (
                <span key={count} className="badge-count" data-testid="cart-count">
                  {count}
                </span>
              ) : null}
            </Link>
          </div>
        </div>
        {searchOpen ? (
          <div className="container" style={{ paddingBottom: 12 }}>
            <SearchBox autoFocus onDone={() => setSearchOpen(false)} />
            <nav className="search-categories" aria-label={t.home.categories}>
              {categories.map(category => <Link key={category._id} to={p(`/c/${category.slug}`)}>{L(category.name, lang)}</Link>)}
            </nav>
          </div>
        ) : null}
        {mega && activeCat ? (
          /* Two-pane mega menu: category list on the start side; the hovered/focused category's real
             products (from /api/home) on the other. Every row is a plain link, so keyboard and
             screen-reader users get the same content; hover/focus only changes which list is shown. */
          <div className="mega" id="mega" ref={megaRef}>
            <div className="container mx">
              <div className="mx__cats">
                <p className="mx__label">{copy.byCategory}</p>
                <ul>
                  {categories.map((c) => (
                    <li key={c._id}>
                      <Link
                        to={p(`/c/${c.slug}`)}
                        className="mx__cat"
                        aria-current={c._id === activeCat._id ? 'true' : undefined}
                        onMouseEnter={() => setMegaCat(c._id)}
                        onFocus={() => setMegaCat(c._id)}
                      >
                        <span>{L(c.name, lang)}</span>
                        <Chevron />
                      </Link>
                    </li>
                  ))}
                </ul>
                <div className="mx__more">
                  <Link to={p('/bundles')}>{t.nav.bundles}</Link>
                  <Link to={p('/shop')}>{t.nav.allProducts}</Link>
                </div>
              </div>
              <div className="mx__panel" key={activeCat._id}>
                <div className="mx__grid">
                  {productsFor(activeCat._id)
                    .slice(0, 6)
                    .map((pr, i) => (
                      <Link key={pr._id} to={p(`/p/${pr.slug}`)} className="mx__item" style={{ '--i': i } as CSSProperties}>
                        <span className="mx__thumb">
                          <img src={cloudinaryAt(pr.images?.[0]?.url, 160) || placeholderFor(activeCat.slug)} alt="" width={72} height={72} loading="lazy" decoding="async" />
                        </span>
                        <span className="mx__text">
                          <strong>{L(pr.name, lang)}</strong>
                          <Price price={pr.price} compareAt={pr.compareAtPrice} className="mx__price" />
                        </span>
                      </Link>
                    ))}
                </div>
                <Link to={p(`/c/${activeCat.slug}`)} className="mx__all">
                  {copy.viewAllIn(L(activeCat.name, lang))} <Chevron />
                </Link>
              </div>
            </div>
          </div>
        ) : null}
        <CartPeek />
      </header>

      {mobile ? (
        <>
          <div className="overlay" onClick={() => setMobile(false)} />
          <aside ref={mobileRef} className="drawer drawer--start" role="dialog" aria-modal="true" aria-label={t.nav.menu}>
            <div className="drawer__head">
              <Logo />
              <button className="icon-btn" aria-label={t.nav.close} onClick={() => setMobile(false)}>
                <Icon name="close" />
              </button>
            </div>
            <nav className="drawer__body mnav stagger is-visible">
              <Link to={p('/shop')}>{t.nav.allProducts}</Link>
              {categories.map((c) => (
                <Link key={c._id} to={p(`/c/${c.slug}`)}>
                  {L(c.name, lang)}
                </Link>
              ))}
              <Link to={p('/bundles')}>{t.nav.bundles}</Link>
              <Link to={p('/faq')}>{t.footer.help}</Link>
              <Link to={p('/track')} className="mnav__util mnav__util--first">
                {t.nav.track}
              </Link>
              <Link to={p('/wishlist')} className="mnav__util">
                {t.nav.wishlist}
                {wish.ids.size ? <span className="badge">{wish.ids.size}</span> : null}
              </Link>
              <Link to={user?.type === 'customer' ? p('/account') : p('/login')} className="mnav__util">
                {user ? t.nav.account : t.nav.login}
              </Link>
              <Link to={switchHref} className="mnav__util mnav__lang">
                <span>
                  <Icon name="globe" className="icon" /> {t.nav.language}
                </span>
              </Link>
            </nav>
          </aside>
        </>
      ) : null}
    </>
  );
}

/** Announcement bar (Admin → Settings → Store): custom bilingual text and link, or the default delivery & warranty message. */
function Announcement({ fallback }: { fallback: string }) {
  const { lang, p } = useI18n();
  const settings = useSettings();
  // Until the store's settings are known (first visit: no device snapshot yet) nothing is shown, so a
  // bar the Admin has switched off never appears and then collapses, moving the page (layout shift).
  if (!settings) return null;
  const a = settings.announcement;
  if (a && a.enabled === false) return null;
  const text = (a && L(a.text, lang)) || fallback;
  if (!text) return null;
  const link = a?.link?.trim();
  if (!link) return <div className="announce">{text}</div>;
  if (link.startsWith('/')) {
    const to = /^\/(ar|en)(\/|$)/.test(link) ? link : p(link);
    return (
      <Link className="announce announce--link" to={to}>
        {text} <span aria-hidden="true">→</span>
      </Link>
    );
  }
  return /^https:\/\//.test(link) ? (
    <a className="announce announce--link" href={link} rel="noopener noreferrer">
      {text} <span aria-hidden="true">→</span>
    </a>
  ) : (
    <div className="announce">{text}</div>
  );
}

