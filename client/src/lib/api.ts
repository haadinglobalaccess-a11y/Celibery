const BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? '';

/** Absolute URL for an API path (the API may live on another origin via VITE_API_BASE_URL). */
export const apiUrl = (path: string) => (/^https?:\/\//.test(path) ? path : BASE + path);

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

type Options = { method?: string; body?: unknown; signal?: AbortSignal };

/** JSON API client. Sends the session cookie and the CSRF header the server requires. */
export async function api<T = unknown>(path: string, opts: Options = {}): Promise<{ data: T; meta?: Record<string, unknown> }> {
  let res: Response;
  try {
    res = await fetch(BASE + path, {
      method: opts.method ?? 'GET',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'celibery' },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: opts.signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError(0, 'NETWORK', 'Network error');
  }
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.ok) {
    throw new ApiError(res.status, json?.error?.code ?? 'ERROR', json?.error?.message ?? `Request failed (${res.status})`, json?.error?.details);
  }
  return { data: json.data as T, meta: json.meta };
}

export const get = <T>(path: string, signal?: AbortSignal) => api<T>(path, { signal }).then((r) => r.data);
export const post = <T>(path: string, body?: unknown) => api<T>(path, { method: 'POST', body: body ?? {} }).then((r) => r.data);
export const put = <T>(path: string, body: unknown) => api<T>(path, { method: 'PUT', body }).then((r) => r.data);
export const patch = <T>(path: string, body: unknown) => api<T>(path, { method: 'PATCH', body }).then((r) => r.data);
export const del = <T>(path: string) => api<T>(path, { method: 'DELETE' }).then((r) => r.data);

export function qs(params: Record<string, string | number | boolean | undefined | null | string[]>) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) continue;
    u.set(k, Array.isArray(v) ? v.join(',') : String(v));
  }
  const s = u.toString();
  return s ? `?${s}` : '';
}

export function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID().replace(/-/g, '');
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
}
