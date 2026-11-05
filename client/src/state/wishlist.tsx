import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { del, get, post } from '../lib/api';
import type { ProductCardData } from '../lib/types';
import { useAuth } from './auth';

/** Guests keep a local wishlist; on sign-in it is merged into the account wishlist. */
type Ctx = { ids: Set<string>; toggle: (id: string) => Promise<void>; has: (id: string) => boolean };
const WishCtx = createContext<Ctx | null>(null);
const KEY = 'cel_wishlist_v1';

const loadLocal = (): string[] => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
};
const saveLocal = (ids: string[]) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(ids));
  } catch {
    /* ignore */
  }
};

export function WishlistProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [ids, setIds] = useState<string[]>(loadLocal);
  const isCustomer = user?.type === 'customer';

  useEffect(() => {
    if (!isCustomer) {
      setIds(loadLocal());
      return;
    }
    const local = loadLocal();
    const sync = local.length ? post<ProductCardData[]>('/api/me/wishlist', { productIds: local }) : get<ProductCardData[]>('/api/me/wishlist');
    sync
      .then((list) => {
        setIds(list.map((p) => p._id));
        saveLocal([]);
      })
      .catch(() => undefined);
  }, [isCustomer]);

  const toggle = useCallback(
    async (id: string) => {
      const has = ids.includes(id);
      if (isCustomer) {
        const list = has ? await del<ProductCardData[]>(`/api/me/wishlist/${id}`) : await post<ProductCardData[]>('/api/me/wishlist', { productIds: [id] });
        setIds(list.map((p) => p._id));
      } else {
        const next = has ? ids.filter((x) => x !== id) : [...ids, id];
        setIds(next);
        saveLocal(next);
      }
    },
    [ids, isCustomer],
  );

  const value = useMemo(() => {
    const set = new Set(ids);
    return { ids: set, toggle, has: (id: string) => set.has(id) };
  }, [ids, toggle]);
  return <WishCtx.Provider value={value}>{children}</WishCtx.Provider>;
}

export function useWishlist() {
  const c = useContext(WishCtx);
  if (!c) throw new Error('useWishlist outside WishlistProvider');
  return c;
}
