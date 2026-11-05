import { useEffect, useState, type FormEvent } from 'react';
import { Link, Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { Logo } from '../components/Logo';
import { Spinner } from '../components/ui';
import { I18nProvider } from '../i18n/I18n';
import { ApiError } from '../lib/api';
import { ResetPasswordForm } from '../pages/AuthPages';
import { useAuth } from '../state/auth';
import './admin.css';
import { Categories, Customers, CustomerDetail, Discounts, Inventory } from './pages/Catalog';
import { Content } from './pages/Content';
import { OrderDetail, Orders } from './pages/Orders';
import { Overview } from './pages/Overview';
import { ProductEdit, Products } from './pages/Products';
import { Reports } from './pages/Reports';
import { MediaLibraryPage } from './media';
import { SettingsPage } from './pages/Settings';
import { ActivityLog, Staff } from './pages/System';

const MEDIA_PERMS = ['media:write', 'products:write', 'content:write'];
const SETTINGS_PERMS = ['settings:write', 'business:write', 'payments:manage'];

/** `perm`: the item shows when the staff member holds ANY of these permissions. */
const NAV: { to: string; label: string; icon: string; perm: string[] }[] = [
  { to: '/admin', label: 'Overview', icon: 'grid', perm: ['overview:read'] },
  { to: '/admin/orders', label: 'Orders', icon: 'bag', perm: ['orders:read'] },
  { to: '/admin/products', label: 'Products', icon: 'box', perm: ['products:read'] },
  { to: '/admin/categories', label: 'Categories', icon: 'filter', perm: ['categories:write'] },
  { to: '/admin/inventory', label: 'Inventory', icon: 'box', perm: ['inventory:read'] },
  { to: '/admin/customers', label: 'Customers', icon: 'user', perm: ['customers:read'] },
  { to: '/admin/discounts', label: 'Discounts', icon: 'bolt', perm: ['discounts:read'] },
  { to: '/admin/content', label: 'Website content', icon: 'globe', perm: ['content:write'] },
  { to: '/admin/media', label: 'Media library', icon: 'grid', perm: MEDIA_PERMS },
  { to: '/admin/reports', label: 'Reports', icon: 'grid', perm: ['reports:read'] },
  { to: '/admin/staff', label: 'Staff & roles', icon: 'shield', perm: ['staff:manage'] },
  { to: '/admin/settings', label: 'Settings', icon: 'lock', perm: SETTINGS_PERMS },
  { to: '/admin/activity', label: 'Activity log', icon: 'return', perm: ['audit:read'] },
];

function AdminLogin() {
  const { login, logout } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
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
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  };
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
  return <div className="alert alert--warning">You do not have permission to view this page.</div>;
}

export default function AdminApp() {
  const { user, ready, logout } = useAuth();
  const loc = useLocation();
  const [menu, setMenu] = useState(false);
  useEffect(() => setMenu(false), [loc.pathname]);
  useEffect(() => {
    document.documentElement.lang = 'en';
    document.documentElement.dir = 'ltr';
    document.title = 'CELIBERY Admin';
  }, []);

  if (loc.pathname.startsWith('/admin/set-password'))
    return (
      <I18nProvider lang="en">
        <SetPassword />
      </I18nProvider>
    );
  if (!ready) return <Spinner label="Loading…" />;
  if (!user || user.type !== 'staff')
    return (
      <I18nProvider lang="en">
        <AdminLogin />
      </I18nProvider>
    );

  const perms = new Set(user.role?.permissions ?? []);
  const can = (p: string) => perms.has(p);
  const canAny = (list: string[]) => list.some(can);
  const guard = (perm: string | string[], el: JSX.Element) => ((Array.isArray(perm) ? canAny(perm) : can(perm)) ? el : <Forbidden />);
  const first = NAV.find((n) => canAny(n.perm));

  return (
    <I18nProvider lang="en">
      <div className="admin">
        <aside className={`admin__side ${menu ? 'open' : ''}`}>
          <Logo onDark />
          {NAV.filter((n) => canAny(n.perm)).map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === '/admin'}>
              <Icon name={n.icon} /> {n.label}
            </NavLink>
          ))}
          <a href="/" target="_blank" rel="noreferrer" style={{ marginTop: 'auto' }}>
            <Icon name="globe" /> View store ↗
          </a>
        </aside>
        {menu ? <div className="overlay" onClick={() => setMenu(false)} /> : null}
        <div className="admin__main">
          <header className="admin__top">
            <button className="icon-btn mobile-only" onClick={() => setMenu(true)} aria-label="Menu">
              <Icon name="menu" />
            </button>
            <span className="muted" style={{ marginInlineStart: 'auto', fontSize: 13 }}>
              {user.name} · {user.role?.name?.en ?? 'Staff'}
            </span>
            <button className="btn btn--ghost btn--sm" onClick={() => void logout()}>
              <Icon name="logout" /> Sign out
            </button>
          </header>
          <main className="admin__content">
            <Routes>
              <Route index element={can('overview:read') ? <Overview /> : first ? <Navigate to={first.to} replace /> : <Forbidden />} />
              <Route path="orders" element={guard('orders:read', <Orders />)} />
              <Route path="orders/:id" element={guard('orders:read', <OrderDetail perms={perms} />)} />
              <Route path="products" element={guard('products:read', <Products canWrite={can('products:write')} />)} />
              <Route path="products/new" element={guard('products:write', <ProductEdit />)} />
              <Route path="products/:id" element={guard('products:read', <ProductEdit />)} />
              <Route path="categories" element={guard('categories:write', <Categories />)} />
              <Route path="inventory" element={guard('inventory:read', <Inventory canWrite={can('inventory:write')} />)} />
              <Route path="customers" element={guard('customers:read', <Customers />)} />
              <Route path="customers/:id" element={guard('customers:read', <CustomerDetail />)} />
              <Route path="discounts" element={guard('discounts:read', <Discounts canWrite={can('discounts:write')} />)} />
              <Route path="content" element={guard('content:write', <Content canSettings={can('settings:write')} canReviews={can('reviews:moderate')} />)} />
              <Route path="reports" element={guard('reports:read', <Reports />)} />
              <Route path="staff" element={guard('staff:manage', <Staff />)} />
              <Route path="media" element={guard(MEDIA_PERMS, <MediaLibraryPage />)} />
              <Route path="settings" element={guard(SETTINGS_PERMS, <SettingsPage />)} />
              <Route path="activity" element={guard('audit:read', <ActivityLog />)} />
              <Route path="*" element={<Navigate to="/admin" replace />} />
            </Routes>
          </main>
        </div>
      </div>
    </I18nProvider>
  );
}
