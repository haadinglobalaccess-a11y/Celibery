import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiError, get, qs } from '../lib/api';
import type { Localized } from '../lib/types';
import { useAuth } from '../state/auth';

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

const STATUS_COLORS: Record<string, string> = {
  pending: 'badge--warning',
  confirmed: 'badge--dark',
  processing: 'badge--dark',
  shipped: 'badge',
  delivered: 'badge--success',
  cancelled: 'badge--danger',
  returned: 'badge--danger',
  paid: 'badge--success',
  failed: 'badge--danger',
  expired: 'badge--danger',
  refunded: 'badge--danger',
  partially_refunded: 'badge--warning',
  cod_pending: 'badge--warning',
  cod_collected: 'badge--success',
  active: 'badge--success',
  draft: 'badge--warning',
  archived: 'badge',
  skipped: 'badge--warning',
  sent: 'badge--success',
};
export function Status({ value }: { value: string }) {
  return <span className={`badge ${STATUS_COLORS[value] ?? ''}`}>{value.replace(/_/g, ' ')}</span>;
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
