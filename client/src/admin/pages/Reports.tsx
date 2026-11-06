import { useState } from 'react';
import { ErrorState, Spinner } from '../../components/ui';
import { qs } from '../../lib/api';
import { useApi } from '../../lib/hooks';
import type { Localized } from '../../lib/types';
import { AHead, BarChart, Card, en, F, sar } from '../kit';

type Report = {
  summary: { orders: number; gross: number; discounts: number; revenue: number; refunds: number; vat: number; units: number };
  daily: { date: string; orders: number; revenue: number }[];
  byCategory: { _id: string; name?: Localized; units: number; revenue: number }[];
  byPaymentMethod: { _id: string; orders: number; revenue: number }[];
  topProducts: { _id: string; sku: string; name: Localized; units: number; revenue: number }[];
  discounts: { _id: string; orders: number; discount: number }[];
};

const iso = (d: Date) => d.toISOString().slice(0, 10);

export function Reports() {
  const [from, setFrom] = useState(iso(new Date(Date.now() - 29 * 86400000)));
  const [to, setTo] = useState(iso(new Date()));
  const query = qs({ from, to });
  const { data, error, loading } = useApi<Report>(`/api/admin/reports/sales${query}`);
  return (
    <>
      <AHead title="Reports">
        <a className="btn btn--outline btn--sm" href={`${(import.meta.env.VITE_API_BASE_URL as string | undefined) ?? ''}/api/admin/reports/orders.csv${query}`}>
          Export orders CSV
        </a>
      </AHead>
      <div className="a-filters reports-filters">
        <F label="From">
          <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </F>
        <F label="To">
          <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </F>
      </div>
      {error ? <ErrorState message={error.message} /> : loading || !data ? <Spinner /> : (
        <>
          <p className="muted" style={{ fontSize: 13 }}>
            Counts paid online orders and cash-on-delivery orders that were not cancelled or returned. Dates are in Riyadh time.
          </p>
          <div className="kpis reports-kpis">
            <div className="kpi">
              <span>Orders</span>
              <strong>{data.summary.orders}</strong>
            </div>
            <div className="kpi">
              <span>Units sold</span>
              <strong>{data.summary.units}</strong>
            </div>
            <div className="kpi">
              <span>Gross sales</span>
              <strong>{sar(data.summary.gross)}</strong>
            </div>
            <div className="kpi">
              <span>Discounts</span>
              <strong>{sar(data.summary.discounts)}</strong>
            </div>
            <div className="kpi">
              <span>Revenue</span>
              <strong>{sar(data.summary.revenue)}</strong>
            </div>
            <div className="kpi">
              <span>Refunds</span>
              <strong>{sar(data.summary.refunds)}</strong>
            </div>
            <div className="kpi">
              <span>VAT included</span>
              <strong>{sar(data.summary.vat)}</strong>
            </div>
          </div>
          <div className="reports-chart-card"><Card title="Revenue by day">
            <BarChart data={data.daily} value="revenue" label={sar} />
          </Card></div>
          <div className="a-grid-2 a-grid-even reports-grid">
            <Card title="By category">
              <table className="table reports-table">
                <tbody>
                  {data.byCategory.map((c) => (
                    <tr key={c._id ?? 'none'}>
                      <td>{en(c.name) || c._id || '—'}</td>
                      <td>{c.units} units</td>
                      <td>{sar(c.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
            <Card title="By payment method">
              <table className="table reports-table">
                <tbody>
                  {data.byPaymentMethod.map((c) => (
                    <tr key={c._id}>
                      <td>{c._id}</td>
                      <td>{c.orders} orders</td>
                      <td>{sar(c.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
            <Card title="Top products">
              <table className="table reports-table">
                <tbody>
                  {data.topProducts.map((p) => (
                    <tr key={p._id}>
                      <td>
                        {p.sku} <span className="muted">{en(p.name)}</span>
                      </td>
                      <td>{p.units}</td>
                      <td>{sar(p.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
            <Card title="Discount codes used">
              <table className="table reports-table">
                <tbody>
                  {data.discounts.map((d) => (
                    <tr key={d._id}>
                      <td>{d._id}</td>
                      <td>{d.orders} orders</td>
                      <td>−{sar(d.discount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!data.discounts.length ? <p className="muted">None in this period.</p> : null}
            </Card>
          </div>
        </>
      )}
    </>
  );
}

