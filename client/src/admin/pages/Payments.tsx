import { useState } from 'react';
import { Link } from 'react-router-dom';
import { apiUrl, qs } from '../../lib/api';
import { useApi, useDebounced } from '../../lib/hooks';
import { useAT } from '../i18n';
import { AHead, EmptyState, ErrorPanel, Modal, Pager, SkeletonTable } from '../kit';

/**
 * Admin → Payments: every gateway payment record (Moyasar, Tabby, sandbox). Only what the store
 * keeps — gateway references, amounts, statuses and the event history. No card data exists here:
 * customers pay on the gateway's own hosted page.
 */
type PaymentRow = {
  _id: string;
  order: { _id: string; orderNumber: string; status: string; paymentStatus: string; total: number } | null;
  provider: string;
  method: string;
  amount: number;
  currency: string;
  status: string;
  providerRef?: string;
  failureReason?: string;
  refundedAmount?: number;
  createdAt: string;
  updatedAt: string;
};
type Detail = PaymentRow & { events: { type: string; source: string; status: string; at: string }[]; refunds: { amount: number; reason?: string; providerRefundId?: string; at: string; by?: { name: string } }[]; captureRequestedAt?: string };
type Payload = { items: PaymentRow[]; total: number; page: number; pages: number; counts: Record<string, { n: number; amount: number }> };

const STATUSES = ['paid', 'pending', 'authorized', 'initiated', 'failed', 'cancelled', 'expired', 'partially_refunded', 'refunded'];
const TONE: Record<string, string> = { paid: 'st--paid', partially_refunded: 'st--cod', refunded: 'st--neutral', failed: 'st--negative', cancelled: 'st--negative', expired: 'st--negative', pending: 'st--cod', authorized: 'st--cod', initiated: 'st--neutral' };
const PROVIDER: Record<string, string> = { moyasar: 'Moyasar', tabby: 'Tabby', sandbox: 'Sandbox (test)', cod: 'Cash on delivery' };
const label = (s: string) => s.replace(/_/g, ' ');

function Chip({ status }: { status: string }) {
  return (
    <span className={`st ${TONE[status] ?? 'st--neutral'}`}>
      <span className="st__dot" aria-hidden="true" />
      {label(status)}
    </span>
  );
}

