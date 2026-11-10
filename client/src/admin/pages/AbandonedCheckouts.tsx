import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, del } from '../../lib/api';
import { useApi } from '../../lib/hooks';
import type { Localized } from '../../lib/types';
import { useToast } from '../../state/toast';
import { AHead, Card, dt, EmptyState, en, ErrorPanel, Pager, sar, SkeletonTable, Status } from '../kit';

/**
 * Admin → Abandoned checkouts: checkouts customers started but did not finish (saved while they
 * typed). Statuses come from the server: in progress → abandoned after the inactivity period set in
 * Settings → Warranty, VAT & stock → Checkout recovery; recovered when the customer came back;
 * converted once it became an order. Only what the customer actually entered is shown — never card
 * details (the checkout has none).
 */
type DraftStatus = 'in_progress' | 'abandoned' | 'recovered' | 'converted';
type Draft = {
  id: string;
  status: DraftStatus;
  customer: string | null;
  contact: { name: string; email: string; phone: string };
  shippingAddress: { fullName: string; phone: string; city: string; district: string; street: string; buildingNumber: string; postalCode: string; shortAddress: string };
  paymentMethod: string;
  discountCode: string;
  lang: string;
  items: { productId: string; sku: string; slug: string; model: string; name: Localized; image: string; unitPrice: number; quantity: number; lineTotal: number }[];
  itemCount: number;
  subtotal: number;
  total: number;
  progress: number;
  completedFields: string[];
  missingFields: string[];
  startedAt: string;
  lastActivityAt: string;
  abandonedAt: string | null;
  returned: boolean;
  returnCount: number;
  recoveredAt: string | null;
  convertedAt: string | null;
  order: { id: string; orderNumber: string } | null;
  expiresAt: string;
};

const FILTERS: [string, string][] = [
  ['incomplete', 'All incomplete'],
  ['abandoned_recent', 'Recently abandoned'],
  ['in_progress', 'In progress'],
  ['recovered', 'Recovered'],
  ['converted', 'Converted to order'],
  ['abandoned', 'All abandoned'],
  ['all', 'All'],
];
const STATUS_LABEL: Record<DraftStatus, string> = { in_progress: 'In progress', abandoned: 'Abandoned', recovered: 'Recovered', converted: 'Converted' };
const STATUS_TONE: Record<DraftStatus, string> = { in_progress: 'processing', abandoned: 'cancelled', recovered: 'confirmed', converted: 'delivered' };
const FIELD_LABEL: Record<string, string> = {
  name: 'Name',
  email: 'Email',
  phone: 'Phone',
  fullName: 'Recipient name',
  addressPhone: 'Recipient phone',
  city: 'City',
  district: 'District',
  street: 'Street',
  paymentMethod: 'Payment method',
};
const METHOD_LABEL: Record<string, string> = { card: 'Card (mada / Visa / Mastercard)', applepay: 'Apple Pay', stcpay: 'STC Pay', tabby: 'Tabby', cod: 'Cash on delivery' };

