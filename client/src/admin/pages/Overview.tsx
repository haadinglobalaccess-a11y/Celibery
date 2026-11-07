import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { qs } from '../../lib/api';
import type { Localized } from '../../lib/types';
import { cachedApi, codPending, countLowStock, countOrders, countsAsRevenue, dayKey, ordersBetween, type PeriodOrder } from '../data';
import { useAT } from '../i18n';
import { AIcon } from '../icons';
import { EmptyState, ErrorPanel, InfoTip, KpiCard, OrdersAreaChart, Skeleton, SkeletonKpis, SkeletonTable, Status, usePerms, type KpiTrend } from '../kit';

/* ───────────── Date ranges (Riyadh calendar days) ───────────── */
type Preset = 'today' | 'd7' | 'd30' | 'd90' | 'custom';
type Range = { from: string; to: string };
const DAYS: Record<Exclude<Preset, 'custom'>, number> = { today: 1, d7: 7, d30: 30, d90: 90 };
const ymd = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const addDays = (s: string, n: number) => {
  const d = new Date(`${s}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const spanDays = (r: Range) => Math.round((new Date(`${r.to}T12:00:00Z`).getTime() - new Date(`${r.from}T12:00:00Z`).getTime()) / 86_400_000) + 1;
const presetRange = (p: Exclude<Preset, 'custom'>): Range => {
  const to = ymd(new Date());
  return { from: addDays(to, -(DAYS[p] - 1)), to };
};
const previousOf = (r: Range): Range => {
  const n = spanDays(r);
  return { from: addDays(r.from, -n), to: addDays(r.from, -1) };
};
/** Day boundaries in Riyadh time, so the last day of the range is fully included. */
const bounds = (r: Range) => ({ from: `${r.from}T00:00:00+03:00`, to: `${r.to}T23:59:59.999+03:00` });

/* ───────────── Data ───────────── */
type Sales = { summary: { orders: number; revenue: number }; daily: { date: string; orders: number; revenue: number }[] };
type OverviewApi = {
  lowStock: { _id: string; sku: string; name: Localized; stock: number; lowStockThreshold?: number }[];
  paymentReviewCount: number;
};
type RecentRow = { _id: string; orderNumber: string; contact: { name: string }; total: number; status: string; paymentStatus: string; paymentMethod: string; createdAt: string; items: { quantity: number }[] };
const PERIOD_STATUSES = ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'returned', 'cancelled'] as const;

type Dash = {
  sales: { cur: Sales; prev: Sales } | null;
  period: Record<string, number> | null;
  prevPeriod: { delivered: number; returned: number } | null;
  truncated: boolean;
  now: { pending: number; confirmed: number; processing: number; shipped: number } | null;
  cod: { amount: number; orders: number } | null;
  overview: OverviewApi | null;
  lowStockCount: number | null;
  recent: RecentRow[] | null;
};

/**
 * Revenue, orders, trend and status counts are computed here from the order list, grouped by Riyadh
 * calendar day, using the server's own revenue rule. (The sales report's daily series is not used:
 * on servers east of Riyadh it drops the current day.)
 */
function summarise(rows: PeriodOrder[], range: Range): { sales: Sales; status: Record<string, number> } {
  const days = new Map<string, { orders: number; revenue: number }>();
  for (let d = range.from; d <= range.to; d = addDays(d, 1)) days.set(d, { orders: 0, revenue: 0 });
  const status: Record<string, number> = Object.fromEntries(PERIOD_STATUSES.map((s) => [s, 0]));
  let orders = 0;
  let revenue = 0;
  for (const o of rows) {
    status[o.status] = (status[o.status] ?? 0) + 1;
    if (!countsAsRevenue(o)) continue;
    orders += 1;
    revenue += o.total;
    const day = days.get(dayKey(o.createdAt));
    if (day) {
      day.orders += 1;
      day.revenue += o.total;
    }
  }
  return { sales: { summary: { orders, revenue }, daily: [...days].map(([date, v]) => ({ date, ...v })) }, status };
}

async function loadDash(range: Range, perms: Set<string>): Promise<Dash> {
  const prev = previousOf(range);
  const b = bounds(range);
  const pb = bounds(prev);
  const orders = perms.has('orders:read');
  const opt = <T,>(cond: boolean, f: () => Promise<T>) => (cond ? f() : Promise.resolve(null));
  const [cur, before, now, cod, overview, lowStockCount, recent] = await Promise.all([
    opt(orders, () => ordersBetween(b.from, b.to)),
    opt(orders, () => ordersBetween(pb.from, pb.to)),
    opt(orders, async () => {
      const [pending, confirmed, processing, shipped] = await Promise.all(['pending', 'confirmed', 'processing', 'shipped'].map((s) => countOrders({ status: s })));
      return { pending, confirmed, processing, shipped };
    }),
    opt(orders, () => codPending()),
    opt(perms.has('overview:read'), () => cachedApi<OverviewApi>('/api/admin/overview').then((r) => r.data)),
    opt(perms.has('inventory:read'), () => countLowStock()),
    opt(orders, () => cachedApi<RecentRow[]>(`/api/admin/orders${qs({ limit: 8 })}`).then((r) => r.data)),
  ]);
  const c = cur ? summarise(cur.rows, range) : null;
  const p = before ? summarise(before.rows, prev) : null;
  return {
    sales: c && p ? { cur: c.sales, prev: p.sales } : null,
    period: c?.status ?? null,
    prevPeriod: p ? { delivered: p.status.delivered, returned: p.status.returned } : null,
    truncated: Boolean(cur?.truncated || before?.truncated),
    now,
    cod,
    overview,
    lowStockCount: lowStockCount ?? overview?.lowStock.length ?? null,
    recent,
  };
}

const pct = (cur: number, prev: number) => (prev > 0 ? ((cur - prev) / prev) * 100 : null);

export function Overview() {
  const { t, sar, n, dt, dm } = useAT();
  const perms = usePerms();
  const [preset, setPreset] = useState<Preset>('d7');
  const [custom, setCustom] = useState<Range>(() => presetRange('d30'));
  const range = useMemo(() => (preset === 'custom' ? custom : presetRange(preset)), [preset, custom]);
  const [data, setData] = useState<Dash | null>(null);
  const [error, setError] = useState(false);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    setData(null);
    setError(false);
    loadDash(range, perms)
      .then((d) => alive && setData(d))
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
    };
  }, [range, perms, nonce]);
  const retry = useCallback(() => setNonce((x) => x + 1), []);

  const rangeLabel = preset === 'custom' ? t.dash.vsPrevPeriod : t.dash.cmp[preset];
  const trendOf = (cur: number, prev: number): KpiTrend => ({ pct: pct(cur, prev), label: prev > 0 ? rangeLabel : t.dash.noComparison });

  return (
    <div className="a-page">
      <div className="a-pagehead">
        <div>
          <h1>{t.dash.title}</h1>
          <p className="a-muted">{t.dash.welcome}</p>
        </div>
        <div className="a-pagehead__actions">
          <label className="a-field-inline">
            <span className="sr-only">{t.dash.range}</span>
            <select className="a-select" value={preset} onChange={(e) => setPreset(e.target.value as Preset)}>
              <option value="today">{t.dash.today}</option>
              <option value="d7">{t.dash.d7}</option>
              <option value="d30">{t.dash.d30}</option>
              <option value="d90">{t.dash.d90}</option>
              <option value="custom">{t.dash.custom}</option>
            </select>
          </label>
          {preset === 'custom' ? (
            <>
              <label className="a-field-inline">
                <span className="a-muted">{t.common.from}</span>
                <input className="a-input" type="date" value={custom.from} max={custom.to} onChange={(e) => e.target.value && setCustom({ ...custom, from: e.target.value })} />
              </label>
              <label className="a-field-inline">
                <span className="a-muted">{t.common.to}</span>
                <input className="a-input" type="date" value={custom.to} min={custom.from} onChange={(e) => e.target.value && setCustom({ ...custom, to: e.target.value })} />
              </label>
            </>
          ) : null}
          {perms.has('reports:read') ? (
            <a className="a-btn a-btn--secondary" href={`/api/admin/reports/orders.csv${qs(range)}`} download title={t.dash.exportHint}>
              <AIcon name="download" size={16} /> {t.common.export}
            </a>
          ) : null}
        </div>
      </div>

      {error ? (
        <ErrorPanel onRetry={retry} />
      ) : !data ? (
        <>
          <SkeletonKpis count={5} />
          <SkeletonKpis count={5} />
          <div className="a-grid a-grid--2-1">
            <section className="a-card">
              <Skeleton w="30%" h={16} />
              <Skeleton h={220} r={8} />
            </section>
            <section className="a-card">
              <Skeleton w="40%" h={16} />
              <SkeletonTable rows={7} cols={3} />
            </section>
          </div>
        </>
      ) : (
        <DashBody data={data} t={t} sar={sar} n={n} dt={dt} dm={dm} trendOf={trendOf} perms={perms} />
      )}
    </div>
  );
}

function DashBody({
  data,
  t,
  sar,
  n,
  dt,
  dm,
  trendOf,
  perms,
}: {
  data: Dash;
  t: ReturnType<typeof useAT>['t'];
  sar: (h: number | null | undefined) => string;
  n: (v: number) => string;
  dt: (d?: string | Date | null) => string;
  dm: (d?: string | Date | null) => string;
  trendOf: (cur: number, prev: number) => KpiTrend;
  perms: Set<string>;
}) {
  const { sales, period, prevPeriod, now, cod, overview, lowStockCount, recent, truncated } = data;
  const { lang } = useAT();
  const rev = sales?.cur.summary.revenue ?? 0;
  const ord = sales?.cur.summary.orders ?? 0;
  const prevRev = sales?.prev.summary.revenue ?? 0;
  const prevOrd = sales?.prev.summary.orders ?? 0;
  const aov = ord ? rev / ord : 0;
  const prevAov = prevOrd ? prevRev / prevOrd : 0;
  const daily = sales?.cur.daily ?? [];
  const na = t.dash.needsReports;
  const statusTotal = period ? Object.values(period).reduce((s, v) => s + v, 0) : 0;
  const lowStock = (overview?.lowStock ?? []).slice(0, 5);

  return (
    <>
      {overview?.paymentReviewCount ? (
        <div className="a-alert a-alert--warning" role="status">
          <AIcon name="alert" size={18} />
          <div>
            <strong>{t.dash.reviewAlert(overview.paymentReviewCount)}</strong>
            <span>{t.dash.reviewText}</span>
          </div>
          <Link to="/admin/orders">{t.dash.reviewLink}</Link>
        </div>
      ) : null}

      <section aria-label={t.dash.title}>
        <div className="a-kpis">
          <KpiCard label={t.dash.kpi.revenue} value={sales ? sar(rev) : '—'} tip={t.dash.tip.revenue} trend={sales ? trendOf(rev, prevRev) : null} note={sales ? undefined : na} spark={sales ? daily.map((d) => d.revenue) : undefined} />
          <KpiCard
            label={t.dash.kpi.orders}
            value={sales ? <span data-testid="kpi-orders">{n(ord)}</span> : '—'}
            tip={t.dash.tip.orders}
            trend={sales ? trendOf(ord, prevOrd) : null}
            note={sales ? undefined : na}
            spark={sales ? daily.map((d) => d.orders) : undefined}
          />
          <KpiCard label={t.dash.kpi.aov} value={sales ? sar(Math.round(aov)) : '—'} tip={t.dash.tip.aov} trend={sales ? trendOf(aov, prevAov) : null} note={sales ? undefined : na} />
          <KpiCard label={t.dash.kpi.pending} value={now ? n(now.pending + now.confirmed) : '—'} tip={t.dash.tip.pending} note={t.dash.current} tone={now && now.pending + now.confirmed > 0 ? 'attention' : undefined} />
          <KpiCard label={t.dash.kpi.ready} value={now ? n(now.processing) : '—'} tip={t.dash.tip.ready} note={t.dash.current} />
          <KpiCard label={t.dash.kpi.transit} value={now ? n(now.shipped) : '—'} tip={t.dash.tip.transit} note={t.dash.current} />
          <KpiCard label={t.dash.kpi.delivered} value={period ? n(period.delivered) : '—'} tip={t.dash.tip.delivered} trend={period && prevPeriod ? trendOf(period.delivered, prevPeriod.delivered) : null} />
          <KpiCard label={t.dash.kpi.returns} value={period ? n(period.returned) : '—'} tip={t.dash.tip.returns} trend={period && prevPeriod ? trendOf(period.returned, prevPeriod.returned) : null} />
          <KpiCard label={t.dash.kpi.cod} value={cod ? sar(cod.amount) : '—'} tip={t.dash.tip.cod} note={cod ? t.shell.codPending(cod.orders) : undefined} tone={cod && cod.amount > 0 ? 'attention' : undefined} />
          <KpiCard label={t.dash.kpi.lowStock} value={lowStockCount != null ? n(lowStockCount) : '—'} tip={t.dash.tip.lowStock} note={t.dash.current} tone={lowStockCount ? 'attention' : undefined} />
        </div>
        {truncated ? <p className="a-footnote">{t.dash.truncated}</p> : null}
      </section>

      <div className="a-grid a-grid--2-1">
        <section className="a-card" aria-labelledby="dash-trend">
          <div className="a-card__head">
            <h2 id="dash-trend">{t.dash.trendTitle}</h2>
          </div>
          {!sales ? (
            <EmptyState title={na} />
          ) : daily.some((d) => d.orders > 0) ? (
            <OrdersAreaChart data={daily} fmtDate={(d) => dm(`${d}T12:00:00Z`)} fmtMoney={sar} labels={{ orders: t.dash.orders, revenue: t.dash.revenue }} />
          ) : (
            <EmptyState title={t.dash.trendEmpty} />
          )}
        </section>

        <section className="a-card" aria-labelledby="dash-status">
          <div className="a-card__head">
            <h2 id="dash-status">{t.dash.statusTitle}</h2>
          </div>
          {period ? (
            <>
              <table className="a-table a-table--compact">
                <thead>
                  <tr>
                    {t.dash.statusHead.map((h, i) => (
                      <th key={h} className={i ? 'num' : undefined}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {PERIOD_STATUSES.map((s) => (
                    <tr key={s}>
                      <td>
                        <Status value={s} />
                      </td>
                      <td className="num">{n(period[s])}</td>
                      <td className="num">{statusTotal ? `${((period[s] / statusTotal) * 100).toFixed(1)}%` : '0.0%'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="a-footnote">{t.dash.statusUntracked}</p>
            </>
          ) : (
            <EmptyState title={t.shell.forbidden} />
          )}
        </section>
      </div>

      {perms.has('orders:read') ? (
        <section className="a-card" aria-labelledby="dash-recent">
          <div className="a-card__head">
            <h2 id="dash-recent">{t.dash.recentTitle}</h2>
            <Link to="/admin/orders" className="a-link">
              {t.dash.viewAllOrders}
            </Link>
          </div>
          {recent && recent.length ? (
            <div className="a-table-wrap">
              <table className="a-table">
                <thead>
                  <tr>
                    {[t.ordersPage.head[0], t.ordersPage.head[1], t.ordersPage.head[2], t.ordersPage.head[3], t.ordersPage.head[4], t.ordersPage.head[5], t.ordersPage.head[6], t.ordersPage.head[7], t.ordersPage.head[8]].map((h, i) => (
                      <th key={h} className={i === 3 || i === 4 ? 'num' : undefined}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {recent.map((o) => (
                    <tr key={o._id}>
                      <td>
                        <Link to={`/admin/orders/${o._id}`} className="ltr a-strong">
                          {o.orderNumber}
                        </Link>
                      </td>
                      <td>{o.contact.name}</td>
                      <td>{t.common.website}</td>
                      <td className="num">{n(o.items.reduce((s, i) => s + i.quantity, 0))}</td>
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
          ) : (
            <EmptyState title={t.dash.recentEmpty} />
          )}
        </section>
      ) : null}

      <div className="a-grid a-grid--2-1">
        <section className="a-card" aria-labelledby="dash-low">
          <div className="a-card__head">
            <h2 id="dash-low">{t.dash.lowTitle}</h2>
            {perms.has('inventory:read') ? (
              <Link to="/admin/inventory?lowStock=1" className="a-link">
                {t.dash.viewInventory}
              </Link>
            ) : null}
          </div>
          {lowStock.length ? (
            <div className="a-table-wrap">
              <table className="a-table">
                <thead>
                  <tr>
                    {t.dash.lowHead.map((h, i) => (
                      <th key={h} className={i === 2 || i === 3 ? 'num' : undefined}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {lowStock.map((p) => (
                    <tr key={p._id}>
                      <td>{(lang === 'ar' ? p.name?.ar : p.name?.en) || p.name?.en || p.name?.ar}</td>
                      <td className="ltr">{p.sku}</td>
                      <td className="num">{n(p.stock)}</td>
                      <td className="num">{p.lowStockThreshold != null ? n(p.lowStockThreshold) : '—'}</td>
                      <td>{p.stock === 0 ? <Status value="failed" label={t.dash.outOfStock} /> : <Status value="pending" label={t.dash.low} />}</td>
                      <td>
                        {perms.has('products:read') ? (
                          <Link to={`/admin/products/${p._id}`} className="a-btn a-btn--ghost a-btn--sm">
                            {t.dash.editProduct}
                          </Link>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title={t.dash.lowEmpty} />
          )}
        </section>

        <section className="a-card" aria-labelledby="dash-delivery">
          <div className="a-card__head">
            <h2 id="dash-delivery">{t.dash.deliveryTitle}</h2>
          </div>
          <dl className="a-metrics">
            <div>
              <dt>
                {t.dash.deliveryShipped} <InfoTip text={t.dash.deliveryShippedTip} />
              </dt>
              <dd>{period ? n(period.shipped + period.delivered) : '—'}</dd>
            </div>
            <div>
              <dt>{t.dash.deliveryTransit}</dt>
              <dd>{now ? n(now.shipped) : '—'}</dd>
            </div>
            <div>
              <dt>{t.dash.deliveryDelivered}</dt>
              <dd>{period ? n(period.delivered) : '—'}</dd>
            </div>
            <div>
              <dt>{t.dash.deliveryCod}</dt>
              <dd>{cod ? sar(cod.amount) : '—'}</dd>
            </div>
            {[t.dash.deliveryOut, t.dash.deliveryDelayed, t.dash.deliveryFailed, t.dash.deliveryAvg].map((label) => (
              <div key={label} className="is-untracked">
                <dt>{label}</dt>
                <dd>{t.common.notTracked}</dd>
              </div>
            ))}
          </dl>
          <p className="a-footnote">{t.dash.deliveryManual}</p>
        </section>
      </div>
    </>
  );
}
