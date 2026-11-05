import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ErrorState, Spinner } from '../../components/ui';
import { ApiError, api, patch, post, qs, uuid } from '../../lib/api';
import { useApi } from '../../lib/hooks';
import type { Localized } from '../../lib/types';
import { AHead, Card, dt, en, ErrorBox, F, Modal, Pager, sar, Status } from '../kit';
import { useToast } from '../../state/toast';

type OrderRow = {
  _id: string;
  orderNumber: string;
  contact: { name: string; email: string; phone: string };
  total: number;
  status: string;
  paymentStatus: string;
  paymentMethod: string;
  createdAt: string;
  needsReview?: boolean;
  items: { quantity: number }[];
};

const STATUSES = ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'returned'];
const NEXT: Record<string, string[]> = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['processing', 'shipped', 'cancelled'],
  processing: ['shipped', 'cancelled'],
  shipped: ['delivered', 'returned'],
  delivered: ['returned'],
  cancelled: [],
  returned: [],
};

export function Orders() {
  const [params, setParams] = useSearchParams();
  const [rows, setRows] = useState<OrderRow[] | null>(null);
  const [meta, setMeta] = useState({ page: 1, pages: 1, total: 0 });
  const [error, setError] = useState<ApiError | null>(null);
  const [q, setQ] = useState(params.get('q') ?? '');
  const query = qs({ status: params.get('status') ?? undefined, q: params.get('q') ?? undefined, page: params.get('page') ?? undefined, limit: 25 });
  useEffect(() => {
    setRows(null);
    api<OrderRow[]>(`/api/admin/orders${query}`)
      .then((r) => {
        setRows(r.data);
        setMeta({ page: Number(r.meta?.page ?? 1), pages: Number(r.meta?.pages ?? 1), total: Number(r.meta?.total ?? 0) });
      })
      .catch(setError);
  }, [query]);
  const set = (k: string, v: string) => {
    const n = new URLSearchParams(params);
    if (v) n.set(k, v);
    else n.delete(k);
    if (k !== 'page') n.delete('page');
    setParams(n);
  };
  if (error) return <ErrorState message={error.message} />;
  return (
    <>
      <AHead title={`Orders (${meta.total})`} />
      <div className="a-filters">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            set('q', q);
          }}
        >
          <input className="input" placeholder="Order #, name, email, phone, tracking…" value={q} onChange={(e) => setQ(e.target.value)} />
        </form>
        <select className="select" value={params.get('status') ?? ''} onChange={(e) => set('status', e.target.value)}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
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
                <th>Order</th>
                <th>Date</th>
                <th>Customer</th>
                <th>Items</th>
                <th>Total</th>
                <th>Payment</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => (
                <tr key={o._id}>
                  <td>
                    <Link to={`/admin/orders/${o._id}`}>{o.orderNumber}</Link> {o.needsReview ? <span className="badge badge--danger">review</span> : null}
                  </td>
                  <td>{dt(o.createdAt)}</td>
                  <td>
                    {o.contact.name}
                    <div className="muted">{o.contact.phone}</div>
                  </td>
                  <td>{o.items.reduce((s, i) => s + i.quantity, 0)}</td>
                  <td>{sar(o.total)}</td>
                  <td>
                    <Status value={o.paymentStatus} /> <span className="muted">{o.paymentMethod}</span>
                  </td>
                  <td>
                    <Status value={o.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {rows && !rows.length ? <p className="muted">No orders found.</p> : null}
        <Pager page={meta.page} pages={meta.pages} onPage={(pg) => set('page', String(pg))} />
      </div>
    </>
  );
}

