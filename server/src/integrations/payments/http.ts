import { AppError } from '../../lib/errors';

/**
 * Error raised by a payment gateway call.
 *
 * `definitive` tells callers whether the gateway has certainly NOT performed the operation:
 *  - true  → the gateway answered with a client error (400/401/403/404/422…): nothing happened;
 *  - false → timeout, network failure, 5xx, 408/409/429: the gateway MAY have processed it, so
 *            money-moving operations (refunds, captures) must be reconciled, never assumed failed.
 */
export class GatewayError extends AppError {
  constructor(
    public provider: string,
    public httpStatus: number | null,
    public definitive: boolean,
    message: string,
  ) {
    super(503, 'PAYMENT_GATEWAY_ERROR', message);
  }
}

export function isDefinitiveHttpFailure(status: number): boolean {
  return status >= 400 && status < 500 && ![408, 409, 425, 429].includes(status);
}

export const GATEWAY_TIMEOUT_MS = 20_000;

/** fetch() with a timeout and classified errors. Response bodies are truncated and never include our credentials. */
export async function gatewayFetch<T>(provider: string, url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  const { timeoutMs = GATEWAY_TIMEOUT_MS, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(url, { ...rest, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    const name = (e as Error)?.name;
    throw new GatewayError(provider, null, false, `${provider} request did not complete (${name === 'TimeoutError' ? 'timeout' : 'network error'})`);
  }
  if (!res.ok) {
    const body = (await res.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 200);
    throw new GatewayError(provider, res.status, isDefinitiveHttpFailure(res.status), `${provider} request failed (${res.status}): ${body}`);
  }
  const text = await res.text();
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    // 2xx but unreadable: the operation probably succeeded — never treat as a definitive failure.
    throw new GatewayError(provider, res.status, false, `${provider} returned an unreadable response`);
  }
}
