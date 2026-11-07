import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ApiError, api, patch, post, qs, uuid } from '../../lib/api';
import { useApi } from '../../lib/hooks';
import type { Localized } from '../../lib/types';
import { useToast } from '../../state/toast';
import { invalidateAdminCache } from '../data';
import { useAT } from '../i18n';
import { AIcon } from '../icons';
import { EmptyState, ErrorBox, ErrorPanel, F, Modal, Skeleton, SkeletonTable, Status, usePerms } from '../kit';

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
  delivery?: { trackingNumber?: string };
};

const STATUSES = ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'returned'];
const PAYMENT_STATUSES = ['paid', 'pending', 'cod_pending', 'cod_collected', 'failed', 'expired', 'refunded', 'partially_refunded'];
/** Mirrors the server's ORDER_TRANSITIONS (the server enforces them; the UI only offers valid moves). */
const NEXT: Record<string, string[]> = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['processing', 'shipped', 'cancelled'],
  processing: ['shipped', 'cancelled'],
  shipped: ['delivered', 'returned'],
  delivered: ['returned'],
  cancelled: [],
  returned: [],
};
const itemCount = (o: { items: { quantity: number }[] }) => o.items.reduce((s, i) => s + i.quantity, 0);

const csvCell = (v: unknown) => {
  const s = v == null ? '' : String(v);
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s; // no spreadsheet formula injection
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
function downloadCsv(name: string, rows: (string | number)[][]) {
  const blob = new Blob([`﻿${rows.map((r) => r.map(csvCell).join(',')).join('\n')}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ═════════════════════════════ Orders list ═════════════════════════════ */
type Bulk = 'confirmed' | 'processing' | 'cancelled';

export function Orders() {
  const { t, sar, n, dt } = useAT();
  const perms = usePerms();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [rows, setRows] = useState<OrderRow[] | null>(null);
  const [meta, setMeta] = useState({ page: 1, pages: 1, total: 0 });
  const [error, setError] = useState<ApiError | null>(null);
  const [q, setQ] = useState(params.get('q') ?? '');
  const [nonce, setNonce] = useState(0);
  const [selected, setSelected] = useState<Map<string, OrderRow>>(new Map());
  const [bulk, setBulk] = useState<Bulk | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const canWrite = perms.has('orders:write');

  const filters = {
    status: params.get('status') ?? '',
    paymentStatus: params.get('paymentStatus') ?? '',
    from: params.get('from') ?? '',
    to: params.get('to') ?? '',
  };
  const query = qs({
    status: filters.status || undefined,
    paymentStatus: filters.paymentStatus || undefined,
    from: filters.from ? `${filters.from}T00:00:00+03:00` : undefined,
    to: filters.to ? `${filters.to}T23:59:59.999+03:00` : undefined,
    q: params.get('q') || undefined,
    page: params.get('page') ?? undefined,
    limit: 25,
  });

  useEffect(() => {
    let alive = true;
    setRows(null);
    setError(null);
    api<OrderRow[]>(`/api/admin/orders${query}`)
      .then((r) => {
        if (!alive) return;
        setRows(r.data);
        setMeta({ page: Number(r.meta?.page ?? 1), pages: Number(r.meta?.pages ?? 1), total: Number(r.meta?.total ?? 0) });
      })
      .catch((e) => alive && setError(e));
    return () => {
      alive = false;
    };
  }, [query, nonce]);

  const set = (k: string, v: string) => {
    const nxt = new URLSearchParams(params);
    if (v) nxt.set(k, v);
    else nxt.delete(k);
    if (k !== 'page') nxt.delete('page');
    setParams(nxt);
  };
  // Debounced search (spec §24): the URL — and the request — follow 350 ms after typing stops.
  useEffect(() => {
    const cur = params.get('q') ?? '';
    if (q.trim() === cur) return;
    const id = setTimeout(() => set('q', q.trim()), 350);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const hasFilters = Boolean(filters.status || filters.paymentStatus || filters.from || filters.to || params.get('q'));
  const pageIds = rows?.map((r) => r._id) ?? [];
  const allOnPage = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const toggle = (o: OrderRow) =>
    setSelected((s) => {
      const nxt = new Map(s);
      if (nxt.has(o._id)) nxt.delete(o._id);
      else nxt.set(o._id, o);
      return nxt;
    });
  const toggleAll = () =>
    setSelected((s) => {
      const nxt = new Map(s);
      if (allOnPage) pageIds.forEach((id) => nxt.delete(id));
      else rows?.forEach((r) => nxt.set(r._id, r));
      return nxt;
    });

  const exportSelected = () => {
    const list = [...selected.values()];
    downloadCsv(`celibery-orders-selected-${new Date().toISOString().slice(0, 10)}.csv`, [
      ['order_number', 'created_at', 'customer', 'phone', 'email', 'items', 'total_sar', 'payment_method', 'payment_status', 'status', 'tracking'],
      ...list.map((o) => [o.orderNumber, new Date(o.createdAt).toISOString(), o.contact.name, o.contact.phone, o.contact.email, itemCount(o), (o.total / 100).toFixed(2), o.paymentMethod, o.paymentStatus, o.status, o.delivery?.trackingNumber ?? '']),
    ]);
  };

  return (
    <div className="a-page">
      <div className="a-pagehead">
        <div>
          <h1>{t.ordersPage.title}</h1>
          <p className="a-muted">{t.ordersPage.count(meta.total)}</p>
        </div>
        <div className="a-pagehead__actions">
          {perms.has('reports:read') ? (
            <button type="button" className="a-btn a-btn--secondary" onClick={() => setExportOpen(true)}>
              <AIcon name="download" size={16} /> {t.ordersPage.exportAll}
            </button>
          ) : null}
        </div>
      </div>

      <div className="a-card a-card--flush">
        <div className="a-filterbar" role="search">
          <label className="a-filterbar__search">
            <span className="sr-only">{t.ordersPage.searchLabel}</span>
            <AIcon name="search" size={16} />
            <input className="a-input" type="search" placeholder={t.ordersPage.search} value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          <label>
            <span className="sr-only">{t.ordersPage.status}</span>
            <select className="a-select" value={filters.status} onChange={(e) => set('status', e.target.value)}>
              <option value="">{t.ordersPage.allStatuses}</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t.status[s]}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="sr-only">{t.ordersPage.payment}</span>
            <select className="a-select" value={filters.paymentStatus} onChange={(e) => set('paymentStatus', e.target.value)}>
              <option value="">{t.ordersPage.allPayments}</option>
              {PAYMENT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t.status[s]}
                </option>
              ))}
            </select>
          </label>
          <label className="a-field-inline">
            <span className="a-muted">{t.common.from}</span>
            <input className="a-input" type="date" aria-label={t.ordersPage.dateFrom} value={filters.from} max={filters.to || undefined} onChange={(e) => set('from', e.target.value)} />
          </label>
          <label className="a-field-inline">
            <span className="a-muted">{t.common.to}</span>
            <input className="a-input" type="date" aria-label={t.ordersPage.dateTo} value={filters.to} min={filters.from || undefined} onChange={(e) => set('to', e.target.value)} />
          </label>
          {hasFilters ? (
            <button
              type="button"
              className="a-btn a-btn--ghost a-btn--sm"
              onClick={() => {
                setQ('');
                setParams(new URLSearchParams());
              }}
            >
              {t.common.clear}
            </button>
          ) : null}
        </div>

        {selected.size ? (
          <div className="a-bulkbar" role="region" aria-label={t.common.selected(selected.size)}>
            <strong>{t.common.selected(selected.size)}</strong>
            <div className="a-bulkbar__actions">
              {canWrite ? (
                <>
                  <button type="button" className="a-btn a-btn--secondary a-btn--sm" onClick={() => setBulk('confirmed')}>
                    {t.ordersPage.bulkConfirm}
                  </button>
                  <button type="button" className="a-btn a-btn--secondary a-btn--sm" onClick={() => setBulk('processing')}>
                    {t.ordersPage.bulkProcessing}
                  </button>
                </>
              ) : null}
              <button type="button" className="a-btn a-btn--secondary a-btn--sm" onClick={exportSelected}>
                {t.ordersPage.bulkExport}
              </button>
              {canWrite ? (
                <button type="button" className="a-btn a-btn--danger-ghost a-btn--sm" onClick={() => setBulk('cancelled')}>
                  {t.ordersPage.bulkCancel}
                </button>
              ) : null}
              <button type="button" className="a-btn a-btn--ghost a-btn--sm" onClick={() => setSelected(new Map())}>
                {t.ordersPage.bulkClear}
              </button>
            </div>
          </div>
        ) : null}

        {error ? (
          <ErrorPanel message={error.message} onRetry={() => setNonce((x) => x + 1)} />
        ) : !rows ? (
          <SkeletonTable rows={8} cols={8} />
        ) : !rows.length ? (
          <EmptyState title={t.ordersPage.empty} text={t.ordersPage.emptyHint} />
        ) : (
          <div className="a-table-wrap">
            <table className="a-table a-table--orders">
              <thead>
                <tr>
                  <th className="a-col-check">
                    <input type="checkbox" checked={allOnPage} onChange={toggleAll} aria-label={t.ordersPage.selectAll} />
                  </th>
                  {t.ordersPage.head.map((h, i) => (
                    <th key={h} className={i === 3 || i === 4 ? 'num' : undefined}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((o) => (
                  <tr key={o._id} className={selected.has(o._id) ? 'is-selected' : undefined}>
                    <td className="a-col-check">
                      <input type="checkbox" checked={selected.has(o._id)} onChange={() => toggle(o)} aria-label={t.ordersPage.selectRow(o.orderNumber)} />
                    </td>
                    <td>
                      <Link to={`/admin/orders/${o._id}`} className="ltr a-strong">
                        {o.orderNumber}
                      </Link>
                      {o.needsReview ? (
                        <div>
                          <Status value="failed" label={t.ordersPage.review} />
                        </div>
                      ) : null}
                    </td>
                    <td>
                      {o.contact.name}
                      <div className="a-sub ltr">{o.contact.phone}</div>
                    </td>
                    <td>{t.common.website}</td>
                    <td className="num">{n(itemCount(o))}</td>
                    <td className="num">{sar(o.total)}</td>
                    <td>
                      <Status value={o.paymentStatus} />
                      <div className="a-sub">{t.methodShort[o.paymentMethod] ?? o.paymentMethod}</div>
                    </td>
                    <td>
                      <Status value={o.status} />
                    </td>
                    <td className="a-nowrap">{dt(o.createdAt)}</td>
                    <td>
                      <Link to={`/admin/orders/${o._id}`} className="a-btn a-btn--ghost a-btn--sm">
                        {t.common.view}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pager page={meta.page} pages={meta.pages} onPage={(pg) => set('page', String(pg))} />
      </div>

      {bulk ? (
        <BulkModal
          action={bulk}
          orders={[...selected.values()]}
          onClose={() => setBulk(null)}
          onDone={(okCount, failed) => {
            toast(t.ordersPage.bulkDone(okCount, failed), failed ? 'error' : undefined);
            setBulk(null);
            setSelected(new Map());
            invalidateAdminCache();
            setNonce((x) => x + 1);
          }}
        />
      ) : null}
      {exportOpen ? (
        <Modal title={t.ordersPage.exportTitle} onClose={() => setExportOpen(false)}>
          <div className="a-stack">
            <p>{t.ordersPage.exportText}</p>
            {!filters.from && !filters.to ? <p className="a-muted">{t.ordersPage.exportNeedsDates}</p> : null}
            <a className="a-btn a-btn--primary" href={`/api/admin/reports/orders.csv${qs({ from: filters.from || undefined, to: filters.to || undefined })}`} download onClick={() => setExportOpen(false)}>
              <AIcon name="download" size={16} /> {t.ordersPage.download}
            </a>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

function Pager({ page, pages, onPage }: { page: number; pages: number; onPage: (p: number) => void }) {
  const { t } = useAT();
  if (pages <= 1) return null;
  return (
    <nav className="a-pager" aria-label="Pagination">
      <button type="button" className="a-btn a-btn--secondary a-btn--sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        {t.common.previous}
      </button>
      <span className="a-muted">{t.common.pageOf(page, pages)}</span>
      <button type="button" className="a-btn a-btn--secondary a-btn--sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>
        {t.common.next}
      </button>
    </nav>
  );
}

/** Bulk status change through the existing per-order endpoint — the server re-checks every transition and payment rule. */
function BulkModal({ action, orders, onClose, onDone }: { action: Bulk; orders: OrderRow[]; onClose: () => void; onDone: (ok: number, failed: number) => void }) {
  const { t } = useAT();
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);
  const eligible = orders.filter((o) => NEXT[o.status]?.includes(action));
  const label = action === 'confirmed' ? t.ordersPage.bulkConfirm : action === 'processing' ? t.ordersPage.bulkProcessing : t.ordersPage.bulkCancel;
  const run = async () => {
    setBusy(true);
    let okCount = 0;
    let failed = 0;
    for (const o of eligible) {
      try {
        await post(`/api/admin/orders/${o._id}/status`, { status: action, note: '', notifyCustomer: notify, restock: true });
        okCount += 1;
      } catch {
        failed += 1;
      }
      setDone((d) => d + 1);
    }
    onDone(okCount, failed);
  };
  return (
    <Modal title={label} onClose={busy ? () => undefined : onClose}>
      <div className="a-stack">
        {eligible.length ? <p>{t.ordersPage.bulkEligible(eligible.length, orders.length)}</p> : <p className="a-alert a-alert--warning">{t.ordersPage.bulkNone}</p>}
        {action === 'cancelled' && eligible.length ? <p className="a-alert a-alert--warning">{t.ordersPage.bulkCancelWarn}</p> : null}
        {eligible.length ? (
          <label className="check">
            <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} disabled={busy} /> {t.ordersPage.bulkNotify}
          </label>
        ) : null}
        <div className="a-row">
          <button type="button" className={`a-btn ${action === 'cancelled' ? 'a-btn--danger' : 'a-btn--primary'}`} disabled={!eligible.length || busy} onClick={() => void run()}>
            {busy ? `${t.ordersPage.working} ${done}/${eligible.length}` : label}
          </button>
          <button type="button" className="a-btn a-btn--ghost" onClick={onClose} disabled={busy}>
            {t.common.cancel}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* ═════════════════════════════ Order detail ═════════════════════════════ */
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
    items: { sku: string; name: Localized; quantity: number; unitPrice: number; lineTotal: number; discount: number; image: string; warrantyMonths: number; model?: string }[];
    subtotal: number;
    discountTotal: number;
    discount?: { code?: string };
    deliveryFee: number;
    /** Delivery zone that priced delivery ('' = store-wide rules). */
    shippingZone?: string;
    codFee: number;
    total: number;
    vatAmount: number;
    refundedAmount: number;
    /** Refunds sent to the gateway whose outcome is not confirmed yet. */
    refundReservedAmount?: number;
    delivery: { courier: string; trackingNumber: string; trackingUrl: string; shippedAt?: string; deliveredAt?: string; estimatedDelivery?: Localized };
    customerNote: string;
    internalNotes: string;
    reservationExpiresAt?: string;
    history: { status: string; note: string; at: string; by?: { name: string } | null; visibleToCustomer: boolean }[];
  };
  payments: { _id: string; provider: string; method: string; amount: number; status: string; providerRef?: string; failureReason?: string; refundedAmount: number; createdAt: string }[];
  notifications: { _id: string; channel: string; template: string; to: string; status: string; detail: string; createdAt: string }[];
};

function Section({ title, actions, children, id }: { title: string; actions?: ReactNode; children: ReactNode; id: string }) {
  return (
    <section className="a-card" aria-labelledby={id}>
      <div className="a-card__head">
        <h2 id={id}>{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function OrderDetail({ perms }: { perms: Set<string> }) {
  const { id } = useParams();
  const { t, lang, sar, n, dt } = useAT();
  const toast = useToast();
  const { data, error, loading, reload } = useApi<Detail>(`/api/admin/orders/${id}`);
  const [action, setAction] = useState<string | null>(null);
  const [form, setForm] = useState({ note: '', trackingNumber: '', courier: '', notifyCustomer: true, restock: true, amount: '', reason: '' });
  const [err, setErr] = useState<unknown>(null);
  const [notes, setNotes] = useState<string | null>(null);
  const [tracking, setTracking] = useState<{ trackingNumber: string; courier: string; trackingUrl: string } | null>(null);
  // One idempotency key per refund dialog: a double click or a retry after a timeout returns the same refund.
  const [refundKey, setRefundKey] = useState('');
  const [refundBusy, setRefundBusy] = useState(false);
  const [ledgerKey, setLedgerKey] = useState(0);
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    if (!printing) return;
    const done = () => setPrinting(false);
    window.addEventListener('afterprint', done);
    const id = setTimeout(() => window.print(), 50);
    return () => {
      clearTimeout(id);
      window.removeEventListener('afterprint', done);
    };
  }, [printing]);

  const title = useMemo(() => (data ? (lang === 'ar' ? `الطلب ${data.order.orderNumber}` : `Order ${data.order.orderNumber}`) : ''), [data, lang]);

  if (error) return <ErrorPanel message={error.message} onRetry={reload} />;
  if (loading || !data)
    return (
      <div className="a-page" aria-busy="true">
        <Skeleton w={240} h={28} />
        <div className="a-grid a-grid--detail">
          <div className="a-stack">
            {[0, 1, 2].map((i) => (
              <section key={i} className="a-card">
                <Skeleton w="30%" h={16} />
                <SkeletonTable rows={3} cols={4} />
              </section>
            ))}
          </div>
          <div className="a-stack">
            {[0, 1].map((i) => (
              <section key={i} className="a-card">
                <Skeleton w="40%" h={16} />
                <SkeletonTable rows={3} cols={2} />
              </section>
            ))}
          </div>
        </div>
      </div>
    );

  const o = data.order;
  const canWrite = perms.has('orders:write');
  const isCod = o.paymentMethod === 'cod';
  const st = (s: string) => t.status[s] ?? s;
  const refreshAll = () => {
    invalidateAdminCache();
    reload();
  };

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
      toast(t.order.statusDone(o.orderNumber, st(action ?? '')));
      setAction(null);
      refreshAll();
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
      refreshAll();
    } catch (ex) {
      setErr(ex);
    } finally {
      setRefundBusy(false);
    }
  };
  const saveTracking = async (e: FormEvent) => {
    e.preventDefault();
    if (!tracking) return;
    setErr(null);
    try {
      await post(`/api/admin/orders/${o._id}/tracking`, { trackingNumber: tracking.trackingNumber, courier: tracking.courier || undefined, trackingUrl: tracking.trackingUrl });
      toast(t.order.trackingSaved);
      setTracking(null);
      refreshAll();
    } catch (ex) {
      setErr(ex);
    }
  };

  const review = o.history.filter((h) => h.status === 'payment_review');
  const returned = o.history.filter((h) => h.status === 'returned').at(-1);
  const addr = o.shippingAddress;

  return (
    <div className="a-page">
      <div className="a-pagehead">
        <div>
          <nav className="a-crumbs" aria-label="Breadcrumb">
            <Link to="/admin/orders">{t.order.back}</Link>
            <span aria-hidden="true">/</span>
            <span className="ltr">{o.orderNumber}</span>
          </nav>
          <h1>{title}</h1>
          <div className="a-row a-row--tight">
            <Status value={o.status} />
            <Status value={o.paymentStatus} />
            <span className="a-muted">{dt(o.createdAt)}</span>
          </div>
        </div>
        <div className="a-pagehead__actions">
          {canWrite
            ? NEXT[o.status].map((s) => (
                <button
                  key={s}
                  type="button"
                  className={`a-btn ${s === 'cancelled' ? 'a-btn--danger-ghost' : s === 'returned' ? 'a-btn--secondary' : 'a-btn--primary'}`}
                  onClick={() => (setErr(null), setAction(s))}
                  data-testid={`to-${s}`}
                >
                  {t.order.markAs(st(s))}
                </button>
              ))
            : null}
          {canWrite && !isCod && ['pending', 'failed'].includes(o.paymentStatus) ? (
            <button
              type="button"
              className="a-btn a-btn--secondary"
              onClick={async () => {
                const r = await post<{ paymentStatus: string }>(`/api/admin/orders/${o._id}/verify-payment`);
                toast(t.order.gatewayStatus(st(r.paymentStatus)));
                refreshAll();
              }}
            >
              {t.order.checkGateway}
            </button>
          ) : null}
          <button type="button" className="a-btn a-btn--secondary" onClick={() => setPrinting(true)}>
            <AIcon name="printer" size={16} /> {t.order.printSlip}
          </button>
        </div>
      </div>

      {review.length ? (
        <div className="a-alert a-alert--danger" role="alert">
          <AIcon name="alert" size={18} />
          <div>
            <strong>{t.order.review}</strong>
            {review.map((r, i) => (
              <span key={i}>{r.note}</span>
            ))}
          </div>
        </div>
      ) : null}

      <div className="a-grid a-grid--detail">
        <div className="a-stack">
          <Section id="od-summary" title={t.order.summary}>
            <dl className="a-kv a-kv--grid">
              <dt>{t.order.orderId}</dt>
              <dd className="ltr">{o.orderNumber}</dd>
              <dt>{t.order.date}</dt>
              <dd>{dt(o.createdAt)}</dd>
              <dt>{t.order.channel}</dt>
              <dd>{t.common.website}</dd>
              <dt>{t.order.status}</dt>
              <dd>
                <Status value={o.status} />
              </dd>
              <dt>{t.order.paymentMethod}</dt>
              <dd>{t.method[o.paymentMethod] ?? o.paymentMethod}</dd>
              <dt>{t.order.paymentStatus}</dt>
              <dd>
                <Status value={o.paymentStatus} />
              </dd>
              <dt>{t.order.total}</dt>
              <dd className="a-strong">{sar(o.total)}</dd>
              <dt>{t.order.discount}</dt>
              <dd>{o.discountTotal ? `−${sar(o.discountTotal)}` : '—'}</dd>
              {isCod ? (
                <>
                  <dt>{t.order.codAmount}</dt>
                  <dd className="a-strong">{sar(o.total)}</dd>
                </>
              ) : null}
              {o.reservationExpiresAt && o.status === 'pending' ? (
                <>
                  <dt>{t.order.stockHeld}</dt>
                  <dd>{dt(o.reservationExpiresAt)}</dd>
                </>
              ) : null}
            </dl>
          </Section>

          <Section id="od-items" title={t.order.items}>
            <div className="a-table-wrap">
              <table className="a-table">
                <thead>
                  <tr>
                    {t.order.itemsHead.map((h, i) => (
                      <th key={h} className={i >= 2 ? 'num' : undefined}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {o.items.map((i) => (
                    <tr key={i.sku}>
                      <td>
                        <div className="a-item">
                          {i.image ? <img src={i.image} alt="" width={40} height={40} loading="lazy" decoding="async" /> : <span className="a-item__ph" aria-hidden="true" />}
                          <span>{lang === 'ar' ? i.name.ar || i.name.en : i.name.en || i.name.ar}</span>
                        </div>
                      </td>
                      <td className="ltr">{i.sku}</td>
                      <td className="num">{n(i.quantity)}</td>
                      <td className="num">{sar(i.unitPrice)}</td>
                      <td className="num">{i.discount ? `−${sar(i.discount)}` : '—'}</td>
                      <td className="num">{sar(i.lineTotal - i.discount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <dl className="a-totals">
              <dt>{t.order.subtotal}</dt>
              <dd>{sar(o.subtotal)}</dd>
              <dt>
                {t.order.discount} {o.discount?.code ? <span className="ltr">({o.discount.code})</span> : null}
              </dt>
              <dd>{o.discountTotal ? `−${sar(o.discountTotal)}` : '—'}</dd>
              <dt>{t.order.delivery}</dt>
              <dd>
                {o.deliveryFee ? sar(o.deliveryFee) : t.common.free}
                {o.shippingZone ? <span className="a-sub ltr"> · {o.shippingZone}</span> : null}
              </dd>
              {o.codFee ? (
                <>
                  <dt>{t.order.codFee}</dt>
                  <dd>{sar(o.codFee)}</dd>
                </>
              ) : null}
              <dt className="a-totals__grand">{t.order.total}</dt>
              <dd className="a-totals__grand">{sar(o.total)}</dd>
              <dt>{t.order.vat}</dt>
              <dd>{sar(o.vatAmount)}</dd>
              {o.refundedAmount ? (
                <>
                  <dt>{t.order.refunded}</dt>
                  <dd>{sar(o.refundedAmount)}</dd>
                </>
              ) : null}
            </dl>
          </Section>

          <Section
            id="od-payment"
            title={t.order.payment}
            actions={
              perms.has('orders:refund') && ['paid', 'partially_refunded', 'cod_collected'].includes(o.paymentStatus) ? (
                <button type="button" className="a-btn a-btn--secondary a-btn--sm" onClick={() => (setRefundKey(`rf_${uuid()}`), setErr(null), setAction('refund'))}>
                  {t.order.refund}
                </button>
              ) : null
            }
          >
            {isCod ? <p className="a-note">{t.order.codNote}</p> : null}
            {data.payments.length ? (
              <div className="a-table-wrap">
                <table className="a-table">
                  <thead>
                    <tr>
                      {t.order.paymentsHead.map((h, i) => (
                        <th key={h} className={i === 3 ? 'num' : undefined}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.payments.map((p) => (
                      <tr key={p._id}>
                        <td className="a-nowrap">{dt(p.createdAt)}</td>
                        <td>{p.provider}</td>
                        <td>{t.methodShort[p.method] ?? p.method}</td>
                        <td className="num">
                          {sar(p.amount)}
                          {p.refundedAmount ? <div className="a-sub">−{sar(p.refundedAmount)}</div> : null}
                        </td>
                        <td>
                          <Status value={p.status} />
                          {p.failureReason ? <div className="a-sub">{p.failureReason}</div> : null}
                        </td>
                        <td className="ltr a-break">{p.providerRef ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : !isCod ? (
              <p className="a-muted">{t.order.noPayments}</p>
            ) : null}
            <div dir="ltr" lang="en">
              <RefundLedger orderId={o._id} canRefund={perms.has('orders:refund')} refreshKey={ledgerKey} onChanged={refreshAll} />
            </div>
          </Section>

          <Section
            id="od-delivery"
            title={t.order.deliverySection}
            actions={
              canWrite && ['confirmed', 'processing', 'shipped', 'delivered'].includes(o.status) ? (
                <button
                  type="button"
                  className="a-btn a-btn--secondary a-btn--sm"
                  onClick={() => (setErr(null), setTracking({ trackingNumber: o.delivery.trackingNumber, courier: o.delivery.courier, trackingUrl: o.delivery.trackingUrl }))}
                >
                  {t.order.editTracking}
                </button>
              ) : null
            }
          >
            <dl className="a-kv a-kv--grid">
              <dt>{t.order.partner}</dt>
              <dd>{o.delivery.courier || 'iMile'}</dd>
              <dt>{t.order.tracking}</dt>
              <dd className="ltr">
                {o.delivery.trackingNumber || '—'}
                {o.delivery.trackingUrl ? (
                  <>
                    {' '}
                    <a href={o.delivery.trackingUrl} target="_blank" rel="noreferrer" className="a-link">
                      {t.order.trackLink} ↗
                    </a>
                  </>
                ) : null}
              </dd>
              <dt>{t.order.shipmentStatus}</dt>
              <dd>{['shipped', 'delivered', 'returned'].includes(o.status) ? <Status value={o.status} /> : '—'}</dd>
              <dt>{t.order.shippedAt}</dt>
              <dd>{dt(o.delivery.shippedAt)}</dd>
              <dt>{t.order.deliveredAt}</dt>
              <dd>{dt(o.delivery.deliveredAt)}</dd>
              <dt>{t.order.estimated}</dt>
              <dd>{(lang === 'ar' ? o.delivery.estimatedDelivery?.ar : o.delivery.estimatedDelivery?.en) || '—'}</dd>
              <dt>{t.order.attempts}</dt>
              <dd className="a-muted">{t.common.notTracked}</dd>
              <dt>{t.order.pod}</dt>
              <dd className="a-muted">{t.common.notTracked}</dd>
            </dl>
            <p className="a-footnote">{t.order.manualNote}</p>
          </Section>

          <Section id="od-timeline" title={t.order.timeline}>
            <ol className="a-timeline">
              {[...o.history].reverse().map((h, i) => (
                <li key={i}>
                  <span className="a-timeline__dot" aria-hidden="true" />
                  <div>
                    <div className="a-row a-row--tight">
                      <strong>{st(h.status)}</strong>
                      {!h.visibleToCustomer ? <span className="a-chip">{t.order.internal}</span> : null}
                    </div>
                    <div className="a-sub">
                      {dt(h.at)} · {h.by?.name || t.order.system}
                    </div>
                    {h.note ? <div className="a-timeline__note">{h.note}</div> : null}
                  </div>
                </li>
              ))}
            </ol>
          </Section>
        </div>

        <div className="a-stack">
          <Section id="od-customer" title={t.order.customer}>
            <dl className="a-kv">
              <dt>{t.order.name}</dt>
              <dd>{o.contact.name}</dd>
              <dt>{t.order.email}</dt>
              <dd className="ltr">
                <a href={`mailto:${o.contact.email}`} className="a-link">
                  {o.contact.email}
                </a>
              </dd>
              <dt>{t.order.phone}</dt>
              <dd className="ltr">
                <a href={`tel:${o.contact.phone}`} className="a-link">
                  {o.contact.phone}
                </a>
              </dd>
              <dt>{t.order.city}</dt>
              <dd>{addr.city || '—'}</dd>
              <dt>{t.order.language}</dt>
              <dd>{o.lang === 'en' ? 'English' : 'العربية'}</dd>
            </dl>
            <div className="a-cardfoot">
              {o.customer ? (
                <Link to={`/admin/customers/${o.customer._id}`} className="a-link">
                  {t.order.account} →
                </Link>
              ) : (
                <span className="a-chip">{t.order.guest}</span>
              )}
            </div>
          </Section>

          <Section id="od-address" title={t.order.address}>
            <address className="a-address">
              {addr.fullName} · <span className="ltr">{addr.phone}</span>
              <br />
              {addr.street} {addr.buildingNumber}
              <br />
              {addr.district}, {addr.city} {addr.postalCode}
              {addr.shortAddress ? (
                <>
                  <br />
                  {t.order.shortAddress}: <span className="ltr">{addr.shortAddress}</span>
                </>
              ) : null}
              {addr.notes ? (
                <>
                  <br />
                  <em>{addr.notes}</em>
                </>
              ) : null}
            </address>
            {o.customerNote ? (
              <p className="a-note">
                {t.order.customerNote}: {o.customerNote}
              </p>
            ) : null}
          </Section>

          <Section id="od-notes" title={t.order.notes}>
            <label className="sr-only" htmlFor="od-notes-input">
              {t.order.notes}
            </label>
            <textarea id="od-notes-input" className="a-textarea" value={notes ?? o.internalNotes} onChange={(e) => setNotes(e.target.value)} disabled={!canWrite} rows={4} />
            {canWrite && notes !== null ? (
              <button
                type="button"
                className="a-btn a-btn--secondary a-btn--sm"
                onClick={async () => {
                  await patch(`/api/admin/orders/${o._id}/notes`, { internalNotes: notes });
                  toast(t.order.notesSaved);
                  setNotes(null);
                  reload();
                }}
              >
                {t.order.saveNotes}
              </button>
            ) : null}
          </Section>

          <Section
            id="od-notify"
            title={t.order.notifications}
            actions={
              canWrite ? (
                <button
                  type="button"
                  className="a-btn a-btn--ghost a-btn--sm"
                  onClick={async () => {
                    await post(`/api/admin/orders/${o._id}/resend-notification`);
                    toast(t.order.resent);
                    reload();
                  }}
                >
                  {t.order.resend}
                </button>
              ) : null
            }
          >
            {data.notifications.length ? (
              <ul className="a-list">
                {data.notifications.map((nt) => (
                  <li key={nt._id}>
                    <span>
                      <span className="ltr">
                        {nt.channel} · {nt.template}
                      </span>
                      <span className="a-sub">{dt(nt.createdAt)}</span>
                    </span>
                    <span title={nt.detail}>
                      <Status value={nt.status} />
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="a-muted">{t.order.noNotifications}</p>
            )}
            <p className="a-footnote">{t.order.skippedNote}</p>
          </Section>

          <Section id="od-return" title={t.order.relatedReturn}>
            {returned ? (
              <p>
                <Status value="returned" /> <span className="a-muted">{t.order.returnedOn(dt(returned.at))}</span>
                {returned.note ? <span className="a-timeline__note">{returned.note}</span> : null}
              </p>
            ) : (
              <p className="a-muted">{t.order.noReturn}</p>
            )}
          </Section>
        </div>
      </div>

      {action && action !== 'refund' ? (
        <Modal title={t.order.modalTitle(st(action))} onClose={() => setAction(null)}>
          <form className="a-stack" onSubmit={doStatus}>
            <ErrorBox error={err} />
            {action === 'shipped' ? (
              <>
                <F label={t.order.tracking}>
                  <input className="a-input" value={form.trackingNumber} onChange={(e) => setForm({ ...form, trackingNumber: e.target.value })} data-testid="tracking-input" />
                </F>
                <F label={t.order.courier} hint={t.order.courierHint}>
                  <input className="a-input" value={form.courier} onChange={(e) => setForm({ ...form, courier: e.target.value })} />
                </F>
              </>
            ) : null}
            {action === 'returned' ? (
              <label className="check">
                <input type="checkbox" checked={form.restock} onChange={(e) => setForm({ ...form, restock: e.target.checked })} /> {t.order.restock}
              </label>
            ) : null}
            {action === 'cancelled' && ['paid', 'cod_collected'].includes(o.paymentStatus) ? <p className="a-alert a-alert--warning">{t.order.paidCancelWarn}</p> : null}
            <F label={t.order.noteLabel}>
              <input className="a-input" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
            </F>
            <label className="check">
              <input type="checkbox" checked={form.notifyCustomer} onChange={(e) => setForm({ ...form, notifyCustomer: e.target.checked })} /> {t.order.notify}
            </label>
            <div className="a-row">
              <button className={`a-btn ${action === 'cancelled' ? 'a-btn--danger' : 'a-btn--primary'}`} data-testid="confirm-status">
                {t.common.confirm}
              </button>
              <button type="button" className="a-btn a-btn--ghost" onClick={() => setAction(null)}>
                {t.common.cancel}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}
      {action === 'refund' ? (
        <Modal title="Refund" onClose={() => setAction(null)}>
          <form className="a-stack" onSubmit={doRefund} dir="ltr" lang="en">
            <ErrorBox error={err} />
            <p className="a-muted">
              Refundable: {sar(o.total - (o.refundedAmount ?? 0) - (o.refundReservedAmount ?? 0))}
              {o.refundReservedAmount ? ` (${sar(o.refundReservedAmount)} is held by refunds awaiting gateway confirmation)` : ''}. Online payments are refunded through the gateway; COD refunds are recorded only.
            </p>
            <F label="Amount (SAR)">
              <input className="a-input" inputMode="decimal" required value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            </F>
            <F label="Reason">
              <input className="a-input" required value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
            </F>
            <button className="a-btn a-btn--primary" disabled={refundBusy}>
              {refundBusy ? 'Refunding…' : 'Refund'}
            </button>
          </form>
        </Modal>
      ) : null}
      {tracking ? (
        <Modal title={t.order.editTracking} onClose={() => setTracking(null)}>
          <form className="a-stack" onSubmit={saveTracking}>
            <ErrorBox error={err} />
            <F label={t.order.tracking}>
              <input className="a-input ltr" required value={tracking.trackingNumber} onChange={(e) => setTracking({ ...tracking, trackingNumber: e.target.value })} />
            </F>
            <F label={t.order.courier} hint={t.order.courierHint}>
              <input className="a-input" value={tracking.courier} onChange={(e) => setTracking({ ...tracking, courier: e.target.value })} />
            </F>
            <F label={t.order.trackLink}>
              <input className="a-input ltr" type="url" placeholder="https://" value={tracking.trackingUrl} onChange={(e) => setTracking({ ...tracking, trackingUrl: e.target.value })} />
            </F>
            <div className="a-row">
              <button className="a-btn a-btn--primary">{t.common.confirm}</button>
              <button type="button" className="a-btn a-btn--ghost" onClick={() => setTracking(null)}>
                {t.common.cancel}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}

      {printing ? <PackingSlip order={o} /> : null}
    </div>
  );
}

/** Printable packing slip from the order record (no prices — for the warehouse and the parcel). */
function PackingSlip({ order: o }: { order: Detail['order'] }) {
  const { t, lang, n, dt } = useAT();
  const a = o.shippingAddress;
  return (
    <div className="a-print" aria-hidden="true">
      <h1>
        CELIBERY International — {t.order.printSlip}
      </h1>
      <p>
        <strong className="ltr">{o.orderNumber}</strong> · {dt(o.createdAt)} · {t.method[o.paymentMethod] ?? o.paymentMethod}
        {o.paymentMethod === 'cod' ? ` · ${t.order.codAmount}: ${(o.total / 100).toFixed(2)} SAR` : ''}
      </p>
      <p>
        {a.fullName} · {a.phone}
        <br />
        {a.street} {a.buildingNumber}, {a.district}, {a.city} {a.postalCode}
        {a.shortAddress ? ` · ${a.shortAddress}` : ''}
      </p>
      <table>
        <thead>
          <tr>
            <th>{t.order.itemsHead[1]}</th>
            <th>{t.order.itemsHead[0]}</th>
            <th>{t.order.itemsHead[2]}</th>
          </tr>
        </thead>
        <tbody>
          {o.items.map((i) => (
            <tr key={i.sku}>
              <td>{i.sku}</td>
              <td>{lang === 'ar' ? i.name.ar || i.name.en : i.name.en || i.name.ar}</td>
              <td>{n(i.quantity)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {o.customerNote ? (
        <p>
          {t.order.customerNote}: {o.customerNote}
        </p>
      ) : null}
    </div>
  );
}

/* ───────────── Refund ledger (unchanged behaviour) ───────────── */
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
  const { sar, dt } = useAT();
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
    <div className="a-refunds">
      <div className="a-card__head">
        <strong>Refunds</strong>
        {open && canRefund ? (
          <button
            type="button"
            className="a-btn a-btn--secondary a-btn--sm"
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
        <p className="a-alert a-alert--warning">
          A refund is awaiting gateway confirmation. Its amount stays reserved so it cannot be refunded twice. Do not refund it again from the gateway dashboard — use “Check with gateway”, or resolve it after checking the dashboard.
        </p>
      ) : null}
      <ul className="a-list">
        {rows.map((r) => (
          <li key={r._id} className="a-list__block">
            <div className="a-card__head">
              <span>
                <strong>{sar(r.amount)}</strong> · {r.reason || '—'} {r.legacy ? <span className="a-muted">(recorded before the ledger)</span> : null}
              </span>
              <Status value={r.status === 'succeeded' ? 'refunded' : r.status === 'failed' ? 'failed' : 'pending'} label={REFUND_LABEL[r.status] ?? r.status} />
            </div>
            <span className="a-sub">
              {dt(r.createdAt)} · {r.provider}
              {r.requestedBy?.name ? ` · by ${r.requestedBy.name}` : ''}
              {r.providerRefundId ? ` · gateway ref ${r.providerRefundId}` : ''}
            </span>
            {r.lastError && r.status !== 'succeeded' ? <span className="a-sub">{r.lastError}</span> : null}
            {canRefund && (r.status === 'reconciliation_required' || r.status === 'processing') ? (
              <div className="a-row">
                <button type="button" className="a-btn a-btn--ghost a-btn--sm" onClick={() => setResolve({ id: r._id, outcome: 'succeeded', note: '' })}>
                  Gateway shows it refunded…
                </button>
                <button type="button" className="a-btn a-btn--danger-ghost a-btn--sm" onClick={() => setResolve({ id: r._id, outcome: 'failed', note: '' })}>
                  Gateway shows no refund…
                </button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      {resolve ? (
        <Modal title={resolve.outcome === 'succeeded' ? 'Confirm the refund happened' : 'Confirm the refund did NOT happen'} onClose={() => setResolve(null)}>
          <div className="a-stack">
            <p className="a-muted">
              {resolve.outcome === 'succeeded'
                ? 'Only confirm after seeing this refund in the gateway dashboard. The amount will be counted as refunded.'
                : 'Only confirm after checking the gateway dashboard shows no such refund. The reserved amount is released and can be refunded again.'}
            </p>
            <F label="What did you check? (kept in the activity log)">
              <input className="a-input" value={resolve.note} onChange={(e) => setResolve({ ...resolve, note: e.target.value })} />
            </F>
            <button
              type="button"
              className="a-btn a-btn--primary"
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
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
