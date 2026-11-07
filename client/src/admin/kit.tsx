import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiError, get, qs } from '../lib/api';
import type { Localized } from '../lib/types';
import { useAuth } from '../state/auth';
import { useAT } from './i18n';

export const sar = (halalas: number | undefined | null) =>
  halalas == null ? '—' : `SAR ${(halalas / 100).toLocaleString('en-SA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const dt = (iso?: string | Date) => (iso ? new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
export const en = (l?: Localized | null) => l?.en || l?.ar || '';

export function AHead({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="a-head">
      <h1>{title}</h1>
      <div className="actions">{children}</div>
    </div>
  );
}

export function Card({ title, children, actions }: { title?: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="a-card">
      {title || actions ? (
        <div className="a-head" style={{ marginBottom: 12 }}>
          {title ? <h2 style={{ margin: 0 }}>{title}</h2> : <span />}
          {actions}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function F({ label, children, hint, span }: { label: string; children: ReactNode; hint?: string; span?: boolean }) {
  return (
    <label className={`field ${span ? 'span-2' : ''}`}>
      <span className="label">{label}</span>
      {children}
      {hint ? <span className="hint">{hint}</span> : null}
    </label>
  );
}

/** Arabic and English side by side — both are independent content (never auto-translated). */
export function LocInput({ label, value, onChange, textarea = false, required = false }: { label: string; value: Localized | undefined; onChange: (v: Localized) => void; textarea?: boolean; required?: boolean }) {
  const v = value ?? { ar: '', en: '' };
  const Tag = textarea ? 'textarea' : 'input';
  return (
    <div className="field span-2">
      <span className="label">
        {label}
        {required ? ' *' : ''}
      </span>
      <div className="loc-pair">
        <label>
          <span className="tag">العربية</span>
          <Tag className={textarea ? 'textarea' : 'input'} dir="rtl" lang="ar" value={v.ar} required={required} onChange={(e) => onChange({ ...v, ar: e.target.value })} rows={textarea ? 5 : undefined} />
        </label>
        <label>
          <span className="tag">ENGLISH</span>
          <Tag className={textarea ? 'textarea' : 'input'} dir="ltr" lang="en" value={v.en} required={required} onChange={(e) => onChange({ ...v, en: e.target.value })} rows={textarea ? 5 : undefined} />
        </label>
      </div>
    </div>
  );
}

export function Modal({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <>
      <div className="overlay" onClick={onClose} />
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal__box" style={wide ? { width: 'min(900px, 100%)' } : undefined}>
          <div className="a-head">
            <h2 style={{ margin: 0 }}>{title}</h2>
            <button className="icon-btn" onClick={onClose} aria-label="Close">
              ✕
            </button>
          </div>
          {children}
        </div>
      </div>
    </>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: [T, string][]; value: T; onChange: (t: T) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map(([k, label]) => (
        <button key={k} role="tab" aria-selected={value === k} onClick={() => onChange(k)} type="button">
          {label}
        </button>
      ))}
    </div>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  const e = error as ApiError;
  const details = e.details as { fieldErrors?: Record<string, string[]>; formErrors?: string[] } | undefined;
  return (
    <div className="alert alert--error" role="alert" style={{ marginBottom: 12 }}>
      <strong>{e.message}</strong>
      {details?.fieldErrors ? (
        <ul style={{ margin: '6px 0 0', paddingInlineStart: 18 }}>
          {Object.entries(details.fieldErrors).map(([k, v]) => (
            <li key={k}>
              {k}: {v.join(', ')}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function Pager({ page, pages, onPage }: { page: number; pages: number; onPage: (p: number) => void }) {
  if (pages <= 1) return null;
  return (
    <div className="pager" style={{ marginTop: 16 }}>
      <button className="btn btn--outline btn--sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        Previous
      </button>
      <span className="muted">
        Page {page} of {pages}
      </span>
      <button className="btn btn--outline btn--sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>
        Next
      </button>
    </div>
  );
}

/**
 * Status badge (spec §5): every status is text + an icon or dot — colour is never the only signal.
 * Order/payment statuses use the spec palette (`.st--<status>` in admin.css); other values
 * (product, notification…) fall back to a neutral, positive, warning or negative tone.
 */
const TONE: Record<string, string> = {
  active: 'positive',
  sent: 'positive',
  succeeded: 'positive',
  draft: 'warning',
  skipped: 'warning',
  archived: 'neutral',
  expired: 'negative',
  partially_refunded: 'warning',
};
const ICON: Record<string, string> = { delivered: '✓', paid: '✓', cod_collected: '✓', succeeded: '✓', returned: '↩', failed: '!', expired: '!' };
export function Status({ value, label }: { value: string; label?: string }) {
  const { t } = useAT();
  const text = label ?? t.status[value] ?? value.replace(/_/g, ' ');
  const icon = ICON[value];
  return (
    <span className={`st st--${TONE[value] ?? value}`}>
      {icon ? (
        <span className="st__icon" aria-hidden="true">
          {icon}
        </span>
      ) : (
        <span className="st__dot" aria-hidden="true" />
      )}
      {text}
    </span>
  );
}

/** Static skeleton blocks (no shimmer — the dashboard has no motion). */
export function Skeleton({ h = 14, w = '100%', r = 6 }: { h?: number; w?: number | string; r?: number }) {
  return <span className="a-skel" style={{ height: h, width: w, borderRadius: r }} aria-hidden="true" />;
}
export function SkeletonKpis({ count = 5 }: { count?: number }) {
  return (
    <div className="a-kpis" aria-busy="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="a-kpi">
          <Skeleton w="55%" h={12} />
          <Skeleton w="70%" h={28} />
          <Skeleton w="45%" h={12} />
        </div>
      ))}
    </div>
  );
}
export function SkeletonTable({ rows = 6, cols = 6 }: { rows?: number; cols?: number }) {
  return (
    <div className="a-skel-table" aria-busy="true">
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="a-skel-row" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
          {Array.from({ length: cols }, (_, c) => (
            <Skeleton key={c} w={c === 0 ? '70%' : '55%'} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ title, text, action }: { title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="a-empty">
      <strong>{title}</strong>
      {text ? <span>{text}</span> : null}
      {action}
    </div>
  );
}

/** Error panel with retry (spec §21). */
export function ErrorPanel({ onRetry, message }: { onRetry?: () => void; message?: string }) {
  const { t } = useAT();
  return (
    <div className="a-error" role="alert">
      <strong>{t.common.errorTitle}</strong>
      <span>{message || t.common.errorText}</span>
      {onRetry ? (
        <button type="button" className="a-btn a-btn--secondary" onClick={onRetry}>
          {t.common.retry}
        </button>
      ) : null}
    </div>
  );
}

/** Small "i" with an accessible explanation (tooltip on hover/focus). */
export function InfoTip({ text }: { text: string }) {
  return (
    <span className="a-tip" tabIndex={0} role="img" aria-label={text}>
      i<span className="a-tip__bubble" role="tooltip">{text}</span>
    </span>
  );
}

/** Static mini trend line for KPI cards. */
export function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const w = 96;
  const h = 28;
  const max = Math.max(1, ...values);
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * w).toFixed(1)},${(h - (v / max) * (h - 2) - 1).toFixed(1)}`).join(' ');
  return (
    <svg className="a-spark" viewBox={`0 0 ${w} ${h}`} width={w} height={h} aria-hidden="true" preserveAspectRatio="none">
      <polyline points={pts} fill="none" />
    </svg>
  );
}

