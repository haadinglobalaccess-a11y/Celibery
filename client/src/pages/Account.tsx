import { useState, type FormEvent } from 'react';
import { Link, Navigate, NavLink, Outlet, useLocation, useParams } from 'react-router-dom';
import { OrderDetails } from '../components/OrderDetails';
import { ProductCard } from '../components/ProductCard';
import { EmptyState, ErrorState, Field, NotFound, Spinner } from '../components/ui';
import { useI18n } from '../i18n/I18n';
import { ApiError, del, patch, post, put } from '../lib/api';
import { formatDate, formatPrice, L } from '../lib/format';
import { useApi } from '../lib/hooks';
import { useSeo } from '../lib/useSeo';
import type { Address, OrderView, ProductCardData } from '../lib/types';
import { useAuth } from '../state/auth';
import { useToast } from '../state/toast';
import { useWishlist } from '../state/wishlist';
import { storeCopy } from '../storefront/copy';
import { OrderReturns } from '../components/OrderReturns';

export function AccountLayout() {
  const { t, p } = useI18n();
  const { user, ready, logout } = useAuth();
  const loc = useLocation();
  useSeo(t.account.title, undefined, { noindex: true });
  if (!ready) return <Spinner />;
  if (user?.type !== 'customer') return <Navigate to={p(`/login?next=${encodeURIComponent(loc.pathname.replace(/^\/(ar|en)/, ''))}`)} replace />;
  return (
    <div className="container">
      <div className="page-head">
        <h1>{t.account.title}</h1>
        <p className="muted">{user.name}</p>
      </div>
      <div className="account">
        <nav aria-label={t.account.title}>
          <NavLink end to={p('/account')}>
            {t.account.orders}
          </NavLink>
          <NavLink to={p('/account/addresses')}>{t.account.addresses}</NavLink>
          <NavLink to={p('/wishlist')}>{t.nav.wishlist}</NavLink>
          <NavLink to={p('/account/profile')}>{t.account.profile}</NavLink>
          <button className="btn btn--ghost" onClick={() => void logout()} style={{ justifyContent: 'flex-start' }}>
            {t.auth.logout}
          </button>
        </nav>
        <section>
          <Outlet />
        </section>
      </div>
    </div>
  );
}

