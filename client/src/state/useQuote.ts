import { useEffect, useState } from 'react';
import { post } from '../lib/api';
import type { Quote } from '../lib/types';
import { useCart } from './cart';

/** Server-authoritative cart pricing; re-quotes whenever the cart, code or method changes. */
export function useQuote(paymentMethod?: string, email?: string, city?: string) {
  const { items, discountCode } = useCart();
  const [quote, setQuote] = useState<Quote | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = JSON.stringify(items.map((i) => [i.productId, i.quantity])) + discountCode + (paymentMethod ?? '') + (email ?? '') + '|' + (city ?? '').trim();

  useEffect(() => {
    if (!items.length) {
      setQuote(null);
      setLoading(false);
      setError(null);
      return;
    }
    let alive = true;
    setLoading(true);
    const t = setTimeout(() => {
      post<Quote>('/api/cart/quote', {
        items: items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
        discountCode: discountCode || undefined,
        paymentMethod: paymentMethod || undefined,
        email: email && /.+@.+\..+/.test(email) ? email : undefined,
        // Lets the server apply cash-on-delivery city rules before the order is placed.
        city: city && city.trim().length >= 2 ? city.trim() : undefined,
      })
        .then((q) => alive && (setQuote(q), setError(null)))
        .catch((e) => { if (alive) { setQuote(null); setError((e as Error).message); } })
        .finally(() => alive && setLoading(false));
    }, 150);
    return () => {
      alive = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { quote, loading, error };
}
