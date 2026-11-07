import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, api, post, qs } from '../../lib/api';
import { useToast } from '../../state/toast';
import { useAT } from '../i18n';
import { EmptyState, ErrorPanel, SkeletonTable, Status, usePerms } from '../kit';

type Row = { _id: string; orderNumber: string; contact: { name: string; phone: string }; total: number; paymentStatus: string; paymentMethod: string; createdAt: string; items: { quantity: number }[] };

/**
 * Returns (spec §16). The backend records returns as an order status (with optional restock), not as
 * separate return requests — so this lists the returned orders, and says so plainly.
 */
export function Returns() {
  const { t, sar, n, dt } = useAT();
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [pages, setPages] = useState(1);
  const [error, setError] = useState<ApiError | null>(null);
  const [nonce, setNonce] = useState(0);
  const canRefund = usePerms().has('orders:refund');
  const toast = useToast();
  const [checking, setChecking] = useState(false);
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
  useEffect(() => {
    let alive = true;
    setRows(null);
    setError(null);
    api<Row[]>(`/api/admin/orders${qs({ status: 'returned', page, limit: 25 })}`)
      .then((r) => {
        if (!alive) return;
        setRows(r.data);
        setPages(Number(r.meta?.pages ?? 1));
      })
      .catch((e) => alive && setError(e));
    return () => {
      alive = false;
    };
  }, [page, nonce]);

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
      <p className="a-note">{t.returnsPage.workflowNote}</p>
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
                    <th key={h} className={i === 2 || i === 3 ? 'num' : undefined}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((o) => (
                  <tr key={o._id}>
                    <td>
                      <Link to={`/admin/orders/${o._id}`} className="ltr a-strong">
                        {o.orderNumber}
                      </Link>
                    </td>
                    <td>
                      {o.contact.name}
                      <div className="a-sub ltr">{o.contact.phone}</div>
                    </td>
                    <td className="num">{n(o.items.reduce((s, i) => s + i.quantity, 0))}</td>
                    <td className="num">{sar(o.total)}</td>
                    <td>
                      <Status value={o.paymentStatus} />
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
    </div>
  );
}