export type KpiTrend = { pct: number | null; label: string } | null;

export function KpiCard({ label, value, tip, trend, spark, note, tone }: { label: string; value: ReactNode; tip: string; trend?: KpiTrend; spark?: number[]; note?: string; tone?: 'attention' }) {
  const up = trend?.pct != null && trend.pct > 0;
  const down = trend?.pct != null && trend.pct < 0;
  return (
    <article className={`a-kpi ${tone === 'attention' ? 'a-kpi--attention' : ''}`}>
      <div className="a-kpi__label">
        <span>{label}</span>
        <InfoTip text={tip} />
      </div>
      <strong className="a-kpi__value">{value}</strong>
      <div className="a-kpi__foot">
        {trend ? (
          <span className="a-kpi__trend">
            {trend.pct != null ? (
              <span className={`a-trend ${up ? 'a-trend--up' : down ? 'a-trend--down' : ''}`}>
                <span aria-hidden="true">{up ? '▲' : down ? '▼' : '•'}</span> {`${up ? '+' : ''}${trend.pct.toFixed(1)}%`}
              </span>
            ) : null}{' '}
            <span className="a-muted">{trend.label}</span>
          </span>
        ) : note ? (
          <span className="a-muted">{note}</span>
        ) : null}
        {spark ? <Sparkline values={spark} /> : null}
      </div>
    </article>
  );
}

