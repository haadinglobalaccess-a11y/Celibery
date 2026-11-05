import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ErrorState, Spinner } from '../../components/ui';
import { api, del, get, post, put, qs } from '../../lib/api';
import { connectorLabel } from '../../lib/format';
import { useApi } from '../../lib/hooks';
import type { Category, Localized } from '../../lib/types';
import { useToast } from '../../state/toast';
import { AHead, Card, en, ErrorBox, F, fromSarInput, LocInput, Modal, Pager, ProductPicker, sar, Status, toSarInput } from '../kit';
import { ImageGallery, type GalleryImage } from '../media';

type Row = { _id: string; sku: string; slug: string; model: string; name: Localized; price: number; stock: number; status: string; featured: boolean; dataSource: string; images: { url: string }[]; category?: { name: Localized } };

const CONNECTORS = ['usb-c', 'usb-a', 'lightning', 'micro-usb', 'magsafe', 'wireless', 'aux-3.5mm', 'bluetooth', 'car-12v', 'other'];

export function Products({ canWrite }: { canWrite: boolean }) {
  const [params, setParams] = useSearchParams();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [meta, setMeta] = useState({ page: 1, pages: 1, total: 0 });
  const [q, setQ] = useState(params.get('q') ?? '');
  const [importing, setImporting] = useState(false);
  const cats = useApi<Category[]>('/api/admin/categories');
  const query = qs({ q: params.get('q') ?? undefined, status: params.get('status') ?? undefined, category: params.get('category') ?? undefined, page: params.get('page') ?? undefined, limit: 25 });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    setRows(null);
    api<Row[]>(`/api/admin/products${query}`).then((r) => {
      setRows(r.data);
      setMeta({ page: Number(r.meta?.page ?? 1), pages: Number(r.meta?.pages ?? 1), total: Number(r.meta?.total ?? 0) });
    });
  }, [query, nonce]);
  const set = (k: string, v: string) => {
    const n = new URLSearchParams(params);
    if (v) n.set(k, v);
    else n.delete(k);
    if (k !== 'page') n.delete('page');
    setParams(n);
  };
  return (
    <>
      <AHead title={`Products (${meta.total})`}>
        {canWrite ? (
          <>
            <button className="btn btn--outline btn--sm" onClick={() => setImporting(true)}>
              Import CSV
            </button>
            <Link className="btn btn--primary btn--sm" to="/admin/products/new">
              + New product
            </Link>
          </>
        ) : null}
      </AHead>
      <div className="a-filters">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            set('q', q);
          }}
        >
          <input className="input" placeholder="Search name, SKU, model…" value={q} onChange={(e) => setQ(e.target.value)} />
        </form>
        <select className="select" value={params.get('status') ?? ''} onChange={(e) => set('status', e.target.value)}>
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="draft">Draft</option>
          <option value="archived">Archived</option>
        </select>
        <select className="select" value={params.get('category') ?? ''} onChange={(e) => set('category', e.target.value)}>
          <option value="">All categories</option>
          {(cats.data ?? []).map((c) => (
            <option key={c._id} value={c._id}>
              {en(c.name)}
            </option>
          ))}
        </select>
      </div>
      <div className="a-card table-wrap">
        {!rows ? (
          <Spinner />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th></th>
                <th>Product</th>
                <th>Category</th>
                <th>Price</th>
                <th>Stock</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p._id}>
                  <td>
                    <img className="thumb" src={p.images?.[0]?.url || '/placeholders/tech-essentials.svg'} alt="" />
                  </td>
                  <td>
                    <Link to={`/admin/products/${p._id}`}>{en(p.name)}</Link>
                    <div className="muted">
                      {p.sku} {p.model ? `· ${p.model}` : ''} {p.dataSource === 'demo' ? <span className="badge badge--sample">sample</span> : null} {p.featured ? <span className="badge">featured</span> : null}
                    </div>
                  </td>
                  <td>{en(p.category?.name)}</td>
                  <td>{sar(p.price)}</td>
                  <td>{p.stock}</td>
                  <td>
                    <Status value={p.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {rows && !rows.length ? <p className="muted">No products yet. Import the product list (CSV) or add products one by one.</p> : null}
        <Pager page={meta.page} pages={meta.pages} onPage={(pg) => set('page', String(pg))} />
      </div>
      {importing ? <ImportModal onClose={() => setImporting(false)} onDone={() => setNonce((n) => n + 1)} /> : null}
    </>
  );
}

function ImportModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [csv, setCsv] = useState('');
  const [report, setReport] = useState<{ rows: number; created: number; updated: number; skipped: number; errors: { row: number; sku: string; errors: unknown }[] } | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const run = async (dryRun: boolean) => {
    setBusy(true);
    setErr(null);
    try {
      setReport(await post('/api/admin/products/import', { csv, dryRun }));
      if (!dryRun) onDone();
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Import products from CSV" onClose={onClose} wide>
      <p className="muted">
        Use the template in <code>docs/product-import-template.csv</code> (one row per product, prices in SAR). Products are matched by SKU: new SKUs are created, existing ones updated. Validate first, then import.
      </p>
      <input
        type="file"
        accept=".csv,text/csv"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (f) setCsv(await f.text());
        }}
      />
      <ErrorBox error={err} />
      {report ? (
        <div className="alert" style={{ marginTop: 12 }}>
          Rows: {report.rows} · created: {report.created} · updated: {report.updated} · skipped: {report.skipped}
          {report.errors.length ? (
            <ul>
              {report.errors.map((e) => (
                <li key={e.row}>
                  Row {e.row} ({e.sku || 'no SKU'}): {typeof e.errors === 'string' ? e.errors : JSON.stringify(e.errors)}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      <div className="actions" style={{ marginTop: 16 }}>
        <button className="btn btn--outline" disabled={!csv || busy} onClick={() => run(true)}>
          Validate (dry run)
        </button>
        <button className="btn btn--primary" disabled={!csv || busy || !report || report.errors.length > 0} onClick={() => run(false)}>
          Import
        </button>
      </div>
    </Modal>
  );
}

type ProductForm = {
  slug: string;
  sku: string;
  model: string;
  name: Localized;
  shortDescription: Localized;
  description: Localized;
  category: string;
  series: string;
  images: GalleryImage[];
  price: string;
  compareAtPrice: string;
  stock: string;
  lowStockThreshold: string;
  status: string;
  featured: boolean;
  capacityMah: string;
  powerW: string;
  connectors: string[];
  colorKey: string;
  colorName: Localized;
  colorHex: string;
  specs: { label: Localized; value: Localized }[];
  tags: string;
  warrantyMonths: string;
  isBundle: boolean;
  bundleItems: { product: string; quantity: number }[];
  related: string[];
  sortOrder: string;
  seoTitle: Localized;
  seoDescription: Localized;
};

const blank: ProductForm = {
  slug: '',
  sku: '',
  model: '',
  name: { ar: '', en: '' },
  shortDescription: { ar: '', en: '' },
  description: { ar: '', en: '' },
  category: '',
  series: '',
  images: [],
  price: '',
  compareAtPrice: '',
  stock: '0',
  lowStockThreshold: '',
  status: 'draft',
  featured: false,
  capacityMah: '',
  powerW: '',
  connectors: [],
  colorKey: '',
  colorName: { ar: '', en: '' },
  colorHex: '',
  specs: [],
  tags: '',
  warrantyMonths: '',
  isBundle: false,
  bundleItems: [],
  related: [],
  sortOrder: '0',
  seoTitle: { ar: '', en: '' },
  seoDescription: { ar: '', en: '' },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fromApi(p: any): ProductForm {
  return {
    ...blank,
    slug: p.slug,
    sku: p.sku,
    model: p.model ?? '',
    name: p.name,
    shortDescription: p.shortDescription ?? blank.shortDescription,
    description: p.description ?? blank.description,
    category: String(p.category?._id ?? p.category ?? ''),
    series: p.series ?? '',
    // Older products store only url/alt; uploaded images also carry media id + responsive variants.
    images: (p.images ?? []).map((i: GalleryImage) => ({ url: i.url, alt: i.alt ?? { ar: '', en: '' }, mediaId: i.mediaId ?? null, variants: i.variants, width: i.width ?? null, height: i.height ?? null })),
    price: toSarInput(p.price),
    compareAtPrice: toSarInput(p.compareAtPrice),
    stock: String(p.stock ?? 0),
    lowStockThreshold: p.lowStockThreshold == null ? '' : String(p.lowStockThreshold),
    status: p.status,
    featured: Boolean(p.featured),
    capacityMah: p.attributes?.capacityMah ? String(p.attributes.capacityMah) : '',
    powerW: p.attributes?.powerW ? String(p.attributes.powerW) : '',
    connectors: p.attributes?.connectors ?? [],
    colorKey: p.attributes?.color?.key ?? '',
    colorName: p.attributes?.color?.name ?? blank.colorName,
    colorHex: p.attributes?.color?.hex ?? '',
    specs: p.specs ?? [],
    tags: (p.tags ?? []).join(', '),
    warrantyMonths: p.warrantyMonths == null ? '' : String(p.warrantyMonths),
    isBundle: Boolean(p.isBundle),
    bundleItems: (p.bundleItems ?? []).map((b: { product: string; quantity: number }) => ({ product: String(b.product), quantity: b.quantity })),
    related: (p.related ?? []).map(String),
    sortOrder: String(p.sortOrder ?? 0),
    seoTitle: p.seo?.title ?? blank.seoTitle,
    seoDescription: p.seo?.description ?? blank.seoDescription,
  };
}

function toApi(f: ProductForm, isNew: boolean) {
  const num = (s: string) => (s.trim() === '' ? null : Number(s));
  return {
    slug: f.slug,
    sku: f.sku,
    model: f.model,
    name: f.name,
    shortDescription: f.shortDescription,
    description: f.description,
    category: f.category,
    series: f.series,
    images: f.images.filter((i) => i.url.trim()),
    price: fromSarInput(f.price) ?? 0,
    compareAtPrice: fromSarInput(f.compareAtPrice),
    ...(isNew ? { stock: Number(f.stock || 0) } : {}),
    lowStockThreshold: num(f.lowStockThreshold),
    status: f.status,
    featured: f.featured,
    attributes: {
      capacityMah: num(f.capacityMah),
      powerW: num(f.powerW),
      connectors: f.connectors,
      color: f.colorKey ? { key: f.colorKey, name: f.colorName, hex: f.colorHex } : null,
    },
    specs: f.specs.filter((s) => s.label.ar || s.label.en),
    tags: f.tags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean),
    warrantyMonths: num(f.warrantyMonths),
    isBundle: f.isBundle,
    bundleItems: f.isBundle ? f.bundleItems : [],
    related: f.related,
    sortOrder: Number(f.sortOrder || 0),
    seo: { title: f.seoTitle, description: f.seoDescription },
  };
}

export function ProductEdit() {
  const { id } = useParams();
  const isNew = !id;
  const nav = useNavigate();
  const toast = useToast();
  const cats = useApi<Category[]>('/api/admin/categories');
  const [f, setF] = useState<ProductForm | null>(isNew ? blank : null);
  const [err, setErr] = useState<unknown>(null);
  const [loadErr, setLoadErr] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (isNew) return;
    get(`/api/admin/products/${id}`)
      .then((p) => setF(fromApi(p)))
      .catch(() => setLoadErr(true));
  }, [id, isNew]);
  if (loadErr) return <ErrorState />;
  if (!f) return <Spinner />;
  const up = (patch: Partial<ProductForm>) => setF({ ...f, ...patch });
  const autoSlug = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 80);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      if (isNew) {
        const created = await post<{ _id: string }>('/api/admin/products', toApi(f, true));
        toast('Product created');
        nav(`/admin/products/${created._id}`, { replace: true });
      } else {
        await put(`/api/admin/products/${id}`, toApi(f, false));
        toast('Product saved');
      }
    } catch (ex) {
      setErr(ex);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!confirmDelete()) return;
    const r = await del<{ archived: boolean }>(`/api/admin/products/${id}`);
    toast(r.archived ? 'Product archived (it appears in past orders)' : 'Product deleted');
    nav('/admin/products');
  };
  const cat = cats.data?.find((c) => c._id === f.category);

  return (
    <form onSubmit={save}>
      <AHead title={isNew ? 'New product' : en(f.name) || 'Edit product'}>
        <Link to="/admin/products" className="btn btn--ghost btn--sm">
          ← Products
        </Link>
        {!isNew ? (
          <>
            <a className="btn btn--ghost btn--sm" href={`/ar/p/${f.slug}`} target="_blank" rel="noreferrer">
              View ↗
            </a>
            <button type="button" className="btn btn--outline btn--sm" onClick={remove}>
              Delete / archive
            </button>
          </>
        ) : null}
        <button className="btn btn--primary btn--sm" disabled={busy} data-testid="save-product">
          Save
        </button>
      </AHead>
      <ErrorBox error={err} />
      <div className="a-grid-2">
        <div>
          <Card title="Basics">
            <div className="form-grid form-grid--2">
              <LocInput label="Name" required value={f.name} onChange={(v) => up({ name: v, slug: isNew && !f.slug ? autoSlug(v.en) : f.slug })} />
              <F label="SKU *">
                <input className="input" required value={f.sku} onChange={(e) => up({ sku: e.target.value.toUpperCase() })} />
              </F>
              <F label="Model number">
                <input className="input" value={f.model} onChange={(e) => up({ model: e.target.value })} />
              </F>
              <F label="URL slug *" hint="Lowercase letters, numbers and dashes. Keep the Shopify handle to preserve old links.">
                <input className="input" required value={f.slug} onChange={(e) => up({ slug: autoSlug(e.target.value) })} />
              </F>
              <F label="Series (optional)">
                <input className="input" value={f.series} onChange={(e) => up({ series: e.target.value })} />
              </F>
              <LocInput label="Short description" value={f.shortDescription} onChange={(v) => up({ shortDescription: v })} />
              <LocInput label="Full description" textarea value={f.description} onChange={(v) => up({ description: v })} />
            </div>
          </Card>
          <Card title="Images">
            <p className="muted" style={{ fontSize: 13 }}>
              Upload photos from your computer, pick them from the media library, or paste image URLs. Two photos per product on a plain background are recommended (Q15). The first image is the main photo — drag or use the arrows to reorder.
            </p>
            <ImageGallery images={f.images} onChange={(images) => up({ images })} />
          </Card>
          <Card title="Specifications" actions={<button type="button" className="btn btn--outline btn--sm" onClick={() => up({ specs: [...f.specs, { label: { ar: '', en: '' }, value: { ar: '', en: '' } }] })}>+ Add row</button>}>
            {f.specs.map((s, i) => (
              <div key={i} className="form-grid form-grid--2" style={{ borderTop: '1px solid var(--line)', paddingTop: 12, marginTop: 12 }}>
                <LocInput label={`Label ${i + 1}`} value={s.label} onChange={(v) => up({ specs: f.specs.map((x, j) => (j === i ? { ...x, label: v } : x)) })} />
                <LocInput label="Value" value={s.value} onChange={(v) => up({ specs: f.specs.map((x, j) => (j === i ? { ...x, value: v } : x)) })} />
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => up({ specs: f.specs.filter((_, j) => j !== i) })}>
                  Remove row
                </button>
              </div>
            ))}
            {!f.specs.length ? <p className="muted">Only add specifications confirmed by CELIBERY.</p> : null}
          </Card>
          <Card title="Bundles & related">
            <label className="check">
              <input type="checkbox" checked={f.isBundle} onChange={(e) => up({ isBundle: e.target.checked })} /> This product is a bundle / gift kit
            </label>
            {f.isBundle ? (
              <ProductPicker
                label="Bundle contents"
                value={f.bundleItems.map((b) => b.product)}
                onChange={(ids) => up({ bundleItems: ids.map((pid) => f.bundleItems.find((b) => b.product === pid) ?? { product: pid, quantity: 1 }) })}
              />
            ) : null}
            <ProductPicker label="Related products (optional — defaults to the same category)" value={f.related} onChange={(ids) => up({ related: ids })} />
          </Card>
          <Card title="SEO (optional)">
            <div className="form-grid">
              <LocInput label="Page title" value={f.seoTitle} onChange={(v) => up({ seoTitle: v })} />
              <LocInput label="Meta description" value={f.seoDescription} onChange={(v) => up({ seoDescription: v })} />
            </div>
          </Card>
        </div>
        <div>
          <Card title="Status">
            <div className="form-grid">
              <F label="Visibility">
                <select className="select" value={f.status} onChange={(e) => up({ status: e.target.value })}>
                  <option value="draft">Draft (hidden)</option>
                  <option value="active">Active (visible)</option>
                  <option value="archived">Archived</option>
                </select>
              </F>
              <label className="check">
                <input type="checkbox" checked={f.featured} onChange={(e) => up({ featured: e.target.checked })} /> Featured on homepage
              </label>
              <F label="Sort order">
                <input className="input" type="number" value={f.sortOrder} onChange={(e) => up({ sortOrder: e.target.value })} />
              </F>
            </div>
          </Card>
          <Card title="Category *">
            <select className="select" required value={f.category} onChange={(e) => up({ category: e.target.value })}>
              <option value="">Choose…</option>
              {(cats.data ?? []).map((c) => (
                <option key={c._id} value={c._id}>
                  {en(c.name)}
                </option>
              ))}
            </select>
            {cat ? <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>Storefront filters for this category: {cat.filters.join(', ')}</p> : null}
          </Card>
          <Card title="Pricing (SAR, VAT inclusive)">
            <div className="form-grid">
              <F label="Price *">
                <input className="input" inputMode="decimal" required value={f.price} onChange={(e) => up({ price: e.target.value })} />
              </F>
              <F label="Compare-at price" hint="Original price shown struck through (only if higher)">
                <input className="input" inputMode="decimal" value={f.compareAtPrice} onChange={(e) => up({ compareAtPrice: e.target.value })} />
              </F>
            </div>
          </Card>
          <Card title="Inventory">
            <div className="form-grid">
              {isNew ? (
                <F label="Initial stock">
                  <input className="input" type="number" min={0} value={f.stock} onChange={(e) => up({ stock: e.target.value })} />
                </F>
              ) : (
                <p>
                  In stock: <strong>{f.stock}</strong> — <Link to={`/admin/inventory?q=${encodeURIComponent(f.sku)}`}>adjust in Inventory</Link>
                </p>
              )}
              <F label="Low-stock alert at" hint="Empty = store default">
                <input className="input" type="number" min={0} value={f.lowStockThreshold} onChange={(e) => up({ lowStockThreshold: e.target.value })} />
              </F>
            </div>
          </Card>
          <Card title="Filter attributes">
            <div className="form-grid">
              <F label="Battery capacity (mAh)">
                <input className="input" type="number" min={0} value={f.capacityMah} onChange={(e) => up({ capacityMah: e.target.value })} />
              </F>
              <F label="Max power (W)">
                <input className="input" type="number" min={0} value={f.powerW} onChange={(e) => up({ powerW: e.target.value })} />
              </F>
              <div className="field">
                <span className="label">Connectors</span>
                <div className="chips">
                  {CONNECTORS.map((c) => (
                    <button
                      type="button"
                      key={c}
                      className="chip"
                      aria-pressed={f.connectors.includes(c)}
                      onClick={() => up({ connectors: f.connectors.includes(c) ? f.connectors.filter((x) => x !== c) : [...f.connectors, c] })}
                    >
                      {connectorLabel(c, 'en')}
                    </button>
                  ))}
                </div>
              </div>
              <F label="Colour key" hint="e.g. black, white, grey — used for the colour filter">
                <input className="input" value={f.colorKey} onChange={(e) => up({ colorKey: e.target.value.toLowerCase() })} />
              </F>
              {f.colorKey ? (
                <>
                  <LocInput label="Colour name" value={f.colorName} onChange={(v) => up({ colorName: v })} />
                  <F label="Colour swatch (hex)">
                    <input className="input" placeholder="#111111" value={f.colorHex} onChange={(e) => up({ colorHex: e.target.value })} />
                  </F>
                </>
              ) : null}
              <F label="Tags" hint="Comma separated (used by search)">
                <input className="input" value={f.tags} onChange={(e) => up({ tags: e.target.value })} />
              </F>
            </div>
          </Card>
          <Card title="Warranty">
            <F label="Warranty (months)" hint="Empty = store default (Settings → Warranty)">
              <input className="input" type="number" min={0} value={f.warrantyMonths} onChange={(e) => up({ warrantyMonths: e.target.value })} />
            </F>
          </Card>
        </div>
      </div>
    </form>
  );
}

function confirmDelete() {
  // Native confirm is acceptable inside the staff-only dashboard.
  return window.confirm('Delete this product? Products that appear in orders are archived instead.');
}
