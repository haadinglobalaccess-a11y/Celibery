import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { get, post } from '../lib/api';
import type { Me } from '../lib/types';

type AuthCtx = {
  user: Me | null;
  ready: boolean;
  refresh: () => Promise<Me | null>;
  login: (email: string, password: string) => Promise<Me>;
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
    const me = await post<Me>('/api/auth/login', { email, password });
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

  return <Ctx.Provider value={{ user, ready, refresh, login, register, logout }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth outside AuthProvider');
  return c;
}
