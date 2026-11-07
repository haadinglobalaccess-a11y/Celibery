import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useI18n } from '../i18n/I18n';
import { get, post, qs } from '../lib/api';
import { formatDate, formatPrice, L } from '../lib/format';
import type { Localized } from '../lib/types';
import { useToast } from '../state/toast';

type Line = { productId: string; sku: string; name: Localized; image: string; ordered: number; returnable: number };
type CustomerReturn = {
  returnNumber: string;
  status: string;
  reason: string;
  items: { sku: string; name: Localized; quantity: number; amount: number }[];
  requestedAmount: number;
  refund: { amount: number; status: string } | null;
  decisionNote: string;
  createdAt: string;
};
type Options = { eligible: boolean; reason: string; deadline: string | null; windowDays: number; lines: Line[]; returns: CustomerReturn[] };

const REASONS = ['defective', 'wrong_item', 'not_as_described', 'damaged_in_delivery', 'changed_mind', 'other'];

/**
 * Return requests on the customer's order page (signed-in owner, or a guest with the order's
 * access token). The server decides eligibility (delivery, return window, remaining units).
 */
export function OrderReturns({ orderNumber, token }: { orderNumber: string; token?: string | null }) {
  const { t, lang } = useI18n();
  const r = t.returns;
  const toast = useToast();
  const [data, setData] = useState<Options | null>(null);
  const [open, setOpen] = useState(false);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(() => {
    get<Options>(`/api/orders/${orderNumber}/returns${qs({ token: token || undefined })}`)
      .then(setData)
      .catch(() => setData(null));
  }, [orderNumber, token]);
  useEffect(load, [load]);

  if (!data || (!data.eligible && !data.returns.length && data.reason !== 'window_closed')) return null;

  const chosen = Object.entries(qty).filter(([, n]) => n > 0);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      await post(`/api/orders/${orderNumber}/returns`, { token: token || undefined, items: chosen.map(([productId, quantity]) => ({ productId, quantity })), reason, details });
      toast(r.submitted);
      setOpen(false);
      setQty({});
      setReason('');
      setDetails('');
      load();
    } catch (ex) {
      setErr((ex as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const cancel = async (returnNumber: string) => {
    if (!window.confirm(r.cancelConfirm)) return;
    try {
      await post(`/api/orders/${orderNumber}/returns/${returnNumber}/cancel`, { token: token || undefined });
      load();
    } catch (ex) {
      toast((ex as Error).message, 'error');
    }
  };

  return (
    <section className="panel" style={{ marginTop: 24 }} data-testid="order-returns">
      <h3 style={{ marginTop: 0 }}>{r.title}</h3>
      {data.returns.map((x) => (
        <div key={x.returnNumber} className="sum-row" data-testid="customer-return" style={{ alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
          <div>
            <strong className="ltr">{x.returnNumber}</strong> · <span className="badge">{r.status[x.status] ?? x.status}</span>
            <div className="muted" style={{ fontSize: 13 }}>
              {x.items.map((i) => `${i.quantity} × ${L(i.name, lang)}`).join(' · ')} · {formatDate(x.createdAt, lang)}
            </div>
            {x.status === 'rejected' && x.decisionNote ? <div style={{ fontSize: 13 }}>{r.reasonNote(x.decisionNote)}</div> : null}
            {x.refund?.amount && x.status === 'refunded' ? <div style={{ fontSize: 13 }}>{r.refund(formatPrice(x.refund.amount, lang))}</div> : null}
          </div>
          {['requested', 'approved'].includes(x.status) ? (
            <button type="button" className="link-btn" onClick={() => void cancel(x.returnNumber)}>
              {r.cancel}
            </button>
          ) : null}
        </div>
      ))}

      {data.eligible ? (
        <>
          {data.deadline ? <p className="muted" style={{ fontSize: 13 }}>{r.window(formatDate(data.deadline, lang))}</p> : null}
          {!open ? (
            <button type="button" className="btn btn--outline" onClick={() => setOpen(true)} data-testid="request-return">
              {r.request}
            </button>
          ) : (
            <form className="form-grid" onSubmit={submit}>
              <fieldset style={{ border: 0, padding: 0 }}>
                <legend className="label">{r.chooseItems}</legend>
                {data.lines
                  .filter((l) => l.returnable > 0)
                  .map((l) => (
                    <label key={l.productId} className="sum-row" style={{ gap: 12 }}>
                      <span>
                        {L(l.name, lang)} <span className="muted ltr">({l.sku})</span>
                      </span>
                      <select className="select" style={{ width: 90 }} value={qty[l.productId] ?? 0} onChange={(e) => setQty({ ...qty, [l.productId]: Number(e.target.value) })} aria-label={L(l.name, lang)}>
                        {Array.from({ length: l.returnable + 1 }, (_, n) => (
                          <option key={n} value={n}>
                            {n}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
              </fieldset>
              <label className="field">
                <span className="label">{r.reason}</span>
                <select className="select" required value={reason} onChange={(e) => setReason(e.target.value)}>
                  <option value="" disabled>
                    —
                  </option>
                  {REASONS.map((k) => (
                    <option key={k} value={k}>
                      {r.reasons[k]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="label">{r.details}</span>
                <textarea className="input" rows={3} maxLength={1000} value={details} onChange={(e) => setDetails(e.target.value)} />
              </label>
              {err ? <p className="alert alert--error">{err}</p> : null}
              <button className="btn btn--primary" disabled={busy || !chosen.length || !reason}>
                {r.submit}
              </button>
            </form>
          )}
        </>
      ) : (
        <p className="muted" style={{ fontSize: 13 }}>{data.reason === 'window_closed' ? r.closed : data.reason === 'disabled' ? r.unavailable : data.reason === 'nothing_left' ? r.allRequested : ''}</p>
      )}
    </section>
  );
}
