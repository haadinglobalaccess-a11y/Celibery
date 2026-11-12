import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent as RKeyboardEvent, type ReactNode } from 'react';
import { Link, Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Logo } from '../components/Logo';
import { Spinner } from '../components/ui';
import { I18nProvider } from '../i18n/I18n';
import { ApiError, qs } from '../lib/api';
import type { Localized } from '../lib/types';
import { ResetPasswordForm } from '../pages/AuthPages';
import { useAuth } from '../state/auth';
import './admin.css';
import './design.css';
import { cachedApi, useAttention } from './data';
import { AdminLangScope, readAdminLang, saveAdminLang, useAT, type AdminLang } from './i18n';
import { AIcon } from './icons';
import { Modal } from './kit';
import { MediaLibraryPage } from './media';
import { MfaEnrollmentGate, MfaSettings } from './security';
import { Categories, Customers, CustomerDetail, Discounts, Inventory } from './pages/Catalog';
import { Content } from './pages/Content';
import { OrderDetail, Orders } from './pages/Orders';
import { Overview } from './pages/Overview';
import { ProductEdit, Products } from './pages/Products';
import { Reports } from './pages/Reports';
import { Returns } from './pages/Returns';
import { AbandonedCheckoutDetail, AbandonedCheckouts } from './pages/AbandonedCheckouts';
import { SettingsPage } from './pages/Settings';
import { ActivityLog, Staff } from './pages/System';
import { FaqManagement } from './pages/Faq';

const MEDIA_PERMS = ['media:write', 'products:write', 'content:write'];
const SETTINGS_PERMS = ['settings:write', 'business:write', 'payments:manage'];

type NavKey = 'faq' | 'dashboard' | 'orders' | 'checkouts' | 'products' | 'categories' | 'inventory' | 'customers' | 'returns' | 'discounts' | 'reports' | 'staff' | 'settings' | 'content' | 'media' | 'activity';
type NavItem = { key: NavKey; to: string; icon: string; perm: string[]; badge?: 'pending' | 'lowStock' };

/** Spec §7 navigation order; existing website-management pages are kept in a second group. */
const NAV: NavItem[] = [
  { key: 'dashboard', to: '/admin', icon: 'dashboard', perm: ['overview:read'] },
  { key: 'orders', to: '/admin/orders', icon: 'orders', perm: ['orders:read'], badge: 'pending' },
  { key: 'checkouts', to: '/admin/checkouts', icon: 'checkouts', perm: ['orders:read'] },
  { key: 'products', to: '/admin/products', icon: 'products', perm: ['products:read'] },
  { key: 'categories', to: '/admin/categories', icon: 'categories', perm: ['categories:write'] },
  { key: 'inventory', to: '/admin/inventory', icon: 'inventory', perm: ['inventory:read'], badge: 'lowStock' },
  { key: 'customers', to: '/admin/customers', icon: 'customers', perm: ['customers:read'] },
  { key: 'returns', to: '/admin/returns', icon: 'returns', perm: ['orders:read'] },
  { key: 'discounts', to: '/admin/discounts', icon: 'discounts', perm: ['discounts:read'] },
  { key: 'reports', to: '/admin/reports', icon: 'reports', perm: ['reports:read'] },
  { key: 'staff', to: '/admin/staff', icon: 'staff', perm: ['staff:manage'] },
  { key: 'settings', to: '/admin/settings', icon: 'settings', perm: SETTINGS_PERMS },
];
const NAV_WEBSITE: NavItem[] = [
  { key: 'content', to: '/admin/content', icon: 'content', perm: ['content:write'] },
  // /admin/faqs (not /admin/faq: the storefront route /:lang/faq would outrank /admin/* for that URL)
  { key: 'faq', to: '/admin/faqs', icon: 'faq', perm: ['content:write'] },
  { key: 'media', to: '/admin/media', icon: 'media', perm: MEDIA_PERMS },
  { key: 'activity', to: '/admin/activity', icon: 'activity', perm: ['audit:read'] },
];