/** Area chart: dates on X, order count on Y, light gridlines, tooltip with date, orders and revenue. */
export function OrdersAreaChart({ data, fmtDate, fmtMoney, labels }: { data: { date: string; orders: number; revenue: number }[]; fmtDate: (d: string) => string; fmtMoney: (h: number) => string; labels: { orders: string; revenue: string } }) {
  const [hover, setHover] = useState<number | null>(null);
  const w = 720;
  const h = 220;
  const pad = { l: 36, r: 12, t: 12, b: 28 };
  const iw = w - pad.l - pad.r;
  const ih = h - pad.t - pad.b;
  const max = Math.max(4, ...data.map((d) => d.orders));
  const step = Math.ceil(max / 4);
  const top = step * 4;
  const x = (i: number) => pad.l + (data.length < 2 ? iw / 2 : (i / (data.length - 1)) * iw);
  const y = (v: number) => pad.t + ih - (v / top) * ih;
  const line = data.map((d, i) => `${x(i).toFixed(1)},${y(d.orders).toFixed(1)}`).join(' ');
  const area = `${pad.l},${pad.t + ih} ${line} ${x(data.length - 1).toFixed(1)},${pad.t + ih}`;
  const every = Math.max(1, Math.ceil(data.length / 7));
  const hv = hover != null ? data[hover] : null;
  return (
    // Time runs left-to-right in both languages, as on financial charts.
    <div className="a-chart" dir="ltr">
      <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`${labels.orders}: ${data.map((d) => `${fmtDate(d.date)} ${d.orders}`).join(', ')}`} onMouseLeave={() => setHover(null)}>
        {[0, 1, 2, 3, 4].map((k) => (
          <g key={k}>
            <line className="a-chart__grid" x1={pad.l} x2={w - pad.r} y1={y(step * k)} y2={y(step * k)} />
            <text className="a-chart__axis" x={pad.l - 8} y={y(step * k) + 4} textAnchor="end">
              {step * k}
            </text>
          </g>
        ))}
        <polygon className="a-chart__area" points={area} />
        <polyline className="a-chart__line" points={line} />
        {data.map((d, i) => (
          <g key={d.date}>
            {i % every === 0 || i === data.length - 1 ? (
              <text className="a-chart__axis" x={x(i)} y={h - 8} textAnchor="middle">
                {fmtDate(d.date)}
              </text>
            ) : null}
            <rect
              x={x(i) - iw / Math.max(1, data.length) / 2}
              y={pad.t}
              width={iw / Math.max(1, data.length)}
              height={ih}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
              onFocus={() => setHover(i)}
              tabIndex={-1}
            />
          </g>
        ))}
        {hv && hover != null ? (
          <g>
            <line className="a-chart__cursor" x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + ih} />
            <circle className="a-chart__dot" cx={x(hover)} cy={y(hv.orders)} r={4} />
          </g>
        ) : null}
      </svg>
      {hv && hover != null ? (
        <div className="a-chart__tip" style={{ left: `${(x(hover) / w) * 100}%` }}>
          <strong>{fmtDate(hv.date)}</strong>
          <span>
            {labels.orders}: {hv.orders}
          </span>
          <span>
            {labels.revenue}: {fmtMoney(hv.revenue)}
          </span>
        </div>
      ) : null}
    </div>
  );
}