type Detail = {
  order: {
    _id: string;
    orderNumber: string;
    status: string;
    paymentStatus: string;
    paymentMethod: string;
    createdAt: string;
    lang: string;
    contact: { name: string; email: string; phone: string };
    customer?: { _id: string; name: string; email: string } | null;
    shippingAddress: Record<string, string>;
    items: { sku: string; name: Localized; quantity: number; unitPrice: number; lineTotal: number; discount: number; image: string; warrantyMonths: number }[];
    subtotal: number;
    discountTotal: number;
    discount?: { code?: string };
    deliveryFee: number;
    codFee: number;
    total: number;
    vatAmount: number;
    refundedAmount: number;
    /** Refunds sent to the gateway whose outcome is not confirmed yet. */
    refundReservedAmount?: number;
    delivery: { courier: string; trackingNumber: string; trackingUrl: string; shippedAt?: string; deliveredAt?: string };
    customerNote: string;
    internalNotes: string;
    reservationExpiresAt?: string;
    history: { status: string; note: string; at: string; by?: { name: string } | null; visibleToCustomer: boolean }[];
  };
  payments: { _id: string; provider: string; method: string; amount: number; status: string; providerRef?: string; failureReason?: string; refundedAmount: number; createdAt: string }[];
  notifications: { _id: string; channel: string; template: string; to: string; status: string; detail: string; createdAt: string }[];
};

