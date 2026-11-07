/**
 * Return eligibility and amounts — pure rules (unit tested), applied by the return service.
 * All amounts in halalas.
 */
import { RETURN_ACTIVE_STATUSES, RETURN_TRANSITIONS, type ReturnStatus } from '../../models/ReturnRequest';

const DAY_MS = 24 * 3600 * 1000;

export type OrderLine = { product: unknown; sku: string; name: { ar?: string | null; en?: string | null }; image?: string | null; unitPrice: number; quantity: number; lineTotal: number; discount?: number | null };
export type ExistingReturn = { status: string; items: { product: unknown; quantity: number }[] };

export type Ineligible = 'disabled' | 'not_delivered' | 'window_closed' | 'nothing_left';

export type ReturnableLine = {
  productId: string;
  sku: string;
  name: { ar: string; en: string };
  image: string;
  ordered: number;
  /** Units that can still be returned (ordered minus units in active return requests). */
  returnable: number;
};

export type Eligibility = { eligible: boolean; reason: Ineligible | ''; deadline: Date | null; lines: ReturnableLine[] };

export function canTransition(from: ReturnStatus, to: ReturnStatus) {
  return RETURN_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Last moment a return can be requested: `windowDays` full days after delivery. */
export function returnDeadline(deliveredAt: Date | null | undefined, windowDays: number): Date | null {
  if (!deliveredAt) return null;
  return new Date(new Date(deliveredAt).getTime() + windowDays * DAY_MS);
}

/** Units per product still available for a return request. */
export function returnableLines(items: OrderLine[], existing: ExistingReturn[]): ReturnableLine[] {
  const taken = new Map<string, number>();
  for (const r of existing) {
    if (!RETURN_ACTIVE_STATUSES.includes(r.status as ReturnStatus)) continue;
    for (const it of r.items) taken.set(String(it.product), (taken.get(String(it.product)) ?? 0) + it.quantity);
  }
  return items.map((it) => {
    const id = String(it.product);
    return {
      productId: id,
      sku: it.sku,
      name: { ar: it.name?.ar ?? '', en: it.name?.en ?? '' },
      image: it.image ?? '',
      ordered: it.quantity,
      returnable: Math.max(0, it.quantity - (taken.get(id) ?? 0)),
    };
  });
}

export function eligibility(
  order: { status: string; delivery?: { deliveredAt?: Date | null } | null; items: OrderLine[] },
  settings: { returnsEnabled?: boolean | null; returnWindowDays?: number | null },
  existing: ExistingReturn[],
  now = new Date(),
): Eligibility {
  const lines = returnableLines(order.items, existing);
  const deadline = returnDeadline(order.delivery?.deliveredAt, settings.returnWindowDays ?? 7);
  const no = (reason: Ineligible): Eligibility => ({ eligible: false, reason, deadline, lines });
  if (settings.returnsEnabled === false) return no('disabled');
  if (order.status !== 'delivered' || !deadline) return no('not_delivered');
  if (now > deadline) return no('window_closed');
  if (!lines.some((l) => l.returnable > 0)) return no('nothing_left');
  return { eligible: true, reason: '', deadline, lines };
}

/**
 * What the customer paid for `quantity` units of a line, after the line's share of the order
 * discount. Rounded down so the sum over partial returns never exceeds what was paid.
 */
export function unitsAmount(line: Pick<OrderLine, 'lineTotal' | 'discount' | 'quantity'>, quantity: number): number {
  const paid = Math.max(0, line.lineTotal - (line.discount ?? 0));
  if (quantity >= line.quantity) return paid;
  return Math.floor((paid * quantity) / line.quantity);
}