function AdminLogin() {
  const { login, verifyMfa, logout } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // Second step (two-factor authentication): short-lived challenge from the password step.
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const me = await login(email, password);
      if (me.type !== 'staff') {
        await logout();
        setError('This account does not have admin access.');
      }
    } catch (err) {
      const ex = err as ApiError;
      if (ex.code === 'MFA_REQUIRED') {
        setMfaToken((ex.details as { mfaToken: string }).mfaToken);
        setPassword('');
      } else setError(ex.message);
    } finally {
      setBusy(false);
    }
  };
  const submitCode = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await verifyMfa(mfaToken!, code);
    } catch (err) {
      const ex = err as ApiError;
      setError(ex.message);
      setCode('');
      // Expired or locked challenge: start again from the password.
      if (/expired|Too many/i.test(ex.message)) setMfaToken(null);
    } finally {
      setBusy(false);
    }
  };
  if (mfaToken)
    return (
      <div className="admin-login">
        <form className="a-card form-grid" onSubmit={submitCode}>
          <Logo />
          <h1 style={{ fontSize: 20 }}>Two-factor authentication</h1>
          <p className="a-muted" style={{ margin: 0 }}>
            Enter the 6-digit code from your authenticator app, or one of your recovery codes.
          </p>
          <label className="field">
            <span className="label">Code</span>
            <input className="input ltr" autoFocus inputMode="text" autoComplete="one-time-code" maxLength={20} required value={code} onChange={(e) => setCode(e.target.value)} data-testid="admin-mfa-code" />
          </label>
          {error ? <p className="alert alert--error">{error}</p> : null}
          <button className="btn btn--primary" disabled={busy} data-testid="admin-mfa-verify">
            Verify
          </button>
          <button type="button" className="btn" onClick={() => (setMfaToken(null), setCode(''), setError(''))}>
            Back
          </button>
        </form>
      </div>
    );
  return (
    <div className="admin-login">
      <form className="a-card form-grid" onSubmit={submit}>
        <Logo />
        <h1 style={{ fontSize: 20 }}>Admin sign in</h1>
        <label className="field">
          <span className="label">Email</span>
          <input className="input" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="field">
          <span className="label">Password</span>
          <input className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error ? <p className="alert alert--error">{error}</p> : null}
        <button className="btn btn--primary" disabled={busy} data-testid="admin-login">
          Sign in
        </button>
        <Link to="/admin/set-password" className="muted" style={{ fontSize: 13 }}>
          Have an invitation or reset link? Set your password
        </Link>
      </form>
    </div>
  );
}

function SetPassword() {
  return (
    <div className="admin-login">
      <div className="a-card">
        <Logo />
        <h1 style={{ fontSize: 20, marginTop: 16 }}>Set your password</h1>
        <ResetPasswordForm loginHref="/admin" />
      </div>
    </div>
  );
}

function Forbidden() {
  const { t } = useAT();
  return <div className="alert alert--warning">{t.shell.forbidden}</div>;
}

/** Pages not translated yet stay English LTR inside the Arabic shell — never half-translated. */
function EnglishOnly({ lang, children }: { lang: AdminLang; children: ReactNode }) {
  const { t } = useAT();
  if (lang === 'en') return <>{children}</>;
  return (
    <>
      <p className="a-notice" role="note">
        {t.shell.notTranslated}
      </p>
      <I18nProvider lang="en">
        <AdminLangScope lang="en">
          <div dir="ltr" lang="en" className="a-en-scope">
            {children}
          </div>
        </AdminLangScope>
      </I18nProvider>
    </>
  );
}

/* ───────────── Global search (Ctrl/⌘ + K) ───────────── */
type Hit = { group: 'orders' | 'customers' | 'products'; id: string; title: string; sub: string; to: string };

