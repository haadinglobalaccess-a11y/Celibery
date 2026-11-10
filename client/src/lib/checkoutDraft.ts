import { api, ApiError, apiUrl } from './api';
import type { Localized } from './types';

/**
 * Checkout progress autosave (Admin → Abandoned checkouts; "resume checkout" for the customer).
 *
 * - Debounced: one save ~1.2 s after typing stops, never more than one request at a time.
 * - Durable: every change is written to localStorage at once ("pending"), so closing the tab, a crash
 *   or the device shutting down before the save loses nothing — the next visit sends it.
 * - Offline: failed saves stay pending, retry with back-off and run as soon as the browser is online.
 * - Page close: the last changes are sent with fetch keepalive.
 * - One record per checkout: the browser creates the secret token before the first save and reuses
 *   it for every request, so even a lost response cannot create a second record.
 * Only contact, delivery, payment METHOD and cart are ever sent — the page has no card fields.
 */
export type DraftPayload = {
  items: { productId: string; quantity: number }[];
  contact: { name: string; email: string; phone: string };
  shippingAddress: { fullName: string; phone: string; city: string; district: string; street: string; buildingNumber: string; postalCode: string; shortAddress: string };
  paymentMethod: string;
  discountCode: string;
  lang: 'ar' | 'en';
};
export type SavedDraft = {
  contact: DraftPayload['contact'];
  shippingAddress: DraftPayload['shippingAddress'];
  paymentMethod: string;
  discountCode: string;
  items: { productId: string; slug: string; model: string; name: Localized; image: string; price: number; quantity: number }[];
  savedAt: string;
};
export type DraftStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'offline' | 'off';

const TOKEN_KEY = 'cel_checkout_draft';
const PENDING_KEY = 'cel_checkout_draft_pending';
const OPTOUT_KEY = 'cel_checkout_draft_optout';
const DEBOUNCE_MS = 1200;

const store = {
  get(k: string) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string) {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* storage unavailable: the in-memory flow still works */
    }
  },
  del(k: string) {
    try {
      localStorage.removeItem(k);
    } catch {
      /* ignore */
    }
  },
};

const TOKEN_RX = /^[A-Za-z0-9_-]{43}$/;
function newToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export const draftStore = {
  token(): string | null {
    const t = store.get(TOKEN_KEY);
    return t && TOKEN_RX.test(t) ? t : null;
  },
  ensureToken(): string {
    const t = draftStore.token() ?? newToken();
    store.set(TOKEN_KEY, t);
    return t;
  },
  pending(): DraftPayload | null {
    try {
      const raw = store.get(PENDING_KEY);
      return raw ? (JSON.parse(raw) as DraftPayload) : null;
    } catch {
      return null;
    }
  },
  optedOut: () => store.get(OPTOUT_KEY) === '1',
  /** After an order is placed: this checkout is finished. */
  finish() {
    store.del(TOKEN_KEY);
    store.del(PENDING_KEY);
  },
};

type Listener = (s: DraftStatus) => void;

class DraftSync {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private retryMs = 0;
  private inFlight = false;
  private again = false;
  private status: DraftStatus = 'idle';
  private listeners = new Set<Listener>();
  private started = false;

  private setStatus(s: DraftStatus) {
    this.status = s;
    this.listeners.forEach((l) => l(s));
  }
  subscribe(l: Listener) {
    this.listeners.add(l);
    l(this.status);
    return () => {
      this.listeners.delete(l);
    };
  }

  /** Wires online / page-hide handlers once. */
  start() {
    if (this.started || typeof window === 'undefined') return;
    this.started = true;
    window.addEventListener('online', () => void this.flush());
    const exit = () => this.flushOnExit();
    window.addEventListener('pagehide', exit);
    document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && exit());
  }

  /** Records the latest state locally at once and saves it to the server shortly after. */
  schedule(payload: DraftPayload) {
    if (draftStore.optedOut()) return;
    this.start();
    draftStore.ensureToken();
    store.set(PENDING_KEY, JSON.stringify(payload));
    this.setStatus('pending');
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), DEBOUNCE_MS);
  }

  async flush(): Promise<void> {
    clearTimeout(this.timer);
    if (this.inFlight) {
      this.again = true;
      return;
    }
    const payload = draftStore.pending();
    if (!payload || draftStore.optedOut()) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      this.setStatus('offline');
      return;
    }
    this.start();
    this.inFlight = true;
    this.setStatus('saving');
    const raw = JSON.stringify(payload);
    try {
      const { data } = await api<{ enabled: boolean; token: string | null }>('/api/checkout/draft', { method: 'PUT', body: { ...payload, token: draftStore.ensureToken() } });
      if (!data.enabled) {
        store.del(PENDING_KEY);
        this.setStatus('off');
      } else {
        if (data.token) store.set(TOKEN_KEY, data.token);
        // Only clear what was sent: newer typing stays pending for the next save.
        if (store.get(PENDING_KEY) === raw) store.del(PENDING_KEY);
        this.retryMs = 0;
        this.setStatus(draftStore.pending() ? 'pending' : 'saved');
      }
    } catch (e) {
      const status = e instanceof ApiError ? e.status : 0;
      if (status === 0 || status === 429 || status >= 500) {
        // Network / server trouble: keep it locally and try again.
        this.setStatus('offline');
        this.retryMs = Math.min(60_000, this.retryMs ? this.retryMs * 2 : 5000);
        clearTimeout(this.retryTimer);
        this.retryTimer = setTimeout(() => void this.flush(), this.retryMs);
      } else {
        store.del(PENDING_KEY); // rejected input: do not resend it forever
        this.setStatus('idle');
      }
    } finally {
      this.inFlight = false;
      if (this.again) {
        this.again = false;
        void this.flush();
      }
    }
  }

  /** Sends unsaved changes while the page is closing (keepalive survives the unload). */
  flushOnExit() {
    const payload = draftStore.pending();
    if (!payload || draftStore.optedOut()) return;
    try {
      void fetch(apiUrl('/api/checkout/draft'), {
        method: 'PUT',
        keepalive: true,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'celibery' },
        body: JSON.stringify({ ...payload, token: draftStore.ensureToken() }),
      }).catch(() => undefined);
    } catch {
      /* the pending copy is still in localStorage for the next visit */
    }
  }

  /** Stops timers (order placed or opted out). */
  reset() {
    clearTimeout(this.timer);
    clearTimeout(this.retryTimer);
    this.setStatus('idle');
  }
}

export const draftSync = new DraftSync();

/** The saved checkout for this browser (or the signed-in customer), if any. */
export async function loadDraft(): Promise<SavedDraft | null> {
  const token = draftStore.token();
  try {
    const { data } = await api<SavedDraft | null>(`/api/checkout/draft${token ? `?token=${encodeURIComponent(token)}` : ''}`);
    return data;
  } catch {
    return null;
  }
}

/** "Don't save my details": deletes the saved copy and stops saving on this device. */
export async function optOutOfDraft() {
  const token = draftStore.token();
  store.set(OPTOUT_KEY, '1');
  draftSync.reset();
  draftStore.finish();
  await api('/api/checkout/draft', { method: 'DELETE', body: { token: token ?? undefined } }).catch(() => undefined);
}

export function optInToDraft() {
  store.del(OPTOUT_KEY);
}
