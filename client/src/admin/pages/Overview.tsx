import { Link } from 'react-router-dom';
import { ErrorState, Spinner } from '../../components/ui';
import { useApi } from '../../lib/hooks';
import type { Localized } from '../../lib/types';
import { AHead, BarChart, Card, dt, en, sar, Status } from '../kit';

type OverviewData = {
  totalOrders: number;
  revenue: number;
  pendingOrders: number;
  ordersByStatus: Record<string, number>;
  salesTrend: { date: string; orders: number; revenue: number }[];
  lowStock: { _id: string; sku: string; name: Localized; stock: number; lowStockThreshold?: number }[];
  outOfStock: number;
  recentOrders: { _id: string; orderNumber: string; contact: { name: string }; total: number; status: string; paymentStatus: string; createdAt: string }[];
  customers: number;
  paymentReviewCount: number;
};

/** All figures come from the live database — nothing here is sample or fabricated analytics. */
export function Overview() {
  const { data, error, loading, reload } = useApi<OverviewData>('/api/admin/overview');
  if (error) return <ErrorState onRetry={reload} message={error.message} />;
  if (loading || !data) return <Spinner />;
  const last30 = data.salesTrend.reduce((s, d) => s + d.revenue, 0);
  return (
    <>
      <AHead title="Overview" />
      {data.paymentReviewCount ? (
        <p className="alert alert--warning">
          {data.paymentReviewCount} order(s) need payment review (amount mismatch or payment after cancellation). <Link to="/admin/orders">Open orders →</Link>
        </p>
      ) : null}
      <div className="kpis">
        <div className="kpi">
          <span>Total orders</span>
          <strong data-testid="kpi-orders">{data.totalOrders}</strong>
        </div>
        <div className="kpi">
          <span>Revenue (net of refunds)</span>
          <strong>{sar(data.revenue)}</strong>
        </div>
        <div className="kpi">
          <span>Revenue · last 30 days</span>
          <strong>{sar(last30)}</strong>
        </div>
        <div className="kpi">
          <span>Orders to fulfil</span>
          <strong>{data.pendingOrders}</strong>
        </div>
        <div className="kpi">
          <span>Low / out of stock</span>
          <strong>
            {data.lowStock.length} / {data.outOfStock}
          </strong>
        </div>
        <div className="kpi">
          <span>Customers</span>
          <strong>{data.customers}</strong>
        </div>
      </div>
      <div className="a-grid-2">
        <Card title="Sales trend · last 30 days (Riyadh time)">
          <BarChart data={data.salesTrend} value="revenue" label={sar} />
        </Card>
        <Card title="Orders by status">
          <dl className="kv">
            {Object.entries(data.ordersByStatus).map(([k, v]) => (
              <div key={k} style={{ display: 'contents' }}>
                <dt>
                  <Status value={k} />
                </dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
          {!Object.keys(data.ordersByStatus).length ? <p className="muted">No orders yet.</p> : null}
        </Card>
      </div>
      <div className="a-grid-2 a-grid-even">
        <Card title="Recent orders" actions={<Link to="/admin/orders">All orders →</Link>}>
          <div className="table-wrap">
            <table className="table">
              <tbody>
                {data.recentOrders.map((o) => (
                  <tr key={o._id}>
                    <td>
                      <Link to={`/admin/orders/${o._id}`}>{o.orderNumber}</Link>
                      <div className="muted">{dt(o.createdAt)}</div>
                    </td>
                    <td>{o.contact.name}</td>
                    <td>{sar(o.total)}</td>
                    <td>
                      <Status value={o.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!data.recentOrders.length ? <p className="muted">No orders yet.</p> : null}
        </Card>
        <Card title="Inventory alerts" actions={<Link to="/admin/inventory?lowStock=1">Inventory →</Link>}>
          <div className="table-wrap">
            <table className="table">
              <tbody>
                {data.lowStock.map((p) => (
                  <tr key={p._id}>
                    <td className="ltr">{p.sku}</td>
                    <td>{en(p.name)}</td>
                    <td>{p.stock === 0 ? <span className="badge badge--danger">Out of stock</span> : <span className="badge badge--warning">{p.stock} left</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!data.lowStock.length ? <p className="muted">All products are above their low-stock threshold.</p> : null}
        </Card>
      </div>
    </>
  );
}
