import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiUrl, qs } from '../../lib/api';
import { useApi } from '../../lib/hooks';
import type { Localized } from '../../lib/types';
import { useAT } from '../i18n';
import { AHead, Card, EmptyState, ErrorPanel, KpiCard, OrdersAreaChart, SkeletonKpis, SkeletonTable, Status, usePerms } from '../kit';

/**
 * Admin → Reports: business analytics from the order records (server-side aggregation,
 * analytics.service.ts). The same figures feed the dashboard and the CSV exports.
 */
type Analytics = {
  from: string;
  to: string;
  clipped: boolean;
  summary: {
    placed: number;
    paidOrders: number;
    pendingOrders: number;
    pendingAmount: number;
    pendingCod: number;
    cancelled: number;
    refundedOrders: number;
    units: number;
    gross: number;
    discounts: number;
    collected: number;
    refunds: number;
    net: number;
    vat: number;
    delivery: number;
    aov: number;
  };
  byStatus: Record<string, number>;
  daily: { date: string; placed: number; orders: number; revenue: number; net: number }[];
  byPaymentMethod: { _id: string; orders: number; revenue: number }[];
  topProducts: { _id: string; sku: string; name: Localized; units: number; orders: number; revenue: number }[];
  byCategory: { _id: string; name?: Localized; units: number; revenue: number }[];
  promotions: { code: string; orders: number; discount: number; collected: number; automatic: boolean; title?: Localized }[];
  bundles: { _id: string; sku: string; name: Localized; units: number; revenue: number }[];
  customers: { new: number; returning: number };
  lowStock: { _id: string; sku: string; name: Localized; stock: number; lowStockThreshold?: number; isBundle?: boolean }[];
  recentOrders: { _id: string; orderNumber: string; total: number; status: string; paymentStatus: string; paymentMethod: string; createdAt: string }[];
};

