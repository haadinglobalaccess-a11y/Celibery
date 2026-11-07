import { useEffect, useState } from 'react';
import { api, qs } from '../lib/api';

/**
 * Small read cache for admin reference data (spec §24 "cache non-sensitive reference data"):
 * identical GETs within 60 s share one request. Every figure still comes from the existing API —
 * nothing is computed from guesses.
 */
const TTL = 60_000;
const cache = new Map<string, { at: number; p: Promise<{ data: unknown; meta?: Record<string, unknown> }> }>();

export function cachedApi<T>(path: string): Promise<{ data: T; meta?: Record<string, unknown> }> {
  const hit = cache.get(path);
  if (hit && Date.now() - hit.at < TTL) return hit.p as Promise<{ data: T; meta?: Record<string, unknown> }>;
  const p = api<T>(path).catch((e) => {
    cache.delete(path);
    throw e;
  });
  cache.set(path, { at: Date.now(), p: p as Promise<{ data: unknown; meta?: Record<string, unknown> }> });
  return p;
}

/** Drop cached admin reads (after an order changes status, so counts refresh). */
export function invalidateAdminCache() {
  cache.clear();
}

/** Number of orders matching a filter — the list endpoint's total, without loading the orders. */
export async function countOrders(params: Record<string, string | undefined>) {
  const r = await cachedApi<unknown[]>(`/api/admin/orders${qs({ ...params, limit: 1 })}`);
  return Number(r.meta?.total ?? 0);
}

export async function countLowStock() {
  const r = await cachedApi<unknown[]>(`/api/admin/inventory${qs({ lowStock: '1', limit: 1 })}`);
  return Number(r.meta?.total ?? 0);
}

/**
 * COD amount awaiting collection: every order still `cod_pending`, excluding cancelled and returned
 * orders (cancelling a COD order leaves its payment status untouched).
 */
export async function codPending(): Promise<{ amount: number; orders: number }> {
  let page = 1;
  let amount = 0;
  let orders = 0;
  for (;;) {
    const r = await cachedApi<{ total: number; status: string }[]>(`/api/admin/orders${qs({ paymentStatus: 'cod_pending', limit: 100, page })}`);
    for (const o of r.data) {
      if (o.status === 'cancelled' || o.status === 'returned') continue;
      amount += o.total;
      orders += 1;
    }
    const pages = Number(r.meta?.pages ?? 1);
    if (page >= pages || page >= 20) break;
    page += 1;
  }
  return { amount, orders };
}

export type PeriodOrder = { total: number; status: string; paymentStatus: string; createdAt: string };

/**
 * Every order created between two instants, read through the existing order list (100 per page,
 * newest first). Capped at 30 pages; `truncated` says when the cap was reached so the dashboard can
 * say its figures are partial instead of silently under-reporting.
 */
export async function ordersBetween(from: string, to: string): Promise<{ rows: PeriodOrder[]; truncated: boolean }> {
  const rows: PeriodOrder[] = [];
  let page = 1;
  for (;;) {
    const r = await cachedApi<PeriodOrder[]>(`/api/admin/orders${qs({ from, to, limit: 100, page })}`);
    rows.push(...r.data);
    const pages = Number(r.meta?.pages ?? 1);
    if (page >= pages) return { rows, truncated: false };
    if (page >= 30) return { rows, truncated: true };
    page += 1;
  }
}

/** The server's revenue rule (reports.service revenueMatch): not cancelled/returned, and paid or COD. */
export const countsAsRevenue = (o: { status: string; paymentStatus: string }) =>
  !['cancelled', 'returned'].includes(o.status) && ['paid', 'partially_refunded', 'cod_pending', 'cod_collected'].includes(o.paymentStatus);

const riyadhDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' });
/** Calendar day (YYYY-MM-DD) of an instant in Riyadh time. */
export const dayKey = (iso: string) => riyadhDay.format(new Date(iso));

export type Attention ={ pending: number | null; lowStock: number | null; review: number | null };

/** Counts that drive sidebar badges and the notifications panel. Each is fetched only with the matching permission. */
export function useAttention(perms: Set<string>, refreshKey: string): Attention {
  const [state, setState] = useState<Attention>({ pending: null, lowStock: null, review: null });
  const canOrders = perms.has('orders:read');
  const canInventory = perms.has('inventory:read');
  const canOverview = perms.has('overview:read');
  useEffect(() => {
    let alive = true;
    void Promise.all([
      canOrders ? countOrders({ status: 'pending' }).catch(() => null) : Promise.resolve(null),
      canInventory ? countLowStock().catch(() => null) : Promise.resolve(null),
      canOverview
        ? cachedApi<{ paymentReviewCount: number }>('/api/admin/overview')
            .then((r) => r.data.paymentReviewCount)
            .catch(() => null)
        : Promise.resolve(null),
    ]).then(([pending, lowStock, review]) => alive && setState({ pending, lowStock, review }));
    return () => {
      alive = false;
    };
  }, [canOrders, canInventory, canOverview, refreshKey]);
  return state;
}
