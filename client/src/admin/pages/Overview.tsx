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

export function Overview() {
  const { data, error, loading, reload } = useApi<OverviewData>('/api/admin/overview');

  if (error) return <ErrorState onRetry={reload} message={error.message} />;
  if (loading || !data) return <Spinner />;

  const last30 = data.salesTrend.reduce((s, d) => s + d.revenue, 0);

  const metrics = [
    { label: 'Total orders', value: data.totalOrders.toLocaleString(), detail: 'All recorded orders', tone: 'neutral' },
    { label: 'Total revenue', value: sar(data.revenue), detail: 'Net of refunds', tone: 'revenue' },
    { label: 'Revenue · last 30 days', value: sar(last30), detail: 'Based on available sales data', tone: 'neutral' },
    { label: 'Orders to fulfil', value: data.pendingOrders.toLocaleString(), detail: 'Pending orders', tone: 'attention' },
    { label: 'Low / out of stock', value: `${data.lowStock.length} / ${data.outOfStock}`, detail: 'Inventory attention required', tone: 'attention' },
    { label: 'Customers', value: data.customers.toLocaleString(), detail: 'Recorded customers', tone: 'neutral' },
  ];

  return (
    <div className="overview-page">
      <AHead title="Dashboard">
        <span className="overview-period">Last 30 days · Riyadh time</span>
        <button className="btn btn--ghost btn--sm" onClick={() => void reload()}>
          Refresh data
        </button>
      </AHead>

      {data.paymentReviewCount > 0 ? (
        <div className="alert alert--warning overview-alert">
          <div>
            <strong>{data.paymentReviewCount} orders require payment review</strong>
            <p>Payment mismatch or payment received after cancellation.</p>
          </div>
          <Link to="/admin/orders">Review orders →</Link>
        </div>
      ) : null}

      <section className="overview-section" aria-label="Business performance">
        <div className="overview-section__heading">
          <div>
            <h2>Business performance</h2>
            <p>Live figures from your CELIBERY store</p>
          </div>
        </div>
        <div className="kpis overview-kpis">
          {metrics.map((metric) => (
            <article className={`kpi overview-kpi overview-kpi--${metric.tone}`} key={metric.label}>
              <span>{metric.label}</span>
              <strong>{metric.value}</strong>
              <small>{metric.detail}</small>
            </article>
          ))}
        </div>
      </section>

      <section className="overview-section">
        <div className="overview-section__heading">
          <div>
            <h2>Sales & order activity</h2>
            <p>Review recent sales performance and order distribution</p>
          </div>
        </div>
        <div className="a-grid-2 overview-analytics">
          <Card title="Revenue trend · Last 30 days">
            {data.salesTrend.length ? (
              <BarChart data={data.salesTrend} value="revenue" label={sar} />
            ) : (
              <div className="empty-state">
                <strong>No sales trend available</strong>
                <span>Sales data will appear here when available.</span>
              </div>
            )}
          </Card>

          <Card title="Orders by status">
            {Object.keys(data.ordersByStatus).length ? (
              <div className="overview-status-list">
                {Object.entries(data.ordersByStatus).map(([key, value]) => (
                  <div className="overview-status-row" key={key}>
                    <Status value={key} />
                    <strong>{value.toLocaleString()}</strong>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <strong>No orders recorded</strong>
                <span>Order status distribution will appear here.</span>
              </div>
            )}
          </Card>
        </div>
      </section>

      <section className="overview-section">
        <div className="overview-section__heading">
          <div>
            <h2>Operations overview</h2>
            <p>Recent orders and inventory requiring attention</p>
          </div>
        </div>
        <div className="a-grid-2 a-grid-even overview-operations">
          <Card title="Recent orders" actions={<Link to="/admin/orders">View all orders →</Link>}>
            {data.recentOrders.length ? (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Order</th>
                      <th>Customer</th>
                      <th>Total</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recentOrders.map((order) => (
                      <tr key={order._id}>
                        <td>
                          <Link to={`/admin/orders/${order._id}`}>{order.orderNumber}</Link>
                          <div className="muted">{dt(order.createdAt)}</div>
                        </td>
                        <td>{order.contact.name}</td>
                        <td>{sar(order.total)}</td>
                        <td><Status value={order.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty-state">
                <strong>No recent orders</strong>
                <span>New orders will appear here.</span>
              </div>
            )}
          </Card>

          <Card title="Inventory alerts" actions={<Link to="/admin/inventory?lowStock=1">View inventory →</Link>}>
            {data.lowStock.length ? (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>SKU</th>
                      <th>Product</th>
                      <th>Available</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.lowStock.map((product) => (
                      <tr key={product._id}>
                        <td className="ltr">{product.sku}</td>
                        <td>{en(product.name)}</td>
                        <td>
                          {product.stock === 0 ? (
                            <span className="badge badge--danger">Out of stock</span>
                          ) : (
                            <span className="badge badge--warning">{product.stock} left</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty-state">
                <strong>Inventory is looking good</strong>
                <span>No products are currently below their low-stock threshold.</span>
              </div>
            )}
          </Card>
        </div>
      </section>
    </div>
  );
}
