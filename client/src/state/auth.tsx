import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { ApiError, get, post } from '../lib/api';
import type { Me } from '../lib/types';

type AuthCtx = {
  user: Me | null;
  ready: boolean;
  refresh: () => Promise<Me | null>;
  login: (email: string, password: string) => Promise<Me>;
  /** Second sign-in step for staff with two-factor authentication. */
  verifyMfa: (mfaToken: string, code: string) => Promise<Me>;
  register: (data: { name: string; email: string; password: string; phone?: string; lang: string; marketingOptIn?: boolean }) => Promise<Me>;
  logout: () => Promise<void>;
};

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const me = await get<Me | null>('/api/auth/me');
      setUser(me);
      return me;
    } catch {
      setUser(null);
      return null;
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    const r = await post<Me | { mfaRequired: true; mfaToken: string }>('/api/auth/login', { email, password });
    // Staff with two-factor authentication: no session yet. The admin sign-in asks for the code.
    if ('mfaRequired' in r) throw new ApiError(401, 'MFA_REQUIRED', 'Enter the code from your authenticator app', { mfaToken: r.mfaToken });
    setUser(r);
    return r;
  }, []);

  const verifyMfa = useCallback(async (mfaToken: string, code: string) => {
    const me = await post<Me>('/api/auth/mfa/verify', { mfaToken, code });
    setUser(me);
    return me;
  }, []);

  const register = useCallback(async (data: Parameters<AuthCtx['register']>[0]) => {
    const me = await post<Me>('/api/auth/register', data);
    setUser(me);
    return me;
  }, []);

  const logout = useCallback(async () => {
    await post('/api/auth/logout').catch(() => undefined);
    setUser(null);
  }, []);

  return <Ctx.Provider value={{ user, ready, refresh, login, verifyMfa, register, logout }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth outside AuthProvider');
  return c;
}