function GlobalSearch({ perms }: { perms: Set<string> }) {
  const { t } = useAT();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hits, setHits] = useState<Hit[]>([]);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement | null>(null);
  const box = useRef<HTMLDivElement | null>(null);
  const listId = useId();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        input.current?.focus();
        setOpen(true);
      }
    };
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, []);

  // Debounced (spec §24): one round of requests 250 ms after typing stops.
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setHits([]);
      setBusy(false);
      return;
    }
    setBusy(true);
    let alive = true;
    const id = setTimeout(() => {
      const jobs: Promise<Hit[]>[] = [];
      if (perms.has('orders:read'))
        jobs.push(
          cachedApi<{ _id: string; orderNumber: string; contact: { name: string }; status: string }[]>(`/api/admin/orders${qs({ q: term, limit: 5 })}`).then((r) =>
            r.data.map((o) => ({ group: 'orders' as const, id: o._id, title: o.orderNumber, sub: `${o.contact.name} · ${t.status[o.status] ?? o.status}`, to: `/admin/orders/${o._id}` })),
          ),
        );
      if (perms.has('customers:read'))
        jobs.push(
          cachedApi<{ _id: string; name: string; email: string; phone?: string }[]>(`/api/admin/customers${qs({ q: term, limit: 5 })}`).then((r) =>
            r.data.map((c) => ({ group: 'customers' as const, id: c._id, title: c.name, sub: c.email || c.phone || '', to: `/admin/customers/${c._id}` })),
          ),
        );
      if (perms.has('products:read'))
        jobs.push(
          cachedApi<{ _id: string; sku: string; name: Localized }[]>(`/api/admin/products${qs({ q: term, limit: 5 })}`).then((r) =>
            r.data.map((p) => ({ group: 'products' as const, id: p._id, title: p.name?.en || p.name?.ar || p.sku, sub: p.sku, to: `/admin/products/${p._id}` })),
          ),
        );
      void Promise.allSettled(jobs).then((res) => {
        if (!alive) return;
        setHits(res.flatMap((r) => (r.status === 'fulfilled' ? r.value : [])));
        setActive(0);
        setBusy(false);
      });
    }, 250);
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [q, perms, t]);

  const go = (h: Hit) => {
    setOpen(false);
    setQ('');
    nav(h.to);
  };
  const onKey = (e: RKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setOpen(false);
      input.current?.blur();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(hits.length - 1, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter' && hits[active]) {
      e.preventDefault();
      go(hits[active]);
    }
  };
  const groups: [Hit['group'], string][] = [
    ['orders', t.shell.groupOrders],
    ['customers', t.shell.groupCustomers],
    ['products', t.shell.groupProducts],
  ];
  const showPanel = open && q.trim().length >= 2;
  return (
    <div className="a-search" ref={box}>
      <AIcon name="search" size={18} />
      <input
        ref={input}
        type="search"
        role="combobox"
        aria-label={t.shell.searchLabel}
        aria-expanded={showPanel}
        aria-controls={listId}
        aria-activedescendant={showPanel && hits[active] ? `${listId}-${active}` : undefined}
        placeholder={t.shell.searchPlaceholder}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKey}
      />
      <kbd className="a-kbd" aria-hidden="true">
        Ctrl K
      </kbd>
      {showPanel ? (
        <div className="a-pop a-search__panel" id={listId} role="listbox" aria-label={t.shell.searchLabel}>
          {busy ? <p className="a-pop__note">{t.shell.searching}</p> : null}
          {!busy && !hits.length ? <p className="a-pop__note">{t.shell.noResults}</p> : null}
          {!busy
            ? groups.map(([g, label]) => {
                const items = hits.map((h, i) => ({ h, i })).filter((x) => x.h.group === g);
                if (!items.length) return null;
                return (
                  <div key={g} role="group" aria-label={label}>
                    <div className="a-pop__group">{label}</div>
                    {items.map(({ h, i }) => (
                      <div
                        key={`${g}-${h.id}`}
                        id={`${listId}-${i}`}
                        role="option"
                        aria-selected={i === active}
                        className={`a-pop__item ${i === active ? 'is-active' : ''}`}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          go(h);
                        }}
                        onMouseEnter={() => setActive(i)}
                      >
                        <strong className={g === 'orders' || g === 'products' ? 'ltr' : undefined}>{h.title}</strong>
                        <span>{h.sub}</span>
                      </div>
                    ))}
                  </div>
                );
              })
            : null}
        </div>
      ) : null}
    </div>
  );
}

