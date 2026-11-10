import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Localized, ProductCardData } from '../lib/types';

/**
 * The cart lives in the browser (localStorage) and survives language switches and reloads.
 * It stores product ids, quantities and a display snapshot only — prices and stock are
 * always re-quoted by the server (/api/cart/quote) before anything is charged.
 */
export type CartItem = {
  productId: string;
  quantity: number;
  snapshot: { slug: string; name: Localized; image: string; price: number; model?: string };
};

type CartCtx = {
  items: CartItem[];
  count: number;
  add: (p: ProductCardData, qty?: number) => void;
  setQty: (productId: string, qty: number) => void;
  remove: (productId: string) => void;
  clear: () => void;
  /** Puts saved checkout items back (resume checkout). Items already in the bag are kept. */
  restore: (items: CartItem[]) => void;
  discountCode: string;
  setDiscountCode: (c: string) => void;
  /** Last product added — drives the animated "added to cart" panel under the header. */
  peek: { item: CartItem; added: number; key: number } | null;
  closePeek: () => void;
};

const KEY = 'cel_cart_v1';
const Ctx = createContext<CartCtx | null>(null);

function load(): CartItem[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((i) => i && /^[a-f0-9]{24}$/i.test(i.productId) && Number.isInteger(i.quantity) && i.quantity > 0
      && i.snapshot && typeof i.snapshot.slug === 'string' && typeof i.snapshot.image === 'string'
      && typeof i.snapshot.name?.en === 'string' && typeof i.snapshot.name?.ar === 'string'
      && Number.isSafeInteger(i.snapshot.price) && i.snapshot.price >= 0)
      .slice(0, 50).map((i) => ({ ...i, quantity: Math.min(99, i.quantity) }));
  } catch {
    return [];
  }
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>(load);
  const [discountCode, setDiscountCode] = useState(() => {
    try {
      return localStorage.getItem(KEY + '_code') ?? '';
    } catch {
      return '';
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(items));
      localStorage.setItem(KEY + '_code', discountCode);
    } catch {
      /* storage unavailable: cart stays in memory */
    }
  }, [items, discountCode]);

  // Keep tabs in sync.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY) setItems(load());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const [peek, setPeek] = useState<CartCtx['peek']>(null);
  const closePeek = useCallback(() => setPeek(null), []);
  const add = useCallback((p: ProductCardData, qty = 1) => {
    if (!Number.isInteger(qty) || qty < 1) return;
    qty = Math.min(99, qty);
    setPeek({ item: { productId: p._id, quantity: qty, snapshot: { slug: p.slug, name: p.name, image: p.images?.[0]?.url ?? '', price: p.price, model: p.model } }, added: qty, key: Date.now() });
    setItems((cur) => {
      const existing = cur.find((i) => i.productId === p._id);
      if (existing) return cur.map((i) => (i.productId === p._id ? { ...i, quantity: Math.min(99, i.quantity + qty) } : i));
      return [...cur, { productId: p._id, quantity: qty, snapshot: { slug: p.slug, name: p.name, image: p.images?.[0]?.url ?? '', price: p.price, model: p.model } }];
    });
  }, []);
  const setQty = useCallback((productId: string, qty: number) => {
    if (!Number.isInteger(qty)) return;
    setItems((cur) => (qty <= 0 ? cur.filter((i) => i.productId !== productId) : cur.map((i) => (i.productId === productId ? { ...i, quantity: Math.min(99, qty) } : i))));
  }, []);
  const remove = useCallback((productId: string) => setItems((cur) => cur.filter((i) => i.productId !== productId)), []);
  const clear = useCallback(() => {
    setItems([]);
    setDiscountCode('');
  }, []);
  const restore = useCallback((saved: CartItem[]) => {
    setItems((cur) => {
      const have = new Set(cur.map((i) => i.productId));
      const add = saved.filter((i) => /^[a-f0-9]{24}$/i.test(i.productId) && Number.isInteger(i.quantity) && i.quantity > 0 && !have.has(i.productId));
      return [...cur, ...add.map((i) => ({ ...i, quantity: Math.min(99, i.quantity) }))].slice(0, 50);
    });
  }, []);

  const value = useMemo(
    () => ({ items, count: items.reduce((s, i) => s + i.quantity, 0), add, setQty, remove, clear, restore, discountCode, setDiscountCode, peek, closePeek }),
    [items, add, setQty, remove, clear, restore, discountCode, peek, closePeek],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCart() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useCart outside CartProvider');
  return c;
}