export function OrderDetail({ perms }: { perms: Set<string> }) {
  const { id } = useParams();
  const toast = useToast();
  const { data, error, loading, reload } = useApi<Detail>(`/api/admin/orders/${id}`);
  const [action, setAction] = useState<string | null>(null);
  const [form, setForm] = useState({ note: '', trackingNumber: '', courier: '', notifyCustomer: true, restock: true, amount: '', reason: '' });
  const [err, setErr] = useState<unknown>(null);
  const [notes, setNotes] = useState<string | null>(null);
  // One idempotency key per refund dialog: a double click or a retry after a timeout returns the same refund.
  const [refundKey, setRefundKey] = useState('');
  const [refundBusy, setRefundBusy] = useState(false);
  const [ledgerKey, setLedgerKey] = useState(0);
  if (error) return <ErrorState message={error.message} onRetry={reload} />;
  if (loading || !data) return <Spinner />;
  const o = data.order;
  const canWrite = perms.has('orders:write');

  const doStatus = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    try {
      await post(`/api/admin/orders/${o._id}/status`, {
        status: action,
        note: form.note,
        notifyCustomer: form.notifyCustomer,
        trackingNumber: action === 'shipped' ? form.trackingNumber : undefined,
        courier: action === 'shipped' && form.courier ? form.courier : undefined,
        restock: form.restock,
      });
      toast(`Order marked ${action}`);
      setAction(null);
      reload();
    } catch (ex) {
      setErr(ex);
    }
  };
  const doRefund = async (e: FormEvent) => {
    e.preventDefault();
    if (refundBusy) return;
    setErr(null);
    setRefundBusy(true);
    try {
      const r = await post<{ status: string; message?: string }>(`/api/admin/orders/${o._id}/refund`, { amount: Math.round(Number(form.amount) * 100), reason: form.reason, idempotencyKey: refundKey });
      if (r.status === 'succeeded') toast('Refund completed');
      else if (r.status === 'reconciliation_required') toast(r.message ?? 'Refund sent — waiting for gateway confirmation', 'error');
      else toast(`Refund ${r.status}`);
      setAction(null);
      setLedgerKey((k) => k + 1);
      reload();
    } catch (ex) {
      setErr(ex);
    } finally {
      setRefundBusy(false);
    }
  };
  const review = o.history.filter((h) => h.status === 'payment_review');

  return (
    <>
      <AHead title={`Order ${o.orderNumber}`}>
        <Link to="/admin/orders" className="btn btn--ghost btn--sm">
          ← Orders
        </Link>
      </AHead>
      {review.length ? (
        <div className="alert alert--error" style={{ marginBottom: 12 }}>
          {review.map((r, i) => (
            <div key={i}>⚠ {r.note}</div>
          ))}
        </div>
      ) : null}
      <div className="a-grid-2">
        <div>
          <Card
            title="Status"
            actions={
              canWrite ? (
                <div className="actions">
                  {NEXT[o.status].map((s) => (
                    <button key={s} className={`btn btn--sm ${s === 'cancelled' || s === 'returned' ? 'btn--outline' : 'btn--primary'}`} onClick={() => setAction(s)} data-testid={`to-${s}`}>
                      Mark {s}
                    </button>
                  ))}
                  {o.paymentMethod !== 'cod' && ['pending', 'failed'].includes(o.paymentStatus) ? (
                    <button
                      className="btn btn--outline btn--sm"
                      onClick={async () => {
                        const r = await post<{ paymentStatus: string }>(`/api/admin/orders/${o._id}/verify-payment`);
                        toast(`Gateway status: ${r.paymentStatus}`);
                        reload();
                      }}
                    >
                      Check payment with gateway
                    </button>
                  ) : null}
                </div>
              ) : null
            }
          >
            <dl className="kv">
              <dt>Status</dt>
              <dd>
                <Status value={o.status} />
              </dd>
              <dt>Payment</dt>
              <dd>
                <Status value={o.paymentStatus} /> via {o.paymentMethod}
              </dd>
              <dt>Placed</dt>
              <dd>{dt(o.createdAt)}</dd>
              {o.reservationExpiresAt && o.status === 'pending' ? (
                <>
                  <dt>Stock held until</dt>
                  <dd>{dt(o.reservationExpiresAt)}</dd>
                </>
              ) : null}
              <dt>Courier</dt>
              <dd>{o.delivery.courier || '—'}</dd>
              <dt>Tracking</dt>
              <dd>{o.delivery.trackingNumber || '—'}</dd>
              <dt>Customer language</dt>
              <dd>{o.lang === 'en' ? 'English' : 'Arabic'}</dd>
            </dl>
          </Card>
          <Card title="Items">
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>Product</th>
                    <th>Qty</th>
                    <th>Unit</th>
                    <th>Discount</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {o.items.map((i) => (
                    <tr key={i.sku}>
                      <td>{i.sku}</td>
                      <td>{en(i.name)}</td>
                      <td>{i.quantity}</td>
                      <td>{sar(i.unitPrice)}</td>
                      <td>{i.discount ? `−${sar(i.discount)}` : '—'}</td>
                      <td>{sar(i.lineTotal - i.discount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <dl className="kv" style={{ marginTop: 12, maxWidth: 380, marginInlineStart: 'auto' }}>
              <dt>Subtotal</dt>
              <dd>{sar(o.subtotal)}</dd>
              <dt>Discount {o.discount?.code ? `(${o.discount.code})` : ''}</dt>
              <dd>−{sar(o.discountTotal)}</dd>
              <dt>Delivery</dt>
              <dd>{o.deliveryFee ? sar(o.deliveryFee) : 'Free'}</dd>
              {o.codFee ? (
                <>
                  <dt>COD fee</dt>
                  <dd>{sar(o.codFee)}</dd>
                </>
              ) : null}
              <dt>
                <strong>Total</strong>
              </dt>
              <dd>
                <strong>{sar(o.total)}</strong>
              </dd>
              <dt>VAT included</dt>
              <dd>{sar(o.vatAmount)}</dd>
              {o.refundedAmount ? (
                <>
                  <dt>Refunded</dt>
                  <dd>{sar(o.refundedAmount)}</dd>
                </>
              ) : null}
            </dl>
          </Card>
          <Card
            title="Payments"
            actions={
              perms.has('orders:refund') && ['paid', 'partially_refunded', 'cod_collected'].includes(o.paymentStatus) ? (
                <button className="btn btn--outline btn--sm" onClick={() => (setRefundKey(`rf_${uuid()}`), setErr(null), setAction('refund'))}>
                  Refund…
                </button>
              ) : null
            }
          >
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Gateway</th>
                    <th>Method</th>
                    <th>Amount</th>
                    <th>Status</th>
                    <th>Reference</th>
                  </tr>
                </thead>
                <tbody>
                  {data.payments.map((p) => (
                    <tr key={p._id}>
                      <td>{dt(p.createdAt)}</td>
                      <td>{p.provider}</td>
                      <td>{p.method}</td>
                      <td>
                        {sar(p.amount)}
                        {p.refundedAmount ? <div className="muted">refunded {sar(p.refundedAmount)}</div> : null}
                      </td>
                      <td>
                        <Status value={p.status} />
                        {p.failureReason ? <div className="muted">{p.failureReason}</div> : null}
                      </td>
                      <td className="ltr" style={{ wordBreak: 'break-all' }}>
                        {p.providerRef ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!data.payments.length ? <p className="muted">{o.paymentMethod === 'cod' ? 'Cash on delivery — collected by the courier.' : 'No payment attempts yet.'}</p> : null}
            <RefundLedger orderId={o._id} canRefund={perms.has('orders:refund')} refreshKey={ledgerKey} onChanged={reload} />
          </Card>
          <Card title="Timeline">
            <ol className="timeline">
              {[...o.history].reverse().map((h, i) => (
                <li key={i}>
                  <strong>{h.status}</strong> {!h.visibleToCustomer ? <span className="badge">internal</span> : null}
                  <div className="muted">
                    {dt(h.at)} {h.by?.name ? `· ${h.by.name}` : ''} {h.note ? `· ${h.note}` : ''}
                  </div>
                </li>
              ))}
            </ol>
          </Card>
        </div>
        <div>
          <Card title="Customer">
            <p>
              <strong>{o.contact.name}</strong>
              <br />
              <a href={`mailto:${o.contact.email}`}>{o.contact.email}</a>
              <br />
              <a href={`tel:${o.contact.phone}`}>{o.contact.phone}</a>
            </p>
            {o.customer ? <Link to={`/admin/customers/${o.customer._id}`}>Customer account →</Link> : <span className="badge">Guest checkout</span>}
          </Card>
          <Card title="Ship to">
            <p>
              {o.shippingAddress.fullName} · {o.shippingAddress.phone}
              <br />
              {o.shippingAddress.street} {o.shippingAddress.buildingNumber}
              <br />
              {o.shippingAddress.district}, {o.shippingAddress.city} {o.shippingAddress.postalCode}
              {o.shippingAddress.shortAddress ? (
                <>
                  <br />
                  Short address: {o.shippingAddress.shortAddress}
                </>
              ) : null}
              {o.shippingAddress.notes ? (
                <>
                  <br />
                  <em>{o.shippingAddress.notes}</em>
                </>
              ) : null}
            </p>
            {o.customerNote ? <p className="alert">Customer note: {o.customerNote}</p> : null}
          </Card>
          <Card title="Internal notes">
            <textarea className="textarea" value={notes ?? o.internalNotes} onChange={(e) => setNotes(e.target.value)} disabled={!canWrite} />
            {canWrite && notes !== null ? (
              <button
                className="btn btn--outline btn--sm"
                style={{ marginTop: 8 }}
                onClick={async () => {
                  await patch(`/api/admin/orders/${o._id}/notes`, { internalNotes: notes });
                  toast('Notes saved');
                  setNotes(null);
                  reload();
                }}
              >
                Save notes
              </button>
            ) : null}
          </Card>
          <Card
            title="Customer notifications"
            actions={
              canWrite ? (
                <button
                  className="btn btn--ghost btn--sm"
                  onClick={async () => {
                    await post(`/api/admin/orders/${o._id}/resend-notification`);
                    reload();
                  }}
                >
                  Resend latest
                </button>
              ) : null
            }
          >
            {data.notifications.map((n) => (
              <div key={n._id} className="picker__row">
                <span>
                  {n.channel} · {n.template}
                  <div className="muted">{dt(n.createdAt)}</div>
                </span>
                <span title={n.detail}>
                  <Status value={n.status} />
                </span>
              </div>
            ))}
            {!data.notifications.length ? <p className="muted">None yet.</p> : null}
            <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
              “skipped” means the email/WhatsApp provider is not configured yet (Settings → Integrations).
            </p>
          </Card>
        </div>
      </div>

      {action && action !== 'refund' ? (
        <Modal title={`Mark order as ${action}`} onClose={() => setAction(null)}>
          <form className="form-grid" onSubmit={doStatus}>
            <ErrorBox error={err} />
            {action === 'shipped' ? (
              <>
                <F label="Tracking number">
                  <input className="input" value={form.trackingNumber} onChange={(e) => setForm({ ...form, trackingNumber: e.target.value })} data-testid="tracking-input" />
                </F>
                <F label="Courier" hint="Leave empty to use the default courier from Settings">
                  <input className="input" value={form.courier} onChange={(e) => setForm({ ...form, courier: e.target.value })} />
                </F>
              </>
            ) : null}
            {action === 'returned' ? (
              <label className="check">
                <input type="checkbox" checked={form.restock} onChange={(e) => setForm({ ...form, restock: e.target.checked })} /> Return items to stock
              </label>
            ) : null}
            {action === 'cancelled' && ['paid', 'cod_collected'].includes(o.paymentStatus) ? <p className="alert alert--warning">This order was paid — remember to issue a refund after cancelling.</p> : null}
            <F label="Note (visible to the customer)">
              <input className="input" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
            </F>
            <label className="check">
              <input type="checkbox" checked={form.notifyCustomer} onChange={(e) => setForm({ ...form, notifyCustomer: e.target.checked })} /> Notify the customer (email + WhatsApp)
            </label>
            <button className="btn btn--primary" data-testid="confirm-status">
              Confirm
            </button>
          </form>
        </Modal>
      ) : null}
      {action === 'refund' ? (
        <Modal title="Refund" onClose={() => setAction(null)}>
          <form className="form-grid" onSubmit={doRefund}>
            <ErrorBox error={err} />
            <p className="muted">
              Refundable: {sar(o.total - (o.refundedAmount ?? 0) - (o.refundReservedAmount ?? 0))}
              {o.refundReservedAmount ? ` (${sar(o.refundReservedAmount)} is held by refunds awaiting gateway confirmation)` : ''}. Online payments are refunded through the gateway; COD refunds are recorded only.
            </p>
            <F label="Amount (SAR)">
              <input className="input" inputMode="decimal" required value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            </F>
            <F label="Reason">
              <input className="input" required value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
            </F>
            <button className="btn btn--primary" disabled={refundBusy}>
              {refundBusy ? 'Refunding…' : 'Refund'}
            </button>
          </form>
        </Modal>
      ) : null}
    </>
  );
}

type RefundRow = {
  _id: string;
  amount: number;
  reason: string;
  status: 'requested' | 'reserved' | 'processing' | 'succeeded' | 'failed' | 'reconciliation_required';
  provider: string;
  providerRefundId?: string;
  lastError?: string;
  legacy?: boolean;
  requestedBy?: { name: string } | null;
  createdAt: string;
  history: { status: string; note: string; at: string }[];
};

const REFUND_LABEL: Record<RefundRow['status'], string> = {
  requested: 'requested',
  reserved: 'reserved',
  processing: 'processing at gateway',
  succeeded: 'refunded',
  failed: 'failed',
  reconciliation_required: 'awaiting confirmation',
};

/** Refund ledger: every refund request with its lifecycle; uncertain refunds can be re-checked or resolved. */
function RefundLedger({ orderId, canRefund, refreshKey, onChanged }: { orderId: string; canRefund: boolean; refreshKey: number; onChanged: () => void }) {
  const [rows, setRows] = useState<RefundRow[] | null>(null);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState<unknown>(null);
  const [resolve, setResolve] = useState<{ id: string; outcome: 'succeeded' | 'failed'; note: string } | null>(null);
  const toast = useToast();
  const load = () =>
    api<{ refunds: RefundRow[] }>(`/api/admin/orders/${orderId}/refunds`)
      .then((r) => setRows(r.data.refunds))
      .catch(setErr);
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, refreshKey]);
  if (!rows || !rows.length) return err ? <ErrorBox error={err} /> : null;
  const open = rows.some((r) => r.status === 'reconciliation_required' || r.status === 'processing');
  const run = async (label: string, fn: () => Promise<void>) => {
    setErr(null);
    setBusy(label);
    try {
      await fn();
      await load();
      onChanged();
    } catch (e) {
      setErr(e);
    } finally {
      setBusy('');
    }
  };
  return (
    <div style={{ marginTop: 16 }}>
      <div className="refund-list__head">
        <strong>Refunds</strong>
        {open && canRefund ? (
          <button
            className="btn btn--outline btn--sm"
            disabled={Boolean(busy)}
            onClick={() =>
              void run('reconcile', async () => {
                const r = await post<{ results: { note: string }[] }>(`/api/admin/orders/${orderId}/refunds/reconcile`);
                toast(r.results.map((x) => x.note).join(' · ') || 'Checked with the gateway');
              })
            }
          >
            {busy === 'reconcile' ? 'Checking…' : 'Check with gateway'}
          </button>
        ) : null}
      </div>
      <ErrorBox error={err} />
      {open ? (
        <p className="alert alert--warning" style={{ fontSize: 13 }}>
          A refund is awaiting gateway confirmation. Its amount stays reserved so it cannot be refunded twice. Do not refund it again from the gateway dashboard — use “Check with gateway”, or resolve it after checking the dashboard.
        </p>
      ) : null}
      <ul className="refund-list">
        {rows.map((r) => (
          <li key={r._id}>
            <div className="refund-list__head">
              <span>
                <strong>{sar(r.amount)}</strong> · {r.reason || '—'} {r.legacy ? <span className="muted">(recorded before the ledger)</span> : null}
              </span>
              <span className={`badge ${r.status === 'succeeded' ? 'badge--success' : r.status === 'failed' ? 'badge--danger' : 'badge--warning'}`}>{REFUND_LABEL[r.status] ?? r.status}</span>
            </div>
            <span className="muted" style={{ fontSize: 12 }}>
              {dt(r.createdAt)} · {r.provider}
              {r.requestedBy?.name ? ` · by ${r.requestedBy.name}` : ''}
              {r.providerRefundId ? ` · gateway ref ${r.providerRefundId}` : ''}
            </span>
            {r.lastError && r.status !== 'succeeded' ? <span className="muted" style={{ fontSize: 12 }}>{r.lastError}</span> : null}
            {canRefund && (r.status === 'reconciliation_required' || r.status === 'processing') ? (
              <div className="actions">
                <button className="btn btn--ghost btn--sm" onClick={() => setResolve({ id: r._id, outcome: 'succeeded', note: '' })}>
                  Gateway shows it refunded…
                </button>
                <button className="btn btn--ghost btn--sm danger" onClick={() => setResolve({ id: r._id, outcome: 'failed', note: '' })}>
                  Gateway shows no refund…
                </button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      {resolve ? (
        <Modal title={resolve.outcome === 'succeeded' ? 'Confirm the refund happened' : 'Confirm the refund did NOT happen'} onClose={() => setResolve(null)}>
          <p className="muted">
            {resolve.outcome === 'succeeded'
              ? 'Only confirm after seeing this refund in the gateway dashboard. The amount will be counted as refunded.'
              : 'Only confirm after checking the gateway dashboard shows no such refund. The reserved amount is released and can be refunded again.'}
          </p>
          <F label="What did you check? (kept in the activity log)">
            <input className="input" value={resolve.note} onChange={(e) => setResolve({ ...resolve, note: e.target.value })} />
          </F>
          <button
            className="btn btn--primary"
            disabled={resolve.note.trim().length < 3 || Boolean(busy)}
            onClick={() =>
              void run('resolve', async () => {
                await post(`/api/admin/orders/${orderId}/refunds/${resolve.id}/resolve`, { outcome: resolve.outcome, note: resolve.note });
                setResolve(null);
                toast('Refund resolved');
              })
            }
          >
            Confirm
          </button>
        </Modal>
      ) : null}
    </div>
  );
}