/** "12 min ago", "3 h ago", "2 d ago". */
export function since(iso: string, now = Date.now()) {
  const m = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

function DraftStatusBadge({ status }: { status: DraftStatus }) {
  return (
    <span data-testid="draft-status-badge" data-status={status}>
      <Status value={STATUS_TONE[status]} label={STATUS_LABEL[status]} />
    </span>
  );
}

function Progress({ value }: { value: number }) {
  return (
    <span className="draft-progress" title={`${value}% of the checkout form completed`}>
      <span className="draft-progress__bar" aria-hidden="true">
        <span style={{ width: `${value}%` }} />
      </span>
      <span className="draft-progress__num">{value}%</span>
    </span>
  );
}

const who = (d: Draft) => d.contact.name || d.shippingAddress.fullName || '';

export function AbandonedCheckouts() {
  const [params, setParams] = useSearchParams();
  const filter = params.get('filter') ?? 'incomplete';
  const page = Number(params.get('page') ?? 1);
  const [q, setQ] = useState(params.get('q') ?? '');
  const [rows, setRows] = useState<Draft[] | null>(null);
  const [meta, setMeta] = useState<{ total: number; pages: number; counts: Record<string, number>; abandonAfterMinutes: number; retentionDays: number } | null>(null);
  const [error, setError] = useState(false);
  const [nonce, setNonce] = useState(0);
  const query = new URLSearchParams({ filter, page: String(page), limit: '25', ...(params.get('q') ? { q: params.get('q')! } : {}) }).toString();

  useEffect(() => {
    setRows(null);
    setError(false);
    api<Draft[]>(`/api/admin/checkouts?${query}`)
      .then((r) => {
        setRows(r.data);
        setMeta(r.meta as typeof meta);
      })
      .catch(() => setError(true));
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
      <AHead title="Abandoned checkouts" />
      <p className="muted" style={{ marginTop: -8 }}>
        Checkouts customers started but did not finish, saved while they typed. A checkout counts as abandoned after {meta?.abandonAfterMinutes ?? '…'} minutes without activity and is
        deleted {meta?.retentionDays ?? '…'} days after the last activity (Settings → Warranty, VAT &amp; stock → Checkout recovery). Card details are never saved.
      </p>
      <div className="a-filters">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            set('q', q.trim());
          }}
        >
          <input className="input" placeholder="Search name, email, phone or order number…" value={q} onChange={(e) => setQ(e.target.value)} data-testid="drafts-search" />
        </form>
      </div>
      <div className="a-tabs" role="tablist" aria-label="Checkout status" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '12px 0' }}>
        {FILTERS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={filter === key}
            className={`btn btn--sm ${filter === key ? 'btn--primary' : 'btn--outline'}`}
            data-testid={`drafts-filter-${key}`}
            onClick={() => set('filter', key === 'incomplete' ? '' : key)}
          >
            {label}
            {meta?.counts?.[key] !== undefined ? <span className="muted"> ({meta.counts[key]})</span> : null}
          </button>
        ))}
      </div>
      <div className="a-card table-wrap">
        {error ? (
          <ErrorPanel onRetry={() => setNonce((n) => n + 1)} />
        ) : !rows ? (
          <SkeletonTable rows={6} cols={8} />
        ) : !rows.length ? (
          <EmptyState title="No checkouts here" text="Checkouts appear as soon as a customer starts typing at checkout." />
        ) : (
          <table className="table" data-testid="drafts-table">
            <thead>
              <tr>
                <th>Customer</th>
                <th>Phone</th>
                <th>Email</th>
                <th>Products</th>
                <th>Cart value</th>
                <th>Progress</th>
                <th>Status</th>
                <th>Started</th>
                <th>Last activity</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.id} data-testid="draft-row">
                  <td>
                    <Link to={`/admin/checkouts/${d.id}`}>{who(d) || <span className="muted">Anonymous visitor</span>}</Link>
                    {d.customer ? <div className="muted" style={{ fontSize: 12 }}>Signed-in customer</div> : null}
                  </td>
                  <td className="ltr">{d.contact.phone || d.shippingAddress.phone || '—'}</td>
                  <td className="ltr">{d.contact.email || '—'}</td>
                  <td>
                    {d.items.length ? (
                      <span title={d.items.map((i) => `${en(i.name)} ×${i.quantity}`).join('\n')}>
                        {en(d.items[0].name)}
                        {d.items.length > 1 ? <span className="muted"> +{d.items.length - 1} more</span> : null}
                        <div className="muted" style={{ fontSize: 12 }}>{d.itemCount} item{d.itemCount === 1 ? '' : 's'}</div>
                      </span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td>{sar(d.total)}</td>
                  <td>
                    <Progress value={d.progress} />
                  </td>
                  <td>
                    <DraftStatusBadge status={d.status} />
                    {d.order ? (
                      <div style={{ fontSize: 12 }}>
                        <Link to={`/admin/orders/${d.order.id}`}>{d.order.orderNumber}</Link>
                      </div>
                    ) : null}
                  </td>
                  <td>{dt(d.startedAt)}</td>
                  <td>
                    {dt(d.lastActivityAt)}
                    <div className="muted" style={{ fontSize: 12 }}>{since(d.lastActivityAt)}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {meta && meta.pages > 1 ? <Pager page={page} pages={meta.pages} onPage={(n) => set('page', String(n))} /> : null}
    </>
  );
}

export function AbandonedCheckoutDetail({ canDelete }: { canDelete: boolean }) {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const { data: d, error, reload } = useApi<Draft>(`/api/admin/checkouts/${id}`);
  if (error) return <ErrorPanel onRetry={reload} message={error.status === 404 ? 'This checkout no longer exists (deleted or past its retention period).' : undefined} />;
  if (!d) return <SkeletonTable rows={6} cols={2} />;
  const a = d.shippingAddress;
  const row = (label: string, value: string | undefined, ltr = false) => (
    <div className="kv" style={{ display: 'grid', gridTemplateColumns: '160px 1fr', gap: 12, padding: '6px 0' }}>
      <span className="muted">{label}</span>
      <span className={ltr ? 'ltr' : ''}>{value || <span className="muted">Not entered</span>}</span>
    </div>
  );
  return (
    <>
      <AHead title={who(d) || 'Anonymous checkout'}>
        <Link to="/admin/checkouts" className="btn btn--ghost btn--sm">
          ← Abandoned checkouts
        </Link>
        {canDelete ? (
          <button
            type="button"
            className="btn btn--outline btn--sm"
            data-testid="draft-delete"
            onClick={async () => {
              if (!window.confirm('Delete this saved checkout? The customer’s entries are removed permanently.')) return;
              await del(`/api/admin/checkouts/${d.id}`);
              toast('Saved checkout deleted');
              nav('/admin/checkouts');
            }}
          >
            Delete
          </button>
        ) : null}
      </AHead>
      <div className="a-grid-2">
        <div>
          <Card title="Status">
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <DraftStatusBadge status={d.status} />
              <Progress value={d.progress} />
            </div>
            {row('Started', dt(d.startedAt))}
            {row('Last saved', `${dt(d.lastActivityAt)} (${since(d.lastActivityAt)})`)}
            {row('Abandoned at', d.abandonedAt ? dt(d.abandonedAt) : '—')}
            {row('Customer returned', d.returned ? `Yes, ${d.returnCount} time${d.returnCount === 1 ? '' : 's'}${d.recoveredAt ? ` (last ${dt(d.recoveredAt)})` : ''}` : 'No')}
            {row('Converted to order', d.order ? `${d.order.orderNumber} on ${dt(d.convertedAt ?? undefined)}` : 'No')}
            {d.order ? (
              <p style={{ marginTop: 8 }}>
                <Link className="btn btn--outline btn--sm" to={`/admin/orders/${d.order.id}`} data-testid="draft-order-link">
                  Open order {d.order.orderNumber}
                </Link>
              </p>
            ) : null}
            {row('Deleted automatically', dt(d.expiresAt))}
          </Card>
          <Card title="Checkout progress">
            <p className="muted" style={{ fontSize: 13 }}>
              Completed: {d.completedFields.length ? d.completedFields.map((f) => FIELD_LABEL[f] ?? f).join(', ') : 'nothing yet'}
            </p>
            <p style={{ fontSize: 13 }} data-testid="draft-missing">
              Still missing: {d.missingFields.length ? d.missingFields.map((f) => FIELD_LABEL[f] ?? f).join(', ') : 'nothing — the form was complete'}
            </p>
          </Card>
          <Card title="Customer (as entered)">
            {row('Name', d.contact.name)}
            {row('Email', d.contact.email, true)}
            {row('Phone', d.contact.phone, true)}
            {row('Account', d.customer ? 'Signed-in customer' : 'Guest')}
            {row('Language', d.lang === 'en' ? 'English' : 'Arabic')}
          </Card>
          <Card title="Delivery address (as entered)">
            {row('Recipient', a.fullName)}
            {row('Recipient phone', a.phone, true)}
            {row('City', a.city)}
            {row('District', a.district)}
            {row('Street', a.street)}
            {row('Building no.', a.buildingNumber, true)}
            {row('Postal code', a.postalCode, true)}
            {row('Short address', a.shortAddress, true)}
          </Card>
        </div>
        <div>
          <Card title={`Products (${d.itemCount})`}>
            {d.items.length ? (
              <table className="table" data-testid="draft-items">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Qty</th>
                    <th>Unit price</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {d.items.map((i) => (
                    <tr key={i.productId}>
                      <td>
                        {en(i.name)}
                        <div className="muted ltr" style={{ fontSize: 12 }}>
                          {i.sku}
                          {i.model ? ` · ${i.model}` : ''}
                        </div>
                      </td>
                      <td>{i.quantity}</td>
                      <td>{sar(i.unitPrice)}</td>
                      <td>{sar(i.lineTotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="muted">No products saved.</p>
            )}
            {row('Subtotal', sar(d.subtotal))}
            {row('Cart total', sar(d.total))}
            {row('Discount code', d.discountCode)}
            {row('Payment method', METHOD_LABEL[d.paymentMethod] ?? d.paymentMethod)}
            <p className="muted" style={{ fontSize: 12 }}>Prices are the store’s prices when the checkout was last saved. Card details are never collected here.</p>
          </Card>
        </div>
      </div>
    </>
  );
}