export function Payments() {
  const { sar, n, dt } = useAT();
  const [status, setStatus] = useState('');
  const [provider, setProvider] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const search = useDebounced(q.trim(), 300);
  const { data, error, loading, reload } = useApi<Payload>(`/api/admin/payments${qs({ status: status || undefined, provider: provider || undefined, q: search || undefined, page })}`);
  const c = data?.counts ?? {};

  return (
    <div className="a-page" data-testid="admin-payments">
      <AHead title="Payments">
        <a className="btn btn--outline btn--sm" href={apiUrl('/api/admin/reports/payments.csv')} download>
          Export CSV (last 30 days)
        </a>
      </AHead>
      <p className="a-muted" style={{ marginTop: -8 }}>
        Gateway payment records. An order is marked paid only after the gateway itself confirms the payment (never from the customer's browser). Amounts are in SAR, the currency customers are charged in. No card details are stored.
      </p>
      <div className="a-card a-card--flush">
        <div className="a-filterbar" role="search">
          <label className="a-filterbar__search">
            <span className="sr-only">Search by transaction reference or order number</span>
            <input className="a-input" type="search" maxLength={120} placeholder="Transaction reference or order number (CEL-…)" value={q} onChange={(e) => (setQ(e.target.value), setPage(1))} data-testid="payment-search" />
          </label>
          <select className="a-select" value={status} onChange={(e) => (setStatus(e.target.value), setPage(1))} aria-label="Payment status" data-testid="payment-status">
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {label(s)}
                {c[s] ? ` (${c[s].n})` : ''}
              </option>
            ))}
          </select>
          <select className="a-select" value={provider} onChange={(e) => (setProvider(e.target.value), setPage(1))} aria-label="Gateway">
            <option value="">All gateways</option>
            {Object.entries(PROVIDER).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: '0 16px 12px' }}>
          {(['failed', 'pending', 'authorized'] as const).map((s) =>
            c[s]?.n ? (
              <button key={s} type="button" className="btn btn--ghost btn--sm" onClick={() => (setStatus(s), setPage(1))}>
                <Chip status={s} /> {n(c[s].n)} · {sar(c[s].amount)}
              </button>
            ) : null,
          )}
        </div>
        {error ? <ErrorPanel onRetry={reload} /> : null}
        {loading && !data ? <SkeletonTable rows={6} cols={6} /> : null}
        {data && !data.items.length ? <EmptyState title="No payments match" text="Cash-on-delivery orders have no gateway payment record." /> : null}
        {data?.items.length ? (
          <div className="a-table-wrap">
            <table className="a-table">
              <thead>
                <tr>
                  <th>Created</th>
                  <th>Order</th>
                  <th>Gateway / method</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'end' }}>Amount</th>
                  <th>Reference</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((p) => (
                  <tr key={p._id} data-testid="payment-row">
                    <td>{dt(p.createdAt)}</td>
                    <td>{p.order ? <Link to={`/admin/orders/${p.order._id}`}>{p.order.orderNumber}</Link> : '—'}</td>
                    <td>
                      {PROVIDER[p.provider] ?? p.provider} · {p.method}
                    </td>
                    <td>
                      <Chip status={p.status} />
                      {p.failureReason ? <div className="a-muted" style={{ fontSize: 12 }}>{p.failureReason.slice(0, 80)}</div> : null}
                    </td>
                    <td className="ltr" style={{ textAlign: 'end' }}>
                      {sar(p.amount)} <span className="a-muted">{p.currency}</span>
                      {p.refundedAmount ? <div className="a-muted" style={{ fontSize: 12 }}>refunded {sar(p.refundedAmount)}</div> : null}
                    </td>
                    <td>
                      <button type="button" className="btn btn--ghost btn--sm ltr" onClick={() => setOpen(p._id)} title="Transaction details">
                        {p.providerRef ? p.providerRef.slice(0, 22) : 'details'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {data && data.pages > 1 ? <Pager page={data.page} pages={data.pages} onPage={setPage} /> : null}
      </div>
      {open ? <PaymentDetail id={open} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}

function PaymentDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { sar, dt } = useAT();
  const { data, error } = useApi<Detail>(`/api/admin/payments/${id}`);
  return (
    <Modal title="Payment details" onClose={onClose} wide>
      {error ? <p className="alert alert--error">Could not load this payment.</p> : null}
      {data ? (
        <div data-testid="payment-detail">
          <table className="a-table">
            <tbody>
              <tr><td>Order</td><td>{data.order ? <Link to={`/admin/orders/${data.order._id}`}>{data.order.orderNumber}</Link> : '—'} {data.order ? <span className="a-muted">· order {label(data.order.status)}, payment {label(data.order.paymentStatus)}</span> : null}</td></tr>
              <tr><td>Gateway / method</td><td>{PROVIDER[data.provider] ?? data.provider} · {data.method}</td></tr>
              <tr><td>Amount</td><td className="ltr">{sar(data.amount)} {data.currency}</td></tr>
              <tr><td>Status</td><td><Chip status={data.status} /></td></tr>
              <tr><td>Transaction reference</td><td className="ltr" style={{ wordBreak: 'break-all' }}>{data.providerRef || '—'}</td></tr>
              {data.failureReason ? <tr><td>Reason</td><td>{data.failureReason}</td></tr> : null}
              <tr><td>Created / updated</td><td>{dt(data.createdAt)} · {dt(data.updatedAt)}</td></tr>
              {data.captureRequestedAt ? <tr><td>Capture requested</td><td>{dt(data.captureRequestedAt)}</td></tr> : null}
              <tr><td>Refunded</td><td className="ltr">{sar(data.refundedAmount ?? 0)}</td></tr>
            </tbody>
          </table>
          {data.refunds?.length ? (
            <>
              <h3 style={{ marginTop: 16 }}>Refunds</h3>
              <ul>
                {data.refunds.map((r, i) => (
                  <li key={i}>
                    {dt(r.at)} · <span className="ltr">{sar(r.amount)}</span> · {r.reason || '—'} {r.by?.name ? `· by ${r.by.name}` : ''} {r.providerRefundId ? <span className="a-muted ltr">({r.providerRefundId})</span> : null}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          <h3 style={{ marginTop: 16 }}>Event history</h3>
          {data.events?.length ? (
            <ol className="a-muted" style={{ fontSize: 13 }}>
              {data.events.map((e, i) => (
                <li key={i}>
                  {dt(e.at)} — {e.type} via {e.source}: <strong>{label(e.status)}</strong>
                </li>
              ))}
            </ol>
          ) : (
            <p className="a-muted">No events.</p>
          )}
        </div>
      ) : null}
    </Modal>
  );
}