type Preset = 'today' | 'd7' | 'd30' | 'd90' | 'custom';
const PRESETS: [Preset, string, number][] = [
  ['today', 'Today', 1],
  ['d7', 'Last 7 days', 7],
  ['d30', 'Last 30 days', 30],
  ['d90', 'Last 90 days', 90],
];
/** Report dates are Riyadh calendar days (the store's time zone), whatever the browser's zone. */
const riyadhDay = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const addDays = (s: string, n: number) => {
  const d = new Date(`${s}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const METHOD: Record<string, string> = { card: 'Card (mada / Visa / Mastercard)', applepay: 'Apple Pay', stcpay: 'STC Pay', tabby: 'Tabby', cod: 'Cash on delivery' };
const name = (l?: Localized | null) => l?.en || l?.ar || '—';

export function Reports() {
  const { sar, n, dt, dm } = useAT();
  const perms = usePerms();
  const today = riyadhDay(new Date());
  const [preset, setPreset] = useState<Preset>('d30');
  const [custom, setCustom] = useState({ from: addDays(today, -29), to: today });
  const range = useMemo(() => {
    if (preset === 'custom') return custom.from <= custom.to ? custom : { from: custom.to, to: custom.from };
    const days = PRESETS.find((p) => p[0] === preset)![2];
    return { from: addDays(today, -(days - 1)), to: today };
  }, [preset, custom, today]);
  const query = qs(range);
  const { data, error, loading, reload } = useApi<Analytics>(`/api/admin/reports/analytics${query}`);
  const s = data?.summary;

  return (
    <div className="a-page" data-testid="admin-reports">
      <AHead title="Analytics & reports">
        <a className="btn btn--outline btn--sm" href={apiUrl(`/api/admin/reports/summary.csv${query}`)} download data-testid="export-summary">
          Summary CSV
        </a>
        <a className="btn btn--outline btn--sm" href={apiUrl(`/api/admin/reports/products.csv${query}`)} download>
          Products CSV
        </a>
        <a className="btn btn--outline btn--sm" href={apiUrl(`/api/admin/reports/payments.csv${query}`)} download>
          Payments CSV
        </a>
        {perms.has('orders:read') ? (
          <a className="btn btn--ghost btn--sm" href={apiUrl(`/api/admin/reports/orders.csv${query}`)} download title="Includes customer contact details — for fulfilment and accounting">
            Orders CSV (with contacts)
          </a>
        ) : null}
      </AHead>

      <div className="a-card" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'end', gap: 8, marginBottom: 16 }} role="group" aria-label="Report period">
        {PRESETS.map(([k, label]) => (
          <button key={k} type="button" className={`btn btn--sm ${preset === k ? 'btn--primary' : 'btn--ghost'}`} aria-pressed={preset === k} onClick={() => setPreset(k)}>
            {label}
          </button>
        ))}
        <button type="button" className={`btn btn--sm ${preset === 'custom' ? 'btn--primary' : 'btn--ghost'}`} aria-pressed={preset === 'custom'} onClick={() => setPreset('custom')}>
          Custom
        </button>
        {preset === 'custom' ? (
          <>
            <label className="field" style={{ margin: 0 }}>
              <span className="label">From</span>
              <input className="input" type="date" value={custom.from} max={today} onChange={(e) => e.target.value && setCustom({ ...custom, from: e.target.value })} data-testid="report-from" />
            </label>
            <label className="field" style={{ margin: 0 }}>
              <span className="label">To</span>
              <input className="input" type="date" value={custom.to} max={today} onChange={(e) => e.target.value && setCustom({ ...custom, to: e.target.value })} data-testid="report-to" />
            </label>
          </>
        ) : null}
        <span className="a-muted" style={{ marginInlineStart: 'auto', fontSize: 13 }}>
          {range.from === range.to ? range.from : `${range.from} → ${range.to}`} · Riyadh time · SAR
        </span>
      </div>

      {error ? <ErrorPanel onRetry={reload} /> : null}
      {loading && !data ? <SkeletonKpis count={8} /> : null}

      {data && s ? (
        <>
          {data.clipped ? <p className="alert alert--warning">The range was limited to the most recent 400 days.</p> : null}
          <div className="a-kpis" style={{ marginBottom: 16 }} data-testid="report-kpis">
            <KpiCard label="Net revenue" value={sar(s.net)} tip="Collected minus refunds." spark={data.daily.map((d) => d.net)} />
            <KpiCard label="Collected" value={sar(s.collected)} tip="Paid online or cash collected on delivery (after discounts; includes delivery and VAT)." />
            <KpiCard label="Refunds" value={sar(s.refunds)} tip={`Full and partial refunds of orders placed in the period (${n(s.refundedOrders)} orders).`} />
            <KpiCard label="Pending payments" value={sar(s.pendingAmount)} tip={`${n(s.pendingOrders)} open orders not paid yet (online awaiting confirmation, or cash on delivery not collected: ${sar(s.pendingCod)}). Not revenue.`} tone={s.pendingOrders ? 'attention' : undefined} />
            <KpiCard label="Orders placed" value={n(s.placed)} tip="Every order created in the period, whatever its status." />
            <KpiCard label="Paid orders" value={n(s.paidOrders)} tip="Orders whose money was received." />
            <KpiCard label="Average order value" value={sar(s.aov)} tip="Collected ÷ paid orders." />
            <KpiCard label="Cancelled" value={n(s.cancelled)} tip="Orders placed in the period that are now cancelled." />
          </div>

          <div className="a-grid-2" style={{ marginBottom: 16 }}>
            <Card title="Sales trend (paid orders and net revenue per day)">
              {data.daily.some((d) => d.orders) ? (
                <OrdersAreaChart data={data.daily.map((d) => ({ date: d.date, orders: d.orders, revenue: d.net }))} fmtDate={(d) => dm(`${d}T12:00:00Z`)} fmtMoney={sar} labels={{ orders: 'Paid orders', revenue: 'Net revenue' }} />
              ) : (
                <EmptyState title="No paid orders in this period" />
              )}
            </Card>
            <Card title="Money breakdown">
              <table className="a-table">
                <tbody>
                  <tr><td>Gross merchandise (before discounts)</td><td className="ltr" style={{ textAlign: 'end' }}>{sar(s.gross)}</td></tr>
                  <tr><td>− Discounts (codes and offers)</td><td className="ltr" style={{ textAlign: 'end' }}>{sar(s.discounts)}</td></tr>
                  <tr><td>+ Delivery and COD fees</td><td className="ltr" style={{ textAlign: 'end' }}>{sar(s.collected - (s.gross - s.discounts))}</td></tr>
                  <tr><td><strong>= Collected</strong></td><td className="ltr" style={{ textAlign: 'end' }}><strong>{sar(s.collected)}</strong></td></tr>
                  <tr><td>− Refunds</td><td className="ltr" style={{ textAlign: 'end' }}>{sar(s.refunds)}</td></tr>
                  <tr><td><strong>= Net revenue</strong></td><td className="ltr" style={{ textAlign: 'end' }}><strong>{sar(s.net)}</strong></td></tr>
                  <tr><td className="a-muted">VAT included in collected</td><td className="ltr a-muted" style={{ textAlign: 'end' }}>{sar(s.vat)}</td></tr>
                  <tr><td className="a-muted">Units sold</td><td className="ltr a-muted" style={{ textAlign: 'end' }}>{n(s.units)}</td></tr>
                  <tr><td className="a-muted">Customers: new / returning</td><td className="ltr a-muted" style={{ textAlign: 'end' }}>{n(data.customers.new)} / {n(data.customers.returning)}</td></tr>
                </tbody>
              </table>
            </Card>
          </div>

          <div className="a-grid-2" style={{ marginBottom: 16 }}>
            <Card title="Best-selling products">
              <Table empty="No product sales" head={['Product', 'Units', 'Revenue']} rows={data.topProducts.slice(0, 10).map((p) => [`${name(p.name)} (${p.sku})`, n(p.units), sar(p.revenue)])} />
            </Card>
            <Card title="Categories">
              <Table empty="No category sales" head={['Category', 'Units', 'Revenue']} rows={data.byCategory.map((c) => [name(c.name) === '—' ? c._id : name(c.name), n(c.units), sar(c.revenue)])} />
            </Card>
            <Card title="Payment methods">
              <Table empty="No payments" head={['Method', 'Paid orders', 'Collected']} rows={data.byPaymentMethod.map((m) => [METHOD[m._id] ?? m._id, n(m.orders), sar(m.revenue)])} />
            </Card>
            <Card title="Offers and discount codes">
              <Table empty="No promotions used" head={['Promotion', 'Orders', 'Discount given', 'Collected']} rows={data.promotions.map((p) => [p.automatic ? `Offer: ${name(p.title)}` : `Code ${p.code}`, n(p.orders), sar(p.discount), sar(p.collected)])} />
            </Card>
            <Card title="Bundles">
              <Table empty="No bundle sales" head={['Bundle', 'Units', 'Revenue']} rows={data.bundles.map((b) => [`${name(b.name)} (${b.sku})`, n(b.units), sar(b.revenue)])} />
            </Card>
            <Card title="Low stock (now)">
              <Table empty="Nothing is low on stock" head={['Product', 'Stock']} rows={data.lowStock.map((p) => [`${name(p.name)} (${p.sku})${p.isBundle ? ' — bundle' : ''}`, n(p.stock)])} />
            </Card>
          </div>

          <Card title="Recent orders in this period">
            {data.recentOrders.length ? (
              <div className="a-table-wrap">
                <table className="a-table">
                  <thead>
                    <tr><th>Order</th><th>Placed</th><th>Status</th><th>Payment</th><th>Method</th><th style={{ textAlign: 'end' }}>Total</th></tr>
                  </thead>
                  <tbody>
                    {data.recentOrders.map((o) => (
                      <tr key={o._id}>
                        <td><Link to={`/admin/orders/${o._id}`}>{o.orderNumber}</Link></td>
                        <td>{dt(o.createdAt)}</td>
                        <td><Status value={o.status} /></td>
                        <td><Status value={o.paymentStatus} /></td>
                        <td>{METHOD[o.paymentMethod] ?? o.paymentMethod}</td>
                        <td className="ltr" style={{ textAlign: 'end' }}>{sar(o.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState title="No orders in this period" />
            )}
          </Card>

          <details className="a-card" style={{ marginTop: 16 }}>
            <summary><strong>How these figures are calculated</strong></summary>
            <ul className="a-muted" style={{ fontSize: 13, lineHeight: 1.7 }}>
              <li>Period: orders placed between the two dates, by Riyadh calendar day. Amounts are SAR (the currency customers are charged in) — storefront display currencies are never used here.</li>
              <li>Paid order: money received — paid online (Moyasar / Tabby, confirmed by the gateway) or cash collected on delivery.</li>
              <li>Pending payment: open order not paid yet (online awaiting gateway confirmation, or cash on delivery not yet collected). Not counted as revenue.</li>
              <li>Collected = sum of paid orders' totals (after discounts; includes delivery, COD fee and VAT). Net revenue = collected − refunds. Average order value = collected ÷ paid orders.</li>
              <li>Refunds (full and partial) are attributed to the order's date. Cancelled orders that were never paid are excluded; a paid order cancelled later stays in collected until it is refunded.</li>
              <li>Product and category revenue = line totals after each line's discount share (before delivery and refunds).</li>
              <li>New customer: first paid order falls inside the period. Conversion funnel figures are not shown: the store has no reliable visit/add-to-cart event tracking.</li>
            </ul>
          </details>
        </>
      ) : loading ? (
        <SkeletonTable rows={6} cols={4} />
      ) : null}
    </div>
  );
}

function Table({ head, rows, empty }: { head: string[]; rows: (string | number)[][]; empty: string }) {
  if (!rows.length) return <p className="a-muted">{empty}</p>;
  return (
    <div className="a-table-wrap">
      <table className="a-table">
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={h} style={i ? { textAlign: 'end' } : undefined}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j} className={j ? 'ltr' : undefined} style={j ? { textAlign: 'end' } : undefined}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
