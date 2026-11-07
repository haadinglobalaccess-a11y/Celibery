import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, api, get, patch, post, qs } from '../../lib/api';
import { useToast } from '../../state/toast';
import { useAT } from '../i18n';
import { EmptyState, ErrorBox, ErrorPanel, Modal, SkeletonTable, Status, usePerms } from '../kit';

type Item = { product: string; sku: string; name: { ar: string; en: string }; image?: string; quantity: number; amount: number };
type ReturnRow = {
  _id: string;
  returnNumber: string;
  order: string;
  orderNumber: string;
  contact: { name: string; email: string; phone: string };
  items: Item[];
  reason: string;
  details: string;
  status: string;
  requestedAmount: number;
  restocked: boolean;
  refund?: { amount?: number; status?: string; at?: string } | null;
  decisionNote?: string;
  internalNotes?: string;
  history: { status: string; note?: string; at: string; byCustomer?: boolean; by?: { name?: string } | null }[];
  createdAt: string;
};

const STATUSES = ['requested', 'approved', 'received', 'refunded', 'rejected', 'cancelled'] as const;

/**
 * Returns (spec §16): customer return requests — Requested → Approved → Received → Refunded
 * (or Rejected / Cancelled). Refunds go through the refund ledger and the payment gateway.
 */