type MiniProduct = { _id: string; sku: string; name: Localized; images?: { url: string }[]; status?: string };

/** Searchable product multi-select used for collections, bundles, related products, discounts. */
export function ProductPicker({ value, onChange, label = 'Products' }: { value: string[]; onChange: (ids: string[]) => void; label?: string }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<MiniProduct[]>([]);
  const [selected, setSelected] = useState<MiniProduct[]>([]);
  useEffect(() => {
    if (!value.length) {
      setSelected([]);
      return;
    }
    get<MiniProduct[]>(`/api/admin/products${qs({ limit: 200 })}`)
      .then((all) => setSelected(value.map((id) => all.find((p) => p._id === id)).filter(Boolean) as MiniProduct[]))
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.join(',')]);
  useEffect(() => {
    const t = setTimeout(() => {
      get<MiniProduct[]>(`/api/admin/products${qs({ q, limit: 20 })}`)
        .then(setResults)
        .catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div className="field span-2">
      <span className="label">{label}</span>
      <div className="picker">
        {selected.map((p, i) => (
          <div key={p._id} className="picker__row">
            <span>
              {i + 1}. <span className="ltr">{p.sku}</span> — {en(p.name)}
            </span>
            <span className="actions">
              <button type="button" className="btn btn--ghost btn--sm" disabled={i === 0} onClick={() => onChange(arrayMove(value, i, i - 1))}>
                ↑
              </button>
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => onChange(value.filter((x) => x !== p._id))}>
                Remove
              </button>
            </span>
          </div>
        ))}
        <input className="input" style={{ marginTop: 8 }} placeholder="Search products by name or SKU to add…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="picker__list">
          {results
            .filter((r) => !value.includes(r._id))
            .map((r) => (
              <div key={r._id} className="picker__row">
                <span>
                  <span className="ltr">{r.sku}</span> — {en(r.name)} {r.status !== 'active' ? <Status value={r.status ?? ''} /> : null}
                </span>
                <button type="button" className="btn btn--outline btn--sm" onClick={() => onChange([...value, r._id])}>
                  Add
                </button>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}

function arrayMove<T>(arr: T[], from: number, to: number) {
  const a = [...arr];
  const [x] = a.splice(from, 1);
  a.splice(to, 0, x);
  return a;
}

export function BarChart({ data, value, label }: { data: { date: string; [k: string]: number | string }[]; value: string; label: (n: number) => string }) {
  const w = 760;
  const h = 200;
  const max = Math.max(1, ...data.map((d) => Number(d[value])));
  const bw = w / Math.max(1, data.length);
  return (
    <svg className="chart" viewBox={`0 0 ${w} ${h + 24}`} role="img" aria-label={`Chart of ${value}`}>
      {data.map((d, i) => {
        const v = Number(d[value]);
        const bh = (v / max) * h;
        return (
          <g key={d.date}>
            <rect className="bar" x={i * bw + 2} y={h - bh} width={Math.max(1, bw - 4)} height={bh} rx={2}>
              <title>{`${d.date}: ${label(v)}`}</title>
            </rect>
            {i % Math.ceil(data.length / 8) === 0 ? (
              <text x={i * bw + bw / 2} y={h + 16} textAnchor="middle">
                {d.date.slice(5)}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

/** Converts halalas to SAR for form inputs and back. */
export const toSarInput = (h?: number | null) => (h == null ? '' : String(h / 100));
export const fromSarInput = (s: string) => (s.trim() === '' ? null : Number(s));

/** Permissions of the signed-in staff member. The server enforces them; the UI only hides what would be refused. */
export function usePerms(): Set<string> {
  const { user } = useAuth();
  return useMemo(() => new Set(user?.role?.permissions ?? []), [user]);
}