/* ───────────── Notifications (derived from live counts — never an invented feed) ───────────── */
function Notifications({ attention }: { attention: ReturnType<typeof useAttention> }) {
  const { t } = useAT();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);
  const items = [
    attention.pending ? { text: t.shell.pendingOrders(attention.pending), to: '/admin/orders?status=pending' } : null,
    attention.review ? { text: t.shell.paymentReview(attention.review), to: '/admin/orders' } : null,
    attention.lowStock ? { text: t.shell.lowStock(attention.lowStock), to: '/admin/inventory?lowStock=1' } : null,
  ].filter(Boolean) as { text: string; to: string }[];
  return (
    <div className="a-menu" ref={box}>
      <button type="button" className="a-iconbtn" aria-label={t.shell.notifications} aria-expanded={open} aria-haspopup="true" onClick={() => setOpen((o) => !o)}>
        <AIcon name="bell" />
        {items.length ? <span className="a-dotbadge" aria-hidden="true" /> : null}
      </button>
      {open ? (
        <div className="a-pop a-pop--end" role="dialog" aria-label={t.shell.notifications}>
          <div className="a-pop__group">{t.shell.needsAttention}</div>
          {items.length ? (
            items.map((it) => (
              <Link key={it.to + it.text} className="a-pop__item" to={it.to} onClick={() => setOpen(false)}>
                <span className="a-pop__alert" aria-hidden="true">
                  <AIcon name="alert" size={16} />
                </span>
                <span>{it.text}</span>
              </Link>
            ))
          ) : (
            <p className="a-pop__note">{t.shell.allClear}</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

/* ───────────── User menu ───────────── */
function UserMenu({ lang, setLang }: { lang: AdminLang; setLang: (l: AdminLang) => void }) {
  const { t } = useAT();
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState<'profile' | 'prefs' | null>(null);
  const box = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);
  if (!user) return null;
  const roleName = (lang === 'ar' ? user.role?.name?.ar : user.role?.name?.en) || user.role?.name?.en || 'Staff';
  const initials = user.name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
  return (
    <div className="a-menu" ref={box}>
      <button type="button" className="a-user" aria-expanded={open} aria-haspopup="true" onClick={() => setOpen((o) => !o)}>
        <span className="a-avatar" aria-hidden="true">
          {initials}
        </span>
        <span className="a-user__text">
          <strong>{user.name}</strong>
          <span>{roleName}</span>
        </span>
        <AIcon name="chevron" size={16} />
      </button>
      {open ? (
        <div className="a-pop a-pop--end" role="menu">
          <button type="button" role="menuitem" className="a-pop__item" onClick={() => (setPanel('profile'), setOpen(false))}>
            <AIcon name="user" size={16} /> {t.shell.profile}
          </button>
          <button type="button" role="menuitem" className="a-pop__item" onClick={() => (setPanel('prefs'), setOpen(false))}>
            <AIcon name="settings" size={16} /> {t.shell.preferences}
          </button>
          <button type="button" role="menuitem" className="a-pop__item" onClick={() => void logout()}>
            <AIcon name="logout" size={16} /> {t.shell.logout}
          </button>
        </div>
      ) : null}
      {panel === 'profile' ? (
        <Modal title={t.shell.profile} onClose={() => setPanel(null)}>
          <dl className="a-kv">
            <dt>{t.order.name}</dt>
            <dd>{user.name}</dd>
            <dt>{t.shell.email}</dt>
            <dd className="ltr">{user.email}</dd>
            <dt>{t.shell.role}</dt>
            <dd>{roleName}</dd>
            <dt>{t.shell.permissions}</dt>
            <dd className="a-perms ltr">{(user.role?.permissions ?? []).join(' · ') || '—'}</dd>
          </dl>
          <MfaSettings />
        </Modal>
      ) : null}
      {panel === 'prefs' ? (
        <Modal title={t.shell.preferences} onClose={() => setPanel(null)}>
          <fieldset className="a-fieldset">
            <legend>{t.shell.prefLanguage}</legend>
            <label className="check">
              <input type="radio" name="admin-lang" checked={lang === 'ar'} onChange={() => setLang('ar')} /> العربية
            </label>
            <label className="check">
              <input type="radio" name="admin-lang" checked={lang === 'en'} onChange={() => setLang('en')} /> English
            </label>
            <p className="a-muted">{t.shell.prefNote}</p>
          </fieldset>
        </Modal>
      ) : null}
    </div>
  );
}

/* ───────────── Shell ───────────── */
function Shell({ lang, setLang }: { lang: AdminLang; setLang: (l: AdminLang) => void }) {
  const { t } = useAT();
  const { user } = useAuth();
  const loc = useLocation();
  const [menu, setMenu] = useState(false);
  useEffect(() => setMenu(false), [loc.pathname]);

  const perms = useMemo(() => new Set(user?.role?.permissions ?? []), [user]);
  const can = useCallback((p: string) => perms.has(p), [perms]);
  const canAny = useCallback((list: string[]) => list.some((p) => perms.has(p)), [perms]);
  // Counts refresh on navigation (served from the 60 s cache in between).
  const attention = useAttention(perms, loc.pathname);

  const guard = (perm: string | string[], el: JSX.Element) => ((Array.isArray(perm) ? canAny(perm) : can(perm)) ? el : <Forbidden />);
  const en = (el: JSX.Element) => <EnglishOnly lang={lang}>{el}</EnglishOnly>;
  const visible = NAV.filter((n) => canAny(n.perm));
  const visibleWebsite = NAV_WEBSITE.filter((n) => canAny(n.perm));
  const first = [...visible, ...visibleWebsite][0];
  const current = [...NAV, ...NAV_WEBSITE]
    .filter((n) => (n.to === '/admin' ? loc.pathname === '/admin' || loc.pathname === '/admin/' : loc.pathname.startsWith(n.to)))
    .sort((a, b) => b.to.length - a.to.length)[0];

  const badgeOf = (n: NavItem) => (n.badge === 'pending' ? attention.pending : n.badge === 'lowStock' ? attention.lowStock : null);
  const link = (n: NavItem) => {
    const count = badgeOf(n);
    const label = t.nav[n.key];
    return (
      <NavLink key={n.to} to={n.to} end={n.to === '/admin'} className="a-nav__item" aria-label={label}>
        <AIcon name={n.icon} />
        <span className="a-nav__label">{label}</span>
        {count ? (
          <span className="a-badge" aria-hidden="true" title={String(count)}>
            {count > 99 ? '99+' : count}
          </span>
        ) : null}
      </NavLink>
    );
  };

  return (
    <div className="admin a-shell">
      <aside className={`a-side ${menu ? 'is-open' : ''}`} aria-label={t.shell.menu}>
        <div className="a-side__brand">
          <Logo onDark />
        </div>
        <nav className="a-nav">{visible.map(link)}</nav>
        {visibleWebsite.length ? (
          <nav className="a-nav a-nav--secondary" aria-label={t.nav.website}>
            <div className="a-nav__heading">{t.nav.website}</div>
            {visibleWebsite.map(link)}
          </nav>
        ) : null}
        <a className="a-nav__item a-nav__store" href="/" target="_blank" rel="noreferrer">
          <AIcon name="store" />
          <span className="a-nav__label">{t.nav.viewStore}</span>
        </a>
      </aside>
      {menu ? <div className="a-scrim" onClick={() => setMenu(false)} /> : null}
      <div className="a-main">
        <header className="a-top">
          <button type="button" className="a-iconbtn a-only-narrow" onClick={() => setMenu(true)} aria-label={t.shell.menu}>
            <AIcon name="menu" />
          </button>
          <div className="a-top__title">{current ? t.nav[current.key] : ''}</div>
          <div className="a-top__tools">
            <GlobalSearch perms={perms} />
            <Notifications attention={attention} />
            <div className="a-lang" role="group" aria-label={t.shell.language}>
              <button type="button" aria-pressed={lang === 'ar'} onClick={() => setLang('ar')} lang="ar">
                AR
              </button>
              <button type="button" aria-pressed={lang === 'en'} onClick={() => setLang('en')} lang="en">
                EN
              </button>
            </div>
            <UserMenu lang={lang} setLang={setLang} />
          </div>
        </header>
        <main className="a-content" id="admin-main">
          <Routes>
            <Route index element={can('overview:read') ? <Overview /> : first ? <Navigate to={first.to} replace /> : <Forbidden />} />
            <Route path="orders" element={guard('orders:read', <Orders />)} />
            <Route path="orders/:id" element={guard('orders:read', <OrderDetail perms={perms} />)} />
            <Route path="checkouts" element={guard('orders:read', en(<AbandonedCheckouts />))} />
            <Route path="checkouts/:id" element={guard('orders:read', en(<AbandonedCheckoutDetail canDelete={can('orders:write')} />))} />
            <Route path="returns" element={guard('orders:read', <Returns />)} />
            <Route path="products" element={guard('products:read', en(<Products canWrite={can('products:write')} />))} />
            <Route path="products/new" element={guard('products:write', en(<ProductEdit />))} />
            <Route path="products/:id" element={guard('products:read', en(<ProductEdit />))} />
            <Route path="categories" element={guard('categories:write', en(<Categories />))} />
            <Route path="inventory" element={guard('inventory:read', en(<Inventory canWrite={can('inventory:write')} />))} />
            <Route path="customers" element={guard('customers:read', en(<Customers />))} />
            <Route path="customers/:id" element={guard('customers:read', en(<CustomerDetail />))} />
            <Route path="discounts" element={guard('discounts:read', en(<Discounts canWrite={can('discounts:write')} />))} />
            <Route path="content" element={guard('content:write', en(<Content canSettings={can('settings:write')} canReviews={can('reviews:moderate')} />))} />
            <Route path="reports" element={guard('reports:read', en(<Reports />))} />
            <Route path="staff" element={guard('staff:manage', en(<Staff />))} />
            <Route path="media" element={guard(MEDIA_PERMS, en(<MediaLibraryPage />))} />
            <Route path="faqs" element={guard('content:write', en(<FaqManagement />))} />
            <Route path="settings" element={guard(SETTINGS_PERMS, en(<SettingsPage />))} />
            <Route path="activity" element={guard('audit:read', en(<ActivityLog />))} />
            <Route path="*" element={<Navigate to="/admin" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

export default function AdminApp() {
  const { user, ready } = useAuth();
  const loc = useLocation();
  const [lang, setLangState] = useState<AdminLang>(readAdminLang);
  const setLang = useCallback((l: AdminLang) => {
    setLangState(l);
    saveAdminLang(l);
  }, []);
  const signedIn = Boolean(user && user.type === 'staff');
  // The whole dashboard follows the language: Arabic RTL, English LTR (sign-in stays English).
  const docLang: AdminLang = signedIn ? lang : 'en';
  useEffect(() => {
    document.documentElement.lang = docLang;
    document.documentElement.dir = docLang === 'ar' ? 'rtl' : 'ltr';
    document.title = docLang === 'ar' ? 'لوحة تحكم سيليبري' : 'CELIBERY Admin';
  }, [docLang]);

  if (loc.pathname.startsWith('/admin/set-password'))
    return (
      <I18nProvider lang="en">
        <SetPassword />
      </I18nProvider>
    );
  if (!ready) return <Spinner label="Loading…" />;
  if (!signedIn)
    return (
      <I18nProvider lang="en">
        <AdminLogin />
      </I18nProvider>
    );
  if (user?.mfa?.required && !user.mfa.enabled)
    return (
      <I18nProvider lang="en">
        <MfaEnrollmentGate />
      </I18nProvider>
    );
  return (
    <I18nProvider lang={lang}>
      <AdminLangScope lang={lang}>
        <Shell lang={lang} setLang={setLang} />
      </AdminLangScope>
    </I18nProvider>
  );
}
