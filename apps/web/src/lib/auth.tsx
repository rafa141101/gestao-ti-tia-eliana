import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Permission, Role } from '@gestao-ti/shared';
import { api, getToken, setToken } from './api';

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  unitId: string | null;
  departmentId: string | null;
  permissions: Permission[];
}

interface AuthContextValue {
  user: SessionUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  can: (perm: Permission) => boolean;
}

const AuthContext = createContext<AuthContextValue>(null as never);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!getToken()) {
      setLoading(false);
      return;
    }
    api.get<SessionUser>('/api/auth/me')
      .then(setUser)
      .catch(() => setToken(null))
      .finally(() => setLoading(false));
  }, []);

  async function login(email: string, password: string) {
    const res = await api.post<{ token: string; user: SessionUser }>('/api/auth/login', { email, password });
    setToken(res.token);
    setUser(res.user);
  }

  function logout() {
    setToken(null);
    setUser(null);
    window.location.href = '/login';
  }

  const can = (perm: Permission) => user?.permissions.includes(perm) ?? false;

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, can }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
