import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useI18n } from '../i18n/I18n';
import { L, placeholderFor } from '../lib/format';
import { useCached } from '../lib/hooks';
import { useScrolled } from '../lib/motion';
import type { HomeData } from '../lib/types';
import { useAuth } from '../state/auth';
import { useCart } from '../state/cart';
import { useSettings } from '../state/settings';
import { useWishlist } from '../state/wishlist';
import { CartPeek } from './CartPeek';
import { Icon } from './Icon';
import { Logo } from './Logo';

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
  const { count } = useCart();
  const wish = useWishlist();
  const { user } = useAuth();
  const settings = useSettings();
  const { data: home } = useCached<HomeData>('/api/home');
  const [mega, setMega] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const loc = useLocation();
  const megaRef = useRef<HTMLDivElement>(null);
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
  const months = settings?.commerce?.warrantyMonths ?? 0;

  return (
    <>
      <Announcement fallback={`${t.service.delivery}${settings?.commerce?.warrantyEnabled && months ? ` Â· ${t.service.warranty(months)}` : ''}`} />
      <header className={`header ${scrolled ? 'is-scrolled' : ''}`} onMouseLeave={() => setMega(false)}>
        <div className="container header__bar">
          <button className="icon-btn mobile-only" aria-label={t.nav.menu} aria-expanded={mobile} onClick={() => setMobile(true)}>
            <Icon name="menu" />
          </button>
          <Link to={p('/')} aria-label="CELIBERY â€” home">
            <Logo onDark={heroOverlay && !scrolled} />
          </Link>
          <nav className="header__nav" aria-label="Main">
            <button aria-expanded={mega} aria-controls="mega" onClick={() => setMega((v) => !v)} onMouseEnter={() => setMega(true)}>
              {t.nav.shop} <Icon name="chevronDown" className="icon" />
            </button>
            <Link to={p('/bundles')}>{t.nav.bundles}</Link>
            <Link to={p('/track')}>{t.nav.track}</Link>
          </nav>
          <div className="header__actions">
            <Link className="lang-switch" to={switchHref} hrefLang={lang === 'ar' ? 'en' : 'ar'} lang={lang === 'ar' ? 'en' : 'ar'} data-testid="lang-switch" aria-label={t.nav.language}>
              <span className="hide-sm">{t.nav.language}</span>
              <span className="show-sm" aria-hidden="true">
                {t.nav.languageShort}
              </span>
            </Link>
            <button className="icon-btn mobile-only" aria-label={t.nav.search} onClick={() => setSearchOpen((v) => !v)}>
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
          </div>
        ) : null}
        {mega ? (
          <div className="mega" id="mega" ref={megaRef}>
            <div className="container mega__grid">
              {categories.map((c, i) => (
                <Link key={c._id} to={p(`/c/${c.slug}`)} className="mega__cat" style={{ '--i': i } as CSSProperties}>
                  <img src={c.image?.url || placeholderFor(c.slug)} alt="" loading="lazy" />
                  <span>
                    <strong>{L(c.name, lang)}</strong>
                    <ul>
                      {productsFor(c._id)
                        .slice(0, 3)
                        .map((pr) => (
                          <li key={pr._id}>{L(pr.name, lang)}</li>
                        ))}
                    </ul>
                  </span>
                </Link>
              ))}
              <div className="mega__side">
                <span className="muted">{t.home.bundlesText}</span>
                <Link to={p('/bundles')}>{t.nav.bundles} â†’</Link>
                <Link to={p('/shop')}>{t.nav.allProducts} â†’</Link>
              </div>
            </div>
          </div>
        ) : null}
        <CartPeek />
      </header>

      {mobile ? (
        <>
          <div className="overlay" onClick={() => setMobile(false)} />
          <aside className="drawer drawer--start" role="dialog" aria-modal="true" aria-label={t.nav.menu}>
            <div className="drawer__head">
              <Logo onDark={heroOverlay && !scrolled} />
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
              <Link to={p('/track')}>{t.nav.track}</Link>
              <Link to={p('/wishlist')}>
                {t.nav.wishlist}
                {wish.ids.size ? <span className="badge">{wish.ids.size}</span> : null}
              </Link>
              <Link to={user?.type === 'customer' ? p('/account') : p('/login')}>{user ? t.nav.account : t.nav.login}</Link>
              <Link to={switchHref}>
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

/** Announcement bar (Admin â†’ Settings â†’ Store): custom bilingual text and link, or the default delivery & warranty message. */
function Announcement({ fallback }: { fallback: string }) {
  const { lang, p } = useI18n();
  const settings = useSettings();
  const a = settings?.announcement;
  if (a && a.enabled === false) return null;
  const text = (a && L(a.text, lang)) || fallback;
  const link = a?.link?.trim();
  if (!link) return <div className="announce">{text}</div>;
  if (link.startsWith('/')) {
    const to = /^\/(ar|en)(\/|$)/.test(link) ? link : p(link);
    return (
      <Link className="announce announce--link" to={to}>
        {text} <span aria-hidden="true">â†’</span>
      </Link>
    );
  }
  return /^https:\/\//.test(link) ? (
    <a className="announce announce--link" href={link} rel="noopener noreferrer">
      {text} <span aria-hidden="true">â†’</span>
    </a>
  ) : (
    <div className="announce">{text}</div>
  );
}

