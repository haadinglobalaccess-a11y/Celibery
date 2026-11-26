import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ErrorState, Spinner } from '../../components/ui';
import { api, apiUrl, del, get, post, put, qs } from '../../lib/api';
import { connectorLabel } from '../../lib/format';
import { useApi } from '../../lib/hooks';
import { readTextFile, type DecodedText } from '../../lib/textFile';
import type { Category, Localized } from '../../lib/types';
import { useToast } from '../../state/toast';
import { AHead, Card, dt, en, ErrorBox, F, fromSarInput, LocInput, Modal, Pager, ProductPicker, sar, Status, toSarInput, usePerms } from '../kit';
import { ImageGallery, ProductVideos, type GalleryImage, type ProductVideoInput } from '../media';
import { BulkImagesModal } from './BulkImages';

type Row = { _id: string; sku: string; slug: string; model: string; name: Localized; price: number; stock: number; status: string; featured: boolean; flagship?: boolean; dataSource: string; images: { url: string }[]; category?: { name: Localized } };

const CONNECTORS = ['usb-c', 'usb-a', 'lightning', 'micro-usb', 'magsafe', 'wireless', 'aux-3.5mm', 'bluetooth', 'car-12v', 'other'];

export function Products({ canWrite }: { canWrite: boolean }) {
  const [params, setParams] = useSearchParams();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [meta, setMeta] = useState({ page: 1, pages: 1, total: 0 });
  const [q, setQ] = useState(params.get('q') ?? '');
  const [importing, setImporting] = useState(false);
  const [bulkPhotos, setBulkPhotos] = useState(false);
  const [listError, setListError] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const toast = useToast();
  const cats = useApi<Category[]>('/api/admin/categories');
  const query = qs({ q: params.get('q') ?? undefined, status: params.get('status') ?? undefined, placement: params.get('placement') ?? undefined, category: params.get('category') ?? undefined, page: params.get('page') ?? undefined, limit: params.get('limit') ?? 25 });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    setRows(null);
    setListError(false);
    setSelected(new Set());
    api<Row[]>(`/api/admin/products${query}`)
      .then((r) => {
        setRows(r.data);
        setMeta({ page: Number(r.meta?.page ?? 1), pages: Number(r.meta?.pages ?? 1), total: Number(r.meta?.total ?? 0) });
      })
      .catch(() => setListError(true));
  }, [query, nonce]);
  const set = (k: string, v: string) => {
    const n = new URLSearchParams(params);
    if (v) n.set(k, v);
    else n.delete(k);
    if (k !== 'page') n.delete('page');
    setParams(n);
  };
  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allOnPage = Boolean(rows?.length) && (rows ?? []).every((r) => selected.has(r._id));
  const runBulk = async (action: 'active' | 'draft' | 'archived' | 'delete') => {
    const ids = [...selected];
    if (!ids.length) return;
    const what = `${ids.length} product${ids.length === 1 ? '' : 's'}`;
    if (action === 'archived' && !window.confirm(`Archive ${what}? Archived products are hidden from the shop. You can make them active again later.`)) return;
    if (action === 'delete' && !window.confirm(`Delete ${what}? This cannot be undone. Products that appear in past orders are archived instead of deleted.`)) return;
    setBulkBusy(true);
    try {
      const r = await post<{ updated: number; deleted: number; archived: number }>('/api/admin/products/bulk', { ids, action });
      if (action === 'delete') toast(`${r.deleted} deleted${r.archived ? `, ${r.archived} archived (they appear in past orders)` : ''}`);
      else toast(`${r.updated} product${r.updated === 1 ? '' : 's'} set to ${action}`);
      setNonce((x) => x + 1);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not update the selected products');
    } finally {
      setBulkBusy(false);
    }
  };
  return (
    <>
      <AHead title={`Products (${meta.total})`}>
        <a
          className="btn btn--outline btn--sm"
          href={apiUrl(`/api/admin/products/export.csv${qs({ status: params.get('status') ?? undefined, category: params.get('category') ?? undefined })}`)}
          download
          title="Download the products (current status/category filter) in the import template format"
        >
          Export CSV
        </a>
        {canWrite ? (
          <>
            <button className="btn btn--outline btn--sm" onClick={() => setImporting(true)}>
              Import CSV
            </button>
            <button className="btn btn--outline btn--sm" onClick={() => setBulkPhotos(true)} title="Upload many product photos at once: files named after the SKU (CEL-PB-20000-1.jpg) go to that product">
              Bulk photos
            </button>
            <Link className="btn btn--primary btn--sm" to="/admin/products/new">
              + New product
            </Link>
          </>
        ) : null}
      </AHead>
      <div className="a-filters products-filters">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            set('q', q);
          }}
        >
          <input className="input products-search-input" placeholder="Search product name, SKU or model…" value={q} onChange={(e) => setQ(e.target.value)} />
        </form>
        {/* One dropdown: status (availability) and homepage placement are separate filters on the server. */}
        <select
          className="select products-status-select"
          aria-label="Show products"
          data-testid="products-status-filter"
          value={params.get('placement') ?? params.get('status') ?? ''}
          onChange={(e) => {
            const v = e.target.value;
            const n = new URLSearchParams(params);
            n.delete('status');
            n.delete('placement');
            n.delete('page');
            if (v === 'featured' || v === 'flagship') n.set('placement', v);
            else if (v) n.set('status', v);
            setParams(n);
          }}
        >
          <option value="">All products</option>
          <option value="active">Active</option>
          <option value="draft">Draft</option>
          <option value="archived">Archived (inactive)</option>
          <option value="featured">Featured</option>
          <option value="flagship">Flagship</option>
        </select>
        <select className="select products-category-select" value={params.get('category') ?? ''} onChange={(e) => set('category', e.target.value)}>
          <option value="">All categories</option>
          {(cats.data ?? []).map((c) => (
            <option key={c._id} value={c._id}>
              {en(c.name)}
            </option>
          ))}
        </select>
      </div>
      {canWrite && selected.size ? (
        <div className="products-bulk-bar" role="toolbar" aria-label="Bulk actions" data-testid="products-bulk-bar">
          <strong>{selected.size} selected</strong>
          <button className="btn btn--primary btn--sm" disabled={bulkBusy} onClick={() => void runBulk('active')}>
            Set active
          </button>
          <button className="btn btn--outline btn--sm" disabled={bulkBusy} onClick={() => void runBulk('draft')}>
            Set draft
          </button>
          <button className="btn btn--outline btn--sm" disabled={bulkBusy} onClick={() => void runBulk('archived')}>
            Archive
          </button>
          <button className="btn btn--outline btn--sm products-bulk-delete" disabled={bulkBusy} onClick={() => void runBulk('delete')}>
            Delete
          </button>
          <button className="btn btn--ghost btn--sm" disabled={bulkBusy} onClick={() => setSelected(new Set())}>
            Clear selection
          </button>
        </div>
      ) : null}
      <div className="a-card table-wrap products-table-card">
        {listError ? (
          <ErrorState onRetry={() => setNonce((n) => n + 1)} />
        ) : !rows ? (
          <Spinner />
        ) : (
          <table className="table products-table">
            <thead>
              <tr>
                {canWrite ? (
                  <th className="products-check">
                    <input type="checkbox" aria-label="Select all products on this page" checked={allOnPage} onChange={() => setSelected(allOnPage ? new Set() : new Set(rows.map((r) => r._id)))} />
                  </th>
                ) : null}
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
                <tr key={p._id} className={selected.has(p._id) ? 'is-selected' : undefined}>
                  {canWrite ? (
                    <td className="products-check">
                      <input type="checkbox" aria-label={`Select ${en(p.name)}`} checked={selected.has(p._id)} onChange={() => toggle(p._id)} />
                    </td>
                  ) : null}
                  <td>
                    <img className="thumb" src={p.images?.[0]?.url || '/placeholders/tech-essentials.svg'} alt="" />
                  </td>
                  <td className="products-name">
                    <Link to={`/admin/products/${p._id}`}>{en(p.name)}</Link>
                    <div className="muted">
                      {p.sku} {p.model ? `· ${p.model}` : ''} {p.dataSource === 'demo' ? <span className="badge badge--sample">sample</span> : null} {p.featured ? <span className="badge badge--featured" data-testid="badge-featured">Featured</span> : null} {p.flagship ? <span className="badge badge--flagship" data-testid="badge-flagship">Flagship</span> : null}
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
        <div className="products-pager">
          <label className="muted">
            Show{' '}
            <select className="select" aria-label="Products per page" value={params.get('limit') ?? '25'} onChange={(e) => set('limit', e.target.value === '25' ? '' : e.target.value)}>
              <option value="25">25</option>
              <option value="50">50</option>
              <option value="100">100</option>
              <option value="200">200</option>
            </select>{' '}
            per page
          </label>
          <Pager page={meta.page} pages={meta.pages} onPage={(pg) => set('page', String(pg))} />
        </div>
      </div>
      {importing ? <ImportModal onClose={() => setImporting(false)} onDone={() => setNonce((n) => n + 1)} /> : null}
      {bulkPhotos ? <BulkImagesModal onClose={() => setBulkPhotos(false)} onDone={() => setNonce((n) => n + 1)} /> : null}
    </>
  );
}

function ImportModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [csv, setCsv] = useState('');
  const [encoding, setEncoding] = useState<DecodedText['encoding'] | null>(null);
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
        Use the template in <code>docs/product-import-template.csv</code> (one row per product, prices in SAR). Products are matched by SKU: new SKUs are created, existing ones updated. For existing products, only filled-in cells change: an empty cell or a missing column keeps the current value, so a file can carry just <code>sku</code> plus the columns you want to change. An empty <code>slug</code> is made from the English name. Photos are easiest with <strong>Bulk photos</strong>. Validate first, then import.
      </p>
      <input
        type="file"
        accept=".csv,text/csv"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          const decoded = await readTextFile(f);
          setCsv(decoded.text);
          setEncoding(decoded.encoding);
          setReport(null);
        }}
      />
      {encoding && encoding !== 'utf-8' ? (
        <p className="alert alert--warning" style={{ marginTop: 12 }}>
          This file was saved as {encoding === 'windows-1256' ? 'Arabic Windows (Windows-1256)' : 'Western Windows (Windows-1252)'}, not UTF-8. It was converted so Arabic and special characters are kept. Run “Validate” and check the names before importing. Next time, save from Excel with “CSV UTF-8 (Comma delimited)”.
        </p>
      ) : null}
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
  packagingImages: GalleryImage[];
  videos: ProductVideoInput[];
  videoPlacement: 'after_main' | 'after_photos';
  price: string;
  compareAtPrice: string;
  stock: string;
  lowStockThreshold: string;
  status: string;
  featured: boolean;
  flagship: boolean;
  flagshipOrder: string;
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
  availableFrom: string;
  availableUntil: string;
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
  packagingImages: [],
  videos: [],
  videoPlacement: 'after_main',
  price: '',
  compareAtPrice: '',
  stock: '0',
  lowStockThreshold: '',
  status: 'draft',
  featured: false,
  flagship: false,
  flagshipOrder: '0',
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
  availableFrom: '',
  availableUntil: '',
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
    packagingImages: (p.packagingImages ?? []).map((i: GalleryImage) => ({ url: i.url, alt: i.alt ?? { ar: '', en: '' }, mediaId: i.mediaId ?? null, variants: i.variants, width: i.width ?? null, height: i.height ?? null })),
    videos: (p.videos ?? []).map((v: ProductVideoInput) => ({ url: v.url, mediaId: v.mediaId ? String(v.mediaId) : null, posterUrl: v.posterUrl ?? '', title: v.title ?? { ar: '', en: '' } })),
    videoPlacement: p.videoPlacement === 'after_photos' ? 'after_photos' : 'after_main',
    price: toSarInput(p.price),
    compareAtPrice: toSarInput(p.compareAtPrice),
    stock: String(p.stock ?? 0),
    lowStockThreshold: p.lowStockThreshold == null ? '' : String(p.lowStockThreshold),
    status: p.status,
    featured: Boolean(p.featured),
    flagship: Boolean(p.flagship), // older products without the field: not in Flagship
    flagshipOrder: String(p.flagshipOrder ?? 0),
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
    availableFrom: p.availableFrom ? new Date(p.availableFrom).toISOString().slice(0, 16) : '',
    availableUntil: p.availableUntil ? new Date(p.availableUntil).toISOString().slice(0, 16) : '',
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
    packagingImages: f.packagingImages.filter((i) => i.url.trim()),
    videos: f.videos.filter((v) => v.url.trim()).map((v) => ({ url: v.url.trim(), mediaId: v.mediaId || null, posterUrl: v.posterUrl.trim(), title: v.title })),
    videoPlacement: f.videoPlacement,
    price: fromSarInput(f.price) ?? 0,
    compareAtPrice: fromSarInput(f.compareAtPrice),
    ...(isNew ? { stock: Number(f.stock || 0) } : {}),
    lowStockThreshold: num(f.lowStockThreshold),
    status: f.status,
    featured: f.featured,
    flagship: f.flagship,
    flagshipOrder: Math.max(0, Math.trunc(Number(f.flagshipOrder || 0))),
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
    availableFrom: f.isBundle && f.availableFrom ? new Date(f.availableFrom).toISOString() : null,
    availableUntil: f.isBundle && f.availableUntil ? new Date(f.availableUntil).toISOString() : null,
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
              <LocInput label="Short description" hint="One line (up to 300 characters) shown on product cards and the homepage gallery." value={f.shortDescription} onChange={(v) => up({ shortDescription: v })} />
              <LocInput
                label="Full description"
                textarea
                hint="Leave an empty line between paragraphs. Start a line with “- ” for a bullet point, “### ” for a sub-heading, and wrap words in **double asterisks** for bold. Text pasted from Shopify or a web page is cleaned automatically when you save (formatting tags are removed)."
                value={f.description}
                onChange={(v) => up({ description: v })}
              />
            </div>
          </Card>
          <Card title="Images">
            <p className="muted" style={{ fontSize: 13 }}>
              Upload photos from your computer, pick them from the media library, or paste image URLs — up to 40 per product. Photos on a plain background look best. The first image is the main photo and the second one appears when a shopper hovers the product card; drag or use the arrows to reorder. On the product page every photo is shown in the thumbnail rail beside the main photo.
            </p>
            <div data-testid="product-gallery">
              <ImageGallery images={f.images} onChange={(images) => up({ images })} />
            </div>
          </Card>
          <Card title="Packaging images">
            <p className="muted" style={{ fontSize: 13 }}>
              Photos of the box, its contents and labels. They appear after the product photos in the product gallery, marked “Packaging”. Upload, choose from the library or paste URLs; drag or use the arrows to reorder.
            </p>
            <div data-testid="packaging-gallery">
              <ImageGallery images={f.packagingImages} max={12} onChange={(packagingImages) => up({ packagingImages })} />
            </div>
          </Card>
          <Card title="Videos">
            <p className="muted" style={{ fontSize: 13 }}>
              Videos appear in the product gallery as thumbnails with a play button, next to the photos. Customers hover or click a thumbnail to bring it into the main frame; choosing a video plays it there. Use the arrows to set their order.
            </p>
            <F label="Position in the gallery">
              <select className="input" value={f.videoPlacement} onChange={(e) => up({ videoPlacement: e.target.value as ProductForm['videoPlacement'] })}>
                <option value="after_main">Right after the main photo</option>
                <option value="after_photos">After all product photos</option>
              </select>
            </F>
            <div style={{ marginTop: 16 }}>
              <ProductVideos videos={f.videos} onChange={(videos) => up({ videos })} />
            </div>
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
            {f.isBundle && f.bundleItems.length ? (
              <div className="form-grid" data-testid="bundle-quantities">
                <p className="muted" style={{ fontSize: 13, margin: 0 }}>
                  Quantity of each product in one bundle. Stock follows these products: each sale takes them out of stock, cancellations and returns put them back. The product page shows their combined price and the saving.
                </p>
                {f.bundleItems.map((b, i) => (
                  <F key={b.product} label={`Item ${i + 1} quantity`}>
                    <input
                      className="input"
                      type="number"
                      min={1}
                      max={20}
                      value={b.quantity}
                      onChange={(e) => up({ bundleItems: f.bundleItems.map((x) => (x.product === b.product ? { ...x, quantity: Math.max(1, Math.min(20, Number(e.target.value) || 1)) } : x)) })}
                    />
                  </F>
                ))}
                <F label="Available from (optional)">
                  <input className="input" type="datetime-local" value={f.availableFrom} onChange={(e) => up({ availableFrom: e.target.value })} />
                </F>
                <F label="Available until (optional)">
                  <input className="input" type="datetime-local" value={f.availableUntil} onChange={(e) => up({ availableUntil: e.target.value })} />
                </F>
              </div>
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
                <input type="checkbox" data-testid="featured-toggle" checked={f.featured} onChange={(e) => up({ featured: e.target.checked })} /> Featured on homepage
              </label>
              <label className="check">
                <input type="checkbox" data-testid="flagship-toggle" checked={f.flagship} onChange={(e) => up({ flagship: e.target.checked })} /> Show in Flagship section
              </label>
              {f.flagship ? (
                <F label="Flagship order" hint="Lowest number appears first. The Flagship section shows the first three active products with a photo.">
                  <input className="input" type="number" min={0} step={1} data-testid="flagship-order" value={f.flagshipOrder} onChange={(e) => up({ flagshipOrder: e.target.value })} />
                </F>
              ) : null}
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
          {!isNew && id ? <RestockRequests productId={id} stock={Number(f.stock || 0)} /> : null}
          <Card title="Inventory">
            <div className="form-grid">
              {isNew ? (
                <F label="Initial stock">
                  <input className="input" type="number" min={0} value={f.stock} onChange={(e) => up({ stock: e.target.value })} />
                </F>
              ) : f.isBundle && f.bundleItems.length ? (
                <p>
                  Complete bundles available: <strong>{f.stock}</strong> — follows the stock of the products it contains (adjust those in Inventory).
                </p>
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


type RestockRow = { _id: string; email: string; lang: string; status: string; attempts: number; lastError?: string; notifiedAt?: string; createdAt: string };
const RESTOCK_LABEL: Record<string, string> = { active: 'Waiting', sending: 'Sending', notified: 'Emailed', failed: 'Failed', cancelled: 'Cancelled' };

/** "Notify me when restocked" requests for this product, with delivery status. */
function RestockRequests({ productId, stock }: { productId: string; stock: number }) {
  const [nonce, setNonce] = useState(0);
  const { data, error } = useApi<{ items: RestockRow[]; counts: Record<string, number> }>(`/api/admin/products/${productId}/restock?r=${nonce}`);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const perms = usePerms();
  const send = async () => {
    setBusy(true);
    setMsg('');
    try {
      const r = await post<{ sent: number; retry: number; failed: number; skipped: number }>(`/api/admin/products/${productId}/restock/send`, {});
      setMsg(r.skipped ? 'Email (SMTP) is not configured — requests stay waiting and are sent once email is set up in Settings → Notifications.' : `Sent ${r.sent}${r.retry ? `, ${r.retry} will be retried` : ''}${r.failed ? `, ${r.failed} failed` : ''}.`);
      setNonce((n) => n + 1);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const waiting = data?.counts.active ?? 0;
  return (
    <Card title="Restock requests">
      <div data-testid="restock-requests">
        {error ? <p className="alert alert--error">Could not load restock requests.</p> : null}
        {data ? (
          <>
            <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
              Customers who asked to be emailed when this product is back. Emails go out automatically when stock goes above zero (by any route: inventory, import, cancelled orders, returns).
            </p>
            <p style={{ margin: '0 0 8px' }}>
              Waiting: <strong>{waiting}</strong> · Emailed: <strong>{data.counts.notified ?? 0}</strong> · Failed: <strong>{data.counts.failed ?? 0}</strong>
            </p>
            {waiting && stock > 0 && perms.has('inventory:write') ? (
              <button type="button" className="btn btn--outline btn--sm" disabled={busy} onClick={send}>
                {busy ? 'Sending…' : 'Send now'}
              </button>
            ) : null}
            {msg ? <p className="muted" style={{ fontSize: 13 }}>{msg}</p> : null}
            {data.items.length ? (
              <div className="a-table-wrap" style={{ marginTop: 8, maxHeight: 260, overflow: 'auto' }}>
                <table className="a-table">
                  <thead>
                    <tr>
                      <th>Email</th>
                      <th>Status</th>
                      <th>Requested</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((r) => (
                      <tr key={r._id}>
                        <td className="ltr" style={{ wordBreak: 'break-all' }}>{r.email}</td>
                        <td title={r.lastError || undefined}>
                          {RESTOCK_LABEL[r.status] ?? r.status}
                          {r.status === 'active' && r.lastError ? <span className="muted"> — {r.lastError}</span> : null}
                          {r.notifiedAt ? <span className="muted"> · {dt(r.notifiedAt)}</span> : null}
                        </td>
                        <td className="muted">{dt(r.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted" style={{ fontSize: 13 }}>No requests.</p>
            )}
          </>
        ) : null}
      </div>
    </Card>
  );
}