export function AccountOrders() {
  const { t, lang, p } = useI18n();
  const { data, error, loading, reload } = useApi<OrderView[]>('/api/me/orders');
  if (error) return <ErrorState onRetry={reload} />;
  if (loading || !data) return <Spinner />;
  if (!data.length)
    return (
      <EmptyState
        title={t.account.noOrders}
        action={
          <Link className="btn btn--primary" to={p('/shop')}>
            {t.home.shopNow}
          </Link>
        }
      />
    );
  return (
    <div>
      {data.map((o) => (
        <Link key={o.orderNumber} to={p(`/account/orders/${o.orderNumber}`)} className="order-card">
          <div>
            <strong className="ltr">{o.orderNumber}</strong>
            <div className="muted" style={{ fontSize: 13 }}>
              {formatDate(o.createdAt, lang)} · {o.items.reduce((s, i) => s + i.quantity, 0)} × {L(o.items[0]?.name, lang)}
              {o.items.length > 1 ? '…' : ''}
            </div>
          </div>
          <div style={{ textAlign: 'end' }}>
            <span className="badge">{t.order.status[o.status] ?? o.status}</span>
            <div>
              <strong>{formatPrice(o.total, lang)}</strong>
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}

export function AccountOrderDetail() {
  const { orderNumber } = useParams();
  const { data, error, loading, reload } = useApi<OrderView>(`/api/orders/${orderNumber}`);
  if (error?.status === 404) return <NotFound />;
  if (error) return <ErrorState onRetry={reload} />;
  if (loading || !data) return <Spinner />;
  return (
    <>
      <OrderDetails order={data} />
      <OrderReturns orderNumber={data.orderNumber} />
    </>
  );
}

const emptyAddr: Address = { label: '', fullName: '', phone: '', city: '', district: '', street: '', buildingNumber: '', postalCode: '', shortAddress: '', notes: '', isDefault: false };

export function AccountAddresses() {
  const { t } = useI18n();
  const toast = useToast();
  const { data, error, loading, reload } = useApi<Address[]>('/api/me/addresses');
  const [editing, setEditing] = useState<Address | null>(null);
  const [err, setErr] = useState('');
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    setErr('');
    const { _id, ...body } = editing;
    try {
      if (_id) await put(`/api/me/addresses/${_id}`, body);
      else await post('/api/me/addresses', body);
      setEditing(null);
      toast(t.account.saved);
      reload();
    } catch (ex) {
      setErr((ex as ApiError).message);
    }
  };
  if (error) return <ErrorState onRetry={reload} />;
  if (loading || !data) return <Spinner />;
  const f = (k: keyof Address, label: string, opts: { ltr?: boolean; span?: boolean } = {}) => (
    <Field label={label} className={opts.span ? 'span-2' : ''}>
      <input className="input" dir={opts.ltr ? 'ltr' : undefined} value={(editing?.[k] as string) ?? ''} onChange={(e) => setEditing((s) => ({ ...(s as Address), [k]: e.target.value }))} />
    </Field>
  );
  return (
    <div>
      {editing ? (
        <form className="panel form-grid form-grid--2" onSubmit={save}>
          {f('fullName', t.checkout.name)}
          {f('phone', t.checkout.phone, { ltr: true })}
          {f('city', t.checkout.city)}
          {f('district', t.checkout.district)}
          {f('street', t.checkout.street, { span: true })}
          {f('buildingNumber', t.checkout.building, { ltr: true })}
          {f('postalCode', t.checkout.postal, { ltr: true })}
          {f('shortAddress', t.checkout.shortAddress, { ltr: true })}
          {f('notes', t.checkout.notes)}
          <label className="check span-2">
            <input type="checkbox" checked={Boolean(editing.isDefault)} onChange={(e) => setEditing({ ...editing, isDefault: e.target.checked })} /> {t.account.default}
          </label>
          {err ? <p className="alert alert--error span-2">{err}</p> : null}
          <div className="span-2" style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn--primary">{t.account.save}</button>
            <button type="button" className="btn btn--ghost" onClick={() => setEditing(null)}>
              {t.account.cancel}
            </button>
          </div>
        </form>
      ) : (
        <button className="btn btn--outline" onClick={() => setEditing({ ...emptyAddr })} style={{ marginBottom: 16 }}>
          + {t.account.addAddress}
        </button>
      )}
      {err && !editing ? <p className="alert alert--error">{err}</p> : null}
      {!data.length && !editing ? <p className="muted">{t.account.noAddresses}</p> : null}
      {data.map((a) => (
        <div key={a._id} className="order-card">
          <div>
            <strong>{a.fullName}</strong> {a.isDefault ? <span className="badge">{t.account.default}</span> : null}
            <div className="muted" style={{ fontSize: 13 }}>
              {[a.street, a.buildingNumber, a.district, a.city, a.postalCode].filter(Boolean).join('، ')} · <span className="ltr">{a.phone}</span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn--ghost btn--sm" onClick={() => setEditing({ ...emptyAddr, ...a })}>
              {t.account.edit}
            </button>
            <button
              className="btn btn--ghost btn--sm"
              onClick={async () => {
                // Confirm first; a failed delete is shown instead of being silently ignored.
                if (!window.confirm(t.account.deleteAddressConfirm)) return;
                try {
                  await del(`/api/me/addresses/${a._id}`);
                  setErr('');
                } catch (ex) {
                  setErr((ex as Error).message);
                }
                reload();
              }}
            >
              {t.account.delete}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

export function AccountProfile() {
  const { t } = useI18n();
  const { user, refresh } = useAuth();
  const toast = useToast();
  const [name, setName] = useState(user?.name ?? '');
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });
  const [err, setErr] = useState('');
  const saveProfile = async (e: FormEvent) => {
    e.preventDefault();
    setErr('');
    try {
      await patch('/api/me/profile', { name, phone: phone.replace(/\s/g, '') });
      await refresh();
      toast(t.account.saved);
    } catch (ex) {
      setErr((ex as ApiError).message);
    }
  };
  const changePw = async (e: FormEvent) => {
    e.preventDefault();
    setErr('');
    try {
      await post('/api/auth/change-password', pw);
      setPw({ currentPassword: '', newPassword: '' });
      toast(t.account.saved);
    } catch (ex) {
      setErr((ex as ApiError).message);
    }
  };
  return (
    <div className="stack" style={{ maxWidth: 520 }}>
      <form className="panel form-grid" onSubmit={saveProfile}>
        <h2>{t.account.profile}</h2>
        <Field label={t.auth.name}>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={t.auth.email}>
          <input className="input" dir="ltr" value={user?.email ?? ''} disabled />
        </Field>
        <Field label={t.checkout.phone}>
          <input className="input" dir="ltr" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
        <button className="btn btn--primary">{t.account.save}</button>
      </form>
      <form className="panel form-grid" onSubmit={changePw}>
        <h2>{t.account.security}</h2>
        <Field label={t.account.currentPassword}>
          <input className="input" type="password" autoComplete="current-password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} />
        </Field>
        <Field label={t.auth.newPassword} hint={t.auth.passwordHint}>
          <input className="input" type="password" autoComplete="new-password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} />
        </Field>
        <button className="btn btn--outline">{t.account.changePassword}</button>
      </form>
      {err ? <p className="alert alert--error">{err}</p> : null}
    </div>
  );
}

/** Works for guests (local list) and customers (account list). */
export function WishlistPage() {
  const { t, p, lang } = useI18n();
  const wish = useWishlist();
  const ids = [...wish.ids];
  const { data, loading } = useApi<ProductCardData[]>(ids.length ? `/api/products?ids=${ids.join(',')}&limit=60` : null);
  useSeo(t.nav.wishlist, undefined, { noindex: true });
  const sc = storeCopy(lang);
  return (
    <div className="container cx-saved">
      <header className="cx-pagehead">
        <span className="cx-eyebrow">{sc.saved}</span>
        <h1 className="cx-display cx-display--xl">{t.nav.wishlist}</h1>
        {ids.length ? <p className="cx-pagehead__meta">{sc.savedCount(ids.length)}</p> : null}
      </header>
      {!ids.length ? (
        <EmptyState
          icon="heart"
          title={t.account.wishlistEmpty}
          action={
            <Link className="btn btn--primary" to={p('/shop')}>
              {t.home.shopNow}
            </Link>
          }
        />
      ) : loading || !data ? (
        <Spinner />
      ) : (
        <div className="cx-grid cx-grid--4">
          {data.map((pr, i) => (
            <ProductCard key={pr._id} product={pr} index={i} />
          ))}
        </div>
      )}
    </div>
  );
}
