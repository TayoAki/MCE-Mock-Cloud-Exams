import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { UNAUTHORIZED_EVENT, api, clearSession, getToken, loadStoredUser, saveSession } from './api';
import type { Profile } from './types';

interface AuthState {
  user: Profile | null;
  isStaff: boolean;
  isAdmin: boolean;
  signIn: (email: string, password: string) => Promise<Profile>;
  signOut: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<Profile | null>(() => (getToken() ? loadStoredUser<Profile>() : null));

  const signOut = useCallback(() => {
    clearSession();
    queryClient.clear();
    setUser(null);
  }, [queryClient]);

  useEffect(() => {
    const onUnauthorized = () => {
      queryClient.clear();
      setUser(null);
    };
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, [queryClient]);

  // Revalidate a stored session against the server once on load.
  useEffect(() => {
    if (!getToken()) return;
    api
      .get<{ user: Profile }>('/me')
      .then((me) => {
        setUser(me.user);
        saveSession(getToken()!, me.user);
      })
      .catch(() => undefined);
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const res = await api.post<{ token: string; user: Profile }>('/auth/login', { email, password });
    saveSession(res.token, res.user);
    setUser(res.user);
    return res.user;
  }, []);

  const value = useMemo<AuthState>(() => {
    const roles = user?.roles ?? [];
    return {
      user,
      isStaff: roles.includes('reviewer') || roles.includes('admin'),
      isAdmin: roles.includes('admin'),
      signIn,
      signOut,
    };
  }, [user, signIn, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
