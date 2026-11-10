import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ErrorState, Spinner } from '../../components/ui';
import { api, del, patch, post, put, qs } from '../../lib/api';
import { useApi } from '../../lib/hooks';
import type { Category, Localized } from '../../lib/types';
import { useToast } from '../../state/toast';
import { AHead, Card, dt, en, ErrorBox, F, LocInput, Modal, Pager, ProductPicker, sar, Status, Tabs, toSarInput, usePerms } from '../kit';
import { MediaField } from '../media';

const FILTERS = ['price', 'capacityMah', 'powerW', 'connector', 'color', 'availability'];

// ---------------------------------------------------------------- Categories
export function Categories() {
  const { data, error, loading, reload } = useApi<Category[]>('/api/admin/categories');
  const [edit, setEdit] = useState<(Partial<Category> & { sortOrder?: number; active?: boolean }) | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const toast = useToast();
  if (error) return <ErrorState message={error.message} onRetry={reload} />;
  if (loading || !data) return <Spinner />;
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    try {
      const body = { slug: edit!.slug, name: edit!.name, description: edit!.description ?? { ar: '', en: '' }, image: edit!.image?.url ? edit!.image : null, sortOrder: Number(edit!.sortOrder ?? 0), active: edit!.active ?? true, filters: edit!.filters ?? [] };
      if (edit!._id) await put(`/api/admin/categories/${edit!._id}`, body);
      else await post('/api/admin/categories', body);
      toast('Category saved');
      setEdit(null);
      reload();
    } catch (ex) {
      setErr(ex);
    }
  };
  return (
    <>
      <AHead title="Categories">
        <button className="btn btn--primary btn--sm" onClick={() => setEdit({ name: { ar: '', en: '' }, filters: ['price', 'color', 'availability'], active: true, sortOrder: data.length + 1 })}>
          + New category
        </button>
      </AHead>
      <p className="muted categories-note">The six confirmed categories are seeded. Storefront filters per category are a proposal pending CELIBERY approval (Q18).</p>
      <div className="a-card table-wrap categories-table-card">
        <table className="table categories-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Name (EN / AR)</th>
              <th>Slug</th>
              <th>Filters</th>
              <th>Active</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {data.map((c) => (
              <tr key={c._id}>
                <td>{(c as { sortOrder?: number }).sortOrder}</td>
                <td>
                  {c.name.en} <span className="muted">/ {c.name.ar}</span>
                </td>
                <td>{c.slug}</td>
                <td>{c.filters.join(', ')}</td>
                <td>{(c as { active?: boolean }).active === false ? 'No' : 'Yes'}</td>
                <td className="actions">
                  <button className="btn btn--ghost btn--sm" onClick={() => setEdit(c)}>
                    Edit
                  </button>
                  <button
                    className="btn btn--ghost btn--sm"
                    onClick={async () => {
                      if (!window.confirm('Delete this category?')) return;
                      try {
                        await del(`/api/admin/categories/${c._id}`);
                        reload();
                      } catch (ex) {
                        toast((ex as Error).message, 'error');
                      }
                    }}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {edit ? (
        <Modal title={edit._id ? 'Edit category' : 'New category'} onClose={() => setEdit(null)} wide>
          <form className="form-grid form-grid--2" onSubmit={save}>
            <div className="span-2">
              <ErrorBox error={err} />
            </div>
            <LocInput label="Name" required value={edit.name} onChange={(v) => setEdit({ ...edit, name: v })} />
            <F label="Slug">
              <input className="input" required value={edit.slug ?? ''} onChange={(e) => setEdit({ ...edit, slug: e.target.value.toLowerCase() })} />
            </F>
            <F label="Sort order">
              <input className="input" type="number" value={edit.sortOrder ?? 0} onChange={(e) => setEdit({ ...edit, sortOrder: Number(e.target.value) })} />
            </F>
            <MediaField
              label="Category image"
              kind="image"
              value={edit.image?.url ?? ''}
              onChange={(url, a) => setEdit({ ...edit, image: url ? { url, alt: edit.name, ...(a ? { mediaId: a._id, variants: a.variants?.map((v) => ({ width: v.width, url: v.url })), width: a.width ?? null, height: a.height ?? null } : {}) } : undefined })}
            />
            <LocInput label="Description" value={edit.description} onChange={(v) => setEdit({ ...edit, description: v })} />
            <div className="field span-2">
              <span className="label">Storefront filters</span>
              <div className="chips">
                {FILTERS.map((k) => (
                  <button type="button" key={k} className="chip" aria-pressed={edit.filters?.includes(k)} onClick={() => setEdit({ ...edit, filters: edit.filters?.includes(k) ? edit.filters.filter((x) => x !== k) : [...(edit.filters ?? []), k] })}>
                    {k}
                  </button>
                ))}
              </div>
            </div>
            <label className="check">
              <input type="checkbox" checked={edit.active ?? true} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> Active
            </label>
            <button className="btn btn--primary span-2">Save</button>
          </form>
        </Modal>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------- Inventory
type InvRow = { _id: string; sku: string; name: Localized; stock: number; lowStockThreshold?: number; status: string };
type Movement = { _id: string; product?: { sku: string; name: Localized }; type: string; delta: number; stockAfter: number; reason: string; user?: { name: string }; createdAt: string };

export function Inventory({ canWrite }: { canWrite: boolean }) {
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<'stock' | 'history'>('stock');
  const [rows, setRows] = useState<InvRow[] | null>(null);
  const [meta, setMeta] = useState({ page: 1, pages: 1 });
  const [q, setQ] = useState(params.get('q') ?? '');
  const [adjust, setAdjust] = useState<InvRow | null>(null);
  const [form, setForm] = useState({ mode: 'delta', value: '', reason: '', type: 'restock' });
  const [err, setErr] = useState<unknown>(null);
  const [nonce, setNonce] = useState(0);
  const history = useApi<Movement[]>(tab === 'history' ? `/api/admin/inventory/movements` : null);
  const toast = useToast();
  const query = qs({ q: params.get('q') ?? undefined, lowStock: params.get('lowStock') ?? undefined, page: params.get('page') ?? undefined, limit: 50 });
  const [loadErr, setLoadErr] = useState<Error | null>(null);
  useEffect(() => {
    setLoadErr(null);
    api<InvRow[]>(`/api/admin/inventory${query}`)
      .then((r) => {
        setRows(r.data);
        setMeta({ page: Number(r.meta?.page ?? 1), pages: Number(r.meta?.pages ?? 1) });
      })
      // Without this a failed request left the table spinning forever.
      .catch((e: Error) => setLoadErr(e));
  }, [query, nonce]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    try {
      await post(`/api/admin/inventory/${adjust!._id}/adjust`, { mode: form.mode, value: Number(form.value), reason: form.reason, type: form.mode === 'delta' && Number(form.value) > 0 ? form.type : 'adjustment' });
      toast('Stock updated');
      setAdjust(null);
      setNonce((n) => n + 1);
    } catch (ex) {
      setErr(ex);
    }
  };
  return (
    <>
      <AHead title="Inventory" />
      <Tabs
        tabs={[
          ['stock', 'Stock levels'],
          ['history', 'Inventory history'],
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'stock' ? (
        <>
          <div className="a-filters inventory-filters">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const n = new URLSearchParams(params);
                if (q) n.set('q', q);
                else n.delete('q');
                setParams(n);
              }}
            >
              <input className="input" placeholder="Search SKU or name…" value={q} onChange={(e) => setQ(e.target.value)} />
            </form>
            <label className="check">
              <input
                type="checkbox"
                checked={params.get('lowStock') === '1'}
                onChange={(e) => {
                  const n = new URLSearchParams(params);
                  if (e.target.checked) n.set('lowStock', '1');
                  else n.delete('lowStock');
                  setParams(n);
                }}
              />{' '}
              Low stock only
            </label>
          </div>
          <div className="a-card table-wrap inventory-table-card">
            {loadErr ? (
              <ErrorState message={loadErr.message} onRetry={() => setNonce((n) => n + 1)} />
            ) : !rows ? (
              <Spinner />
            ) : (
              <table className="table inventory-table">
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>Product</th>
                    <th>Status</th>
                    <th>In stock</th>
                    <th>Alert at</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r._id}>
                      <td>{r.sku}</td>
                      <td>{en(r.name)}</td>
                      <td>
                        <Status value={r.status} />
                      </td>
                      <td>{r.stock === 0 ? <span className="badge badge--danger">0</span> : r.stock}</td>
                      <td>{r.lowStockThreshold ?? 'default'}</td>
                      <td>
                        {canWrite ? (
                          <button className="btn btn--outline btn--sm" onClick={() => setAdjust(r)}>
                            Adjust
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <Pager
              page={meta.page}
              pages={meta.pages}
              onPage={(pg) => {
                const n = new URLSearchParams(params);
                n.set('page', String(pg));
                setParams(n);
              }}
            />
          </div>
        </>
      ) : (
        <div className="a-card table-wrap inventory-table-card">
          {!history.data ? (
            <Spinner />
          ) : (
            <table className="table inventory-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Product</th>
                  <th>Type</th>
                  <th>Change</th>
                  <th>After</th>
                  <th>Reason</th>
                  <th>By</th>
                </tr>
              </thead>
              <tbody>
                {history.data.map((m) => (
                  <tr key={m._id}>
                    <td>{dt(m.createdAt)}</td>
                    <td>
                      {m.product?.sku} <span className="muted">{en(m.product?.name)}</span>
                    </td>
                    <td>{m.type.replace(/_/g, ' ')}</td>
                    <td style={{ color: m.delta < 0 ? 'var(--danger)' : 'var(--success)' }}>
                      {m.delta > 0 ? '+' : ''}
                      {m.delta}
                    </td>
                    <td>{m.stockAfter}</td>
                    <td>{m.reason}</td>
                    <td>{m.user?.name ?? 'system'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
      {adjust ? (
        <Modal title={`Adjust stock — ${adjust.sku}`} onClose={() => setAdjust(null)}>
          <form className="form-grid" onSubmit={submit}>
            <ErrorBox error={err} />
            <p>
              Current stock: <strong>{adjust.stock}</strong>
            </p>
            <F label="Mode">
              <select className="select" value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })}>
                <option value="delta">Add / remove units (+/−)</option>
                <option value="set">Set exact count (stock take)</option>
              </select>
            </F>
            <F label={form.mode === 'delta' ? 'Units (+10 or −2)' : 'New stock count'}>
              <input className="input" type="number" required value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} />
            </F>
            <F label="Reason">
              <input className="input" required placeholder="e.g. Shipment received, damaged, stock count" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
            </F>
            <button className="btn btn--primary">Update stock</button>
          </form>
        </Modal>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------- Customers
type CustRow = { _id: string; name: string; email: string; phone: string; createdAt: string; lastLoginAt?: string; orders: number; spent: number; marketingOptIn: boolean };

export function Customers() {
  const [tab, setTab] = useState<'customers' | 'newsletter'>('customers');
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<CustRow[] | null>(null);
  const [meta, setMeta] = useState({ pages: 1, total: 0 });
  const nl = useApi<{ _id: string; email: string; lang: string; createdAt: string }[]>(tab === 'newsletter' ? '/api/admin/customers/newsletter' : null);
  const [loadErr, setLoadErr] = useState<Error | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    setRows(null);
    setLoadErr(null);
    api<CustRow[]>(`/api/admin/customers${qs({ q: search || undefined, page })}`)
      .then((r) => {
        setRows(r.data);
        setMeta({ pages: Number(r.meta?.pages ?? 1), total: Number(r.meta?.total ?? 0) });
      })
      // Without this a failed request left the table spinning forever.
      .catch((e: Error) => setLoadErr(e));
  }, [search, page, retry]);
  const exportNl = () => {
    const csv = 'email,lang,subscribed_at\n' + (nl.data ?? []).map((s) => `${s.email},${s.lang},${s.createdAt}`).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = 'newsletter-subscribers.csv';
    a.click();
  };
  return (
    <>
      <AHead title={`Customers (${meta.total})`} />
      <Tabs
        tabs={[
          ['customers', 'Customer accounts'],
          ['newsletter', 'Newsletter subscribers'],
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'customers' ? (
        <>
          <form
            className="a-filters customers-filters"
            onSubmit={(e) => {
              e.preventDefault();
              setPage(1);
              setSearch(q);
            }}
          >
            <input className="input customers-search-input" placeholder="Search name, email, phone…" value={q} onChange={(e) => setQ(e.target.value)} />
          </form>
          <div className="a-card table-wrap customers-table-card">
            {loadErr ? (
              <ErrorState message={loadErr.message} onRetry={() => setRetry((n) => n + 1)} />
            ) : !rows ? (
              <Spinner />
            ) : (
              <table className="table customers-table">
                <thead>
                  <tr>
                    <th>Customer</th>
                    <th>Phone</th>
                    <th>Joined</th>
                    <th>Orders</th>
                    <th>Spent</th>
                    <th>Marketing</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => (
                    <tr key={c._id}>
                      <td>
                        <Link to={`/admin/customers/${c._id}`}>{c.name}</Link>
                        <div className="muted">{c.email}</div>
                      </td>
                      <td>{c.phone || '—'}</td>
                      <td>{dt(c.createdAt)}</td>
                      <td>{c.orders}</td>
                      <td>{sar(c.spent)}</td>
                      <td>{c.marketingOptIn ? 'Yes' : 'No'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="muted" style={{ fontSize: 12 }}>
              Guest orders are not listed here — find them in Orders.
            </p>
            <Pager page={page} pages={meta.pages} onPage={setPage} />
          </div>
        </>
      ) : (
        <div className="customers-newsletter-card"><Card title={`${nl.data?.length ?? 0} subscribers`} actions={<button className="btn btn--outline btn--sm" onClick={exportNl}>Export CSV</button>}>
          {nl.data?.map((s) => (
            <div key={s._id} className="picker__row">
              <span>{s.email}</span>
              <span className="muted">
                {s.lang} · {dt(s.createdAt)}
              </span>
            </div>
          ))}
        </Card></div>
      )}
    </>
  );
}

export function CustomerDetail() {
  const { id } = useParams();
  const canWrite = usePerms().has('customers:write');
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const { data, error, loading, reload } = useApi<{
    active: boolean;
    name: string;
    email: string;
    phone: string;
    createdAt: string;
    lastLoginAt?: string;
    preferredLang: string;
    marketingOptIn: boolean;
    wishlistCount: number;
    addresses: { _id: string; fullName: string; city: string; district: string; street: string; phone: string }[];
    orders: { _id: string; orderNumber: string; total: number; status: string; paymentStatus: string; createdAt: string }[];
  }>(`/api/admin/customers/${id}`);
  if (error) return <ErrorState message={error.message} />;
  if (loading || !data) return <Spinner />;
  return (
    <>
      <AHead title={data.name}>
        {data.active === false ? <span className="badge badge--danger">suspended</span> : null}
        {canWrite ? (
          <button
            className={`btn btn--sm ${data.active === false ? 'btn--outline' : 'btn--ghost danger'}`}
            disabled={busy}
            onClick={async () => {
              const suspend = data.active !== false;
              const reason = window.prompt(suspend ? 'Suspend this account? The customer is signed out and cannot sign in. Orders are kept. Reason (optional):' : 'Reactivate this account? Reason (optional):', '');
              if (reason === null) return;
              setBusy(true);
              try {
                await patch(`/api/admin/customers/${id}/status`, { active: !suspend, reason });
                toast(suspend ? 'Account suspended' : 'Account reactivated');
                reload();
              } catch (ex) {
                toast((ex as Error).message, 'error');
              } finally {
                setBusy(false);
              }
            }}
          >
            {data.active === false ? 'Reactivate account' : 'Suspend account'}
          </button>
        ) : null}
        <Link to="/admin/customers" className="btn btn--ghost btn--sm">
          ← Customers
        </Link>
      </AHead>
      <div className="a-grid-2">
        <Card title={`Orders (${data.orders.length})`}>
          <table className="table">
            <tbody>
              {data.orders.map((o) => (
                <tr key={o._id}>
                  <td>
                    <Link to={`/admin/orders/${o._id}`}>{o.orderNumber}</Link>
                  </td>
                  <td>{dt(o.createdAt)}</td>
                  <td>{sar(o.total)}</td>
                  <td>
                    <Status value={o.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <div>
          <Card title="Details">
            <dl className="kv">
              <dt>Email</dt>
              <dd>{data.email}</dd>
              <dt>Phone</dt>
              <dd>{data.phone || '—'}</dd>
              <dt>Language</dt>
              <dd>{data.preferredLang}</dd>
              <dt>Joined</dt>
              <dd>{dt(data.createdAt)}</dd>
              <dt>Last sign-in</dt>
              <dd>{dt(data.lastLoginAt)}</dd>
              <dt>Marketing</dt>
              <dd>{data.marketingOptIn ? 'Opted in' : 'No'}</dd>
              <dt>Wishlist items</dt>
              <dd>{data.wishlistCount}</dd>
            </dl>
          </Card>
          <Card title="Saved addresses">
            {data.addresses.map((a) => (
              <p key={a._id}>
                {a.fullName} · {a.phone}
                <br />
                <span className="muted">
                  {a.street}, {a.district}, {a.city}
                </span>
              </p>
            ))}
            {!data.addresses.length ? <p className="muted">None</p> : null}
          </Card>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- Discounts
type Discount = {
  _id?: string;
  code: string;
  description: Localized;
  type: 'percent' | 'fixed';
  value: number;
  maxDiscount?: number | null;
  minOrderTotal: number;
  startsAt?: string | null;
  endsAt?: string | null;
  usageLimit?: number | null;
  usedCount?: number;
  perCustomerLimit?: number | null;
  categories: string[];
  products: string[];
  active: boolean;
};

export function Discounts({ canWrite }: { canWrite: boolean }) {
  const { data, error, loading, reload } = useApi<Discount[]>('/api/admin/discounts');
  const cats = useApi<Category[]>('/api/admin/categories');
  const [edit, setEdit] = useState<(Discount & { valueInput: string; maxInput: string; minInput: string }) | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const toast = useToast();
  if (error) return <ErrorState message={error.message} onRetry={reload} />;
  if (loading || !data) return <Spinner />;
  const open = (d?: Discount) => {
    const base: Discount = d ?? { code: '', description: { ar: '', en: '' }, type: 'percent', value: 10, minOrderTotal: 0, categories: [], products: [], active: true };
    setErr(null);
    setEdit({
      ...base,
      categories: (base.categories ?? []).map(String),
      products: (base.products ?? []).map(String),
      valueInput: base.type === 'fixed' ? toSarInput(base.value) : String(base.value),
      maxInput: toSarInput(base.maxDiscount),
      minInput: toSarInput(base.minOrderTotal),
    });
  };
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!edit) return;
    setErr(null);
    const body = {
      code: edit.code,
      description: edit.description,
      type: edit.type,
      value: Number(edit.valueInput),
      maxDiscount: edit.maxInput ? Number(edit.maxInput) : null,
      minOrderTotal: edit.minInput ? Number(edit.minInput) : 0,
      startsAt: edit.startsAt || null,
      endsAt: edit.endsAt || null,
      usageLimit: edit.usageLimit ?? null,
      perCustomerLimit: edit.perCustomerLimit ?? null,
      categories: edit.categories,
      products: edit.products,
      active: edit.active,
    };
    try {
      if (edit._id) await put(`/api/admin/discounts/${edit._id}`, body);
      else await post('/api/admin/discounts', body);
      toast('Discount saved');
      setEdit(null);
      reload();
    } catch (ex) {
      setErr(ex);
    }
  };
  const dateIn = (s?: string | null) => (s ? new Date(s).toISOString().slice(0, 16) : '');
  return (
    <>
      <AHead title="Discount codes">
        {canWrite ? (
          <button className="btn btn--primary btn--sm" onClick={() => open()}>
            + New code
          </button>
        ) : null}
      </AHead>
      <div className="a-card table-wrap discounts-table-card">
        <table className="table discounts-table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Value</th>
              <th>Valid</th>
              <th>Used</th>
              <th>Eligibility</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d._id}>
                <td>
                  <strong>{d.code}</strong>
                </td>
                <td>{d.type === 'percent' ? `${d.value}%` : sar(d.value)}</td>
                <td>
                  {d.startsAt ? dt(d.startsAt) : 'Now'} → {d.endsAt ? dt(d.endsAt) : 'No end'}
                </td>
                <td>
                  {d.usedCount ?? 0}
                  {d.usageLimit != null ? ` / ${d.usageLimit}` : ''}
                </td>
                <td>{d.categories.length || d.products.length ? `${d.categories.length} categories, ${d.products.length} products` : 'All products'}</td>
                <td>{d.active ? <span className="badge badge--success">active</span> : <span className="badge">inactive</span>}</td>
                <td>
                  {canWrite ? (
                    <>
                      <button className="btn btn--ghost btn--sm" onClick={() => open(d)}>
                        Edit
                      </button>
                      <button
                        className="btn btn--ghost btn--sm"
                        onClick={async () => {
                          if (!window.confirm(`Delete discount code ${d.code}?`)) return;
                          try {
                            await del(`/api/admin/discounts/${d._id}`);
                            toast('Discount deleted');
                            reload();
                          } catch (ex) {
                            toast((ex as Error).message, 'error');
                          }
                        }}
                      >
                        Delete
                      </button>
                    </>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!data.length ? <p className="muted">No discount codes yet.</p> : null}
      </div>
      {edit ? (
        <Modal title={edit._id ? `Edit ${edit.code}` : 'New discount code'} onClose={() => setEdit(null)} wide>
          <form className="form-grid form-grid--2 discounts-form" onSubmit={save}>
            <div className="span-2">
              <ErrorBox error={err} />
            </div>
            <F label="Code">
              <input className="input" required value={edit.code} onChange={(e) => setEdit({ ...edit, code: e.target.value.toUpperCase() })} />
            </F>
            <F label="Type">
              <select className="select" value={edit.type} onChange={(e) => setEdit({ ...edit, type: e.target.value as Discount['type'] })}>
                <option value="percent">Percentage</option>
                <option value="fixed">Fixed amount (SAR)</option>
              </select>
            </F>
            <F label={edit.type === 'percent' ? 'Percent off' : 'Amount off (SAR)'}>
              <input className="input" inputMode="decimal" required value={edit.valueInput} onChange={(e) => setEdit({ ...edit, valueInput: e.target.value })} />
            </F>
            {edit.type === 'percent' ? (
              <F label="Maximum discount (SAR, optional)">
                <input className="input" inputMode="decimal" value={edit.maxInput} onChange={(e) => setEdit({ ...edit, maxInput: e.target.value })} />
              </F>
            ) : (
              <span />
            )}
            <F label="Minimum order (SAR)">
              <input className="input" inputMode="decimal" value={edit.minInput} onChange={(e) => setEdit({ ...edit, minInput: e.target.value })} />
            </F>
            <F label="Total usage limit (empty = unlimited)">
              <input className="input" type="number" min={0} value={edit.usageLimit ?? ''} onChange={(e) => setEdit({ ...edit, usageLimit: e.target.value === '' ? null : Number(e.target.value) })} />
            </F>
            <F label="Uses per customer (empty = unlimited)">
              <input className="input" type="number" min={0} value={edit.perCustomerLimit ?? ''} onChange={(e) => setEdit({ ...edit, perCustomerLimit: e.target.value === '' ? null : Number(e.target.value) })} />
            </F>
            <span />
            <F label="Starts">
              <input className="input" type="datetime-local" value={dateIn(edit.startsAt)} onChange={(e) => setEdit({ ...edit, startsAt: e.target.value ? new Date(e.target.value).toISOString() : null })} />
            </F>
            <F label="Ends">
              <input className="input" type="datetime-local" value={dateIn(edit.endsAt)} onChange={(e) => setEdit({ ...edit, endsAt: e.target.value ? new Date(e.target.value).toISOString() : null })} />
            </F>
            <div className="field span-2">
              <span className="label">Eligible categories (none selected = all products)</span>
              <div className="chips">
                {(cats.data ?? []).map((c) => (
                  <button type="button" key={c._id} className="chip" aria-pressed={edit.categories.includes(c._id)} onClick={() => setEdit({ ...edit, categories: edit.categories.includes(c._id) ? edit.categories.filter((x) => x !== c._id) : [...edit.categories, c._id] })}>
                    {en(c.name)}
                  </button>
                ))}
              </div>
            </div>
            <ProductPicker label="Eligible products (optional)" value={edit.products} onChange={(ids) => setEdit({ ...edit, products: ids })} />
            <LocInput label="Description (internal / campaign)" value={edit.description} onChange={(v) => setEdit({ ...edit, description: v })} />
            <label className="check">
              <input type="checkbox" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> Active
            </label>
            <button className="btn btn--primary span-2">Save</button>
          </form>
        </Modal>
      ) : null}
    </>
  );
}