export function Returns() {
  const { t, sar, n, dt } = useAT();
  const perms = usePerms();
  const canRefund = perms.has('orders:refund');
  const toast = useToast();
  const [status, setStatus] = useState<string>('');
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<ReturnRow[] | null>(null);
  const [pages, setPages] = useState(1);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [error, setError] = useState<ApiError | null>(null);
  const [nonce, setNonce] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    let alive = true;
    setRows(null);
    setError(null);
    api<ReturnRow[]>(`/api/admin/returns${qs({ status: status || undefined, q: search || undefined, page, limit: 25 })}`)
      .then((r) => {
        if (!alive) return;
        setRows(r.data);
        setPages(Number(r.meta?.pages ?? 1));
        setCounts((r.meta?.counts as Record<string, number>) ?? {});
      })
      .catch((e) => alive && setError(e));
    return () => {
      alive = false;
    };
  }, [status, search, page, nonce]);

  const reconcile = async () => {
    setChecking(true);
    try {
      const r = await post<{ payments: number; reconciled: number; errors: number }>('/api/admin/orders/refunds/reconcile-all');
      toast(t.returnsPage.reconcileDone(r.payments, r.errors), r.errors ? 'error' : 'success');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="a-page">
      <div className="a-pagehead">
        <div>
          <h1>{t.returnsPage.title}</h1>
          <p className="a-muted">{t.returnsPage.lead}</p>
        </div>
        {canRefund ? (
          <button className="btn btn--outline btn--sm" disabled={checking} onClick={() => void reconcile()} title={t.returnsPage.reconcileHint}>
            {checking ? '…' : t.returnsPage.reconcile}
          </button>
        ) : null}
      </div>
      <div className="a-toolbar" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 12 }}>
        <div className="tabs" role="tablist">
          {['', ...STATUSES].map((s) => (
            <button key={s || 'all'} role="tab" type="button" aria-selected={status === s} onClick={() => (setStatus(s), setPage(1))}>
              {s ? t.returnsPage.statuses[s] : t.returnsPage.all}
              {s && counts[s] ? ` (${n(counts[s])})` : ''}
            </button>
          ))}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setSearch(q.trim());
            setPage(1);
          }}
        >
          <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.returnsPage.search} aria-label={t.returnsPage.search} />
        </form>
      </div>
      <div className="a-card a-card--flush">
        {error ? (
          <ErrorPanel message={error.message} onRetry={() => setNonce((x) => x + 1)} />
        ) : !rows ? (
          <SkeletonTable rows={5} cols={7} />
        ) : !rows.length ? (
          <EmptyState title={t.returnsPage.empty} text={t.returnsPage.emptyHint} />
        ) : (
          <div className="a-table-wrap">
            <table className="a-table">
              <thead>
                <tr>
                  {t.returnsPage.head.map((h, i) => (
                    <th key={h} className={i === 3 || i === 4 ? 'num' : undefined}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r._id} data-testid="return-row">
                    <td>
                      <button type="button" className="link-btn ltr a-strong" onClick={() => setOpen(r._id)}>
                        {r.returnNumber}
                      </button>
                    </td>
                    <td>
                      <Link to={`/admin/orders/${r.order}`} className="ltr">
                        {r.orderNumber}
                      </Link>
                    </td>
                    <td>
                      {r.contact.name}
                      <div className="a-sub ltr">{r.contact.phone}</div>
                    </td>
                    <td className="num">{n(r.items.reduce((s, i) => s + i.quantity, 0))}</td>
                    <td className="num">{sar(r.refund?.amount ?? r.requestedAmount)}</td>
                    <td>
                      <Status value={r.status} label={t.returnsPage.statuses[r.status]} />
                    </td>
                    <td className="a-nowrap">{dt(r.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {pages > 1 ? (
          <nav className="a-pager" aria-label="Pagination">
            <button type="button" className="a-btn a-btn--secondary a-btn--sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              {t.common.previous}
            </button>
            <span className="a-muted">{t.common.pageOf(page, pages)}</span>
            <button type="button" className="a-btn a-btn--secondary a-btn--sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>
              {t.common.next}
            </button>
          </nav>
        ) : null}
      </div>
      {open ? <ReturnDetail id={open} onClose={() => setOpen(null)} onChanged={() => setNonce((x) => x + 1)} /> : null}
    </div>
  );
}

function ReturnDetail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { t, lang, sar, dt } = useAT();
  const perms = usePerms();
  const canWrite = perms.has('orders:write');
  const canRefund = perms.has('orders:refund');
  const toast = useToast();
  const [r, setR] = useState<ReturnRow | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [restock, setRestock] = useState(true);
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');

  const load = () =>
    get<ReturnRow>(`/api/admin/returns/${id}`)
      .then((x) => {
        setR(x);
        setNotes(x.internalNotes ?? '');
        setAmount(((x.refund?.amount ?? x.requestedAmount) / 100).toFixed(2));
      })
      .catch(setErr);
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const act = async (path: string, body: Record<string, unknown>, after?: (res: unknown) => void) => {
    setErr(null);
    setBusy(true);
    try {
      const res = await post(`/api/admin/returns/${id}/${path}`, body);
      after?.(res);
      setNote('');
      await load();
      onChanged();
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={r ? `${r.returnNumber} · ${r.orderNumber}` : '…'} onClose={onClose} wide>
      <ErrorBox error={err} />
      {!r ? null : (
        <div className="a-grid-2" data-testid="return-detail">
          <div>
            <p>
              <Status value={r.status} label={t.returnsPage.statuses[r.status]} /> · {r.contact.name} · <span className="ltr">{r.contact.email}</span>
            </p>
            <h3>{t.returnsPage.items}</h3>
            <ul>
              {r.items.map((it) => (
                <li key={it.sku}>
                  {it.quantity} × {lang === 'ar' ? it.name.ar || it.name.en : it.name.en || it.name.ar} <span className="ltr a-muted">({it.sku})</span> — {sar(it.amount)}
                </li>
              ))}
            </ul>
            <p>
              <strong>{t.returnsPage.amount}:</strong> {sar(r.requestedAmount)}
            </p>
            <p>
              <strong>{t.returnsPage.reason}:</strong> {t.returnsPage.reasons[r.reason] ?? r.reason}
            </p>
            {r.details ? (
              <p>
                <strong>{t.returnsPage.details}:</strong> {r.details}
              </p>
            ) : null}
            {r.refund?.amount != null ? (
              <p>
                <strong>{t.returnsPage.refund}:</strong> {sar(r.refund.amount)} · {r.refund.status}
              </p>
            ) : null}
            {r.status === 'received' && r.refund?.status && r.refund.status !== 'succeeded' ? <p className="alert alert--warning">{t.returnsPage.refundPending}</p> : null}
            <h3>{t.returnsPage.history}</h3>
            <ol className="a-muted" style={{ fontSize: 13 }}>
              {r.history.map((h, i) => (
                <li key={i}>
                  {t.returnsPage.statuses[h.status] ?? h.status} · {dt(h.at)}
                  {h.by?.name ? ` · ${h.by.name}` : h.byCustomer ? ' · customer' : ''}
                  {h.note ? ` — ${h.note}` : ''}
                </li>
              ))}
            </ol>
          </div>
          <div>
            {canWrite && r.status === 'requested' ? (
              <>
                <label className="field">
                  <span className="label">{t.returnsPage.note} / {t.returnsPage.rejectNote}</span>
                  <textarea className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
                </label>
                <div className="actions" style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn--primary btn--sm" disabled={busy} onClick={() => void act('approve', { note }, () => toast(t.returnsPage.done))}>
                    {t.returnsPage.approve}
                  </button>
                  <button className="btn btn--ghost btn--sm danger" disabled={busy || note.trim().length < 3} onClick={() => void act('reject', { note }, () => toast(t.returnsPage.done))}>
                    {t.returnsPage.reject}
                  </button>
                </div>
              </>
            ) : null}
            {canWrite && r.status === 'approved' ? (
              <>
                <label className="check">
                  <input type="checkbox" checked={restock} onChange={(e) => setRestock(e.target.checked)} /> {t.returnsPage.restock}
                </label>
                <label className="field">
                  <span className="label">{t.returnsPage.note}</span>
                  <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
                </label>
                <button className="btn btn--primary btn--sm" disabled={busy} onClick={() => void act('receive', { restock, note }, () => toast(t.returnsPage.done))}>
                  {t.returnsPage.receive}
                </button>
              </>
            ) : null}
            {canRefund && r.status === 'received' ? (
              <>
                <label className="field">
                  <span className="label">{t.returnsPage.refundAmount}</span>
                  <input className="input ltr" inputMode="decimal" value={amount} disabled={r.refund?.amount != null} onChange={(e) => setAmount(e.target.value)} />
                  <span className="hint">{t.returnsPage.refundHint}</span>
                </label>
                <button
                  className="btn btn--primary btn--sm"
                  disabled={busy || !(Number(amount) > 0)}
                  onClick={() =>
                    void act('refund', { amount: Number(amount), note }, (res) => {
                      const s = (res as { refund: { status: string } }).refund.status;
                      toast(s === 'succeeded' ? t.returnsPage.done : t.returnsPage.refundPending, s === 'succeeded' ? 'success' : 'error');
                    })
                  }
                >
                  {t.returnsPage.refundNow}
                </button>
              </>
            ) : null}
            {canWrite ? (
              <label className="field" style={{ marginTop: 16 }}>
                <span className="label">{t.returnsPage.internalNotes}</span>
                <textarea className="input" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  disabled={busy}
                  onClick={async () => {
                    try {
                      await patch(`/api/admin/returns/${id}/notes`, { internalNotes: notes });
                      toast(t.returnsPage.done);
                    } catch (e) {
                      setErr(e);
                    }
                  }}
                >
                  {t.returnsPage.saveNotes}
                </button>
              </label>
            ) : null}
          </div>
        </div>
      )}
    </Modal>
  );
}
